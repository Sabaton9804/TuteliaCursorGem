import { PDFDocument, StandardFonts } from 'pdf-lib';

/** PDF mínimo para subir el cuerpo del correo a SGDE (solo texto). */
export async function plainTextToPdfBuffer(
  title: string,
  body: string
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;
  const margin = 48;
  const lineHeight = fontSize * 1.35;
  const maxWidth = 512;

  const wrap = (text: string): string[] => {
    const words = text.replace(/\r/g, '').split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, fontSize) > maxWidth) {
        if (line) lines.push(line);
        line = w;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const content = `${title}\n\n${body}`.slice(0, 28_000);
  const allLines = content.split('\n').flatMap((para) => (para.trim() ? wrap(para) : ['']));

  let page = pdf.addPage([612, 792]);
  let y = page.getHeight() - margin;

  for (const ln of allLines) {
    if (y < margin) {
      page = pdf.addPage([612, 792]);
      y = page.getHeight() - margin;
    }
    page.drawText(ln, { x: margin, y, size: fontSize, font });
    y -= lineHeight;
  }

  return Buffer.from(await pdf.save());
}
