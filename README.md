<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Tutelia (AI Studio / Cloud Run)

View your app in AI Studio: https://ai.studio/apps/3cf315b2-8431-4265-a67d-5f3d5b417262

## Run Locally

**Prerequisites:** Node.js 20+

1. `npm install`
2. Copie `.env.example` → `.env` o `.env.local` y configure Supabase + `OPENAI_API_KEY`
3. `npm run dev` — Express + Vite en el mismo proceso (`tsx watch server.ts`)

No use `npm run preview` para probar radicación: ese comando solo sirve el `dist/` estático y **no** expone `/api/*` (verá 405 en `POST /api/parse-email`).

## Deploy (Cloud Run / AI Studio)

Tutelia **no** es un sitio estático: radicación, IA, SGDE y Outlook dependen de `server.ts` (Express). El frontend (`dist/`) y las APIs deben servirse **desde el mismo origen**.

### Build y arranque

| Paso | Comando / valor |
|------|-----------------|
| Build | `npm run build` |
| Start | `npm start` → `tsx server.ts` |
| `NODE_ENV` | `production` (Cloud Run suele inyectarlo) |
| `PORT` | Lo asigna Cloud Run; local default `3451` |

**Importante:** no use `node server.ts` ni `vite preview` en producción. El servidor está en TypeScript; `npm start` usa `tsx`.

### Variables mínimas en el servicio

Configure en AI Studio Secrets / Cloud Run (ver `.env.example`):

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `APP_URL` — URL pública del servicio (OAuth Outlook, callbacks)
- Opcional: `SGDE_*`, `OUTLOOK_*`, `GEMINI_API_KEY`

Las variables `VITE_*` deben existir **en el build** (Vite las embebe). Si cambia Supabase en producción, vuelva a ejecutar `npm run build` antes del deploy.

### Verificación post-deploy

1. Abra `https://SU-URL/api/health` — debe responder JSON `{"status":"ok",...}`.
2. Si ve HTML de la SPA o 404, el backend no está corriendo (solo frontend estático).
3. En la app, suba un `.eml` y pulse **Procesar correo** — debe responder 200, no 405.

### Síntoma 405 en `/api/parse-email`

Significa que el host recibe `POST` pero **no** ejecuta Express. Causas habituales:

- Deploy solo de `dist/` (Firebase Hosting, Netlify estático, `vite preview`)
- Comando de arranque incorrecto (`node server.ts` falla; use `npm start`)
- `NODE_ENV` distinto de `production` sin middleware Vite (menos frecuente en Cloud Run)
