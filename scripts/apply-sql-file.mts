/**
 * Ejecuta un archivo .sql contra DATABASE_URL (pooler Supabase).
 * Uso: npx tsx scripts/apply-sql-file.mts supabase/migrations/20260526120000_profiles_superuser.sql
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function loadEnv() {
  for (const name of ['.env', '.env.local'] as const) {
    const full = path.join(projectRoot, name);
    if (!fs.existsSync(full)) continue;
    dotenv.config({ path: full, override: true });
  }
}

loadEnv();

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error('Uso: npx tsx scripts/apply-sql-file.mts <ruta.sql>');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim();
if (!databaseUrl) {
  console.error('Falta DATABASE_URL o DIRECT_URL en .env');
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve(projectRoot, sqlPath), 'utf8');

const { Client } = await import('pg');
function stripSslMode(raw: string): string {
  const u = new URL(raw);
  u.searchParams.delete('sslmode');
  return u.toString();
}

const client = new Client({
  connectionString: stripSslMode(databaseUrl),
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(sql);
  console.log(`OK: ${sqlPath}`);
} finally {
  await client.end().catch(() => undefined);
}
