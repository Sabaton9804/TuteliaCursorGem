/**
 * Demo end-to-end sobre un .eml de reparto segunda instancia:
 * parse judicial + segunda instancia + preflight SGDE (si hay credenciales).
 *
 * Uso:
 *   npx tsx scripts/demo-segunda-instancia-eml.mts "C:\ruta\correo.eml"
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseJudicialEmailFromBuffer } from '../server/parse-judicial-email.ts';
import {
  digestPdfAttachmentsForSegundaInstancia,
  parseSegundaInstanciaFromEmail,
} from '../server/sgde-segunda-instancia-parse.ts';
import { getParseSession } from '../server/parse-email-sessions.ts';
import { sgdePlatformState } from '../server/sgde-integration.ts';
import { sgdeEncryptionAvailable } from '../server/sgde-crypto.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const RECOMMENDED_LABELS: Record<string, string> = {
  sentencia_fallo: 'Sentencia / fallo de origen',
  impugnacion_memorial: 'Escrito / memorial de impugnación',
  notificacion: 'Notificaciones / constancias',
};

async function main() {
  const emlPath = process.argv[2];
  if (!emlPath || !fs.existsSync(emlPath)) {
    console.error('Uso: npx tsx scripts/demo-segunda-instancia-eml.mts <ruta-archivo.eml>');
    process.exit(1);
  }

  console.log('='.repeat(72));
  console.log('DEMO — Segunda instancia desde correo de reparto');
  console.log('='.repeat(72));
  console.log('Archivo:', path.resolve(emlPath));
  console.log('');

  const buffer = fs.readFileSync(emlPath);
  const parsed = await parseJudicialEmailFromBuffer(buffer);
  const text = typeof parsed.text === 'string' ? parsed.text : '';
  const html = typeof parsed.html === 'string' ? parsed.html : '';

  const session = getParseSession(parsed.parseSessionId);
  let pdfDigest = '';
  if (session?.attachments?.length) {
    pdfDigest = await digestPdfAttachmentsForSegundaInstancia(session.attachments);
    console.log('Texto extraído de PDFs (primeros 400 chars):', pdfDigest.slice(0, 400).replace(/\s+/g, ' '));
  }
  const si = parseSegundaInstanciaFromEmail(String(parsed.subject || ''), `${text}\n${pdfDigest}`, html);

  console.log('--- 1) Correo parseado (Tutelia) ---');
  console.log('Asunto:', parsed.subject);
  console.log('De:', parsed.from);
  console.log('Fecha:', parsed.date);
  console.log('Adjuntos (sin imágenes):', parsed.attachments?.length ?? 0);
  for (const a of parsed.attachments || []) {
    console.log(`  · ${a.filename} (${a.contentType}, ${a.size} bytes, link=${a.isFromLink})`);
  }
  console.log('Enlace Archivo/ZIP en HTML:', parsed.linkFound ? 'sí' : 'no');
  if (parsed.linkUrl) console.log('  URL:', String(parsed.linkUrl).slice(0, 120) + '…');

  console.log('\n--- 2) Detección segunda instancia ---');
  console.log(JSON.stringify(si, null, 2));
  console.log(
    si.isSegundaInstancia
      ? '\n✓ Tutelia clasificaría esto como ingreso de SEGUNDA INSTANCIA (no tutela nueva de 1ª).'
      : '\n✗ No se detectaron señales de segunda instancia (revisar heurísticas).'
  );

  if (!si.originRadicado) {
    console.error('\nNo se extrajo CUI de 23 dígitos; no se puede consultar SGDE.');
    process.exit(1);
  }

  console.log('\n--- 3) SGDE preflight (expediente de origen) ---');
  const platform = sgdePlatformState();
  console.log('Plataforma SGDE:', platform.available ? 'disponible' : 'no');
  console.log('Cifrado credenciales (SGDE_CREDENTIALS_KEY):', sgdeEncryptionAvailable());
  if (!platform.available) {
    console.log(
      '\n⚠ SGDE no disponible en servidor o sin clave de cifrado.\n' +
        '   Cada usuario configura su usuario/contraseña SGDE en Ajustes (no en .env).'
    );
    console.log('\n--- Resumen operativo (sin SGDE) ---');
    console.log('Radicado origen (CUI):', si.originRadicado);
    console.log('Juzgado origen:', si.originCourt);
    console.log('Secuencia reparto local:', si.repartoSecuencia);
    console.log('Motivo:', (si.motivo || '').slice(0, 200));
    process.exit(0);
  }

  console.log(
    '\nEl preflight SGDE en vivo requiere credenciales guardadas por cada usuario en Tutelia (Ajustes).\n' +
      'Este script CLI no sustituye ese paso: inicie sesión en la app → Ajustes → Interconexión SGDE → Guardar y validar,\n' +
      'luego use Correo → Ingresar 2ª instancia (SGDE) con este mismo .eml.'
  );
  console.log('\n--- 4) Qué haría la UI con este correo (tras configurar SGDE en Ajustes) ---');
  console.log('→ Preflight del CUI', si.originRadicado);
  console.log('→ Si hay PDFs en SGDE: radicar J51 + migrar cuaderno a SI_C01_PRINCIPAL');
  console.log('→ Si no_encontrado: bloquear hasta traslado del J48');
  console.log('\nListo.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
