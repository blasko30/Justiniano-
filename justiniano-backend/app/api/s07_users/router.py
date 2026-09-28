"""§7 — Cuenta, onboarding y preferencias.

Perfil del usuario autenticado, onboarding (stepper), preferencias de Ajustes,
registro de consentimientos, consumo/cuotas del Dashboard y baja de la cuenta.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ApiError
from app.core.pagination import PageParams, page_response
from app.core.security import hash_opaque, new_id, new_otp, utcnow, verify_password
from app.integrations.notify import notifier
from app.integrations.payments import stripe_client
from app.models import (AuditEvent, Consultation, OtpCode, Plan, PlanVersion, RefreshToken,
                        Review, Subscription, User)

from .schemas import DeleteMeIn, OnboardingIn, PreferencesIn, TermsAcceptanceIn, UpdateMeIn

router = APIRouter(tags=["§07 Cuenta y preferencias"])

# Tipos de evento del registro de consentimientos (§7.6).
_CONSENT_EVENTS = ("audit_tyc", "audit_dl", "audit_rm", "audit_sens")

# Límites de respaldo si no existe la fila del plan Gratuito (regla 8, §4).
_FREE_LIMITS = {"documents_month": 2, "support_hours": 0, "agents": 2,
                "questions_month": 30, "seats": 1, "history_months": 1}


# ── Helpers internos ─────────────────────────────────────────────────────
def _iso(dt: datetime | None) -> str | None:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _plan_label(plan_id: str | None) -> str:
    return (plan_id or "p_free").removeprefix("p_")


async def _plan_limits(db: AsyncSession, user: User) -> dict:
    """Límites vigentes: Subscription.plan_version_id → PlanVersion.limits, con
    fallback Plan.limits; sin suscripción = plan Gratuito p_free (regla 8)."""
    sub = (await db.execute(select(Subscription)
                            .where(Subscription.user_id == user.id))).scalar_one_or_none()
    if sub and sub.plan_version_id:
        pv = await db.get(PlanVersion, sub.plan_version_id)
        if pv:
            return pv.limits
    plan_id = sub.plan_id if sub else (user.plan_id or "p_free")
    plan = await db.get(Plan, plan_id)
    if plan is None and plan_id != "p_free":
        plan = await db.get(Plan, "p_free")
    return plan.limits if plan else dict(_FREE_LIMITS)


def _limit_or_none(value: int | None) -> int | None:
    """-1 = ilimitado → null en la respuesta."""
    return None if value == -1 else value


# ── 7.1 Obtener mi perfil ────────────────────────────────────────────────
@router.get("/users/me")
async def get_me(user: User = Depends(get_current_user)):
    """Perfil completo del usuario autenticado (hidrata la SPA tras el login)."""
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "email_verified": user.email_verified,
        "phone": user.phone,
        "phone_verified": user.phone_verified,
        "company": user.company,
        "country": user.country,
        "lang": user.lang,
        "theme": user.theme,
        "plan": _plan_label(user.plan_id),
        "credits": user.credits,
        "onboarding": {"size": user.size, "industry": user.industry, "role": user.contact_role},
        "notifications": {"email": user.notif_email, "sms": user.notif_sms},
        "mfa_enabled": user.mfa_enabled,
        "terms_accepted_at": _iso(user.terms_accepted_at),
        "created_at": _iso(user.created_at),
    }


# ── 7.2 Actualizar mi perfil ─────────────────────────────────────────────
@router.patch("/users/me")
async def update_me(body: UpdateMeIn, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    """Actualiza nombre/empresa/teléfono; un teléfono nuevo exige re-verificación."""
    if body.name is not None:
        user.name = body.name
    if body.company is not None:
        user.company = body.company
    verification_required = None
    if body.phone is not None and body.phone != user.phone:
        user.phone = body.phone
        user.phone_verified = False
        verification_required = "phone"
        code, code_hash = new_otp()
        db.add(OtpCode(id=new_id("otp"), user_id=user.id, channel="sms", code_hash=code_hash,
                       purpose="verify_phone", expires_at=utcnow() + timedelta(minutes=10)))
        notifier().send_sms(user.phone, f"Justiniano: su código es {code}. Expira en 10 minutos.")
    await db.commit()
    out = {"updated": True, "phone_verified": user.phone_verified}
    if verification_required:
        out["verification_required"] = verification_required
    return out


# ── 7.3 Completar onboarding ─────────────────────────────────────────────
@router.post("/users/me/onboarding")
async def complete_onboarding(body: OnboardingIn, user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    """Guarda tamaño, industria y rol (contexto para los prompts de los agentes)."""
    user.size = body.size
    user.industry = body.industry
    user.contact_role = body.role
    if body.company is not None:
        user.company = body.company
    if body.city is not None:
        user.city = body.city
    user.onboarding_done = True
    await db.commit()
    return {"onboarding_completed": True}


# ── 7.4 Actualizar preferencias ──────────────────────────────────────────
@router.patch("/users/me/preferences")
async def update_preferences(body: PreferencesIn, user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    """Idioma, país, tema y notificaciones. La jurisdicción efectiva sigue
    siendo CL aunque se elija un país 'Próximamente'."""
    if body.lang is not None:
        user.lang = body.lang
    if body.country is not None:
        user.country = body.country
    if body.theme is not None:
        user.theme = body.theme
    if body.email_notifications is not None:
        user.notif_email = body.email_notifications
    if body.sms_alerts is not None:
        user.notif_sms = body.sms_alerts
    await db.commit()
    return {"updated": True, "effective_jurisdiction": "CL"}


# ── 7.5 Aceptar Términos y Condiciones ───────────────────────────────────
@router.post("/users/me/terms-acceptance", status_code=201)
async def accept_terms(body: TermsAcceptanceIn, request: Request,
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    """Registra la aceptación de TyC (gate modal) y genera el evento audit_tyc."""
    current = get_settings().terms_current_version
    if body.version != current:
        raise ApiError(422, "validation_error", "La versión de TyC no es la vigente.",
                       {"fields": [{"field": "version", "issue": f"versión vigente: {current}"}]})
    now = utcnow()
    user.terms_version = body.version
    user.terms_accepted_at = now
    await audit(db, user.id, "audit_tyc",
                {"text": f"Aceptó los Términos y Condiciones (v{body.version})"}, _ip(request))
    await db.commit()
    return {"accepted": True, "version": body.version, "accepted_at": _iso(now)}


# ── 7.6 Registro de consentimientos ──────────────────────────────────────
@router.get("/users/me/consents")
async def list_consents(p: PageParams = Depends(),
                        event: str | None = Query(default=None),
                        user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    """Consentimientos auditables del usuario: audit_tyc, audit_dl, audit_rm, audit_sens."""
    if event is not None and event not in _CONSENT_EVENTS:
        raise ApiError(422, "validation_error", "Tipo de evento no reconocido.",
                       {"fields": [{"field": "event", "issue": f"uno de {list(_CONSENT_EVENTS)}"}]})
    events = (event,) if event else _CONSENT_EVENTS
    where = (AuditEvent.user_id == user.id, AuditEvent.event.in_(events))
    total = (await db.execute(select(func.count()).select_from(AuditEvent).where(*where))).scalar_one()
    rows = (await db.execute(select(AuditEvent).where(*where)
                             .order_by(AuditEvent.created_at.desc())
                             .offset(p.offset).limit(p.page_size))).scalars().all()
    items = [{"id": e.id, "event": e.event,
              "detail": e.detail.get("text", e.detail) if isinstance(e.detail, dict) else e.detail,
              "created_at": _iso(e.created_at)} for e in rows]
    return page_response(items, total, p)


# ── 7.7 Consumo y cuotas (dashboard) ─────────────────────────────────────
@router.get("/users/me/usage")
async def get_usage(user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    """Contadores del período contra los límites del plan (-1 = ilimitado → null)."""
    limits = await _plan_limits(db, user)
    month_start = utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    consultations_used = (await db.execute(
        select(func.coalesce(func.sum(Consultation.interactions_used), 0))
        .where(Consultation.user_id == user.id,
               Consultation.created_at >= month_start))).scalar_one()
    documents_used = (await db.execute(
        select(func.count()).select_from(AuditEvent)
        .where(AuditEvent.user_id == user.id, AuditEvent.event == "audit_dl",
               AuditEvent.created_at >= month_start))).scalar_one()
    reviews_in_progress = (await db.execute(
        select(func.count()).select_from(Review)
        .where(Review.user_id == user.id, Review.state < 4))).scalar_one()

    return {
        "plan": _plan_label(user.plan_id),
        "consultations": {"used": int(consultations_used),
                          "limit": _limit_or_none(limits.get("questions_month"))},
        "documents_month": {"used": int(documents_used),
                            "limit": _limit_or_none(limits.get("documents_month"))},
        "reviews_in_progress": int(reviews_in_progress),
        "credits": user.credits,
    }


# ── 7.8 Eliminar cuenta ──────────────────────────────────────────────────
@router.delete("/users/me", status_code=204)
async def delete_me(body: DeleteMeIn, request: Request,
                    user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    """Borrado lógico (deleted_at), cancelación en Stripe y revocación de sesiones."""
    if not verify_password(body.password, user.password_hash):
        raise ApiError(401, "wrong_password", "La contraseña no coincide.")
    user.deleted_at = utcnow()
    # Revoca todas las familias de refresh tokens del usuario.
    await db.execute(update(RefreshToken)
                     .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
                     .values(revoked_at=utcnow()))
    sub = (await db.execute(select(Subscription)
                            .where(Subscription.user_id == user.id))).scalar_one_or_none()
    if sub and sub.stripe_subscription_id:
        stripe_client().cancel_subscription(sub.stripe_subscription_id)
        sub.cancel_at_period_end = True
    await audit(db, user.id, "account_deleted", {"text": "Cuenta eliminada por el usuario"},
                _ip(request))
    await db.commit()
    return Response(status_code=204)
