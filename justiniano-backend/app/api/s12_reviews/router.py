"""§12 Revisiones por abogado — lado cliente: abogados, solicitud y seguimiento."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ApiError, forbidden, not_found
from app.core.pagination import PageParams, page_response
from app.core.security import check_id, new_id, utcnow
from app.models import (Consultation, CreditTransaction, Document, DocumentFormat, Lawyer,
                        Message, Review, ReviewAnnotation, ReviewStateHistory,
                        Subscription, User)

from app.api.s12_reviews.schemas import ReviewCreateIn

router = APIRouter(tags=["§12 Revisiones"])

FREE_PLAN_ID = "p_free"
STATE_LABELS = {1: "Solicitud enviada", 2: "Abogado asignado",
                3: "En revisión", 4: "Revisión entregada"}
COST = {"std": 1, "fast": 2}
DELIVERY = {"std": "48 horas hábiles", "fast": "8 horas hábiles"}


# ── Helpers ──────────────────────────────────────────────────────────────
async def _plan_is_free(db: AsyncSession, user: User) -> bool:
    """Usuario sin suscripción = plan Gratuito `p_free` (§4, convención 8)."""
    sub = (await db.execute(
        select(Subscription).where(Subscription.user_id == user.id))).scalar_one_or_none()
    plan_id = sub.plan_id if sub else (user.plan_id or FREE_PLAN_ID)
    return plan_id == FREE_PLAN_ID


def _initials(name: str) -> str:
    return "".join(w[0] for w in name.split()[:2]).upper()


async def _active_load(db: AsyncSession, lawyer_ids: list[str]) -> dict[str, int]:
    """Carga activa (revisiones en estados 2–3) por abogado."""
    if not lawyer_ids:
        return {}
    rows = (await db.execute(
        select(Review.lawyer_id, func.count(Review.id))
        .where(Review.lawyer_id.in_(lawyer_ids), Review.state.in_((2, 3)))
        .group_by(Review.lawyer_id))).all()
    return {lid: n for lid, n in rows}


def _add_history(db: AsyncSession, review_id: str, state: int, user_id: str | None,
                 reason: str | None = None) -> None:
    """Inserta ReviewStateHistory por cada transición (§4.2)."""
    db.add(ReviewStateHistory(id=new_id("rsh"), review_id=review_id, state=state,
                              actor_role="system", actor_user_id=user_id,
                              reason=reason, created_at=utcnow()))


async def _review_item(db: AsyncSession, review: Review) -> dict:
    """Serializa una revisión como la tarjeta de §12.3/§12.4.

    Incluye state_history con etiquetas, abogado, observaciones y — cuando
    state=4 (corrección v2.2) — annotations y chat_enabled.
    """
    history = (await db.execute(
        select(ReviewStateHistory).where(ReviewStateHistory.review_id == review.id)
        .order_by(ReviewStateHistory.created_at.asc()))).scalars().all()
    lawyer_out = None
    if review.lawyer_id:
        lawyer = await db.get(Lawyer, review.lawyer_id)
        if lawyer:
            lawyer_out = {"id": lawyer.id, "name": lawyer.name, "rut": lawyer.rut}
    document_name = None
    if review.document_id:
        doc = await db.get(Document, review.document_id)
        document_name = doc.name if doc else None
    item = {"id": review.id, "target_type": review.target_type,
            "document_id": review.document_id, "message_id": review.message_id,
            "document_name": document_name, "urgency": review.urgency,
            "state": review.state,
            "state_history": [{"state": h.state, "label": STATE_LABELS.get(h.state, ""),
                               "at": h.created_at} for h in history],
            "lawyer": lawyer_out, "observations": review.observations,
            "created_at": review.created_at}
    if review.state == 4:  # corrección v2.2: anotaciones del abogado + chat
        annotations = (await db.execute(
            select(ReviewAnnotation).where(ReviewAnnotation.review_id == review.id)
            .order_by(ReviewAnnotation.paragraph_index.asc()))).scalars().all()
        item["annotations"] = [{"id": a.id, "lawyer_id": a.lawyer_id,
                                "paragraph_index": a.paragraph_index, "kind": a.kind,
                                "comment_text": a.comment_text,
                                "original_text": a.original_text,
                                "proposed_text": a.proposed_text,
                                "client_resolution": a.client_resolution,
                                "created_at": a.created_at} for a in annotations]
        item["chat_enabled"] = True
    return item


# ── Endpoints ────────────────────────────────────────────────────────────
@router.get("/lawyers")
async def list_lawyers(specialty: str | None = Query(None),
                       urgency: str | None = Query(None),
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)) -> dict:
    """Profesionales disponibles para «Elegir un profesional» (§12.1).

    Corrección v2.2: solo abogados con verification_status=verified, activos y
    available=true; si accepts_urgent=false se excluyen cuando urgency=fast.
    is_frequent marca abogados con revisiones previas con el usuario.
    """
    if urgency is not None and urgency not in ("std", "fast"):
        raise ApiError(422, "validation_error", "Los datos enviados no son válidos.",
                       {"fields": [{"field": "urgency", "issue": "std | fast"}]})
    q = select(Lawyer).where(Lawyer.verification_status == "verified",
                             Lawyer.active.is_(True), Lawyer.available.is_(True))
    if specialty is not None:
        q = q.where(Lawyer.specialties.contains([specialty]))
    if urgency == "fast":
        q = q.where(Lawyer.accepts_urgent.is_(True))
    lawyers = (await db.execute(q.order_by(Lawyer.rating.desc().nulls_last()))).scalars().all()

    counts: dict[str, int] = {}
    if lawyers:
        rows = (await db.execute(
            select(Review.lawyer_id, func.count(Review.id))
            .where(Review.user_id == user.id,
                   Review.lawyer_id.in_([l.id for l in lawyers]))
            .group_by(Review.lawyer_id))).all()
        counts = {lid: n for lid, n in rows}

    items = [{"id": l.id, "name": l.name, "initials": _initials(l.name),
              "specialty": specialty if specialty else (l.specialties[0] if l.specialties else None),
              "rut": l.rut, "bar": l.bar, "rating": l.rating,
              "reviews_with_user": counts.get(l.id, 0),
              "is_frequent": counts.get(l.id, 0) > 0,
              "sla_hours": l.sla_hours} for l in lawyers]
    return {"items": items}


@router.post("/reviews", status_code=201)
async def create_review(body: ReviewCreateIn,
                        user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    """Crea la solicitud de revisión (§12.2).

    Descuenta créditos de forma atómica (SELECT ... FOR UPDATE), pasa el
    documento a estado review, crea la revisión en estado 1 con historial y
    asigna abogado según assignment_mode (o publica en la bolsa, source=pool).
    """
    # ── Objetivo: documento o mensaje del propio usuario (BOLA → 404) ──
    document: Document | None = None
    message: Message | None = None
    area: str | None = None
    if body.target_type == "document":
        if body.document_id is None:
            raise ApiError(422, "validation_error", "Los datos enviados no son válidos.",
                           {"fields": [{"field": "document_id",
                                        "issue": "requerido con target_type=document"}]})
        check_id(body.document_id, "doc")
        document = (await db.execute(select(Document).where(
            Document.id == body.document_id,
            Document.user_id == user.id))).scalar_one_or_none()
        if document is None:
            raise not_found()
        fmt = await db.get(DocumentFormat, document.format_id)
        area = fmt.area_id if fmt else None
        active = (await db.execute(select(Review).where(
            Review.document_id == document.id, Review.state < 4))).scalars().first()
        if active is not None:
            raise ApiError(409, "already_under_review",
                           "El documento ya tiene una revisión activa.")
    else:
        if body.message_id is None:
            raise ApiError(422, "validation_error", "Los datos enviados no son válidos.",
                           {"fields": [{"field": "message_id",
                                        "issue": "requerido con target_type=message"}]})
        check_id(body.message_id, "msg")
        row = (await db.execute(
            select(Message, Consultation)
            .join(Consultation, Message.consultation_id == Consultation.id)
            .where(Message.id == body.message_id,
                   Consultation.user_id == user.id))).first()
        if row is None:
            raise not_found()
        message, cons = row
        area = cons.agent_id

    # ── Urgencia fast bloqueada en plan Gratuito (upsell) ──
    if body.urgency == "fast" and await _plan_is_free(db, user):
        raise forbidden("priority_not_available",
                        "La revisión prioritaria no está disponible en su plan.")

    # ── pick exige lawyer_id (422) y abogado activo de la especialidad ──
    picked: Lawyer | None = None
    if body.assignment_mode == "pick":
        if body.lawyer_id is None:
            raise ApiError(422, "validation_error", "Los datos enviados no son válidos.",
                           {"fields": [{"field": "lawyer_id",
                                        "issue": "requerido con assignment_mode=pick"}]})
        check_id(body.lawyer_id, "law")
        picked = await db.get(Lawyer, body.lawyer_id)
        if (picked is None or not picked.active or picked.verification_status != "verified"
                or (area and area not in (picked.specialties or []))):
            raise ApiError(422, "validation_error", "Los datos enviados no son válidos.",
                           {"fields": [{"field": "lawyer_id",
                                        "issue": "abogado no disponible o de otra especialidad"}]})
    elif body.assignment_mode == "frequent":
        # «Mi abogado de siempre»: el verificado disponible con más revisiones previas.
        rows = (await db.execute(
            select(Review.lawyer_id, func.count(Review.id).label("n"))
            .where(Review.user_id == user.id, Review.lawyer_id.is_not(None))
            .group_by(Review.lawyer_id).order_by(func.count(Review.id).desc()))).all()
        for lid, _n in rows:
            cand = await db.get(Lawyer, lid)
            if (cand and cand.active and cand.available and not cand.paused
                    and cand.verification_status == "verified"
                    and (body.urgency != "fast" or cand.accepts_urgent)):
                picked = cand
                break

    # ── Descuento atómico de créditos (bloqueo de fila) ──
    cost = COST[body.urgency]
    locked_user = (await db.execute(
        select(User).where(User.id == user.id).with_for_update())).scalar_one()
    if locked_user.credits < cost:
        raise ApiError(402, "insufficient_credits", "Créditos insuficientes.",
                       {"required": cost, "available": locked_user.credits})
    locked_user.credits -= cost

    now = utcnow()
    review = Review(id=new_id("rev"), user_id=user.id, target_type=body.target_type,
                    document_id=document.id if document else None,
                    message_id=message.id if message else None,
                    urgency=body.urgency, assignment_mode=body.assignment_mode,
                    source="direct", area=area, state=1, notes=body.notes,
                    cost_credits=cost, created_at=now)
    db.add(review)
    await db.flush()
    db.add(CreditTransaction(id=new_id("ctx"), user_id=user.id, delta=-cost,
                             reason="review_spend", reference_id=review.id, created_at=now))
    _add_history(db, review.id, 1, user.id, "Solicitud enviada")

    # ── Asignación (§4.2) ──
    if picked is not None:  # pick o frequent: asignación directa pendiente de aceptación
        review.state = 2
        review.lawyer_id = picked.id
        review.assigned_at = now
        review.source = "direct"
        review.sla_due_at = None  # el SLA corre desde la aceptación del abogado
        _add_history(db, review.id, 2, user.id, "Asignación directa")
    elif body.assignment_mode == "auto":
        q = (select(Lawyer).where(Lawyer.verification_status == "verified",
                                  Lawyer.active.is_(True), Lawyer.available.is_(True),
                                  Lawyer.paused.is_(False))
             .with_for_update(skip_locked=True))
        if area:
            q = q.where(Lawyer.specialties.contains([area]))
        if body.urgency == "fast":
            q = q.where(Lawyer.accepts_urgent.is_(True))
        candidates = (await db.execute(q)).scalars().all()
        loads = await _active_load(db, [c.id for c in candidates])
        eligible = [c for c in candidates if loads.get(c.id, 0) < c.max_concurrent_cases]
        if eligible:
            chosen = min(eligible, key=lambda c: loads.get(c.id, 0))
            review.state = 2
            review.lawyer_id = chosen.id
            review.assigned_at = now
            review.source = "direct"
            review.sla_due_at = None
            _add_history(db, review.id, 2, user.id, "Asignación automática")
        else:  # sin abogado disponible → bolsa de requerimientos
            review.source = "pool"
    else:  # frequent sin abogado frecuente disponible → bolsa
        review.source = "pool"

    if document is not None:
        document.status = "review"
    await db.commit()

    out = {"id": review.id, "target_type": review.target_type, "urgency": review.urgency,
           "state": review.state, "cost_credits": cost,
           "credits_remaining": locked_user.credits,
           "estimated_delivery": DELIVERY[body.urgency], "created_at": review.created_at}
    if review.target_type == "document":
        out["document_id"] = review.document_id
    else:
        out["message_id"] = review.message_id
    return out


@router.get("/reviews")
async def list_reviews(p: PageParams = Depends(),
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)) -> dict:
    """Tarjetas de la pantalla Revisiones, paginadas (§12.3)."""
    base = select(Review).where(Review.user_id == user.id)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (await db.execute(base.order_by(Review.created_at.desc())
                             .offset(p.offset).limit(p.page_size))).scalars().all()
    items = [await _review_item(db, r) for r in rows]
    return page_response(items, total, p)


@router.get("/reviews/{review_id}")
async def get_review(review_id: str,
                     user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """Detalle de la revisión, misma estructura que el ítem de la lista (§12.4)."""
    check_id(review_id, "rev")
    review = (await db.execute(select(Review).where(
        Review.id == review_id, Review.user_id == user.id))).scalar_one_or_none()
    if review is None:
        raise not_found()
    return await _review_item(db, review)
