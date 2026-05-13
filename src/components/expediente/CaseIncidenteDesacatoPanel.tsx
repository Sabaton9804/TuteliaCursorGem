import React, { useCallback, useEffect, useState } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AlertCircle,
  History,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ensureSupabaseSessionForWrites } from '../../lib/supabase-write-auth';
import { resolveWorkflowAssigneeId } from '../../lib/case-workflow-stages';
import { insertIncidenteDesacatoIniciadoNotifications } from '../../lib/workflow-stage-notifications';
import { formatRadicado } from '../../lib/formatters';
import type { Case } from '../../types';
import type { UserProfile, UserRole } from '../../types';

const REQUESTED_BY_OPTIONS = [
  { value: 'accionante', label: 'Accionante' },
  { value: 'interviniente', label: 'Interviniente' },
  { value: 'ministerio_publico', label: 'Ministerio Público' },
  { value: 'defensoria', label: 'Defensoría' },
] as const;

const STATUS_OPTIONS = [
  { value: 'activo', label: 'Activo' },
  { value: 'sancionado', label: 'Sancionado' },
  { value: 'cumplimiento_acreditado', label: 'Cumplimiento acreditado' },
  { value: 'archivado', label: 'Archivado' },
] as const;

const CONSULTA_RESULT_OPTIONS = [
  { value: 'confirma', label: 'Confirma sanción' },
  { value: 'revoca', label: 'Revoca sanción' },
] as const;

export type IncidentDesacatoRow = {
  id: string;
  requestedBy: string;
  requesterName: string;
  requestDate: string;
  conductDescription: string;
  status: string;
  sanctionArrestMonths: number | null;
  sanctionFineSmmlv: number | null;
  consultaSentAt: string | null;
  consultaResult: string | null;
  updatedAt: string;
};

function rowToIncident(r: Record<string, unknown>): IncidentDesacatoRow {
  return {
    id: String(r.id),
    requestedBy: String(r.requested_by ?? ''),
    requesterName: String(r.requester_name ?? ''),
    requestDate: typeof r.request_date === 'string' ? r.request_date : String(r.request_date ?? ''),
    conductDescription: String(r.conduct_description ?? ''),
    status: String(r.status ?? 'activo'),
    sanctionArrestMonths:
      typeof r.sanction_arrest_months === 'number' && Number.isFinite(r.sanction_arrest_months)
        ? r.sanction_arrest_months
        : null,
    sanctionFineSmmlv:
      typeof r.sanction_fine_smmlv === 'number' && Number.isFinite(r.sanction_fine_smmlv)
        ? r.sanction_fine_smmlv
        : null,
    consultaSentAt:
      typeof r.consulta_sent_at === 'string' ? r.consulta_sent_at : r.consulta_sent_at ? String(r.consulta_sent_at) : null,
    consultaResult:
      typeof r.consulta_result === 'string' ? r.consulta_result : r.consulta_result ? String(r.consulta_result) : null,
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : String(r.updated_at ?? ''),
  };
}

function requestedByLabel(v: string): string {
  return REQUESTED_BY_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

function statusLabel(v: string): string {
  return STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

function canRoleIniciarIncidente(role: UserRole | undefined): boolean {
  return role === 'clerk' || role === 'official' || role === 'admin';
}

function noonLocalIsoFromDateInput(yyyyMmDd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim());
  if (!m) return new Date().toISOString();
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  return new Date(y, mo - 1, day, 12, 0, 0, 0).toISOString();
}

type CaseActionRow = {
  id: string;
  description: string | null;
  user_name: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type Props = {
  caseItem: Case;
  profile: UserProfile | null;
};

export function CaseIncidenteDesacatoPanel({ caseItem, profile }: Props) {
  const [incident, setIncident] = useState<IncidentDesacatoRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<CaseActionRow[]>([]);

  const [formRequestedBy, setFormRequestedBy] = useState<string>('accionante');
  const [formRequesterName, setFormRequesterName] = useState('');
  const [formRequestDate, setFormRequestDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [formConduct, setFormConduct] = useState('');

  const [editStatus, setEditStatus] = useState('activo');
  const [editArrest, setEditArrest] = useState('');
  const [editFine, setEditFine] = useState('');
  const [editConsultaResult, setEditConsultaResult] = useState<string>('');

  const canIniciar = canRoleIniciarIncidente(profile?.role);

  const loadIncident = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from('incident_desacato')
        .select('*')
        .eq('parent_case_id', caseItem.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (qErr) throw qErr;
      if (data) {
        const row = rowToIncident(data as Record<string, unknown>);
        setIncident(row);
      } else {
        setIncident(null);
      }
    } catch (e: unknown) {
      console.error('incident_desacato:', e);
      setError(e instanceof Error ? e.message : 'No se pudo cargar el incidente.');
      setIncident(null);
    } finally {
      setLoading(false);
    }
  }, [caseItem.id]);

  const loadHistory = useCallback(async () => {
    try {
      const { data, error: hErr } = await supabase
        .from('case_actions')
        .select('id, description, user_name, created_at, metadata')
        .eq('case_id', caseItem.id)
        .eq('type', 'INCIDENTE_DESACATO')
        .order('created_at', { ascending: false });
      if (hErr) throw hErr;
      setHistory(
        (data ?? []).map((r) => ({
          id: String((r as Record<string, unknown>).id),
          description: (r as Record<string, unknown>).description
            ? String((r as Record<string, unknown>).description)
            : null,
          user_name: (r as Record<string, unknown>).user_name
            ? String((r as Record<string, unknown>).user_name)
            : null,
          created_at: String((r as Record<string, unknown>).created_at ?? ''),
          metadata: ((r as Record<string, unknown>).metadata as Record<string, unknown>) || null,
        })),
      );
    } catch (e) {
      console.error('case_actions incident:', e);
      setHistory([]);
    }
  }, [caseItem.id]);

  useEffect(() => {
    void loadIncident();
    void loadHistory();
  }, [loadIncident, loadHistory]);

  useEffect(() => {
    const ch = supabase
      .channel(`incident-desacato-${caseItem.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incident_desacato', filter: `parent_case_id=eq.${caseItem.id}` },
        () => {
          void loadIncident();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [caseItem.id, loadIncident]);

  useEffect(() => {
    if (!incident) return;
    setEditStatus(incident.status);
    setEditArrest(incident.sanctionArrestMonths != null ? String(incident.sanctionArrestMonths) : '');
    setEditFine(incident.sanctionFineSmmlv != null ? String(incident.sanctionFineSmmlv) : '');
    setEditConsultaResult(incident.consultaResult ?? '');
  }, [incident]);

  const appendIncidentLog = async (description: string, metadata: Record<string, unknown>) => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const uname =
      profile?.name?.trim() ||
      profile?.email?.trim() ||
      u.user?.user_metadata?.full_name ||
      u.user?.email ||
      'Usuario';
    const { error: aErr } = await supabase.from('case_actions').insert({
      case_id: caseItem.id,
      type: 'INCIDENTE_DESACATO',
      description,
      user_id: uid,
      user_name: String(uname),
      metadata,
    });
    if (aErr) console.error('case_actions INCIDENTE_DESACATO:', aErr);
    await loadHistory();
  };

  const handleCreate = async () => {
    if (!formRequesterName.trim() || !formConduct.trim()) {
      setError('Complete nombre del solicitante y conducta incumplida.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await ensureSupabaseSessionForWrites();
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      const requestDateIso = noonLocalIsoFromDateInput(formRequestDate);

      const { data: inserted, error: insErr } = await supabase
        .from('incident_desacato')
        .insert({
          court_id: caseItem.courtId,
          parent_case_id: caseItem.id,
          requested_by: formRequestedBy,
          requester_name: formRequesterName.trim(),
          request_date: requestDateIso,
          conduct_description: formConduct.trim(),
          status: 'activo',
        })
        .select('id')
        .single();
      if (insErr) throw insErr;

      await insertIncidenteDesacatoIniciadoNotifications(supabase, {
        courtId: caseItem.courtId,
        caseId: caseItem.id,
        radicado: caseItem.radicado,
        incidentId: String(inserted.id),
      });

      const assigneeId = await resolveWorkflowAssigneeId(supabase, {
        courtId: caseItem.courtId,
        role: 'despacho',
        caseAssignedTo: caseItem.assignedTo,
      });
      if (assigneeId) {
        const title = `Incidente de desacato iniciado — ${caseItem.radicado}`;
        const { error: tErr } = await supabase.from('workflow_tasks').insert({
          court_id: caseItem.courtId,
          case_id: caseItem.id,
          radicado: caseItem.radicado,
          title,
          description: `Incidente de desacato en expediente ${formatRadicado(caseItem.radicado)}.`,
          assignee_id: assigneeId,
          creator_id: uid,
          status: 'pending',
          priority: 'high',
          task_type: 'consulta_desacato',
          metadata: { incident_desacato_id: inserted?.id, parent_case_id: caseItem.id },
        });
        if (tErr) console.error('workflow_tasks consulta_desacato:', tErr);
      }

      await appendIncidentLog('Incidente de desacato iniciado.', {
        incident_id: inserted?.id,
        requested_by: formRequestedBy,
        requester_name: formRequesterName.trim(),
      });
      setShowForm(false);
      setFormRequesterName('');
      setFormConduct('');
      setFormRequestedBy('accionante');
      setFormRequestDate(format(new Date(), 'yyyy-MM-dd'));
      await loadIncident();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el incidente.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveIncident = async () => {
    if (!incident) return;
    setSaving(true);
    setError(null);
    try {
      await ensureSupabaseSessionForWrites();
      const prevStatus = incident.status;
      const isSancionado = editStatus === 'sancionado';
      const arrest = editArrest.trim() === '' ? null : parseInt(editArrest, 10);
      const fine = editFine.trim() === '' ? null : parseInt(editFine, 10);
      const payload: Record<string, unknown> = {
        status: editStatus,
        sanction_arrest_months: isSancionado && arrest != null && !Number.isNaN(arrest) ? arrest : null,
        sanction_fine_smmlv: isSancionado && fine != null && !Number.isNaN(fine) ? fine : null,
        updated_at: new Date().toISOString(),
      };
      if (!isSancionado) {
        payload.consulta_result = null;
      } else if (incident.consultaSentAt && (editConsultaResult === 'confirma' || editConsultaResult === 'revoca')) {
        payload.consulta_result = editConsultaResult;
      } else if (incident.consultaSentAt) {
        payload.consulta_result = incident.consultaResult;
      } else {
        payload.consulta_result = null;
      }

      const { error: upErr } = await supabase.from('incident_desacato').update(payload).eq('id', incident.id);
      if (upErr) throw upErr;

      if (prevStatus !== editStatus) {
        await appendIncidentLog(`Estado del incidente: ${statusLabel(prevStatus)} → ${statusLabel(editStatus)}`, {
          incident_id: incident.id,
          from: prevStatus,
          to: editStatus,
        });
      }
      const prevConsulta = incident.consultaResult;
      const nextConsulta =
        isSancionado && incident.consultaSentAt && (editConsultaResult === 'confirma' || editConsultaResult === 'revoca')
          ? editConsultaResult
          : !isSancionado
            ? null
            : prevConsulta;
      if (String(prevConsulta ?? '') !== String(nextConsulta ?? '') && incident.consultaSentAt) {
        await appendIncidentLog(
          `Resultado consulta superior: ${nextConsulta === 'confirma' ? 'Confirma sanción' : nextConsulta === 'revoca' ? 'Revoca sanción' : '—'}`,
          { incident_id: incident.id, consulta_result: nextConsulta },
        );
      }
      await loadIncident();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar los cambios.');
    } finally {
      setSaving(false);
    }
  };

  const handleRegistrarConsultaSuperior = async () => {
    if (!incident || incident.status !== 'sancionado') return;
    setSaving(true);
    setError(null);
    try {
      await ensureSupabaseSessionForWrites();
      const now = new Date().toISOString();
      const { error: upErr } = await supabase
        .from('incident_desacato')
        .update({ consulta_sent_at: now, updated_at: now })
        .eq('id', incident.id);
      if (upErr) throw upErr;
      await appendIncidentLog('Registrado envío en consulta al superior.', {
        incident_id: incident.id,
        consulta_sent_at: now,
      });
      await loadIncident();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el envío.');
    } finally {
      setSaving(false);
    }
  };

  const consultaSentLabel =
    incident?.consultaSentAt && isValid(parseISO(incident.consultaSentAt))
      ? format(parseISO(incident.consultaSentAt), "d MMM yyyy · HH:mm", { locale: es })
      : incident?.consultaSentAt ?? '';

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        Cargando incidente…
      </div>
    );
  }

  return (
    <div className="card-modern w-full min-w-0 space-y-6 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-800">
            <ShieldAlert className="h-5 w-5 text-accent shrink-0" aria-hidden />
            Incidente de desacato
          </h3>
          <p className="mt-2 text-xs text-slate-500 max-w-xl leading-relaxed">
            El incidente no constituye expediente independiente; solo se gestiona aquí, vinculado al expediente{' '}
            <span className="font-mono font-semibold text-slate-700">{formatRadicado(caseItem.radicado)}</span>.
          </p>
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {!incident ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/90 px-6 py-12 text-center space-y-4">
          <div className="text-4xl" aria-hidden>
            🔒
          </div>
          <p className="text-lg font-bold text-slate-800">Sin incidente iniciado</p>
          {canIniciar ? (
            <>
              {!showForm ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(true);
                    setError(null);
                  }}
                  className="btn-primary inline-flex items-center gap-2 px-6 py-3 text-xs font-black uppercase tracking-widest"
                >
                  Iniciar incidente de desacato
                </button>
              ) : (
                <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-left space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Quién solicita</label>
                    <select
                      value={formRequestedBy}
                      onChange={(e) => setFormRequestedBy(e.target.value)}
                      className="input-modern w-full text-sm"
                    >
                      {REQUESTED_BY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Nombre del solicitante</label>
                    <input
                      type="text"
                      value={formRequesterName}
                      onChange={(e) => setFormRequesterName(e.target.value)}
                      className="input-modern w-full text-sm"
                      placeholder="Nombre completo"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Fecha de la solicitud</label>
                    <input
                      type="date"
                      value={formRequestDate}
                      onChange={(e) => setFormRequestDate(e.target.value)}
                      className="input-modern w-full text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Conducta incumplida</label>
                    <textarea
                      value={formConduct}
                      onChange={(e) => setFormConduct(e.target.value)}
                      rows={4}
                      className="input-modern w-full resize-y text-sm"
                      placeholder="Describa la conducta o el incumplimiento objeto del incidente."
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleCreate()}
                      className="btn-primary flex-1 min-w-[140px] py-2.5 text-xs font-black uppercase tracking-widest disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : 'Guardar incidente'}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setShowForm(false);
                        setError(null);
                      }}
                      className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Solo personal de secretaría u oficina judicial autorizado puede iniciar el incidente.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Solicitante</p>
              <p className="mt-1 text-sm font-bold text-slate-900">{requestedByLabel(incident.requestedBy)}</p>
              <p className="mt-2 text-sm text-slate-700">{incident.requesterName}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Fecha de la solicitud</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {incident.requestDate && isValid(parseISO(incident.requestDate))
                  ? format(parseISO(incident.requestDate), "d 'de' MMMM yyyy", { locale: es })
                  : incident.requestDate}
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Conducta incumplida</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{incident.conductDescription}</p>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Estado actual</label>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              className="input-modern max-w-md text-sm font-semibold"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {editStatus === 'sancionado' ? (
            <div className="grid gap-4 sm:grid-cols-2 rounded-xl border border-orange-100 bg-orange-50/40 p-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-orange-900">Meses de arresto</label>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={editArrest}
                  onChange={(e) => setEditArrest(e.target.value)}
                  className="input-modern text-sm"
                  placeholder="Ej. 6"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-orange-900">Multa (SMMLV)</label>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={editFine}
                  onChange={(e) => setEditFine(e.target.value)}
                  className="input-modern text-sm"
                  placeholder="Ej. 10"
                />
              </div>
              {!incident.consultaSentAt ? (
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleRegistrarConsultaSuperior()}
                    className="rounded-xl bg-orange-700 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-800 disabled:opacity-50"
                  >
                    Registrar envío en consulta al superior
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {editStatus === 'sancionado' && incident.consultaSentAt ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-900">Consulta al superior</p>
              <p className="text-sm text-amber-950">
                <span className="font-semibold">Enviada:</span> {consultaSentLabel}
              </p>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-amber-900">
                  Resultado de la consulta
                </label>
                <select
                  value={editConsultaResult}
                  onChange={(e) => setEditConsultaResult(e.target.value)}
                  className="input-modern w-full max-w-md text-sm"
                >
                  <option value="">Sin registrar</option>
                  {CONSULTA_RESULT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-amber-900/80">
                  Pulse «Guardar cambios del incidente» para registrar el resultado.
                </p>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSaveIncident()}
              className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-xs font-black uppercase tracking-widest disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar cambios del incidente
            </button>
          </div>

          <div className="border-t border-slate-100 pt-6">
            <h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">
              <History className="h-4 w-4" aria-hidden />
              Historial de cambios (incidente)
            </h4>
            {history.length === 0 ? (
              <p className="text-xs text-slate-400">Aún no hay registros en trazabilidad para este incidente.</p>
            ) : (
              <ul className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {history.map((h) => {
                  const at =
                    h.created_at && !Number.isNaN(Date.parse(h.created_at))
                      ? format(parseISO(h.created_at), 'dd MMM yyyy · HH:mm', { locale: es })
                      : '';
                  return (
                    <li key={h.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm">
                      <p className="text-[10px] font-bold uppercase text-slate-400">{at}</p>
                      <p className="font-semibold text-slate-800 mt-1">{h.description || '—'}</p>
                      {h.user_name ? (
                        <p className="text-[10px] text-slate-500 mt-1">Por: {h.user_name}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
