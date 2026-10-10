"""§11 Documentos — generación con IA, visor, edición, descarga y disclaimer."""
import re
from datetime import date as date_cls
from datetime import timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ApiError, not_found
from app.core.pagination import PageParams, page_response
from app.core.security import check_id, new_id, utcnow
from app.integrations.ai import ai_client
from app.integrations.blob import blob_client
from app.models import (AuditEvent, Consultation, Document, DocumentFormat, Lawyer, Plan,
                        PlanVersion, Review, Subscription, User)

from app.api.s11_documents.schemas import (DocumentCreateIn, DocumentDownloadIn,
                                           DocumentFieldsPatchIn)

router = APIRouter(tags=["§11 Documentos"])

FREE_PLAN_ID = "p_free"
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


# ── Helpers de plan y cuotas (§4) ────────────────────────────────────────
async def _plan_limits(db: AsyncSession, user: User) -> tuple[dict, bool]:
    """Límites vigentes de la suscripción (PlanVersion.limits → Plan.limits)."""
    sub = (await db.execute(
        select(Subscription).where(Subscription.user_id == user.id))).scalar_one_or_none()
    plan_id = sub.plan_id if sub else (user.plan_id or FREE_PLAN_ID)
    limits: dict | None = None
    if sub and sub.plan_version_id:
        pv = await db.get(PlanVersion, sub.plan_version_id)
        limits = pv.limits if pv else None
    if limits is None:
        plan = await db.get(Plan, plan_id)
        limits = plan.limits if plan else {}
    return limits or {}, plan_id == FREE_PLAN_ID


def _month_start():
    return utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)


# ── Helpers de fields_schema ─────────────────────────────────────────────
def _schema_fields(fmt: DocumentFormat) -> list[dict]:
    """Lista de campos declarados en fields_schema (admite {'fields': [...]} o [...])."""
    schema = fmt.fields_schema or {}
    if isinstance(schema, dict):
        return schema.get("fields", []) or []
    return schema or []


def _validation_error(field: str, issue: str) -> ApiError:
    return ApiError(422, "validation_error", "Los datos enviados no son válidos.",
                    {"fields": [{"field": field, "issue": issue}]})


def _validate_fields(values: dict, declared: list[dict]) -> None:
    """Valida el diccionario campo→valor contra el fields_schema del formato (§11.2).

    Claves no declaradas → 422; cada valor según el tipo del campo (text ≤500
    sin control chars; date ISO; number entero 0–10^9; select/checkbox_group
    solo opciones declaradas).
    """
    by_key = {(f.get("key") or f.get("name")): f for f in declared}
    for key, value in values.items():
        spec = by_key.get(key)
        if spec is None:
            raise _validation_error(key, "clave de campo desconocida para el formato")
        if value is None:
            continue
        ftype = spec.get("type", "text")
        if ftype == "text":
            if not isinstance(value, str) or len(value) > 500 or _CONTROL_RE.search(value):
                raise _validation_error(key, "texto ≤500 caracteres sin caracteres de control")
        elif ftype == "date":
            if not isinstance(value, str):
                raise _validation_error(key, "fecha ISO (YYYY-MM-DD) requerida")
            try:
                date_cls.fromisoformat(value)
            except ValueError:
                raise _validation_error(key, "fecha ISO (YYYY-MM-DD) requerida")
        elif ftype == "number":
            if isinstance(value, bool) or not isinstance(value, int) or not (0 <= value <= 10**9):
                raise _validation_error(key, "entero entre 0 y 10^9")
        elif ftype == "select":
            if value not in (spec.get("options") or []):
                raise _validation_error(key, "opción no declarada")
        elif ftype == "checkbox_group":
            options = spec.get("options") or []
            if not isinstance(value, list) or any(v not in options for v in value):
                raise _validation_error(key, "opciones no declaradas")


def _missing_fields(values: dict, declared: list[dict]) -> list[str]:
    """Campos obligatorios sin valor (vacío, None o ausente)."""
    missing = []
    for f in declared:
        if not f.get("required"):
            continue
        k = f.get("key") or f.get("name")
        v = values.get(k)
        if v is None or v == "" or v == []:
            missing.append(k)
    return missing


def _completion(values: dict, declared: list[dict]) -> tuple[int, int]:
    """(campos completados, total de campos declarados)."""
    total = len(declared)
    completed = sum(1 for f in declared
                    if values.get(f.get("key")) not in (None, "", []))
    return completed, total


async def _own_document(db: AsyncSession, user: User, document_id: str) -> Document:
    """Documento del propio usuario; ajeno o inexistente → 404 (BOLA §2.9)."""
    check_id(document_id, "doc")
    doc = (await db.execute(select(Document).where(
        Document.id == document_id, Document.user_id == user.id))).scalar_one_or_none()
    if doc is None:
        raise not_found()
    return doc


# ── Endpoints ────────────────────────────────────────────────────────────
@router.get("/documents/{doc_id}/download-local")
async def download_local(doc_id: str, fmt: str = "html",
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """Descarga local para desarrollo."""
    from fastapi.responses import Response
    check_id(doc_id, "doc")
    doc = await db.get(Document, doc_id)
    if doc is None or doc.user_id != user.id:
        raise not_found("Documento no encontrado.")
    html = doc.content_html or "<p>Documento sin contenido.</p>"
    full_html = f"<html><body>{html}</body></html>".encode("utf-8")
    return Response(content=full_html, media_type="text/html",
                    headers={"Content-Disposition": f'attachment; filename="{doc.name}.html"'})


@router.post("/documents", status_code=201)
async def create_document(body: DocumentCreateIn, request: Request,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)) -> dict:
    """Genera el documento a partir del formato y el formulario dinámico (§11.2).

    Valida los campos contra fields_schema (clave desconocida → 422), exige
    consentimiento para campos sensibles (audit_sens), aplica la cuota mensual
    de documentos (402 document_quota_exceeded) y deja estado draft, o pending
    si faltan obligatorios con complete_later=true.
    """
    check_id(body.format_id, "fmt")
    fmt = await db.get(DocumentFormat, body.format_id)
    if fmt is None:
        raise not_found("Formato inexistente.")

    if body.consultation_id is not None:
        check_id(body.consultation_id, "con")
        cons = (await db.execute(select(Consultation).where(
            Consultation.id == body.consultation_id,
            Consultation.user_id == user.id))).scalar_one_or_none()
        if cons is None:
            raise not_found("Consulta no encontrada.")

    declared = _schema_fields(fmt)
    _validate_fields(body.fields, declared)

    # Campos sensibles: exigen sensitive_data_consent=true y auditan audit_sens (§4.3).
    has_sensitive = any(f.get("sensitive") for f in declared)
    if has_sensitive and body.sensitive_data_consent is not True:
        raise ApiError(422, "sensitive_consent_required",
                       "El formato contiene campos sensibles: se requiere consentimiento.")

    # Cuota de documentos por mes (§4).
    limits, _ = await _plan_limits(db, user)
    d_limit = limits.get("documents_month", -1)
    if d_limit is not None and d_limit != -1:
        used = (await db.execute(select(func.count(Document.id)).where(
            Document.user_id == user.id,
            Document.created_at >= _month_start()))).scalar_one()
        if used >= int(d_limit):
            raise ApiError(402, "document_quota_exceeded",
                           "Alcanzó el límite mensual de documentos de su plan.",
                           {"used": used, "limit": int(d_limit)})

    missing = _missing_fields(body.fields, declared)
    if missing and not body.complete_later:
        raise ApiError(422, "missing_required_fields",
                       "Hay campos obligatorios sin completar.", {"fields": missing})

    content_html = await ai_client().generate_document(fmt.template_body or "", body.fields)
    now = utcnow()
    doc = Document(id=new_id("doc"), user_id=user.id, format_id=fmt.id,
                   consultation_id=body.consultation_id,
                   name=(fmt.name_i18n or {}).get("es", fmt.id),
                   status="pending" if missing else "draft",
                   fields=body.fields, content_html=content_html,
                   missing_fields=missing, created_at=now)
    db.add(doc)
    if has_sensitive:
        await audit(db, user.id, "audit_sens",
                    {"document_id": doc.id, "format_id": fmt.id},
                    request.client.host if request.client else None)
    await db.commit()

    completed, ftotal = _completion(body.fields, declared)
    return {"id": doc.id, "name": doc.name, "status": doc.status,
            "fields_completed": completed, "fields_total": ftotal,
            "missing_fields": missing, "review_id": None, "created_at": doc.created_at}


@router.get("/documents/{document_id}")
async def get_document(document_id: str,
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)) -> dict:
    """Visor del documento: contenido, campos, faltantes y revisión si existe (§11.3)."""
    doc = await _own_document(db, user, document_id)
    fmt = await db.get(DocumentFormat, doc.format_id)

    review_out = None
    review = (await db.execute(
        select(Review).where(Review.document_id == doc.id)
        .order_by(Review.created_at.desc()).limit(1))).scalar_one_or_none()
    if review is not None:
        lawyer_out = None
        if review.lawyer_id:
            lawyer = await db.get(Lawyer, review.lawyer_id)
            if lawyer:
                lawyer_out = {"name": lawyer.name, "rut": lawyer.rut}
        review_out = {"id": review.id, "state": review.state,
                      "lawyer": lawyer_out, "observations": review.observations}

    return {"id": doc.id, "name": doc.name,
            "type": fmt.doc_type if fmt else None,
            "area": fmt.area_id if fmt else None,
            "status": doc.status, "content_html": doc.content_html,
            "fields": doc.fields or {}, "missing_fields": doc.missing_fields or [],
            "legal_basis": [], "disclaimer_removed": doc.disclaimer_removed,
            "review": review_out, "created_at": doc.created_at}


@router.patch("/documents/{document_id}/fields")
async def patch_document_fields(document_id: str, body: DocumentFieldsPatchIn,
                                user: User = Depends(get_current_user),
                                db: AsyncSession = Depends(get_db)) -> dict:
    """Actualiza campos del formulario y re-renderiza el documento (§11.4).

    Solo permitido en draft/pending; en review o ready → 409 document_locked.
    Recalcula missing_fields y el estado (pending ↔ draft).
    """
    doc = await _own_document(db, user, document_id)
    if doc.status in ("review", "ready"):
        raise ApiError(409, "document_locked",
                       "Un documento en revisión o revisado no admite edición de campos.")
    fmt = await db.get(DocumentFormat, doc.format_id)
    declared = _schema_fields(fmt) if fmt else []
    _validate_fields(body.fields, declared)

    merged = dict(doc.fields or {})
    merged.update(body.fields)
    if len(merged) > 200:
        raise _validation_error("fields", "máximo 200 claves")
    missing = _missing_fields(merged, declared)

    doc.fields = merged
    doc.missing_fields = missing
    doc.status = "pending" if missing else "draft"
    doc.content_html = await ai_client().generate_document((fmt.template_body or "") if fmt else "", merged)
    await db.commit()

    completed, ftotal = _completion(merged, declared)
    return {"id": doc.id, "status": doc.status, "fields_completed": completed,
            "fields_total": ftotal, "missing_fields": missing}


@router.post("/documents/{document_id}/download")
async def download_document(document_id: str, body: DocumentDownloadIn, request: Request,
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)) -> dict:
    """Exporta el documento a docx|pdf|odt con confirmación de advertencia (§11.5).

    Exige warning_acknowledged=true (queda auditado como audit_dl), aplica la
    cuota mensual de descargas del plan y devuelve URL firmada temporal.
    """
    doc = await _own_document(db, user, document_id)
    if body.warning_acknowledged is not True:
        raise ApiError(422, "consent_required",
                       "Debe confirmar la advertencia para descargar el documento.")

    # Cuota de descargas por mes (§4: «Documentos a descargar / mes»).
    limits, _ = await _plan_limits(db, user)
    d_limit = limits.get("documents_month", -1)
    if d_limit is not None and d_limit != -1:
        used = (await db.execute(select(func.count(AuditEvent.id)).where(
            AuditEvent.user_id == user.id, AuditEvent.event == "audit_dl",
            AuditEvent.created_at >= _month_start()))).scalar_one()
        if used >= int(d_limit):
            raise ApiError(402, "document_quota_exceeded",
                           "Alcanzó el límite mensual de descargas de su plan.",
                           {"used": used, "limit": int(d_limit)})

    settings = get_settings()
    content = (doc.content_html or "").encode("utf-8")
    blob_path = blob_client().put(settings.blob_container_documents,
                                  f"{doc.id}.{body.format}", content)
    await audit(db, user.id, "audit_dl", {"document_id": doc.id, "format": body.format},
                request.client.host if request.client else None)
    await db.commit()
    expires_at = utcnow() + timedelta(seconds=settings.sas_ttl_seconds)
    if get_settings().fake_integrations:
        from fastapi.responses import HTMLResponse
        full_html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>{doc.name}</title>
<style>body{{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:20px;line-height:1.6}}</style>
</head><body>{doc.content_html or ''}</body></html>"""
        import base64
        b64 = base64.b64encode(full_html.encode("utf-8")).decode()
        data_url = f"data:text/html;base64,{b64}"
        return {"download_url": data_url, "format": "html", "expires_at": expires_at}


@router.delete("/documents/{document_id}/disclaimer", status_code=204)
async def remove_disclaimer(document_id: str, request: Request,
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)) -> Response:
    """Elimina la nota de exención de responsabilidad (irreversible) (§11.6).

    Marca disclaimer_removed y registra el evento de auditoría audit_rm; 204.
    Si ya fue eliminada → 409 already_removed.
    """
    doc = await _own_document(db, user, document_id)
    if doc.disclaimer_removed:
        raise ApiError(409, "already_removed", "La nota de advertencia ya fue eliminada.")
    now = utcnow()
    doc.disclaimer_removed = True
    doc.disclaimer_removed_at = now
    await audit(db, user.id, "audit_rm", {"document_id": doc.id},
                request.client.host if request.client else None)
    await db.commit()
    return Response(status_code=204)
