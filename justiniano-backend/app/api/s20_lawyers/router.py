"""§20 Portal del abogado revisor — 25 endpoints.

Registro y acreditación, panel de KPIs, requerimientos (asignación directa +
bolsa), workspace con anotaciones, chat compartido cliente/abogado, historial
documental sin descarga, entrega firmada y honorarios.

Regla transversal (§20): los endpoints de requerimientos operan únicamente
sobre revisiones con `lawyer_id` del abogado autenticado; una revisión ajena
responde 404 (`not_found`), nunca 403, para no revelar su existencia.
"""
import re
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_lawyer, get_current_user, require_verified_lawyer
from app.core.errors import ApiError, forbidden, not_found
from app.core.hours import add_business_hours, business_hours_between
from app.core.pagination import PageParams, page_response
from app.core.ratelimit import limit
from app.core.security import (check_id, hash_password, new_id, new_otp, nfc, normalize_rut,
                               utcnow, validate_password_policy)
from app.integrations.blob import FileRejected, blob_client, validate_upload
from app.integrations.notify import notifier
from app.models import (Document, DocumentFormat, HistoryAccessLog, Lawyer, LawyerFeeEntry,
                        LawyerFeeRate, LawyerSettlement, Message, OtpCode, Plan, Review,
                        ReviewAnnotation, ReviewMessage, ReviewStateHistory, Seller, User)

from app.api.s20_lawyers.schemas import (SPECIALTY_CATALOG, AnnotationCreateIn,
                                         AnnotationPatchIn, ChatMessageIn, DeliverIn, DraftIn,
                                         LawyerPatchIn, LawyerSignupIn, RejectIn)

router = APIRouter(tags=["§20 Portal del abogado revisor"])

ADMIN_SUPPORT_EMAIL = "soporte@justiniano.cl"
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


# ─────────────────────────── Utilitarios internos ───────────────────────────

def _iso(dt: datetime | None) -> str | None:
    """Serializa datetime a ISO 8601 UTC con sufijo Z (§2.1)."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _validation(field: str, issue: str) -> ApiError:
    return ApiError(422, "validation_error", "Los datos enviados no son válidos.",
                    {"fields": [{"field": field, "issue": issue}]})


def _paragraphs(content_html: str | None) -> list[dict]:
    """Divide el content_html en párrafos indexados (§20.7).

    Corta por cierres `</p>`; si el HTML no los tiene, por doble salto de línea.
    """
    html = (content_html or "").strip()
    if not html:
        return []
    if "</p>" in html:
        parts, start = [], 0
        while True:
            i = html.find("</p>", start)
            if i == -1:
                tail = html[start:].strip()
                if tail:
                    parts.append(tail)
                break
            parts.append(html[start:i + 4].strip())
            start = i + 4
    else:
        parts = [p.strip() for p in re.split(r"\n\s*\n", html) if p.strip()]
    return [{"index": i, "html": p} for i, p in enumerate(parts)]


def _strip_tags(html: str) -> str:
    return re.sub(r"<[^>]+>", "", html or "")


async def _owned_review(db: AsyncSession, lawyer: Lawyer, review_id: str,
                        for_update: bool = False) -> Review:
    """Revisión del abogado autenticado; ajena o inexistente → 404 (BOLA §2.9)."""
    check_id(review_id, "rev")
    q = select(Review).where(Review.id == review_id, Review.lawyer_id == lawyer.id)
    if for_update:
        q = q.with_for_update()
    review = (await db.execute(q)).scalar_one_or_none()
    if review is None:
        raise not_found()
    return review


async def _review_title(db: AsyncSession, review: Review) -> str:
    """Nombre del documento, o los primeros 120 caracteres de la pregunta."""
    if review.target_type == "document" and review.document_id:
        doc = await db.get(Document, review.document_id)
        if doc:
            return doc.name
    if review.message_id:
        msg = await db.get(Message, review.message_id)
        if msg:
            return msg.content[:120]
    return "Consulta de asesoría"


async def _plan_name(db: AsyncSession, user: User) -> str:
    if user.plan_id:
        plan = await db.get(Plan, user.plan_id)
        if plan:
            return plan.name
    return "Gratuito"


async def _rate_at(db: AsyncSession, when: datetime | None) -> LawyerFeeRate | None:
    """Versión del tarifario vigente a la fecha (mayor effective_from ≤ fecha)."""
    d = (when or utcnow()).date()
    q = (select(LawyerFeeRate).where(LawyerFeeRate.effective_from <= d)
         .order_by(LawyerFeeRate.effective_from.desc(), LawyerFeeRate.version.desc()).limit(1))
    return (await db.execute(q)).scalar_one_or_none()


def _rate_amount(rate: LawyerFeeRate | None, target_type: str, urgency: str) -> int:
    """Monto CLP por (kind, urgency) según §20.21 / regla 9 de convenciones."""
    if rate is None:
        return 0
    if target_type == "document":
        return rate.review_urgent_clp if urgency == "fast" else rate.review_std_clp
    return rate.consultation_urgent_clp if urgency == "fast" else rate.consultation_std_clp


async def _review_fee_clp(db: AsyncSession, review: Review) -> int:
    """Honorario devengado, o calculado desde el tarifario vigente a assigned_at."""
    if review.fee_amount_clp is not None:
        return review.fee_amount_clp
    return _rate_amount(await _rate_at(db, review.assigned_at), review.target_type, review.urgency)


def _add_history(db: AsyncSession, review_id: str, state: int, actor_role: str,
                 actor_user_id: str | None, reason: str | None = None) -> None:
    """Toda transición de estado queda en review_state_history (§4.2)."""
    db.add(ReviewStateHistory(id=new_id("rsh"), review_id=review_id, state=state,
                              actor_role=actor_role, actor_user_id=actor_user_id,
                              reason=reason, created_at=utcnow()))


def _sla_hours(urgency: str) -> int:
    return 8 if urgency == "fast" else 48


def _chat_window_open(review: Review) -> bool:
    """Vigencia compartida de chat e historial: estados 2–3, o entrega < 7 días."""
    if review.state < 2:
        return False
    if review.state < 4:
        return True
    return review.delivered_at is not None and utcnow() - review.delivered_at < timedelta(days=7)


async def _count(db: AsyncSession, model, *conds) -> int:
    return (await db.execute(select(func.count()).select_from(model).where(*conds))).scalar_one()


# ───────────────────────── 20.1 Registro del abogado ─────────────────────────

@router.post("/auth/lawyer-signup", status_code=201,
             dependencies=[Depends(limit("lawyer_signup", 5, 3600))])
async def lawyer_signup(body: LawyerSignupIn, request: Request,
                        db: AsyncSession = Depends(get_db)):
    """Crea la cuenta del abogado revisor (§20.1). Pública, 5 registros/hora/IP.

    Valida server-side mayoría de edad, TyC + declaración jurada, política de
    contraseña y RUT; recién entonces revela colisiones de correo/RUT
    (anti-enumeración). Crea users (role=lawyer) + lawyers (pending), audita
    audit_tyc/audit_sworn y envía el OTP de verificación de correo (§6).
    """
    today = utcnow().date()
    bd = body.birth_date
    age = today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))
    if age < 18:
        raise ApiError(422, "underage", "Debe ser mayor de 18 años para registrarse.")
    if not body.terms_accepted or not body.sworn_declaration:
        raise ApiError(422, "terms_not_accepted",
                       "Debe aceptar los Términos y Condiciones y la declaración jurada.")
    if body.terms_version != get_settings().terms_current_version:
        raise _validation("terms_version", "versión de TyC no vigente")
    validate_password_policy(body.password)
    rut = normalize_rut(body.rut)

    if (await db.execute(select(Lawyer).where(Lawyer.rut == rut))).scalar_one_or_none():
        raise ApiError(409, "rut_in_use", "El RUT ya tiene una cuenta de abogado.")
    email = body.email.lower()
    if (await db.execute(select(User).where(User.email == email))).scalar_one_or_none():
        raise ApiError(409, "email_in_use", "El correo ya está registrado.")

    now, ip = utcnow(), _client_ip(request)
    user = User(id=new_id("usr"), name=nfc(body.name), email=email, phone=body.phone,
                city=body.city, password_hash=hash_password(body.password), role="lawyer",
                terms_version=body.terms_version, terms_accepted_at=now, created_at=now)
    db.add(user)
    lawyer = Lawyer(id=new_id("law"), user_id=user.id, name=nfc(body.name), rut=rut,
                    birth_date=bd, verification_status="pending",
                    accepts_urgent=body.accepts_urgent, promoter=body.promoter,
                    availability=body.availability, created_at=now)
    db.add(lawyer)

    await audit(db, user.id, "audit_tyc", {"terms_version": body.terms_version}, ip)
    await audit(db, user.id, "audit_sworn", {"sworn_declaration": True}, ip)

    code, code_hash = new_otp()
    db.add(OtpCode(id=new_id("otp"), user_id=user.id, channel="email", code_hash=code_hash,
                   purpose="verify_email", expires_at=now + timedelta(minutes=10),
                   created_at=now))
    notifier().send_email(email, "Verifica tu correo en Justiniano",
                          f"Tu código de verificación es {code} (vence en 10 minutos).")
    await db.commit()
    return {"id": lawyer.id, "user_id": user.id, "verification_status": "pending",
            "email_verification": "sent"}


# ───────────────────── 20.2 Acreditación profesional ────────────────────────

@router.post("/lawyers/me/accreditation", status_code=201)
async def upload_accreditation(request: Request,
                               id_document: UploadFile = File(...),
                               degree_certificate: UploadFile = File(...),
                               university: str = Form(..., min_length=1, max_length=120),
                               degree_year: int = Form(...),
                               specialties: list[str] = Form(...),
                               lawyer: Lawyer = Depends(get_current_lawyer),
                               db: AsyncSession = Depends(get_db)):
    """Sube o reemplaza la acreditación (§20.2). multipart/form-data.

    `specialties` llega como campos repetidos o como una lista separada por
    comas: se aceptan ambas formas. Cada envío deja la cuenta en
    verification_status=pending, incluso si ya estaba verificada.
    """
    if not (1970 <= degree_year <= utcnow().year):
        raise _validation("degree_year", f"entero entre 1970 y {utcnow().year}")
    specs: list[str] = []
    for raw in specialties:
        specs.extend(s.strip() for s in raw.split(",") if s.strip())
    if not (1 <= len(specs) <= 8):
        raise _validation("specialties", "arreglo de 1 a 8 áreas del catálogo")
    bad = [s for s in specs if s not in SPECIALTY_CATALOG]
    if bad:
        raise _validation("specialties", f"áreas fuera del catálogo: {', '.join(bad)}")
    if (degree_certificate.content_type or "") != "application/pdf":
        raise ApiError(422, "file_invalid", "El certificado de título debe ser PDF.")

    settings, blob = get_settings(), blob_client()
    blobs: dict[str, str] = {}
    for field, upload in (("id_document", id_document),
                          ("degree_certificate", degree_certificate)):
        data = await upload.read()
        try:
            safe_name = validate_upload(data, upload.content_type or "", upload.filename or "")
        except FileRejected as e:
            raise ApiError(413 if e.code == "file_too_large" else 422, e.code, e.message)
        blobs[field] = blob.put(settings.blob_container_accreditations,
                                f"{lawyer.id}/{safe_name}", data)

    lawyer.id_document_blob = blobs["id_document"]
    lawyer.degree_certificate_blob = blobs["degree_certificate"]
    lawyer.university = nfc(university)
    lawyer.degree_year = degree_year
    lawyer.specialties_pending = specs        # sujetas a validación admin (§21.2)
    lawyer.verification_status = "pending"    # también si estaba verified
    await db.commit()
    return {"verification_status": "pending", "estimated_review": "24-48 horas hábiles"}


# ─────────────────────── 20.3 / 20.4 Perfil profesional ─────────────────────

@router.get("/lawyers/me")
async def get_my_profile(lawyer: Lawyer = Depends(get_current_lawyer)):
    """Perfil, estado de acreditación y preferencias (§20.3)."""
    documents = []
    if lawyer.id_document_blob:
        documents.append({"kind": "id_document",
                          "name": lawyer.id_document_blob.rsplit("/", 1)[-1],
                          "status": lawyer.verification_status})
    if lawyer.degree_certificate_blob:
        documents.append({"kind": "degree_certificate",
                          "name": lawyer.degree_certificate_blob.rsplit("/", 1)[-1],
                          "status": lawyer.verification_status})
    return {"id": lawyer.id, "name": lawyer.name, "rut": lawyer.rut, "bar": lawyer.bar,
            "university": lawyer.university, "degree_year": lawyer.degree_year,
            "verification_status": lawyer.verification_status,
            "rejection_reason": lawyer.rejection_reason,
            "specialties": lawyer.specialties or [],
            "specialties_pending": lawyer.specialties_pending or [],
            "accepts_urgent": lawyer.accepts_urgent, "available": lawyer.available,
            "promoter": lawyer.promoter, "availability": lawyer.availability,
            "rating": lawyer.rating, "documents": documents}


@router.patch("/lawyers/me")
async def patch_my_profile(body: LawyerPatchIn, lawyer: Lawyer = Depends(get_current_lawyer),
                           db: AsyncSession = Depends(get_db)):
    """Actualiza especialidades y preferencias (§20.4).

    Las especialidades quedan en specialties_pending hasta la validación de
    administración; las preferencias operativas rigen de inmediato. promoter
    true crea o reactiva el perfil comercial (sellers) si el abogado está
    verificado; false lo desactiva sin borrar la cartera.
    """
    if body.specialties is not None:
        lawyer.specialties_pending = body.specialties
    if body.accepts_urgent is not None:
        lawyer.accepts_urgent = body.accepts_urgent
    if body.available is not None:
        lawyer.available = body.available
    if body.promoter is not None:
        lawyer.promoter = body.promoter
        seller = (await db.execute(
            select(Seller).where(Seller.user_id == lawyer.user_id))).scalar_one_or_none()
        if body.promoter and lawyer.verification_status == "verified":
            if seller is None:
                db.add(Seller(id=new_id("sel"), user_id=lawyer.user_id, active=True,
                              created_at=utcnow()))
            else:
                seller.active = True
        elif not body.promoter and seller is not None:
            seller.active = False
    await db.commit()
    return {"id": lawyer.id, "specialties": lawyer.specialties or [],
            "specialties_pending": lawyer.specialties_pending or [],
            "accepts_urgent": lawyer.accepts_urgent, "available": lawyer.available,
            "promoter": lawyer.promoter}


# ─────────────────────────── 20.5 KPIs del panel ────────────────────────────

@router.get("/lawyers/me/overview")
async def my_overview(lawyer: Lawyer = Depends(get_current_lawyer),
                      db: AsyncSession = Depends(get_db)):
    """Tarjetas del panel y próximos vencimientos (§20.5)."""
    now = utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    since_90d = now - timedelta(days=90)
    mine = Review.lawyer_id == lawyer.id

    active_cases = await _count(db, Review, mine, Review.state.in_((2, 3)))
    pending_acceptance = await _count(db, Review, mine, Review.state == 2,
                                      Review.source.in_(("direct", "admin")))
    urgent_in_progress = await _count(db, Review, mine, Review.state == 3,
                                      Review.urgency == "fast")
    completed_month = await _count(db, Review, mine, Review.state == 4,
                                   Review.delivered_at >= month_start)
    total_90d = await _count(db, Review, mine, Review.state == 4,
                             Review.delivered_at >= since_90d)
    late_90d = await _count(db, Review, mine, Review.state == 4,
                            Review.delivered_at >= since_90d, Review.late.is_(True))
    sla_pct = round(100 * (total_90d - late_90d) / total_90d) if total_90d else 100

    fees_month = (await db.execute(
        select(func.coalesce(func.sum(LawyerFeeEntry.amount_clp), 0))
        .where(LawyerFeeEntry.lawyer_id == lawyer.id,
               LawyerFeeEntry.accrued_at >= month_start))).scalar_one()

    deadlines = (await db.execute(
        select(Review).where(mine, Review.state == 3, Review.sla_due_at.isnot(None))
        .order_by(Review.sla_due_at.asc()).limit(5))).scalars().all()
    next_deadlines = [{"review_id": r.id, "title": await _review_title(db, r),
                       "urgency": r.urgency, "sla_due_at": _iso(r.sla_due_at),
                       "remaining_business_hours": business_hours_between(now, r.sla_due_at)}
                      for r in deadlines]

    return {"active_cases": active_cases, "pending_acceptance": pending_acceptance,
            "urgent_in_progress": urgent_in_progress, "completed_month": completed_month,
            "sla_compliance_90d_pct": sla_pct, "fees_month_clp": int(fees_month),
            "rating": lawyer.rating, "ratings_count": lawyer.ratings_count,
            "next_deadlines": next_deadlines}


# ─────────────────────────── 20.6 Mis requerimientos ────────────────────────

async def _review_item(db: AsyncSession, review: Review) -> dict:
    """Ítem del listado «Mis casos» (§20.6)."""
    owner = await db.get(User, review.user_id)
    return {"id": review.id, "target_type": review.target_type,
            "title": await _review_title(db, review),
            "client": {"company": (owner.company or owner.name) if owner else None,
                       "contact": owner.name if owner else None,
                       "plan": await _plan_name(db, owner) if owner else "Gratuito"},
            "area": review.area, "urgency": review.urgency, "source": review.source,
            "assignment_mode": review.assignment_mode, "state": review.state,
            "client_note": review.notes, "assigned_at": _iso(review.assigned_at),
            "sla_due_at": _iso(review.sla_due_at),
            "fee_amount_clp": await _review_fee_clp(db, review)}


@router.get("/lawyers/me/reviews")
async def my_reviews(status: Literal["pending_acceptance", "in_progress", "delivered"] | None
                     = Query(None),
                     p: PageParams = Depends(),
                     lawyer: Lawyer = Depends(require_verified_lawyer),
                     db: AsyncSession = Depends(get_db)):
    """Pestañas «Mis casos» y «Completados» (§20.6). Sin status: estados 2–3."""
    states = {"pending_acceptance": (2,), "in_progress": (3,), "delivered": (4,)} \
        .get(status, (2, 3))
    conds = (Review.lawyer_id == lawyer.id, Review.state.in_(states))
    total = await _count(db, Review, *conds)
    rows = (await db.execute(
        select(Review).where(*conds)
        .order_by(Review.sla_due_at.asc().nulls_last(), Review.created_at.desc())
        .offset(p.offset).limit(p.page_size))).scalars().all()
    return page_response([await _review_item(db, r) for r in rows], total, p)


# ──────────────────── 20.7 Detalle del requerimiento ────────────────────────

@router.get("/lawyers/me/reviews/{review_id}")
async def review_workspace(review_id: str, lawyer: Lawyer = Depends(require_verified_lawyer),
                           db: AsyncSession = Depends(get_db)):
    """Workspace de revisión (§20.7): documento en párrafos indexados o pregunta
    de la consulta, borrador, nota del cliente y metadatos de «Detalles»."""
    review = await _owned_review(db, lawyer, review_id)
    document = question = None
    if review.target_type == "document" and review.document_id:
        doc = await db.get(Document, review.document_id)
        if doc:
            document = {"id": doc.id, "name": doc.name,
                        "paragraphs": _paragraphs(doc.content_html)}
    elif review.message_id:
        msg = await db.get(Message, review.message_id)
        if msg:
            question = msg.content
    owner = await db.get(User, review.user_id)
    annotations_count = await _count(db, ReviewAnnotation,
                                     ReviewAnnotation.review_id == review.id)
    chat_unread = await _count(db, ReviewMessage, ReviewMessage.review_id == review.id,
                               ReviewMessage.sender_role == "client",
                               ReviewMessage.read_at.is_(None))
    return {"id": review.id, "target_type": review.target_type, "state": review.state,
            "document": document, "question": question, "draft": review.draft,
            "client_note": review.notes,
            "client": {"company": (owner.company or owner.name) if owner else None,
                       "plan": await _plan_name(db, owner) if owner else "Gratuito"},
            "urgency": review.urgency, "source": review.source,
            "sla_due_at": _iso(review.sla_due_at),
            "fee_amount_clp": await _review_fee_clp(db, review),
            "annotations_count": annotations_count, "chat_unread": chat_unread}


# ─────────────────────── 20.8 / 20.9 Aceptar y rechazar ─────────────────────

@router.post("/lawyers/me/reviews/{review_id}/accept")
async def accept_review(review_id: str, lawyer: Lawyer = Depends(require_verified_lawyer),
                        db: AsyncSession = Depends(get_db)):
    """Acepta una asignación directa (§20.8): estado 2 → 3; el SLA corre desde
    la aceptación. Notifica al cliente («En revisión»)."""
    review = await _owned_review(db, lawyer, review_id, for_update=True)
    if review.state != 2:
        raise ApiError(409, "not_pending_acceptance",
                       "La revisión no está pendiente de aceptación.")
    now = utcnow()
    review.state = 3
    review.accepted_at = now
    review.sla_due_at = add_business_hours(now, _sla_hours(review.urgency))
    _add_history(db, review.id, 3, "lawyer", lawyer.user_id, "accepted")
    owner = await db.get(User, review.user_id)
    if owner:
        notifier().send_email(owner.email, "Tu revisión está en curso",
                              "El abogado aceptó tu requerimiento y comenzó la revisión.")
    await db.commit()
    return {"id": review.id, "state": 3, "accepted_at": _iso(review.accepted_at),
            "sla_due_at": _iso(review.sla_due_at)}


@router.post("/lawyers/me/reviews/{review_id}/reject")
async def reject_review(review_id: str, body: RejectIn,
                        lawyer: Lawyer = Depends(require_verified_lawyer),
                        db: AsyncSession = Depends(get_db)):
    """Rechaza (o devuelve excepcionalmente) una asignación con motivo (§20.9).

    La revisión vuelve a la bolsa (estado 1, source=pool, sin abogado) y se
    notifica a administración; el motivo queda auditado en el historial.
    """
    review = await _owned_review(db, lawyer, review_id, for_update=True)
    if review.state == 4:
        raise ApiError(409, "already_delivered", "La revisión ya fue entregada.")
    reason = body.reason if not body.detail else f"{body.reason}: {body.detail}"
    review.state = 1
    review.source = "pool"
    review.lawyer_id = None
    review.assigned_by = None
    review.assigned_at = None
    review.accepted_at = None
    review.sla_due_at = None
    review.rejected_reason = reason
    _add_history(db, review.id, 1, "lawyer", lawyer.user_id, reason)
    notifier().send_email(ADMIN_SUPPORT_EMAIL, f"Rechazo de asignación {review.id}",
                          f"El abogado {lawyer.name} rechazó el requerimiento {review.id}. "
                          f"Motivo: {reason}. El caso volvió a la bolsa.")
    await db.commit()
    return {"id": review.id, "state": 1, "source": "pool", "returned_to_pool": True}


# ───────────────────── 20.10 / 20.11 Bolsa de requerimientos ────────────────

@router.get("/reviews/pool")
async def reviews_pool(urgency: Literal["std", "fast"] | None = Query(None),
                       area: str | None = Query(None),
                       p: PageParams = Depends(),
                       lawyer: Lawyer = Depends(require_verified_lawyer),
                       db: AsyncSession = Depends(get_db)):
    """Casos publicados sin abogado (§20.10), filtrados server-side por las
    especialidades verificadas; si accepts_urgent=false los urgentes se omiten.
    Solo metadatos para decidir: sin contenido del documento ni historial."""
    specs = lawyer.specialties or []
    if not specs:
        return page_response([], 0, p)
    conds = [Review.state == 1, Review.lawyer_id.is_(None), Review.source == "pool",
             Review.area.in_(specs)]
    if not lawyer.accepts_urgent:
        conds.append(Review.urgency != "fast")
    if urgency:
        conds.append(Review.urgency == urgency)
    if area:
        conds.append(Review.area == area)
    total = await _count(db, Review, *conds)
    rows = (await db.execute(select(Review).where(*conds)
                             .order_by(Review.created_at.asc())
                             .offset(p.offset).limit(p.page_size))).scalars().all()
    rate = await _rate_at(db, None)
    items = []
    for r in rows:
        owner = await db.get(User, r.user_id)
        items.append({"id": r.id, "target_type": r.target_type,
                      "title": await _review_title(db, r),
                      "client_company": (owner.company or owner.name) if owner else None,
                      "client_plan": await _plan_name(db, owner) if owner else "Gratuito",
                      "area": r.area, "urgency": r.urgency,
                      "published_at": _iso(r.created_at),
                      "sla_from_claim": f"{_sla_hours(r.urgency)} horas hábiles",
                      "fee_amount_clp": _rate_amount(rate, r.target_type, r.urgency)})
    return page_response(items, total, p)


@router.post("/reviews/pool/{review_id}/claim")
async def claim_review(review_id: str, lawyer: Lawyer = Depends(require_verified_lawyer),
                       db: AsyncSession = Depends(get_db)):
    """Toma un caso de la bolsa (§20.11): pasos 2 y 3 atómicos, SLA desde el
    claim. SELECT ... FOR UPDATE SKIP LOCKED: el segundo abogado recibe 409."""
    check_id(review_id, "rev")
    review = (await db.execute(
        select(Review).where(Review.id == review_id, Review.state == 1,
                             Review.lawyer_id.is_(None), Review.source == "pool")
        .with_for_update(skip_locked=True))).scalar_one_or_none()
    if review is None:
        raise ApiError(409, "already_claimed", "Otro abogado tomó el caso primero.")
    if review.area not in (lawyer.specialties or []):
        raise forbidden("specialty_mismatch",
                        "El caso no corresponde a sus especialidades verificadas.")
    if review.urgency == "fast" and not lawyer.accepts_urgent:
        raise forbidden("urgent_disabled", "Su perfil no acepta casos urgentes.")
    now = utcnow()
    review.lawyer_id = lawyer.id
    review.state = 3                     # pasos 2 y 3 de forma atómica (§4.2)
    review.assigned_at = now
    review.accepted_at = now
    review.sla_due_at = add_business_hours(now, _sla_hours(review.urgency))
    _add_history(db, review.id, 2, "lawyer", lawyer.user_id, "claimed_from_pool")
    _add_history(db, review.id, 3, "lawyer", lawyer.user_id, "claimed_from_pool")
    fee = _rate_amount(await _rate_at(db, now), review.target_type, review.urgency)
    owner = await db.get(User, review.user_id)
    if owner:
        notifier().send_email(owner.email, "Abogado asignado",
                              "Un abogado tomó tu requerimiento y comenzó la revisión.")
    await db.commit()
    return {"id": review.id, "state": 3, "lawyer_id": lawyer.id,
            "sla_due_at": _iso(review.sla_due_at), "fee_amount_clp": fee}


# ───────────────────────── 20.12–20.15 Anotaciones ──────────────────────────

def _annotation_out(ann: ReviewAnnotation, author: str) -> dict:
    """Representación por kind, como en la pestaña «Anotaciones» (§20.12)."""
    base = {"id": ann.id, "kind": ann.kind, "paragraph_index": ann.paragraph_index}
    if ann.kind == "comment":
        base |= {"comment_text": ann.comment_text, "author": author,
                 "created_at": _iso(ann.created_at)}
    elif ann.kind == "change":
        base |= {"original_text": ann.original_text, "proposed_text": ann.proposed_text,
                 "client_resolution": ann.client_resolution}
    return base


async def _review_paragraphs(db: AsyncSession, review: Review) -> list[dict]:
    if review.document_id:
        doc = await db.get(Document, review.document_id)
        if doc:
            return _paragraphs(doc.content_html)
    return []


def _check_original_text(paragraphs: list[dict], index: int, original_text: str) -> None:
    """original_text debe ser subcadena exacta del párrafo referenciado (§20.13)."""
    html = paragraphs[index]["html"]
    if original_text not in _strip_tags(html) and original_text not in html:
        raise ApiError(422, "original_text_mismatch",
                       "original_text no coincide con el párrafo referenciado.")


@router.get("/lawyers/me/reviews/{review_id}/annotations")
async def list_annotations(review_id: str,
                           lawyer: Lawyer = Depends(require_verified_lawyer),
                           db: AsyncSession = Depends(get_db)):
    """Anotaciones de la revisión ordenadas por paragraph_index (§20.12)."""
    review = await _owned_review(db, lawyer, review_id)
    rows = (await db.execute(
        select(ReviewAnnotation).where(ReviewAnnotation.review_id == review.id)
        .order_by(ReviewAnnotation.paragraph_index.asc(),
                  ReviewAnnotation.created_at.asc()))).scalars().all()
    return {"items": [_annotation_out(a, lawyer.name) for a in rows]}


@router.post("/lawyers/me/reviews/{review_id}/annotations", status_code=201)
async def create_annotation(review_id: str, body: AnnotationCreateIn,
                            lawyer: Lawyer = Depends(require_verified_lawyer),
                            db: AsyncSession = Depends(get_db)):
    """Crea comentario, cambio propuesto o resaltado anclado a un párrafo
    (§20.13). Solo con la revisión en estado 3 y target_type=document."""
    review = await _owned_review(db, lawyer, review_id)
    if review.state != 3:
        raise ApiError(409, "review_not_in_progress", "La revisión no está en estado 3.")
    if review.target_type != "document":
        raise ApiError(409, "target_not_document",
                       "La revisión es de una consulta (target_type=message).")
    paragraphs = await _review_paragraphs(db, review)
    if body.paragraph_index >= len(paragraphs):
        raise _validation("paragraph_index", "el párrafo no existe en el documento")
    if body.kind == "change":
        _check_original_text(paragraphs, body.paragraph_index, body.original_text)
    ann = ReviewAnnotation(id=new_id("ann"), review_id=review.id, lawyer_id=lawyer.id,
                           paragraph_index=body.paragraph_index, kind=body.kind,
                           comment_text=body.comment_text, original_text=body.original_text,
                           proposed_text=body.proposed_text, created_at=utcnow())
    db.add(ann)
    await db.commit()
    return {"id": ann.id, "kind": ann.kind, "paragraph_index": ann.paragraph_index,
            "created_at": _iso(ann.created_at)}


async def _owned_annotation(db: AsyncSession, review: Review,
                            annotation_id: str) -> ReviewAnnotation:
    check_id(annotation_id, "ann")
    ann = (await db.execute(
        select(ReviewAnnotation).where(ReviewAnnotation.id == annotation_id,
                                       ReviewAnnotation.review_id == review.id)
    )).scalar_one_or_none()
    if ann is None:
        raise not_found()
    return ann


def _check_annotation_mutable(review: Review) -> None:
    """Tras la entrega (estado 4) las anotaciones son inmutables (§20.14–20.15)."""
    if review.state == 4:
        raise ApiError(409, "review_delivered", "Anotaciones inmutables tras la entrega.")
    if review.state != 3:
        raise ApiError(409, "review_not_in_progress", "La revisión no está en estado 3.")


@router.patch("/lawyers/me/reviews/{review_id}/annotations/{annotation_id}")
async def patch_annotation(review_id: str, annotation_id: str, body: AnnotationPatchIn,
                           lawyer: Lawyer = Depends(require_verified_lawyer),
                           db: AsyncSession = Depends(get_db)):
    """Actualización parcial de la anotación (§20.14), con las mismas
    validaciones de §20.13 aplicadas sobre los valores combinados."""
    review = await _owned_review(db, lawyer, review_id)
    _check_annotation_mutable(review)
    ann = await _owned_annotation(db, review, annotation_id)

    kind = body.kind if body.kind is not None else ann.kind
    paragraph_index = (body.paragraph_index if body.paragraph_index is not None
                       else ann.paragraph_index)
    comment_text = body.comment_text if body.comment_text is not None else ann.comment_text
    original_text = (body.original_text if body.original_text is not None
                     else ann.original_text)
    proposed_text = (body.proposed_text if body.proposed_text is not None
                     else ann.proposed_text)

    paragraphs = await _review_paragraphs(db, review)
    if paragraph_index >= len(paragraphs):
        raise _validation("paragraph_index", "el párrafo no existe en el documento")
    if kind == "comment" and not (comment_text and comment_text.strip()):
        raise _validation("comment_text", "obligatorio cuando kind=comment")
    if kind == "change":
        if not (original_text and original_text.strip()):
            raise _validation("original_text", "obligatorio cuando kind=change")
        if not (proposed_text and proposed_text.strip()):
            raise _validation("proposed_text", "obligatorio cuando kind=change")
        _check_original_text(paragraphs, paragraph_index, original_text)

    ann.kind, ann.paragraph_index = kind, paragraph_index
    ann.comment_text, ann.original_text, ann.proposed_text = \
        comment_text, original_text, proposed_text
    ann.updated_at = utcnow()
    await db.commit()
    return _annotation_out(ann, lawyer.name) | {"updated_at": _iso(ann.updated_at)}


@router.delete("/lawyers/me/reviews/{review_id}/annotations/{annotation_id}",
               status_code=204)
async def delete_annotation(review_id: str, annotation_id: str,
                            lawyer: Lawyer = Depends(require_verified_lawyer),
                            db: AsyncSession = Depends(get_db)):
    """Elimina la anotación (§20.15). Solo en estado 3."""
    review = await _owned_review(db, lawyer, review_id)
    _check_annotation_mutable(review)
    ann = await _owned_annotation(db, review, annotation_id)
    await db.delete(ann)
    await db.commit()
    return Response(status_code=204)


# ───────────────────── 20.16 / 20.17 Chat del requerimiento ─────────────────

async def _chat_access(db: AsyncSession, user: User, review_id: str) -> tuple[Review, str]:
    """Resuelve el acceso al chat (§20.16): cliente dueño o abogado asignado.

    Único módulo compartido entre ambos frontends: no usa require_role. Un
    tercero (u otro abogado) recibe 404 para no revelar la existencia.
    """
    check_id(review_id, "rev")
    review = await db.get(Review, review_id)
    if review is None:
        raise not_found()
    if review.user_id == user.id:
        return review, "client"
    if user.role == "lawyer" and review.lawyer_id is not None:
        lawyer = (await db.execute(
            select(Lawyer).where(Lawyer.user_id == user.id))).scalar_one_or_none()
        if lawyer is not None and review.lawyer_id == lawyer.id:
            return review, "lawyer"
    raise not_found()


@router.get("/reviews/{review_id}/chat")
async def get_chat(review_id: str, user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)):
    """Mensajes del expediente (§20.16). Disponible desde el estado 2 y hasta
    7 días después de la entrega. Marca como leídos los de la contraparte."""
    review, role = await _chat_access(db, user, review_id)
    rows = (await db.execute(
        select(ReviewMessage).where(ReviewMessage.review_id == review.id)
        .order_by(ReviewMessage.created_at.asc()))).scalars().all()
    sender_ids = {m.sender_user_id for m in rows}
    names = {}
    if sender_ids:
        users = (await db.execute(select(User).where(User.id.in_(sender_ids)))).scalars()
        names = {u.id: u.name for u in users}
    dirty = False
    for m in rows:
        if m.sender_role != role and m.read_at is None:
            m.read_at = utcnow()
            dirty = True
    if dirty:
        await db.commit()
    items = [{"id": m.id, "sender_role": m.sender_role,
              "sender_name": names.get(m.sender_user_id),
              "content": m.content, "created_at": _iso(m.created_at)} for m in rows]
    return {"items": items, "chat_enabled": _chat_window_open(review)}


@router.post("/reviews/{review_id}/chat", status_code=201)
async def post_chat(review_id: str, body: ChatMessageIn,
                    user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    """Publica un mensaje en el expediente (§20.17) y notifica a la contraparte
    por correo. El remitente se deriva del token, jamás del cuerpo."""
    review, role = await _chat_access(db, user, review_id)
    if not _chat_window_open(review) or review.lawyer_id is None:
        raise ApiError(409, "chat_closed",
                       "Chat cerrado: más de 7 días desde la entrega o sin abogado asignado.")
    msg = ReviewMessage(id=new_id("rvm"), review_id=review.id, sender_role=role,
                        sender_user_id=user.id, content=body.content, created_at=utcnow())
    db.add(msg)
    counterpart: User | None = None
    if role == "client":
        assigned = await db.get(Lawyer, review.lawyer_id)
        if assigned:
            counterpart = await db.get(User, assigned.user_id)
    else:
        counterpart = await db.get(User, review.user_id)
    if counterpart:
        notifier().send_email(counterpart.email,
                              "Nuevo mensaje en tu requerimiento",
                              f"Tienes un nuevo mensaje en el requerimiento {review.id}.")
    await db.commit()
    return {"id": msg.id, "sender_role": msg.sender_role, "created_at": _iso(msg.created_at)}


# ─────────────── 20.18 / 20.19 Historial documental del cliente ─────────────

def _check_history_window(review: Review) -> None:
    """Vigencia del historial (§20.18): revisión activa o entrega < 7 días."""
    if not _chat_window_open(review):
        raise forbidden("history_access_denied",
                        "El acceso al historial venció (revisión cerrada hace más de 7 días).")


@router.get("/lawyers/me/reviews/{review_id}/client-history")
async def client_history(review_id: str,
                         lawyer: Lawyer = Depends(require_verified_lawyer),
                         db: AsyncSession = Depends(get_db)):
    """Metadatos de los documentos históricos del cliente dueño (§20.18).

    Sin URLs de archivo: el contenido solo se obtiene por §20.19. Excluye el
    documento en revisión.
    """
    review = await _owned_review(db, lawyer, review_id)
    _check_history_window(review)
    q = select(Document).where(Document.user_id == review.user_id)
    if review.document_id:
        q = q.where(Document.id != review.document_id)
    docs = (await db.execute(q.order_by(Document.created_at.desc()))).scalars().all()
    items = []
    for d in docs:
        fmt = await db.get(DocumentFormat, d.format_id)
        kind = ((fmt.name_i18n or {}).get("es") or fmt.doc_type) if fmt else "Documento"
        items.append({"id": d.id, "name": d.name, "kind": kind,
                      "created_at": d.created_at.strftime("%Y-%m-%d") if d.created_at else None,
                      "origin": "reviewed" if d.status == "ready" else "generated"})
    return {"items": items, "download_enabled": False}


@router.get("/lawyers/me/reviews/{review_id}/client-history/{document_id}")
async def view_history_document(review_id: str, document_id: str, request: Request,
                                lawyer: Lawyer = Depends(require_verified_lawyer),
                                db: AsyncSession = Depends(get_db)):
    """Contenido inline de un documento histórico (§20.19), con marca de agua
    nominativa inyectada server-side. NUNCA emite URLs SAS ni binarios; cada
    acceso queda en history_access_log con la IP."""
    review = await _owned_review(db, lawyer, review_id)
    _check_history_window(review)
    check_id(document_id, "doc")
    q = select(Document).where(Document.id == document_id,
                               Document.user_id == review.user_id)
    if review.document_id:
        q = q.where(Document.id != review.document_id)
    doc = (await db.execute(q)).scalar_one_or_none()
    if doc is None:
        raise not_found()
    watermark = f"Justiniano - SOLO CONSULTA - {lawyer.name}"
    content_html = (f'<div class="wm" data-watermark="{watermark}">'
                    f'{doc.content_html or ""}</div>')
    db.add(HistoryAccessLog(id=new_id("hac"), lawyer_id=lawyer.id, review_id=review.id,
                            document_id=doc.id, viewed_at=utcnow(), ip=_client_ip(request)))
    await db.commit()
    return {"id": doc.id, "name": doc.name, "content_html": content_html,
            "watermark": watermark, "access_logged": True}


# ─────────────────────────── 20.20 Guardar borrador ─────────────────────────

@router.patch("/lawyers/me/reviews/{review_id}/draft")
async def save_draft(review_id: str, body: DraftIn,
                     lawyer: Lawyer = Depends(require_verified_lawyer),
                     db: AsyncSession = Depends(get_db)):
    """Autoguardado del trabajo en curso (§20.20). Solo estados 2–3; se
    sobreescribe en cada llamada y no cambia el estado."""
    review = await _owned_review(db, lawyer, review_id)
    if review.state == 4:
        raise ApiError(409, "already_delivered", "La revisión ya fue entregada.")
    if review.state not in (2, 3):
        raise ApiError(409, "review_not_in_progress", "La revisión no está en curso.")
    review.draft = body.draft
    now = utcnow()
    await db.commit()
    return {"id": review.id, "draft_saved_at": _iso(now)}


# ──────────────────────── 20.21 Entregar revisión firmada ───────────────────

@router.post("/lawyers/me/reviews/{review_id}/deliver")
async def deliver_review(review_id: str, body: DeliverIn, request: Request,
                         lawyer: Lawyer = Depends(require_verified_lawyer),
                         db: AsyncSession = Depends(get_db)):
    """Cierra el requerimiento (§20.21): estado 4, honorario devengado en la
    misma transacción y notificación al cliente por correo/SMS.

    La firma profesional se toma del perfil verificado en el servidor; el
    cuerpo no puede alterarla. Una entrega posterior al SLA se acepta con
    late=true (impacta el bono SLA, no bloquea).
    """
    if not body.declaration:
        raise ApiError(422, "declaration_required",
                       "Debe declarar la revisión íntegra del documento.")
    review = await _owned_review(db, lawyer, review_id, for_update=True)
    if review.state == 4:
        raise ApiError(409, "already_delivered", "La revisión ya está en estado 4.")
    if review.state != 3:
        raise ApiError(409, "review_not_in_progress", "La revisión no está en estado 3.")

    response_text = None
    if review.target_type == "message":
        response_text = body.response_text or review.draft  # borrador como fallback
        if not (response_text and response_text.strip()):
            raise _validation("response_text",
                              "obligatorio en consultas sin borrador guardado")

    now = utcnow()
    review.state = 4
    review.delivered_at = now
    review.late = bool(review.sla_due_at and now > review.sla_due_at)
    review.final_observations = body.final_observations
    review.observations = body.final_observations       # compat cliente (=final)
    if response_text is not None:
        review.response_text = response_text
    review.declaration_accepted_at = now

    # Devengo atómico: tarifario vigente a la fecha de asignación (regla 9)
    rate = await _rate_at(db, review.assigned_at)
    kind = "review" if review.target_type == "document" else "consultation"
    amount = _rate_amount(rate, review.target_type, review.urgency)
    fee = LawyerFeeEntry(id=new_id("fee"), lawyer_id=lawyer.id, review_id=review.id,
                         kind=kind, urgency=review.urgency, amount_clp=amount,
                         rate_version_id=rate.id if rate else None, accrued_at=now)
    db.add(fee)
    review.fee_amount_clp = amount

    _add_history(db, review.id, 4, "lawyer", lawyer.user_id, "delivered")
    await audit(db, lawyer.user_id, "audit_delivery",
                {"review_id": review.id, "late": review.late, "fee_amount_clp": amount},
                _client_ip(request))

    owner = await db.get(User, review.user_id)
    if owner:
        notifier().send_email(owner.email, "Tu revisión fue entregada",
                              "El abogado entregó la revisión firmada de tu requerimiento.")
        if owner.phone:
            notifier().send_sms(owner.phone, "Justiniano: tu revisión fue entregada.")
    await db.commit()
    return {"id": review.id, "state": 4, "delivered_at": _iso(review.delivered_at),
            "late": review.late,
            "signature": {"name": lawyer.name, "rut": lawyer.rut, "bar": lawyer.bar,
                          "university": lawyer.university, "degree_year": lawyer.degree_year},
            "fee_entry": {"id": fee.id, "amount_clp": amount}}


# ───────────────────────── 20.22–20.25 Honorarios ───────────────────────────

def _month_bounds(month: str) -> tuple[datetime, datetime]:
    y, m = int(month[:4]), int(month[5:7])
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=timezone.utc)
    return start, end


@router.get("/lawyers/me/fees/overview")
async def fees_overview(lawyer: Lawyer = Depends(get_current_lawyer),
                        db: AsyncSession = Depends(get_db)):
    """KPIs de «Honorarios» (§20.22): acumulado del mes, conteos, bono SLA,
    tarifario vigente y próxima liquidación (día 5 del mes siguiente)."""
    now = utcnow()
    month = now.strftime("%Y-%m")
    start, end = _month_bounds(month)
    mine = LawyerFeeEntry.lawyer_id == lawyer.id
    in_month = (LawyerFeeEntry.accrued_at >= start, LawyerFeeEntry.accrued_at < end)

    accrued = (await db.execute(
        select(func.coalesce(func.sum(LawyerFeeEntry.amount_clp), 0))
        .where(mine, *in_month))).scalar_one()
    reviews_count = await _count(db, LawyerFeeEntry, mine, *in_month,
                                 LawyerFeeEntry.kind == "review")
    consultations_count = await _count(db, LawyerFeeEntry, mine, *in_month,
                                       LawyerFeeEntry.kind == "consultation")

    delivered = await _count(db, Review, Review.lawyer_id == lawyer.id, Review.state == 4,
                             Review.delivered_at >= start, Review.delivered_at < end)
    late = await _count(db, Review, Review.lawyer_id == lawyer.id, Review.state == 4,
                        Review.delivered_at >= start, Review.delivered_at < end,
                        Review.late.is_(True))
    sla_pct = round(100 * (delivered - late) / delivered) if delivered else 100

    rate = await _rate_at(db, now)
    rates = {"review_std_clp": rate.review_std_clp if rate else 0,
             "review_urgent_clp": rate.review_urgent_clp if rate else 0,
             "consultation_std_clp": rate.consultation_std_clp if rate else 0,
             "consultation_urgent_clp": rate.consultation_urgent_clp if rate else 0,
             "sla_bonus_pct": rate.sla_bonus_pct if rate else 0}

    next_settlement = date(now.year + (now.month == 12), now.month % 12 + 1, 5)

    month_expr = func.to_char(LawyerFeeEntry.accrued_at, "YYYY-MM")
    rows = (await db.execute(
        select(month_expr.label("m"), func.sum(LawyerFeeEntry.amount_clp))
        .where(mine, month_expr != month)
        .group_by(month_expr).order_by(month_expr.desc()).limit(6))).all()
    monthly_history = [{"month": m, "total_clp": int(total)} for m, total in rows]

    return {"month": month, "accrued_clp": int(accrued),
            "reviews_count": reviews_count, "consultations_count": consultations_count,
            "sla_compliance_pct": sla_pct, "sla_bonus_pct": rates["sla_bonus_pct"],
            "next_settlement_date": next_settlement.isoformat(),
            "rates": rates, "monthly_history": monthly_history}


@router.get("/lawyers/me/fees/entries")
async def fees_entries(month: str | None = Query(None),
                       p: PageParams = Depends(),
                       lawyer: Lawyer = Depends(get_current_lawyer),
                       db: AsyncSession = Depends(get_db)):
    """Detalle de honorarios del período (§20.23). month=YYYY-MM (por defecto
    el mes en curso); paginado con la suma del período (sum_clp)."""
    if month is None:
        month = utcnow().strftime("%Y-%m")
    elif not _MONTH_RE.match(month):
        raise _validation("month", "formato YYYY-MM")
    start, end = _month_bounds(month)
    conds = (LawyerFeeEntry.lawyer_id == lawyer.id,
             LawyerFeeEntry.accrued_at >= start, LawyerFeeEntry.accrued_at < end)
    total = await _count(db, LawyerFeeEntry, *conds)
    sum_clp = (await db.execute(
        select(func.coalesce(func.sum(LawyerFeeEntry.amount_clp), 0))
        .where(*conds))).scalar_one()
    rows = (await db.execute(select(LawyerFeeEntry).where(*conds)
                             .order_by(LawyerFeeEntry.accrued_at.desc())
                             .offset(p.offset).limit(p.page_size))).scalars().all()
    items = []
    for e in rows:
        review = await db.get(Review, e.review_id)
        owner = await db.get(User, review.user_id) if review else None
        items.append({"id": e.id, "review_id": e.review_id, "kind": e.kind,
                      "urgency": e.urgency,
                      "title": await _review_title(db, review) if review else None,
                      "client_company": (owner.company or owner.name) if owner else None,
                      "amount_clp": e.amount_clp, "accrued_at": _iso(e.accrued_at)})
    return page_response(items, total, p) | {"sum_clp": int(sum_clp)}


@router.get("/lawyers/me/fees/settlements")
async def fees_settlements(p: PageParams = Depends(),
                           lawyer: Lawyer = Depends(get_current_lawyer),
                           db: AsyncSession = Depends(get_db)):
    """Historial de liquidaciones mensuales (§20.24)."""
    conds = (LawyerSettlement.lawyer_id == lawyer.id,)
    total = await _count(db, LawyerSettlement, *conds)
    rows = (await db.execute(select(LawyerSettlement).where(*conds)
                             .order_by(LawyerSettlement.period.desc())
                             .offset(p.offset).limit(p.page_size))).scalars().all()
    items = [{"id": s.id, "period": s.period, "reviews_count": s.reviews_count,
              "consultations_count": s.consultations_count,
              "sla_bonus_pct": s.sla_bonus_pct, "total_clp": s.total_clp,
              "status": s.status,
              "paid_at": s.paid_at.strftime("%Y-%m-%d") if s.paid_at else None}
             for s in rows]
    return page_response(items, total, p)


@router.post("/lawyers/me/fees/settlements/{settlement_id}/download")
async def download_settlement(settlement_id: str,
                              lawyer: Lawyer = Depends(get_current_lawyer),
                              db: AsyncSession = Depends(get_db)):
    """URL de descarga del PDF de la liquidación (§20.25), SAS de 15 minutos.

    Si el comprobante aún no existe genera un PDF simple (HTML → bytes) y lo
    persiste en el contenedor settlements.
    """
    check_id(settlement_id, "liq")
    st = (await db.execute(
        select(LawyerSettlement).where(LawyerSettlement.id == settlement_id,
                                       LawyerSettlement.lawyer_id == lawyer.id)
    )).scalar_one_or_none()
    if st is None:
        raise not_found()
    if not st.receipt_blob:
        html = (f"<html><body><h1>Liquidación de honorarios</h1>"
                f"<p>Abogado: {lawyer.name} · RUT {lawyer.rut}</p>"
                f"<p>Período: {st.period}</p>"
                f"<p>Revisiones: {st.reviews_count} · Consultas: {st.consultations_count}</p>"
                f"<p>Bono SLA: {st.sla_bonus_pct}%</p>"
                f"<p>Total: ${st.total_clp:,} CLP</p></body></html>")
        st.receipt_blob = blob_client().put(get_settings().blob_container_settlements,
                                            f"{st.id}.pdf", html.encode("utf-8"))
        await db.commit()
    return {"download_url": blob_client().sas_url(st.receipt_blob),
            "expires_in": get_settings().sas_ttl_seconds}
