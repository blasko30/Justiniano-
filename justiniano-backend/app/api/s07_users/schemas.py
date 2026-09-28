"""Esquemas Pydantic de la §7 — Cuenta, onboarding y preferencias.

Modelos estrictos (strict=True, extra="forbid", §2.8): los campos no listados
(plan, credits, role…) se rechazan con 422 — previene mass assignment.
"""
import re
import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

_CTRL = re.compile(r"[\u0000-\u001f]")

CountryCode = Literal["CL", "AR", "BR", "CO", "MX", "PE", "UY", "US"]


class _StrictModel(BaseModel):
    """Base común: modo estricto y rechazo de campos extra (§2.8)."""
    model_config = ConfigDict(strict=True, extra="forbid")


def _texto_corto(v: str, min_len: int, max_len: int) -> str:
    v = unicodedata.normalize("NFC", v).strip()
    if _CTRL.search(v) or not min_len <= len(v) <= max_len:
        raise ValueError(f"{min_len}–{max_len} caracteres sin caracteres de control")
    return v


class UpdateMeIn(_StrictModel):
    """Cuerpo de PATCH /users/me (§7.2)."""
    name: str | None = Field(default=None, min_length=2, max_length=80)
    company: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = Field(default=None, pattern=r"^\+[1-9]\d{7,14}$")

    @field_validator("name")
    @classmethod
    def _valida_nombre(cls, v: str | None) -> str | None:
        return None if v is None else _texto_corto(v, 2, 80)

    @field_validator("company")
    @classmethod
    def _valida_empresa(cls, v: str | None) -> str | None:
        return None if v is None else _texto_corto(v, 2, 120)


class OnboardingIn(_StrictModel):
    """Cuerpo de POST /users/me/onboarding (§7.3). company y city son
    opcionales (se conservan en el perfil si se envían)."""
    size: Literal["1-9", "10-50", "51-200", "201-1000", "1000+"]
    industry: Literal["construccion", "retail", "tecnologia", "servicios",
                      "salud", "mineria", "transporte", "otra"]
    role: Literal["dueno", "gerente_general", "rrhh", "finanzas", "legal_interno", "otro"]
    company: str | None = Field(default=None, min_length=2, max_length=120)
    city: str | None = Field(default=None, min_length=2, max_length=80)

    @field_validator("company")
    @classmethod
    def _valida_empresa(cls, v: str | None) -> str | None:
        return None if v is None else _texto_corto(v, 2, 120)

    @field_validator("city")
    @classmethod
    def _valida_ciudad(cls, v: str | None) -> str | None:
        return None if v is None else _texto_corto(v, 2, 80)


class PreferencesIn(_StrictModel):
    """Cuerpo de PATCH /users/me/preferences (§7.4)."""
    lang: Literal["es", "en", "pt", "fr"] | None = None
    country: CountryCode | None = None
    theme: Literal["light", "dark"] | None = None
    email_notifications: bool | None = None
    sms_alerts: bool | None = None


class TermsAcceptanceIn(_StrictModel):
    """Cuerpo de POST /users/me/terms-acceptance (§7.5)."""
    version: str = Field(pattern=r"^\d{4}-\d{2}$")


class DeleteMeIn(_StrictModel):
    """Cuerpo de DELETE /users/me (§7.8)."""
    password: str = Field(min_length=8, max_length=128)
