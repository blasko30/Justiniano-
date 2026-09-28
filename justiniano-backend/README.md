# Justiniano API — Backend (especificación v2.3)

Implementación FastAPI de los **110 endpoints** de `Justiniano_Especificacion_API_Backend.docx` v2.3:
frontend cliente, consola de administración, portal del vendedor y portal del abogado revisor.

## Arranque rápido

```bash
cp .env.example .env
docker compose up --build
# API: http://localhost:8000 · documentación interactiva: http://localhost:8000/docs
```

PostgreSQL ejecuta automáticamente los scripts de `db/init/` (DDL + índices + seeds) al crear el volumen.

Sin Docker: PostgreSQL 16 local, ejecutar `db/init/*.sql` en orden alfabético, y

```bash
pip install -r requirements.txt
DATABASE_URL=postgresql+asyncpg://justiniano:justiniano@localhost:5432/justiniano \
  uvicorn app.main:app --port 8000
```

## Credenciales de los seeds (contraseña `demo1234`)

| Rol | Correo |
|---|---|
| Administrador | admin@justiniano.cl |
| Vendedora | c.soto@justiniano.cl |
| Cliente empresa | mf.rojas@constructoraandes.cl |
| Abogada revisora (verificada) | d.fuentes@correo.cl |
| Abogado revisor (en verificación) | t.ibanez@correo.cl |

Los seeds incluyen los 5 planes (§4), 8 agentes IA, formatos de documento, tarifario de honorarios v1,
una revisión en bolsa y una revisión en curso — coherentes con los tres wireframes.

## Integraciones (§1.1)

`FAKE_INTEGRATIONS=true` (por defecto) usa simuladores locales intercambiables: blobs en disco con URL
firmada de 15 min, Stripe de prueba, agente IA con respuesta simulada y notificaciones a log. Con
`FAKE_INTEGRATIONS=false` y las credenciales del `.env`, cada cliente usa el SDK real (Stripe Checkout/
Webhooks, Azure Blob + SAS, Azure OpenAI, Azure Communication Services, Key Vault para claves JWT).
La interfaz es idéntica: no cambia ninguna línea de los routers.

## Estructura (carpetas = secciones del documento)

```
app/
├── main.py                  # ensamblado; §20 se registra antes que §12 (ruta /reviews/pool)
├── core/                    # §2: config, JWT RS256, Argon2, errores §2.4, paginación §2.5,
│                            #     rate limits §2.7, horas hábiles §4.2, auditoría §2.9
├── models/models.py         # §3: los 29 modelos ORM (DDL canónico en db/init/)
├── integrations/            # §1.1: blob, payments (Stripe), ai (Azure OpenAI), notify (ACS)
└── api/
    ├── s06_auth/            # §6  Autenticación y verificación (12 endpoints)
    ├── s07_users/           # §7  Cuenta, onboarding y preferencias (8)
    ├── s08_catalog/         # §8  Catálogos (5)
    ├── s09_consultations/   # §9  Consultas IA (6)
    ├── s10_attachments/     # §10 Adjuntos (3)
    ├── s11_documents/       # §11 Documentos (6)
    ├── s12_reviews/         # §12 Revisiones — lado cliente (4)
    ├── s13_billing/         # §13 Planes, créditos y pagos Stripe (9)
    ├── s14_system/          # §14 Salud (1)
    ├── s15_admin_metrics/   # §15 Métricas y usuarios (4)
    ├── s16_admin_plans/     # §16 Gestión de planes (5)
    ├── s17_admin_operations/# §17 Operación (1)
    ├── s18_admin_sales/     # §18 Ventas y vendedores (6)
    ├── s19_sales_me/        # §19 Portal del vendedor (4)
    ├── s20_lawyers/         # §20 Portal del abogado revisor (25)
    └── s21_admin_reviewers/ # §21 Administración de revisores y tarifario (11)
db/init/                     # DDL + índices por módulo (005…080) + 900_seeds.sql
tests/                       # pytest: auth con rotación de refresh, flujo del abogado
                             # (signup→aprobación→claim→deliver), admin de revisores
```

## Pruebas

```bash
pytest            # 7 tests, corren sin PostgreSQL (SQLite en memoria con adaptación de tipos)
```

Flujos cubiertos: registro de cliente con OTP y rotación de refresh tokens; registro del abogado,
bloqueo `lawyer_not_verified`, aprobación de acreditación, claim atómico de la bolsa, anotación y
entrega con devengo de honorario; KPIs de revisores, asignación manual (con `409 already_assigned`),
reasignación y suspensión con devolución de casos a la bolsa.

## Garantías de implementación destacadas

- Descuento de créditos, claim de bolsa, asignación manual y entrega usan `SELECT … FOR UPDATE`
  (claim con `SKIP LOCKED`): sin dobles adjudicaciones ni doble gasto (§12.2, §20.11, §21.7).
- Toda transición de revisión inserta `review_state_history` con actor y motivo (§4.2 v2.3).
- El historial del cliente para el abogado se sirve inline con marca de agua nominativa y bitácora
  `history_access_log`; nunca emite URLs de descarga (§20.19).
- La firma profesional de la entrega se toma del perfil verificado en servidor (§20.21).
- Recurso ajeno → `404 not_found` (nunca 403 que revele existencia) — BOLA §2.9.
- Errores con el formato estándar `{"error": {code, message, details}}` (§2.4) y códigos por endpoint.
