/**
 * Genera síntesis cognitiva en prosa a partir de metadatos del catálogo (sin API externa).
 * La redacción sigue plantilla jurídica operativa del despacho.
 */
export type SintesisSource = {
  radicado: string;
  demandante?: string | null;
  demandado?: string | null;
  tipo_proceso?: string | null;
  situacion?: string | null;
  etapa?: string | null;
  ubicacion?: string | null;
  tramite?: string | null;
  encargado?: string | null;
  ultimo_auto?: string | null;
};

function fmtRadicado(r: string): string {
  const d = r.replace(/\D/g, '');
  if (d.length !== 23) return r;
  return `${d.slice(0, 5)}-${d.slice(5, 9)}-${d.slice(9, 12)}-${d.slice(12, 16)}-${d.slice(16, 21)}-${d.slice(21)}`;
}

function seguimientoSugerido(src: SintesisSource): string {
  const ub = (src.ubicacion || '').toLowerCase();
  const et = (src.etapa || '').toLowerCase();
  const tr = (src.tramite || '').toLowerCase();
  const tips: string[] = [];

  if (ub.includes('fallar') || et.includes('fallar')) tips.push('Verificar proyecto de decisión y estado de notificación.');
  if (ub.includes('oficio') || tr.includes('oficio')) tips.push('Revisar oficios pendientes de firma y traslados asociados.');
  if (ub.includes('estado') || et.includes('entrada') || et.includes('estado')) tips.push('Ingresar al despacho las piezas del estado y fijar término si corresponde.');
  if (ub.includes('emplaz') || et.includes('emplaz')) tips.push('Confirmar efectividad del emplazamiento y término para contestar.');
  if (ub.includes('archivo') || et.includes('archivo')) tips.push('Validar requisitos de archivo y remisión a archivo central.');
  if (ub.includes('ejecuci') || et.includes('ejecuci')) tips.push('Seguir trámite ejecutivo: requerimientos, medidas y pagos.');
  if (ub.includes('liquid') || et.includes('costas')) tips.push('Avanzar liquidación de costas y notificación a partes.');
  if (ub.includes('rechaz') || et.includes('rechaz')) tips.push('Revisar admisión/rechazo de demanda y recursos pendientes.');
  if (ub.includes('audienc')) tips.push('Coordinar fecha de audiencia y preparar minuta o acta.');
  if (ub.includes('reparto')) tips.push('Completar reparto interno y asignación de sustanciador.');

  if (tips.length === 0) {
    tips.push('Revisar última actuación en SGDE y actualizar ubicación en Planner.');
    tips.push('Confirmar términos vigentes y piezas pendientes de respuesta.');
  }
  return tips.slice(0, 3).map((t, i) => `${i + 1}. ${t}`).join('\n');
}

export function buildAgentSintesisMarkdown(src: SintesisSource): string {
  const rad = fmtRadicado(src.radicado);
  const tipo = (src.tipo_proceso || 'Proceso civil').trim();
  const dte = (src.demandante || 'No consta en catálogo').trim();
  const ddo = (src.demandado || 'No consta en catálogo').trim();
  const sit = (src.situacion || 'activo').trim();
  const etapa = (src.etapa || 'Sin etapa detallada en importación').trim();
  const ubic = (src.ubicacion || 'Sin ubicación interna').trim();
  const tram = (src.tramite || 'Sin trámite pendiente registrado').trim();
  const enc = (src.encargado || 'Sin encargado asignado en catálogo').trim();
  const auto = (src.ultimo_auto || 'No consta último auto en catálogo').trim();

  return `### Síntesis cognitiva operativa

**1. Tipo de proceso y objeto del litigio:** ${tipo}. Radicado ${rad}.

**2. Partes y rol procesal:** Demandante: **${dte}**. Demandado: **${ddo}**. Situación en catálogo: **${sit}**.

**3. Estado procesal:** Etapa: ${etapa}. Ubicación interna: ${ubic}. Trámite pendiente (Planner): ${tram}.

**4. Actuación reciente:** ${auto}.

**5. Piezas y expediente:** Síntesis elaborada a partir del catálogo operativo importado desde plataforma. Para detalle documental, consulte el expediente digital SGDE vinculado al radicado.

**6. Términos y riesgos:** ${sit === 'activo' ? 'Proceso activo en despacho; verificar en SGDE términos de traslado, contestación o ejecutoria según la etapa actual.' : 'Revisar situación procesal en SGDE.'} Encargado según catálogo: ${enc}.

**7. Seguimiento sugerido:**
${seguimientoSugerido(src)}
`;
}
