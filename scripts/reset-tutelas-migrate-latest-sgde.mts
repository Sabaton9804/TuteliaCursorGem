/**
 * Limpia tutelas históricas (conserva civiles) y remigra las últimas N tutelas
 * según consecutivo de radicado (proxy de «últimas radicadas» en SGDE/plataforma).
 *
 * Uso:
 *   npx tsx scripts/reset-tutelas-migrate-latest-sgde.mts --dry-run
 *   npx tsx scripts/reset-tutelas-migrate-latest-sgde.mts --apply --limit=20
 *   npx tsx scripts/reset-tutelas-migrate-latest-sgde.mts --apply --limit=20 --skip-migrate
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SgdeClient, getDefaultSgdeBaseUrl } from '../server/sgde-client.ts';
import { decryptSgdePassword } from '../server/sgde-crypto.ts';
import { importExpedienteFromSgde } from '../server/sgde-import.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local'] as const) {
    const full = path.join(root, name);
    if (!fs.existsSync(full)) continue;
    Object.assign(merged, dotenv.parse(fs.readFileSync(full, 'utf8')));
  }
  for (const [k, v] of Object.entries(merged)) {
    if (!process.env[k]) process.env[k] = v;
  }
  return merged;
}

const env = loadEnv();
const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');
const skipMigrate = args.includes('--skip-migrate');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1] || '20', 10)) : 20;
const courtId = args.find((a) => a.startsWith('--court='))?.split('=')[1] || 'court-1';

const TUTELA_TYPES = ['tutela_primera', 'tutela_segunda', 'consulta_desacato'] as const;

type TutelaRow = {
  id: string;
  radicado: string;
  case_type: string | null;
  sgde_id: string | null;
  created_at: string | null;
  catalog_metadata: Record<string, unknown> | null;
};

function consecutivoFromRadicado(radicado: string): number {
  const d = radicado.replace(/\D/g, '');
  // CUI 23: …YYYY + 5 consecutivo + 00 instancia → clave año+consecutivo (9 dígitos)
  if (d.length >= 23) return parseInt(d.slice(12, 21), 10) || 0;
  return 0;
}

async function loadSgdeClient(admin: SupabaseClient): Promise<{ client: SgdeClient; userId: string }> {
  const { data: creds, error } = await admin
    .from('sgde_credentials')
    .select('user_id, username, password_ciphertext')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !creds) throw new Error(`Sin credenciales SGDE: ${error?.message || 'vacío'}`);
  const password = decryptSgdePassword(String(creds.password_ciphertext || ''));
  const client = new SgdeClient(getDefaultSgdeBaseUrl());
  await client.login(String(creds.username), password);
  return { client, userId: String(creds.user_id) };
}

async function deleteAllTutelasViaSql(courtId: string): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim();
  if (!databaseUrl) throw new Error('Falta DATABASE_URL o DIRECT_URL para borrar (trigger audit)');

  const { Client } = await import('pg');
  const u = new URL(databaseUrl);
  u.searchParams.delete('sslmode');
  const client = new Client({
    connectionString: u.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query('begin');
    // Evita triggers de auditoría (AFTER DELETE intenta insertar audit con case_id ya borrado).
    await client.query(`set local session_replication_role = replica`);
    const del = await client.query(
      `delete from public.cases
       where court_id = $1
         and case_type = any($2::text[])
       returning id`,
      [courtId, [...TUTELA_TYPES]],
    );
    await client.query('commit');
    return del.rowCount ?? 0;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }
}

async function main() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    console.error('Falta SUPABASE URL / SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log(
    JSON.stringify({ dryRun, skipMigrate, limit, courtId, mode: dryRun ? 'DRY-RUN' : 'APPLY' }, null, 2),
  );

  const { data: allTutelas, error: tErr } = await admin
    .from('cases')
    .select('id, radicado, case_type, sgde_id, created_at, catalog_metadata')
    .eq('court_id', courtId)
    .in('case_type', [...TUTELA_TYPES])
    .limit(5000);
  if (tErr) throw tErr;

  const tutelas = (allTutelas ?? []) as TutelaRow[];
  const { count: civilCount } = await admin
    .from('cases')
    .select('id', { count: 'exact', head: true })
    .eq('court_id', courtId)
    .like('case_type', 'civil_%');

  // Candidatos a remigrar: con sgde_id, preferir activos, luego mayor consecutivo.
  const withSgde = tutelas.filter(
    (r) => r.sgde_id && String(r.radicado || '').replace(/\D/g, '').length >= 21,
  );
  const scoreSit = (r: TutelaRow) => {
    const sit = String(r.catalog_metadata?.situacion_plataforma ?? '')
      .trim()
      .toLowerCase();
    if (sit === 'activo') return 2;
    if (sit === 'terminado' || sit === 'remitido') return 0;
    return 1;
  };
  const candidates = [...withSgde]
    .sort((a, b) => {
      const sa = scoreSit(a);
      const sb = scoreSit(b);
      if (sb !== sa) return sb - sa;
      const ca = consecutivoFromRadicado(String(a.radicado));
      const cb = consecutivoFromRadicado(String(b.radicado));
      if (cb !== ca) return cb - ca;
      return String(b.radicado).localeCompare(String(a.radicado));
    })
    .slice(0, limit);

  console.log(
    JSON.stringify(
      {
        tutelasABorrar: tutelas.length,
        civilesConservar: civilCount,
        aRemigrar: candidates.length,
        remigrarRadicados: candidates.map((c) => ({
          radicado: c.radicado,
          consecutivo: consecutivoFromRadicado(String(c.radicado)),
          type: c.case_type,
          situacion: c.catalog_metadata?.situacion_plataforma ?? null,
        })),
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    console.log('\nDRY-RUN: no se borró ni migró nada. Ejecute con --apply para aplicar.');
    return;
  }

  // Snapshot de radicados a remigrar ANTES del borrado.
  const toMigrate = candidates.map((c) => ({
    radicado: String(c.radicado).replace(/\D/g, '').slice(0, 23),
    caseType: (c.case_type === 'tutela_segunda' ? 'tutela_segunda' : 'tutela_primera') as
      | 'tutela_primera'
      | 'tutela_segunda',
    sgdeId: String(c.sgde_id),
  }));

  console.log(`\nBorrando ${tutelas.length} tutelas (SQL, trigger audit off)…`);
  const deleted = await deleteAllTutelasViaSql(courtId);
  console.log(`Borradas: ${deleted}. Civiles intactos.`);

  const { count: afterTutelas } = await admin
    .from('cases')
    .select('id', { count: 'exact', head: true })
    .eq('court_id', courtId)
    .in('case_type', [...TUTELA_TYPES]);
  const { count: afterCivil } = await admin
    .from('cases')
    .select('id', { count: 'exact', head: true })
    .eq('court_id', courtId)
    .like('case_type', 'civil_%');
  console.log(JSON.stringify({ afterTutelas, afterCivil }, null, 2));

  if (skipMigrate) {
    console.log('skip-migrate: fin.');
    return;
  }

  console.log(`\nMigrando ${toMigrate.length} tutelas desde SGDE…`);
  const { client, userId } = await loadSgdeClient(admin);
  const { data: prof } = await admin.from('profiles').select('name').eq('id', userId).maybeSingle();

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < toMigrate.length; i += 1) {
    const item = toMigrate[i];
    const label = `[${i + 1}/${toMigrate.length}] ${item.radicado}`;
    try {
      const result = await importExpedienteFromSgde({
        client,
        admin,
        userId,
        userName: String(prof?.name || '').trim() || undefined,
        courtId,
        caseType: item.caseType,
        radicadoRaw: item.radicado,
        sgdeNodeIdHint: item.sgdeId || null,
        forceMigrate: true,
      });
      console.log(
        `  OK ${label} caseId=${result.caseId} created=${result.created} migratedDocs=${result.migrated}`,
      );
      ok += 1;
    } catch (e) {
      fail += 1;
      console.error(`  FAIL ${label}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(JSON.stringify({ migrateOk: ok, migrateFail: fail }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
