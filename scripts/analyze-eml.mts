/**
 * Replica la lógica relevante de POST /api/parse-email sobre un .eml local
 * e imprime diagnóstico de adjuntos y del enlace «Archivo» (sin subir a Supabase).
 *
 * Uso: npx tsx scripts/analyze-eml.mts "C:\ruta\correo.eml"
 */
import fs from 'fs';
import path from 'path';
import { simpleParser } from 'mailparser';
import axios from 'axios';
import JSZip from 'jszip';

function hexPrefix(buf: Buffer, n: number): string {
  return buf
    .subarray(0, Math.min(n, buf.length))
    .toString('hex')
    .replace(/(.{2})/g, '$1 ')
    .trim();
}

function looksPdf(buf: Buffer): boolean {
  return (
    buf.length >= 5 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  );
}

function utf8Probe(buf: Buffer, max = 200): string {
  try {
    return buf
      .toString('utf8', 0, Math.min(max, buf.length))
      .replace(/\s+/g, ' ')
      .slice(0, 140);
  } catch {
    return '';
  }
}

function summarizeBuffer(label: string, buf: Buffer, contentType: string) {
  const pdf = looksPdf(buf);
  const zip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
  console.log(`\n--- ${label} ---`);
  console.log('  contentType:', contentType);
  console.log('  byteLength:', buf.length);
  console.log('  headHex32:', hexPrefix(buf, 32));
  console.log('  looksPdfMagic:', pdf);
  console.log('  zipMagicPK:', zip);
  console.log('  utf8Probe:', JSON.stringify(utf8Probe(buf)));
}

async function main() {
  const emlPath = process.argv[2];
  if (!emlPath || !fs.existsSync(emlPath)) {
    console.error('Uso: npx tsx scripts/analyze-eml.mts <ruta-archivo.eml>');
    process.exit(1);
  }

  const buffer = fs.readFileSync(emlPath);
  console.log('Archivo:', path.resolve(emlPath));
  console.log('Tamaño .eml:', buffer.length, 'bytes');

  const parsed = await simpleParser(buffer);
  console.log('\nAsunto:', parsed.subject);
  console.log('De:', parsed.from?.text);

  const htmlBody = parsed.html || '';
  const textBody = parsed.text || '';

  let linkMatch = htmlBody.match(/<a\s+[^>]*?href=(["'])(.*?)\1[^>]*?>\s*(?:Descargar\s+)?Archivo\s*<\/a>/i);
  let downloadUrl = linkMatch ? linkMatch[2] : null;
  if (!downloadUrl) {
    const textMatch = textBody.match(/Archivo:\s*(https?:\/\/[^\s]+)/i);
    if (textMatch) downloadUrl = textMatch[1];
  }

  console.log('\nEnlace «Archivo» detectado:', downloadUrl ? 'sí' : 'no');
  if (downloadUrl) {
    console.log('  URL (primeros 200 chars):', downloadUrl.slice(0, 200));
    try {
      const response = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxRedirects: 15,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'application/pdf,application/zip,*/*;q=0.8',
        },
        validateStatus: (s) => s < 500,
      });
      console.log('  HTTP status:', response.status);
      const ct = String(response.headers['content-type'] || '').split(';')[0].trim();
      console.log('  Content-Type cabecera:', ct);
      const buf = Buffer.from(response.data);
      summarizeBuffer('Respuesta del enlace «Archivo»', buf, ct);

      const isZip =
        ct === 'application/zip' ||
        downloadUrl.toLowerCase().split('?')[0].endsWith('.zip') ||
        (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b);

      if (isZip) {
        const z = new JSZip();
        await z.loadAsync(buf);
        const names: string[] = [];
        z.forEach((rel, f) => {
          if (!f.dir) names.push(rel);
        });
        console.log('\n  ZIP: entradas:', names.length);
        for (const rel of names) {
          const file = z.file(rel);
          if (!file) continue;
          const innerBuf = Buffer.from(await file.async('nodebuffer'));
          summarizeBuffer(`  ZIP interno: ${rel}`, innerBuf, 'from-zip');
        }
      }
    } catch (e: unknown) {
      console.error('  Error al descargar:', e instanceof Error ? e.message : e);
    }
  }

  const validAttachments = (parsed.attachments || []).filter((att) => {
    if (att.contentType?.startsWith('image/')) return false;
    return true;
  });

  console.log('\nAdjuntos MIME (sin imágenes):', validAttachments.length);
  for (const att of validAttachments) {
    const raw = att.content;
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || []);
    const lowerOrig = (att.filename || '').toLowerCase();
    let contentType = att.contentType || 'application/octet-stream';
    if (lowerOrig.endsWith('.pdf')) contentType = 'application/pdf';

    summarizeBuffer(`MIME: ${att.filename || '(sin nombre)'}`, buf, contentType);

    if (contentType === 'application/zip' || att.filename?.endsWith('.zip')) {
      try {
        const z = new JSZip();
        await z.loadAsync(buf);
        console.log('  (MIME es ZIP — archivos internos)');
        const names: string[] = [];
        z.forEach((rel, f) => {
          if (!f.dir) names.push(rel);
        });
        for (const rel of names) {
          const file = z.file(rel);
          if (!file) continue;
          const data = Buffer.from(await file.async('nodebuffer'));
          summarizeBuffer(`  ZIP interno: ${rel}`, data, 'from-zip');
        }
      } catch (e) {
        console.log('  Error leyendo ZIP:', e instanceof Error ? e.message : e);
      }
    }
  }

  console.log('\nListo.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
