"""§17 — Administración: panel de operación (salud técnica + operación legal)."""
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import require_admin
from app.core.security import utcnow
from app.models import (AuditEvent, Consultation, Document, Lawyer, Plan, Review,
                        ServiceIncident, User)

from .schemas import Period

router = APIRouter(tags=["§17 Admin · operación"])

_PERIOD_DAYS = {"month": 30, "quarter": 90, "year": 365}

# Servicios de la plataforma con métricas base simuladas (los health checks
# reales se agregan desde Application Insights; aquí solo la vista de consola).
_SERVICES = [
    {"name": "api", "label": "API Backend (FastAPI)", "uptime_30d_pct": 99.97,
     "avg_latency_ms": 182},
    {"name": "db", "label": "Base de datos (PostgreSQL)", "uptime_30d_pct": 99.99,
     "avg_latency_ms": 12},
    {"name": "blob", "label": "Almacenamiento (Azure Blob)", "uptime_30d_pct": 99.95,
     "avg_latency_ms": 96},
    {"name": "ai", "label": "Motor IA (Azure OpenAI)", "uptime_30d_pct": 99.82,
     "avg_latency_ms": 2400},
    {"name": "otp", "label": "Email / SMS (OTP)", "uptime_30d_pct": 99.90,
     "avg_latency_ms": None},
    {"name": "payments", "label": "Pagos (Stripe)", "uptime_30d_pct": 99.99,
     "avg_latency_ms": 310},
]


def _fmt_window(incident: ServiceIncident) -> str:
    start = incident.started_at.strftime("%H:%M")
    end = incident.resolved_at.strftime("%H:%M") if incident.resolved_at else "en curso"
    return f"{incident.summary} · {start}–{end}"


async def _count(db: AsyncSession, stmt) -> int:
    return (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()


# ── 17.1 Panel de operación ──────────────────────────────────────────────
@router.get("/admin/operations")
async def operations_panel(period: Period = Query("month"),
                           admin: User = Depends(require_admin),
                           db: AsyncSession = Depends(get_db)):
    """Estado de servicios + cola/SLA de revisiones, horas de apoyo y volúmenes."""
    now = utcnow()
    start = now - timedelta(days=_PERIOD_DAYS[period])

    # ── Plataforma: uptime simulado + incidentes reales (service_incidents) ──
    incidents = (await db.execute(
        select(ServiceIncident).where(ServiceIncident.started_at >= now - timedelta(days=30))
        .order_by(desc(ServiceIncident.started_at)))).scalars().all()
    latest_by_service: dict[str, ServiceIncident] = {}
    for inc in incidents:
        latest_by_service.setdefault(inc.service, inc)
    services = []
    for svc in _SERVICES:
        inc = latest_by_service.get(svc["name"])
        degraded = inc is not None and inc.resolved_at is None
        services.append({"name": svc["name"], "label": svc["label"],
                         "status": "degraded" if degraded else "ok",
                         "uptime_30d_pct": svc["uptime_30d_pct"],
                         "avg_latency_ms": svc["avg_latency_ms"],
                         "note": _fmt_window(inc) if inc else None})
    last = incidents[0] if incidents else None
    platform = {
        "status": "degraded" if any(s["status"] != "ok" for s in services) else "operational",
        "services": services,
        "last_incident": {"at": last.started_at, "summary": last.summary,
                          "resolved_at": last.resolved_at} if last else None,
    }

    # ── Operación legal: cola, SLA 90 días y capacidad ───────────────────
    queue = await _count(db, select(Review).where(Review.state < 4))
    sla_window = now - timedelta(days=90)
    delivered = select(Review).where(Review.state == 4, Review.delivered_at >= sla_window)
    delivered_n = await _count(db, delivered)
    on_time = await _count(db, delivered.where(Review.late.is_(False)))
    sla_pct = round(on_time * 100 / delivered_n) if delivered_n else 100
    avg_secs = (await db.execute(select(func.avg(
        func.extract("epoch", Review.delivered_at) - func.extract("epoch", Review.created_at)
    )).where(Review.state == 4, Review.delivered_at >= start))).scalar_one()
    avg_turnaround = round(float(avg_secs) / 3600) if avg_secs else 0

    lawyers_q = select(Lawyer).where(Lawyer.active.is_(True), Lawyer.paused.is_(False),
                                     Lawyer.suspended_at.is_(None),
                                     Lawyer.verification_status == "verified")
    active_lawyers = await _count(db, lawyers_q)
    capacity = (await db.execute(select(func.coalesce(func.sum(
        Lawyer.max_concurrent_cases), 0)).where(
        Lawyer.active.is_(True), Lawyer.paused.is_(False), Lawyer.suspended_at.is_(None),
        Lawyer.verification_status == "verified"))).scalar_one()
    in_progress = await _count(db, select(Review).where(Review.state.in_((2, 3))))
    capacity_used = round(in_progress * 100 / capacity) if capacity else 0

    # ── Horas de apoyo por plan (contratadas según límites; uso simulado) ──
    plans = (await db.execute(select(Plan))).scalars().all()
    counts = {pid: n for pid, n in (await db.execute(
        select(User.plan_id, func.count(User.id)).where(
            User.deleted_at.is_(None), User.plan_id.is_not(None))
        .group_by(User.plan_id))).all()}
    by_plan, used_total, contracted_total = [], 0, 0
    for pl in plans:
        n_users = counts.get(pl.id, 0)
        included = int((pl.limits or {}).get("support_hours", 0) or 0)
        contracted = n_users * included if included > 0 else 0
        used = round(contracted * 0.72)  # consumo simulado (sin registro horario propio)
        if n_users:
            by_plan.append({"plan": pl.name, "used": used, "included_per_account": included})
        used_total += used
        contracted_total += contracted

    # ── Soporte y volúmenes del período ──────────────────────────────────
    ai_consultations = await _count(db, select(Consultation).where(
        Consultation.created_at >= start))
    documents = await _count(db, select(Document).where(Document.created_at >= start))
    downloads = await _count(db, select(AuditEvent).where(
        AuditEvent.created_at >= start,
        AuditEvent.event.in_(("doc_download", "document_download", "download_warning"))))

    return {
        "platform": platform,
        "legal_ops": {
            "reviews": {"queue": queue, "sla_pct": sla_pct,
                        "avg_turnaround_hours": avg_turnaround,
                        "active_lawyers": active_lawyers,
                        "capacity_used_pct": capacity_used},
            "support_hours": {"used": used_total, "contracted": contracted_total,
                              "by_plan": by_plan},
            "tickets": {"open": 0, "resolved": 0, "first_response_hours": None},
            "volume": {"ai_consultations": ai_consultations,
                       "documents_generated": documents, "downloads": downloads},
        },
    }
