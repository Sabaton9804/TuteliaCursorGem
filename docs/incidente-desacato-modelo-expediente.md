# Incidente de desacato — modelo de datos y producto

**Decisión cerrada (no reabrir sin acuerdo jurídico explícito):** el incidente de desacato **no** es un proceso autónomo ni un expediente hijo con radicado propio. Es una **actuación rogada dentro del expediente de tutela madre**.

## Fundamento

- El incidente se tramita **en el mismo expediente** en el que se profirió el fallo cuya ejecución se desconoce o incumple.
- No corresponde abrir un nuevo radicado ni un “sub-expediente” paralelo con CUI distinto: eso confundiría inventario, estadística (SIERJU) y reparto.
- En TYBA/justicia electrónica puede existir carpeta o actuación específica; en Tutelia el equivalente es **registro estructurado + actuaciones + tareas de flujo**, no duplicar `cases`.

## Implementación en Tutelia

| Concepto | Implementación |
|----------|----------------|
| Expediente | Siempre `cases` del proceso de tutela (`parent_case_id` en incidente apunta al caso madre). |
| Radicado | **Un solo** `cases.radicado` (el de la tutela). |
| Incidente | Tabla `incident_desacato` (`court_id`, `parent_case_id`, solicitante, conducta, sanción, consulta, etc.). |
| UI | Pestaña **Incidente de desacato** en `CaseDetail` (primera instancia); panel `CaseIncidenteDesacatoPanel`. |
| Trazabilidad | `case_actions` (p. ej. `INCIDENTE_DESACATO`), notificaciones `workflow-stage-notifications`, `workflow_tasks` tipo `consulta_desacato` cuando aplica. |
| Agenda futura | `case_tasks.incident_id` (sin FK aún) enlazará compromisos al incidente, **no** a otro `cases.id`. |

## Qué NO hacer

- **No** crear fila en `cases` por cada incidente (“expediente hijo”).
- **No** generar consecutivo/radicado nuevo para el incidente.
- **No** listar incidentes en el listado principal de expedientes como si fueran tutelas nuevas.
- **No** cambiar `consulta_desacato` en `case_type` del expediente madre por el solo hecho de abrir incidente (el tipo de asunto del caso sigue siendo el de la tutela).

## Consulta de desacato (Corte)

La **consulta** ante la Corte (confirmar/revocar sanción) es un hito del **mismo** registro `incident_desacato` (`consulta_sent_at`, `consulta_result`), no un proceso separado.

## Referencias en código

- Migración: `supabase/migrations/20250512000001_tutelia_workflow_stages_precedents.sql` (sección `incident_desacato`).
- UI: `src/components/expediente/CaseIncidenteDesacatoPanel.tsx`.
- Pestaña: `src/pages/CaseDetail.tsx` (`incidente_desacato`).

---

*Documento para alinear desarrollo y evitar regresiones de diseño. Última ratificación: acuerdo despacho / producto Tutelia.*
