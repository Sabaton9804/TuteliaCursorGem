<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Tutelia

## Run Locally

**Prerequisites:** Node.js 20+

1. `npm install`
2. Copie `.env.example` → `.env` o `.env.local` y configure Supabase + `OPENAI_API_KEY`
3. `npm run dev` — Express + Vite en el mismo proceso (`tsx watch server.ts`)

No use `npm run preview` para probar radicación: ese comando solo sirve el `dist/` estático y **no** expone `/api/*` (verá 405 en `POST /api/parse-email`).

## Deploy en Cloudflare Pages (recomendado si ya usa Cloudflare)

**Cloudflare Pages solo publica el frontend estático** (`dist/`). No ejecuta `server.ts`. Por eso `POST /api/parse-email` devuelve **405**: las variables `OPENAI_API_KEY`, `OUTLOOK_*`, etc. en Pages **no activan** el backend; solo sirven si hubiera código Node en ese host (no es el caso).

Arquitectura correcta: **dos despliegues**.

### 1. Backend API (Node / Express)

Despliegue en Railway, Render, Fly.io o Cloud Run (el repo incluye `Dockerfile`):

| Variable | Ejemplo |
|----------|---------|
| `OPENAI_API_KEY` | clave OpenAI |
| `SUPABASE_URL` | URL Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service role (solo servidor) |
| `OUTLOOK_CLIENT_ID` / `OUTLOOK_CLIENT_SECRET` | OAuth |
| `SGDE_CREDENTIALS_KEY` | si usa SGDE |
| `CORS_ORIGIN` | `https://tu-app.pages.dev` (su dominio Cloudflare Pages) |
| `APP_URL` | misma URL del backend (OAuth Outlook callback) |

Comando de arranque: `npm start`. Verifique `https://SU-API/api/health` → JSON `{"status":"ok"}`.

### 2. Frontend en Cloudflare Pages

| Ajuste | Valor |
|--------|-------|
| Build command | `npm run build` |
| Output directory | `dist` |
| **Variables de build** | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, **`VITE_API_URL=https://SU-API`** (sin barra final) |

Tras cambiar `VITE_API_URL` o Supabase, **vuelva a desplegar** Pages (rebuild).

En Pages puede quitar `OPENAI_API_KEY` y secretos de servidor: no los usa el build estático (y deben vivir solo en el API).

### Verificación

1. `https://SU-API/api/health` → JSON ok  
2. App en Pages → **Procesar correo** → 200, no 405

---

## Deploy monolito (Cloud Run / AI Studio / Docker)

Si prefiere **un solo** servicio (frontend + API mismo origen), no use Pages solo: `npm run build` + `npm start` en un host Node. Ver `Dockerfile`.
