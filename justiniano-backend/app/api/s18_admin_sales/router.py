"""§18 — Administración: ventas y vendedores (consola, rol admin).

Endpoints: resumen de ventas, rendimiento por vendedor, conversión free→pago,
alta y modificación de vendedores y corrección/reasignación de clientes CRM.
"""
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.database import get_db
from app.core.deps import require_admin
from app.core.errors import ApiError, not_found
from app.core.security import check_id, hash_password, new_id, new_refresh_token, utcnow
from app.integrations.notify import notifier
from app.models import Client, OtpCode, SalesContract, Seller, Subscription, User

from app.api.s18_admin_sales.schemas import ClientAdminPatchIn, SellerCreateIn, SellerPatchIn

router = APIRouter(tags=["§18 Admin ventas"])

FREE_PLAN_ID = "p_free"
MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
_PERIODS = {"month", "quarter", "year"}


# ── Utilidades del módulo ────────────────────────────────────────────────
def _iso(dt) -> str | None:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def _period_start(period: str | None):
    """Inicio del período (mes/trimestre/año calendario) en UTC. None → mes."""
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


def _weighted(projection: dict | None) -> int:
    """Aporte ponderado de una proyección: monto mensual × probabilidad."""
    if not projection:
        return 0
    return round(int(projection.get("monthly_amount_clp") or 0)
                 * int(projection.get("probability_pct") or 0) / 100)


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


async def _conversion_rows(db: AsyncSession, since=None) -> list[tuple]:
    """Cuentas free asignadas (clients con linked_user_id) y su conversión a
    plan de pago dentro de 90 días. Devuelve (seller_id, industry, city, converted)."""
    stmt = (select(Client.seller_id, Client.industry, Client.city,
                   User.id, User.created_at, User.plan_id)
            .join(User, User.id == Client.linked_user_id)
            .where(User.deleted_at.is_(None)))
    if since is not None:
        stmt = stmt.where(Client.created_at >= since)
    rows = (await db.execute(stmt)).all()
    subs = {s.user_id: s for s in (await db.execute(select(Subscription))).scalars()}
    out = []
    for seller_id, industry, city, uid, ucreated, plan_id in rows:
        sub = subs.get(uid)
        if sub is not None and sub.plan_id != FREE_PLAN_ID:
            converted = (sub.created_at is None or ucreated is None
                         or (sub.created_at - ucreated).days <= 90)
        else:
            converted = sub is None and plan_id not in (None, FREE_PLAN_ID)
        out.append((seller_id, industry, city, bool(converted)))
    return out


async def _year_monthly_sales(db: AsyncSession) -> dict[str, list[int]]:
    """Ventas por vendedor y mes del año en curso (índice 0 = enero)."""
    now = utcnow()
    start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    rows = (await db.execute(
        select(SalesContract.seller_id, SalesContract.monthly_amount_clp, SalesContract.closed_at)
        .where(SalesContract.closed_at >= start))).all()
    series: dict[str, list[int]] = {}
    for seller_id, amount, closed_at in rows:
        serie = series.setdefault(seller_id, [0] * now.month)
        serie[closed_at.month - 1] += amount
    return series


def _mm(value: int | float) -> float:
    return round(value / 1_000_000, 1)


# ── 18.1 Resumen de ventas ───────────────────────────────────────────────
@router.get("/admin/sales/overview")
async def sales_overview(period: str | None = Query(None),
                         admin: User = Depends(require_admin),
                         db: AsyncSession = Depends(get_db)):
    """KPIs de ventas del período + serie mensual histórica y proyección."""
    start, factor = _period_start(period), _period_factor(period)
    now = utcnow()

    sales_clp, contracts = (await db.execute(
        select(func.coalesce(func.sum(SalesContract.monthly_amount_clp), 0), func.count())
        .where(SalesContract.closed_at >= start))).one()
    target_clp = ((await db.execute(
        select(func.coalesce(func.sum(Seller.target_monthly_clp), 0))
        .where(Seller.active.is_(True)))).scalar() or 0) * factor

    conv = await _conversion_rows(db, since=start)
    converted = sum(1 for *_ignored, ok in conv if ok)

    # Pipeline ponderado global (§18: Σ monto mensual × probabilidad)
    projections = (await db.execute(
        select(Client.projection).where(Client.projection.is_not(None)))).scalars().all()
    weighted = sum(_weighted(p) for p in projections)

    # Serie mensual del año en curso y proyección (tendencia + pipeline)
    per_seller = await _year_monthly_sales(db)
    monthly = [sum(s[i] for s in per_seller.values()) for i in range(now.month)]
    ratios = [monthly[i] / monthly[i - 1] for i in range(1, len(monthly)) if monthly[i - 1] > 0]
    growth = sum(ratios[-3:]) / len(ratios[-3:]) if ratios else 1.0
    base, projection = float(monthly[-1] if monthly else 0), []
    for _ in range(4):
        base *= growth
        projection.append(base + weighted / 3)

    return {
        "totals": {"sales_clp": int(sales_clp), "target_clp": int(target_clp),
                   "attainment_pct": _pct(sales_clp, target_clp), "contracts": int(contracts),
                   "free_to_paid_pct": _pct(converted, len(conv))},
        "series": {"months": MESES_ES[:now.month],
                   "monthly_sales_mm": [_mm(v) for v in monthly],
                   "projection_mm": [_mm(v) for v in projection]},
        "projection_next_quarter_clp": int(round(sum(projection[:3]))),
    }


# ── 18.2 Rendimiento por vendedor ────────────────────────────────────────
@router.get("/admin/sales/sellers")
async def sales_by_seller(period: str | None = Query(None),
                          include_inactive: bool = Query(False),
                          admin: User = Depends(require_admin),
                          db: AsyncSession = Depends(get_db)):
    """Tabla de ventas por vendedor; con include_inactive sirve de gestión."""
    start, factor = _period_start(period), _period_factor(period)

    stmt = select(Seller, User).join(User, User.id == Seller.user_id)
    if not include_inactive:
        stmt = stmt.where(Seller.active.is_(True))
    sellers = (await db.execute(stmt.order_by(Seller.created_at))).all()

    by_seller = {sid: (int(n), int(total)) for sid, n, total in (await db.execute(
        select(SalesContract.seller_id, func.count(),
               func.coalesce(func.sum(SalesContract.monthly_amount_clp), 0))
        .where(SalesContract.closed_at >= start).group_by(SalesContract.seller_id))).all()}

    pipe: dict[str, int] = {}
    for sid, projection in (await db.execute(
            select(Client.seller_id, Client.projection)
            .where(Client.projection.is_not(None)))).all():
        pipe[sid] = pipe.get(sid, 0) + _weighted(projection)

    linked: dict[str, int] = {sid: int(n) for sid, n in (await db.execute(
        select(Client.seller_id, func.count()).where(Client.linked_user_id.is_not(None))
        .group_by(Client.seller_id))).all()}

    conv: dict[str, list[int]] = {}
    for sid, *_ignored, ok in await _conversion_rows(db, since=start):
        c = conv.setdefault(sid, [0, 0])
        c[0] += 1
        c[1] += 1 if ok else 0

    items = []
    for seller, user in sellers:
        contracts, sales = by_seller.get(seller.id, (0, 0))
        target = seller.target_monthly_clp * factor
        eligible, converted = conv.get(seller.id, [0, 0])
        items.append({"seller_id": seller.id, "name": user.name, "email": user.email,
                      "active": seller.active, "sales_clp": sales, "target_clp": target,
                      "attainment_pct": _pct(sales, target), "contracts": contracts,
                      "free_to_paid_pct": _pct(converted, eligible),
                      "free_accounts_assigned": linked.get(seller.id, 0),
                      "pipeline_weighted_clp": pipe.get(seller.id, 0)})
    items.sort(key=lambda i: i["sales_clp"], reverse=True)

    team_sales = sum(i["sales_clp"] for i in items)
    team_target = sum(i["target_clp"] for i in items if i["active"])
    return {"items": items, "team_totals": {"sales_clp": team_sales, "target_clp": team_target,
                                            "attainment_pct": _pct(team_sales, team_target)}}


# ── 18.3 Conversión free → pago ──────────────────────────────────────────
@router.get("/admin/sales/conversion")
async def sales_conversion(by: str = Query(...), period: str | None = Query(None),
                           admin: User = Depends(require_admin),
                           db: AsyncSession = Depends(get_db)):
    """Conversión free→pago (90 días) agrupada por vendedor, industria o ciudad.

    `by` es enum cerrado mapeado a agregaciones predefinidas (jamás se
    interpola en SQL, §18.3 Seguridad).
    """
    if by not in ("seller", "industry", "city"):
        raise ApiError(422, "validation_error", "Agrupación desconocida.",
                       {"fields": [{"field": "by", "issue": "seller | industry | city"}]})
    start = _period_start(period)
    rows = await _conversion_rows(db, since=start)

    names = {}
    if by == "seller":
        names = {sid: name for sid, name in (await db.execute(
            select(Seller.id, User.name).join(User, User.id == Seller.user_id))).all()}

    groups: dict[str, list[int]] = {}
    for seller_id, industry, city, ok in rows:
        key = {"seller": names.get(seller_id, seller_id), "industry": industry, "city": city}[by]
        if key is None:
            continue
        g = groups.setdefault(key, [0, 0])
        g[0] += 1
        g[1] += 1 if ok else 0

    items = [{"key": key, "conversion_pct": _pct(converted, eligible),
              "converted": converted, "eligible": eligible}
             for key, (eligible, converted) in groups.items()]
    items.sort(key=lambda i: (-i["conversion_pct"], -i["eligible"]))
    return {"by": by, "items": items}


# ── 18.4 Crear vendedor ──────────────────────────────────────────────────
@router.post("/admin/sellers", status_code=201)
async def create_seller(body: SellerCreateIn, request: Request,
                        admin: User = Depends(require_admin),
                        db: AsyncSession = Depends(get_db)):
    """Crea la cuenta interna rol seller y envía la invitación por correo.

    La consola nunca crea ni transmite contraseñas (§18.4 Seguridad): se genera
    un hash aleatorio irrecuperable y un token del flujo /auth/reset-password
    (un solo uso, 30 min) con el que el vendedor fija la suya.
    """
    exists = (await db.execute(select(User.id)
                               .where(func.lower(User.email) == body.email))).first()
    if exists:
        raise ApiError(409, "email_already_registered", "El correo ya tiene una cuenta.")

    user = User(id=new_id("usr"), name=body.name, email=body.email, email_verified=True,
                phone=body.phone, password_hash=hash_password(secrets.token_urlsafe(32)),
                role="seller", onboarding_done=True)
    seller = Seller(id=new_id("sel"), user_id=user.id,
                    target_monthly_clp=body.target_monthly_clp, active=True)
    raw_token, token_hash = new_refresh_token()
    db.add_all([user, seller,
                OtpCode(id=new_id("otp"), user_id=user.id, channel="email",
                        code_hash=token_hash, purpose="reset",
                        expires_at=utcnow() + timedelta(minutes=30))])
    notifier().send_email(
        body.email, "Invitación a Justiniano — cuenta de vendedor",
        f"Hola {body.name}: se creó su cuenta de vendedor. Fije su contraseña con el "
        f"enlace de restablecimiento (válido 30 minutos). Token: {raw_token}")
    await audit(db, admin.id, "seller_created",
                {"seller_id": seller.id, "user_id": user.id, "email": body.email,
                 "target_monthly_clp": body.target_monthly_clp}, _ip(request))
    await db.commit()
    return {"seller_id": seller.id, "user_id": user.id, "invitation_sent": True}


# ── 18.5 Modificar vendedor ──────────────────────────────────────────────
@router.patch("/admin/sellers/{seller_id}")
async def patch_seller(seller_id: str, body: SellerPatchIn, request: Request,
                       admin: User = Depends(require_admin),
                       db: AsyncSession = Depends(get_db)):
    """Edita datos/meta o desactiva al vendedor (reasignando su cartera)."""
    check_id(seller_id, "sel")
    seller = await db.get(Seller, seller_id)
    if seller is None:
        raise not_found("Vendedor no encontrado.")
    user = await db.get(User, seller.user_id)

    target = None
    if body.transfer_clients_to is not None:
        check_id(body.transfer_clients_to, "sel")
        target = await db.get(Seller, body.transfer_clients_to)
        if target is None or not target.active or target.id == seller.id:
            raise ApiError(422, "validation_error",
                           "transfer_clients_to debe ser otro vendedor existente y activo.",
                           {"fields": [{"field": "transfer_clients_to", "issue": "vendedor inválido"}]})

    clients = (await db.execute(
        select(Client).where(Client.seller_id == seller.id))).scalars().all()
    if body.active is False and clients and target is None:
        raise ApiError(409, "clients_unassigned",
                       "Para desactivar debe reasignar la cartera con transfer_clients_to.")

    transferred = 0
    if target is not None:
        for client in clients:
            client.seller_id = target.id
            transferred += 1

    previous = {"name": user.name, "phone": user.phone, "active": seller.active,
                "target_monthly_clp": seller.target_monthly_clp}
    if body.name is not None:
        user.name = body.name
    if body.phone is not None:
        user.phone = body.phone
    if body.target_monthly_clp is not None:
        seller.target_monthly_clp = body.target_monthly_clp
    if body.active is not None:
        seller.active = body.active

    await audit(db, admin.id, "seller_updated",
                {"seller_id": seller.id, "previous": previous,
                 "changes": body.model_dump(exclude_none=True),
                 "clients_transferred": transferred}, _ip(request))
    await db.commit()
    return {"seller_id": seller.id, "active": seller.active, "clients_transferred": transferred}


# ── 18.6 Reasignar / corregir cliente CRM ────────────────────────────────
@router.patch("/admin/clients/{client_id}")
async def patch_client(client_id: str, body: ClientAdminPatchIn, request: Request,
                       admin: User = Depends(require_admin),
                       db: AsyncSession = Depends(get_db)):
    """Reasigna un cliente CRM a otro vendedor o corrige sus datos (audit)."""
    check_id(client_id, "cli")
    client = await db.get(Client, client_id)
    if client is None:
        raise not_found("Cliente no encontrado.")

    if body.seller_id is not None:
        check_id(body.seller_id, "sel")
        target = await db.get(Seller, body.seller_id)
        if target is None or not target.active:
            raise ApiError(422, "validation_error", "El vendedor destino no existe o está inactivo.",
                           {"fields": [{"field": "seller_id", "issue": "vendedor inválido"}]})

    previous = {"seller_id": client.seller_id, "company": client.company,
                "contact": client.contact, "city": client.city, "note": client.note}
    for field in ("seller_id", "company", "contact", "city", "note"):
        value = getattr(body, field)
        if value is not None:
            setattr(client, field, value)

    await audit(db, admin.id, "crm_client_admin_update",
                {"client_id": client.id, "previous": previous,
                 "changes": body.model_dump(exclude_none=True)}, _ip(request))
    await db.commit()
    return {"id": client.id, "seller_id": client.seller_id, "updated": True}
