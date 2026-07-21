import { describe, expect, it } from 'vitest';
import {
  emailBodyToPdfBytes,
  sanitizeTextForPdfWinAnsi,
} from './new-case-email-attachment';

describe('sanitizeTextForPdfWinAnsi', () => {
  it('elimina espacio de ancho cero U+200B', () => {
    expect(sanitizeTextForPdfWinAnsi('RE: AUTO\u200b TUTELA')).toBe('RE: AUTO TUTELA');
  });
});

describe('emailBodyToPdfBytes', () => {
  it('genera PDF aunque el asunto traiga U+200B', async () => {
    const bytes = await emailBodyToPdfBytes(
      'RE: IMPUGNACION\u200b 090-2026-01382',
      'Cuerpo del correo de traslado.'
    );
    expect(bytes.byteLength).toBeGreaterThan(500);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('%PDF');
  });
});
