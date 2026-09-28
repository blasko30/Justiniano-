"""§13 — Planes, créditos y pagos (Stripe): catálogo, checkout, portal y webhook."""
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ApiError
from app.core.pagination import PageParams, page_response
from app.core.security import new_id, utcnow
from app.integrations.notify import notifier
from app.integrations.payments import stripe_client
from app.models import CreditTransaction, Payment, Plan, PlanVersion, Subscription, User

from .schemas import CheckoutIn, CreditsCheckoutIn

router = APIRouter(tags=["§13 Planes, créditos y pagos"])

# Catálogo estático de packs de créditos (§4.1 / §13.2)
CREDIT_PACKS = [
    {"id": "pack_1", "credits": 1, "price_clp": 29900},
    {"id": "pack_5", "credits": 5, "price_clp": 129900},
    {"id": "pack_15", "credits": 15, "price_clp": 329900},
]


# ── 13.1 Listar planes (público) ─────────────────────────────────────────
@router.get("/plans")
async def list_plans(db: AsyncSession = Depends(get_db)):
    """Planes a la venta (active=true) con precios y límites; sin sesión."""
    rows = (await db.execute(
        select(Plan).where(Plan.active.is_(True))
        .order_by(Plan.price_monthly_clp.nulls_last(), Plan.created_at))).scalars().all()
    items = []
    for p in rows:
        item = {"id": p.id, "name": p.name, "color": p.color,
                "price_monthly_clp": p.price_monthly_clp, "price_annual_clp": p.price_annual_clp,
                "corporate": p.corporate, "limits": p.limits}
        if p.corporate:
            item["contact_sales"] = True
        items.append(item)
    return {"items": items}


# ── 13.2 Packs de créditos ───────────────────────────────────────────────
@router.get("/billing/credit-packs")
async def credit_packs(user: User = Depends(get_current_user)):
    """Packs de créditos de revisión comprables (catálogo estático §4.1)."""
    return {"items": CREDIT_PACKS}


# ── 13.3 Mi suscripción ──────────────────────────────────────────────────
@router.get("/billing/subscription")
async def my_subscription(user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    """Estado actual de la suscripción del usuario (Ajustes → Facturación)."""
    sub = (await db.execute(
        select(Subscription).where(Subscription.user_id == user.id))).scalar_one_or_none()
    if sub is None:  # sin suscripción = plan Gratuito (§4)
        return {"plan": user.plan_id or "p_free", "billing_cycle": user.billing_cycle,
                "status": "active", "current_period_end": None, "cancel_at_period_end": False}
    return {"plan": sub.plan_id, "billing_cycle": sub.billing_cycle, "status": sub.status,
            "current_period_end": sub.current_period_end,
            "cancel_at_period_end": sub.cancel_at_period_end}


# ── 13.4 Checkout de plan ────────────────────────────────────────────────
@router.post("/billing/checkout")
async def checkout_plan(body: CheckoutIn, user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    """Crea la Checkout Session de suscripción; el precio se resuelve server-side."""
    plan = await db.get(Plan, body.plan_id)
    if plan is None or not plan.active:
        raise ApiError(422, "validation_error", "Plan inexistente o retirado.",
                       {"fields": [{"field": "plan_id", "issue": "plan inválido"}]})
    if plan.corporate:
        raise ApiError(409, "corporate_requires_sales",
                       "El plan corporativo se contrata con el equipo comercial.")
    if (plan.price_monthly_clp or 0) == 0:
        raise ApiError(422, "validation_error", "El plan gratuito no se compra.",
                       {"fields": [{"field": "plan_id", "issue": "Free no se compra"}]})
    sub = (await db.execute(
        select(Subscription).where(Subscription.user_id == user.id))).scalar_one_or_none()
    if sub and sub.plan_id == plan.id and sub.status == "active":
        raise ApiError(409, "already_subscribed", "Ya tiene ese plan activo.")

    customer_id = stripe_client().ensure_customer(user)
    if user.stripe_customer_id != customer_id:
        user.stripe_customer_id = customer_id
    price_id = (plan.stripe_price_ids or {}).get(body.billing_cycle) \
        or f"price_{plan.id}_{body.billing_cycle}"
    url = stripe_client().checkout_subscription(customer_id, price_id, user.id,
                                                plan.id, body.billing_cycle)
    await db.commit()
    return {"checkout_url": url}


# ── 13.5 Checkout de créditos ────────────────────────────────────────────
@router.post("/billing/credits/checkout")
async def checkout_credits(body: CreditsCheckoutIn, user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    """Checkout Session en modo pago único para un pack del catálogo."""
    pack = next((p for p in CREDIT_PACKS if p["id"] == body.pack_id), None)
    if pack is None:
        raise ApiError(422, "validation_error", "Pack inexistente.",
                       {"fields": [{"field": "pack_id", "issue": "pack desconocido"}]})
    customer_id = stripe_client().ensure_customer(user)
    if user.stripe_customer_id != customer_id:
        user.stripe_customer_id = customer_id
    name = f"Pack de {pack['credits']} crédito(s) de revisión"
    url = stripe_client().checkout_credits(customer_id, user.id, pack["id"],
                                           pack["price_clp"], name)
    await db.commit()
    return {"checkout_url": url}


# ── 13.6 Portal de facturación ───────────────────────────────────────────
@router.post("/billing/portal")
async def billing_portal(user: User = Depends(get_current_user)):
    """URL del Stripe Billing Portal para gestionar medio de pago y ciclo."""
    if not user.stripe_customer_id:
        raise ApiError(409, "no_stripe_customer", "El usuario nunca ha iniciado un pago.")
    return {"portal_url": stripe_client().portal(user.stripe_customer_id)}


# ── 13.7 Historial de pagos ──────────────────────────────────────────────
@router.get("/billing/payments")
async def list_payments(p: PageParams = Depends(), user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    """Historial de pagos y facturas alimentado por los webhooks de Stripe."""
    base = select(Payment).where(Payment.user_id == user.id)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (await db.execute(base.order_by(desc(Payment.created_at))
                             .offset(p.offset).limit(p.page_size))).scalars().all()
    items = [{"id": r.id, "date": r.created_at, "description": r.description,
              "amount_clp": r.amount_clp, "status": r.status, "invoice_url": r.invoice_url}
             for r in rows]
    return page_response(items, total, p)


# ── 13.8 Medio de pago ───────────────────────────────────────────────────
@router.get("/billing/payment-method")
async def payment_method(user: User = Depends(get_current_user)):
    """Tarjeta por defecto del cliente en Stripe; null si no hay medio guardado."""
    if not user.stripe_customer_id:
        return None
    return stripe_client().payment_method(user.stripe_customer_id)


# ── 13.9 Webhook de Stripe ───────────────────────────────────────────────
async def _latest_plan_version(db: AsyncSession, plan: Plan) -> PlanVersion:
    """Versión vigente del plan; crea la v1 desde el plan si aún no existe."""
    pv = (await db.execute(
        select(PlanVersion).where(PlanVersion.plan_id == plan.id)
        .order_by(desc(PlanVersion.version)).limit(1))).scalar_one_or_none()
    if pv is None:
        pv = PlanVersion(id=new_id("pv"), plan_id=plan.id, version=1,
                         price_monthly_clp=plan.price_monthly_clp,
                         price_annual_clp=plan.price_annual_clp, limits=plan.limits)
        db.add(pv)
        await db.flush()
    return pv


async def _on_checkout_completed(db: AsyncSession, event_id: str, obj: dict) -> None:
    """Activa la suscripción (snapshot PlanVersion) o abona créditos del pack."""
    meta = obj.get("metadata") or {}
    user = (await db.execute(
        select(User).where(User.id == meta.get("user_id", "")).with_for_update()
    )).scalar_one_or_none()
    if user is None:
        return
    if obj.get("customer") and not user.stripe_customer_id:
        user.stripe_customer_id = obj["customer"]

    if meta.get("credit_pack"):  # compra de créditos (pago único)
        pack = next((p for p in CREDIT_PACKS if p["id"] == meta["credit_pack"]), None)
        if pack is None:
            return
        user.credits += pack["credits"]
        db.add(CreditTransaction(id=new_id("ctx"), user_id=user.id, delta=pack["credits"],
                                 reason="purchase", reference_id=pack["id"]))
        db.add(Payment(id=new_id("pay"), user_id=user.id, stripe_event_id=event_id,
                       description=f"Pack de {pack['credits']} crédito(s)",
                       amount_clp=pack["price_clp"], status="paid",
                       invoice_url=obj.get("invoice_url")))
        await audit(db, user.id, "credits_purchased",
                    {"pack_id": pack["id"], "credits": pack["credits"]})
        return

    plan = await db.get(Plan, meta.get("plan_id", ""))
    if plan is None:
        return
    cycle = meta.get("billing_cycle") or "monthly"
    pv = await _latest_plan_version(db, plan)
    period_end = utcnow() + timedelta(days=365 if cycle == "annual" else 30)
    sub = (await db.execute(
        select(Subscription).where(Subscription.user_id == user.id).with_for_update()
    )).scalar_one_or_none()
    if sub is None:
        sub = Subscription(id=new_id("sub"), user_id=user.id, plan_id=plan.id)
        db.add(sub)
    sub.plan_id, sub.plan_version_id, sub.billing_cycle = plan.id, pv.id, cycle
    sub.status, sub.cancel_at_period_end = "active", False
    sub.stripe_subscription_id = obj.get("subscription")
    sub.current_period_end = period_end

    prev_plan = user.plan_id
    user.plan_id, user.billing_cycle = plan.id, cycle
    if plan.name.strip().lower() == "pro" and prev_plan != plan.id:  # bienvenida (§4.1)
        user.credits += 2
        db.add(CreditTransaction(id=new_id("ctx"), user_id=user.id, delta=2,
                                 reason="plan_bonus", reference_id=plan.id))
    amount = (plan.price_annual_clp if cycle == "annual" else plan.price_monthly_clp) or 0
    db.add(Payment(id=new_id("pay"), user_id=user.id, stripe_event_id=event_id,
                   description=f"Plan {plan.name} · {'anual' if cycle == 'annual' else 'mensual'}",
                   amount_clp=amount, status="paid", invoice_url=obj.get("invoice_url")))
    await audit(db, user.id, "plan_activated",
                {"plan_id": plan.id, "cycle": cycle, "prev_plan_id": prev_plan})


async def _on_payment_failed(db: AsyncSession, event_id: str, obj: dict) -> None:
    """Marca la suscripción past_due, registra el pago fallido y notifica."""
    sub, user = None, None
    if obj.get("subscription"):
        sub = (await db.execute(select(Subscription).where(
            Subscription.stripe_subscription_id == obj["subscription"]))).scalar_one_or_none()
    if sub is not None:
        user = await db.get(User, sub.user_id)
    elif obj.get("customer"):
        user = (await db.execute(select(User).where(
            User.stripe_customer_id == obj["customer"]))).scalar_one_or_none()
    if user is None:
        return
    if sub is None:
        sub = (await db.execute(
            select(Subscription).where(Subscription.user_id == user.id))).scalar_one_or_none()
    if sub is not None:
        sub.status = "past_due"
    db.add(Payment(id=new_id("pay"), user_id=user.id, stripe_event_id=event_id,
                   description="Pago de suscripción fallido",
                   amount_clp=int(obj.get("amount_due") or 0), status="failed",
                   invoice_url=obj.get("invoice_url")))
    notifier().send_email(user.email, "Problema con tu pago en Justiniano",
                          "No pudimos procesar el pago de tu suscripción. "
                          "Actualiza tu medio de pago desde Ajustes → Facturación.")
    await audit(db, user.id, "payment_failed", {"subscription_id": sub.id if sub else None})


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Receptor de eventos de Stripe: firma verificada e idempotente por event.id."""
    payload = await request.body()  # cuerpo crudo, sin parsear antes de verificar
    signature = request.headers.get("Stripe-Signature", "")
    event = stripe_client().verify_webhook(payload, signature)  # 400 invalid_signature
    event_id = event.get("id") or new_id("evt")

    dup = (await db.execute(
        select(Payment.id).where(Payment.stripe_event_id == event_id))).first()
    if dup:  # ya procesado — idempotencia por índice único de stripe_event_id
        return {"received": True}

    etype = event.get("type")
    obj = (event.get("data") or {}).get("object") or {}
    if etype == "checkout.session.completed":
        await _on_checkout_completed(db, event_id, obj)
    elif etype == "invoice.payment_failed":
        await _on_payment_failed(db, event_id, obj)
    # otros tipos: se registran y descartan (§13.9)
    await db.commit()
    return {"received": True}
