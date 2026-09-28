"""§19 — Portal del vendedor (CRM), rol seller.

Aislamiento estricto (§19): toda consulta filtra por el seller del token a
nivel de SQL; un cliente ajeno devuelve 404 (anti-IDOR) y las referencias
comparativas del equipo se entregan como agregados anónimos.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import require_seller_access
from app.core.errors import ApiError, not_found
from app.core.pagination import PageParams, page_response
from app.core.security import check_id, new_id, utcnow
from app.models import Client, Plan, SalesContract, Seller, Subscription, User

from app.api.s19_sales_me.schemas import ClientCreateIn, ClientPatchIn, ProjectionIn, Stage

router = APIRouter(tags=["§19 Portal del vendedor"])

FREE_PLAN_ID = "p_free"
MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
_PERIODS = {"month", "quarter", "year"}
_STAGES = set(Stage.__args__)
_UNSET = object()  # sentinel: distingue projection omitida de null explícito


# ── Utilidades del módulo ────────────────────────────────────────────────
def _period_start(period: str | None):
    if period is not None and period not in _PERIODS:
        raise ApiError(422, "validation_error", "Período desconocido.",
                       {"fields": [{"field": "period", "issue": "month | quarter | year"}]})
    now = utcnow()
    month = {"year": 1, "quarter": ((now.month - 1) // 3) * 3 + 1}.get(period or "month", now.month)
    return now.replace(month=month, day=1, hour=0, minute=0, second=0, microsecond=0)


def _period_factor(period: str | None) -> int:
    return {"quarter": 3, "year": 12}.get(period or "month", 1)


def _pct(part: int | float, whole: int | float) -> int:
    return round(part * 100 / whole) if whole else 0


def _mm(value: int | float) -> float:
    return round(value / 1_000_000, 1)


def _weighted(projection: dict | None) -> int:
    if not projection:
        return 0
    return round(int(projection.get("monthly_amount_clp") or 0)
                 * int(projection.get("probability_pct") or 0) / 100)


async def _pipeline(db: AsyncSession, seller_id: str) -> dict:
    """Totales del pipeline de la cartera propia (bruto y ponderado)."""
    projections = (await db.execute(
        select(Client.projection).where(Client.seller_id == seller_id,
                                        Client.projection.is_not(None)))).scalars().all()
    return {"total_monthly_clp": sum(int(p.get("monthly_amount_clp") or 0) for p in projections),
            "weighted_clp": sum(_weighted(p) for p in projections)}


async def _validate_projection(db: AsyncSession, projection: ProjectionIn) -> dict:
    """Reglas de negocio del objeto_proyeccion: plan activo no gratuito."""
    plan = await db.get(Plan, projection.plan_id)
    if plan is None or not plan.active or plan.id == FREE_PLAN_ID \
            or not (plan.price_monthly_clp or plan.corporate):
        raise ApiError(422, "validation_error", "plan_id debe ser un plan de pago activo.",
                       {"fields": [{"field": "projection.plan_id", "issue": "plan inválido"}]})
    return projection.model_dump()


async def _my_conversion(db: AsyncSession, seller_id: str) -> tuple[int, int]:
    """(elegibles, convertidos) free→pago en 90 días dentro de la cartera propia."""
    rows = (await db.execute(
        select(User.id, User.created_at, User.plan_id)
        .join(Client, Client.linked_user_id == User.id)
        .where(Client.seller_id == seller_id, User.deleted_at.is_(None)))).all()
    if not rows:
        return 0, 0
    subs = {s.user_id: s for s in (await db.execute(
        select(Subscription).where(Subscription.user_id.in_([r[0] for r in rows])))).scalars()}
    converted = 0
    for uid, ucreated, plan_id in rows:
        sub = subs.get(uid)
        if sub is not None and sub.plan_id != FREE_PLAN_ID:
            converted += 1 if (sub.created_at is None or ucreated is None
                               or (sub.created_at - ucreated).days <= 90) else 0
        elif sub is None and plan_id not in (None, FREE_PLAN_ID):
            converted += 1
    return len(rows), converted


def _client_item(client: Client, current_plan: str | None) -> dict:
    return {"id": client.id, "company": client.company, "contact": client.contact,
            "email": client.email, "city": client.city, "industry": client.industry,
            "status": client.status, "linked_user_id": client.linked_user_id,
            "current_plan": current_plan, "projection": client.projection}


# ── 19.1 Mi resumen de ventas ────────────────────────────────────────────
@router.get("/sales/me/overview")
async def my_overview(period: str | None = Query(None),
                      seller: Seller = Depends(require_seller_access),
                      db: AsyncSession = Depends(get_db)):
    """KPIs propios del período y series comparativas anónimas del equipo.

    team_avg y team_best se calculan sobre todos los vendedores activos y se
    devuelven sin identificadores; con menos de 3 activos se omite team_best
    (§19.1 Seguridad, evita reidentificación).
    """
    start, factor = _period_start(period), _period_factor(period)
    now = utcnow()

    sales_clp, contracts = (await db.execute(
        select(func.coalesce(func.sum(SalesContract.monthly_amount_clp), 0), func.count())
        .where(SalesContract.seller_id == seller.id,
               SalesContract.closed_at >= start))).one()
    target_clp = seller.target_monthly_clp * factor
    pipeline = await _pipeline(db, seller.id)
    open_opportunities = (await db.execute(
        select(func.count()).select_from(Client)
        .where(Client.seller_id == seller.id, Client.projection.is_not(None)))).scalar() or 0
    eligible, converted = await _my_conversion(db, seller.id)

    # Series del año en curso: propia, promedio del equipo y mejor vendedor
    active_ids = set((await db.execute(
        select(Seller.id).where(Seller.active.is_(True)))).scalars().all()) | {seller.id}
    year_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    per_seller: dict[str, list[int]] = {sid: [0] * now.month for sid in active_ids}
    rows = (await db.execute(
        select(SalesContract.seller_id, SalesContract.monthly_amount_clp, SalesContract.closed_at)
        .where(SalesContract.closed_at >= year_start))).all()
    for sid, amount, closed_at in rows:
        if sid in per_seller:
            per_seller[sid][closed_at.month - 1] += amount

    me_serie = per_seller[seller.id]
    n_active = len(active_ids)
    team_avg = [sum(s[i] for s in per_seller.values()) / n_active for i in range(now.month)]
    series = {"months": MESES_ES[:now.month], "me_mm": [_mm(v) for v in me_serie],
              "team_avg_mm": [_mm(v) for v in team_avg]}
    if n_active >= 3:  # agregado anónimo: sin identidad del mejor vendedor
        best = max(per_seller.values(), key=sum)
        series["team_best_mm"] = [_mm(v) for v in best]

    return {"kpis": {"sales_clp": int(sales_clp), "target_clp": target_clp,
                     "attainment_pct": _pct(sales_clp, target_clp), "contracts": int(contracts),
                     "free_to_paid_pct": _pct(converted, eligible),
                     "pipeline_weighted_clp": pipeline["weighted_clp"],
                     "open_opportunities": int(open_opportunities)},
            "series": series}


# ── 19.2 Mi cartera de clientes ──────────────────────────────────────────
@router.get("/sales/me/clients")
async def my_clients(status: str | None = Query(None), stage: str | None = Query(None),
                     p: PageParams = Depends(),
                     seller: Seller = Depends(require_seller_access),
                     db: AsyncSession = Depends(get_db)):
    """Cartera propia paginada con proyección y totales del pipeline."""
    if status is not None and status not in ("client", "prospect"):
        raise ApiError(422, "validation_error", "Estado desconocido.",
                       {"fields": [{"field": "status", "issue": "client | prospect"}]})
    if stage is not None and stage not in _STAGES:
        raise ApiError(422, "validation_error", "Etapa desconocida.",
                       {"fields": [{"field": "stage", "issue": "prospect | demo | proposal | negotiation | closing"}]})

    stmt = select(Client).where(Client.seller_id == seller.id)  # aislamiento en SQL (§19)
    if status is not None:
        stmt = stmt.where(Client.status == status)
    clients = (await db.execute(stmt.order_by(Client.created_at.desc()))).scalars().all()
    if stage is not None:
        clients = [c for c in clients if c.projection and c.projection.get("stage") == stage]

    total = len(clients)
    page_clients = clients[p.offset:p.offset + p.page_size]

    linked_ids = [c.linked_user_id for c in page_clients if c.linked_user_id]
    plans_by_user: dict[str, str | None] = {}
    if linked_ids:
        plans_by_user = {uid: plan_id for uid, plan_id in (await db.execute(
            select(User.id, User.plan_id).where(User.id.in_(linked_ids)))).all()}

    items = [_client_item(c, plans_by_user.get(c.linked_user_id)) for c in page_clients]
    response = page_response(items, total, p)
    response["pipeline"] = await _pipeline(db, seller.id)
    return response


# ── 19.3 Informar nuevo cliente ──────────────────────────────────────────
@router.post("/sales/me/clients", status_code=201)
async def create_client(body: ClientCreateIn,
                        seller: Seller = Depends(require_seller_access),
                        db: AsyncSession = Depends(get_db)):
    """Crea un cliente CRM en la cartera propia, con proyección opcional.

    El duplicado de empresa se compara normalizado en todo el CRM y el 409 no
    revela a qué vendedor pertenece la cartera (§19.3 Seguridad).
    """
    normalized = " ".join(body.company.lower().split())
    companies = (await db.execute(select(Client.company))).scalars().all()
    if any(" ".join(c.lower().split()) == normalized for c in companies):
        raise ApiError(409, "client_already_assigned",
                       "La empresa ya pertenece a una cartera del CRM.")

    linked_user_id = None
    if body.email:
        linked_user_id = (await db.execute(
            select(User.id).where(func.lower(User.email) == body.email,
                                  User.deleted_at.is_(None)))).scalar_one_or_none()

    projection = None
    if body.projection is not None:
        projection = await _validate_projection(db, body.projection)

    client = Client(id=new_id("cli"), seller_id=seller.id, company=body.company,
                    contact=body.contact, email=body.email, phone=body.phone,
                    city=body.city, industry=body.industry, status=body.status,
                    linked_user_id=linked_user_id, note=body.note, projection=projection)
    db.add(client)
    await db.flush()
    pipeline = await _pipeline(db, seller.id)
    await db.commit()
    return {"id": client.id, "linked_user_id": linked_user_id, "seller_id": seller.id,
            "pipeline": {"weighted_clp": pipeline["weighted_clp"]}}


# ── 19.4 Actualizar cliente y proyección de cierre ───────────────────────
@router.patch("/sales/me/clients/{client_id}")
async def patch_client(client_id: str, body: ClientPatchIn,
                       seller: Seller = Depends(require_seller_access),
                       db: AsyncSession = Depends(get_db)):
    """Edita datos del cliente y crea/actualiza/retira su proyección.

    projection usa un sentinel para distinguir tres casos: omitida (no se
    modifica), null explícito (se retira del pipeline) u objeto (se valida y
    reemplaza). Cliente ajeno → 404 (nunca 403, §2.9).
    """
    check_id(client_id, "cli")
    client = (await db.execute(
        select(Client).where(Client.id == client_id,
                             Client.seller_id == seller.id))).scalar_one_or_none()
    if client is None:
        raise not_found("Cliente no encontrado.")

    for field in ("company", "contact", "email", "phone", "city", "status", "note"):
        value = getattr(body, field)
        if value is not None:
            setattr(client, field, value)

    projection = body.projection if "projection" in body.model_fields_set else _UNSET
    if projection is None:
        client.projection = None            # retiro explícito del pipeline
    elif projection is not _UNSET:
        client.projection = await _validate_projection(db, projection)

    await db.flush()
    pipeline = await _pipeline(db, seller.id)
    await db.commit()
    return {"id": client.id, "updated": True, "pipeline": pipeline}
