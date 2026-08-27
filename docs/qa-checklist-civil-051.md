# QA — flujo civil Juzgado 051

Checklist manual para procesos **civiles** (ordinario y ejecutivo) en piloto 051.  
**Plan:** F12.1.2 · Complementa `docs/qa-checklist-tutela-051.md`

---

## Ordinario — trámite mínimo

| # | Ítem | Evidencia | PASS |
|---|------|-----------|------|
| C1.1 | Radicación con `case_type` civil + clase SIERJU | `NewCase.tsx`, `sierju_process_class_id` | |
| C1.2 | Plazo contestación 20 háb. (art. 369) | `TERMINO_RESPUESTA`, dashboard | |
| C1.3 | Cierre contestación → etapa `TRAMITE` | `CaseStagesExperience.tsx` | |
| C1.4 | Sentencia PDF + notificación | actos civil CGP | |
| C1.5 | Apelación 3 háb. si es por estado (art. 322) | `TERMINO_APELACION` | |

## Ejecutivo — trámite mínimo

| # | Ítem | Evidencia | PASS |
|---|------|-----------|------|
| C2.1 | Mandamiento de pago / actos ejecutivo | `case-act-types.ts` | |
| C2.2 | Plazo excepciones 10 háb. (art. 442); pago 5 háb. (art. 431) | `TERMINO_EXCEPCIONES` | |
| C2.3 | Cierre excepciones → `TRAMITE` | checklist contestación | |

## Común

| # | Ítem | PASS |
|---|------|------|
| C3.1 | Informe ingreso `InformeIngresoDespacho.pdf` | |
| C3.2 | Notificación con constancia (post F2) | |
| C3.3 | Export SIERJU clase correcta (post F3) | |

**Cierre F12.1.2:** ordinario + ejecutivo simulados PASS.
