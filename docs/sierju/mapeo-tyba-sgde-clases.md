# Mapeo TYBA / SGDE → clases SIERJU

Plantilla para completar con la secretaria del despacho y validar contra procesos reales importados.

**Estado:** borrador — filas pendientes de confirmación.  
**Documento principal:** `docs/sierju-estadistica-integracion.md`

---

## Cómo usar este documento

1. Exportar desde SGDE/TYBA el catálogo de **tipo de proceso** / **clase procesal** que usa el despacho al radicar.
2. Para cada valor, asignar:
   - `sierju_section_code` (ej. `civil_1a_oral`)
   - `sierju_process_class_code` (ej. `ejecutivos`)
   - `process_definition_code` Tutelia (ej. `civil_ejecutivo_oral`) cuando exista pipeline de producto
3. Tras validar, migrar filas a tabla `sierju_tyba_class_map` (Fase S2).

---

## Tabla de mapeo (completar)

| Origen SGDE/TYBA (texto o código) | Sección SIERJU | Clase SIERJU (`code`) | `process_definition` Tutelia | Notas |
|-----------------------------------|----------------|----------------------|------------------------------|-------|
| *(ejemplo)* Ejecutivo singular | `civil_1a_oral` | `ejecutivos` | `civil_ejecutivo_oral` | Volumen alto en 051 |
| *(ejemplo)* Verbal pertenencia | `civil_1a_oral` | `declarativos_verbal_pertenencia` | `civil_declarativo_oral` | |
| *(ejemplo)* Tutela salud | `movimiento_tutelas` | fila `salud` | `tutela_primera` | Usar `fundamental_right`, no clase civil |
| | | | | |
| | | | | |

---

## Reglas de mapeo automático (heurísticas iniciales)

| Señal en metadata SGDE/import | Inferencia |
|-------------------------------|------------|
| `case_type = tutela_primera` | Sección `movimiento_tutelas`; derecho desde metadata tutela |
| Radicado instancia `00` en CUI + civil | 1ª instancia |
| Radicado instancia `01` | 2ª instancia → sección `civil_2a_*` |
| Palabra "ejecutiv" en tipo TYBA | Clase `ejecutivos` o variante hipotecaria/garantía real |
| Palabra "insolvenc" | `insolvencia_persona_natural` |
| Palabra "pertenenc" | `declarativos_verbal_pertenencia` o `pertenencia` escrito |
| Sin match | `otros_procesos` + flag revisión manual |

---

## Schema propuesto (Fase S2)

```sql
create table public.sierju_tyba_class_map (
  id uuid primary key default gen_random_uuid(),
  form_template_code text not null references sierju_form_templates (code),
  tyba_label text not null,           -- texto en TYBA/SGDE
  tyba_code text,                     -- código numérico si existe
  sierju_process_class_id uuid not null references sierju_process_classes (id),
  process_definition_id uuid references process_definitions (id),
  confidence text default 'manual' check (confidence in ('manual', 'heuristic', 'verified')),
  notes text,
  unique (form_template_code, tyba_label)
);
```

---

## Próximo paso operativo

1. Solicitar al despacho 051 extracto de tipos de proceso TYBA (últimos 100 radicados civiles).
2. Completar tabla superior.
3. Implementar en `server/sgde-import.ts`: lookup `sierju_tyba_class_map` → set `cases.sierju_process_class_id`.
