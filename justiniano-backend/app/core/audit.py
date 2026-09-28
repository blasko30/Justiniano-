"""Auditoría (§2.9, §4.3)."""
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import new_id
from app.models import AuditEvent


async def audit(db: AsyncSession, user_id: str | None, event: str,
                detail: dict | None = None, ip: str | None = None) -> None:
    db.add(AuditEvent(id=new_id("aud"), user_id=user_id, event=event, detail=detail, ip=ip))
