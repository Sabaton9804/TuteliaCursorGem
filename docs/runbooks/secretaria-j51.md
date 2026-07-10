# Runbook — Secretaría Juzgado 051

**Plan F12.1.3** — procedimientos operativos día a día. Completar tras F2 (notificaciones 2213).

---

## 1. Ingreso tutela (correo reparto)

1. Abrir `/correo` → buzón institucional.
2. Localizar acta de reparto → **Nueva tutela** o ingest automático (F9.2.4).
3. Verificar CUI, sustanciador, informe `InformeIngresoDespacho.pdf`.
4. Etapa `RADICACION` → `ADMISION` cuando informe esté en expediente.

## 2. Notificación auto admisorio

1. Expediente → pestaña Notificaciones.
2. Redactar / plantilla → destinatarios correo.
3. Enviar → constancia PDF (F2) + registro `notification_records`.
4. Confirmar avance a `TERMINO_RESPUESTA`.

## 3. Notificación fallo

1. Tras registrar fallo PDF en despacho.
2. Mismo flujo notificación → `TERMINO_IMPUGNACION` (3 háb.).

## 4. Ingreso civil

1. `/procesos/civiles` → tipo + **clase SIERJU** obligatoria (F3).
2. Plazos: 20 háb. contestación (ordinario) o 5 háb. excepciones (ejecutivo).

## 5. Oficios salientes

1. Seleccionar tipo (juzgado, comisión, requerimiento, competencia).
2. Número consecutivo automático (F2.2.1).
3. PDF en expediente; envío desde correo oficial.

## 6. Escalación

Ver `docs/runbooks/soporte-tutelia.md`.

---

*Borrador — ampliar con capturas y casos reales en F12.*
