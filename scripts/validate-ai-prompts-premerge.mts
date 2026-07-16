/**
 * Validación pre-merge de prompts IA (síntesis + truncado PDF).
 *
 * Comprueba:
 * 1) synthesizeCase civil / tutela / consulta — zod en primer intento
 * 2) guardrail anti-alucinación (sin plazo → "no consta")
 * 3) slice PDF >25 páginas → truncated:true
 *
 * Uso: npx tsx scripts/validate-ai-prompts-premerge.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  generateCaseSynthesisDetailed,
  type CaseSynthesisInput,
} from '../server/synthesize-case-service.ts';
import { slicePdfBase64FirstPages, LEGAL_ANALYSIS_MAX_PAGES } from '../server/pdf-first-pages.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local'] as const) {
    const full = path.join(root, name);
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
for (const [k, v] of Object.entries(env)) {
  if (!process.env[k]) process.env[k] = v;
}

type Check = { name: string; ok: boolean; detail: string };

function failMsg(checks: Check[]): string {
  return checks
    .filter((c) => !c.ok)
    .map((c) => `- FAIL ${c.name}: ${c.detail}`)
    .join('\n');
}

function looksLikeNoConsta(text: string): boolean {
  const n = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    n.includes('no consta') ||
    n.includes('no registrado') ||
    n.includes('sin plazo') ||
    n.includes('no indicado') ||
    n.includes('no hay') ||
    n.includes('no aparece')
  );
}

function looksLikeInventedDate(text: string): boolean {
  // Fechas concretas tipo 2026-0x-xx / "15 de enero" en campo de plazos cuando no había dato.
  return /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/.test(text) || /\b\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i.test(text);
}

async function fetchOneCase(
  admin: ReturnType<typeof createClient>,
  caseType: string,
): Promise<CaseSynthesisInput | null> {
  const { data, error } = await admin
    .from('cases')
    .select(
      'id, radicado, case_type, claimant, defendant, subject, status, operational_status, deadline_at, assigned_to, legal_hechos, legal_pretensiones, legal_derecho_tutelado, raw_text, catalog_metadata',
    )
    .eq('case_type', caseType)
    .not('raw_text', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(5);

  if (error) {
    console.warn(`[db] ${caseType}:`, error.message);
    return null;
  }
  const row = (data ?? []).find((r) => String(r.raw_text || '').trim().length > 80) ?? data?.[0];
  if (!row) return null;

  const [{ data: docs }, { data: actions }] = await Promise.all([
    admin
      .from('case_documents')
      .select('name, original_name')
      .eq('case_id', row.id)
      .limit(8),
    admin
      .from('case_actions')
      .select('description')
      .eq('case_id', row.id)
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  return {
    radicado: String(row.radicado ?? 'SIN-RAD'),
    caseType: String(row.case_type),
    claimant: String(row.claimant ?? ''),
    defendant: String(row.defendant ?? ''),
    subject: row.subject ? String(row.subject) : null,
    status: row.status ? String(row.status) : null,
    operationalStatus: row.operational_status ? String(row.operational_status) : null,
    deadlineAt: row.deadline_at ? String(row.deadline_at) : null,
    assignedTo: row.assigned_to ? String(row.assigned_to) : null,
    legalHechos: row.legal_hechos ? String(row.legal_hechos) : null,
    legalPretensiones: row.legal_pretensiones ? String(row.legal_pretensiones) : null,
    legalDerechoTutelado: row.legal_derecho_tutelado ? String(row.legal_derecho_tutelado) : null,
    rawText: row.raw_text ? String(row.raw_text) : null,
    catalogMetadata:
      row.catalog_metadata && typeof row.catalog_metadata === 'object'
        ? (row.catalog_metadata as Record<string, unknown>)
        : null,
    documentTitles: (docs ?? [])
      .map((d) => String(d.original_name || d.name || '').trim())
      .filter(Boolean),
    actionLines: (actions ?? [])
      .map((a) => String(a.description || '').trim())
      .filter(Boolean),
  };
}

function fixture(kind: 'civil' | 'tutela' | 'consulta'): CaseSynthesisInput {
  if (kind === 'civil') {
    return {
      radicado: '11001310305120260012300',
      caseType: 'civil_ejecutivo',
      claimant: 'BANCO DEMO S.A.',
      defendant: 'JUAN PEREZ GOMEZ',
      subject: 'Ejecutivo singular',
      status: 'received',
      deadlineAt: null,
      legalDerechoTutelado: 'EJECUTIVOS',
      rawText: `Demanda ejecutiva. El demandante Banco Demo S.A. pretende el pago de obligación contenida en pagaré.
Hechos: el demandado suscribió pagaré por $50.000.000; incumplió cuotas desde marzo de 2025.
Pretensiones: librar mandamiento de pago y decretar medidas cautelares.
No consta en el expediente fecha de vencimiento del término de excepciones ni auto de mandamiento.`,
      documentTitles: ['Demanda.pdf', 'Pagare.pdf'],
      actionLines: ['Radicación por correo'],
    };
  }
  if (kind === 'consulta') {
    return {
      radicado: '11001310305120260045600',
      caseType: 'consulta_desacato',
      claimant: 'MARIA LOPEZ',
      defendant: 'EPS DEMO',
      subject: 'Consulta incidente de desacato',
      status: 'received',
      deadlineAt: null,
      legalDerechoTutelado: 'SALUD',
      rawText: `Consulta del incidente de desacato frente a EPS Demo por incumplimiento de orden de tutela de salud.
El juzgado de primera instancia sancionó; se remite en consulta.
No figura en el expediente la fecha límite para decidir la consulta ni el oficio de remisión completo.`,
      documentTitles: ['OficioRemision.pdf'],
      actionLines: ['Ingreso por reparto consulta'],
    };
  }
  return {
    radicado: '11001310305120260078900',
    caseType: 'tutela_primera',
    claimant: 'PEDRO RAMIREZ',
    defendant: 'EPS DEMO',
    subject: 'Tutela derecho de petición',
    status: 'received',
    deadlineAt: null,
    legalDerechoTutelado: 'DERECHO DE PETICIÓN',
    rawText: `Acción de tutela. Accionante Pedro Ramirez contra EPS Demo por no resolver petición de medicamentos.
Hechos: radicó derecho de petición el 10 de mayo de 2026; a la fecha no hay respuesta.
Pretensiones: ordenar respuesta de fondo en 48 horas.
No consta en el expediente el auto admisorio ni el término de traslado ya corrido.`,
    documentTitles: ['Tutela.pdf'],
    actionLines: ['Radicación'],
  };
}

async function buildMultiPagePdfBase64(pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Pagina de prueba ${i + 1} de ${pages}`, {
      x: 50,
      y: 700,
      size: 14,
      font,
    });
  }
  const bytes = await doc.save();
  return Buffer.from(bytes).toString('base64');
}

async function main() {
  const checks: Check[] = [];
  const openaiKey = env.OPENAI_API_KEY || '';
  if (!openaiKey) {
    console.error('Falta OPENAI_API_KEY');
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: openaiKey });
  const url =
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.VITE_SUPABASE_URL ||
    env.SUPABASE_URL ||
    '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const admin =
    url && serviceKey
      ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;

  const targets: Array<{ label: string; caseType: string; fixtureKind: 'civil' | 'tutela' | 'consulta' }> = [
    { label: 'civil', caseType: 'civil_ordinario', fixtureKind: 'civil' },
    { label: 'tutela', caseType: 'tutela_primera', fixtureKind: 'tutela' },
    { label: 'consulta', caseType: 'consulta_desacato', fixtureKind: 'consulta' },
  ];

  // También probar civil_ejecutivo si ordinario no existe
  const altCivil = 'civil_ejecutivo';

  console.log('=== 1) Síntesis por bucket (zod primer intento) ===');
  for (const t of targets) {
    let input: CaseSynthesisInput | null = null;
    let source = 'fixture';
    if (admin) {
      input = await fetchOneCase(admin, t.caseType);
      if (!input && t.fixtureKind === 'civil') {
        input = await fetchOneCase(admin, altCivil);
      }
      if (input) source = `db:${input.radicado}`;
    }
    if (!input) input = fixture(t.fixtureKind);

    // Quitar deadline para no contaminar el test de alucinación en el mismo lote
    // (el test 2 es explícito; aquí solo schema).
    console.log(`→ ${t.label} (${source}, caseType=${input.caseType})…`);
    try {
      const result = await generateCaseSynthesisDetailed(openai, input);
      const ok = result.firstAttemptOk;
      checks.push({
        name: `synth_${t.label}_first_attempt`,
        ok,
        detail: ok
          ? `kind=${result.kind} prompt=${result.promptVersion}`
          : `zod solo pasó en RETRY (kind=${result.kind})`,
      });
      console.log(
        ok ? `  OK firstAttempt` : `  WARN retry needed`,
        `kind=${result.kind}`,
        `mdChars=${result.markdown.length}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      checks.push({ name: `synth_${t.label}_first_attempt`, ok: false, detail: msg });
      console.error(`  FAIL:`, msg);
    }
  }

  console.log('\n=== 2) Guardrail anti-alucinación (sin plazo) ===');
  {
    const input = fixture('tutela');
    input.deadlineAt = null;
    input.rawText = `${input.rawText || ''}

IMPORTANTE PARA LA PRUEBA: en este expediente NO aparece ninguna fecha de término,
plazo de traslado, ni deadline. No inventes fechas.`;
    try {
      const result = await generateCaseSynthesisDetailed(openai, input);
      const plazosField =
        'plazos' in result.data
          ? String((result.data as { plazos?: string }).plazos || '')
          : '';
      const terminosField =
        'terminos' in result.data
          ? String((result.data as { terminos?: string }).terminos || '')
          : '';
      const field = plazosField || terminosField || result.markdown;
      const noConsta = looksLikeNoConsta(field);
      const invented = looksLikeInventedDate(field) && !looksLikeNoConsta(field);
      const ok = noConsta && !invented;
      checks.push({
        name: 'anti_hallucination_no_plazo',
        ok,
        detail: ok
          ? `campo plazos/terminos: ${field.slice(0, 160)}`
          : `esperado "no consta…"; obtenido: ${field.slice(0, 240)}`,
      });
      console.log(ok ? '  OK guardrail' : '  FAIL guardrail', field.slice(0, 200));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      checks.push({ name: 'anti_hallucination_no_plazo', ok: false, detail: msg });
      console.error('  FAIL:', msg);
    }
  }

  console.log('\n=== 3) Truncado PDF > LEGAL_ANALYSIS_MAX_PAGES ===');
  {
    const pages = LEGAL_ANALYSIS_MAX_PAGES + 15;
    const b64 = await buildMultiPagePdfBase64(pages);
    const sliced = await slicePdfBase64FirstPages(b64, LEGAL_ANALYSIS_MAX_PAGES);
    const ok =
      sliced.truncated === true &&
      sliced.totalPages === pages &&
      sliced.usedPages === LEGAL_ANALYSIS_MAX_PAGES;
    checks.push({
      name: 'pdf_truncation',
      ok,
      detail: `total=${sliced.totalPages} used=${sliced.usedPages} truncated=${sliced.truncated} max=${LEGAL_ANALYSIS_MAX_PAGES}`,
    });
    console.log(
      ok ? '  OK truncado' : '  FAIL truncado',
      `total=${sliced.totalPages} used=${sliced.usedPages} truncated=${sliced.truncated}`,
    );
  }

  const failed = checks.filter((c) => !c.ok);
  console.log('\n=== RESUMEN ===');
  console.log(JSON.stringify(checks, null, 2));
  if (failed.length) {
    console.error('\nPRE-MERGE FAIL\n' + failMsg(checks));
    process.exit(1);
  }
  console.log('\nPRE-MERGE OK — listo para commit/push');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
