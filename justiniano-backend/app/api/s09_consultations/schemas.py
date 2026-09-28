"""Esquemas de la sección 9 — Consultas (chat con agentes IA)."""
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")  # control chars salvo \n y \t


class ConsultationCreateIn(BaseModel):
    """Cuerpo de POST /consultations (§9.2)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    agent_id: str

    @field_validator("agent_id")
    @classmethod
    def _agent_id(cls, v: str) -> str:
        v = v.strip()
        if not (1 <= len(v) <= 20):
            raise ValueError("agent_id inválido")
        return v


class MessageCreateIn(BaseModel):
    """Cuerpo de POST /consultations/{id}/messages (§9.5)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    content: str
    attachment_ids: list[str] | None = None

    @field_validator("content")
    @classmethod
    def _content(cls, v: str) -> str:
        v = v.strip()
        if not (1 <= len(v) <= 8000):
            raise ValueError("content debe tener 1–8000 caracteres tras trim")
        if _CONTROL_RE.search(v):
            raise ValueError("content contiene caracteres de control no permitidos")
        return v

    @field_validator("attachment_ids")
    @classmethod
    def _attachments(cls, v: list[str] | None) -> list[str] | None:
        if v is not None and len(v) > 5:
            raise ValueError("máximo 5 adjuntos por mensaje")
        return v


class ConsultationExportIn(BaseModel):
    """Cuerpo de POST /consultations/{id}/export (§9.6)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    format: Literal["pdf"]
