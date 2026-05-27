# Lectura rápida con IA (pieza del expediente)

## Estado actual (v1.0)

- **UI:** menú ⋯ «Lectura rápida con IA» + panel bajo el visor del expediente digital.
- **API:** `POST /api/ai/analyze-piece` (sesión Bearer + acceso al despacho).
- **Modelo:** `OPENAI_MODEL` (por defecto `gpt-4o-mini`).
- **Prompt:** versión `PIECE_AI_PROMPT_VERSION = 'v1.0'` en `src/lib/piece-ai-analysis.ts`.
- **Caché:** tabla `case_document_ai_analyses`; invalidación por `content_hash`, `prompt_version` y `model`.
- **Límites:** `AI_PIECE_MAX_PAGES` (default 40) para PDF; Word vía Mammoth con tope de caracteres en servidor.

## Próxima iteración (pendiente)

Objetivo acordado: **modelo más capaz** y **prompt distinto** (lectura jurídica más fina, sin solapar con la síntesis cognitiva del caso).

### Checklist al cambiar modelo o prompt

1. Subir `PIECE_AI_PROMPT_VERSION` (p. ej. `v2.0`) en `src/lib/piece-ai-analysis.ts` para invalidar cachés antiguas.
2. Ajustar `OPENAI_MODEL` en `.env` (p. ej. `gpt-4o` o el que apruebe el despacho).
3. Revisar el system prompt y el JSON Schema en `server/analyze-piece-service.ts` (`buildPieceAiSystemPrompt`, `PIECE_ANALYSIS_JSON_SCHEMA`).
4. Revisar `buildPieceAiSummaryMarkdown` si cambia la estructura de salida.
5. Probar PDF largo (cerca de 40 páginas), Word, OCR pobre y re-análisis tras reemplazar archivo.
6. Confirmar coste/latencia con el nuevo modelo antes de producción.

### Archivos principales

| Área | Ruta |
|------|------|
| Migración BD | `supabase/migrations/20260527120000_case_document_ai_analyses.sql` |
| Servidor | `server/analyze-piece-service.ts`, ruta en `server.ts` |
| Cliente API | `src/lib/piece-ai-api.ts` |
| Tipos / elegibilidad | `src/lib/piece-ai-analysis.ts` |
| UI panel | `src/components/expediente/ExpedientePieceAiPanel.tsx` |
| Integración visor | `src/components/expediente/CaseExpedienteDigitalPanel.tsx` |
| Menú piezas | `src/components/expediente/ExpedienteDigitalPanel.tsx` |

### Disclaimer legal

Texto fijo: `PIECE_AI_DISCLAIMER` en `piece-ai-analysis.ts` (Acuerdo PCSJA24-12243). No delegar al LLM.
