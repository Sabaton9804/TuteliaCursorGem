# Ley 2213/2022 — notificaciones electrónicas (resumen operativo)

**Fuente consolidada en repo:** `docs/normativa/full_text/LEY_2213_2022_consolidado.txt`  
**Implementación en Tutelia:** plan F2.1 (`notification_records`, constancias PDF). Hoy el flujo Outlook en `notificacion-secretaria-flow.ts` **no** aplica aún estas reglas de forma explícita.

---

## Artículos clave para secretaría

### Art. 3 — Canales digitales de las partes

- Las partes deben suministrar canales digitales para actuaciones y notificaciones.
- Cambio de correo o dirección: comunicar oportunamente (CGP art. 78 num. 5); de lo contrario, las notificaciones siguen surtiendo en el canal anterior.

**Implicación Tutelia:** registrar en expediente el correo notificable de cada parte; historial de cambios (futuro).

### Art. 6 — Demanda y notificación al admitir

- La demanda debe indicar canal digital de notificación (salvo excepciones legales).
- Si el demandante envió copia de demanda y anexos al demandado, al admitirse la demanda la notificación personal al demandado puede limitarse al **envío del auto admisorio**.

**Implicación Tutelia:** flujo civil de admisión + notificación admisorio alineado con este supuesto.

### Art. 8 — Notificaciones personales por mensaje de datos

| Regla | Contenido |
|-------|-----------|
| Medio | Envío de la providencia como mensaje de datos al correo/sitio suministrado |
| Sin citación previa | No requiere aviso físico o virtual previo |
| Anexos de traslado | Mismo medio electrónico |
| Presunción de notificación | **2 días hábiles** después del envío |
| Inicio de términos | Cuando haya acuse de recibo o se constate acceso del destinatario |
| Constancia | Implementar confirmación de recibo cuando sea posible |
| Nulidad | La parte afectada debe manifestar bajo juramento que no se enteró (CGP arts. 132–138) |

**Implicación Tutelia (F2):**

1. Al enviar notificación por Outlook, registrar `sent_at` y generar `ConstanciaNotificacionAAAAMMDD.pdf`.
2. Calcular términos desde acuse/constancia de acceso, no solo desde envío (art. 8 inc. 2).
3. Si no hay acuse, usar regla subsidiaria de 2 días hábiles post-envío.

### Art. 9 — Estado electrónico y traslados

- Notificaciones por estado: inserción virtual; sin impresión ni firma al pie.
- Traslados fuera de audiencia: mismo esquema digital.
- Traslado por parte (copia digital a contrapartes): a los **2 días hábiles** del envío si la parte acredita remisión; término desde acuse o constancia de acceso.

### Art. 11 — Oficios y comunicaciones

- Oficios y despachos por medio técnico disponible (CGP art. 111).
- Mensajes desde correo oficial del despacho: **presunción de autenticidad**.

**Implicación Tutelia (F2):** oficios desde buzón institucional del court; numeración consecutiva; PDF en expediente.

---

## Relación con tutela (Decreto 2591)

La tutela tiene plazos propios (D. 2591). La Ley 2213 complementa el **medio** de notificación, no sustituye los plazos constitucionales. En notificaciones de auto admisorio y fallo de tutela:

- Medio: correo electrónico (2213 art. 8).
- Plazos de contestación/impugnación: D. 2591 + práctica del despacho (2 háb. traslado accionados).

---

## Relación con CGP

| Tema | CGP | Ley 2213 |
|------|-----|----------|
| Cómputo días hábiles | Art. 118 | Complementa |
| Contestación verbal | Art. 369 (20 días) | Notificación art. 8 |
| Pago ejecutivo | Art. 431 (5 días) | Idem |
| Excepciones ejecutivo | Art. 442 (10 días) | Idem |
| Trámite de esas excepciones | Art. 443 (traslado 10 días al ejecutante) | Idem |
| Apelación (fuera de audiencia) | Art. 322 (3 días) | Art. 12 trámite apelación civil/familia |
| Reposición | Art. 318 (3 días) | Idem |
| Oficios | Art. 111 | Art. 11 refuerza medio electrónico |

---

## Checklist implementación F2 (referencia)

- [ ] Tabla `notification_records` con `law_2213_basis`, `sent_at`, `ack_at`
- [ ] Constancia PDF protocolo CSJ en expediente
- [ ] UI historial notificaciones por caso
- [ ] Reglas en `ley-2213-notificacion-rules.ts` para cálculo de términos
- [ ] Regla Cursor `.cursor/rules/ley-2213-notificaciones.mdc`

---

*Resumen operativo para desarrollo. No es asesoría jurídica.*
