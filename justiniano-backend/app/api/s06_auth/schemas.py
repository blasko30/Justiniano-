"""Esquemas Pydantic de la §6 — Autenticación y verificación.

Todos los modelos de entrada son estrictos (strict=True, extra="forbid", §2.8):
tipos exactos y campos desconocidos rechazados con 422 antes de tocar la BD.
"""
import re
import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

_CTRL = re.compile(r"[\u0000-\u001f]")
# RFC 5322 (forma práctica): local-part de átomos + dominio con etiquetas válidas.
_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")


def _valida_email(v: str) -> str:
    """email (§2.8): RFC 5322, máx. 254, normalizado a minúsculas y NFC."""
    v = unicodedata.normalize("NFC", v).strip().lower()
    if len(v) > 254 or not _EMAIL_RE.match(v):
        raise ValueError("correo electrónico inválido")
    return v


_NAME_RE = re.compile(r"^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,80}$")

CountryCode = Literal["CL", "AR", "BR", "CO", "MX", "PE", "UY", "US"]


class _StrictModel(BaseModel):
    """Base común: modo estricto y rechazo de campos extra (§2.8)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    @field_validator("email", check_fields=False)
    @classmethod
    def _norm_email(cls, v: str) -> str:
        return _valida_email(v)


class SignupIn(_StrictModel):
    """Cuerpo de POST /auth/signup (§6.1)."""
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(max_length=254)
    phone: str = Field(pattern=r"^\+[1-9]\d{7,14}$")
    company: str = Field(min_length=2, max_length=120)
    country: CountryCode
    password: str = Field(min_length=8, max_length=128)
    accepts_terms: bool

    @field_validator("name")
    @classmethod
    def _valida_nombre(cls, v: str) -> str:
        v = unicodedata.normalize("NFC", v).strip()
        if _CTRL.search(v) or not _NAME_RE.match(v):
            raise ValueError("2–80 caracteres; letras, espacios, apóstrofes y guiones")
        return v

    @field_validator("company")
    @classmethod
    def _valida_empresa(cls, v: str) -> str:
        v = unicodedata.normalize("NFC", v).strip()
        if _CTRL.search(v) or not 2 <= len(v) <= 120:
            raise ValueError("2–120 caracteres sin caracteres de control")
        return v


class VerifyEmailIn(_StrictModel):
    """Cuerpo de POST /auth/verify-email (§6.2)."""
    email: str = Field(max_length=254)
    code: str = Field(pattern=r"^\d{6}$")


class ResendEmailCodeIn(_StrictModel):
    """Cuerpo de POST /auth/resend-email-code (§6.3)."""
    email: str = Field(max_length=254)


class VerifyPhoneIn(_StrictModel):
    """Cuerpo de POST /auth/verify-phone (§6.4)."""
    phone: str = Field(pattern=r"^\+[1-9]\d{7,14}$")
    code: str = Field(pattern=r"^\d{6}$")


class ResendPhoneCodeIn(_StrictModel):
    """Cuerpo de POST /auth/resend-phone-code (§6.5)."""
    phone: str = Field(pattern=r"^\+[1-9]\d{7,14}$")


class LoginIn(_StrictModel):
    """Cuerpo de POST /auth/login (§6.6). En login solo se valida la longitud."""
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)


class MfaVerifyIn(_StrictModel):
    """Cuerpo de POST /auth/mfa/verify (§6.7)."""
    mfa_token: str = Field(min_length=32, max_length=64)
    code: str = Field(pattern=r"^\d{6}$")


class RefreshIn(_StrictModel):
    """Cuerpo de POST /auth/refresh (§6.8)."""
    refresh_token: str = Field(min_length=20, max_length=512)


class LogoutIn(_StrictModel):
    """Cuerpo de POST /auth/logout (§6.9)."""
    refresh_token: str = Field(min_length=20, max_length=512)


class ForgotPasswordIn(_StrictModel):
    """Cuerpo de POST /auth/forgot-password (§6.10)."""
    email: str = Field(max_length=254)


class ResetPasswordIn(_StrictModel):
    """Cuerpo de POST /auth/reset-password (§6.11)."""
    token: str = Field(min_length=32, max_length=64)
    new_password: str = Field(min_length=8, max_length=128)


class ChangePasswordIn(_StrictModel):
    """Cuerpo de POST /auth/change-password (§6.12)."""
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
