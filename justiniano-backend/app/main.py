"""Justiniano API v2.3 — FastAPI (§1, §2)."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.errors import install_handlers

from app.api.s06_auth.router import router as auth_router
from app.api.s07_users.router import router as users_router
from app.api.s08_catalog.router import router as catalog_router
from app.api.s09_consultations.router import router as consultations_router
from app.api.s10_attachments.router import router as attachments_router
from app.api.s11_documents.router import router as documents_router
from app.api.s12_reviews.router import router as reviews_router
from app.api.s13_billing.router import router as billing_router
from app.api.s14_system.router import router as system_router
from app.api.s15_admin_metrics.router import router as admin_metrics_router
from app.api.s16_admin_plans.router import router as admin_plans_router
from app.api.s17_admin_operations.router import router as admin_operations_router
from app.api.s18_admin_sales.router import router as admin_sales_router
from app.api.s19_sales_me.router import router as sales_me_router
from app.api.s20_lawyers.router import router as lawyers_router
from app.api.s21_admin_reviewers.router import router as admin_reviewers_router

settings = get_settings()
print("DEBUG: settings.database_url=", settings.database_url)
app = FastAPI(title=settings.app_name, version="2.3",
              description="API REST de Justiniano (especificación v2.3).")

app.add_middleware(CORSMiddleware,
                   allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
                   allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
install_handlers(app)

P = settings.api_prefix
# Nota de orden: lawyers_router (§20) va ANTES que reviews_router (§12) para que
# la ruta literal GET /reviews/pool no sea capturada por GET /reviews/{id}.
for r in (auth_router, users_router, catalog_router, consultations_router, attachments_router,
          documents_router, lawyers_router, reviews_router, billing_router, system_router,
          admin_metrics_router, admin_plans_router, admin_operations_router, admin_sales_router,
          sales_me_router, admin_reviewers_router):
    app.include_router(r, prefix=P)
