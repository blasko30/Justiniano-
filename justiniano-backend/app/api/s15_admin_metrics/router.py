"""§15 — Administración: métricas del dashboard y gestión de usuarios (rol admin)."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.database import get_db
from app.core.deps import require_admin
from app.core.errors import ApiError, not_found
from app.core.pagination import PageParams, page_response
from app.core.security import check_id, new_id, utcnow
from app.integrations.notify import notifier
from app.models import (AuditEvent, Client, Consultation, CreditTransaction, Document, Plan,
                        PlanVersion, Review, Seller, Subscription, User)

from .schemas import AdminUserPatch, Period, ReminderIn, Segment

router = APIRouter(tags=["§15 Admin · métricas y usuarios"])

_PERIOD_DAYS = {"month": 30, "quarter": 90, "year": 365}


def _period_start(period: str) -> datetime:
    return utcnow() - timedelta(days=_PERIOD_DAYS[period])


def _pct_delta(current: int, previous: int) -> int:
    if previous <= 0:
        return 100 if current else 0
    return round((current - previous) * 100 / previous)


async def _count(db: AsyncSession, stmt) -> int:
    return (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()


# ── 15.1 Resumen del dashboard ───────────────────────────────────────────
@router.get("/admin/metrics/overview")
async def metrics_overview(period: Period = Query("month"),
                           admin: User = Depends(require_admin),
                           db: AsyncSession = Depends(get_db)):
    """KPIs, series de gráficos e indicadores operativos en una sola llamada."""
    now, start = utcnow(), _period_start(period)
    prev_start = start - timedelta(days=_PERIOD_DAYS[period])
    clients = select(User).where(User.role == "client", User.deleted_at.is_(None))

    total = await _count(db, clients)
    prev_total = await _count(db, clients.where(User.created_at < start))
    active = await _count(db, clients.where(User.last_activity_at >= start))
    prev_active = await _count(db, clients.where(User.last_activity_at >= prev_start,
                                                 User.last_activity_at < start))
    inactive, prev_inactive = total - active, max(prev_total - prev_active, 0)

    # Churn: suscripciones canceladas cuyo período cae dentro del rango
    churned_q = select(Subscription).where(
        Subscription.status == "canceled",
        (Subscription.current_period_end.is_(None)) | (Subscription.current_period_end >= start))
    churned = (await db.execute(churned_q)).scalars().all()
    total_subs = await _count(db, select(Subscription))
    plan_rows = (await db.execute(select(Plan))).scalars().all()
    plans = {p.id: p for p in plan_rows}
    mrr_lost = sum((plans[s.plan_id].price_monthly_clp or 0)
                   for s in churned if s.plan_id in plans)
    churn_rate = round(len(churned) * 100 / total_subs, 1) if total_subs else 0.0

    new_users = await _count(db, clients.where(User.created_at >= start))
    prev_new = await _count(db, clients.where(User.created_at >= prev_start,
                                              User.created_at < start))
    direct_to_paid = await _count(db, select(User).join(
        Subscription, Subscription.user_id == User.id).where(
        User.role == "client", User.deleted_at.is_(None), User.created_at >= start,
        Subscription.status == "active"))

    # Serie: cuentas acumuladas por mes (últimos 8 meses)
    users_by_month = []
    for i in range(7, -1, -1):
        boundary = now - timedelta(days=30 * i)
        users_by_month.append(await _count(db, clients.where(User.created_at <= boundary)))

    # Serie: activos diarios de los últimos 7 días (audit_events → fallback actividad)
    daily_active = []
    for i in range(6, -1, -1):
        day_start = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        dau = (await db.execute(select(func.count(func.distinct(AuditEvent.user_id))).where(
            AuditEvent.created_at >= day_start, AuditEvent.created_at < day_end,
            AuditEvent.user_id.is_not(None)))).scalar_one()
        if dau == 0:
            dau = await _count(db, clients.where(User.last_activity_at >= day_start,
                                                 User.last_activity_at < day_end))
        daily_active.append(dau)

    by_plan_rows = (await db.execute(
        select(User.plan_id, func.count(User.id)).where(
            User.role == "client", User.deleted_at.is_(None), User.plan_id.is_not(None))
        .group_by(User.plan_id))).all()
    users_by_plan = [{"plan_id": pid, "name": plans[pid].name if pid in plans else pid,
                      "users": n} for pid, n in by_plan_rows]

    # Indicadores operativos
    reviews_queue = await _count(db, select(Review).where(Review.state < 4))
    delivered = select(Review).where(Review.state == 4, Review.delivered_at >= start)
    delivered_n = await _count(db, delivered)
    on_time = await _count(db, delivered.where(Review.late.is_(False)))
    sla_pct = round(on_time * 100 / delivered_n) if delivered_n else 100
    ai_consultations = await _count(db, select(Consultation).where(
        Consultation.created_at >= start))
    documents = await _count(db, select(Document).where(Document.created_at >= start))

    return {
        "period": period,
        "kpis": {
            "total_users": {"value": total, "delta_pct": _pct_delta(total, prev_total)},
            "active_users": {"value": active, "delta_pct": _pct_delta(active, prev_active),
                             "pct_of_total": round(active * 100 / total) if total else 0},
            "inactive_users": {"value": inactive,
                               "delta_pct": _pct_delta(inactive, prev_inactive)},
            "churn": {"rate_pct": churn_rate, "delta_pp": 0.0, "count": len(churned),
                      "mrr_lost_clp": mrr_lost},
            "new_clients": {"value": new_users, "delta_pct": _pct_delta(new_users, prev_new),
                            "direct_to_paid": direct_to_paid},
        },
        "series": {"users_by_month": users_by_month, "daily_active_7d": daily_active,
                   "users_by_plan": users_by_plan},
        "operational_summary": {"reviews_queue": reviews_queue, "sla_pct": sla_pct,
                                "ai_consultations": ai_consultations,
                                "documents_generated": documents, "open_tickets": 0},
    }


# ── 15.2 Detalle de usuarios por segmento ────────────────────────────────
async def _seller_by_user(db: AsyncSession, user_ids: list[str]) -> dict[str, str]:
    """Nombre del vendedor asignado por usuario vinculado (clients → sellers)."""
    if not user_ids:
        return {}
    rows = (await db.execute(
        select(Client.linked_user_id, User.name)
        .join(Seller, Seller.id == Client.seller_id)
        .join(User, User.id == Seller.user_id)
        .where(Client.linked_user_id.in_(user_ids)))).all()
    return {uid: name for uid, name in rows}


@router.get("/admin/metrics/users")
async def metrics_users(segment: Segment = Query(...), period: Period = Query("month"),
                        plan: str | None = Query(None), p: PageParams = Depends(),
                        admin: User = Depends(require_admin),
                        db: AsyncSession = Depends(get_db)):
    """Detalle paginado de los 5 KPIs con un único endpoint parametrizado."""
    now, start = utcnow(), _period_start(period)
    plans = {pl.id: pl for pl in (await db.execute(select(Plan))).scalars().all()}

    if segment == "churned":  # desde suscripciones canceladas
        base = select(Subscription, User).join(User, User.id == Subscription.user_id).where(
            Subscription.status == "canceled",
            (Subscription.current_period_end.is_(None))
            | (Subscription.current_period_end >= start))
        if plan is not None:
            base = base.where(Subscription.plan_id == plan)
        total = await _count(db, base)
        rows = (await db.execute(base.order_by(desc(Subscription.current_period_end))
                                 .offset(p.offset).limit(p.page_size))).all()
        items = []
        for sub, u in rows:
            pl = plans.get(sub.plan_id)
            when = sub.current_period_end or sub.created_at
            items.append({"user_id": u.id, "company": u.company, "plan": pl.name if pl else sub.plan_id,
                          "churned_at": when.strftime("%Y-%m-%d"), "reason": None,
                          "mrr_lost_clp": (pl.price_monthly_clp or 0) if pl else 0})
        out = page_response(items, total, p)
        out.update({"segment": segment, "summary": {"reasons": []}})
        return out

    base = select(User).where(User.role == "client", User.deleted_at.is_(None))
    if segment == "active":
        base = base.where(User.last_activity_at >= start)
    elif segment == "inactive":
        base = base.where((User.last_activity_at.is_(None)) | (User.last_activity_at < start))
    elif segment == "new":
        base = base.where(User.created_at >= start)
    if plan is not None:
        base = base.where(User.plan_id == plan)

    total = await _count(db, base)
    users = (await db.execute(base.order_by(desc(User.created_at))
                              .offset(p.offset).limit(p.page_size))).scalars().all()
    sellers = await _seller_by_user(db, [u.id for u in users]) \
        if segment in ("inactive", "new") else {}

    items = []
    for u in users:
        pl = plans.get(u.plan_id)
        item = {"user_id": u.id, "company": u.company, "plan": pl.name if pl else u.plan_id,
                "last_activity_at": u.last_activity_at}
        if segment == "inactive":
            ref = u.last_activity_at or u.created_at
            item["days_inactive"] = max((now - ref).days, 0)
            item["assigned_seller"] = sellers.get(u.id)
        elif segment == "new":
            item["signup_source"] = "seller" if u.id in sellers else "web"
            item["seller"] = sellers.get(u.id)
        else:
            item["status"] = "active" if (u.last_activity_at and u.last_activity_at >= start) \
                else "inactive"
        items.append(item)
    out = page_response(items, total, p)
    out["segment"] = segment
    return out


# ── 15.3 Enviar recordatorio de reactivación ─────────────────────────────
@router.post("/admin/users/{user_id}/reminder", status_code=202)
async def send_reminder(user_id: str, body: ReminderIn, request: Request,
                        admin: User = Depends(require_admin),
                        db: AsyncSession = Depends(get_db)):
    """Encola correo (y SMS si tiene alertas) de reactivación; cooldown 7 días."""
    check_id(user_id, "usr")
    user = await db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise not_found("Usuario inexistente.")
    recent = (await db.execute(select(AuditEvent.id).where(
        AuditEvent.event == "admin_reminder",
        AuditEvent.detail["user_id"].astext == user_id,
        AuditEvent.created_at >= utcnow() - timedelta(days=7)).limit(1))).first()
    if recent:
        raise ApiError(409, "recently_reminded",
                       "Ya se envió un recordatorio en los últimos 7 días.")

    channels = ["email"]
    notifier().send_email(user.email, "Te extrañamos en Justiniano",
                          f"Hola {user.name}: hace tiempo que no usas Justiniano. "
                          "Tus agentes legales siguen disponibles — vuelve cuando quieras.")
    if user.notif_sms and user.phone:
        notifier().send_sms(user.phone, "Justiniano: tus agentes legales te esperan.")
        channels.append("sms")
    await audit(db, admin.id, "admin_reminder",
                {"user_id": user_id, "template": body.template, "channels": channels},
                request.client.host if request.client else None)
    await db.commit()
    return {"queued": True, "channels": channels}


# ── 15.4 Gestionar cuenta de usuario ─────────────────────────────────────
@router.patch("/admin/users/{user_id}")
async def patch_user(user_id: str, body: AdminUserPatch, request: Request,
                     admin: User = Depends(require_admin),
                     db: AsyncSession = Depends(get_db)):
    """Migrar de plan, ajustar créditos o activar/desactivar; todo queda auditado."""
    check_id(user_id, "usr")
    user = (await db.execute(
        select(User).where(User.id == user_id).with_for_update())).scalar_one_or_none()
    if user is None:
        raise not_found("Usuario inexistente.")
    prev = {"plan_id": user.plan_id, "credits": user.credits,
            "active": user.deleted_at is None}
    changes: dict = {}

    if body.plan_id is not None:
        plan = await db.get(Plan, body.plan_id)
        if plan is None:
            raise ApiError(422, "validation_error", "Plan inexistente.",
                           {"fields": [{"field": "plan_id", "issue": "plan desconocido"}]})
        if not plan.active:
            raise ApiError(409, "plan_inactive",
                           "No se puede migrar a un plan marcado sin uso.")
        user.plan_id = plan.id
        sub = (await db.execute(select(Subscription).where(
            Subscription.user_id == user.id).with_for_update())).scalar_one_or_none()
        if sub is not None:
            pv = (await db.execute(select(PlanVersion).where(PlanVersion.plan_id == plan.id)
                                   .order_by(desc(PlanVersion.version))
                                   .limit(1))).scalar_one_or_none()
            sub.plan_id = plan.id
            sub.plan_version_id = pv.id if pv else None
        changes["plan_id"] = plan.id
    if body.credits_delta is not None and body.credits_delta != 0:
        user.credits += body.credits_delta
        db.add(CreditTransaction(id=new_id("ctx"), user_id=user.id, delta=body.credits_delta,
                                 reason="gift", reference_id=admin.id))
        changes["credits_delta"] = body.credits_delta
    if body.active is not None:
        user.deleted_at = None if body.active else utcnow()
        changes["active"] = body.active

    await audit(db, admin.id, "admin_user_update",
                {"user_id": user_id, "prev": prev, "changes": changes, "reason": body.reason},
                request.client.host if request.client else None)
    await db.commit()
    return {"updated": True,
            "user": {"id": user.id, "plan": user.plan_id, "credits": user.credits}}
