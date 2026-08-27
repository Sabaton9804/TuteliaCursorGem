# Matriz de procesos — tutela vs civil

Referencia de producto para diferenciar flujos en Tutelia.  
**Código:** `src/lib/process-product-scope.ts`, `src/lib/case-workflow-stages.ts`, `src/lib/case-act-types.ts`.

---

## Alcance radicable hoy

| Dominio | `case_type` | Flujo |
|---------|-------------|-------|
| Constitucional | `tutela_primera`, `tutela_segunda`, `consulta_desacato` | **Completo** (MVP) |
| Civil | `civil_ordinario`, `civil_ejecutivo`, `civil_jurisdiccion_voluntaria`, `civil_insolvencia`, `civil_otros` | **Radicable**; pipeline CGP en expansión |
| Laboral / penal | previews UI | No radicable |

---

## Norma aplicable

| Proceso | Norma principal | Plazos en código |
|---------|-----------------|------------------|
| Tutela 1ª | Decreto 2591/1991 | `decreto-2591-plazos.ts` |
| Tutela 2ª | D. 2591 art. 32 | 20 háb. fallo; 10 háb. remisión Corte |
| Civil ordinario | CGP | Traslado art. 369 (`civil-business-days.ts`) |
| Civil ejecutivo | CGP | Pago art. 431; excepciones art. 442; trámite art. 443 |
| Notificaciones (medio) | Ley 2213/2022 | Pendiente F2 |

---

## Pipeline de etapas (resumen)

### Tutela primera instancia

```
RADICACION → ADMISION → NOTIFICACION_AUTO → TERMINO_RESPUESTA (2 háb.)
→ INGRESO_DESPACHO_FALLO → FALLO → NOTIFICACION_FALLO
→ TERMINO_IMPUGNACION (3 háb.) → IMPUGNACION → REMISION_SUPERIOR (2 háb.) → EJECUTORIA
```

### Civil ordinario

```
RADICACION → ADMISION → NOTIFICACION_AUTO → TERMINO_RESPUESTA (20 háb. art. 369)
→ TRAMITE → INGRESO_DESPACHO_FALLO → FALLO/Sentencia → NOTIFICACION_FALLO
→ TERMINO_APELACION (3 háb. art. 322 si es por estado) → APELACION → REMISION_SUPERIOR → EJECUTORIA
```

### Civil ejecutivo

```
RADICACION → ADMISION → NOTIFICACION_AUTO → TERMINO_EXCEPCIONES (10 háb. art. 442)
→ TRAMITE → … → (igual post-trámite que ordinario con apelación)
```

El 5 días del art. 431 es **pago**, concomitante con el 442; no sustituye el término de excepciones. El art. 443 es el **trámite** de las excepciones ya propuestas (traslado 10 días al ejecutante).

**Diferencia clave ejecutivo vs ordinario:** etapa `TERMINO_EXCEPCIONES` (art. 442) en lugar de `TERMINO_RESPUESTA` (art. 369).

---

## Plazos comparados

| Etapa / concepto | Tutela 1ª | Civil ordinario | Civil ejecutivo |
|------------------|-----------|-----------------|-----------------|
| Plazo global caso | 10 háb. (art. 29) | Sin perentorio global | Sin perentorio global |
| Traslado / contestación | 2 háb. (práctica 051) | 20 háb. (art. 369) | 10 háb. excepciones (art. 442); 5 háb. pago (art. 431) |
| Recurso post-decisión | Impugnación 3 háb. (art. 31) | Apelación 3 háb. por estado (art. 322) | Apelación 3 háb. (art. 322) |
| Remisión superior | 2 háb. post-impugnación (art. 32) | Según apelación | Según apelación |
| Remisión Corte | No (salvo consulta desacato) | No | No |
| Trámite probatorio | No etapa `TRAMITE` | Sí | Sí |

---

## Actos procesales principales

| Acto | Tutela | Civil ordinario | Civil ejecutivo |
|------|--------|-----------------|-----------------|
| Informe ingreso | `InformeIngresoDespacho.pdf` | Igual | Igual |
| Auto admisorio | Auto admisorio tutela | Auto admisorio demanda | Mandamiento de pago |
| Respuesta parte | Contestación / informe | Contestación demanda | Excepciones de mérito |
| Decisión fondo | Fallo tutela | Sentencia | Sentencia |
| Notificación | Correo Outlook + PDF | Igual | Igual |
| Incidente desacato | Sí (en expediente madre) | No | No |

Catálogo completo: `src/lib/case-act-types.ts`.

---

## Secretaría vs despacho

| Rol | Etapas típicas |
|-----|----------------|
| **Secretaría** | Radicación, notificaciones, términos, impugnación/apelación, remisiones |
| **Despacho** | Admisión, trámite, fallo/sentencia, ejecutoria |

Definición: `SECRETARIA_STAGES` / `DESPACHO_STAGES` en `case-workflow-stages.ts`.

---

## SIERJU

| Capa | Estado |
|------|--------|
| Catálogo fino | `sierju_process_classes` + `sierju-process-tipos.ts` (Civil-Oral) + derechos hojas 8/12/13/15 |
| Runtime app | 5 `case_type` civiles (colapsado, pipeline CGP) derivados de la clase SIERJU Oral |
| UI / IA radicación | Civil = hoja 2 Oral; Tutela 1ª = hoja 8; Tutela 2ª/impugnación = hoja 13; Consulta desacato = hoja 15 |
| Campo expediente | `cases.sierju_process_class_id` + `derecho_tutelado_code` |
| Tutela / constitucional | Mismos 12 TIPOS PROCESOS (derechos); no hojas 7/14 Acciones constitucionales |

---

## Navegación UI

| Módulo | Ruta |
|--------|------|
| Tutelas | `/cases`, `/new` |
| Procesos civiles | `/procesos/civiles` |
| Detalle expediente | `/case/:id` (común) |

---

## Incidente de desacato

- **No** es `case_type` independiente ni expediente hijo (SIERJU hoja 12 `incidentes_desacato`).
- Tipificación SIERJU: mismos 12 derechos que tutelas.
- Tabla `incident_desacato` + panel en `CaseDetail`.
- **Consulta** de incidente de desacato (hoja 15) sí es `case_type = consulta_desacato`.
- Ver `docs/incidente-desacato-modelo-expediente.md`.

---

## Próximos tipos (F3 replanteado)

No explotar `case_type`. El cubo es **trámite** (`verbal` / `ejecutivo` / …) + **perfil** (`ninguno` / `375` / `376` / `406` / hipotecario) sobre los cinco tubos gordos. SIERJU sigue siendo etiqueta estadística.

Fuente canónica **nacional** (civil circuito): [`docs/cgp/tramites-cgp.json`](cgp/tramites-cgp.json). El 051 es el piloto, no el modelo; overlay de despacho: [`overlay-despacho.example.json`](cgp/overlay-despacho.example.json).
