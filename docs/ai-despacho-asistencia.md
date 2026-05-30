# Asistencia IA al redactar (despacho)

## Permitido en Tutelia

| Función | API | Notas |
|---------|-----|--------|
| Revisar redacción y ortografía | `POST /api/ai/review-text` | Solo corrección de borradores (informe, auto). Bajo demanda. |
| Consulta de precedentes | `POST /api/precedents/search` | Biblioteca del despacho; informativo. |

## No permitido (política del producto)

Conforme al Acuerdo PCSJA24-12243 y lineamientos UNESCO sobre IA en justicia:

- **No** generar con IA antecedentes, considerandos, resuelve ni borrador de fallo/sentencia.
- **No** delegar la decisión judicial a modelos de lenguaje.

Cualquier propuesta de “borrador de fallo asistido” queda fuera de alcance.

## Variables

- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `AI_REVIEW_MAX_CHARS` en `src/lib/ai-despacho-assist.ts`

## Disclaimer

`DESPACHO_AI_DISCLAIMER` en UI.
