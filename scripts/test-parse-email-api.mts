/**
 * Prueba POST /api/parse-email contra servidor local.
 * Uso: npx tsx scripts/test-parse-email-api.mts "ruta\correo.eml"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const eml = process.argv[2];
if (!eml || !fs.existsSync(eml)) {
  console.error('Uso: npx tsx scripts/test-parse-email-api.mts <archivo.eml>');
  process.exit(1);
}

const port = process.env.PORT || '3000';
const base = `http://127.0.0.1:${port}`;
const buf = fs.readFileSync(eml);
const boundary = '----TuteliaTest' + Date.now();
const body = Buffer.concat([
  Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="email"; filename="test.eml"\r\nContent-Type: message/rfc822\r\n\r\n`
  ),
  buf,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);

const res = await fetch(`${base}/api/parse-email`, {
  method: 'POST',
  headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  body,
});
const text = await res.text();
console.log('HTTP', res.status);
try {
  const j = JSON.parse(text) as Record<string, unknown>;
  console.log('parseSessionId:', j.parseSessionId);
  console.log('segundaInstancia:', JSON.stringify(j.segundaInstancia, null, 2));
  console.log('attachments:', Array.isArray(j.attachments) ? j.attachments.length : j.attachments);
} catch {
  console.log(text.slice(0, 800));
}
process.exit(res.ok ? 0 : 1);
