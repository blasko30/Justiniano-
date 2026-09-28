"""§16 — Administración: gestión de planes (CRUD con baja lógica y versionado)."""
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.database import get_db
from app.core.deps import require_admin
from app.core.errors import ApiError, not_found
from app.core.pagination import PageParams, page_response
from app.core.security import new_id, nfc, utcnow
from app.models import Plan, PlanVersion, User

from .schemas import PlanCreateIn, PlanPatchIn, PlanStatus

router = APIRouter(tags=["§16 Admin · planes"])


async def _users_counts(db: AsyncSession, plan_ids: list[str] | None = None) -> dict[str, int]:
    """Usuarios (no eliminados) por plan."""
    stmt = select(User.plan_id, func.count(User.id)).where(
        User.deleted_at.is_(None), User.plan_id.is_not(None)).group_by(User.plan_id)
    if plan_ids is not None:
        stmt = stmt.where(User.plan_id.in_(plan_ids))
    return {pid: n for pid, n in (await db.execute(stmt)).all()}


async def _get_plan(db: AsyncSession, plan_id: str, for_update: bool = False) -> Plan:
    stmt = select(Plan).where(Plan.id == plan_id)
    if for_update:
        stmt = stmt.with_for_update()
    plan = (await db.execute(stmt)).scalar_one_or_none()
    if plan is None:
        raise not_found("Plan inexistente.")
    return plan


async def _check_name_free(db: AsyncSession, name: str, exclude_id: str | None = None) -> None:
    stmt = select(Plan.id).where(func.lower(Plan.name) == name.lower())
    if exclude_id:
        stmt = stmt.where(Plan.id != exclude_id)
    if (await db.execute(stmt.limit(1))).first():
        raise ApiError(409, "name_in_use", "Ya existe un plan con ese nombre.")


async def _next_version(db: AsyncSession, plan_id: str) -> int:
    cur = (await db.execute(select(func.max(PlanVersion.version)).where(
        PlanVersion.plan_id == plan_id))).scalar_one()
    return (cur or 0) + 1


# ── 16.1 Listar planes (consola) ─────────────────────────────────────────
@router.get("/admin/plans")
async def list_plans_admin(status: PlanStatus = Query("all"),
                           admin: User = Depends(require_admin),
                           db: AsyncSession = Depends(get_db)):
    """Todos los planes con configuración completa, usuarios y estado."""
    stmt = select(Plan).order_by(Plan.created_at)
    if status == "active":
        stmt = stmt.where(Plan.active.is_(True))
    elif status in ("retired", "inactive"):
        stmt = stmt.where(Plan.active.is_(False))
    plans = (await db.execute(stmt)).scalars().all()
    counts = await _users_counts(db)
    return {"items": [{"id": p.id, "name": p.name, "price_monthly_clp": p.price_monthly_clp,
                       "price_annual_clp": p.price_annual_clp, "corporate": p.corporate,
                       "active": p.active, "users_count": counts.get(p.id, 0),
                       "color": p.color, "limits": p.limits} for p in plans]}


# ── 16.2 Crear plan ──────────────────────────────────────────────────────
@router.post("/admin/plans", status_code=201)
async def create_plan(body: PlanCreateIn, request: Request,
                      admin: User = Depends(require_admin),
                      db: AsyncSession = Depends(get_db)):
    """Crea un plan a la venta con su PlanVersion v1 (precios en Stripe simulados)."""
    name = nfc(body.name)
    if not body.corporate and (body.price_monthly_clp is None or body.price_annual_clp is None):
        raise ApiError(422, "validation_error", "Precio requerido si el plan no es corporativo.",
                       {"fields": [{"field": "price_monthly_clp/price_annual_clp",
                                    "issue": "null solo si corporate=true"}]})
    await _check_name_free(db, name)
    plan_id = new_id("pln")
    prices = None if body.corporate else \
        {"monthly": f"price_{plan_id}_m", "annual": f"price_{plan_id}_y"}
    plan = Plan(id=plan_id, name=name, color=body.color,
                price_monthly_clp=body.price_monthly_clp,
                price_annual_clp=body.price_annual_clp, corporate=body.corporate,
                active=True, limits=body.limits, stripe_price_ids=prices)
    db.add(plan)
    db.add(PlanVersion(id=new_id("pv"), plan_id=plan_id, version=1,
                       price_monthly_clp=body.price_monthly_clp,
                       price_annual_clp=body.price_annual_clp,
                       limits=body.limits, created_by=admin.id))
    await audit(db, admin.id, "admin_plan_create", {"plan_id": plan_id, "name": name},
                request.client.host if request.client else None)
    await db.commit()
    return {"id": plan_id, "active": True, "users_count": 0}


# ── 16.3 Modificar plan ──────────────────────────────────────────────────
@router.patch("/admin/plans/{plan_id}")
async def patch_plan(plan_id: str, body: PlanPatchIn, request: Request,
                     admin: User = Depends(require_admin),
                     db: AsyncSession = Depends(get_db)):
    """Modifica precios/límites/color/estado; cambios comerciales crean PlanVersion."""
    plan = await _get_plan(db, plan_id, for_update=True)
    prev = {"name": plan.name, "color": plan.color, "active": plan.active,
            "price_monthly_clp": plan.price_monthly_clp,
            "price_annual_clp": plan.price_annual_clp, "limits": dict(plan.limits or {})}
    versioned = False

    if body.name is not None:
        name = nfc(body.name)
        await _check_name_free(db, name, exclude_id=plan.id)
        plan.name = name
    if body.color is not None:
        plan.color = body.color
    if body.price_monthly_clp is not None and body.price_monthly_clp != plan.price_monthly_clp:
        plan.price_monthly_clp, versioned = body.price_monthly_clp, True
    if body.price_annual_clp is not None and body.price_annual_clp != plan.price_annual_clp:
        plan.price_annual_clp, versioned = body.price_annual_clp, True
    if body.limits:
        merged = dict(plan.limits or {})
        merged.update(body.limits)
        if merged != (plan.limits or {}):
            plan.limits, versioned = merged, True
    if body.active is not None:
        plan.active = body.active  # active:true reactiva un plan retirado

    version = await _next_version(db, plan.id) - 1
    if versioned:  # trazabilidad completa de condiciones comerciales
        version += 1
        db.add(PlanVersion(id=new_id("pv"), plan_id=plan.id, version=version,
                           price_monthly_clp=plan.price_monthly_clp,
                           price_annual_clp=plan.price_annual_clp,
                           limits=plan.limits, created_by=admin.id))
    await audit(db, admin.id, "admin_plan_update",
                {"plan_id": plan.id, "prev": prev,
                 "changes": body.model_dump(exclude_none=True)},
                request.client.host if request.client else None)
    await db.commit()
    return {"id": plan.id, "active": plan.active, "version": max(version, 1)}


# ── 16.4 Eliminar plan (baja lógica) ─────────────────────────────────────
@router.delete("/admin/plans/{plan_id}")
async def retire_plan(plan_id: str, request: Request,
                      admin: User = Depends(require_admin),
                      db: AsyncSession = Depends(get_db)):
    """Marca el plan «Sin uso»; los suscriptores conservan sus condiciones."""
    plan = await _get_plan(db, plan_id, for_update=True)
    if not plan.active:
        raise ApiError(409, "already_retired", "El plan ya está marcado sin uso.")
    others = (await db.execute(select(func.count()).select_from(Plan).where(
        Plan.active.is_(True), Plan.id != plan.id))).scalar_one()
    if others == 0:
        raise ApiError(409, "last_active_plan", "No se puede retirar el único plan activo.")
    plan.active = False
    counts = await _users_counts(db, [plan.id])
    await audit(db, admin.id, "admin_plan_retire",
                {"plan_id": plan.id, "prev": {"active": True},
                 "users_count": counts.get(plan.id, 0)},
                request.client.host if request.client else None)
    await db.commit()
    return {"id": plan.id, "active": False, "users_count": counts.get(plan.id, 0)}


# ── 16.5 Usuarios de un plan ─────────────────────────────────────────────
@router.get("/admin/plans/{plan_id}/users")
async def plan_users(plan_id: str, p: PageParams = Depends(),
                     admin: User = Depends(require_admin),
                     db: AsyncSession = Depends(get_db)):
    """Listado paginado de suscriptores del plan, con actividad y estado."""
    await _get_plan(db, plan_id)
    base = select(User).where(User.plan_id == plan_id, User.deleted_at.is_(None))
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    users = (await db.execute(base.order_by(desc(User.created_at))
                              .offset(p.offset).limit(p.page_size))).scalars().all()
    cutoff = utcnow().timestamp() - 30 * 86400
    items = [{"user_id": u.id, "company": u.company, "contact": u.name, "city": u.city,
              "industry": u.industry, "last_activity_at": u.last_activity_at,
              "status": "active" if (u.last_activity_at
                                     and u.last_activity_at.timestamp() >= cutoff)
              else "inactive"} for u in users]
    return page_response(items, total, p)
