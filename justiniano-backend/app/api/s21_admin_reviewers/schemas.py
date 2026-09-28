"""Esquemas Pydantic v2 de §21 — Administración: abogados revisores y tarifario."""
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.security import nfc

_CTRL_RE = re.compile(r"[\x00-\x1F]")

ReassignReason = Literal["overload", "not_accepted", "conflict_of_interest",
                         "client_request", "lawyer_suspended", "other"]


def clean_long(value: str, lo: int, hi: int) -> str:
    """texto_largo (§2.8): texto plano, solo saltos de línea, largo lo–hi."""
    v = nfc(value)
    if _CTRL_RE.search(v.replace("\n", "").replace("\r", "")) or not (lo <= len(v) <= hi):
        raise ValueError(f"debe tener entre {lo} y {hi} caracteres")
    return v


class VerificationPatchIn(BaseModel):
    """Cuerpo de PATCH /admin/lawyers/{id}/verification (§21.2)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    status: Literal["verified", "rejected"]
    rejection_reason: str | None = None
    approved_specialties: list[str] | None = None

    @field_validator("rejection_reason")
    @classmethod
    def _reason(cls, v: str | None) -> str | None:
        return None if v is None else clean_long(v, 1, 500)

    @model_validator(mode="after")
    def _cond(self):
        if self.status == "rejected" and not self.rejection_reason:
            raise ValueError("rejection_reason es obligatorio si status=rejected")
        return self


class RatesPutIn(BaseModel):
    """Cuerpo de PUT /admin/lawyer-rates (§21.4)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    review_std_clp: int = Field(ge=1_000, le=1_000_000)
    review_urgent_clp: int = Field(ge=1_000, le=1_000_000)
    consultation_std_clp: int = Field(ge=1_000, le=1_000_000)
    consultation_urgent_clp: int = Field(ge=1_000, le=1_000_000)
    sla_bonus_pct: int = Field(ge=0, le=50)
    effective_from: str

    @model_validator(mode="after")
    def _urgente_ge_normal(self):
        if self.review_urgent_clp < self.review_std_clp:
            raise ValueError("review_urgent_clp debe ser ≥ review_std_clp")
        if self.consultation_urgent_clp < self.consultation_std_clp:
            raise ValueError("consultation_urgent_clp debe ser ≥ consultation_std_clp")
        return self


class AssignIn(BaseModel):
    """Cuerpo de POST /admin/reviews/{id}/assign (§21.7)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    lawyer_id: str


class ReassignIn(BaseModel):
    """Cuerpo de PATCH /admin/reviews/{id}/assignment (§21.8).

    lawyer_id es obligatorio pero admite null explícito (devolver a la bolsa).
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    lawyer_id: str | None
    reason: ReassignReason
    detail: str | None = None

    @field_validator("detail")
    @classmethod
    def _detail(cls, v: str | None) -> str | None:
        return None if v is None else clean_long(v, 1, 500)

    @model_validator(mode="after")
    def _cond(self):
        if self.reason == "other" and not self.detail:
            raise ValueError("detail es obligatorio si reason=other")
        return self


class LawyerPatchIn(BaseModel):
    """Cuerpo de PATCH /admin/lawyers/{id} (§21.10)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    approved_specialties: list[str] | None = Field(default=None, min_length=1, max_length=8)
    max_concurrent_cases: int | None = Field(default=None, ge=1, le=20)
    paused: bool | None = None

    @field_validator("approved_specialties")
    @classmethod
    def _specs(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        cleaned = [nfc(s) for s in v]
        if any(not s or len(s) > 10 for s in cleaned) or len(set(cleaned)) != len(cleaned):
            raise ValueError("áreas inválidas o repetidas")
        return cleaned


class SuspendIn(BaseModel):
    """Cuerpo de POST /admin/lawyers/{id}/suspend (§21.11)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    reason: str

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        return clean_long(v, 10, 500)
