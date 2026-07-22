import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { refreshSegundaPartiesFromFallo } from '../server/segunda-fallo-parties-service.ts';
import { pickFalloPrimeraDocument } from '../src/lib/segunda-fallo-parties.ts';

const CASE_ID = 'f0369192-f0b3-4304-af3f-0d614caeca05';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8'));

async function main() {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: c } = await admin
    .from('cases')
    .select('claimant,defendant,legal_hechos,legal_pretensiones,legal_derecho_tutelado')
    .eq('id', CASE_ID)
    .single();
  console.log('BEFORE', c);

  const { data: docs } = await admin
    .from('case_documents')
    .select('id,name,original_name,type,notebook_code,sgde_folder_path,sort_order,storage_path')
    .eq('case_id', CASE_ID);
  const mapped = (docs || []).map((r) => ({
    id: String(r.id),
    name: String(r.name || ''),
    originalName: r.original_name ? String(r.original_name) : undefined,
    type: String(r.type || ''),
    notebookCode: r.notebook_code ? String(r.notebook_code) : undefined,
    sgdeFolderPath: r.sgde_folder_path ? String(r.sgde_folder_path) : undefined,
    sortOrder: typeof r.sort_order === 'number' ? r.sort_order : undefined,
  }));
  const fallo = pickFalloPrimeraDocument(mapped);
  console.log('FALLO', fallo?.name, fallo?.id);

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const res = await refreshSegundaPartiesFromFallo({ admin, openai, caseId: CASE_ID, force: true });
  console.log('RESULT', JSON.stringify(res, null, 2));

  const { data: after } = await admin
    .from('cases')
    .select('claimant,defendant,legal_hechos,legal_pretensiones,legal_derecho_tutelado')
    .eq('id', CASE_ID)
    .single();
  console.log('AFTER', after);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
