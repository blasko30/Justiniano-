"""Esquemas Pydantic v2 de §18 — Administración: ventas y vendedores.

Todos los modelos de entrada operan en modo estricto (§2.8): tipo incorrecto,
valor fuera de rango o campo no declarado → 422 validation_error.
"""
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.security import nfc

_EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
_PHONE_RE = re.compile(r"^\+[1-9]\d{7,14}$")
_CTRL_RE = re.compile(r"[\x00-\x1F]")


def clean_short(value: str, lo: int, hi: int) -> str:
    """texto_corto (§2.8): trim + NFC, sin caracteres de control, largo lo–hi."""
    v = nfc(value)
    if _CTRL_RE.search(v) or not (lo <= len(v) <= hi):
        raise ValueError(f"debe tener entre {lo} y {hi} caracteres sin caracteres de control")
    return v


def clean_long(value: str, hi: int) -> str:
    """texto_largo (§2.8): solo saltos de línea como control; largo ≤ hi."""
    v = nfc(value)
    if _CTRL_RE.sub("", v.replace("\n", "").replace("\r", "")) != v.replace("\n", "").replace("\r", "") \
            or len(v) > hi:
        raise ValueError(f"máximo {hi} caracteres; solo saltos de línea como control")
    return v


def clean_email(value: str) -> str:
    """email (§2.8): RFC 5322 básico, ≤254, minúsculas + NFC."""
    v = nfc(value).lower()
    if len(v) > 254 or not _EMAIL_RE.match(v):
        raise ValueError("correo electrónico inválido")
    return v


def clean_phone(value: str) -> str:
    """telefono (§2.8): E.164 (se toleran espacios de presentación)."""
    v = nfc(value).replace(" ", "")
    if not _PHONE_RE.match(v):
        raise ValueError("teléfono inválido (E.164)")
    return v


class SellerCreateIn(BaseModel):
    """Cuerpo de POST /admin/sellers (§18.4)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    name: str
    email: str
    phone: str | None = None
    target_monthly_clp: int = Field(gt=0, le=1_000_000_000)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return clean_short(v, 2, 80)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return clean_email(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return None if v is None else clean_phone(v)


class SellerPatchIn(BaseModel):
    """Cuerpo de PATCH /admin/sellers/{seller_id} (§18.5)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    name: str | None = None
    phone: str | None = None
    target_monthly_clp: int | None = Field(default=None, gt=0, le=1_000_000_000)
    active: bool | None = None
    transfer_clients_to: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return None if v is None else clean_short(v, 2, 80)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return None if v is None else clean_phone(v)


class ClientAdminPatchIn(BaseModel):
    """Cuerpo de PATCH /admin/clients/{client_id} (§18.6)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    seller_id: str | None = None
    company: str | None = None
    contact: str | None = None
    city: str | None = None
    note: str | None = None

    @field_validator("company")
    @classmethod
    def _company(cls, v: str | None) -> str | None:
        return None if v is None else clean_short(v, 2, 120)

    @field_validator("contact")
    @classmethod
    def _contact(cls, v: str | None) -> str | None:
        return None if v is None else clean_short(v, 2, 80)

    @field_validator("city")
    @classmethod
    def _city(cls, v: str | None) -> str | None:
        return None if v is None else clean_short(v, 1, 80)

    @field_validator("note")
    @classmethod
    def _note(cls, v: str | None) -> str | None:
        return None if v is None else clean_long(v, 1_000)
