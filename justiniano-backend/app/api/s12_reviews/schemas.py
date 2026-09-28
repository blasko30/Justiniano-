"""Esquemas de la sección 12 — Revisiones por abogado (lado cliente)."""
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


class ReviewCreateIn(BaseModel):
    """Cuerpo de POST /reviews (§12.2)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    target_type: Literal["document", "message"]
    document_id: str | None = None
    message_id: str | None = None
    urgency: Literal["std", "fast"]
    assignment_mode: Literal["auto", "frequent", "pick"]
    lawyer_id: str | None = None
    notes: str | None = None

    @field_validator("notes")
    @classmethod
    def _notes(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if len(v) > 2000:
            raise ValueError("notes admite un máximo de 2.000 caracteres")
        if _CONTROL_RE.search(v):
            raise ValueError("notes contiene caracteres de control no permitidos")
        return v or None
