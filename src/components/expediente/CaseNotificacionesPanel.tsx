import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { FileDown, Loader2, Mail, Send } from 'lucide-react';
import type { Case, Document, DocumentTemplate } from '../../types';
import type { PlantillasStateV2 } from '../../lib/plantillas-store';
import { loadPlantillas } from '../../lib/plantillas-store';
import { fetchCourtBranding } from '../../lib/court-branding';
import { fetchDocumentTemplates, registerCaseActoPdfEnExpediente } from '../../lib/document-templates';
import { buildInformeIngresoPlainTextPdfBlob } from '../../lib/generate-judicial-pdf';
import {
  textoNotificacionAdmisorioBorrador,
  textoNotificacionFalloBorrador,
  textoOficioSecretariaBorrador,
} from '../../lib/plantilla-variables';
import { suggestedLogicalNameForAct } from '../../lib/case-act-types';
import {
  isOficioSecretariaTipo,
  OFICIO_SECRETARIA_TIPOS,
  suggestedPdfNameForOficioSecretaria,
  type OficioSecretariaTipoId,
} from '../../lib/oficio-secretaria-catalog';
import type { CaseStageCode } from '../../lib/case-workflow-stages';
import { fetchOutlookStatus } from '../../lib/outlook-api';
import {
  ejecutarFlujoNotificacionSecretaria,
  type NotificacionSecretariaKind,
} from '../../lib/notificacion-secretaria-flow';

type Props = {
  caseItem: Case;
  caseId: string;
  docs: Document[];
  openStageCode?: CaseStageCode | null;
  /** Solo notificación de fallo (p. ej. tutela 2ª). */
  falloOnly?: boolean;
  onUpdated?: () => void;
  onStageAdvanced?: () => void;
};

export function CaseNotificacionesPanel({
  caseItem,
  caseId,
  docs,
  openStageCode,
  falloOnly = false,
  onUpdated,
  onStageAdvanced,
}: Props) {
  const [membreteState, setMembreteState] = useState<PlantillasStateV2>(() => loadPlantillas());
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [selectedAdmId, setSelectedAdmId] = useState('');
  const [selectedFalloId, setSelectedFalloId] = useState('');
  const [selectedOficioTipo, setSelectedOficioTipo] = useState<OficioSecretariaTipoId>('oficio_juzgado');
  const [selectedOficioTplId, setSelectedOficioTplId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [outlookConnected, setOutlookConnected] = useState<boolean | null>(null);
  const [destAdm, setDestAdm] = useState('');
  const [destFallo, setDestFallo] = useState('');
  const [fechaAdm, setFechaAdm] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [fechaFallo, setFechaFallo] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const refreshTemplates = useCallback(async () => {
    const list = await fetchDocumentTemplates(caseItem.courtId);
    setTemplates(list);
    const adm = list.filter((t) => t.tipo === 'notificacion_admisorio');
    const fallo = list.filter((t) => t.tipo === 'notificacion_fallo');
    setSelectedAdmId((prev) => (prev && adm.some((x) => x.id === prev) ? prev : adm[0]?.id ?? ''));
    setSelectedFalloId((prev) => (prev && fallo.some((x) => x.id === prev) ? prev : fallo[0]?.id ?? ''));
    const oficios = list.filter((t) => t.tipo === selectedOficioTipo);
    setSelectedOficioTplId((prev) =>
      prev && oficios.some((x) => x.id === prev) ? prev : oficios[0]?.id ?? '',
    );
  }, [caseItem.courtId, selectedOficioTipo]);

  useEffect(() => {
    void refreshTemplates().catch((e) => setErr(e instanceof Error ? e.message : 'Error plantillas'));
  }, [refreshTemplates]);

  useEffect(() => {
    let cancelled = false;
    void fetchOutlookStatus()
      .then((s) => {
        if (!cancelled) setOutlookConnected(Boolean(s.connected));
      })
      .catch(() => {
        if (!cancelled) setOutlookConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchCourtBranding(caseItem.courtId)
      .then((m) => {
        if (!cancelled) setMembreteState({ version: 3, membrete: m });
      })
      .catch(() => {
        if (!cancelled) setMembreteState(loadPlantillas());
      });
    return () => {
      cancelled = true;
    };
  }, [caseItem.courtId]);

  const admTpl = templates.find((t) => t.id === selectedAdmId);
  const falloTpl = templates.find((t) => t.id === selectedFalloId);
  const oficioTemplates = templates.filter((t) => t.tipo === selectedOficioTipo);
  const oficioTpl = oficioTemplates.find((t) => t.id === selectedOficioTplId);

  const previewAdm = useMemo(
    () => textoNotificacionAdmisorioBorrador(caseItem, membreteState, admTpl?.contenidoBase),
    [caseItem, membreteState, admTpl?.contenidoBase],
  );
  const previewFallo = useMemo(
    () => textoNotificacionFalloBorrador(caseItem, membreteState, falloTpl?.contenidoBase),
    [caseItem, membreteState, falloTpl?.contenidoBase],
  );
  const previewOficio = useMemo(
    () => textoOficioSecretariaBorrador(caseItem, membreteState, selectedOficioTipo, oficioTpl?.contenidoBase),
    [caseItem, membreteState, selectedOficioTipo, oficioTpl?.contenidoBase],
  );

  const canAdvanceAdm = openStageCode === 'ADMISION';
  const canAdvanceFallo = openStageCode === 'FALLO';

  const generarYRegistrar = async (kind: NotificacionSecretariaKind) => {
    setBusy(`${kind}:pdf`);
    setErr(null);
    setOk(null);
    try {
      const tpl = kind === 'notificacion_admisorio' ? admTpl : falloTpl;
      const text =
        kind === 'notificacion_admisorio'
          ? textoNotificacionAdmisorioBorrador(caseItem, membreteState, tpl?.contenidoBase)
          : textoNotificacionFalloBorrador(caseItem, membreteState, tpl?.contenidoBase);
      const pdfBlob = await buildInformeIngresoPlainTextPdfBlob({
        fullPlainText: text,
        pageLayout: tpl?.pageLayout ?? null,
      });
      const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
      const displayName = suggestedLogicalNameForAct(kind);
      const actSequence = kind === 'notificacion_admisorio' ? 7 : 21;
      await registerCaseActoPdfEnExpediente({
        caseId,
        caseType: caseItem.caseType,
        pdfBytes: bytes,
        displayName,
        docs,
        actCode: kind,
        actSequence,
        sourceChannel: 'generado',
      });
      setOk(
        kind === 'notificacion_admisorio'
          ? 'Oficio de notificación del auto registrado en el expediente.'
          : 'Oficio de notificación del fallo registrado en el expediente.',
      );
      onUpdated?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo generar el oficio.');
    } finally {
      setBusy(null);
    }
  };

  const generarEnviarYAvanzar = async (kind: NotificacionSecretariaKind) => {
    if (!outlookConnected) {
      setErr('Conecte Outlook en la pestaña Correo antes de enviar desde aquí.');
      return;
    }
    setBusy(`${kind}:outlook`);
    setErr(null);
    setOk(null);
    try {
      const tpl = kind === 'notificacion_admisorio' ? admTpl : falloTpl;
      const text =
        kind === 'notificacion_admisorio'
          ? textoNotificacionAdmisorioBorrador(caseItem, membreteState, tpl?.contenidoBase)
          : textoNotificacionFalloBorrador(caseItem, membreteState, tpl?.contenidoBase);
      const recipientsRaw = kind === 'notificacion_admisorio' ? destAdm : destFallo;
      const notifiedAt = kind === 'notificacion_admisorio' ? fechaAdm : fechaFallo;
      const advanceStage = kind === 'notificacion_admisorio' ? canAdvanceAdm : canAdvanceFallo;

      await ejecutarFlujoNotificacionSecretaria({
        kind,
        caseId,
        courtId: caseItem.courtId,
        radicado: caseItem.radicado,
        caseType: caseItem.caseType,
        caseAssignedTo: caseItem.assignedTo,
        docs,
        plainText: text,
        pageLayout: tpl?.pageLayout,
        recipientsRaw,
        notifiedAt,
        advanceStage,
      });

      setOk(
        advanceStage
          ? 'PDF registrado, correo enviado por Outlook y etapa procesal actualizada.'
          : 'PDF registrado y correo enviado por Outlook. Avance la etapa manualmente en «Etapas» si aplica.',
      );
      onUpdated?.();
      if (advanceStage) onStageAdvanced?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se completó el flujo de notificación.');
    } finally {
      setBusy(null);
    }
  };

  const generarOficioGeneral = async () => {
    setBusy(selectedOficioTipo);
    setErr(null);
    setOk(null);
    try {
      const text = textoOficioSecretariaBorrador(
        caseItem,
        membreteState,
        selectedOficioTipo,
        oficioTpl?.contenidoBase,
      );
      const pdfBlob = await buildInformeIngresoPlainTextPdfBlob({
        fullPlainText: text,
        pageLayout: oficioTpl?.pageLayout ?? null,
      });
      const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
      await registerCaseActoPdfEnExpediente({
        caseId,
        caseType: caseItem.caseType,
        pdfBytes: bytes,
        displayName: suggestedPdfNameForOficioSecretaria(selectedOficioTipo),
        docs,
        actCode: selectedOficioTipo,
        sourceChannel: 'generado',
      });
      setOk('Oficio registrado en el expediente.');
      onUpdated?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo generar el oficio.');
    } finally {
      setBusy(null);
    }
  };

  const admTemplates = templates.filter((t) => t.tipo === 'notificacion_admisorio');
  const falloTemplates = templates.filter((t) => t.tipo === 'notificacion_fallo');

  return (
    <section className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Mail className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900">Oficios de secretaría</h3>
          <p className="mt-1 text-xs leading-snug text-slate-600">
            Genera el PDF, regístralo en el expediente y, con Outlook conectado, envíelo en un solo paso. Si la etapa
            coincide (admisión o fallo), avanza el trámite con la fecha de notificación indicada.
          </p>
          {outlookConnected === false ? (
            <p className="mt-2 text-[11px] font-medium text-amber-900">
              Outlook no conectado: use «Generar PDF» o conecte el buzón en Correo.
            </p>
          ) : null}
        </div>
      </div>

      {err ? <p className="mt-3 text-xs text-red-700">{err}</p> : null}
      {ok ? <p className="mt-3 text-xs text-emerald-800">{ok}</p> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {!falloOnly ? (
          <NotifCard
            title="Notificación auto admisorio"
            templates={admTemplates}
            selectedId={selectedAdmId}
            onSelect={setSelectedAdmId}
            preview={previewAdm}
            busy={busy?.startsWith('notificacion_admisorio') ?? false}
            recipients={destAdm}
            onRecipientsChange={setDestAdm}
            notifiedAt={fechaAdm}
            onNotifiedAtChange={setFechaAdm}
            canAdvanceStage={canAdvanceAdm}
            outlookConnected={outlookConnected}
            onGenerate={() => void generarYRegistrar('notificacion_admisorio')}
            onSendOutlook={() => void generarEnviarYAvanzar('notificacion_admisorio')}
          />
        ) : null}
        <NotifCard
          title="Notificación del fallo"
          templates={falloTemplates}
          selectedId={selectedFalloId}
          onSelect={setSelectedFalloId}
          preview={previewFallo}
          busy={busy?.startsWith('notificacion_fallo') ?? false}
          recipients={destFallo}
          onRecipientsChange={setDestFallo}
          notifiedAt={fechaFallo}
          onNotifiedAtChange={setFechaFallo}
          canAdvanceStage={canAdvanceFallo}
          outlookConnected={outlookConnected}
          onGenerate={() => void generarYRegistrar('notificacion_fallo')}
          onSendOutlook={() => void generarEnviarYAvanzar('notificacion_fallo')}
        />
      </div>

      {!falloOnly ? (
        <div className="mt-4 rounded-xl border border-indigo-200/60 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-indigo-700" aria-hidden />
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-800">Oficios generales</p>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Tipo de oficio
              <select
                className="input-modern mt-1 w-full text-xs"
                value={selectedOficioTipo}
                onChange={(e) => {
                  const v = e.target.value as OficioSecretariaTipoId;
                  if (isOficioSecretariaTipo(v)) setSelectedOficioTipo(v);
                }}
              >
                {OFICIO_SECRETARIA_TIPOS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre_visible}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Plantilla del despacho
              <select
                className="input-modern mt-1 w-full text-xs"
                value={selectedOficioTplId}
                onChange={(e) => setSelectedOficioTplId(e.target.value)}
                disabled={oficioTemplates.length === 0}
              >
                {oficioTemplates.length === 0 ? (
                  <option value="">Sin plantilla — usar texto predeterminado</option>
                ) : (
                  oficioTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
          <pre className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-2 text-[10px] leading-snug text-slate-700 whitespace-pre-wrap">
            {previewOficio.slice(0, 1200)}
            {previewOficio.length > 1200 ? '…' : ''}
          </pre>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void generarOficioGeneral()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40 sm:w-auto"
          >
            {busy === selectedOficioTipo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            Generar oficio y registrar
          </button>
        </div>
      ) : null}
    </section>
  );
}

function NotifCard({
  title,
  templates,
  selectedId,
  onSelect,
  preview,
  busy,
  recipients,
  onRecipientsChange,
  notifiedAt,
  onNotifiedAtChange,
  canAdvanceStage,
  outlookConnected,
  onGenerate,
  onSendOutlook,
}: {
  title: string;
  templates: DocumentTemplate[];
  selectedId: string;
  onSelect: (id: string) => void;
  preview: string;
  busy: boolean;
  recipients: string;
  onRecipientsChange: (v: string) => void;
  notifiedAt: string;
  onNotifiedAtChange: (v: string) => void;
  canAdvanceStage: boolean;
  outlookConnected: boolean | null;
  onGenerate: () => void;
  onSendOutlook: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/80 bg-white p-3 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-widest text-indigo-800">{title}</p>
      {templates.length > 0 ? (
        <select
          className="input-modern mt-2 w-full text-xs"
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
      ) : (
        <p className="mt-2 text-[11px] text-slate-600">
          Sin plantilla en catálogo; se usará el texto predeterminado del sistema.
        </p>
      )}
      <pre className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-2 text-[10px] leading-snug text-slate-700 whitespace-pre-wrap">
        {preview.slice(0, 1200)}
        {preview.length > 1200 ? '…' : ''}
      </pre>
      <label className="mt-3 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
        Destinatarios (correo)
        <textarea
          value={recipients}
          onChange={(e) => onRecipientsChange(e.target.value)}
          rows={2}
          className="input-modern mt-1 w-full resize-y text-xs font-normal normal-case tracking-normal"
          placeholder="correo@entidad.gov.co, otro@dominio.com"
          disabled={busy}
        />
      </label>
      <label className="mt-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
        Fecha de notificación
        <input
          type="date"
          value={notifiedAt}
          onChange={(e) => onNotifiedAtChange(e.target.value)}
          className="input-modern mt-1 w-full text-xs font-normal normal-case tracking-normal"
          disabled={busy}
        />
      </label>
      {canAdvanceStage ? (
        <p className="mt-2 text-[10px] text-emerald-800">
          Etapa actual compatible: al enviar por Outlook se registrará el hito de secretaría.
        </p>
      ) : (
        <p className="mt-2 text-[10px] text-slate-500">
          La etapa abierta no coincide; el PDF y el correo se registrarán sin avanzar etapa automáticamente.
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onGenerate}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-indigo-900 hover:bg-indigo-50 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          Solo generar PDF en expediente
        </button>
        <button
          type="button"
          disabled={busy || outlookConnected === false}
          onClick={onSendOutlook}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar por Outlook y registrar hito
        </button>
      </div>
    </div>
  );
}
