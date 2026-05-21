import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  rowToAction,
  rowToCase,
  rowToCaseAuditLogEntry,
  rowToCaseDoc,
  rowToUserProfile,
} from '../lib/supabase-mappers';
import { Action, Case, CaseAuditLogEntry, Document as CaseDoc, UserProfile } from '../types';
import type { CaseStatus, SustanciadorAssignmentMode } from '../types';
import {
  FileText,
  Sparkles,
  ChevronDown,
  ChevronLeft,
  Loader2,
  UserCog,
  FolderOutput,
  FilePenLine,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';
import { summarizeCase } from '../services/geminiService';
import { formatRadicado } from '../lib/formatters';
import { schedulePrecedentIndexAfterDecisionType } from '../lib/precedents-index-client';
import { CaseSintesisPanel } from '../components/expediente/CaseSintesisPanel';
import { CaseActuacionesPanel } from '../components/expediente/CaseActuacionesPanel';
import { CaseDespachoPanel } from '../components/expediente/CaseDespachoPanel';
import { CaseStagePanel } from '../components/expediente/CaseStagePanel';
import { CaseHistorialPanel } from '../components/expediente/CaseHistorialPanel';
import { CASE_STATUS_LABEL } from '../components/expediente/case-detail-status-labels';
import {
  CaseDetailProvider,
  type CaseDetailContextValue,
  type CaseDetailExpedienteTab,
} from '../contexts/CaseDetailContext';
import { CaseWordReviewPanel } from '../components/expediente/CaseWordReviewPanel';
import { CaseIncidenteDesacatoPanel } from '../components/expediente/CaseIncidenteDesacatoPanel';
import { CaseExpedienteDigitalPanel } from '../components/expediente/CaseExpedienteDigitalPanel';
import { CaseSgdePanel } from '../components/expediente/CaseSgdePanel';
import { buildCaseActuacionesTimeline, buildSynthesisContextBlock } from '../lib/case-detail-context';
import { resolveAssigneeForCase, SUSTANCIADORES } from '../lib/court-staff-assignees';
import { ensureSupabaseSessionForWrites } from '../lib/supabase-write-auth';
import { parseSustanciadorAssignmentMode } from '../lib/sustanciador-reparto';
import {
  insertAssignmentNotificationsForProfiles,
  markAssignmentNotificationsReadForCase,
} from '../lib/assignment-notifications';
import {
  DERECHO_TUTELADO_CODES,
  DERECHO_TUTELADO_LABELS,
  DECISION_TYPES,
  DECISION_TYPE_LABELS,
  parseDerechoTuteladoCode,
  parseDecisionType,
} from '../lib/sierju-case-codes';
type ExpedienteTab = CaseDetailExpedienteTab;

const TAB_QUERY_VALUES = new Set<string>([
  'sintesis',
  'expediente',
  'revision_word',
  'actuaciones',
  'historial',
  /** Compatibilidad con enlaces antiguos (?tab=auditoria). */
  'auditoria',
  'documentos',
  'incidente_desacato',
]);

function parseExpedienteTabParam(raw: string | null): ExpedienteTab {
  if (raw === 'auditoria' || raw === 'historial') return 'historial';
  if (
    raw === 'expediente' ||
    raw === 'revision_word' ||
    raw === 'actuaciones' ||
    raw === 'documentos' ||
    raw === 'incidente_desacato'
  )
    return raw;
  return 'sintesis';
}


export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const [caseItem, setCaseItem] = useState<Case | null>(null);
  const [docs, setDocs] = useState<CaseDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<CaseDoc | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [loading, setLoading] = useState(true);
  /** Evita mostrar «sincronizando» cuando en realidad no hay filas en `case_documents`. */
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [actions, setActions] = useState<Action[]>([]);
  const [auditLog, setAuditLog] = useState<CaseAuditLogEntry[]>([]);
  const [auditFetchErr, setAuditFetchErr] = useState<string | null>(null);
  const [auditActorNames, setAuditActorNames] = useState<Record<string, string>>({});
  const [assignDraft, setAssignDraft] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [newActionText, setNewActionText] = useState('');
  const [manualActSaving, setManualActSaving] = useState(false);
  const [derechoCodeSaving, setDerechoCodeSaving] = useState(false);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [deadlineDraft, setDeadlineDraft] = useState('');
  const [deadlineNoteDraft, setDeadlineNoteDraft] = useState('');
  const [deadlineSaving, setDeadlineSaving] = useState(false);
  const [courtAssignmentMode, setCourtAssignmentMode] = useState<SustanciadorAssignmentMode | null>(null);
  const [sessionProfile, setSessionProfile] = useState<UserProfile | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const timeline = useMemo(
    () => (caseItem ? buildCaseActuacionesTimeline(caseItem, actions) : []),
    [caseItem, actions],
  );

  const resolvedAssignee = useMemo(() => {
    if (!caseItem) return null;
    return resolveAssigneeForCase(caseItem.assignedTo, caseItem.id, courtAssignmentMode);
  }, [caseItem, courtAssignmentMode]);

  const activeTab = useMemo(
    () => parseExpedienteTabParam(searchParams.get('tab')),
    [searchParams],
  );

  const setActiveTab = useCallback(
    (tab: ExpedienteTab) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    const raw = searchParams.get('tab');
    if (raw != null && !TAB_QUERY_VALUES.has(raw)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', 'sintesis');
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (searchParams.get('tab') !== 'auditoria') return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', 'historial');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (caseItem) setAssignDraft(caseItem.assignedTo?.trim() ?? '');
  }, [caseItem?.assignedTo, caseItem?.id]);

  useEffect(() => {
    if (!caseItem) return;
    const iso = caseItem.deadlineAt?.trim();
    if (iso && isValid(parseISO(iso))) {
      setDeadlineDraft(format(parseISO(iso), 'yyyy-MM-dd'));
    } else {
      setDeadlineDraft('');
    }
    setDeadlineNoteDraft(caseItem.deadlineOverrideNote?.trim() ?? '');
  }, [caseItem?.id, caseItem?.deadlineAt, caseItem?.deadlineOverrideNote]);

  const refetchDocs = useCallback(async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from('case_documents')
        .select('*')
        .eq('case_id', id)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setDocs((data ?? []).map((r) => rowToCaseDoc(r as Record<string, unknown>, id)) as CaseDoc[]);
    } catch (e) {
      console.error('case_documents:', e);
      setDocs([]);
    } finally {
      setDocsLoaded(true);
    }
  }, [id]);

  const refetchCase = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase.from('cases').select('*').eq('id', id).maybeSingle();
    if (data && !error) setCaseItem(rowToCase(data as Record<string, unknown>));
  }, [id]);

  const refetchActions = useCallback(async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from('case_actions')
        .select('*')
        .eq('case_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setActions((data ?? []).map((r) => rowToAction(r as Record<string, unknown>)));
    } catch (e) {
      console.error('case_actions:', e);
      setActions([]);
    }
  }, [id]);

  const refetchAudit = useCallback(async () => {
    if (!id) return;
    try {
      setAuditFetchErr(null);
      const { data, error } = await supabase
        .from('case_audit_log')
        .select('*')
        .eq('case_id', id)
        .order('occurred_at', { ascending: false });
      if (error) throw error;
      setAuditLog((data ?? []).map((r) => rowToCaseAuditLogEntry(r as Record<string, unknown>)));
    } catch (e) {
      console.error('case_audit_log:', e);
      setAuditFetchErr(
        'No se pudo cargar el historial técnico. Aplique la migración SQL en Supabase (case_audit_log) o revise permisos.',
      );
      setAuditLog([]);
    }
  }, [id]);

  useEffect(() => {
    if (auditLog.length === 0) {
      setAuditActorNames({});
      return;
    }
    const ids = [...new Set(auditLog.map((e) => e.actorUserId).filter(Boolean))] as string[];
    if (ids.length === 0) {
      setAuditActorNames({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.from('profiles').select('id,name').in('id', ids);
      if (cancelled || error) return;
      const map: Record<string, string> = {};
      for (const r of data ?? []) {
        const row = r as Record<string, unknown>;
        map[String(row.id)] = String(row.name ?? '').trim() || String(row.id);
      }
      setAuditActorNames(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [auditLog]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: auth } = await supabase.auth.getSession();
      const uid = auth.session?.user?.id;
      if (!uid) {
        if (!cancelled) setSessionProfile(null);
        return;
      }
      const { data: row } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
      if (cancelled) return;
      setSessionProfile(row ? rowToUserProfile(row as Record<string, unknown>) : null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setDocsLoaded(false);
    setDocs([]);

    async function loadCase() {
      const { data, error } = await supabase.from('cases').select('*').eq('id', id).maybeSingle();
      if (cancelled) return;
      if (data && !error) setCaseItem(rowToCase(data as Record<string, unknown>));
      setLoading(false);
    }

    void loadCase();
    void refetchDocs();
    void refetchActions();
    void refetchAudit();

    const channel = supabase
      .channel(`case-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases', filter: `id=eq.${id}` }, () => {
        void loadCase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_documents', filter: `case_id=eq.${id}` }, () => {
        void refetchDocs();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_actions', filter: `case_id=eq.${id}` }, () => {
        void refetchActions();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_audit_log', filter: `case_id=eq.${id}` }, () => {
        void refetchAudit();
      })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [id, refetchDocs, refetchActions, refetchAudit]);

  useEffect(() => {
    const cid = caseItem?.courtId?.trim();
    if (!cid) {
      setCourtAssignmentMode(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('courts')
        .select('sustanciador_assignment_mode')
        .eq('id', cid)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('courts (reparto):', error);
        setCourtAssignmentMode(null);
        return;
      }
      setCourtAssignmentMode(parseSustanciadorAssignmentMode(data?.sustanciador_assignment_mode));
    })();
    return () => {
      cancelled = true;
    };
  }, [caseItem?.courtId]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user?.id;
      if (!uid || cancelled) return;
      await markAssignmentNotificationsReadForCase(supabase, { caseId: id, recipientUserId: uid });
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSaveDeadline = useCallback(async () => {
    if (!id || !caseItem) return;
    setDeadlineSaving(true);
    try {
      await ensureSupabaseSessionForWrites();
      const now = new Date().toISOString();
      let deadline_at: string | null = null;
      const raw = deadlineDraft.trim();
      if (raw) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
        if (m) {
          const y = Number(m[1]);
          const mo = Number(m[2]);
          const d = Number(m[3]);
          deadline_at = new Date(y, mo - 1, d, 12, 0, 0, 0).toISOString();
        }
      }
      const { error: upErr } = await supabase
        .from('cases')
        .update({
          deadline_at,
          deadline_override_note: deadlineNoteDraft.trim() || null,
          updated_at: now,
        })
        .eq('id', id);
      if (upErr) throw upErr;
      await refetchCase();
    } catch (err) {
      console.error(err);
    } finally {
      setDeadlineSaving(false);
    }
  }, [id, caseItem, deadlineDraft, deadlineNoteDraft, refetchCase]);

  const handleApplyAssign = useCallback(async () => {
    if (!id || !caseItem) return;
    const next = assignDraft.trim();
    const prev = (caseItem.assignedTo || '').trim();
    if (next === prev) return;
    setAssignSaving(true);
    try {
      await ensureSupabaseSessionForWrites();
      const now = new Date().toISOString();
      const { error: upErr } = await supabase
        .from('cases')
        .update({ assigned_to: next.length > 0 ? next : null, updated_at: now })
        .eq('id', id);
      if (upErr) throw upErr;

      const { data: u } = await supabase.auth.getUser();
      const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
      await supabase.from('case_actions').insert({
        case_id: id,
        type: 'assignment',
        description: next
          ? `Sustanciador asignado (${formatRadicado(caseItem.radicado)}): ${next}`
          : `Sustanciador desasignado (${formatRadicado(caseItem.radicado)})`,
        user_id: u.user?.id ?? null,
        user_name: String(uname),
        metadata: {
          kind: 'assignment',
          previous: prev || null,
          next: next.length > 0 ? next : null,
          radicado: caseItem.radicado,
        },
      });
      if (next) {
        await insertAssignmentNotificationsForProfiles(supabase, {
          courtId: caseItem.courtId,
          caseId: id,
          radicado: caseItem.radicado,
          assignedTo: next,
          actorUserName: String(uname),
        });
      }
      await refetchCase();
      await refetchActions();
    } catch (err) {
      console.error(err);
    } finally {
      setAssignSaving(false);
    }
  }, [id, caseItem, assignDraft, refetchCase, refetchActions]);

  const handleRegisterManualAction = useCallback(async () => {
    if (!id || !caseItem) return;
    const text = newActionText.trim();
    if (!text) return;
    setManualActSaving(true);
    try {
      await ensureSupabaseSessionForWrites();
      const { data: u } = await supabase.auth.getUser();
      const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
      await supabase.from('case_actions').insert({
        case_id: id,
        type: 'manual_entry',
        description: text,
        user_id: u.user?.id ?? null,
        user_name: String(uname),
      });
      setNewActionText('');
      await refetchActions();
    } catch (err) {
      console.error(err);
    } finally {
      setManualActSaving(false);
    }
  }, [id, caseItem, newActionText, refetchActions]);

  const handleSummarize = async () => {
    if (!caseItem || !id) return;
    setIsSummarizing(true);
    try {
      await ensureSupabaseSessionForWrites();
      const contextBlock = buildSynthesisContextBlock(caseItem, docs, courtAssignmentMode);
      const summary = await summarizeCase(caseItem.claimant, caseItem.rawText || '', contextBlock);
      const now = new Date().toISOString();
      await supabase.from('cases').update({ summary, updated_at: now }).eq('id', id);

      const { data: u } = await supabase.auth.getUser();
      const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
      await supabase.from('case_actions').insert({
        case_id: id,
        type: 'ai_synthesis',
        description: 'Generación de síntesis procesal por IA',
        user_id: u.user?.id ?? null,
        user_name: String(uname),
      });
      await refetchCase();
      await refetchActions();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleDerechoTuteladoCodeChange = useCallback(
    async (raw: string) => {
      if (!id || !caseItem) return;
      const next = raw === '' ? undefined : parseDerechoTuteladoCode(raw);
      if (raw !== '' && !next) return;
      const prev = caseItem.derechoTuteladoCode;
      if ((next ?? undefined) === (prev ?? undefined)) return;
      setDerechoCodeSaving(true);
      try {
        await ensureSupabaseSessionForWrites();
        const now = new Date().toISOString();
        const { error: upErr } = await supabase
          .from('cases')
          .update({ derecho_tutelado_code: next ?? null, updated_at: now })
          .eq('id', id);
        if (upErr) throw upErr;

        const { data: u } = await supabase.auth.getUser();
        const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
        await supabase.from('case_actions').insert({
          case_id: id,
          type: 'derecho_tutelado_code',
          description: next
            ? `Clasificación SIERJU: ${DERECHO_TUTELADO_LABELS[next]}`
            : 'Clasificación SIERJU eliminada',
          user_id: u.user?.id ?? null,
          user_name: String(uname),
          metadata: { previous: prev ?? null, next: next ?? null },
        });
        await refetchCase();
        await refetchActions();
      } catch (err) {
        console.error(err);
      } finally {
        setDerechoCodeSaving(false);
      }
    },
    [id, caseItem, refetchCase, refetchActions]
  );

  const handleDecisionTypeChange = useCallback(
    async (raw: string) => {
      if (!id || !caseItem) return;
      const next = raw === '' ? undefined : parseDecisionType(raw);
      if (raw !== '' && !next) return;
      const prev = caseItem.decisionType;
      if ((next ?? undefined) === (prev ?? undefined)) return;
      setDecisionSaving(true);
      try {
        await ensureSupabaseSessionForWrites();
        const now = new Date().toISOString();
        const { error: upErr } = await supabase
          .from('cases')
          .update({ decision_type: next ?? null, updated_at: now })
          .eq('id', id);
        if (upErr) throw upErr;

        const { data: u } = await supabase.auth.getUser();
        const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
        await supabase.from('case_actions').insert({
          case_id: id,
          type: 'decision_type',
          description: next
            ? `Tipo de decisión: ${DECISION_TYPE_LABELS[next]}`
            : 'Tipo de decisión eliminado',
          user_id: u.user?.id ?? null,
          user_name: String(uname),
          metadata: { previous: prev ?? null, next: next ?? null },
        });
        await refetchCase();
        await refetchActions();
        if (next) {
          schedulePrecedentIndexAfterDecisionType({ ...caseItem, decisionType: next }, next);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setDecisionSaving(false);
      }
    },
    [id, caseItem, refetchCase, refetchActions]
  );

  const handleStatusChange = async (newStatus: string) => {
    if (!id || !caseItem) return;
    const previousStatus = caseItem.status as CaseStatus;
    try {
      await ensureSupabaseSessionForWrites();
      const now = new Date().toISOString();
      const { error: upErr } = await supabase
        .from('cases')
        .update({ status: newStatus, updated_at: now })
        .eq('id', id);
      if (upErr) throw upErr;

      const { data: u } = await supabase.auth.getUser();
      const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
      const { error: insErr } = await supabase.from('case_actions').insert({
        case_id: id,
        type: 'status_change',
        description: `Cambio de estado: ${CASE_STATUS_LABEL[previousStatus] ?? previousStatus} → ${CASE_STATUS_LABEL[newStatus] ?? newStatus}`,
        user_id: u.user?.id ?? null,
        user_name: String(uname),
        metadata: {
          kind: 'status_change',
          previous_status: previousStatus,
          new_status: newStatus,
        },
      });
      if (insErr) throw insErr;
      await refetchCase();
      await refetchActions();
    } catch (err) {
      console.error(err);
    }
  };

  const esPrimeraInstancia = (caseItem?.caseType ?? 'tutela_primera') === 'tutela_primera';

  useEffect(() => {
    if (!caseItem) return;
    if (!esPrimeraInstancia && activeTab === 'incidente_desacato') {
      setActiveTab('sintesis');
    }
  }, [caseItem, esPrimeraInstancia, activeTab, setActiveTab]);

  const caseDetailContextValue = useMemo((): CaseDetailContextValue | null => {
    if (!id || !caseItem) return null;
    return {
      caseId: id,
      caseItem,
      courtId: caseItem.courtId,
      profile: sessionProfile,
      docs,
      refetch: {
        refetchCase,
        refetchDocs,
        refetchActions,
        refetchAudit,
      },
      permisos: { role: sessionProfile?.role ?? null },
      setActiveTab,
    };
  }, [
    id,
    caseItem,
    sessionProfile,
    docs,
    refetchCase,
    refetchDocs,
    refetchActions,
    refetchAudit,
    setActiveTab,
  ]);

  if (loading) return <div className="p-10 text-center font-mono">CARGANDO...</div>;
  if (!caseItem) return <div className="p-10 text-center font-mono">EXPEDIENTE NO ENCONTRADO</div>;
  if (!caseDetailContextValue) {
    return <div className="p-10 text-center font-mono">EXPEDIENTE NO ENCONTRADO</div>;
  }

  const outlookPendingAttach =
    searchParams.get('fromOutlook') === '1' && Boolean(searchParams.get('parseSessionId')?.trim());

  return (
    <CaseDetailProvider value={caseDetailContextValue}>
    <div className="w-full min-w-0 space-y-10">
      {outlookPendingAttach ? (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          Hay un correo en cola para este expediente. Revise el análisis y apruebe el ingreso en{' '}
          <a href="/correo/pendientes" className="font-semibold underline">
            Pendientes correo
          </a>
          .
        </div>
      ) : null}
      <header className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <button 
            onClick={() => navigate('/')} 
            className="w-12 h-12 flex items-center justify-center bg-white border border-slate-100 rounded-2xl hover:bg-slate-50 transition-all text-slate-400 hover:text-accent shadow-sm shrink-0"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">Expediente {formatRadicado(caseItem.radicado)}</h1>
                <span className={`px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-widest border ${
                  caseItem.status === 'received' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                  caseItem.status === 'admitted' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                  'bg-slate-100 text-slate-500 border-slate-200'
                }`}>
                  {caseItem.status}
                </span>
              </div>
              <p className="text-sm font-medium text-slate-500 mt-1">
                Referencia SGDE (Tutelia):{' '}
                {caseItem.sgdeId?.trim() ? (
                  <span
                    className="font-mono text-xs font-semibold text-emerald-700"
                    title={caseItem.sgdeId.trim()}
                  >
                    {caseItem.sgdeId.trim().length > 36
                      ? `${caseItem.sgdeId.trim().slice(0, 18)}…${caseItem.sgdeId.trim().slice(-8)}`
                      : caseItem.sgdeId.trim()}
                  </span>
                ) : (
                  <span className="text-slate-400 font-medium">Sin vincular</span>
                )}
              </p>
            </div>
            <CaseStagePanel />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <button 
            onClick={handleSummarize}
            disabled={isSummarizing}
            className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-all"
          >
            {isSummarizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-accent" />}
            {caseItem.summary ? 'Refinar Análisis' : 'Analizar con IA'}
          </button>
          
          <div className="relative group">
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform group-hover:translate-y-[-40%]" />
            <select 
              className="input-modern py-3 pl-6 pr-12 text-xs font-bold uppercase cursor-pointer appearance-none bg-white min-w-[220px]"
              value={caseItem.status}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              <option value="received">Recibido</option>
              <option value="admitted">Admitir</option>
              <option value="transfer">Traslado</option>
              <option value="judgment">Fallo</option>
              <option value="archived">Archivar</option>
            </select>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3 sm:gap-5">
        <div className="min-w-[200px] flex-1 space-y-1">
          <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400" htmlFor="derecho-tutelado-code">
            Clasificación SIERJU (alimenta el informe global)
          </label>
          <div className="flex items-center gap-2">
            <select
              id="derecho-tutelado-code"
              className="input-modern min-h-[40px] flex-1 text-xs font-medium"
              value={caseItem.derechoTuteladoCode ?? ''}
              disabled={derechoCodeSaving}
              onChange={(e) => void handleDerechoTuteladoCodeChange(e.target.value)}
            >
              <option value="">Sin clasificar</option>
              {DERECHO_TUTELADO_CODES.map((code) => (
                <option key={code} value={code}>
                  {DERECHO_TUTELADO_LABELS[code]}
                </option>
              ))}
            </select>
            {derechoCodeSaving ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" aria-hidden /> : null}
          </div>
        </div>
        {caseItem.status === 'judgment' || caseItem.status === 'archived' ? (
          <div className="min-w-[200px] flex-1 space-y-1">
            <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400" htmlFor="decision-type">
              Tipo de decisión
            </label>
            <div className="flex items-center gap-2">
              <select
                id="decision-type"
                className="input-modern min-h-[40px] flex-1 text-xs font-medium"
                value={caseItem.decisionType ?? ''}
                disabled={decisionSaving}
                onChange={(e) => void handleDecisionTypeChange(e.target.value)}
              >
                <option value="">Sin registrar</option>
                {DECISION_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {DECISION_TYPE_LABELS[dt]}
                  </option>
                ))}
              </select>
              {decisionSaving ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" aria-hidden /> : null}
            </div>
          </div>
        ) : (
          <p className="pb-1 text-[11px] text-slate-400 sm:max-w-xs">
            El tipo de decisión se registra cuando el estado es Fallo o Archivado.
          </p>
        )}
      </div>

      {resolvedAssignee ? (
        <div className="flex w-full min-w-0 flex-col gap-4 rounded-2xl border border-slate-100 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <UserCog className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Sustanciador</span>
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold ${resolvedAssignee.bg} ${resolvedAssignee.text} ring-1 ${resolvedAssignee.ring}`}
            >
              {resolvedAssignee.initials}
            </span>
            <span className="min-w-0 text-sm font-semibold text-slate-800">
              {caseItem.assignedTo?.trim()
                ? caseItem.assignedTo.trim()
                : courtAssignmentMode === 'manual_unassigned'
                  ? 'Sin sustanciador asignado'
                  : `${resolvedAssignee.name} (sin assigned_to; regla del juzgado)`}
            </span>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
            <select
              className="input-modern min-h-[44px] w-full min-w-0 text-xs font-medium sm:min-w-[240px] sm:max-w-[320px]"
              value={assignDraft}
              onChange={(e) => setAssignDraft(e.target.value)}
              aria-label="Elegir sustanciador asignado"
            >
              <option value="">
                {courtAssignmentMode === 'manual_unassigned'
                  ? 'Sin asignar (modo manual del juzgado)'
                  : 'Sin asignar'}
              </option>
              {SUSTANCIADORES.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.initials} — {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleApplyAssign()}
              disabled={
                assignSaving ||
                assignDraft.trim() === (caseItem.assignedTo || '').trim()
              }
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {assignSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar asignación
            </button>
          </div>
        </div>
      ) : null}

      <nav
        className="w-full min-w-0 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm"
        aria-label="Secciones del expediente"
      >
        <div className="flex min-w-0 gap-0 overflow-x-auto px-1 sm:gap-2 sm:px-4" role="tablist">
          <button
            type="button"
            role="tab"
            id="tab-sintesis"
            aria-selected={activeTab === 'sintesis'}
            aria-controls="panel-sintesis"
            onClick={() => setActiveTab('sintesis')}
            className={`shrink-0 border-b-2 px-3 py-3.5 text-[11px] font-bold uppercase tracking-widest transition-colors sm:px-5 ${
              activeTab === 'sintesis'
                ? 'border-accent text-accent'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Síntesis cognitiva
          </button>
          <button
            type="button"
            role="tab"
            id="tab-expediente"
            aria-selected={activeTab === 'expediente'}
            aria-controls="panel-expediente"
            onClick={() => setActiveTab('expediente')}
            className={`shrink-0 border-b-2 px-3 py-3.5 text-[11px] font-bold uppercase tracking-widest transition-colors sm:px-5 ${
              activeTab === 'expediente'
                ? 'border-accent text-accent'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Expediente digital
          </button>
          <button
            type="button"
            role="tab"
            id="tab-documentos-por-revisar"
            aria-selected={activeTab === 'revision_word'}
            aria-controls="panel-documentos-por-revisar"
            title="Documentos Word pendientes de revisión: apuntes, nueva versión y PDF firmado"
            onClick={() => setActiveTab('revision_word')}
            className={`shrink-0 border-b-2 px-3 py-3.5 text-[11px] font-bold uppercase tracking-widest transition-colors sm:px-5 ${
              activeTab === 'revision_word'
                ? 'border-accent text-accent'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <FilePenLine className="h-3.5 w-3.5" aria-hidden />
              Documentos por revisar
            </span>
          </button>
          <button
            type="button"
            role="tab"
            id="tab-actuaciones"
            aria-selected={activeTab === 'actuaciones'}
            aria-controls="panel-actuaciones"
            onClick={() => setActiveTab('actuaciones')}
            className={`shrink-0 border-b-2 px-3 py-3.5 text-[11px] font-bold uppercase tracking-widest transition-colors sm:px-5 ${
              activeTab === 'actuaciones'
                ? 'border-accent text-accent'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Actuaciones
          </button>
          <button
            type="button"
            role="tab"
            id="tab-historial"
            aria-selected={activeTab === 'historial'}
            aria-controls="panel-historial"
            title="Actividad del expediente: quién hizo qué (documentos, datos del caso, actuaciones); detalle técnico opcional"
            onClick={() => setActiveTab('historial')}
            className={`shrink-0 border-b-2 px-3 py-3.5 text-[11px] font-bold uppercase tracking-widest transition-colors sm:px-5 ${
              activeTab === 'historial'
                ? 'border-accent text-accent'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" aria-hidden />
              Historial
            </span>
          </button>
          <button
            type="button"
            role="tab"
            id="tab-documentos"
            aria-selected={activeTab === 'documentos'}
            aria-controls="panel-documentos"
            title="Documentos posteriores a la radicación: informe de secretaría y auto del despacho"
            onClick={() => setActiveTab('documentos')}
            className={`shrink-0 border-b-2 px-3 py-3.5 text-[11px] font-bold uppercase tracking-widest transition-colors sm:px-5 ${
              activeTab === 'documentos'
                ? 'border-accent text-accent'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <FolderOutput className="h-3.5 w-3.5" aria-hidden />
              Generar documentos
            </span>
          </button>
          {esPrimeraInstancia ? (
            <button
              type="button"
              role="tab"
              id="tab-incidente-desacato"
              aria-selected={activeTab === 'incidente_desacato'}
              aria-controls="panel-incidente-desacato"
              title="Incidente de desacato vinculado a este expediente (solo primera instancia)"
              onClick={() => setActiveTab('incidente_desacato')}
              className={`shrink-0 border-b-2 px-3 py-3.5 text-[11px] font-bold uppercase tracking-widest transition-colors sm:px-5 ${
                activeTab === 'incidente_desacato'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                Incidente de Desacato
              </span>
            </button>
          ) : null}
        </div>
      </nav>

      <div className="w-full min-w-0">
        <div
          id="panel-sintesis"
          role="tabpanel"
          aria-labelledby="tab-sintesis"
          className={activeTab === 'sintesis' ? 'block' : 'hidden'}
        >
          <CaseSintesisPanel
            isSummarizing={isSummarizing}
            onSummarize={handleSummarize}
            deadlineDraft={deadlineDraft}
            setDeadlineDraft={setDeadlineDraft}
            deadlineNoteDraft={deadlineNoteDraft}
            setDeadlineNoteDraft={setDeadlineNoteDraft}
            deadlineSaving={deadlineSaving}
            onSaveDeadline={handleSaveDeadline}
          />
        </div>

        <div
          id="panel-expediente"
          role="tabpanel"
          aria-labelledby="tab-expediente"
          className={activeTab === 'expediente' ? 'block' : 'hidden'}
        >
          <div className="flex w-full min-w-0 flex-col gap-6">
            <CaseExpedienteDigitalPanel
              caseId={id!}
              caseItem={caseItem}
              docs={docs}
              docsLoaded={docsLoaded}
              selectedDoc={selectedDoc}
              onSelectDoc={setSelectedDoc}
              onRefetchCase={refetchCase}
              onRefetchDocs={refetchDocs}
            />
            <CaseSgdePanel caseId={id!} caseItem={caseItem} onRefetchCase={refetchCase} />
          </div>
        </div>

        <div
          id="panel-documentos-por-revisar"
          role="tabpanel"
          aria-labelledby="tab-documentos-por-revisar"
          className={activeTab === 'revision_word' ? 'block' : 'hidden'}
        >
          {id ? (
            <CaseWordReviewPanel
              caseId={id}
              caseItem={caseItem}
              courtId={caseItem?.courtId ?? ''}
              docs={docs}
              profile={sessionProfile}
              onRefetchDocs={refetchDocs}
              onRefetchCase={refetchCase}
              notifyCaseContext={
                caseItem
                  ? {
                      courtId: caseItem.courtId,
                      radicado: caseItem.radicado,
                      assignedTo: caseItem.assignedTo,
                      courtAssignmentMode: courtAssignmentMode ?? undefined,
                    }
                  : null
              }
            />
          ) : null}
        </div>

        <div
          id="panel-documentos"
          role="tabpanel"
          aria-labelledby="tab-documentos"
          className={activeTab === 'documentos' ? 'block' : 'hidden'}
        >
          <CaseDespachoPanel onAfterEnviarRevision={() => setActiveTab('revision_word')} />
        </div>

        <div
          id="panel-incidente-desacato"
          role="tabpanel"
          aria-labelledby="tab-incidente-desacato"
          className={activeTab === 'incidente_desacato' ? 'block' : 'hidden'}
        >
          <CaseIncidenteDesacatoPanel caseItem={caseItem} profile={sessionProfile} />
        </div>

        <div
          id="panel-actuaciones"
          role="tabpanel"
          aria-labelledby="tab-actuaciones"
          className={activeTab === 'actuaciones' ? 'block' : 'hidden'}
        >
          <CaseActuacionesPanel
            timeline={timeline}
            newActionText={newActionText}
            setNewActionText={setNewActionText}
            manualActSaving={manualActSaving}
            onRegisterManualAction={handleRegisterManualAction}
          />
        </div>

        <div
          id="panel-historial"
          role="tabpanel"
          aria-labelledby="tab-historial"
          className={activeTab === 'historial' ? 'block' : 'hidden'}
        >
          <CaseHistorialPanel
            auditLog={auditLog}
            auditFetchErr={auditFetchErr}
            auditActorNames={auditActorNames}
          />
        </div>
      </div>
    </div>
    </CaseDetailProvider>
  );
}
