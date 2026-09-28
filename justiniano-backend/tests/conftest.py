"""Fixtures de test: sqlite+aiosqlite en memoria contra app.main:app.

Estrategia de compatibilidad sqlite (los modelos usan tipos de PostgreSQL):
antes de crear las tablas se muta `Base.metadata` UNA vez —
  * `JSONB` y `ARRAY(String)` → `sqlalchemy.JSON` (sqlite los persiste como
    TEXT con serialización JSON; las listas de `specialties` sobreviven el
    round-trip). Operadores nativos de array de Postgres no están cubiertos.
  * `server_default now()` → `CURRENT_TIMESTAMP` (sqlite no conoce now()).
La app usa el mismo metadata, así que la mutación aplica también al ORM.
"""
import re
from datetime import timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import JSON, DateTime, TypeDecorator, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import DefaultClause

from app.core.database import Base, get_db
from app.core.security import create_access_token, hash_password, utcnow
import app.models as m

PASSWORD = "S3gura!2026"
_PW_HASH = None


def _pw_hash() -> str:
    global _PW_HASH
    if _PW_HASH is None:
        _PW_HASH = hash_password(PASSWORD)
    return _PW_HASH


class _TZDateTime(TypeDecorator):
    """timestamptz para sqlite: persiste naive-UTC y devuelve aware-UTC."""
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


_METADATA_PATCHED = False


def _patch_metadata_for_sqlite() -> None:
    global _METADATA_PATCHED
    if _METADATA_PATCHED:
        return
    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, (JSONB, ARRAY)):
                col.type = JSON()
            elif isinstance(col.type, DateTime) and col.type.timezone:
                col.type = _TZDateTime()
            if col.server_default is not None:  # now() → CURRENT_TIMESTAMP
                col.server_default = DefaultClause(text("CURRENT_TIMESTAMP"))
    _METADATA_PATCHED = True


@pytest_asyncio.fixture()
async def engine():
    _patch_metadata_for_sqlite()
    eng = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool,
                              connect_args={"check_same_thread": False})
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture()
async def session_factory(engine):
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest_asyncio.fixture()
async def seed(session_factory):
    """Siembra mínima: plan free, tarifario, admin, 2 abogados verified,
    cliente verificado/onboarded con créditos y 1 review en la bolsa."""
    now = utcnow()
    limits_free = {"documents_month": 2, "support_hours": 0, "agents": 2,
                   "questions_month": 30, "seats": 1, "history_months": 1}
    async with session_factory() as db:
        db.add(m.Plan(id="p_free", name="Gratuito", price_monthly_clp=0, price_annual_clp=0,
                      corporate=False, active=True, limits=limits_free))
        db.add(m.PlanVersion(id="plv_free1", plan_id="p_free", version=1,
                             price_monthly_clp=0, price_annual_clp=0, limits=limits_free))
        db.add(m.LawyerFeeRate(id="rate_v1", version=1, review_std_clp=18000,
                               review_urgent_clp=28000, consultation_std_clp=8000,
                               consultation_urgent_clp=12000, sla_bonus_pct=5,
                               effective_from=now.date().replace(month=1, day=1)))
        db.add(m.User(id="usr_admin1", name="Ignacio Valdés", email="admin@justiniano.cl",
                      email_verified=True, password_hash=_pw_hash(), role="admin",
                      onboarding_done=True))
        db.add(m.User(id="usr_law1", name="Daniela Fuentes", email="d.fuentes@correo.cl",
                      email_verified=True, password_hash=_pw_hash(), role="lawyer",
                      onboarding_done=True))
        db.add(m.Lawyer(id="law_1", user_id="usr_law1", name="Daniela Fuentes",
                        rut="16482913-8", birth_date=now.date().replace(year=1988),
                        university="Universidad de Chile", degree_year=2014,
                        verification_status="verified", verified_at=now, verified_by="usr_admin1",
                        specialties=["lab", "con"], specialties_pending=[],
                        accepts_urgent=True, available=True, paused=False, active=True))
        db.add(m.User(id="usr_law3", name="Andrés Soto", email="a.soto@correo.cl",
                      email_verified=True, password_hash=_pw_hash(), role="lawyer",
                      onboarding_done=True))
        db.add(m.Lawyer(id="law_3", user_id="usr_law3", name="Andrés Soto",
                        rut="12345678-5", birth_date=now.date().replace(year=1985),
                        university="Universidad Católica", degree_year=2011,
                        verification_status="verified", verified_at=now, verified_by="usr_admin1",
                        specialties=["lab"], specialties_pending=[],
                        accepts_urgent=True, available=True, paused=False, active=True))
        db.add(m.User(id="usr_cli1", name="María Fernanda Rojas",
                      email="mf.rojas@constructoraandes.cl", email_verified=True,
                      phone="+56981234567", phone_verified=True, password_hash=_pw_hash(),
                      company="Constructora Andes SpA", plan_id="p_free", credits=5,
                      onboarding_done=True, role="client",
                      terms_version="2026-06", terms_accepted_at=now))
        db.add(m.CreditTransaction(id="ctx_1", user_id="usr_cli1", delta=5, reason="gift"))
        db.add(m.DocumentArea(id="lab", name_i18n={"es": "Laboral"}, sort=1))
        db.add(m.DocumentFormat(id="fmt_despido", area_id="lab",
                                name_i18n={"es": "Carta de despido"}, doc_type="carta",
                                notarial_required=False,
                                fields_schema={"fields": [{"name": "empresa",
                                                           "type": "texto_corto",
                                                           "required": True,
                                                           "sensitive": False}]}))
        db.add(m.Document(id="doc_1", user_id="usr_cli1", format_id="fmt_despido",
                          name="Carta de despido por necesidades de la empresa",
                          status="review", fields={"empresa": "Constructora Andes SpA"},
                          content_html="<p>Primer párrafo de la carta.</p>"
                                       "<p>Segundo párrafo con la causal invocada.</p>"))
        db.add(m.Review(id="rev_pool1", user_id="usr_cli1", target_type="document",
                        document_id="doc_1", urgency="fast", assignment_mode="auto",
                        source="pool", area="lab", state=1, cost_credits=2,
                        notes="Validar la causal antes de notificar."))
        db.add(m.ReviewStateHistory(id="rsh_1", review_id="rev_pool1", state=1,
                                    actor_role="system", reason="Publicada en la bolsa."))
        await db.commit()
    return {
        "admin_id": "usr_admin1", "admin_email": "admin@justiniano.cl",
        "client_id": "usr_cli1", "client_email": "mf.rojas@constructoraandes.cl",
        "lawyer_id": "law_1", "lawyer_user_id": "usr_law1", "lawyer_email": "d.fuentes@correo.cl",
        "lawyer2_id": "law_3", "lawyer2_user_id": "usr_law3", "lawyer2_email": "a.soto@correo.cl",
        "pool_review_id": "rev_pool1", "document_id": "doc_1", "password": PASSWORD,
    }


@pytest_asyncio.fixture()
async def client(session_factory, seed):
    # Import tardío: no rompe la recolección si algún router está a medio escribir.
    from app.main import app
    from app.core import ratelimit
    from app.integrations.notify import _FakeNotify

    ratelimit._buckets.clear()   # evita 429 acumulados entre tests
    _FakeNotify.sent.clear()

    async def _get_db():
        async with session_factory() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def auth_headers():
    """Helper: cabeceras Bearer con un access token firmado directo."""
    def _make(user_id: str, email: str, role: str, plan: str | None = None) -> dict:
        return {"Authorization": f"Bearer {create_access_token(user_id, email, plan, role)}"}
    return _make


@pytest.fixture()
def admin_headers(seed, auth_headers):
    return auth_headers(seed["admin_id"], seed["admin_email"], "admin")


@pytest.fixture()
def sent_otp():
    """Extrae el último OTP (6 dígitos) enviado a un destino por el notifier fake."""
    from app.integrations.notify import _FakeNotify

    def _get(to: str) -> str:
        for item in reversed(_FakeNotify.sent):
            if item["to"] == to:
                match = re.search(r"\b(\d{6})\b", item.get("body", "") + " " + item.get("subject", ""))
                if match:
                    return match.group(1)
        raise AssertionError(f"No se encontró OTP enviado a {to}")
    return _get
