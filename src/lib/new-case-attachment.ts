import { uint8ArrayToBase64 } from './parse-session-attachment';

export type NewCaseAttachment = {
  filename: string;
  originalName?: string;
  size: number;
  contentType: string;
  content: string;
  isFromLink?: boolean;
  sessionIndex?: number;
  /** Cuaderno destino al radicar (p. ej. PI_C01_PRINCIPAL, PI_C02_CAUTELAR). */
  notebookCode?: string;
};

const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

export function basenameWithoutExtension(name: string): string {
  const base = name.replace(/^.*[/\\]/, '').trim();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export function ensureUniqueAttachmentFilename(base: string, existing: { filename: string }[]): string {
  const used = new Set(existing.map((a) => a.filename));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

export async function filesToNewCaseAttachments(
  files: File[],
  existing: { filename: string }[]
): Promise<{ added: NewCaseAttachment[]; errors: string[] }> {
  const added: NewCaseAttachment[] = [];
  const errors: string[] = [];
  const draft = [...existing];

  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      errors.push(`«${file.name}» supera el límite de 32 MB.`);
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const base = basenameWithoutExtension(file.name) || 'Documento';
      const filename = ensureUniqueAttachmentFilename(base, [...draft, ...added]);
      added.push({
        filename,
        originalName: file.name,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
        content: uint8ArrayToBase64(bytes),
        isFromLink: false,
      });
      draft.push({ filename });
    } catch {
      errors.push(`No se pudo leer «${file.name}».`);
    }
  }

  return { added, errors };
}
