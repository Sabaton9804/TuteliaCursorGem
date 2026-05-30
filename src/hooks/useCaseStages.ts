import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ensureSupabaseSessionForWrites } from '../lib/supabase-write-auth';
import type { CaseType } from '../types';
import {
  pipelineForCaseType,
  responsibleRoleForStage,
  resolveWorkflowAssigneeId,
  workflowTaskPayloadForStage,
  type CaseStageCode,
  type CaseStageResponsibleRole,
} from '../lib/case-workflow-stages';
import { getCachedStageDefinitionId } from '../lib/process-definitions-service';
import { insertWorkflowStageEntryNotifications } from '../lib/workflow-stage-notifications';

export type CaseStageRow = {
  id: string;
  stageCode: CaseStageCode;
  responsibleRole: CaseStageResponsibleRole | null;
  enteredAt: string;
  exitedAt: string | null;
  metadata: Record<string, unknown>;
};

function rowToCaseStage(r: Record<string, unknown>): CaseStageRow | null {
  const code = r.stage_code;
  if (typeof code !== 'string') return null;
  const role = r.responsible_role;
  const rr =
    role === 'secretaria' || role === 'despacho' ? (role as CaseStageResponsibleRole) : null;
  const meta = r.metadata;
  const metadata =
    meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  return {
    id: String(r.id),
    stageCode: code as CaseStageCode,
    responsibleRole: rr,
    enteredAt: typeof r.entered_at === 'string' ? r.entered_at : String(r.entered_at ?? ''),
    exitedAt: typeof r.exited_at === 'string' ? r.exited_at : r.exited_at ? String(r.exited_at) : null,
    metadata,
  };
}

type UseOpts = {
  caseId: string;
  courtId: string;
  radicado: string;
  caseType: CaseType | undefined;
  caseAssignedTo?: string | null;
};

export function useCaseStages(opts: UseOpts) {
  const [rows, setRows] = useState<CaseStageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const autoBootstrapTried = useRef(false);
  const pipeline = useMemo(() => pipelineForCaseType(opts.caseType), [opts.caseType]);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('case_stages')
        .select('id, stage_code, responsible_role, entered_at, exited_at, metadata')
        .eq('case_id', opts.caseId)
        .order('entered_at', { ascending: true });
      if (qErr) throw qErr;
      const parsed = (data ?? [])
        .map((r) => rowToCaseStage(r as Record<string, unknown>))
        .filter(Boolean) as CaseStageRow[];
      setRows(parsed);
      setError(null);
    } catch (e: unknown) {
      console.error('case_stages:', e);
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las etapas.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [opts.caseId]);

  useEffect(() => {
    autoBootstrapTried.current = false;
  }, [opts.caseId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const ch = supabase
      .channel(`case-stages-${opts.caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'case_stages', filter: `case_id=eq.${opts.caseId}` },
        () => void refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [opts.caseId, refetch]);

  const bootstrap = useCallback(async () => {
    if (rows.length > 0) return;
    setBootstrapping(true);
    try {
      await ensureSupabaseSessionForWrites();
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      const first = pipeline[0];
      if (!first) return;
      const rr = responsibleRoleForStage(first);
      const stageDefinitionId = getCachedStageDefinitionId(opts.caseType, first);
      const row: Record<string, unknown> = {
        court_id: opts.courtId,
        case_id: opts.caseId,
        stage_code: first,
        responsible_role: rr,
        entered_at: new Date().toISOString(),
        created_by: uid,
        metadata: { source: 'case_stages_bootstrap' },
      };
      if (stageDefinitionId) row.stage_definition_id = stageDefinitionId;
      const { error: insErr } = await supabase.from('case_stages').insert(row);
      if (insErr) throw insErr;

      const assigneeId = await resolveWorkflowAssigneeId(supabase, {
        courtId: opts.courtId,
        role: rr,
        caseAssignedTo: opts.caseAssignedTo,
      });
      if (assigneeId) {
        const payload = workflowTaskPayloadForStage(first, opts.radicado);
        const { error: tErr } = await supabase.from('workflow_tasks').insert({
          court_id: opts.courtId,
          case_id: opts.caseId,
          radicado: opts.radicado,
          title: payload.title,
          description: payload.description,
          assignee_id: assigneeId,
          creator_id: uid,
          status: 'pending',
          priority: 'medium',
          task_type: payload.task_type,
          metadata: { case_stage_code: first, responsible_role: rr },
        });
        if (tErr) console.error('workflow_tasks bootstrap:', tErr);
      }
      await insertWorkflowStageEntryNotifications(supabase, {
        courtId: opts.courtId,
        caseId: opts.caseId,
        radicado: opts.radicado,
        enteredStage: first,
      });
      await refetch();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar el carril de etapas.');
    } finally {
      setBootstrapping(false);
    }
  }, [rows.length, pipeline, opts.courtId, opts.caseId, opts.radicado, opts.caseAssignedTo, refetch]);

  useEffect(() => {
    if (loading || rows.length > 0 || autoBootstrapTried.current) return;
    autoBootstrapTried.current = true;
    void bootstrap();
  }, [loading, rows.length, bootstrap]);

  const openRow = useMemo(() => rows.find((r) => !r.exitedAt) ?? null, [rows]);

  return {
    rows,
    loading,
    error,
    setError,
    bootstrapping,
    refetch,
    bootstrap,
    pipeline,
    openRow,
    autoBootstrapTried,
  };
}
