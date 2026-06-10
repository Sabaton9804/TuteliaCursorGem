# Plazos de tutela — Decreto 2591 de 1991

**Fuente:** [Decreto 2591 de 1991](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=5304) (reglamenta el art. 86 de la Constitución).

**Implementación en código:** `src/lib/decreto-2591-plazos.ts`, cómputo hábil en `src/lib/business-days.ts`, etapas en `process_stages_definition` (migración `20260529120000_judicial_process_platform_phase1.sql`).

---

## Plazos que usa Tutelia

| Plazo | Días | Artículo | Uso en la app |
|-------|------|----------|----------------|
| Fallo primera instancia | **10 hábiles** desde la **presentación** de la solicitud | Art. 29 | `cases.deadline_at` en `tutela_primera` |
| Impugnación del fallo | **3 hábiles** desde la **notificación** del fallo | Art. 31 | Etapa `TERMINO_IMPUGNACION` |
| Remisión expediente tras impugnación | **2 hábiles** | Art. 32 (inc. 1) | Referencia / futura etapa |
| Fallo segunda instancia | **20 hábiles** desde la **recepción** del expediente | Art. 32 (inc. 2) | `cases.deadline_at` en `tutela_segunda` |
| Remisión a la Corte tras ejecutoria 2ª | **10 hábiles** | Art. 32 (inc. 2) | Etapa `REMISION_CORTE` |
| Informes de la autoridad | **1 a 3** (fija el juez) | Art. 19 | Traslado/contestación: **2 hábiles** (práctica despacho) |

Los plazos del decreto son **perentorios e improrrogables** (art. 15), salvo ajuste manual excepcional registrado en `cases.deadline_override_note`.

---

## Texto normativo (extracto)

**Art. 29.** Dentro de los **diez (10) días** siguientes a la presentación de la solicitud el juez dictará fallo…

**Art. 31.** Dentro de los **tres (3) días** siguientes a su notificación el fallo podrá ser impugnado…

**Art. 32.** Presentada la impugnación, el juez remitirá el expediente dentro de los **dos (2) días** siguientes al superior… El juez que conozca de la impugnación… proferirá el fallo dentro de **veinte (20) días** siguientes a la recepción del expediente… En ambos casos, dentro de los **diez (10) días** siguientes a la ejecutoria del fallo de segunda instancia, el juez remitirá el expediente a la Corte Constitucional…

---

## Migraciones

- `20260604120000_tutela_segunda_plazo_20_dias.sql` — `process_definitions.tutela_segunda`: `case_term_days = 20`.
- Aplicar en Supabase junto con `20260530160000_cases_decision_at.sql` si aún no está en el proyecto remoto.

## Backfill

```bash
npm run backfill:case-deadlines
```

El script respeta `case_type` (10 días primera, 20 días segunda).
