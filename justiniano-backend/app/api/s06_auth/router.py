"""§6 — Autenticación y verificación.

Registro con OTP de correo, verificación de correo/teléfono, login con 2FA
por SMS, rotación de refresh tokens con detección de reutilización (revoca
la familia completa), recuperación y cambio de contraseña.
"""
import secrets
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ApiError
from app.core.ratelimit import limit
from app.core.security import (create_access_token, hash_opaque, hash_password, new_id,
                               new_otp, new_refresh_token, nfc, utcnow,
                               validate_password_policy, verify_otp, verify_password)
from app.integrations.notify import notifier
from app.models import OtpCode, RefreshToken, User

from .schemas import (ChangePasswordIn, ForgotPasswordIn, LoginIn, LogoutIn, MfaVerifyIn,
                      RefreshIn, ResendEmailCodeIn, ResendPhoneCodeIn, ResetPasswordIn,
                      SignupIn, VerifyEmailIn, VerifyPhoneIn)

router = APIRouter(tags=["§06 Autenticación"])

# Prefijos telefónicos por país del catálogo (§8.1): coherencia phone/country.
_DIAL = {"CL": "+56", "AR": "+54", "BR": "+55", "CO": "+57",
         "MX": "+52", "PE": "+51", "UY": "+598", "US": "+1"}

# Hash de sacrificio: el login ejecuta Argon2 aunque el correo no exista
# (verificación en tiempo constante, anti-enumeración §2.9).
_DUMMY_HASH = hash_password("Justiniano#dummy1")

_OTP_TTL_MIN = 10          # expiración de OTP de verificación (§6.2)
_RESET_TTL_MIN = 30        # expiración del token de restablecimiento (§6.10)
_MFA_TTL_MIN = 5           # expiración del mfa_token (§6.7)
_MAX_ATTEMPTS = 5          # intentos por código (§2.8)
_RESEND_COOLDOWN_S = 45    # cooldown de reenvíos (§6.3/§6.5)


# ── Helpers internos ─────────────────────────────────────────────────────
def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _aware(dt):
    """Normaliza datetimes de BD: en SQLite (tests) llegan naive; se asumen UTC."""
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _norm_email(email: str) -> str:
    return nfc(email).lower()


def _plan_label(plan_id: str | None) -> str:
    """p_free → "free" (etiqueta comercial de las respuestas de la spec)."""
    return (plan_id or "p_free").removeprefix("p_")


def _mfa_row_id(raw_token: str) -> str:
    """Id determinístico de la fila OTP del desafío MFA a partir del token opaco."""
    return "otp_" + hash_opaque(raw_token)[:26]


async def _get_user_by_email(db: AsyncSession, email: str) -> User | None:
    return (await db.execute(select(User).where(User.email == _norm_email(email)))).scalar_one_or_none()


def _issue_otp(db: AsyncSession, user_id: str, purpose: str, channel: str,
               ttl_min: int = _OTP_TTL_MIN) -> str:
    """Crea un OtpCode hasheado y devuelve el código en claro para enviarlo."""
    code, code_hash = new_otp()
    db.add(OtpCode(id=new_id("otp"), user_id=user_id, channel=channel, code_hash=code_hash,
                   purpose=purpose, expires_at=utcnow() + timedelta(minutes=ttl_min)))
    return code


async def _latest_otp(db: AsyncSession, user_id: str, purpose: str) -> OtpCode | None:
    return (await db.execute(
        select(OtpCode)
        .where(OtpCode.user_id == user_id, OtpCode.purpose == purpose,
               OtpCode.consumed_at.is_(None))
        .order_by(OtpCode.created_at.desc()).limit(1))).scalar_one_or_none()


async def _check_and_consume_otp(db: AsyncSession, user_id: str | None, purpose: str,
                                 code: str) -> OtpCode:
    """Valida el último OTP vigente: expiración 10 min, máx. 5 intentos,
    comparación en tiempo constante. Lanza los errores de la spec (§6.2/§6.4)."""
    otp = await _latest_otp(db, user_id, purpose) if user_id else None
    if otp is None:
        raise ApiError(400, "invalid_code", "Código incorrecto.")
    if _aware(otp.expires_at) < utcnow():
        raise ApiError(410, "code_expired", "Código vencido; solicite un reenvío.")
    if otp.attempts >= _MAX_ATTEMPTS:
        raise ApiError(429, "too_many_attempts", "Se superaron los intentos permitidos.")
    if not verify_otp(code, otp.code_hash):
        otp.attempts += 1
        await db.commit()
        raise ApiError(400, "invalid_code", "Código incorrecto.")
    otp.consumed_at = utcnow()
    return otp


async def _enforce_resend_cooldown(db: AsyncSession, user_id: str, purpose: str) -> None:
    last = (await db.execute(
        select(OtpCode).where(OtpCode.user_id == user_id, OtpCode.purpose == purpose)
        .order_by(OtpCode.created_at.desc()).limit(1))).scalar_one_or_none()
    if last and last.created_at and \
            (utcnow() - _aware(last.created_at)).total_seconds() < _RESEND_COOLDOWN_S:
        raise ApiError(429, "resend_cooldown",
                       f"Espere {_RESEND_COOLDOWN_S} segundos antes de reenviar.",
                       {"retry_after_s": _RESEND_COOLDOWN_S})


def _issue_token_pair(db: AsyncSession, user: User, family_id: str | None = None) -> dict:
    """Emite access JWT + refresh opaco persistido hasheado (rotación §2.3)."""
    s = get_settings()
    raw, token_hash = new_refresh_token()
    db.add(RefreshToken(id=new_id("rft"), user_id=user.id, token_hash=token_hash,
                        family_id=family_id or new_id("fam"),
                        expires_at=utcnow() + timedelta(days=s.refresh_token_days)))
    access = create_access_token(user.id, user.email, user.plan_id, user.role)
    return {"access_token": access, "refresh_token": raw, "token_type": "bearer",
            "expires_in": s.access_token_minutes * 60}


async def _revoke_family(db: AsyncSession, family_id: str) -> None:
    await db.execute(update(RefreshToken)
                     .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
                     .values(revoked_at=utcnow()))


async def _revoke_all_user_tokens(db: AsyncSession, user_id: str) -> None:
    await db.execute(update(RefreshToken)
                     .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
                     .values(revoked_at=utcnow()))


# ── 6.1 Crear cuenta ─────────────────────────────────────────────────────
@router.post("/auth/signup", status_code=201,
             dependencies=[Depends(limit("signup", 5, 3600))])
async def signup(body: SignupIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Registra un usuario empresa, audita la aceptación de TyC y envía el OTP de correo."""
    if body.accepts_terms is not True:
        raise ApiError(422, "terms_not_accepted", "Debe aceptar los Términos y Condiciones.")
    validate_password_policy(body.password)
    if not body.phone.startswith(_DIAL[body.country]):
        raise ApiError(422, "validation_error", "El prefijo telefónico no es coherente con el país.",
                       {"fields": [{"field": "phone", "issue": f"prefijo {_DIAL[body.country]} requerido"}]})

    s = get_settings()
    email = _norm_email(body.email)
    user = User(id=new_id("usr"), name=body.name, email=email, phone=body.phone,
                company=body.company, country=body.country, role="client",
                password_hash=hash_password(body.password),
                terms_version=s.terms_current_version, terms_accepted_at=utcnow())
    db.add(user)
    try:
        await db.flush()  # unicidad por constraint (índice único), no con SELECT previo
    except IntegrityError:
        await db.rollback()
        raise ApiError(409, "email_already_registered", "El correo ya tiene una cuenta.")

    await audit(db, user.id, "audit_tyc",
                {"text": f"Aceptó los Términos y Condiciones (v{s.terms_current_version})"},
                _ip(request))
    code = _issue_otp(db, user.id, "verify_email", "email")
    notifier().send_email(email, "Código de verificación — Justiniano",
                          f"Su código de verificación es {code}. Expira en 10 minutos.")
    await db.commit()
    return {"user_id": user.id, "email_verification": "pending",
            "message": "Código de verificación enviado al correo."}


# ── 6.2 Verificar correo ─────────────────────────────────────────────────
@router.post("/auth/verify-email")
async def verify_email(body: VerifyEmailIn, db: AsyncSession = Depends(get_db)):
    """Valida el OTP de correo (10 min, máx. 5 intentos, tiempo constante)."""
    user = await _get_user_by_email(db, body.email)
    await _check_and_consume_otp(db, user.id if user else None, "verify_email", body.code)
    user.email_verified = True
    await db.commit()
    return {"email_verified": True, "next_step": "verify_phone"}


# ── 6.3 Reenviar código de correo ────────────────────────────────────────
@router.post("/auth/resend-email-code",
             dependencies=[Depends(limit("otp", 5, 3600))])
async def resend_email_code(body: ResendEmailCodeIn, db: AsyncSession = Depends(get_db)):
    """Reenvía el OTP de correo con cooldown de 45 s. Respuesta uniforme (anti-enumeración)."""
    user = await _get_user_by_email(db, body.email)
    if user and user.deleted_at is None and not user.email_verified:
        await _enforce_resend_cooldown(db, user.id, "verify_email")
        code = _issue_otp(db, user.id, "verify_email", "email")
        notifier().send_email(user.email, "Código de verificación — Justiniano",
                              f"Su código de verificación es {code}. Expira en 10 minutos.")
        await db.commit()
    return {"sent": True, "retry_after_seconds": _RESEND_COOLDOWN_S}


# ── 6.4 Verificar teléfono ───────────────────────────────────────────────
@router.post("/auth/verify-phone")
async def verify_phone(body: VerifyPhoneIn, db: AsyncSession = Depends(get_db)):
    """Valida el OTP SMS con las mismas reglas de expiración e intentos."""
    user = (await db.execute(select(User).where(User.phone == body.phone,
                                                User.deleted_at.is_(None)))).scalars().first()
    await _check_and_consume_otp(db, user.id if user else None, "verify_phone", body.code)
    user.phone_verified = True
    await db.commit()
    return {"phone_verified": True, "next_step": "onboarding"}


# ── 6.5 Reenviar código SMS ──────────────────────────────────────────────
@router.post("/auth/resend-phone-code",
             dependencies=[Depends(limit("otp", 5, 3600))])
async def resend_phone_code(body: ResendPhoneCodeIn, db: AsyncSession = Depends(get_db)):
    """Reenvía el OTP por SMS con cooldown de 45 s. Respuesta uniforme."""
    user = (await db.execute(select(User).where(User.phone == body.phone,
                                                User.deleted_at.is_(None)))).scalars().first()
    if user and not user.phone_verified:
        await _enforce_resend_cooldown(db, user.id, "verify_phone")
        code = _issue_otp(db, user.id, "verify_phone", "sms")
        notifier().send_sms(user.phone, f"Justiniano: su código es {code}. Expira en 10 minutos.")
        await db.commit()
    return {"sent": True, "retry_after_seconds": _RESEND_COOLDOWN_S}


# ── 6.6 Iniciar sesión ───────────────────────────────────────────────────
@router.post("/auth/login",
             dependencies=[Depends(limit("login", 10, 900))])
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Autentica con correo y contraseña; con 2FA activo responde el desafío MFA."""
    user = await _get_user_by_email(db, body.email)
    # Tiempo constante: se ejecuta el hash aunque el usuario no exista (§2.9).
    ok = verify_password(body.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or user.deleted_at is not None or not ok:
        raise ApiError(401, "invalid_credentials", "Correo o contraseña incorrectos.")
    if not user.email_verified:
        raise ApiError(403, "email_not_verified", "Debe completar la verificación de correo.")

    if user.mfa_enabled:
        # Desafío MFA: token opaco de un solo uso (5 min) + OTP por SMS.
        mfa_token = "mfa_" + secrets.token_urlsafe(32)
        code, code_hash = new_otp()
        db.add(OtpCode(id=_mfa_row_id(mfa_token), user_id=user.id, channel="sms",
                       code_hash=code_hash, purpose="mfa",
                       expires_at=utcnow() + timedelta(minutes=_MFA_TTL_MIN)))
        if user.phone:
            notifier().send_sms(user.phone, f"Justiniano: su código 2FA es {code}.")
        await audit(db, user.id, "login_mfa_challenge", {"channel": "sms"}, _ip(request))
        await db.commit()
        return {"mfa_required": True, "mfa_token": mfa_token, "channel": "sms"}

    tokens = _issue_token_pair(db, user)
    user.last_activity_at = utcnow()
    await audit(db, user.id, "login", {"channel": "password"}, _ip(request))
    await db.commit()
    return {**tokens, "user": {"id": user.id, "name": user.name,
                               "plan": _plan_label(user.plan_id),
                               "onboarding_completed": user.onboarding_done}}


# ── 6.7 Verificar 2FA ────────────────────────────────────────────────────
@router.post("/auth/mfa/verify")
async def mfa_verify(body: MfaVerifyIn, db: AsyncSession = Depends(get_db)):
    """Completa el login con el código SMS del segundo factor (mfa_token de 5 min)."""
    otp = await db.get(OtpCode, _mfa_row_id(body.mfa_token))
    if otp is None or otp.purpose != "mfa" or otp.consumed_at is not None \
            or _aware(otp.expires_at) < utcnow() or otp.attempts >= _MAX_ATTEMPTS:
        raise ApiError(410, "mfa_token_expired", "El desafío expiró; reinicie el login.")
    if not verify_otp(body.code, otp.code_hash):
        otp.attempts += 1
        await db.commit()
        raise ApiError(400, "invalid_code", "Código incorrecto.")
    user = await db.get(User, otp.user_id)
    if user is None or user.deleted_at is not None:
        raise ApiError(410, "mfa_token_expired", "El desafío expiró; reinicie el login.")
    otp.consumed_at = utcnow()
    tokens = _issue_token_pair(db, user)
    user.last_activity_at = utcnow()
    await db.commit()
    return tokens


# ── 6.8 Refrescar tokens ─────────────────────────────────────────────────
@router.post("/auth/refresh")
async def refresh_tokens(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    """Rotación de un solo uso; la reutilización de un token rotado revoca la familia."""
    row = (await db.execute(select(RefreshToken).where(
        RefreshToken.token_hash == hash_opaque(body.refresh_token)))).scalar_one_or_none()
    if row is None:
        raise ApiError(401, "invalid_refresh_token", "Token inválido, expirado o reutilizado.")
    if row.revoked_at is not None:
        # Reutilización detectada → se revoca TODA la familia de sesión (§2.3).
        await _revoke_family(db, row.family_id)
        await db.commit()
        raise ApiError(401, "invalid_refresh_token", "Token inválido, expirado o reutilizado.")
    if _aware(row.expires_at) < utcnow():
        row.revoked_at = utcnow()
        await db.commit()
        raise ApiError(401, "invalid_refresh_token", "Token inválido, expirado o reutilizado.")
    user = await db.get(User, row.user_id)
    if user is None or user.deleted_at is not None:
        raise ApiError(401, "invalid_refresh_token", "Token inválido, expirado o reutilizado.")
    row.revoked_at = utcnow()  # rotación: el usado queda revocado
    tokens = _issue_token_pair(db, user, family_id=row.family_id)
    await db.commit()
    return tokens


# ── 6.9 Cerrar sesión ────────────────────────────────────────────────────
@router.post("/auth/logout", status_code=204)
async def logout(body: LogoutIn, user: User = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)):
    """Revoca la familia del refresh token recibido (debe pertenecer al usuario)."""
    row = (await db.execute(select(RefreshToken).where(
        RefreshToken.token_hash == hash_opaque(body.refresh_token),
        RefreshToken.user_id == user.id))).scalar_one_or_none()
    if row is not None:
        await _revoke_family(db, row.family_id)
        await db.commit()
    return Response(status_code=204)


# ── 6.10 Olvidé mi contraseña ────────────────────────────────────────────
@router.post("/auth/forgot-password",
             dependencies=[Depends(limit("otp", 5, 3600))])
async def forgot_password(body: ForgotPasswordIn, db: AsyncSession = Depends(get_db)):
    """Envía un token de restablecimiento (30 min). Siempre 200 (anti-enumeración)."""
    user = await _get_user_by_email(db, body.email)
    if user and user.deleted_at is None:
        raw = secrets.token_urlsafe(32)  # 43 caracteres url-safe (256 bits)
        db.add(OtpCode(id=new_id("otp"), user_id=user.id, channel="email",
                       code_hash=hash_opaque(raw), purpose="reset",
                       expires_at=utcnow() + timedelta(minutes=_RESET_TTL_MIN)))
        notifier().send_email(user.email, "Restablecer contraseña — Justiniano",
                              f"Use este enlace para restablecer su contraseña: "
                              f"https://app.justiniano.cl/reset-password?token={raw} "
                              f"(válido por 30 minutos).")
        await db.commit()
    return {"message": "Si el correo existe, se envió un enlace de restablecimiento."}


# ── 6.11 Restablecer contraseña ──────────────────────────────────────────
@router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordIn, db: AsyncSession = Depends(get_db)):
    """Consume el token de un solo uso, fija la contraseña y revoca todas las sesiones."""
    validate_password_policy(body.new_password)
    otp = (await db.execute(select(OtpCode).where(
        OtpCode.purpose == "reset",
        OtpCode.code_hash == hash_opaque(body.token),
        OtpCode.consumed_at.is_(None)))).scalar_one_or_none()
    if otp is None or _aware(otp.expires_at) < utcnow():
        raise ApiError(400, "invalid_or_expired_token", "Token inválido o vencido.")
    user = await db.get(User, otp.user_id)
    if user is None or user.deleted_at is not None:
        raise ApiError(400, "invalid_or_expired_token", "Token inválido o vencido.")
    otp.consumed_at = utcnow()
    user.password_hash = hash_password(body.new_password)
    await _revoke_all_user_tokens(db, user.id)
    await db.commit()
    return {"message": "Contraseña actualizada. Inicie sesión nuevamente."}


# ── 6.12 Cambiar contraseña ──────────────────────────────────────────────
@router.post("/auth/change-password", status_code=204)
async def change_password(body: ChangePasswordIn, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    """Cambio desde Ajustes → Seguridad; requiere la contraseña actual."""
    if not verify_password(body.current_password, user.password_hash):
        raise ApiError(401, "wrong_password", "La contraseña actual no coincide.")
    try:
        validate_password_policy(body.new_password)
    except ApiError:
        raise ApiError(422, "weak_password", "No cumple la política de contraseñas.")
    if verify_password(body.new_password, user.password_hash):
        raise ApiError(422, "weak_password", "La nueva contraseña debe ser distinta de la actual.")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    return Response(status_code=204)
