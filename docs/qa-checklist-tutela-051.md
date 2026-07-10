# QA — flujo tutela Juzgado 051

Checklist manual para validar Tutelia contra el flujo real del despacho.  
**Referencia visual:** `docs/reference/flujo_real_tutela_juzgado051.html`

**Piloto:** Juzgado 051 Civil del Circuito de Bogotá D.C.  
**Última revisión:** julio 2026 (F0.1.4)

---

## Cómo usar

1. Radicar o abrir un expediente de prueba en entorno piloto.
2. Marcar cada ítem PASS / FAIL / N/A.
3. Anotar radicado y fecha en la tabla de ejecución al final.

---

## Fase 1 — Entrada y radicación

| # | Ítem | Responsable | Evidencia en Tutelia | PASS |
|---|------|-------------|----------------------|------|
| 1.1 | Correo de reparto detectado (acta PDF) | Secretaría | `pdf-acta-detect.ts`, `NewCase.tsx` | |
| 1.2 | CUI/radicado 23 dígitos generado | Secretaría | `court-radicacion-config.ts` | |
| 1.3 | Reparto sustanciador aplicado | Secretaría | `sustanciador-reparto.ts` | |
| 1.4 | Informe ingreso PDF en expediente | Secretaría | `InformeIngresoDespacho.pdf` | |
| 1.5 | Etapa inicial `RADICACION` registrada | Sistema | `case_stages` | |

---

## Fase 2 — Admisión y notificación

| # | Ítem | Responsable | Evidencia | PASS |
|---|------|-------------|-----------|------|
| 2.1 | Semáforo 10 días hábiles desde radicación (1ª) | Sistema | `decreto-2591-plazos.ts`, dashboard | |
| 2.2 | Auto admisorio / inadmisorio registrado como acto PDF | Despacho | `case-act-types.ts` | |
| 2.3 | Notificación auto admisorio por correo | Secretaría | `notificacion-secretaria-flow.ts` | |
| 2.4 | Avance a `TERMINO_RESPUESTA` tras notificación | Sistema | `case-stages-service.ts` | |
| 2.5 | Plazo contestación accionados 2 háb. (práctica 051) | Sistema | `case-stage-deadlines.ts` | |

---

## Fase 3 — Fallo

| # | Ítem | Responsable | Evidencia | PASS |
|---|------|-------------|-----------|------|
| 3.1 | Ingreso a despacho / fallo en etapa correcta | Despacho | `INGRESO_DESPACHO_FALLO` → `FALLO` | |
| 3.2 | Fallo PDF en expediente digital | Despacho | `case_documents` cuaderno PI | |
| 3.3 | Notificación fallo por correo | Secretaría | `notificacion_fallo` | |
| 3.4 | Etapa `TERMINO_IMPUGNACION` con 3 háb. | Sistema | art. 31 D. 2591 | |

---

## Fase 4 — Impugnación y remisión

| # | Ítem | Responsable | Evidencia | PASS |
|---|------|-------------|-----------|------|
| 4.1 | Registro impugnación avanza etapa | Secretaría | `IMPUGNACION` | |
| 4.2 | Remisión superior con plazo 2 háb. (art. 32 inc. 1) | Sistema | `PLAZO_REMISION_EXPEDIENTE_IMPUGNACION_DIAS` | |
| 4.3 | Tarea workflow remisión visible | Secretaría | `workflow_tasks` | |

---

## Fase 5 — Incidente de desacato (si aplica)

| # | Ítem | Responsable | Evidencia | PASS |
|---|------|-------------|-----------|------|
| 5.1 | Incidente en mismo expediente (sin caso hijo) | Sistema | `incident_desacato` | |
| 5.2 | Panel incidente en `CaseDetail` | UI | `CaseIncidenteDesacatoPanel.tsx` | |
| 5.3 | Consulta Corte registrada en incidente | Secretaría | campos `consulta_*` | |

---

## Fase 6 — Segunda instancia (si aplica)

| # | Ítem | Responsable | Evidencia | PASS |
|---|------|-------------|-----------|------|
| 6.1 | Plazo 20 háb. fallo 2ª instancia | Sistema | `tutela_segunda`, migración plazo 20d | |
| 6.2 | Remisión Corte 10 háb. post-ejecutoria | Sistema | `REMISION_CORTE` | |

---

## Fase 7 — Protocolo y estadística

| # | Ítem | Evidencia | PASS |
|---|------|-----------|------|
| 7.1 | Nombres PDF TitleCase sin guiones | protocolo CSJ | |
| 7.2 | Export SIERJU tutela al fallar | `sierju-tutela-informe.ts` | |
| 7.3 | Precedente indexado opcional al fallar | `precedents-index-client.ts` | |

---

## Registro de ejecución

| Fecha | Radicado | Ejecutor | PASS | FAIL | Notas |
|-------|----------|----------|------|------|-------|
| | | | | | |

---

## Criterio de cierre F7.5

**100% ítems aplicables en PASS** en al menos un expediente tutela 1ª completo simulado en piloto 051.
