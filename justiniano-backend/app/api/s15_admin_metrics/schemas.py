"""Esquemas Pydantic de §15 — Administración: métricas y usuarios."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Period = Literal["month", "quarter", "year"]
Segment = Literal["all", "active", "inactive", "churned", "new"]


class ReminderIn(BaseModel):
    """Cuerpo de POST /admin/users/{user_id}/reminder (§15.3)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    template: Literal["reactivation"]


class AdminUserPatch(BaseModel):
    """Cuerpo de PATCH /admin/users/{user_id} (§15.4)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    plan_id: str | None = None
    credits_delta: int | None = Field(default=None, ge=-100, le=100)
    active: bool | None = None
    reason: str = Field(min_length=5, max_length=200)
