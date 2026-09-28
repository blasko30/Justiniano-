"""JWT RS256, Argon2, OTP y RUT (§2.3, §2.8)."""
import hashlib
import hmac
import re
import secrets
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.config import get_settings
from app.core.errors import ApiError

_ph = PasswordHasher()
_PREFIX_RE = re.compile(r"^[a-z]{3,4}_[A-Za-z0-9]{1,26}$")


# ── Identificadores públicos opacos (§2.2) ──────────────────────────────
def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def check_id(value: str, prefix: str) -> str:
    if not _PREFIX_RE.match(value or "") or not value.startswith(prefix + "_"):
        raise ApiError(422, "validation_error", "Identificador inválido.", {"fields": [{"field": "id", "issue": f"prefijo {prefix}_ requerido"}]})
    return value


# ── Claves RS256 (Key Vault en prod; generación local en dev) ───────────
def _load_or_create_keys() -> tuple[str, str]:
    s = get_settings()
    if s.key_vault_url and not s.fake_integrations:  # pragma: no cover - requiere Azure
        from azure.identity import DefaultAzureCredential
        from azure.keyvault.secrets import SecretClient
        client = SecretClient(vault_url=s.key_vault_url, credential=DefaultAzureCredential())
        return client.get_secret("jwt-private").value, client.get_secret("jwt-public").value
    priv, pub = Path(s.jwt_private_key_path), Path(s.jwt_public_key_path)
    if not priv.exists():
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        priv.parent.mkdir(parents=True, exist_ok=True)
        priv.write_bytes(key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        pub.write_bytes(key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
    return priv.read_text(), pub.read_text()


_KEYS: tuple[str, str] | None = None


def _keys() -> tuple[str, str]:
    global _KEYS
    if _KEYS is None:
        _KEYS = _load_or_create_keys()
    return _KEYS


# ── Tokens ───────────────────────────────────────────────────────────────
def create_access_token(user_id: str, email: str, plan: str | None, role: str) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "email": email, "plan": plan, "role": role,
               "iat": now, "exp": now + timedelta(minutes=s.access_token_minutes),
               "jti": secrets.token_hex(8), "iss": s.jwt_issuer, "aud": s.jwt_audience}
    return jwt.encode(payload, _keys()[0], algorithm="RS256")


def decode_access_token(token: str) -> dict:
    s = get_settings()
    try:  # algoritmo fijado server-side: rechaza alg:none y HS256 (§2.8 jwt)
        return jwt.decode(token, _keys()[1], algorithms=["RS256"], issuer=s.jwt_issuer, audience=s.jwt_audience)
    except jwt.PyJWTError:
        raise ApiError(401, "unauthorized", "Token ausente, expirado o inválido.")


def new_refresh_token() -> tuple[str, str]:
    """(token en claro para el cliente, hash para persistir)."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_opaque(raw)


def hash_opaque(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


# ── Contraseñas (Argon2id, §2.8) ────────────────────────────────────────
_PW_RE = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$")


def validate_password_policy(pw: str) -> None:
    if not _PW_RE.match(pw or ""):
        raise ApiError(422, "validation_error", "La contraseña no cumple la política.",
                       {"fields": [{"field": "password", "issue": "8–128 caracteres con mayúscula, minúscula y dígito"}]})


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, pw)
    except VerifyMismatchError:
        return False


# ── OTP (§2.8) ───────────────────────────────────────────────────────────
def new_otp() -> tuple[str, str]:
    code = f"{secrets.randbelow(1_000_000):06d}"
    return code, hash_opaque(code)


def verify_otp(code: str, code_hash: str) -> bool:
    return hmac.compare_digest(hash_opaque(code or ""), code_hash)  # tiempo constante


# ── RUT chileno (§2.8) ───────────────────────────────────────────────────
_RUT_RE = re.compile(r"^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$")


def normalize_rut(rut: str) -> str:
    """Valida formato + dígito verificador módulo 11; persiste sin puntos."""
    if not _RUT_RE.match(rut or ""):
        raise ApiError(422, "validation_error", "RUT inválido.", {"fields": [{"field": "rut", "issue": "formato"}]})
    clean = rut.replace(".", "").upper()
    num, dv = clean.split("-")
    total, factor = 0, 2
    for d in reversed(num):
        total += int(d) * factor
        factor = 2 if factor == 7 else factor + 1
    expected = 11 - (total % 11)
    expected_dv = "0" if expected == 11 else "K" if expected == 10 else str(expected)
    if dv != expected_dv:
        raise ApiError(422, "validation_error", "RUT inválido.", {"fields": [{"field": "rut", "issue": "dígito verificador"}]})
    return clean


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text or "").strip()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
