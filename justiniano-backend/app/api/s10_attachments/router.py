"""§10 Adjuntos — subida, consulta y eliminación de archivos (Azure Blob)."""
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ApiError, not_found
from app.core.security import check_id, new_id, utcnow
from app.integrations.blob import FileRejected, blob_client, validate_upload
from app.models import Attachment, Consultation, Subscription, User

router = APIRouter(tags=["§10 Adjuntos"])

FREE_PLAN_ID = "p_free"


async def _user_plan_is_free(db: AsyncSession, user: User) -> bool:
    """Determina si el usuario está en el plan Gratuito (§4).

    Usuario sin suscripción = plan Gratuito `p_free` (convención 8).
    """
    sub = (await db.execute(
        select(Subscription).where(Subscription.user_id == user.id))).scalar_one_or_none()
    if sub is None:
        return (user.plan_id or FREE_PLAN_ID) == FREE_PLAN_ID
    return sub.plan_id == FREE_PLAN_ID


async def _own_attachment(db: AsyncSession, user: User, attachment_id: str) -> Attachment:
    """Adjunto del propio usuario; ajeno o inexistente → 404 (BOLA §2.9)."""
    check_id(attachment_id, "att")
    att = (await db.execute(select(Attachment).where(
        Attachment.id == attachment_id, Attachment.user_id == user.id))).scalar_one_or_none()
    if att is None:
        raise not_found()
    return att


@router.post("/attachments", status_code=201)
async def upload_attachment(file: UploadFile = File(...),
                            consultation_id: str | None = Form(None),
                            sensitive: bool = Form(False),
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)) -> dict:
    """Sube un adjunto (§10.1): valida extensión/MIME/tamaño y almacena en Blob.

    Errores: 413 file_too_large; 422 file_invalid. En plan Gratuito se fija
    purge_at = ahora + 30 días (retención §4.3).
    """
    if consultation_id is not None:
        check_id(consultation_id, "con")
        cons = (await db.execute(select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.user_id == user.id))).scalar_one_or_none()
        if cons is None:
            raise not_found("Consulta no encontrada.")

    data = await file.read()
    try:
        blob_name = validate_upload(data, file.content_type or "", file.filename or "archivo")
    except FileRejected as exc:
        status = 413 if exc.code == "file_too_large" else 422
        raise ApiError(status, exc.code, exc.message)

    settings = get_settings()
    blob_path = blob_client().put(settings.blob_container_attachments, blob_name, data)

    now = utcnow()
    purge_at = now + timedelta(days=30) if await _user_plan_is_free(db, user) else None
    att = Attachment(id=new_id("att"), user_id=user.id, message_id=None, blob_path=blob_path,
                     name=file.filename or blob_name, size_bytes=len(data),
                     content_type=file.content_type or "application/octet-stream",
                     sensitive=sensitive, purge_at=purge_at, created_at=now)
    db.add(att)
    await db.commit()
    return {"id": att.id, "name": att.name, "size_bytes": att.size_bytes,
            "content_type": att.content_type, "created_at": att.created_at}


@router.get("/attachments/{attachment_id}")
async def get_attachment(attachment_id: str,
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)) -> dict:
    """Metadatos del adjunto más URL de descarga firmada (SAS, 15 min) (§10.2)."""
    att = await _own_attachment(db, user, attachment_id)
    expires_at = utcnow() + timedelta(seconds=get_settings().sas_ttl_seconds)
    return {"id": att.id, "name": att.name, "size_bytes": att.size_bytes,
            "content_type": att.content_type,
            "download_url": blob_client().sas_url(att.blob_path),
            "expires_at": expires_at, "created_at": att.created_at}


@router.delete("/attachments/{attachment_id}", status_code=204)
async def delete_attachment(attachment_id: str,
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)) -> Response:
    """Elimina un adjunto aún no enviado (§10.3): borra blob y fila; 204.

    Si ya está asociado a un mensaje → 409 attachment_in_use.
    """
    att = await _own_attachment(db, user, attachment_id)
    if att.message_id is not None:
        raise ApiError(409, "attachment_in_use", "El adjunto ya forma parte de un mensaje enviado.")
    blob_client().delete(att.blob_path)
    await db.delete(att)
    await db.commit()
    return Response(status_code=204)
