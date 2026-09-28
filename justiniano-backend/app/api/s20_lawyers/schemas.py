"""Esquemas Pydantic del módulo §20 — Portal del abogado revisor.

Todos los modelos de entrada usan `strict=True, extra="forbid"` (§2.8).
"""
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Catálogo de especialidades (§20.2): laboral, contratos, tributario, civil,
# societario, propiedad intelectual, protección de datos, arriendos.
SPECIALTY_CATALOG: set[str] = {"lab", "con", "trib", "civ", "soc", "pi", "pd", "arr"}

_EMAIL_RE = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
_PHONE_RE = r"^\+[1-9]\d{7,14}$"  # E.164


class LawyerSignupIn(BaseModel):
    """Cuerpo de POST /auth/lawyer-signup (§20.1)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    name: str = Field(min_length=2, max_length=120)
    rut: str = Field(min_length=8, max_length=12)
    email: str = Field(max_length=254, pattern=_EMAIL_RE)
    phone: str | None = Field(default=None, pattern=_PHONE_RE)
    birth_date: date
    city: str | None = Field(default=None, max_length=80)
    password: str = Field(max_length=128)
    accepts_urgent: bool
    promoter: bool
    availability: Literal["lt_5h", "5_15h", "gt_15h"] | None = None
    terms_accepted: bool
    terms_version: str = Field(max_length=7)
    sworn_declaration: bool

    @field_validator("birth_date", mode="before")
    @classmethod
    def _parse_birth_date(cls, v):
        """Acepta la fecha ISO 8601 como texto (JSON) y exige fecha real."""
        if isinstance(v, str):
            return date.fromisoformat(v)
        return v


class LawyerPatchIn(BaseModel):
    """Cuerpo de PATCH /lawyers/me (§20.4). Actualización parcial."""
    model_config = ConfigDict(strict=True, extra="forbid")

    specialties: list[str] | None = Field(default=None, min_length=1, max_length=8)
    accepts_urgent: bool | None = None
    available: bool | None = None
    promoter: bool | None = None

    @field_validator("specialties")
    @classmethod
    def _specialties_in_catalog(cls, v):
        if v is not None:
            bad = [s for s in v if s not in SPECIALTY_CATALOG]
            if bad:
                raise ValueError(f"especialidades fuera del catálogo: {', '.join(bad)}")
        return v


class RejectIn(BaseModel):
    """Cuerpo de POST /lawyers/me/reviews/{id}/reject (§20.9)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    reason: Literal["conflict_of_interest", "out_of_specialty", "no_availability", "other"]
    detail: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _detail_required_if_other(self):
        if self.reason == "other" and not (self.detail and self.detail.strip()):
            raise ValueError("detail es obligatorio cuando reason=other")
        return self


class AnnotationCreateIn(BaseModel):
    """Cuerpo de POST /lawyers/me/reviews/{id}/annotations (§20.13)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    kind: Literal["comment", "change", "highlight"]
    paragraph_index: int = Field(ge=0)
    comment_text: str | None = Field(default=None, max_length=2000)
    original_text: str | None = None
    proposed_text: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def _required_by_kind(self):
        if self.kind == "comment" and not (self.comment_text and self.comment_text.strip()):
            raise ValueError("comment_text es obligatorio cuando kind=comment")
        if self.kind == "change":
            if not (self.original_text and self.original_text.strip()):
                raise ValueError("original_text es obligatorio cuando kind=change")
            if not (self.proposed_text and self.proposed_text.strip()):
                raise ValueError("proposed_text es obligatorio cuando kind=change")
        return self


class AnnotationPatchIn(BaseModel):
    """Cuerpo de PATCH .../annotations/{annotation_id} (§20.14).

    Actualización parcial; las validaciones cruzadas por kind se aplican en el
    router sobre el resultado combinado (valores nuevos + existentes).
    """
    model_config = ConfigDict(strict=True, extra="forbid")

    kind: Literal["comment", "change", "highlight"] | None = None
    paragraph_index: int | None = Field(default=None, ge=0)
    comment_text: str | None = Field(default=None, max_length=2000)
    original_text: str | None = None
    proposed_text: str | None = Field(default=None, max_length=4000)


class ChatMessageIn(BaseModel):
    """Cuerpo de POST /reviews/{id}/chat (§20.17)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    content: str = Field(min_length=1, max_length=2000)


class DraftIn(BaseModel):
    """Cuerpo de PATCH /lawyers/me/reviews/{id}/draft (§20.20)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    draft: str = Field(max_length=20000)


class DeliverIn(BaseModel):
    """Cuerpo de POST /lawyers/me/reviews/{id}/deliver (§20.21)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    final_observations: str = Field(min_length=10, max_length=4000)
    response_text: str | None = Field(default=None, max_length=20000)
    declaration: bool
