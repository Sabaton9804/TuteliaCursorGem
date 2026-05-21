/** Extrae texto plano del cuerpo de un mensaje Graph (HTML o text). */
export function outlookMessageBodyText(message: Record<string, unknown>): string {
  const body = message.body;
  if (!body || typeof body !== 'object') return '';
  const content = String((body as { content?: string }).content ?? '');
  const contentType = String((body as { contentType?: string }).contentType ?? 'text').toLowerCase();
  if (!content) return '';
  if (contentType === 'html') {
    return content
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return content.trim();
}
