# Convenciones internas del código (para implementadores de módulos)

Fuente de verdad: `spec_v23.md` (especificación v2.3). Cada módulo implementa UNA sección.

## Estructura por sección
Cada sección vive en `app/api/sNN_nombre/` con TRES archivos:
- `__init__.py` (vacío)
- `schemas.py` — modelos Pydantic v2 del módulo. `model_config = ConfigDict(strict=True, extra="forbid")`
  en TODOS los modelos de entrada (§2.8). Enums con `Literal[...]`.
- `router.py` — expone `router = APIRouter(tags=["§NN Nombre"])`. Rutas SIN el prefijo `/api/v1`
  (se agrega en main.py).

## Imports disponibles (base ya construida — NO reimplementar)
- `app.core.database.get_db` → `AsyncSession` (SQLAlchemy 2.0 async).
- `app.core.deps`: `get_current_user`, `require_role`, `require_admin`, `require_client`,
  `require_seller_access` (→ Seller), `get_current_lawyer`, `require_verified_lawyer` (→ Lawyer).
- `app.core.errors.ApiError(status, code, message, details=None)` — ÚNICA forma de error de negocio.
  Formato §2.4 lo aplica el handler global. `not_found()`, `forbidden(code, msg)`.
- `app.core.security`: `new_id(prefix)`, `check_id(value, prefix)`, `create_access_token`,
  `new_refresh_token()`, `hash_opaque`, `validate_password_policy`, `hash_password`, `verify_password`,
  `new_otp()`, `verify_otp`, `normalize_rut`, `nfc`, `utcnow`.
- `app.core.pagination`: `PageParams` (Depends) + `page_response(items, total, p)` (§2.5).
- `app.core.ratelimit.limit(name, per, window_s, by="ip"|"user")` como dependencia de ruta (§2.7).
- `app.core.hours`: `add_business_hours(dt_utc, horas)`, `business_hours_between(a, b)` (§4.2).
- `app.core.audit.audit(db, user_id, event, detail, ip)`.
- `app.integrations.blob`: `blob_client()` (`put/get/delete/sas_url`), `validate_upload(data, ct, name)`
  (lanza `FileRejected(code, message)` → convertir a ApiError 413/422), contenedores en settings.
- `app.integrations.payments.stripe_client()`; `app.integrations.ai.ai_client()`;
  `app.integrations.notify.notifier()` (`send_email`, `send_sms`).
- `app.models` — TODOS los modelos ORM (leer `app/models/models.py` antes de codificar).

## Reglas duras
1. Los handlers hacen `await db.commit()` al final de operaciones de escritura.
2. Propiedad (BOLA §2.9): toda consulta filtra por el usuario del token; recurso ajeno → `not_found()`
   (404, nunca 403 que revele existencia). Los `{id}` de ruta se validan con `check_id`.
3. Operaciones atómicas (créditos, claim de bolsa, asignación manual, entrega):
   `select(...).with_for_update()` dentro de la transacción; claim usa `skip_locked=True`.
4. Estados de revisión (§4.2): 1 enviada → 2 asignado (pendiente de aceptación) → 3 en revisión → 4 entregada.
   TODA transición inserta `ReviewStateHistory` con `actor_role`/`actor_user_id`/`reason`.
5. Montos CLP = `int`. Fechas de respuesta en ISO 8601 UTC (`utcnow()`, sufijo Z al serializar con
   `dt.strftime('%Y-%m-%dT%H:%M:%SZ')` o dejando datetime — FastAPI serializa ISO).
6. Respuestas: dicts que calzan EXACTAMENTE con los JSON de ejemplo de la especificación
   (mismos nombres de campo). Listados paginados → `page_response`.
7. Códigos de error específicos: usar los de la tabla «Errores específicos» de cada endpoint.
8. Cuotas (§4): leer límites desde `Subscription.plan_version_id → PlanVersion.limits`, con fallback
   `Plan.limits` (usuario sin suscripción = plan Gratuito `p_free`). -1 = ilimitado.
9. Tarifas de revisión (§20.21): tomar la versión vigente de `LawyerFeeRate` a `assigned_at`
   (mayor `effective_from` ≤ fecha); montos por (kind, urgency).
10. NO tocar `app/main.py` ni `app/core/*` ni `app/models/*`. Si falta algo, resolverlo localmente
    en el módulo.
