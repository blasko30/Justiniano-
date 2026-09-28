"""§8 — Catálogos: países, agentes IA y formatos de documento.

Catálogos localizados según Accept-Language (es, en, pt, fr; fallback es).
Los países son estáticos (solo CL disponible); agentes, áreas y formatos
viven en BD. GET /agents acepta JWT opcional para marcar agentes bloqueados
según el límite `agents` del plan del usuario.
"""
import re

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ApiError, not_found
from app.core.security import decode_access_token
from app.models import Agent, DocumentArea, DocumentFormat, Plan, PlanVersion, Subscription, User

router = APIRouter(tags=["§08 Catálogos"])

_LANGS = ("es", "en", "pt", "fr")
_FMT_ID_RE = re.compile(r"^fmt_[A-Za-z0-9_]{1,60}$")

# Catálogo estático de países/jurisdicciones (§8.1): solo CL disponible.
_COUNTRIES = (
    ("CL", {"es": "Chile", "en": "Chile", "pt": "Chile", "fr": "Chili"}, True, "+56"),
    ("AR", {"es": "Argentina", "en": "Argentina", "pt": "Argentina", "fr": "Argentine"}, False, "+54"),
    ("BR", {"es": "Brasil", "en": "Brazil", "pt": "Brasil", "fr": "Brésil"}, False, "+55"),
    ("CO", {"es": "Colombia", "en": "Colombia", "pt": "Colômbia", "fr": "Colombie"}, False, "+57"),
    ("MX", {"es": "México", "en": "Mexico", "pt": "México", "fr": "Mexique"}, False, "+52"),
    ("PE", {"es": "Perú", "en": "Peru", "pt": "Peru", "fr": "Pérou"}, False, "+51"),
    ("UY", {"es": "Uruguay", "en": "Uruguay", "pt": "Uruguai", "fr": "Uruguay"}, False, "+598"),
    ("US", {"es": "Estados Unidos", "en": "United States", "pt": "Estados Unidos", "fr": "États-Unis"}, False, "+1"),
)

# Límite de agentes de respaldo si no existe la fila del plan Gratuito (§4).
_FREE_AGENTS_LIMIT = 2


# ── Helpers internos ─────────────────────────────────────────────────────
def _lang(request: Request) -> str:
    """Idioma preferido de Accept-Language dentro de es|en|pt|fr; fallback es (§2.6)."""
    header = request.headers.get("Accept-Language", "")
    for part in header.split(","):
        code = part.split(";")[0].strip().lower()[:2]
        if code in _LANGS:
            return code
    return "es"


def _t(i18n: dict | None, lang: str) -> str:
    """Texto localizado con fallback a es y luego a cualquier valor disponible."""
    i18n = i18n or {}
    return i18n.get(lang) or i18n.get("es") or next(iter(i18n.values()), "")


async def _optional_user(request: Request, db: AsyncSession) -> User | None:
    """JWT opcional (§8.2): sin cabecera → anónimo; token inválido → 401."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    payload = decode_access_token(auth[7:])
    user = await db.get(User, payload["sub"])
    if user is None or user.deleted_at is not None:
        raise ApiError(401, "unauthorized", "Token ausente, expirado o inválido.")
    return user


async def _agents_limit(db: AsyncSession, user: User) -> int:
    """Límite `agents` vigente del plan del usuario (regla 8, §4). -1 = ilimitado."""
    sub = (await db.execute(select(Subscription)
                            .where(Subscription.user_id == user.id))).scalar_one_or_none()
    limits = None
    if sub and sub.plan_version_id:
        pv = await db.get(PlanVersion, sub.plan_version_id)
        limits = pv.limits if pv else None
    if limits is None:
        plan_id = sub.plan_id if sub else (user.plan_id or "p_free")
        plan = await db.get(Plan, plan_id) or await db.get(Plan, "p_free")
        limits = plan.limits if plan else {}
    return limits.get("agents", _FREE_AGENTS_LIMIT)


# ── 8.1 Países / jurisdicciones ──────────────────────────────────────────
@router.get("/catalog/countries")
async def list_countries(request: Request):
    """Países con disponibilidad de jurisdicción y prefijo telefónico (pública)."""
    lang = _lang(request)
    return {"items": [{"code": code, "name": _t(names, lang),
                       "available": available, "dial": dial}
                      for code, names, available, dial in _COUNTRIES]}


# ── 8.2 Listar agentes IA ────────────────────────────────────────────────
@router.get("/agents")
async def list_agents(request: Request, db: AsyncSession = Depends(get_db)):
    """Agentes localizados. Con token incluye el flag `locked` según el plan;
    sin token (landing) se omite `locked`."""
    lang = _lang(request)
    user = await _optional_user(request, db)
    agents = (await db.execute(select(Agent).order_by(Agent.sort, Agent.id))).scalars().all()

    max_agents = await _agents_limit(db, user) if user else None
    items = []
    for idx, a in enumerate(agents):
        item = {"id": a.id, "name": _t(a.name_i18n, lang),
                "description": _t(a.description_i18n, lang),
                "icon": a.icon, "color": a.color, "legal_basis": a.legal_basis}
        if user is not None:
            # Los premium fuera del límite del plan van bloqueados (upsell).
            item["locked"] = False if max_agents == -1 else idx >= max_agents
        items.append(item)
    return {"items": items}


# ── 8.3 Áreas de documentos ──────────────────────────────────────────────
@router.get("/catalog/document-areas")
async def list_document_areas(request: Request, user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    """Áreas del paso 1 del modal Generar documento, con formatos disponibles por área."""
    lang = _lang(request)
    counts = dict((await db.execute(
        select(DocumentFormat.area_id, func.count()).group_by(DocumentFormat.area_id))).all())
    areas = (await db.execute(select(DocumentArea)
                              .order_by(DocumentArea.sort, DocumentArea.id))).scalars().all()
    return {"items": [{"id": a.id, "name": _t(a.name_i18n, lang),
                       "formats_count": counts.get(a.id, 0)} for a in areas]}


# ── 8.4 Formatos por área ────────────────────────────────────────────────
@router.get("/catalog/document-formats")
async def list_document_formats(request: Request, area: str | None = None,
                                area_id: str | None = None,
                                user: User = Depends(get_current_user),
                                db: AsyncSession = Depends(get_db)):
    """Plantillas de documento filtradas por área (se acepta `area` o `area_id`)."""
    lang = _lang(request)
    area = area or area_id
    if not area:
        raise ApiError(422, "validation_error", "El parámetro area es obligatorio.",
                       {"fields": [{"field": "area", "issue": "requerido"}]})
    if await db.get(DocumentArea, area) is None:
        raise ApiError(422, "validation_error", "Área desconocida.",
                       {"fields": [{"field": "area", "issue": "área desconocida"}]})
    formats = (await db.execute(select(DocumentFormat)
                                .where(DocumentFormat.area_id == area)
                                .order_by(DocumentFormat.id))).scalars().all()
    return {"items": [{"id": f.id, "name": _t(f.name_i18n, lang), "type": f.doc_type,
                       "area": f.area_id, "notarial_signature_required": f.notarial_required}
                      for f in formats]}


# ── 8.5 Esquema de campos de un formato ──────────────────────────────────
@router.get("/catalog/document-formats/{format_id}/fields")
async def get_format_fields(format_id: str, request: Request,
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    """Formulario dinámico del paso 2: secciones, campos y marcaje de sensibles."""
    lang = _lang(request)
    if not _FMT_ID_RE.match(format_id or ""):
        raise not_found("Formato inexistente.")
    fmt = await db.get(DocumentFormat, format_id)
    if fmt is None:
        raise not_found("Formato inexistente.")
    schema = fmt.fields_schema or {}
    if isinstance(schema, dict):
        if "sections" in schema:
            sections = schema.get("sections", [])
        elif "fields" in schema:
            sections = [{"title": "Datos del documento", "fields": schema.get("fields", [])}]
        else:
            sections = []
    else:
            sections = schema
    if isinstance(schema, dict) and "contains_sensitive_fields" in schema:
        contains_sensitive = bool(schema["contains_sensitive_fields"])
    else:
        contains_sensitive = any(f.get("sensitive") for s in sections
                                 for f in (s.get("fields") or []) if isinstance(f, dict))
    return {"format_id": fmt.id, "name": _t(fmt.name_i18n, lang),
            "sections": sections, "contains_sensitive_fields": contains_sensitive}
