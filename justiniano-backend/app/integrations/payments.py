"""Stripe (§13): Checkout, Portal, Webhooks. Simulador local intercambiable."""
import time

from app.core.config import get_settings
from app.core.errors import ApiError


class _Stripe:  # pragma: no cover - requiere credenciales
    def __init__(self):
        import stripe
        stripe.api_key = get_settings().stripe_secret_key
        self._stripe = stripe

    def ensure_customer(self, user) -> str:
        if user.stripe_customer_id:
            return user.stripe_customer_id
        c = self._stripe.Customer.create(email=user.email, name=user.name, metadata={"user_id": user.id})
        return c.id

    def checkout_subscription(self, customer_id: str, price_id: str, user_id: str, plan_id: str, cycle: str) -> str:
        s = get_settings()
        session = self._stripe.checkout.Session.create(
            mode="subscription", customer=customer_id, line_items=[{"price": price_id, "quantity": 1}],
            success_url=s.stripe_success_url, cancel_url=s.stripe_cancel_url,
            metadata={"user_id": user_id, "plan_id": plan_id, "billing_cycle": cycle})
        return session.url

    def checkout_credits(self, customer_id: str, user_id: str, pack_id: str, amount_clp: int, name: str) -> str:
        s = get_settings()
        session = self._stripe.checkout.Session.create(
            mode="payment", customer=customer_id,
            line_items=[{"price_data": {"currency": "clp", "unit_amount": amount_clp,
                                        "product_data": {"name": name}}, "quantity": 1}],
            success_url=s.stripe_success_url, cancel_url=s.stripe_cancel_url,
            metadata={"user_id": user_id, "credit_pack": pack_id})
        return session.url

    def portal(self, customer_id: str) -> str:
        return self._stripe.billing_portal.Session.create(
            customer=customer_id, return_url=get_settings().stripe_success_url).url

    def payment_method(self, customer_id: str) -> dict | None:
        pms = self._stripe.PaymentMethod.list(customer=customer_id, type="card", limit=1)
        if not pms.data:
            return None
        card = pms.data[0].card
        return {"brand": card.brand, "last4": card.last4, "exp_month": card.exp_month, "exp_year": card.exp_year}

    def cancel_subscription(self, stripe_subscription_id: str) -> None:
        self._stripe.Subscription.modify(stripe_subscription_id, cancel_at_period_end=True)

    def verify_webhook(self, payload: bytes, signature: str) -> dict:
        try:
            return self._stripe.Webhook.construct_event(payload, signature, get_settings().stripe_webhook_secret)
        except Exception:
            raise ApiError(400, "invalid_signature", "Firma de webhook inválida.")


class _FakeStripe:
    """Simulador: URLs sintéticas y verificación de firma HMAC simple."""
    def ensure_customer(self, user) -> str:
        return user.stripe_customer_id or f"cus_fake_{user.id[-8:]}"

    def checkout_subscription(self, customer_id, price_id, user_id, plan_id, cycle) -> str:
        return f"https://checkout.stripe.local/subscribe/{plan_id}?cycle={cycle}&u={user_id}"

    def checkout_credits(self, customer_id, user_id, pack_id, amount_clp, name) -> str:
        return f"https://checkout.stripe.local/credits/{pack_id}?u={user_id}"

    def portal(self, customer_id) -> str:
        return f"https://billing.stripe.local/portal/{customer_id}"

    def payment_method(self, customer_id) -> dict | None:
        return {"brand": "visa", "last4": "4242", "exp_month": 12, "exp_year": 2028}

    def cancel_subscription(self, stripe_subscription_id) -> None:
        return None

    def verify_webhook(self, payload: bytes, signature: str) -> dict:
        import json
        if signature != "test-signature":
            raise ApiError(400, "invalid_signature", "Firma de webhook inválida.")
        return json.loads(payload)


_client = None


def stripe_client():
    global _client
    if _client is None:
        s = get_settings()
        _client = _FakeStripe() if (s.fake_integrations or not s.stripe_secret_key) else _Stripe()
    return _client
