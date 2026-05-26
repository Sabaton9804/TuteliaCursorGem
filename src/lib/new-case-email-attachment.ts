import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Fila del correo en la misma lista que los demás adjuntos (no «principal» fijo). */
export type NewCaseEmailAttachment = {
  filename: string;
  originalName: string;
  size: number;
  contentType: string;
  content: string;
  type: 'email_body';
  isFromLink: false;
  sessionIndex?: number;
};

export function buildEmailAsAttachment(
  parsed: Record<string, unknown> | null | undefined,
  emlFileName?: string | null
): NewCaseEmailAttachment {
  const p = parsed ?? {};
  const text = typeof p.text === 'string' ? p.text : '';
  const subject = typeof p.subject === 'string' ? p.subject : 'Correo de reparto';
  return {
    filename: 'CorreoReparto',
    originalName: (emlFileName || 'Correo de reparto.eml').trim(),
    size: Math.max(1, Math.round(text.length * 1.5)),
    contentType: 'text/html',
    content: '',
    type: 'email_body',
    isFromLink: false,
  };
}

export function isEmailBodyAttachment(att: { type?: string }): boolean {
  return att.type === 'email_body';
}

/** PDF o correo de reparto (se convierte a PDF al unir). */
export function isMergeableAttachment(att: { type?: string; contentType?: string }): boolean {
  return isEmailBodyAttachment(att) || att.contentType === 'application/pdf';
}

/** PDF del cuerpo del correo para Storage / SGDE / unir. */
export async function emailBodyToPdfBytes(subject: string, body: string): Promise<Uint8Array> {
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

  const content = `${subject}\n\n${body}`.slice(0, 28_000);
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

  return new Uint8Array(await pdf.save());
}
