/** Rellena un .docx que ya contiene marcadores `{{CLAVE}}` con datos planos. Carga pizzip/docxtemplater solo al llamar. */
export async function renderDocxTemplateWithData(
  arrayBuffer: ArrayBuffer,
  data: Record<string, string>,
): Promise<Blob> {
  const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([
    import('pizzip'),
    import('docxtemplater'),
  ]);
  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    nullGetter: () => '',
  });
  doc.render(data);
  const out = doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
  return out as Blob;
}
