"""Esquemas Pydantic de §13 — Planes, créditos y pagos (Stripe)."""
from typing import Literal

from pydantic import BaseModel, ConfigDict


class CheckoutIn(BaseModel):
    """Cuerpo de POST /billing/checkout (§13.4)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    plan_id: str
    billing_cycle: Literal["monthly", "annual"]


class CreditsCheckoutIn(BaseModel):
    """Cuerpo de POST /billing/credits/checkout (§13.5)."""
    model_config = ConfigDict(strict=True, extra="forbid")

    pack_id: str
