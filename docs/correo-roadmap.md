# Roadmap — Módulo Correo (Outlook)

**Estrategia:** Tutelia no compite con Outlook Web como cliente de correo. El valor está en clasificación judicial, cola de pendientes e ingreso al expediente. Para hilo completo, respuesta con adjuntos o firma, se usa **«Abrir en Outlook»** (`webLink` de Microsoft Graph) como puente.

**Versión actual:** `correo-v0.4` — buzones compartidos M365 (`court_mailboxes`), contexto explícito (`PUT /api/outlook/context`), Graph vía `/users/{upn}/…` con scopes `Mail.*.Shared`, compatibilidad `/me` con `OUTLOOK_ALLOW_LEGACY_ME=1`. v0.3 (P2) cerrado.

**Migración:** `20260605120000_court_mailboxes_shared.sql` · **Seed piloto:** `COURT_MAILBOX_UPN=… npm run seed:court-mailboxes`

## Prioridades

| Prioridad | Entrega | Impacto | Esfuerzo | Versión |
|-----------|---------|---------|----------|---------|
| **P0** | Botón «Abrir en Outlook» (`webLink`) | Alto | Muy bajo | v0.2 |
| **P0** | Cartel de límites en `/correo` | Alto (expectativas) | Muy bajo | v0.2 |
| **P1** | «Cargar más» en la lista (`skip`) | Alto (volumen) | Bajo | v0.2 |
| **P1** | «Responder» = Redactar precargado (sin hilo Graph) | Medio-alto | Bajo | v0.2 |
| **P1** | Texto explícito en «Analizar bandeja» (máx. 20 recientes) | Medio | Mínimo | v0.2 |
| **P2** | Abrir cuerpo del mensaje en pestaña nueva | Medio | Bajo | v0.3 ✓ |
| **P2** | Etiqueta en lista: pendiente / ya analizado | Medio | Medio | v0.3 ✓ |
| **P2 opc.** | Desconectar Outlook al cerrar sesión (toggle en Ajustes) | Seguridad | Bajo | v0.5 |
| **P0 v0.4** | Selector buzón compartido + `X-Tutelia-Mailbox-Id` | Alto (institucional) | Medio | v0.4 ✓ |
| **P3** | Filtros (remitente, fecha, leído) | Medio | Medio | Q3 |
| **P3** | Polling o badge de nuevos correos | Medio | Medio | Q3 |
| **P4** | `createReply` / respuesta en hilo vía Graph | Alto | Alto | **No planificado** — usar Outlook |

## No cubierto (explícito)

- Respuesta en hilo con `In-Reply-To` / historial citado automático
- Adjuntos al redactar desde Tutelia
- Firma automática del despacho en envíos
- Cliente completo (carpetas personalizadas, reglas, calendario)
- Notificaciones push en tiempo real

**Mientras tanto:** Redactar correo nuevo (Para/CC/asunto/cuerpo) o **Abrir en Outlook** para contestar con contexto completo.

## Verificación manual (P2)

1. `/correo` → seleccionar un mensaje con cuerpo → barra de acciones: botón **«Cuerpo en pestaña»** (junto a «Abrir en Outlook» si hay `webLink`).
2. Clic → pestaña nueva con asunto + cuerpo; si el navegador bloquea pop-ups, debe mostrarse error en la bandeja.
3. Lista: tras «Analizar con IA» → badge **Pendiente**; tras ingreso en Pendientes → **Vinculado** (o al recargar carpeta).

## Referencia técnica

- UI: `src/pages/Correo.tsx`, `src/pages/CorreoPendientes.tsx`, `src/pages/CorreoRoadmap.tsx` (`/docs/roadmap`)
- API: `server/outlook-routes.ts`, `server/outlook-mailbox-context.ts`, `server/outlook-mailbox-target.ts`, `src/lib/outlook-api.ts`
- Sanitizado cuerpo: `src/lib/outlook-body-preview.ts`
- Cola: tabla `outlook_message_reviews`
