import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList,
  FileCheck,
  Copy,
  Scale,
  FileDown,
  Loader2,
  Send,
} from 'lucide-react';
import type { JSONContent } from '@tiptap/core';
import mammoth from 'mammoth';
import type { Case, Document, DocumentTemplate } from '../../types';
import type { PlantillasStateV2 } from '../../lib/plantillas-store';
import { loadPlantillas } from '../../lib/plantillas-store';
import { fetchCourtBranding } from '../../lib/court-branding';
import {
  fetchDocumentTemplates,
  registerCaseInformeIngresoWithExpedientePdf,
  uploadGeneratedDocxToExpedienteWithWordReview,
} from '../../lib/document-templates';
import { buildInformeIngresoPlainTextPdfBlob } from '../../lib/generate-judicial-pdf';
import { buildPdfBlobFromJudicialDocx } from '../../lib/informe-docx-to-pdf';
import {
  descargarTxt,
  textoAutoAdmisorioBorrador,
  textoAutoAdmisorioBorradorTipTapDoc,
  textoInformeIngresoBorrador,
  textoInformeIngresoBorradorTipTapDoc,
} from '../../lib/plantilla-variables';
import { buildJudicialDocxBlob, descargarBlob, nombreArchivoDocx } from '../../lib/generate-judicial-docx';
import { hasMembreteRichContent } from '../../lib/membrete-rich-doc';
import { generarDocxDesdePlantillaAlmacenada } from '../../lib/expediente-docx-from-template';
import { isTiptapDocJsonInput } from '../../lib/tiptap-to-docx';
import { tiptapJsonToPlainText } from '../../lib/tiptap-to-plain-text';
import { formatRadicado } from '../../lib/formatters';
import { DESPACHO_STAFF } from '../../lib/court-staff-assignees';
import { defaultToggleDefsForPlantilla } from '../../lib/plantilla-template-default-toggles';
import {
  defectoJustifyCuerpoInformeEnDoc,
  docToStorage,
  plainTextToTiptapDoc,
  tryParseTipTapDocFromContenidoBase,
} from '../../lib/tiptap-template-storage';
import { sanitizeCaseDocumentLogicalName } from '../../lib/case-document-storage';
import { TemplateBodyEditor } from '../plantillas/TemplateBodyEditor';
import { DespachoBorradorWordPanel } from './DespachoBorradorWordPanel';

type Props = {
  caseItem: Case;
  caseId: string;
  /** Piezas actuales del expediente (para calcular el siguiente `sort_order` en cuaderno principal). */
  docs: Document[];
  onCaseUpdated?: () => void;
  /** Tras subir un Word a revisión, p. ej. cambiar a la pestaña «Documentos por revisar». */
  onAfterEnviarRevision?: () => void;
  /** Nombre visible en la notificación al juez (p. ej. usuario en sesión). */
  revisionActorDisplayName?: string;
};

export function CaseDespachoDocumentosPanel({
  caseItem,
  caseId,
  docs,
  onCaseUpdated,
  onAfterEnviarRevision,
  revisionActorDisplayName,
}: Props) {
  const [membreteState, setMembreteState] = useState<PlantillasStateV2>(() => loadPlantillas());
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [tplError, setTplError] = useState<string | null>(null);
  const [selectedInformeId, setSelectedInformeId] = useState<string>('');
  const [selectedAutoId, setSelectedAutoId] = useState<string>('');
  const [preview, setPreview] = useState<'informe' | 'auto' | null>(null);
  const [copiedKind, setCopiedKind] = useState<'informe' | 'auto' | null>(null);
  const [docBusy, setDocBusy] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [revisionSentHint, setRevisionSentHint] = useState<string | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [informeToggleState, setInformeToggleState] = useState<Record<string, boolean>>({});
  const [autoToggleState, setAutoToggleState] = useState<Record<string, boolean>>({});
  const [informeDraft, setInformeDraft] = useState('');
  const [autoDraft, setAutoDraft] = useState('');
  const informeDraftTouchedRef = useRef(false);
  const autoDraftTouchedRef = useRef(false);

  const radSlug = formatRadicado(caseItem.radicado) || caseItem.radicado;

  const nombreJuezRevision = useMemo(
    () => DESPACHO_STAFF.find((p) => p.courtRole === 'judge')?.name?.trim() ?? '',
    [],
  );

  useEffect(() => {
    if (!revisionSentHint) return;
    const id = window.setTimeout(() => setRevisionSentHint(null), 14000);
    return () => window.clearTimeout(id);
  }, [revisionSentHint]);

  const afterEnviarRevisionOk = useCallback(() => {
    const j = nombreJuezRevision || 'el juez del despacho (organigrama)';
    setRevisionSentHint(
      `Revisión registrada; a cargo de ${j}. Se envió un aviso a la bandeja in-app del despacho. Continúe en «Documentos por revisar».`,
    );
    onCaseUpdated?.();
    onAfterEnviarRevision?.();
  }, [nombreJuezRevision, onCaseUpdated, onAfterEnviarRevision]);

  const defaultInformePdfNombre = useMemo(() => {
    const safe = radSlug.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'expediente';
    return `Informe-ingreso-despacho_${safe}.pdf`;
  }, [radSlug]);

  const [informePdfNombre, setInformePdfNombre] = useState(defaultInformePdfNombre);

  const refreshTemplates = useCallback(async () => {
    try {
      setTplError(null);
      const list = await fetchDocumentTemplates(caseItem.courtId);
      setTemplates(list);
      const informes = list.filter((t) => t.categoria === 'secretaria' && t.tipo === 'informe_ingreso');
      const autos = list.filter((t) => t.categoria === 'despacho' && t.tipo === 'auto_admisorio');
      setSelectedInformeId((prev) => {
        if (prev && informes.some((x) => x.id === prev)) return prev;
        return informes[0]?.id ?? '';
      });
      setSelectedAutoId((prev) => {
        if (prev && autos.some((x) => x.id === prev)) return prev;
        return autos[0]?.id ?? '';
      });
    } catch (e) {
      setTemplates([]);
      setTplError(e instanceof Error ? e.message : 'No se cargaron plantillas.');
    }
  }, [caseItem.courtId]);

  useEffect(() => {
    void refreshTemplates();
  }, [refreshTemplates]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await fetchCourtBranding(caseItem.courtId);
        if (!cancelled) setMembreteState({ version: 3, membrete: m });
      } catch {
        if (!cancelled) setMembreteState(loadPlantillas());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseItem.courtId]);

  const informeTpl = templates.find((t) => t.id === selectedInformeId);
  const autoTpl = templates.find((t) => t.id === selectedAutoId);

  const informeToggleDefsEffective = useMemo(
    () => (informeTpl ? defaultToggleDefsForPlantilla(informeTpl.tipo, informeTpl.toggleDefs) : []),
    [informeTpl],
  );

  const autoToggleDefsEffective = useMemo(
    () => (autoTpl ? defaultToggleDefsForPlantilla(autoTpl.tipo, autoTpl.toggleDefs) : []),
    [autoTpl],
  );

  const informeToggleKey = useMemo(
    () => informeToggleDefsEffective.map((d) => d.id).join('|'),
    [informeToggleDefsEffective],
  );

  useEffect(() => {
    const defs = informeToggleDefsEffective;
    setInformeToggleState((prev) => {
      const next: Record<string, boolean> = {};
      for (const d of defs) {
        next[d.id] = d.id in prev ? prev[d.id]! : d.defaultOn;
      }
      return next;
    });
  }, [selectedInformeId, informeToggleKey, informeToggleDefsEffective]);

  const autoToggleKey = useMemo(
    () => autoToggleDefsEffective.map((d) => d.id).join('|'),
    [autoToggleDefsEffective],
  );

  const autoPanelKey = `${selectedAutoId}|${autoToggleKey}`;

  useEffect(() => {
    const defs = autoToggleDefsEffective;
    setAutoToggleState((prev) => {
      const next: Record<string, boolean> = {};
      for (const d of defs) {
        next[d.id] = d.id in prev ? prev[d.id]! : d.defaultOn;
      }
      return next;
    });
  }, [selectedAutoId, autoToggleKey, autoToggleDefsEffective]);

  const textoInforme = useMemo(
    () =>
      textoInformeIngresoBorrador(caseItem, membreteState, informeTpl?.contenidoBase, {
        toggleDefs: informeToggleDefsEffective,
        toggleState: informeToggleState,
      }),
    [caseItem, membreteState, informeTpl?.contenidoBase, informeToggleDefsEffective, informeToggleState],
  );

  const informePlantillaEsTiptap = useMemo(
    () => tryParseTipTapDocFromContenidoBase(informeTpl?.contenidoBase ?? undefined) != null,
    [informeTpl?.contenidoBase],
  );

  const informeDraftRichSeed = useMemo(() => {
    const doc = textoInformeIngresoBorradorTipTapDoc(caseItem, membreteState, informeTpl?.contenidoBase, {
      toggleDefs: informeToggleDefsEffective,
      toggleState: informeToggleState,
    });
    if (doc) return docToStorage(doc);
    /** Plantilla en BD es TipTap pero el doc sustituido devolvió null (p. ej. `plainCheck` vacío): el editor necesita `tiptap:` válido, no cadena vacía. */
    if (tryParseTipTapDocFromContenidoBase(informeTpl?.contenidoBase ?? undefined)) {
      return docToStorage(defectoJustifyCuerpoInformeEnDoc(plainTextToTiptapDoc(textoInforme)));
    }
    return null;
  }, [
    caseItem,
    membreteState,
    informeTpl?.contenidoBase,
    informeToggleDefsEffective,
    informeToggleState,
    textoInforme,
  ]);

  const textoAuto = useMemo(
    () =>
      textoAutoAdmisorioBorrador(caseItem, membreteState, autoTpl?.contenidoBase, {
        toggleDefs: autoToggleDefsEffective,
        toggleState: autoToggleState,
      }),
    [caseItem, membreteState, autoTpl?.contenidoBase, autoToggleDefsEffective, autoToggleState],
  );

  const informeToggleSig = useMemo(() => JSON.stringify(informeToggleState), [informeToggleState]);
  const autoToggleSig = useMemo(() => JSON.stringify(autoToggleState), [autoToggleState]);

  const informeListo = Boolean(caseItem.informeIngresoRegistradoAt);

  useEffect(() => {
    setInformePdfNombre(defaultInformePdfNombre);
  }, [caseId, defaultInformePdfNombre]);

  const nombrePdfEnExpediente = useMemo(() => {
    const id = caseItem.informeIngresoDocumentId;
    if (!id) return null;
    const d = docs.find((x) => x.id === id);
    return d?.name?.trim() || d?.originalName?.trim() || null;
  }, [caseItem.informeIngresoDocumentId, docs]);

  useEffect(() => {
    informeDraftTouchedRef.current = false;
    setInformeDraft(informePlantillaEsTiptap && informeDraftRichSeed ? informeDraftRichSeed : textoInforme);
  }, [selectedInformeId, informeToggleKey, informePlantillaEsTiptap, informeDraftRichSeed, textoInforme]);

  useEffect(() => {
    if (!informeDraftTouchedRef.current) {
      setInformeDraft(informePlantillaEsTiptap && informeDraftRichSeed ? informeDraftRichSeed : textoInforme);
    }
  }, [textoInforme, informePlantillaEsTiptap, informeDraftRichSeed]);

  useEffect(() => {
    autoDraftTouchedRef.current = false;
    setAutoDraft(textoAuto);
  }, [autoPanelKey]);

  useEffect(() => {
    autoDraftTouchedRef.current = false;
    setAutoDraft(textoAuto);
  }, [autoToggleSig]);

  useEffect(() => {
    if (!autoDraftTouchedRef.current) setAutoDraft(textoAuto);
  }, [textoAuto]);

  useEffect(() => {
    informeDraftTouchedRef.current = false;
    setInformeDraft(informePlantillaEsTiptap && informeDraftRichSeed ? informeDraftRichSeed : textoInforme);
  }, [informeToggleSig]);

  /** Cuerpo para Word generado en app: TipTap JSON si la plantilla en BD es rica y el usuario no editó el borrador plano. */
  const resolveInformeBodyForJudicialDocx = useCallback((): string | JSONContent => {
    if (informeDraftTouchedRef.current) return informeDraft || textoInforme;
    const doc = textoInformeIngresoBorradorTipTapDoc(caseItem, membreteState, informeTpl?.contenidoBase, {
      toggleDefs: informeToggleDefsEffective,
      toggleState: informeToggleState,
    });
    if (doc) return doc;
    return informeDraft || textoInforme;
  }, [
    caseItem,
    membreteState,
    informeTpl?.contenidoBase,
    informeToggleDefsEffective,
    informeToggleState,
    informeDraft,
    textoInforme,
  ]);

  const resolveAutoBodyForJudicialDocx = useCallback((): string | JSONContent => {
    if (autoDraftTouchedRef.current) return autoDraft || textoAuto;
    const doc = textoAutoAdmisorioBorradorTipTapDoc(caseItem, membreteState, autoTpl?.contenidoBase, {
      toggleDefs: autoToggleDefsEffective,
      toggleState: autoToggleState,
    });
    if (doc) return doc;
    return autoDraft || textoAuto;
  }, [
    caseItem,
    membreteState,
    autoTpl?.contenidoBase,
    autoToggleDefsEffective,
    autoToggleState,
    autoDraft,
    textoAuto,
  ]);

  const resolveInformePlainTextForPdf = useCallback(async (): Promise<string> => {
    if (informeTpl?.docxStoragePath) {
      try {
        const blob = await generarDocxDesdePlantillaAlmacenada(
          informeTpl.docxStoragePath,
          caseItem,
          membreteState,
          'informe_ingreso',
        );
        const { value } = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() });
        const v = value.trim();
        if (v) return v;
      } catch {
        /* Word o mammoth: se usa texto plano sustituido */
      }
    }
    const body = resolveInformeBodyForJudicialDocx();
    if (typeof body === 'string') return body.trim() || textoInforme.trim();
    if (isTiptapDocJsonInput(body)) {
      const t = tiptapJsonToPlainText(body).trim();
      return t || textoInforme.trim();
    }
    return textoInforme.trim();
  }, [
    caseItem,
    informeTpl,
    membreteState,
    resolveInformeBodyForJudicialDocx,
    textoInforme,
  ]);

  const buildInformeDocxBlob = useCallback(async (): Promise<Blob> => {
    if (informeTpl?.docxStoragePath) {
      return generarDocxDesdePlantillaAlmacenada(
        informeTpl.docxStoragePath,
        caseItem,
        membreteState,
        'informe_ingreso',
      );
    }
    return buildJudicialDocxBlob({
      fullText: resolveInformeBodyForJudicialDocx(),
      kind: 'informe',
      imageDataUrl: membreteState.membrete.membreteImageDataUrl || null,
      pageLayout: informeTpl?.pageLayout ?? null,
      membreteDocJson: hasMembreteRichContent(membreteState.membrete)
        ? membreteState.membrete.membreteEditorJson ?? null
        : null,
    });
  }, [
    informeTpl?.docxStoragePath,
    informeTpl?.pageLayout,
    caseItem,
    membreteState,
    resolveInformeBodyForJudicialDocx,
  ]);

  const buildAutoDocxBlob = useCallback(async (): Promise<Blob> => {
    if (autoTpl?.docxStoragePath) {
      return generarDocxDesdePlantillaAlmacenada(
        autoTpl.docxStoragePath,
        caseItem,
        membreteState,
        'auto_admisorio',
      );
    }
    return buildJudicialDocxBlob({
      fullText: resolveAutoBodyForJudicialDocx(),
      kind: 'auto',
      imageDataUrl: membreteState.membrete.membreteImageDataUrl || null,
      pageLayout: autoTpl?.pageLayout ?? null,
      membreteDocJson: hasMembreteRichContent(membreteState.membrete)
        ? membreteState.membrete.membreteEditorJson ?? null
        : null,
    });
  }, [
    autoTpl?.docxStoragePath,
    autoTpl?.pageLayout,
    caseItem,
    membreteState,
    resolveAutoBodyForJudicialDocx,
  ]);

  const confirmarInformeListo = async () => {
    setWorkflowBusy(true);
    try {
      const docxBlob = await buildInformeDocxBlob();

      let pdfBlob: Blob;
      try {
        pdfBlob = await buildPdfBlobFromJudicialDocx(docxBlob, informeTpl?.pageLayout ?? null);
      } catch (e) {
        console.warn('PDF maquetado (mismo Word que descarga) no disponible; se usa texto plano:', e);
        const plain = await resolveInformePlainTextForPdf();
        pdfBlob = await buildInformeIngresoPlainTextPdfBlob({
          fullPlainText: plain,
          pageLayout: informeTpl?.pageLayout ?? null,
        });
      }

      const ab = await pdfBlob.arrayBuffer();
      const pdfBytes = new Uint8Array(ab);
      const displayName = sanitizeCaseDocumentLogicalName(informePdfNombre, defaultInformePdfNombre);
      await registerCaseInformeIngresoWithExpedientePdf({
        caseId,
        pdfBytes,
        displayName,
        docs,
      });
      onCaseUpdated?.();
    } finally {
      setWorkflowBusy(false);
    }
  };

  const copiar = async (t: string, kind: 'informe' | 'auto') => {
    try {
      await navigator.clipboard.writeText(t);
      setCopiedKind(kind);
      window.setTimeout(() => setCopiedKind((k) => (k === kind ? null : k)), 2000);
    } catch {
      setCopiedKind(null);
    }
  };

  const descargarInformeWord = async () => {
    setDocBusy(true);
    setTplError(null);
    try {
      const blob = await buildInformeDocxBlob();
      descargarBlob(blob, nombreArchivoDocx(radSlug, 'Informe-ingreso'));
    } catch (e) {
      setTplError(e instanceof Error ? e.message : 'No se pudo generar el Word.');
    } finally {
      setDocBusy(false);
    }
  };

  const enviarInformeRevision = async () => {
    setRevisionBusy(true);
    setTplError(null);
    try {
      const blob = await buildInformeDocxBlob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const displayName = nombreArchivoDocx(radSlug, 'Informe-ingreso');
      await uploadGeneratedDocxToExpedienteWithWordReview({
        caseId,
        courtId: caseItem.courtId,
        radicado: formatRadicado(caseItem.radicado) || caseItem.radicado,
        docxBytes: bytes,
        displayName,
        docs,
        documentType: 'borrador_informe_revision',
        actorUserName: revisionActorDisplayName,
      });
      afterEnviarRevisionOk();
    } catch (e) {
      setTplError(e instanceof Error ? e.message : 'No se pudo enviar el informe a revisión.');
    } finally {
      setRevisionBusy(false);
    }
  };

  const descargarAutoWord = async () => {
    setDocBusy(true);
    setTplError(null);
    try {
      const blob = await buildAutoDocxBlob();
      descargarBlob(blob, nombreArchivoDocx(radSlug, 'Auto-admisorio'));
    } catch (e) {
      setTplError(e instanceof Error ? e.message : 'No se pudo generar el Word.');
    } finally {
      setDocBusy(false);
    }
  };

  const enviarAutoRevision = async () => {
    setRevisionBusy(true);
    setTplError(null);
    try {
      const blob = await buildAutoDocxBlob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const displayName = nombreArchivoDocx(radSlug, 'Auto-admisorio');
      await uploadGeneratedDocxToExpedienteWithWordReview({
        caseId,
        courtId: caseItem.courtId,
        radicado: formatRadicado(caseItem.radicado) || caseItem.radicado,
        docxBytes: bytes,
        displayName,
        docs,
        documentType: 'borrador_auto_admisorio_revision',
        actorUserName: revisionActorDisplayName,
      });
      afterEnviarRevisionOk();
    } catch (e) {
      setTplError(e instanceof Error ? e.message : 'No se pudo enviar el auto a revisión.');
    } finally {
      setRevisionBusy(false);
    }
  };

  const informesOpts = templates.filter((t) => t.categoria === 'secretaria' && t.tipo === 'informe_ingreso');
  const autosOpts = templates.filter((t) => t.categoria === 'despacho' && t.tipo === 'auto_admisorio');

  return (
    <div className="space-y-6">
      {tplError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <strong className="font-semibold">Plantillas:</strong> {tplError} Ejecute la migración SQL en Supabase y recargue.
        </div>
      ) : null}

      {revisionSentHint ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/95 px-4 py-3 text-[11px] leading-relaxed text-indigo-950 shadow-sm">
          <p className="text-[9px] font-bold uppercase tracking-widest text-indigo-600">Revisión despacho</p>
          <p className="mt-1.5">{revisionSentHint}</p>
          {nombreJuezRevision ? (
            <p className="mt-2 text-[10px] text-indigo-800/90">
              Juez de referencia (organigrama): <span className="font-semibold">{nombreJuezRevision}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50/90 via-white to-blue-50/30 p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Documentos posteriores a la radicación</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">Secretaría y despacho</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
              Cada documento se genera por separado: no hay orden obligatorio entre informe y auto. Descarga en{' '}
              <strong className="text-slate-800">Word (.docx)</strong>. Si en Plantillas hay{' '}
              <strong className="text-slate-800">plantilla Word subida</strong> (detección IA), se rellena ese archivo con los
              datos del caso; si no, se genera el texto desde la base de datos o el borrador del sistema. Membrete e imagen en{' '}
              <Link to="/plantillas" className="font-semibold text-accent underline-offset-2 hover:underline">
                Plantillas
              </Link>
              .
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Radicado</p>
            <p className="font-mono text-sm font-bold text-slate-900">{radSlug}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="flex gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white"
              aria-hidden
            >
              <ClipboardList className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-800">Secretaría</p>
              <p className="mt-0.5 text-sm font-bold text-slate-900">Informe de ingreso</p>
              <p className="mt-1 text-[11px] leading-snug text-slate-600">
                Plantillas tipo «informe» en secretaría: {informesOpts.length}. Use «Generar documento» abajo cuando lo necesite.
              </p>
              {informeListo ? (
                <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                  <FileCheck className="h-3.5 w-3.5" /> PDF del informe registrado en expediente
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex gap-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white"
              aria-hidden
            >
              <Scale className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-800">Despacho</p>
              <p className="mt-0.5 text-sm font-bold text-slate-900">Auto admisorio</p>
              <p className="mt-1 text-[11px] leading-snug text-slate-600">
                Plantillas tipo «auto admisorio» en despacho: {autosOpts.length}. Puede generarlo en cualquier momento.
              </p>
            </div>
          </div>
        </div>
      </div>

      <section className="card-modern overflow-hidden">
        <div className="border-b border-slate-100 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-900">
              Secretaría
            </span>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Informe de ingreso al despacho
            </h3>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="block min-w-0 flex-1 text-[11px] font-semibold text-slate-600">
              Plantilla (catálogo secretaría — informe ingreso)
              <select
                value={selectedInformeId}
                onChange={(e) => setSelectedInformeId(e.target.value)}
                className="input-modern mt-1 w-full text-sm"
              >
                {informesOpts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                    {t.docxStoragePath ? ' · Word' : t.contenidoBase ? ' · texto en BD' : ' · borrador sistema'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {informeToggleDefsEffective.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
              <p className="w-full text-[10px] font-bold uppercase tracking-wide text-slate-500">Bloques opcionales</p>
              {informeToggleDefsEffective.map((d) => (
                <label
                  key={d.id}
                  className="flex min-w-[min(100%,220px)] flex-1 cursor-pointer items-start gap-2 rounded-md border border-white/80 bg-white px-2.5 py-1.5 shadow-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 accent-indigo-600"
                    checked={informeToggleState[d.id] ?? d.defaultOn}
                    onChange={(e) => setInformeToggleState((s) => ({ ...s, [d.id]: e.target.checked }))}
                  />
                  <span className="min-w-0 text-[11px] leading-tight text-slate-800">
                    <span className="font-semibold">{d.label}</span>
                    {d.description ? <span className="mt-0.5 block text-[10px] text-slate-500">{d.description}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <div className="space-y-4 p-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Generar documento</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={docBusy || !selectedInformeId}
              onClick={() => void descargarInformeWord()}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {docBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              Generar documento (.docx)
            </button>
            <button
              type="button"
              onClick={() => setPreview(preview === 'informe' ? null : 'informe')}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-700 shadow-sm hover:bg-slate-50"
            >
              {preview === 'informe' ? 'Ocultar borrador' : 'Borrador y vista Word'}
            </button>
            <button
              type="button"
              onClick={() => void copiar(informeDraft || textoInforme, 'informe')}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50"
            >
              <Copy className="h-4 w-4" />
              {copiedKind === 'informe' ? 'Copiado' : 'Copiar'}
            </button>
            <button
              type="button"
              onClick={() => descargarTxt(`Informe-ingreso-${radSlug.replace(/\s/g, '_')}.txt`, informeDraft || textoInforme)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:bg-slate-50"
            >
              Exportar .txt (auxiliar)
            </button>
            <button
              type="button"
              disabled={revisionBusy || docBusy || !selectedInformeId}
              onClick={() => void enviarInformeRevision()}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-indigo-900 shadow-sm hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {revisionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar a revisión
            </button>
          </div>

          {preview === 'informe' ? (
            <DespachoBorradorWordPanel
              membrete={membreteState.membrete}
              draft={informeDraft}
              onDraftChange={(next) => {
                informeDraftTouchedRef.current = true;
                setInformeDraft(next);
              }}
              readOnlyDraft={Boolean(informeTpl?.docxStoragePath)}
              readOnlyExplanation="Plantilla Word subida: el .docx descargado se arma con marcadores en el archivo, no con el texto de esta caja (sirve de referencia y para copiar). Para cambiar el cuerpo use Word tras descargar o use una plantilla «texto en BD»."
              pageLayout={informeTpl?.pageLayout ?? null}
              draftBodySlot={
                informePlantillaEsTiptap && !informeTpl?.docxStoragePath ? (
                  <TemplateBodyEditor
                    key={`informe-rich-${selectedInformeId}-${informeToggleKey}`}
                    value={informeDraft}
                    onChange={(next) => {
                      informeDraftTouchedRef.current = true;
                      setInformeDraft(next);
                    }}
                    templateTipo="informe_ingreso"
                    label="Cuerpo del informe"
                    disabled={Boolean(informeTpl?.docxStoragePath)}
                  />
                ) : undefined
              }
            />
          ) : null}

          <div className="flex flex-col gap-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
            {!informeListo ? (
              <label className="block max-w-xl text-[11px] font-semibold text-emerald-950">
                Nombre del PDF en el expediente
                <input
                  type="text"
                  value={informePdfNombre}
                  onChange={(e) => setInformePdfNombre(e.target.value)}
                  className="input-modern mt-1 w-full max-w-xl font-mono text-sm text-slate-900"
                  placeholder={defaultInformePdfNombre}
                  disabled={workflowBusy}
                  spellCheck={false}
                  autoComplete="off"
                />
                <p className="mt-1.5 font-normal font-sans text-[10px] font-medium leading-snug text-emerald-900/85">
                  Elegible en el listado del expediente. Se añade <code className="rounded bg-white/70 px-1">.pdf</code> si
                  no la escribe; espacios y caracteres no admitidos en rutas pasan a guion bajo (máx. 120 caracteres).
                </p>
              </label>
            ) : nombrePdfEnExpediente ? (
              <p className="text-[11px] font-semibold text-emerald-950">
                En expediente digital figura como:{' '}
                <span className="font-mono font-normal text-emerald-900">{nombrePdfEnExpediente}</span>
              </p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-2">
                <p className="text-xs leading-relaxed text-emerald-950">
                  <strong className="font-semibold">Secretaría:</strong> puede enviar el Word a la pestaña «Documentos por
                  revisar» con <strong className="font-semibold">Enviar a revisión</strong>, o incorporar directamente el{' '}
                  <strong className="font-semibold">PDF</strong> al expediente con el botón verde (solo informe de ingreso).
                  El auto admisorio del despacho siempre debe pasar por revisión. Por integridad judicial, el PDF registrado{' '}
                  <strong className="font-semibold">no se elimina desde aquí</strong>.
                </p>
                {informeListo ? (
                  <p className="text-[10px] font-medium leading-snug text-emerald-900/90">
                    Rectificaciones: cargue una pieza adicional en el expediente digital si el despacho lo permite, según
                    práctica interna.
                  </p>
                ) : null}
              </div>
              {!informeListo ? (
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={workflowBusy}
                    onClick={() => void confirmarInformeListo()}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white hover:bg-emerald-800 disabled:opacity-40"
                  >
                    Cargar al expediente como PDF
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="card-modern overflow-hidden">
        <div className="border-b border-slate-100 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-900">
              Despacho
            </span>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Auto admisorio (tutela)</h3>
          </div>
          <div className="mt-3">
            <label className="block text-[11px] font-semibold text-slate-600">
              Plantilla (catálogo despacho — auto admisorio)
              <select
                value={selectedAutoId}
                onChange={(e) => setSelectedAutoId(e.target.value)}
                className="input-modern mt-1 w-full max-w-xl text-sm"
              >
                {autosOpts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                    {t.docxStoragePath ? ' · Word' : t.contenidoBase ? ' · texto en BD' : ' · borrador sistema'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {autoToggleDefsEffective.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
              <p className="w-full text-[10px] font-bold uppercase tracking-wide text-slate-500">Bloques opcionales</p>
              {autoToggleDefsEffective.map((d) => (
                <label
                  key={d.id}
                  className="flex min-w-[min(100%,220px)] flex-1 cursor-pointer items-start gap-2 rounded-md border border-white/80 bg-white px-2.5 py-1.5 shadow-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 accent-indigo-600"
                    checked={autoToggleState[d.id] ?? d.defaultOn}
                    onChange={(e) => setAutoToggleState((s) => ({ ...s, [d.id]: e.target.checked }))}
                  />
                  <span className="min-w-0 text-[11px] leading-tight text-slate-800">
                    <span className="font-semibold">{d.label}</span>
                    {d.description ? <span className="mt-0.5 block text-[10px] text-slate-500">{d.description}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {autoToggleDefsEffective.length > 0 ? (
            <p className="mt-2 text-[10px] leading-snug text-slate-500">
              Si al desmarcar sigue viendo numerales 3 / 4, la plantilla en base de datos debe usar los marcadores{' '}
              <code className="rounded bg-slate-100 px-1">{'{{BLOQUE_VINCULADOS}}'}</code> y{' '}
              <code className="rounded bg-slate-100 px-1">{'{{BLOQUE_MEDIDA_PROVISIONAL}}'}</code> o marcar esos párrafos en
              el editor de plantillas (bloque condicional). En redacción TipTap, cada apartado opcional debe llevar la clave
              del toggle.
            </p>
          ) : null}
        </div>
        <div className="space-y-4 p-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Generar documento</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={docBusy || !selectedAutoId}
              onClick={() => void descargarAutoWord()}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {docBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              Generar documento (.docx)
            </button>
            <button
              type="button"
              onClick={() => setPreview(preview === 'auto' ? null : 'auto')}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-700 shadow-sm hover:bg-slate-50"
            >
              {preview === 'auto' ? 'Ocultar borrador' : 'Borrador y vista Word'}
            </button>
            <button
              type="button"
              onClick={() => void copiar(autoDraft || textoAuto, 'auto')}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50"
            >
              <Copy className="h-4 w-4" />
              {copiedKind === 'auto' ? 'Copiado' : 'Copiar'}
            </button>
            <button
              type="button"
              onClick={() => descargarTxt(`Auto-admisorio-${radSlug.replace(/\s/g, '_')}.txt`, autoDraft || textoAuto)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:bg-slate-50"
            >
              Exportar .txt (auxiliar)
            </button>
            <button
              type="button"
              disabled={revisionBusy || docBusy || !selectedAutoId}
              onClick={() => void enviarAutoRevision()}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-indigo-900 shadow-sm hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {revisionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar a revisión
            </button>
          </div>
          <p className="text-[10px] leading-snug text-slate-500">
            Los documentos de <strong className="font-semibold text-slate-700">despacho</strong> no tienen carga directa de
            PDF aquí: use <strong className="font-semibold text-slate-700">Enviar a revisión</strong> y complete el ciclo en
            «Documentos por revisar».
          </p>
          {preview === 'auto' ? (
            <DespachoBorradorWordPanel
              membrete={membreteState.membrete}
              draft={autoDraft}
              onDraftChange={(next) => {
                autoDraftTouchedRef.current = true;
                setAutoDraft(next);
              }}
              readOnlyDraft={Boolean(autoTpl?.docxStoragePath)}
              readOnlyExplanation="Plantilla Word subida: el .docx descargado se arma con marcadores en el archivo, no con el texto de esta caja (sirve de referencia y para copiar)."
              pageLayout={autoTpl?.pageLayout ?? null}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
