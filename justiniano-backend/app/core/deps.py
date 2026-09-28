"""Dependencias de autenticación y autorización (§2.3)."""
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import ApiError, forbidden
from app.core.security import decode_access_token
from app.models import Lawyer, Seller, User

ONBOARDING_EXEMPT_PREFIXES = ("/auth/", "/users/me/onboarding", "/users/me/terms-acceptance", "/health")


def _bearer(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise ApiError(401, "unauthorized", "Token ausente, expirado o inválido.")
    return auth[7:]


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    payload = decode_access_token(_bearer(request))
    user = await db.get(User, payload["sub"])
    if user is None or user.deleted_at is not None:
        raise ApiError(401, "unauthorized", "Token ausente, expirado o inválido.")
    # Gate de verificación/onboarding (§2.3, solo clientes)
    path = request.url.path.removeprefix("/api/v1")
    if user.role == "client" and not path.startswith(ONBOARDING_EXEMPT_PREFIXES):
        if not user.email_verified or not user.onboarding_done:
            raise forbidden("onboarding_required", "Complete la verificación y el onboarding.")
    request.state.user = user
    return user


def require_role(*roles: str):
    async def dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise forbidden("role_required", "Su rol no permite esta operación.")
        return user
    return dep


require_admin = require_role("admin")
require_client = require_role("client")


async def require_seller_access(user: User = Depends(get_current_user),
                                db: AsyncSession = Depends(get_db)) -> Seller:
    """/sales/me/**: rol seller, o lawyer con promoter=true (§2.3 v2.2)."""
    if user.role == "seller":
        seller = (await db.execute(select(Seller).where(Seller.user_id == user.id))).scalar_one_or_none()
        if seller and seller.active:
            return seller
    elif user.role == "lawyer":
        lawyer = (await db.execute(select(Lawyer).where(Lawyer.user_id == user.id))).scalar_one_or_none()
        if lawyer and lawyer.promoter and lawyer.suspended_at is None:
            seller = (await db.execute(select(Seller).where(Seller.user_id == user.id))).scalar_one_or_none()
            if seller is None:  # el perfil comercial se crea al activar la preferencia
                from app.core.security import new_id
                seller = Seller(id=new_id("sel"), user_id=user.id, active=True)
                db.add(seller)
                await db.flush()
            return seller
    raise forbidden("role_required", "Su rol no permite esta operación.")


async def get_current_lawyer(user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)) -> Lawyer:
    if user.role != "lawyer":
        raise forbidden("role_required", "Su rol no permite esta operación.")
    lawyer = (await db.execute(select(Lawyer).where(Lawyer.user_id == user.id))).scalar_one_or_none()
    if lawyer is None:
        raise forbidden("role_required", "Su rol no permite esta operación.")
    if lawyer.suspended_at is not None:
        raise forbidden("account_suspended", "Su cuenta de revisor está suspendida.")
    return lawyer


async def require_verified_lawyer(lawyer: Lawyer = Depends(get_current_lawyer)) -> Lawyer:
    """Endpoints marcados «verificado» (§20): exige acreditación aprobada."""
    if lawyer.verification_status != "verified":
        raise forbidden("lawyer_not_verified", "Su acreditación aún no está aprobada.")
    return lawyer
