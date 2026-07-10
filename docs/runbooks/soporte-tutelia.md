# Runbook — Soporte técnico Tutelia

**Plan F12.1.4**

---

## Contactos y entornos

| Entorno | URL / notas |
|---------|-------------|
| Piloto 051 | Entorno acordado con despacho |
| Supabase | Proyecto remoto — no exponer keys |
| SGDE Rama | Credenciales por usuario en Settings |

## Incidencias frecuentes

### SGDE «Sin conexión»

1. Verificar `SGDE_ENCRYPTION_KEY` en servidor.
2. Usuario debe guardar credenciales en Settings.
3. Probar `/sgde` → sync manual.

### Outlook / correo

1. Verificar buzón en `court_mailboxes` (seed `npm run seed:court-mailboxes`).
2. Scopes Graph `Mail.*.Shared`.
3. Fallback: **Abrir en Outlook** (`webLink`).

### Plazos incorrectos

1. Revisar `case_stages.metadata` → `stage_deadline_at`.
2. `deadline_override_note` solo excepcional (auditoría).
3. Post F2: reglas Ley 2213 en `notification_records`.

### Build / despliegue

```bash
npm run build
npm run lint
```

## Escalación

1. Nivel 1: secretaría según runbook J51.
2. Nivel 2: admin despacho / platform admin.
3. Nivel 3: desarrollo — issue con radicado, captura, hora.

## Post go-live (F12.3)

- Monitoreo errores < 1h respuesta críticos.
- Reunión semanal feedback × 4 semanas.

---

*Borrador — completar en F12.*
