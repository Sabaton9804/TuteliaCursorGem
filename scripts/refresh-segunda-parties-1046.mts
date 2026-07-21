/** Extrae partes/hechos del fallo PI — tutela 2ª 2026-1046. */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { refreshSegundaPartiesFromFallo } from '../server/segunda-fallo-parties-service.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function loadEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local'] as const) {
    const full = path.join(projectRoot, name);
    if (!fs.existsSync(full)) continue;
    const parsed = dotenv.parse(fs.readFileSync(full, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) {
      const t = String(v).trim();
      if (t) merged[k] = t;
    }
  }
  return merged;
}

const env = loadEnv();
const CASE_ID = '9c64cc8b-9b67-42f0-9356-9cf62b1ef9c0';

async function main() {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const openaiKey = env.OPENAI_API_KEY || '';
  if (!url || !key) throw new Error('Faltan VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  if (!openaiKey) throw new Error('Falta OPENAI_API_KEY');

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const openai = new OpenAI({ apiKey: openaiKey });

  const result = await refreshSegundaPartiesFromFallo({
    admin,
    openai,
    caseId: CASE_ID,
    force: true,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
