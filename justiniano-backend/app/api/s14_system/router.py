"""§14 Sistema — endpoints operacionales (health probes de Azure)."""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import ApiError
from app.integrations.blob import blob_client

router = APIRouter(tags=["§14 Sistema"])

VERSION = "2.3"


@router.get("/health")
async def health(db: AsyncSession = Depends(get_db)) -> dict:
    """Sonda de salud (§14.1): verifica PostgreSQL (SELECT 1) y Blob Storage.

    Pública (sin JWT). Si alguna dependencia no responde → 503 unhealthy.
    """
    db_ok = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        import traceback
        db_ok = False
        print("DEBUG: health DB check failed:")
        traceback.print_exc()

    blob_ok = True
    try:
        blob_client()
    except Exception:
        blob_ok = False

    if not (db_ok and blob_ok):
        raise ApiError(503, "unhealthy", "Alguna dependencia no responde.",
                       {"database": "ok" if db_ok else "error",
                        "blob_storage": "ok" if blob_ok else "error"})
    return {"status": "ok", "version": VERSION, "database": "ok", "blob_storage": "ok"}
