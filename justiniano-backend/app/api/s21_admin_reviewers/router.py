"""§21 — Administración: abogados revisores y tarifario (consola, rol admin).

Acreditaciones (21.1–21.2), tarifario versionado (21.3–21.4) y supervisión
operativa v2.3 (21.5–21.11): KPIs, bolsa, asignación/reasignación manual,
ficha, gestión y suspensión del revisor. Toda acción queda en auditoría con
actor, IP y valores previos (§2.9).
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import require_admin
from app.core.errors import ApiError, not_found
from app.core.hours import business_hours_between
from app.core.pagination import PageParams, page_response
from app.core.security import check_id, new_id, utcnow
from app.integrations.blob import blob_client
from app.integrations.notify import notifier
from app.models import (Consultation, Document, DocumentArea, Lawyer, LawyerFeeEntry,
                        LawyerFeeRate, Message, Plan, RefreshToken, Review,
                        ReviewStateHistory, Seller, User)

from app.api.s21_admin_reviewers.schemas import (AssignIn, LawyerPatchIn, RatesPutIn,
                                                 ReassignIn, SuspendIn, VerificationPatchIn)

router = APIRouter(tags=["§21 Admin revisores"])

_LAWYER_STATUSES = {"available", "paused", "at_capacity", "suspended"}
_REVIEW_STATUSES = {"pending_assignment": 1, "pending_acceptance": 2,
                    "in_progress": 3, "delivered": 4}


# ── Utilidades del módulo ────────────────────────────────────────────────
def _iso(dt) -> str | None:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


async def _loads(db: AsyncSession, lawyer_ids: list[str] | None = None) -> dict[str, list[int]]:
    """Carga operativa por abogado: [casos activos (estados 2–3), urgentes]."""
    stmt = select(Review.lawyer_id, Review.urgency).where(Review.state.in_((2, 3)),
                                                          Review.lawyer_id.is_not(None))
    if lawyer_ids is not None:
        stmt = stmt.where(Review.lawyer_id.in_(lawyer_ids))
    loads: dict[str, list[int]] = {}
    for lawyer_id, urgency in (await db.execute(stmt)).all():
        entry = loads.setdefault(lawyer_id, [0, 0])
        entry[0] += 1
        entry[1] += 1 if urgency == "fast" else 0
    return loads


async def _delivered_stats(db: AsyncSession) -> dict[str, list[int]]:
    """Entregas históricas por abogado: [entregadas, dentro de plazo]."""
    stats: dict[str, list[int]] = {}
    rows = (await db.execute(select(Review.lawyer_id, Review.late)
                             .where(Review.state == 4, Review.lawyer_id.is_not(None)))).all()
    for lawyer_id, late in rows:
        entry = stats.setdefault(lawyer_id, [0, 0])
        entry[0] += 1
        entry[1] += 0 if late else 1
    return stats


def _lawyer_status(lawyer: Lawyer, active_cases: int) -> str:
    """Estado operativo de la tabla «Carga por revisor» (corrección v2.3)."""
    if lawyer.suspended_at is not None:
        return "suspended"
    if lawyer.paused or not lawyer.available:
        return "paused"
    if active_cases >= lawyer.max_concurrent_cases:
        return "at_capacity"
    return "available"


def _documents(lawyer: Lawyer) -> list[dict]:
    """SAS de lectura (15 min) sobre los documentos de acreditación."""
    ttl, out = get_settings().sas_ttl_seconds, []
    for kind, blob_path in (("id_document", lawyer.id_document_blob),
                            ("degree_certificate", lawyer.degree_certificate_blob)):
        if blob_path:
            out.append({"kind": kind, "sas_url": blob_client().sas_url(blob_path),
                        "expires_in": ttl})
    return out


async def _review_meta(db: AsyncSession, reviews: list[Review]):
    """Título, empresa y plan del cliente para ítems de revisión (solo metadatos)."""
    user_ids = {r.user_id for r in reviews}
    doc_ids = {r.document_id for r in reviews if r.document_id}
    msg_ids = {r.message_id for r in reviews if r.message_id}
    users = {u.id: u for u in (await db.execute(
        select(User).where(User.id.in_(user_ids)))).scalars()} if user_ids else {}
    docs = dict((await db.execute(
        select(Document.id, Document.name).where(Document.id.in_(doc_ids)))).all()) if doc_ids else {}
    consult_titles = dict((await db.execute(
        select(Message.id, Consultation.title)
        .join(Consultation, Consultation.id == Message.consultation_id)
        .where(Message.id.in_(msg_ids)))).all()) if msg_ids else {}
    plans = {p.id: p.name for p in (await db.execute(select(Plan))).scalars()}

    def title(r: Review) -> str:
        if r.document_id:
            return docs.get(r.document_id, "Documento")
        return consult_titles.get(r.message_id, "Consulta")

    def client(r: Review) -> dict:
        u = users.get(r.user_id)
        if u is None:
            return {"company": None, "plan": None}
        return {"company": u.company or u.name, "plan": plans.get(u.plan_id, "Gratuito")}

    return title, client


def _check_assignable(lawyer: Lawyer, review: Review) -> None:
    """Bloqueos del modal de asignación (§21.7): verificado, activo, disponible."""
    if lawyer.verification_status != "verified":
        raise ApiError(409, "lawyer_not_verified", "El revisor no tiene la acreditación aprobada.")
    if lawyer.suspended_at is not None:
        raise ApiError(409, "lawyer_suspended", "El revisor está suspendido.")
    if lawyer.paused or not lawyer.available or not lawyer.active:
        raise ApiError(409, "lawyer_paused", "El revisor está en pausa o no disponible.")
    if review.urgency == "fast" and not lawyer.accepts_urgent:
        raise ApiError(409, "urgent_disabled", "El caso es urgente y el revisor no acepta urgentes.")


async def _notify_user(db: AsyncSession, user_id: str | None, subject: str, body: str) -> None:
    if user_id is None:
        return
    user = await db.get(User, user_id)
    if user is not None and user.email:
        notifier().send_email(user.email, subject, body)


# ── 21.1 Listar abogados y acreditaciones ────────────────────────────────
@router.get("/admin/lawyers")
async def list_lawyers(verification_status: str | None = Query(None),
                       status: str | None = Query(None), q: str | None = Query(None),
                       p: PageParams = Depends(),
                       admin: User = Depends(require_admin),
                       db: AsyncSession = Depends(get_db)):
    """Cola de validación y tabla «Carga por revisor» (corrección v2.3)."""
    if verification_status is not None and verification_status not in ("pending", "verified", "rejected"):
        raise ApiError(422, "validation_error", "verification_status desconocido.",
                       {"fields": [{"field": "verification_status", "issue": "pending | verified | rejected"}]})
    if status is not None and status not in _LAWYER_STATUSES:
        raise ApiError(422, "validation_error", "status desconocido.",
                       {"fields": [{"field": "status", "issue": "available | paused | at_capacity | suspended"}]})

    stmt = select(Lawyer, User.email).join(User, User.id == Lawyer.user_id)
    if verification_status is not None:
        stmt = stmt.where(Lawyer.verification_status == verification_status)
    if q:
        needle, rut_needle = f"%{q.strip()}%", f"%{q.strip().replace('.', '')}%"
        stmt = stmt.where(Lawyer.name.ilike(needle) | Lawyer.rut.ilike(rut_needle)
                          | User.email.ilike(needle))
    rows = (await db.execute(stmt.order_by(Lawyer.created_at))).all()

    loads = await _loads(db)
    delivered = await _delivered_stats(db)
    if status is not None:
        rows = [r for r in rows if _lawyer_status(r[0], loads.get(r[0].id, [0, 0])[0]) == status]

    total = len(rows)
    items = []
    for lawyer, email in rows[p.offset:p.offset + p.page_size]:
        active_cases, urgent = loads.get(lawyer.id, [0, 0])
        done, on_time = delivered.get(lawyer.id, [0, 0])
        items.append({
            "id": lawyer.id, "name": lawyer.name, "rut": lawyer.rut, "email": email,
            "birth_date": lawyer.birth_date.isoformat() if lawyer.birth_date else None,
            "university": lawyer.university, "degree_year": lawyer.degree_year,
            "specialties": lawyer.specialties or [],
            "specialties_pending": lawyer.specialties_pending or [],
            "verification_status": lawyer.verification_status,
            "submitted_at": _iso(lawyer.created_at),
            "documents": _documents(lawyer),
            "active_cases": active_cases, "urgent_in_progress": urgent,
            "max_concurrent_cases": lawyer.max_concurrent_cases,
            "paused": lawyer.paused, "available": lawyer.available,
            "suspended_at": _iso(lawyer.suspended_at),
            "stats": {"delivered_total": done,
                      "sla_compliance_pct": round(on_time * 100 / done) if done else None,
                      "rating": lawyer.rating},
        })
    return page_response(items, total, p)


# ── 21.2 Aprobar o rechazar acreditación ─────────────────────────────────
@router.patch("/admin/lawyers/{lawyer_id}/verification")
async def patch_verification(lawyer_id: str, body: VerificationPatchIn, request: Request,
                             admin: User = Depends(require_admin),
                             db: AsyncSession = Depends(get_db)):
    """Resuelve la acreditación pendiente; verified habilita asignaciones y,
    si promoter=true, crea el perfil comercial (Seller)."""
    check_id(lawyer_id, "law")
    lawyer = await db.get(Lawyer, lawyer_id)
    if lawyer is None:
        raise not_found("Revisor no encontrado.")
    if lawyer.verification_status != "pending":
        raise ApiError(409, "no_pending_submission", "No hay acreditación pendiente de resolver.")

    declared = list(dict.fromkeys((lawyer.specialties or []) + (lawyer.specialties_pending or [])))
    approved = body.approved_specialties if body.approved_specialties is not None else declared
    if not set(approved).issubset(declared):
        raise ApiError(422, "validation_error",
                       "approved_specialties debe ser subconjunto de las declaradas.",
                       {"fields": [{"field": "approved_specialties", "issue": "no declaradas"}]})

    user = await db.get(User, lawyer.user_id)
    now = utcnow()
    if body.status == "verified":
        lawyer.verification_status = "verified"
        lawyer.verified_at, lawyer.verified_by = now, admin.id
        lawyer.rejection_reason = None
        lawyer.specialties, lawyer.specialties_pending = approved, []
        if lawyer.promoter:  # habilita el perfil comercial (§21.2)
            seller = (await db.execute(
                select(Seller).where(Seller.user_id == lawyer.user_id))).scalar_one_or_none()
            if seller is None:
                db.add(Seller(id=new_id("sel"), user_id=lawyer.user_id, active=True))
        if user:
            notifier().send_email(user.email, "Acreditación aprobada — Justiniano",
                                  "Su acreditación fue aprobada: ya puede recibir asignaciones "
                                  "y tomar labores de la bolsa.")
    else:
        lawyer.verification_status = "rejected"
        lawyer.rejection_reason = body.rejection_reason
        if user:
            notifier().send_email(user.email, "Acreditación rechazada — Justiniano",
                                  f"Su acreditación fue rechazada. Motivo: {body.rejection_reason}. "
                                  "Puede corregir y reenviar desde su perfil.")

    await audit(db, admin.id, "lawyer_verification",
                {"lawyer_id": lawyer.id, "status": body.status,
                 "approved_specialties": approved if body.status == "verified" else None,
                 "rejection_reason": body.rejection_reason}, _ip(request))
    await db.commit()
    return {"id": lawyer.id, "verification_status": lawyer.verification_status,
            "verified_at": _iso(lawyer.verified_at), "verified_by": lawyer.verified_by}


# ── 21.3 Tarifario de honorarios (versión vigente) ───────────────────────
@router.get("/admin/lawyer-rates")
async def get_rates(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Versión vigente del tarifario: mayor effective_from ≤ hoy."""
    rate = (await db.execute(
        select(LawyerFeeRate).where(LawyerFeeRate.effective_from <= utcnow().date())
        .order_by(LawyerFeeRate.effective_from.desc(), LawyerFeeRate.version.desc())
        .limit(1))).scalar_one_or_none()
    if rate is None:
        raise not_found("No hay tarifario vigente.")
    return {"version": rate.version, "effective_from": rate.effective_from.isoformat(),
            "review_std_clp": rate.review_std_clp, "review_urgent_clp": rate.review_urgent_clp,
            "consultation_std_clp": rate.consultation_std_clp,
            "consultation_urgent_clp": rate.consultation_urgent_clp,
            "sla_bonus_pct": rate.sla_bonus_pct}


# ── 21.4 Actualizar tarifario (nueva versión) ────────────────────────────
@router.put("/admin/lawyer-rates")
async def put_rates(body: RatesPutIn, request: Request,
                    admin: User = Depends(require_admin),
                    db: AsyncSession = Depends(get_db)):
    """Crea una NUEVA versión del tarifario; los devengos previos no se recalculan."""
    try:
        effective = date.fromisoformat(body.effective_from)
    except ValueError:
        raise ApiError(422, "validation_error", "effective_from debe ser fecha ISO.",
                       {"fields": [{"field": "effective_from", "issue": "YYYY-MM-DD"}]})
    if effective < utcnow().date():
        raise ApiError(422, "validation_error", "effective_from debe ser ≥ hoy.",
                       {"fields": [{"field": "effective_from", "issue": "≥ hoy"}]})

    max_version = (await db.execute(select(func.max(LawyerFeeRate.version)))).scalar() or 0
    rate = LawyerFeeRate(id=new_id("rate"), version=max_version + 1,
                         review_std_clp=body.review_std_clp,
                         review_urgent_clp=body.review_urgent_clp,
                         consultation_std_clp=body.consultation_std_clp,
                         consultation_urgent_clp=body.consultation_urgent_clp,
                         sla_bonus_pct=body.sla_bonus_pct, effective_from=effective,
                         created_by=admin.id)
    db.add(rate)
    await audit(db, admin.id, "lawyer_rates_updated",
                {"version": rate.version, "effective_from": body.effective_from,
                 "rates": body.model_dump()}, _ip(request))
    await db.commit()
    return {"version": rate.version, "effective_from": effective.isoformat(),
            "review_std_clp": rate.review_std_clp, "review_urgent_clp": rate.review_urgent_clp,
            "consultation_std_clp": rate.consultation_std_clp,
            "consultation_urgent_clp": rate.consultation_urgent_clp,
            "sla_bonus_pct": rate.sla_bonus_pct}


# ── 21.5 KPIs de la sección Revisores ────────────────────────────────────
@router.get("/admin/reviewers/overview")
async def reviewers_overview(admin: User = Depends(require_admin),
                             db: AsyncSession = Depends(get_db)):
    """Tarjetas superiores: equipo, carga vs capacidad, bolsa, postulaciones y SLA."""
    lawyers = (await db.execute(select(Lawyer))).scalars().all()
    suspended = [l for l in lawyers if l.suspended_at is not None]
    team = [l for l in lawyers if l.suspended_at is None and l.verification_status == "verified"]
    available = [l for l in team if l.available and not l.paused]
    paused = [l for l in team if l.paused or not l.available]

    cases_in_progress = (await db.execute(
        select(func.count()).select_from(Review).where(Review.state.in_((2, 3))))).scalar() or 0
    aggregate_capacity = sum(l.max_concurrent_cases for l in available)

    now = utcnow()
    pending = (await db.execute(
        select(Review.created_at, Review.urgency)
        .where(Review.state == 1, Review.lawyer_id.is_(None)))).all()
    oldest = min((c for c, _u in pending), default=None)

    applications_pending = (await db.execute(
        select(func.count()).select_from(Lawyer)
        .where(Lawyer.verification_status == "pending"))).scalar() or 0

    since_90d = now - timedelta(days=90)
    delivered = (await db.execute(select(Review.late).where(
        Review.state == 4, Review.delivered_at.is_not(None),
        Review.delivered_at >= since_90d))).scalars().all()
    sla_pct = round(sum(1 for late in delivered if not late) * 100 / len(delivered)) \
        if delivered else None

    return {
        "reviewers": {"active": len(team), "available": len(available),
                      "paused": len(paused), "suspended": len(suspended)},
        "workload": {"cases_in_progress": int(cases_in_progress),
                     "aggregate_capacity": aggregate_capacity,
                     "utilization_pct": round(cases_in_progress * 100 / aggregate_capacity)
                     if aggregate_capacity else 0},
        "pending_assignment": {"total": len(pending),
                               "urgent": sum(1 for _c, u in pending if u == "fast"),
                               "oldest_waiting_business_hours":
                               business_hours_between(oldest, now) if oldest else 0.0},
        "applications_pending": int(applications_pending),
        "sla_global_90d_pct": sla_pct,
    }


# ── 21.6 Listar revisiones (vista administrativa) ────────────────────────
@router.get("/admin/reviews")
async def list_reviews(status: str | None = Query(None), lawyer_id: str | None = Query(None),
                       urgency: str | None = Query(None), p: PageParams = Depends(),
                       admin: User = Depends(require_admin),
                       db: AsyncSession = Depends(get_db)):
    """Bolsa (status=pending_assignment, con espera en horas hábiles) y casos
    por estado o por revisor. Solo metadatos operativos (§21.6)."""
    conds = []
    if status is not None:
        if status not in _REVIEW_STATUSES:
            raise ApiError(422, "validation_error", "status desconocido.",
                           {"fields": [{"field": "status", "issue": "pending_assignment | pending_acceptance | in_progress | delivered"}]})
        conds.append(Review.state == _REVIEW_STATUSES[status])
        if status == "pending_assignment":
            conds.append(Review.lawyer_id.is_(None))
    if lawyer_id is not None:
        check_id(lawyer_id, "law")
        conds.append(Review.lawyer_id == lawyer_id)
    if urgency is not None:
        if urgency not in ("std", "fast"):
            raise ApiError(422, "validation_error", "urgency desconocida.",
                           {"fields": [{"field": "urgency", "issue": "std | fast"}]})
        conds.append(Review.urgency == urgency)

    total = (await db.execute(
        select(func.count()).select_from(Review).where(*conds))).scalar() or 0
    reviews = (await db.execute(
        select(Review).where(*conds).order_by(Review.created_at)
        .offset(p.offset).limit(p.page_size))).scalars().all()

    title, client = await _review_meta(db, reviews)
    lawyer_names = {}
    ids = {r.lawyer_id for r in reviews if r.lawyer_id}
    if ids:
        lawyer_names = dict((await db.execute(
            select(Lawyer.id, Lawyer.name).where(Lawyer.id.in_(ids)))).all())

    now = utcnow()
    items = []
    for r in reviews:
        item = {"id": r.id, "target_type": r.target_type, "title": title(r),
                "client": client(r), "area": r.area, "urgency": r.urgency,
                "state": r.state, "source": r.source,
                "lawyer": {"id": r.lawyer_id, "name": lawyer_names.get(r.lawyer_id)}
                if r.lawyer_id else None,
                "published_at": _iso(r.created_at)}
        if r.state == 1:
            item["waiting_business_hours"] = business_hours_between(r.created_at, now)
        else:
            item["sla_due_at"] = _iso(r.sla_due_at)
        items.append(item)
    return page_response(items, int(total), p)


# ── 21.7 Asignación manual de un pendiente ───────────────────────────────
@router.post("/admin/reviews/{review_id}/assign")
async def assign_review(review_id: str, body: AssignIn, request: Request,
                        admin: User = Depends(require_admin),
                        db: AsyncSession = Depends(get_db)):
    """Retira el caso de la bolsa de forma atómica (FOR UPDATE) y lo deja en
    estado 2 (source=admin). Especialidad no coincidente no bloquea: se audita."""
    check_id(review_id, "rev")
    check_id(body.lawyer_id, "law")
    review = (await db.execute(
        select(Review).where(Review.id == review_id).with_for_update())).scalar_one_or_none()
    if review is None:
        raise not_found("Revisión no encontrada.")
    if review.state != 1 or review.lawyer_id is not None:
        raise ApiError(409, "already_assigned", "El caso ya no está en la bolsa.")

    lawyer = await db.get(Lawyer, body.lawyer_id)
    if lawyer is None:
        raise not_found("Revisor no encontrado.")
    _check_assignable(lawyer, review)
    mismatch = review.area is not None and review.area not in (lawyer.specialties or [])

    now = utcnow()
    review.state, review.source = 2, "admin"
    review.lawyer_id, review.assigned_by, review.assigned_at = lawyer.id, admin.id, now
    db.add(ReviewStateHistory(id=new_id("rsh"), review_id=review.id, state=2,
                              actor_role="admin", actor_user_id=admin.id,
                              reason="asignación manual"))
    await _notify_user(db, lawyer.user_id, "Nueva labor asignada — Justiniano",
                       f"Administración le asignó la labor {review.id} "
                       f"({'urgente' if review.urgency == 'fast' else 'normal'}). "
                       "Acéptela o recházela desde su panel.")
    await audit(db, admin.id, "review_manual_assign",
                {"review_id": review.id, "lawyer_id": lawyer.id,
                 "specialty_mismatch": mismatch, "area": review.area,
                 "lawyer_specialties": lawyer.specialties or []}, _ip(request))
    await db.commit()
    return {"id": review.id, "state": 2, "source": "admin", "lawyer_id": lawyer.id,
            "assigned_by": admin.id, "assigned_at": _iso(now)}


# ── 21.8 Reasignar o devolver a la bolsa ─────────────────────────────────
@router.patch("/admin/reviews/{review_id}/assignment")
async def reassign_review(review_id: str, body: ReassignIn, request: Request,
                          admin: User = Depends(require_admin),
                          db: AsyncSession = Depends(get_db)):
    """Mueve un caso en estados 2–3: a otro revisor (estado 2, conserva el SLA
    comprometido) o a la bolsa (lawyer_id null → estado 1, source=pool)."""
    check_id(review_id, "rev")
    review = (await db.execute(
        select(Review).where(Review.id == review_id).with_for_update())).scalar_one_or_none()
    if review is None:
        raise not_found("Revisión no encontrada.")
    if review.state not in (2, 3):
        raise ApiError(409, "review_not_active", "La revisión no está en estados 2–3.")

    previous_lawyer_id, was_in_progress = review.lawyer_id, review.state == 3
    previous_lawyer = await db.get(Lawyer, previous_lawyer_id) if previous_lawyer_id else None
    reason_text = f"{body.reason}: {body.detail}" if body.detail else body.reason

    if body.lawyer_id is None:  # devolver a la bolsa
        review.state, review.source, review.lawyer_id = 1, "pool", None
        review.assigned_by = review.assigned_at = review.accepted_at = None
        review.sla_due_at = None
        new_lawyer = None
    else:
        check_id(body.lawyer_id, "law")
        if body.lawyer_id == previous_lawyer_id:
            raise ApiError(409, "same_lawyer", "lawyer_id es el revisor actual.")
        new_lawyer = await db.get(Lawyer, body.lawyer_id)
        if new_lawyer is None:
            raise not_found("Revisor no encontrado.")
        _check_assignable(new_lawyer, review)
        review.state, review.source, review.lawyer_id = 2, "admin", new_lawyer.id
        review.assigned_by, review.assigned_at = admin.id, utcnow()
        review.accepted_at = None  # el SLA comprometido (sla_due_at) se conserva

    db.add(ReviewStateHistory(id=new_id("rsh"), review_id=review.id, state=review.state,
                              actor_role="admin", actor_user_id=admin.id, reason=reason_text))

    if previous_lawyer is not None:
        await _notify_user(db, previous_lawyer.user_id, "Labor retirada — Justiniano",
                           f"La labor {review.id} fue retirada de su bandeja por administración.")
    if new_lawyer is not None:
        await _notify_user(db, new_lawyer.user_id, "Nueva labor asignada — Justiniano",
                           f"Administración le reasignó la labor {review.id}. "
                           "Acéptela o recházela desde su panel.")
    if was_in_progress:
        await _notify_user(db, review.user_id, "Actualización de su revisión — Justiniano",
                           f"Su revisión {review.id} fue reasignada a otro profesional; "
                           "el plazo comprometido se mantiene.")

    await audit(db, admin.id, "review_reassigned",
                {"review_id": review.id, "previous_lawyer_id": previous_lawyer_id,
                 "lawyer_id": review.lawyer_id, "reason": body.reason,
                 "detail": body.detail}, _ip(request))
    await db.commit()
    return {"id": review.id, "state": review.state, "lawyer_id": review.lawyer_id,
            "previous_lawyer_id": previous_lawyer_id, "sla_due_at": _iso(review.sla_due_at)}


# ── 21.9 Ficha del revisor ───────────────────────────────────────────────
@router.get("/admin/lawyers/{lawyer_id}")
async def lawyer_detail(lawyer_id: str, admin: User = Depends(require_admin),
                        db: AsyncSession = Depends(get_db)):
    """Perfil, KPIs, honorarios del mes y casos en curso incrustados."""
    check_id(lawyer_id, "law")
    lawyer = await db.get(Lawyer, lawyer_id)
    if lawyer is None:
        raise not_found("Revisor no encontrado.")

    active_reviews = (await db.execute(
        select(Review).where(Review.lawyer_id == lawyer.id, Review.state.in_((2, 3)))
        .order_by(Review.created_at))).scalars().all()
    urgent = sum(1 for r in active_reviews if r.urgency == "fast")

    now = utcnow()
    delivered_rows = (await db.execute(
        select(Review.late, Review.delivered_at)
        .where(Review.lawyer_id == lawyer.id, Review.state == 4))).all()
    last_90d = [late for late, at in delivered_rows
                if at is not None and at >= now - timedelta(days=90)]
    sla_90d = round(sum(1 for late in last_90d if not late) * 100 / len(last_90d)) \
        if last_90d else None

    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    fees_month = (await db.execute(
        select(func.coalesce(func.sum(LawyerFeeEntry.amount_clp), 0))
        .where(LawyerFeeEntry.lawyer_id == lawyer.id,
               LawyerFeeEntry.accrued_at >= month_start))).scalar() or 0

    title, client = await _review_meta(db, active_reviews)
    return {
        "id": lawyer.id, "name": lawyer.name, "university": lawyer.university,
        "degree_year": lawyer.degree_year, "verification_status": lawyer.verification_status,
        "specialties": lawyer.specialties or [], "accepts_urgent": lawyer.accepts_urgent,
        "available": lawyer.available, "paused": lawyer.paused,
        "suspended_at": _iso(lawyer.suspended_at),
        "max_concurrent_cases": lawyer.max_concurrent_cases,
        "kpis": {"active_cases": len(active_reviews), "urgent_in_progress": urgent,
                 "sla_90d_pct": sla_90d, "delivered_total": len(delivered_rows),
                 "rating": lawyer.rating, "fees_month_clp": int(fees_month)},
        "active_reviews": [{"id": r.id, "title": title(r),
                            "client_company": client(r)["company"], "urgency": r.urgency,
                            "state": r.state, "sla_due_at": _iso(r.sla_due_at)}
                           for r in active_reviews],
    }


# ── 21.10 Gestionar revisor ──────────────────────────────────────────────
@router.patch("/admin/lawyers/{lawyer_id}")
async def patch_lawyer(lawyer_id: str, body: LawyerPatchIn, request: Request,
                       admin: User = Depends(require_admin),
                       db: AsyncSession = Depends(get_db)):
    """Especialidades aprobadas (rigen de inmediato), capacidad máxima y pausa
    administrativa. Auditoría con valores previos (§2.9)."""
    check_id(lawyer_id, "law")
    lawyer = await db.get(Lawyer, lawyer_id)
    if lawyer is None:
        raise not_found("Revisor no encontrado.")

    previous = {"specialties": lawyer.specialties or [],
                "max_concurrent_cases": lawyer.max_concurrent_cases, "paused": lawyer.paused}

    if body.approved_specialties is not None:
        catalog = set((await db.execute(select(DocumentArea.id))).scalars().all())
        if catalog and not set(body.approved_specialties).issubset(catalog):
            raise ApiError(422, "validation_error",
                           "approved_specialties contiene áreas fuera del catálogo.",
                           {"fields": [{"field": "approved_specialties", "issue": "área desconocida"}]})
        lawyer.specialties = body.approved_specialties
        lawyer.specialties_pending = [s for s in (lawyer.specialties_pending or [])
                                      if s not in body.approved_specialties]
    if body.max_concurrent_cases is not None:
        lawyer.max_concurrent_cases = body.max_concurrent_cases
    if body.paused is not None:
        lawyer.paused = body.paused

    await audit(db, admin.id, "lawyer_admin_update",
                {"lawyer_id": lawyer.id, "previous": previous,
                 "changes": body.model_dump(exclude_none=True)}, _ip(request))
    await db.commit()
    return {"id": lawyer.id, "approved_specialties": lawyer.specialties or [],
            "max_concurrent_cases": lawyer.max_concurrent_cases, "paused": lawyer.paused}


# ── 21.11 Suspender revisor ──────────────────────────────────────────────
@router.post("/admin/lawyers/{lawyer_id}/suspend")
async def suspend_lawyer(lawyer_id: str, body: SuspendIn, request: Request,
                         admin: User = Depends(require_admin),
                         db: AsyncSession = Depends(get_db)):
    """Suspensión en TRANSACCIÓN ÚNICA (§21.11): marca suspended_at, revoca las
    sesiones (refresh tokens), devuelve los casos 2–3 a la bolsa con historial
    reason=lawyer_suspended y notifica a los afectados. Un fallo revierte todo."""
    check_id(lawyer_id, "law")
    lawyer = await db.get(Lawyer, lawyer_id)
    if lawyer is None:
        raise not_found("Revisor no encontrado.")
    if lawyer.suspended_at is not None:
        raise ApiError(409, "already_suspended", "El revisor ya está suspendido.")

    now = utcnow()
    lawyer.suspended_at, lawyer.suspension_reason = now, body.reason

    # Revocación de todas las sesiones activas del usuario del revisor
    await db.execute(update(RefreshToken)
                     .where(RefreshToken.user_id == lawyer.user_id,
                            RefreshToken.revoked_at.is_(None))
                     .values(revoked_at=now))

    # Devolución atómica de TODOS los casos activos (estados 2–3) a la bolsa
    reviews = (await db.execute(
        select(Review).where(Review.lawyer_id == lawyer.id, Review.state.in_((2, 3)))
        .with_for_update())).scalars().all()
    returned = []
    for review in reviews:
        review.state, review.source, review.lawyer_id = 1, "pool", None
        review.assigned_by = review.assigned_at = review.accepted_at = None
        review.sla_due_at = None
        db.add(ReviewStateHistory(id=new_id("rsh"), review_id=review.id, state=1,
                                  actor_role="admin", actor_user_id=admin.id,
                                  reason="lawyer_suspended"))
        await _notify_user(db, review.user_id, "Actualización de su revisión — Justiniano",
                           f"Su revisión {review.id} será reasignada a otro profesional "
                           "a la brevedad. Le avisaremos con la nueva asignación.")
        returned.append(review.id)

    await _notify_user(db, lawyer.user_id, "Cuenta suspendida — Justiniano",
                       f"Su cuenta de revisor fue suspendida. Motivo: {body.reason}. "
                       "Los honorarios ya devengados se liquidarán con normalidad.")
    await audit(db, admin.id, "lawyer_suspended",
                {"lawyer_id": lawyer.id, "reason": body.reason,
                 "returned_to_pool": returned}, _ip(request))
    await db.commit()
    return {"id": lawyer.id, "suspended_at": _iso(now), "returned_to_pool": returned}
