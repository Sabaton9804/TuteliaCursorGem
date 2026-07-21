import type { SupabaseClient } from '@supabase/supabase-js';
import { formatRadicado } from './formatters';
import { normalizeRadicadoDigits } from './radicado-cui';
import { ensureSupabaseSessionForWrites } from './supabase-write-auth';

export type UpdateCaseRadicadoResult =
  | { ok: true; radicado: string }
  | { ok: false; error: string };

/** Valida y actualiza `cases.radicado` (23 dígitos); único por juzgado. */
export async function updateCaseRadicado(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    previousRadicado: string;
    nextRaw: string;
  },
): Promise<UpdateCaseRadicadoResult> {
  const next = normalizeRadicadoDigits(opts.nextRaw);
  if (next.length !== 23) {
    return { ok: false, error: 'El radicado debe tener exactamente 23 dígitos.' };
  }
  const prev = normalizeRadicadoDigits(opts.previousRadicado);
  if (next === prev) {
    return { ok: true, radicado: next };
  }

  await ensureSupabaseSessionForWrites();

  const { data: dup, error: dupErr } = await supabase
    .from('cases')
    .select('id')
    .eq('court_id', opts.courtId)
    .eq('radicado', next)
    .neq('id', opts.caseId)
    .maybeSingle();
  if (dupErr) return { ok: false, error: dupErr.message };
  if (dup?.id) {
    return {
      ok: false,
      error: `Ya existe otro expediente con el radicado ${formatRadicado(next)}.`,
    };
  }

  const now = new Date().toISOString();
  const { error: upErr } = await supabase
    .from('cases')
    .update({ radicado: next, updated_at: now })
    .eq('id', opts.caseId)
    .eq('court_id', opts.courtId);
  if (upErr) {
    if (/duplicate|unique/i.test(upErr.message)) {
      return {
        ok: false,
        error: `Ya existe otro expediente con el radicado ${formatRadicado(next)}.`,
      };
    }
    return { ok: false, error: upErr.message };
  }

  // Best-effort: filas que denormalizan el radicado.
  await supabase.from('workflow_tasks').update({ radicado: next }).eq('case_id', opts.caseId);
  await supabase
    .from('precedents')
    .update({ radicado: next, updated_at: now })
    .eq('source_case_id', opts.caseId);

  const { data: u } = await supabase.auth.getUser();
  const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
  await supabase.from('case_actions').insert({
    case_id: opts.caseId,
    type: 'radicado_corregido',
    description: `Radicado corregido: ${formatRadicado(prev)} → ${formatRadicado(next)}`,
    user_id: u.user?.id ?? null,
    user_name: String(uname),
    metadata: { previous: prev, next },
  });

  return { ok: true, radicado: next };
}
