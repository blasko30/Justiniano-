# Justiniano — Frontend (React · Azure Static Web Apps)

Monorepo con las tres aplicaciones web de Justiniano, generadas a partir de los wireframes funcionales y conectadas al backend FastAPI (especificación de API v2.3, prefijo `/api/v1`).

| App | Carpeta | Usuario | Pantallas |
|---|---|---|---|
| **Cliente** | `apps/cliente` | Empresa (pyme) | Landing, registro + verificación (email/SMS), onboarding, login (con 2FA), dashboard, agentes IA, consultas/chat, documentos (catálogo + formulario dinámico + visor + descarga), revisiones por abogado, planes/Stripe, ajustes |
| **Abogado** | `apps/abogado` | Abogado revisor | Login, registro con acreditación, panel de casos, bolsa de requerimientos, espacio de revisión (anotaciones por párrafo, control de cambios, chat, historial), honorarios y liquidaciones, perfil |
| **Admin/Ventas** | `apps/admin` | Equipo interno | Login (rol por JWT), dashboard de métricas + detalle, operación, gestión de planes y usuarios por plan, red de revisores + tarifario + asignaciones, ventas/CRM y portal del vendedor |

Paquetes compartidos:

- `packages/api` — SDK de la API (110 endpoints, 16 módulos): fetch con Bearer JWT, refresh automático con rotación de tokens, errores normalizados (`ApiError`).
- `packages/ui` — tema claro/oscuro persistido, logo (variantes lockup/isotipo, light/dark), toasts, modal, spinner, estados vacíos. Los tokens visuales de la guía de estilos “El Arco Abierto” viven en el CSS de cada app (`src/styles/app.css`).

## Desarrollo local

Requisitos: Node 20+.

```bash
npm install               # instala todos los workspaces
npm run dev:cliente       # http://localhost:5173
npm run dev:abogado       # http://localhost:5174
npm run dev:admin         # http://localhost:5175
```

La URL del backend se toma de `VITE_API_BASE_URL` (ver `.env.example` en cada app; sin definirla apunta a `http://localhost:8000/api/v1`). Crea `apps/<app>/.env.local` para desarrollo:

```
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

Build de producción:

```bash
npm run build             # las tres apps
npm run build:cliente     # una sola → apps/cliente/dist
```

## Despliegue en Azure Static Web Apps

Cada portal se despliega como una **Static Web App independiente** (recomendado: `app.justiniano.cl`, `abogados.justiniano.cl`, `admin.justiniano.cl`).

### 1. Crear los recursos (una vez)

```bash
az login
az group create -n rg-justiniano-web -l eastus2

az staticwebapp create -n swa-justiniano-cliente -g rg-justiniano-web --sku Free
az staticwebapp create -n swa-justiniano-abogado -g rg-justiniano-web --sku Free
az staticwebapp create -n swa-justiniano-admin   -g rg-justiniano-web --sku Free

# Token de despliegue de cada una (para los secretos de GitHub):
az staticwebapp secrets list -n swa-justiniano-cliente -g rg-justiniano-web --query properties.apiKey -o tsv
```

### 2. CI/CD con GitHub Actions (incluido)

Los workflows en `.github/workflows/deploy-*.yml` compilan la app afectada y suben `dist/` en cada push a `main`. Configura en el repositorio de GitHub:

- **Secrets**: `AZURE_SWA_TOKEN_CLIENTE`, `AZURE_SWA_TOKEN_ABOGADO`, `AZURE_SWA_TOKEN_ADMIN` (tokens del paso 1).
- **Variables**: `API_BASE_URL` = URL pública del backend **incluyendo** el prefijo, p. ej. `https://api.justiniano.cl/api/v1`.

> `VITE_API_BASE_URL` se inyecta **en tiempo de build** (Vite): si cambia la URL del backend hay que recompilar/redesplegar.

### 3. Despliegue manual (alternativa sin GitHub)

```bash
npm run build:cliente
npx @azure/static-web-apps-cli deploy apps/cliente/dist \
  --deployment-token "<token>" --env production
```

### 4. Configuración del backend (CORS)

El backend limita orígenes con `cors_origins` (por defecto `https://app.justiniano.cl,https://admin.justiniano.cl`). Añade los dominios reales de las tres Static Web Apps (incluidos los `*.azurestaticapps.net` autogenerados mientras no haya dominio propio) o el login fallará desde el navegador.

### 5. Dominios propios y SPA fallback

- Dominio propio: `az staticwebapp hostname set -n swa-justiniano-cliente -g rg-justiniano-web --hostname app.justiniano.cl` (+ CNAME en el DNS).
- El enrutado usa `HashRouter` (`/#/ruta`) y además cada app publica `staticwebapp.config.json` con `navigationFallback` hacia `index.html`, por lo que los deep links funcionan en cualquier caso.

## Estructura

```
justiniano-frontend/
├─ apps/
│  ├─ cliente/   ├─ abogado/   └─ admin/
│     ├─ public/ (favicon + staticwebapp.config.json)
│     ├─ src/
│     │  ├─ api.js            # instancia del SDK con prefijo de storage propio
│     │  ├─ App.jsx           # rutas + guard de autenticación
│     │  ├─ components/       # shell del portal y piezas propias
│     │  ├─ screens/          # una pantalla por archivo (según wireframe)
│     │  └─ styles/app.css    # guía de estilos “El Arco Abierto”
│     └─ vite.config.js
├─ packages/
│  ├─ api/   # SDK HTTP + endpoints por módulo (§6–§21)
│  └─ ui/    # tema, logo, toasts, modal, spinner, vacíos
└─ .github/workflows/          # deploy-{cliente,abogado,admin}.yml
```

## Notas de implementación

- **Sesión**: access JWT + refresh token con rotación; cada portal usa su propio prefijo en `localStorage` (`jus_cliente`, `jus_abogado`, `jus_admin`), así pueden convivir en el mismo navegador. Al perder la sesión se redirige a `/#/login`.
- **Roles**: el rol viaja en el JWT (client/lawyer/seller/admin). La consola admin muestra la vista completa a `admin` y solo su cartera a `seller`.
- **Errores del backend**: formato `{"error":{code,message,details}}`; las apps muestran el mensaje en un toast y tratan códigos específicos (cuotas 402/403, conflictos 409) como estados de UI (upsell, candados, avisos).
- **Sin dependencias pesadas**: gráficas del dashboard en SVG/CSS puro, sin librerías de charts. Dependencias: react, react-dom, react-router-dom.
