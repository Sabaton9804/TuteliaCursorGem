/**
 * Aplica migraciones SQL pendientes en supabase/migrations vía Prisma (DIRECT_URL / DATABASE_URL).
 * Uso: npx tsx scripts/apply-pending-migrations.mts [nombre_archivo ...]
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function loadEnv() {
  for (const name of ['.env', '.env.local']) {
    const full = path.join(projectRoot, name);
    if (fs.existsSync(full)) dotenv.config({ path: full, override: true });
  }
}

loadEnv();

const defaultMigrations = [
  '20260604120000_tutela_segunda_plazo_20_dias.sql',
  '20260604130000_add_index_status_to_precedents.sql',
  '20260604140000_precedents_legal_specialty.sql',
  '20260604150000_precedents_issuer_category.sql',
  '20260605120000_court_mailboxes_shared.sql',
  '20260609120000_case_act_types.sql',
  '20260609130000_document_templates_notificaciones.sql',
];

const files = process.argv.slice(2).length ? process.argv.slice(2) : defaultMigrations;
const conn = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!conn) {
  console.error('Falta DIRECT_URL o DATABASE_URL en .env / .env.local');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const full = path.join(projectRoot, 'supabase', 'migrations', file);
  if (!fs.existsSync(full)) {
    console.error('No existe:', full);
    failed = 1;
    continue;
  }
  const sql = fs.readFileSync(full, 'utf8');
  console.log('\n--- Aplicando', file, '---');
  const r = spawnSync(
    'npx',
    ['prisma', 'db', 'execute', '--stdin', '--config', path.join(projectRoot, 'prisma.config.ts')],
    {
      cwd: projectRoot,
      input: sql,
      encoding: 'utf-8',
      shell: true,
      timeout: 120_000,
      env: { ...process.env, DATABASE_URL: conn },
    },
  );
  if (r.status !== 0) {
    console.error('FALLO', file);
    if (r.stderr) console.error(r.stderr);
    if (r.stdout) console.error(r.stdout);
    failed = 1;
    break;
  }
  console.log('OK', file);
}

process.exit(failed);
