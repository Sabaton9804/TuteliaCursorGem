import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Scale, Check, Circle, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase';
import { useSessionCourt } from '../contexts/SessionCourtContext';
import { formatRadicado } from '../lib/formatters';
import { rowToCase, rowToCaseDoc } from '../lib/supabase-mappers';
import type { Case, Document } from '../types';
import type { CaseStageCode } from '../lib/case-workflow-stages';
import { STAGE_LABEL_ES } from '../lib/case-workflow-stages';
import { buildCaseContestacionChecklist } from '../lib/case-contestacion-checklist';
import {
  businessDaysRemainingUntilSubDeadline,
  resolveSubStageDeadline,
} from '../lib/case-stage-deadlines';
import { hasRoleCapability } from '../lib/role-capabilities';
import { CIVIL_CASE_TYPES } from '../lib/process-product-scope';
import { startOfLocalDay } from '../lib/business-days';
import { parseISO } from 'date-fns';

type OpenStageRow = {
  caseId: string;
  stageCode: CaseStageCode;
  enteredAt: string;
  metadata: Record<string, unknown> | null;
};

const TABLERO_STAGES = new Set<CaseStageCode>([
  'TERMINO_RESPUESTA',
  'TERMINO_EXCEPCIONES',
  'TRAMITE',
  'INGRESO_DESPACHO_FALLO',
  'TERMINO_APELACION',
]);

type TableroRow = {
  caseItem: Case;
  stage: OpenStageRow;
  checklist: ReturnType<typeof buildCaseContestacionChecklist>;
  plazoLabel: string;
};

export default function SustanciadorTablero() {
  const { courtId, profile } = useSessionCourt();
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<Case[]>([]);
  const [stages, setStages] = useState<Map<string, OpenStageRow>>(new Map());
  const [docsByCase, setDocsByCase] = useState<Map<string, Document[]>>(new Map());
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!courtId) return;
    setLoading(true);
    setErr(null);
    try {
      const tableroTypes = ['tutela_primera', ...CIVIL_CASE_TYPES] as const;
      const { data: caseRows, error: caseErr } = await supabase
        .from('cases')
        .select('*')
        .eq('court_id', courtId)
        .in('case_type', [...tableroTypes])
        .neq('status', 'archived')
        .order('updated_at', { ascending: false })
        .limit(200);
      if (caseErr) throw caseErr;
      const mapped = (caseRows ?? []).map((r) => rowToCase(r as Record<string, unknown>));
      setCases(mapped);

      const caseIds = mapped.map((c) => c.id);
      if (caseIds.length === 0) {
        setStages(new Map());
        setDocsByCase(new Map());
        return;
      }

      const { data: stageRows, error: stErr } = await supabase
        .from('case_stages')
        .select('case_id, stage_code, entered_at, metadata')
        .eq('court_id', courtId)
        .in('case_id', caseIds)
        .is('exited_at', null);
      if (stErr) throw stErr;

      const stageMap = new Map<string, OpenStageRow>();
      for (const r of stageRows ?? []) {
        const row = r as Record<string, unknown>;
        const code = String(row.stage_code ?? '') as CaseStageCode;
        if (!TABLERO_STAGES.has(code)) continue;
        stageMap.set(String(row.case_id), {
          caseId: String(row.case_id),
          stageCode: code,
          enteredAt: String(row.entered_at ?? ''),
          metadata: (row.metadata as Record<string, unknown>) ?? null,
        });
      }
      setStages(stageMap);

      const tableroIds = [...stageMap.keys()];
      if (tableroIds.length === 0) {
        setDocsByCase(new Map());
        return;
      }

      const { data: docRows, error: docErr } = await supabase
        .from('case_documents')
        .select('id, case_id, name, type, act_code, party_entity, sort_order, storage_path, content, created_at')
        .in('case_id', tableroIds);
      if (docErr) throw docErr;

      const docMap = new Map<string, Document[]>();
      for (const r of docRows ?? []) {
        const cid = String((r as Record<string, unknown>).case_id);
        const doc = rowToCaseDoc(r as Record<string, unknown>, cid);
        const list = docMap.get(cid) ?? [];
        list.push(doc);
        docMap.set(cid, list);
      }
      setDocsByCase(docMap);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al cargar tablero.');
      setCases([]);
      setStages(new Map());
      setDocsByCase(new Map());
    } finally {
      setLoading(false);
    }
  }, [courtId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo((): TableroRow[] => {
    const out: TableroRow[] = [];

    for (const c of cases) {
      const stage = stages.get(c.id);
      if (!stage) continue;
      const docs = docsByCase.get(c.id) ?? [];
      const end =
        resolveSubStageDeadline(stage.stageCode, stage.enteredAt, stage.metadata ?? {}, c.caseType) ??
        (c.deadlineAt ? startOfLocalDay(parseISO(c.deadlineAt)) : null);
      const remaining = end ? businessDaysRemainingUntilSubDeadline(end) : null;
      const plazoVencido = remaining != null && remaining <= 0;
      const plazoLabel =
        remaining == null ? '—' : remaining > 0 ? `${remaining} día(s) hábil(es)` : 'Vencido';

      out.push({
        caseItem: c,
        stage,
        checklist: buildCaseContestacionChecklist({
          caseItem: c,
          docs,
          openStageCode: stage.stageCode,
          plazoVencido,
        }),
        plazoLabel,
      });
    }

    out.sort((a, b) => {
      if (a.checklist.listoParaFallo !== b.checklist.listoParaFallo) {
        return a.checklist.listoParaFallo ? -1 : 1;
      }
      return b.caseItem.updatedAt.localeCompare(a.caseItem.updatedAt);
    });

    return out;
  }, [cases, stages, docsByCase]);

  const listos = rows.filter((r) => r.checklist.listoParaFallo);
  const pendientes = rows.filter((r) => !r.checklist.listoParaFallo);

  const canViewTablero = hasRoleCapability(profile?.role, 'ver_sustanciador_tablero');

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-violet-700">
          <Scale className="h-4 w-4" />
          Sustanciación
        </p>
        <h1 className="text-2xl font-bold text-slate-900">Tablero sustanciador</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tutelas en término de respuesta o listas para fallo.{' '}
          {canViewTablero ? 'Priorice las filas «listas para fallo».' : 'Vista operativa del despacho.'}
        </p>
      </header>

      {err ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</p> : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          No hay tutelas en término de respuesta ni en ingreso a despacho para fallo.
        </p>
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-emerald-800">
              Listas para fallo ({listos.length})
            </h2>
            <TableroTable items={listos} empty="Ninguna aún — cargue contestaciones o espere el vencimiento del plazo." />
          </section>
          <section>
            <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-amber-800">
              Faltan contestaciones ({pendientes.length})
            </h2>
            <TableroTable items={pendientes} empty="Todas las filas visibles están listas." />
          </section>
        </>
      )}
    </motion.div>
  );
}

function TableroTable({ items, empty }: { items: TableroRow[]; empty: string }) {
  if (items.length === 0) {
    return <p className="rounded-xl border border-slate-100 bg-white px-4 py-3 text-sm text-slate-500">{empty}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
      <table className="min-w-full text-left text-xs">
        <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500">
          <tr>
            <th className="px-3 py-2">Radicado</th>
            <th className="px-3 py-2">Partes</th>
            <th className="px-3 py-2">Etapa</th>
            <th className="px-3 py-2">Plazo</th>
            <th className="px-3 py-2">Contestaciones</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {items.map(({ caseItem, stage, checklist, plazoLabel }) => (
            <tr key={caseItem.id} className="hover:bg-violet-50/40">
              <td className="px-3 py-2.5 font-mono font-semibold text-slate-900">
                {formatRadicado(caseItem.radicado)}
              </td>
              <td className="max-w-[12rem] px-3 py-2.5 text-slate-700">
                <span className="line-clamp-2">
                  {caseItem.claimant} vs {caseItem.defendant}
                </span>
              </td>
              <td className="px-3 py-2.5 text-slate-600">{STAGE_LABEL_ES[stage.stageCode]}</td>
              <td className="px-3 py-2.5">
                <span className={plazoLabel === 'Vencido' ? 'font-bold text-red-700' : 'text-slate-700'}>
                  {plazoLabel}
                </span>
              </td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1">
                  {checklist.listoParaFallo ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  )}
                  {checklist.totalResponded}/{checklist.totalRequired || '—'}
                </span>
                {checklist.parties.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-[10px] text-slate-500">
                    {checklist.parties.map((p) => (
                      <li key={p.entityName} className="flex items-center gap-1">
                        {p.respuestaCargada ? (
                          <Check className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <Circle className="h-3 w-3 text-amber-500" />
                        )}
                        {p.entityName}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </td>
              <td className="px-3 py-2.5 text-right">
                <Link
                  to={`/case/${caseItem.id}?tab=documentos`}
                  className="font-bold uppercase tracking-wide text-accent hover:underline"
                >
                  Proyectar →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
