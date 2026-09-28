"""Esquemas de la sección 11 — Documentos."""
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, field_validator


class ReviewRequestIn(BaseModel):
    """Sub-objeto request_review de POST /documents (§11.2)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    enabled: bool
    urgency: Literal["std", "fast"] = "std"


class DocumentCreateIn(BaseModel):
    """Cuerpo de POST /documents (§11.2)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    format_id: str
    consultation_id: str | None = None
    fields: dict[str, Any]
    complete_later: bool = False
    sensitive_data_consent: bool = False
    request_review: ReviewRequestIn | None = None

    @field_validator("fields")
    @classmethod
    def _max_keys(cls, v: dict) -> dict:
        if len(v) > 200:
            raise ValueError("fields admite un máximo de 200 claves")
        return v


class DocumentFieldsPatchIn(BaseModel):
    """Cuerpo de PATCH /documents/{id}/fields (§11.4)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    fields: dict[str, Any]

    @field_validator("fields")
    @classmethod
    def _max_keys(cls, v: dict) -> dict:
        if len(v) > 200:
            raise ValueError("fields admite un máximo de 200 claves")
        return v


class DocumentDownloadIn(BaseModel):
    """Cuerpo de POST /documents/{id}/download (§11.5)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    format: Literal["docx", "pdf", "odt"]
    warning_acknowledged: bool
