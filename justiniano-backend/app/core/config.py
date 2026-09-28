"""Configuración central (§1.1 Arquitectura de referencia)."""
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Justiniano API"
    api_prefix: str = "/api/v1"
    environment: str = "dev"                      # dev | staging | prod

    database_url: str = "postgresql+asyncpg://justiniano:justiniano@localhost:5432/justiniano"

    # JWT (RS256). En prod las claves viven en Azure Key Vault (§2.3);
    # en dev se generan localmente si no existen.
    jwt_private_key_path: str = "keys/jwt_private.pem"
    jwt_public_key_path: str = "keys/jwt_public.pem"
    access_token_minutes: int = 30
    refresh_token_days: int = 30
    jwt_issuer: str = "https://api.justiniano.cl"
    jwt_audience: str = "justiniano"

    # Integraciones (§1.1). fake_integrations=True usa simuladores locales
    # intercambiables cuando no hay credenciales (dev/test).
    fake_integrations: bool = True

    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_success_url: str = "https://app.justiniano.cl/billing/success"
    stripe_cancel_url: str = "https://app.justiniano.cl/billing/cancel"

    azure_blob_connection_string: str = ""
    blob_container_attachments: str = "attachments"
    blob_container_documents: str = "documents"
    blob_container_exports: str = "exports"
    blob_container_accreditations: str = "accreditations"
    blob_container_settlements: str = "settlements"
    blob_local_dir: str = "/tmp/justiniano-blobs"   # respaldo del simulador
    sas_ttl_seconds: int = 900                      # 15 min (§1.1)

    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_deployment: str = "gpt-4o"

    acs_connection_string: str = ""                 # Azure Communication Services
    email_sender: str = "no-reply@justiniano.cl"

    key_vault_url: str = ""                         # opcional: claves JWT desde Key Vault

    cors_origins: str = "https://app.justiniano.cl,https://admin.justiniano.cl"

    # Límites de tasa (§2.7)
    rate_general_per_min: int = 120
    rate_ai_messages_per_min: int = 10
    rate_otp_per_hour: int = 5
    rate_login_per_15min: int = 10
    rate_signup_per_hour: int = 5

    terms_current_version: str = "2026-06"

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
