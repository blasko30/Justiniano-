"""§9 Consultas — chat con agentes IA: listado, hilo, mensajes y exportación."""
import html as html_mod
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ApiError, forbidden, not_found
from app.core.pagination import PageParams, page_response
from app.core.ratelimit import limit
from app.core.security import check_id, new_id, utcnow
from app.integrations.ai import ai_client
from app.integrations.blob import blob_client
from app.models import (Agent, Attachment, Consultation, Message, Plan, PlanVersion,
                        Subscription, User)

from app.api.s09_consultations.schemas import (ConsultationCreateIn, ConsultationExportIn,
                                               MessageCreateIn)

router = APIRouter(tags=["§9 Consultas"])

DISCLAIMER = "Orientación generada por IA · Verifique antes de actuar"
FREE_PLAN_ID = "p_free"


# ── Helpers de plan y cuotas (§4) ────────────────────────────────────────
async def _plan_limits(db: AsyncSession, user: User) -> tuple[dict, bool]:
    """Límites vigentes de la suscripción del usuario y si su plan es Gratuito.

    Lee Subscription.plan_version_id → PlanVersion.limits con fallback a
    Plan.limits; usuario sin suscripción = plan Gratuito `p_free` (§4, conv. 8).
    """
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


def _interactions_limit(limits: dict) -> int | None:
    """Límite de interacciones por consulta si el plan lo define; -1 = ilimitado."""
    value = limits.get("interactions_per_consultation")
    if value is None or value == -1:
        return None
    return int(value)


async def _questions_used_this_month(db: AsyncSession, user: User) -> int:
    """Preguntas (mensajes del usuario) enviadas en el mes calendario en curso."""
    month_start = utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return (await db.execute(
        select(func.count(Message.id))
        .join(Consultation, Message.consultation_id == Consultation.id)
        .where(Consultation.user_id == user.id, Message.role == "user",
               Message.created_at >= month_start))).scalar_one()


async def _own_consultation(db: AsyncSession, user: User, consultation_id: str) -> Consultation:
    """Consulta del propio usuario; ajena o inexistente → 404 (BOLA §2.9)."""
    check_id(consultation_id, "con")
    cons = (await db.execute(select(Consultation).where(
        Consultation.id == consultation_id,
        Consultation.user_id == user.id))).scalar_one_or_none()
    if cons is None:
        raise not_found()
    return cons


async def _serialize_messages(db: AsyncSession, messages: list[Message]) -> list[dict]:
    """Serializa mensajes según los ejemplos de §9.4 (user con adjuntos, assistant con base legal)."""
    user_msg_ids = [m.id for m in messages if m.role == "user"]
    atts_by_msg: dict[str, list[dict]] = {}
    if user_msg_ids:
        rows = (await db.execute(select(Attachment).where(
            Attachment.message_id.in_(user_msg_ids)))).scalars().all()
        for a in rows:
            atts_by_msg.setdefault(a.message_id, []).append(
                {"id": a.id, "name": a.name, "size_bytes": a.size_bytes})
    items = []
    for m in messages:
        if m.role == "assistant":
            items.append({"id": m.id, "role": "assistant", "content": m.content,
                          "legal_basis": m.legal_basis or [], "disclaimer": DISCLAIMER,
                          "suggestions": m.suggestions or [],
                          "suggested_document_format_id": m.suggested_format_id,
                          "created_at": m.created_at})
        else:
            items.append({"id": m.id, "role": "user", "content": m.content,
                          "attachments": atts_by_msg.get(m.id, []),
                          "created_at": m.created_at})
    return items


# ── Endpoints ────────────────────────────────────────────────────────────
@router.get("/consultations")
async def list_consultations(agent: str | None = None,
                             p: PageParams = Depends(),
                             user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)) -> dict:
    """Lista paginada de consultas del usuario (§9.1), con contador de interacciones."""
    limits, _ = await _plan_limits(db, user)
    il = _interactions_limit(limits)
    base = select(Consultation).where(Consultation.user_id == user.id)
    if agent is not None:
        base = base.where(Consultation.agent_id == agent)
    total = (await db.execute(
        select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (await db.execute(
        base.order_by(Consultation.created_at.desc()).offset(p.offset).limit(p.page_size)
    )).scalars().all()
    items = [{"id": c.id, "agent_id": c.agent_id, "title": c.title or None,
              "interactions_used": c.interactions_used, "interactions_limit": il,
              "last_message_at": c.last_message_at, "created_at": c.created_at}
             for c in rows]
    return page_response(items, total, p)


@router.post("/consultations", status_code=201)
async def create_consultation(body: ConsultationCreateIn,
                              user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)) -> dict:
    """Abre un nuevo hilo con un agente (§9.2).

    Valida server-side la cuota de preguntas/mes del plan (402
    consultation_quota_exceeded con used/limit) y el bloqueo de agentes
    premium por plan (403 agent_locked). Agente inexistente → 404.
    """
    agent = await db.get(Agent, body.agent_id)
    if agent is None:
        raise not_found("Agente inexistente.")

    limits, _ = await _plan_limits(db, user)

    # Bloqueo por plan: el plan habilita los primeros N agentes del catálogo
    # (no premium primero); un agente premium fuera del cupo → agent_locked.
    agents_limit = limits.get("agents", -1)
    if agents_limit is not None and agents_limit != -1:
        catalog = (await db.execute(select(Agent))).scalars().all()
        allowed = {a.id for a in sorted(catalog, key=lambda a: (a.premium, a.sort, a.id))[:int(agents_limit)]}
        if agent.id not in allowed:
            raise forbidden("agent_locked", "Agente no incluido en su plan.")

    # Cuota de preguntas (interacciones) por mes (§4).
    q_limit = limits.get("questions_month", -1)
    if q_limit is not None and q_limit != -1:
        used = await _questions_used_this_month(db, user)
        if used >= int(q_limit):
            raise ApiError(402, "consultation_quota_exceeded",
                           "Alcanzó el límite de preguntas de su plan este mes.",
                           {"used": used, "limit": int(q_limit)})

    now = utcnow()
    agent_name = (agent.name_i18n or {}).get("es", agent.id)
    cons = Consultation(id=new_id("con"), user_id=user.id, agent_id=agent.id,
                        title="", interactions_used=0, created_at=now, last_message_at=now)
    # El título queda vacío hasta la primera interacción (se devuelve null).
    db.add(cons)
    welcome = Message(id=new_id("msg"), consultation_id=cons.id, role="assistant",
                      content=f"Soy su agente {agent_name}. Describa su situación y le orientaré "
                              "según la legislación chilena vigente.",
                      legal_basis=None, suggestions=None, created_at=now)
    db.add(welcome)
    await db.commit()
    return {"id": cons.id, "agent_id": cons.agent_id, "title": None,
            "interactions_used": 0, "interactions_limit": _interactions_limit(limits),
            "welcome_message": {"id": welcome.id, "role": "assistant",
                                "content": welcome.content, "created_at": welcome.created_at}}


@router.get("/consultations/{consultation_id}")
async def get_consultation(consultation_id: str,
                           user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)) -> dict:
    """Cabecera del hilo más la última página de mensajes embebida (§9.3)."""
    cons = await _own_consultation(db, user, consultation_id)
    limits, _ = await _plan_limits(db, user)
    total = (await db.execute(select(func.count(Message.id)).where(
        Message.consultation_id == cons.id))).scalar_one()
    last = (await db.execute(
        select(Message).where(Message.consultation_id == cons.id)
        .order_by(Message.created_at.desc()).limit(20))).scalars().all()
    items = await _serialize_messages(db, list(reversed(last)))
    return {"id": cons.id, "agent_id": cons.agent_id, "jurisdiction": "CL",
            "title": cons.title or None, "interactions_used": cons.interactions_used,
            "interactions_limit": _interactions_limit(limits),
            "messages": {"items": items, "total": total},
            "created_at": cons.created_at}


@router.get("/consultations/{consultation_id}/messages")
async def list_messages(consultation_id: str,
                        p: PageParams = Depends(),
                        user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    """Mensajes del hilo, paginados en orden cronológico (§9.4)."""
    cons = await _own_consultation(db, user, consultation_id)
    total = (await db.execute(select(func.count(Message.id)).where(
        Message.consultation_id == cons.id))).scalar_one()
    rows = (await db.execute(
        select(Message).where(Message.consultation_id == cons.id)
        .order_by(Message.created_at.asc()).offset(p.offset).limit(p.page_size)
    )).scalars().all()
    return page_response(await _serialize_messages(db, rows), total, p)


@router.post("/consultations/{consultation_id}/messages", status_code=201,
             dependencies=[Depends(limit("ai", 10, 60, by="user"))])
async def send_message(consultation_id: str, body: MessageCreateIn,
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)) -> dict:
    """Envía el mensaje del usuario y devuelve la respuesta completa del agente (§9.5).

    Aplica el límite de interacciones por consulta si el plan lo define
    (409 interaction_limit_reached); valida adjuntos (422 invalid_attachment);
    autogenera el título en la primera interacción (52 caracteres).
    """
    cons = await _own_consultation(db, user, consultation_id)
    limits, _ = await _plan_limits(db, user)
    il = _interactions_limit(limits)
    if il is not None and cons.interactions_used >= il:
        raise ApiError(409, "interaction_limit_reached",
                       "Alcanzó el límite de interacciones de esta consulta.",
                       {"used": cons.interactions_used, "limit": il})

    # Adjuntos: existentes, del propio usuario y sin mensaje asociado (§9.5).
    attachments: list[Attachment] = []
    for att_id in body.attachment_ids or []:
        try:
            check_id(att_id, "att")
        except ApiError:
            raise ApiError(422, "invalid_attachment", "Adjunto inexistente o de otro usuario.")
        att = (await db.execute(select(Attachment).where(
            Attachment.id == att_id, Attachment.user_id == user.id))).scalar_one_or_none()
        if att is None or att.message_id is not None:
            raise ApiError(422, "invalid_attachment", "Adjunto inexistente o de otro usuario.")
        attachments.append(att)

    agent = await db.get(Agent, cons.agent_id)
    agent_name = (agent.name_i18n or {}).get("es", cons.agent_id) if agent else cons.agent_id

    # Historial delimitado (defensa de prompt injection: datos, no instrucciones).
    prior = (await db.execute(
        select(Message).where(Message.consultation_id == cons.id)
        .order_by(Message.created_at.asc()))).scalars().all()
    history = [{"role": m.role, "content": m.content} for m in prior]
    user_prompt = body.content
    if attachments:
        user_prompt += "\n\n[Adjuntos del usuario: " + ", ".join(a.name for a in attachments) + "]"
    history.append({"role": "user", "content": user_prompt})

    try:
        result = ai_client().chat(agent_name, agent.legal_basis if agent else None,
                                  user.company or "", history)
    except Exception:
        raise ApiError(503, "ai_unavailable", "El servicio de IA no está disponible; reintente.")

    now = utcnow()
    user_msg = Message(id=new_id("msg"), consultation_id=cons.id, role="user",
                       content=body.content, created_at=now)
    db.add(user_msg)
    await db.flush()
    for att in attachments:
        att.message_id = user_msg.id
    assistant_msg = Message(id=new_id("msg"), consultation_id=cons.id, role="assistant",
                            content=result.get("content", ""),
                            legal_basis=result.get("legal_basis") or [],
                            suggestions=result.get("suggestions") or [],
                            suggested_format_id=result.get("suggested_format_id"),
                            created_at=now)
    db.add(assistant_msg)

    if not cons.title:  # primera interacción: autogenera el título (§9.5)
        cons.title = body.content[:52]
    cons.interactions_used += 1
    cons.last_message_at = now
    await db.commit()

    return {"user_message": {"id": user_msg.id, "role": "user", "content": user_msg.content,
                             "attachments": [{"id": a.id, "name": a.name} for a in attachments],
                             "created_at": user_msg.created_at},
            "assistant_message": {"id": assistant_msg.id, "role": "assistant",
                                  "content": assistant_msg.content,
                                  "legal_basis": assistant_msg.legal_basis or [],
                                  "disclaimer": DISCLAIMER,
                                  "suggestions": assistant_msg.suggestions or [],
                                  "suggested_document_format_id": assistant_msg.suggested_format_id,
                                  "created_at": assistant_msg.created_at},
            "consultation_title": cons.title,
            "interactions_used": cons.interactions_used,
            "interactions_limit": il}


@router.post("/consultations/{consultation_id}/export")
async def export_consultation(consultation_id: str, body: ConsultationExportIn,
                              user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)) -> dict:
    """Exporta el hilo completo y devuelve una URL de descarga temporal (§9.6)."""
    cons = await _own_consultation(db, user, consultation_id)
    rows = (await db.execute(
        select(Message).where(Message.consultation_id == cons.id)
        .order_by(Message.created_at.asc()))).scalars().all()

    parts = [f"<h1>{html_mod.escape(cons.title or 'Consulta')}</h1>",
             f"<p>Agente: {html_mod.escape(cons.agent_id)} · Jurisdicción: CL</p>"]
    for m in rows:
        who = "Usuario" if m.role == "user" else "Agente"
        parts.append(f"<div class='msg {m.role}'><strong>{who}</strong>"
                     f"<p>{html_mod.escape(m.content)}</p></div>")
    parts.append(f"<footer>{html_mod.escape(DISCLAIMER)}</footer>")
    content = ("<html><head><meta charset='utf-8'></head><body>"
               + "".join(parts) + "</body></html>").encode("utf-8")

    settings = get_settings()
    blob_path = blob_client().put(settings.blob_container_exports,
                                  f"{cons.id}.{body.format}", content)
    expires_at = utcnow() + timedelta(seconds=settings.sas_ttl_seconds)
    return {"download_url": blob_client().sas_url(blob_path),
            "format": body.format, "expires_at": expires_at}
