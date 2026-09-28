"""Esquemas Pydantic de §16 — Administración: gestión de planes."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

PlanStatus = Literal["all", "active", "retired", "inactive"]  # inactive = alias de retired

LIMIT_KEYS = {"documents_month", "support_hours", "agents",
              "questions_month", "seats", "history_months"}


def _check_limits(limits: dict, partial: bool) -> dict:
    """Valida objeto_limites (§16): 6 claves exactas, enteros ≥0 o -1, agents ≤ 8."""
    from app.core.errors import ApiError
    keys = set(limits.keys())
    if (not partial and keys != LIMIT_KEYS) or (partial and not keys <= LIMIT_KEYS):
        raise ApiError(422, "validation_error", "Límites inválidos.",
                       {"fields": [{"field": "limits",
                                    "issue": f"claves permitidas: {sorted(LIMIT_KEYS)}"}]})
    for k, v in limits.items():
        if not isinstance(v, int) or isinstance(v, bool) or (v < 0 and v != -1):
            raise ApiError(422, "validation_error", "Límite inválido (entero ≥ 0 o -1).",
                           {"fields": [{"field": f"limits.{k}", "issue": "entero ≥ 0 o -1"}]})
    if "agents" in limits and limits["agents"] > 8:
        raise ApiError(422, "validation_error", "Límite inválido.",
                       {"fields": [{"field": "limits.agents", "issue": "máximo 8"}]})
    return limits


class PlanCreateIn(BaseModel):
    """Cuerpo de POST /admin/plans (§16.2)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    name: str = Field(min_length=3, max_length=40)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    price_monthly_clp: int | None = Field(default=None, ge=0, le=10_000_000)
    price_annual_clp: int | None = Field(default=None, ge=0, le=100_000_000)
    corporate: bool = False
    limits: dict[str, int]

    @field_validator("limits")
    @classmethod
    def _limits_full(cls, v: dict) -> dict:
        return _check_limits(v, partial=False)


class PlanPatchIn(BaseModel):
    """Cuerpo de PATCH /admin/plans/{plan_id} (§16.3); límites parciales permitidos."""
    model_config = ConfigDict(strict=True, extra="forbid")

    name: str | None = Field(default=None, min_length=3, max_length=40)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    price_monthly_clp: int | None = Field(default=None, ge=0, le=10_000_000)
    price_annual_clp: int | None = Field(default=None, ge=0, le=100_000_000)
    active: bool | None = None
    limits: dict[str, int] | None = None

    @field_validator("limits")
    @classmethod
    def _limits_partial(cls, v: dict | None) -> dict | None:
        return None if v is None else _check_limits(v, partial=True)
