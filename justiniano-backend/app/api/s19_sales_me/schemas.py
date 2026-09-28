"""Esquemas Pydantic v2 de §19 — Portal del vendedor (CRM).

Incluye el objeto_proyeccion (§2.8) con sus reglas: stage enum, plan de pago,
monto 1–100.000.000, probabilidad 0–100, fecha futura ≤ 24 meses y nota ≤ 500.
"""
import re
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.security import nfc

_EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
_PHONE_RE = re.compile(r"^\+[1-9]\d{7,14}$")
_CTRL_RE = re.compile(r"[\x00-\x1F]")

Industry = Literal["construccion", "retail", "tecnologia", "servicios", "salud",
                   "mineria", "transporte", "otra"]
ClientStatus = Literal["client", "prospect"]
Stage = Literal["prospect", "demo", "proposal", "negotiation", "closing"]


def clean_short(value: str, lo: int, hi: int) -> str:
    """texto_corto (§2.8): trim + NFC, sin caracteres de control, largo lo–hi."""
    v = nfc(value)
    if _CTRL_RE.search(v) or not (lo <= len(v) <= hi):
        raise ValueError(f"debe tener entre {lo} y {hi} caracteres sin caracteres de control")
    return v


def clean_long(value: str, hi: int) -> str:
    """texto_largo (§2.8): texto plano, solo saltos de línea, largo ≤ hi."""
    v = nfc(value)
    if _CTRL_RE.search(v.replace("\n", "").replace("\r", "")) or len(v) > hi:
        raise ValueError(f"máximo {hi} caracteres; solo saltos de línea como control")
    return v


def clean_email(value: str) -> str:
    v = nfc(value).lower()
    if len(v) > 254 or not _EMAIL_RE.match(v):
        raise ValueError("correo electrónico inválido")
    return v


def clean_phone(value: str) -> str:
    v = nfc(value).replace(" ", "")
    if not _PHONE_RE.match(v):
        raise ValueError("teléfono inválido (E.164)")
    return v


class ProjectionIn(BaseModel):
    """objeto_proyeccion (§2.8): proyección de cierre de un cliente CRM."""
    model_config = ConfigDict(strict=True, extra="forbid")

    stage: Stage
    plan_id: str
    monthly_amount_clp: int = Field(ge=1, le=100_000_000)
    probability_pct: int = Field(ge=0, le=100)
    expected_close_date: str
    note: str | None = None

    @field_validator("expected_close_date")
    @classmethod
    def _fecha(cls, v: str) -> str:
        """fecha_iso ≥ hoy y ≤ hoy + 24 meses (§2.8)."""
        try:
            d = date.fromisoformat(v)
        except ValueError:
            raise ValueError("fecha ISO (YYYY-MM-DD) inválida")
        today = date.today()
        if not (today <= d <= today + timedelta(days=731)):
            raise ValueError("debe ser ≥ hoy y ≤ hoy + 24 meses")
        return v

    @field_validator("note")
    @classmethod
    def _note(cls, v: str | None) -> str | None:
        return None if v is None else clean_long(v, 500)


class ClientCreateIn(BaseModel):
    """Cuerpo de POST /sales/me/clients (§19.3)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    company: str
    contact: str
    email: str | None = None
    phone: str | None = None
    city: str | None = None
    industry: Industry | None = None
    status: ClientStatus
    note: str | None = None
    projection: ProjectionIn | None = None

    @field_validator("company")
    @classmethod
    def _company(cls, v: str) -> str:
        return clean_short(v, 2, 120)

    @field_validator("contact")
    @classmethod
    def _contact(cls, v: str) -> str:
        return clean_short(v, 2, 80)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return None if v is None else clean_email(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return None if v is None else clean_phone(v)

    @field_validator("city")
    @classmethod
    def _city(cls, v: str | None) -> str | None:
        return None if v is None else clean_short(v, 1, 80)

    @field_validator("note")
    @classmethod
    def _note(cls, v: str | None) -> str | None:
        return None if v is None else clean_long(v, 1_000)


class ClientPatchIn(BaseModel):
    """Cuerpo de PATCH /sales/me/clients/{client_id} (§19.4).

    projection admite tres estados: omitida (no se toca), null explícito
    (se retira del pipeline) u objeto (se crea/actualiza). El router los
    distingue con un sentinel a partir de model_fields_set.
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    company: str | None = None
    contact: str | None = None
    email: str | None = None
    phone: str | None = None
    city: str | None = None
    status: ClientStatus | None = None
    note: str | None = None
    projection: ProjectionIn | None = None

    @field_validator("company")
    @classmethod
    def _company(cls, v: str | None) -> str | None:
        return None if v is None else clean_short(v, 2, 120)

    @field_validator("contact")
    @classmethod
    def _contact(cls, v: str | None) -> str | None:
        return None if v is None else clean_short(v, 2, 80)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return None if v is None else clean_email(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return None if v is None else clean_phone(v)

    @field_validator("city")
    @classmethod
    def _city(cls, v: str | None) -> str | None:
        return None if v is None else clean_short(v, 1, 80)

    @field_validator("note")
    @classmethod
    def _note(cls, v: str | None) -> str | None:
        return None if v is None else clean_long(v, 1_000)
