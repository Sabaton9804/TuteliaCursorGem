import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, Loader2, Send, Copy, Gavel, ScrollText } from 'lucide-react';
import type { JSONContent, Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Case, Document, DocumentTemplate, DocumentTemplateTipo } from '../../types';
import type { PlantillasStateV2 } from '../../lib/plantillas-store';
import { loadPlantillas } from '../../lib/plantillas-store';
import { fetchDocumentTemplates, uploadGeneratedDocxToExpedienteWithWordReview } from '../../lib/document-templates';
import {
  descargarTxt,
  textoAutoTramiteBorrador,
  textoAutoTramiteBorradorTipTapDoc,
  textoSentenciaBorrador,
  textoSentenciaBorradorTipTapDoc,
  type ProvidenciaDespachoContext,
} from '../../lib/plantilla-variables';
import { buildJudicialDocxBlob, descargarBlob, nombreArchivoDocx } from '../../lib/generate-judicial-docx';
import { hasMembreteRichContent } from '../../lib/membrete-rich-doc';
import { generarDocxDesdePlantillaAlmacenada } from '../../lib/expediente-docx-from-template';
import { tiptapJsonToPlainText } from '../../lib/tiptap-to-plain-text';
import { formatRadicado } from '../../lib/formatters';
import { supabase } from '../../lib/supabase';
import { recordBorradorProvidenciaEnviadoRevision } from '../../lib/case-stages-service';
import { marcadoresParaPlantilla } from '../../lib/plantilla-marcadores-catalog';
import { docToStorage, parseStorageToDoc, plainTextToTiptapDoc } from '../../lib/tiptap-template-storage';
import type { CommentThreadsMap } from '../../lib/review-markup-payload';
import { JudicialDocEditor } from '../shared/JudicialDocEditor';
import { TiptapDespachoReviewChrome } from '../plantillas/TiptapDespachoReviewChrome';
import { DespachoBorradorWordPanel } from './DespachoBorradorWordPanel';
import { JudicialDocAiToolbar } from './JudicialDocAiToolbar';

type Props = {
  caseItem: Case;
  caseId: string;
  docs: Document[];
  onAfterEnviarRevision?: () => void;
  revisionActorDisplayName?: string;
};

type ProvidenciaConfig = {
  context: ProvidenciaDespachoContext;
  templateTipo: DocumentTemplateTipo;
  documentType: string;
  fileSlug: 'AutoTramite' | 'Sentencia';
  label: string;
  recordKind: 'auto_tramite' | 'sentencia';
  plantillaContext: 'auto_tramite' | 'sentencia';
};

const AUTO_TRAMITE_CONFIG: ProvidenciaConfig = {
  context: 'auto_tramite',
  templateTipo: 'auto_tramite',
  documentType: 'borrador_auto_tramite_revision',
  fileSlug: 'AutoTramite',
  label: 'Auto de trámite',
  recordKind: 'auto_tramite',
  plantillaContext: 'auto_tramite',
};

const SENTENCIA_CONFIG: ProvidenciaConfig = {
  context: 'sentencia',
  templateTipo: 'sentencia',
  documentType: 'borrador_sentencia_revision',
  fileSlug: 'Sentencia',
  label: 'Sentencia',
  recordKind: 'sentencia',
  plantillaContext: 'sentencia',
};

function ProvidenciaBorradorSection({
  config,
  caseItem,
  caseId,
  docs,
  membreteState,
  templates,
  revisionActorDisplayName,
  onAfterEnviarRevision,
  compact,
}: {
  config: ProvidenciaConfig;
  caseItem: Case;
  caseId: string;
  docs: Document[];
  membreteState: PlantillasStateV2;
  templates: DocumentTemplate[];
  revisionActorDisplayName?: string;
  onAfterEnviarRevision?: () => void;
  compact?: boolean;
}) {
  const radSlug = formatRadicado(caseItem.radicado) || caseItem.radicado;
  const tplOpts = useMemo(
    () => templates.filter((t) => t.categoria === 'despacho' && t.tipo === config.templateTipo),
    [templates, config.templateTipo],
  );

  const [selectedId, setSelectedId] = useState('');
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [revisionSentHint, setRevisionSentHint] = useState<string | null>(null);
  const [tplError, setTplError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [bodyEditor, setBodyEditor] = useState<Editor | null>(null);
  const [commentThreads, setCommentThreads] = useState<CommentThreadsMap>({});
  const draftTouchedRef = useRef(false);

  useEffect(() => {
    if (tplOpts.length && !tplOpts.some((t) => t.id === selectedId)) {
      setSelectedId(tplOpts[0]!.id);
    }
  }, [tplOpts, selectedId]);

  useEffect(() => {
    if (!revisionSentHint) return;
    const id = window.setTimeout(() => setRevisionSentHint(null), 14000);
    return () => window.clearTimeout(id);
  }, [revisionSentHint]);

  const tpl = useMemo(() => tplOpts.find((t) => t.id === selectedId) ?? tplOpts[0], [tplOpts, selectedId]);

  const textoBorrador = useMemo(() => {
    if (config.context === 'auto_tramite') {
      return textoAutoTramiteBorrador(caseItem, membreteState, tpl?.contenidoBase);
    }
    return textoSentenciaBorrador(caseItem, membreteState, tpl?.contenidoBase);
  }, [config.context, caseItem, membreteState, tpl?.contenidoBase]);

  const editorSeed = useMemo(() => {
    if (!tpl || tpl.docxStoragePath) return null;
    const doc =
      config.context === 'auto_tramite'
        ? textoAutoTramiteBorradorTipTapDoc(caseItem, membreteState, tpl.contenidoBase)
        : textoSentenciaBorradorTipTapDoc(caseItem, membreteState, tpl.contenidoBase);
    if (doc) return docToStorage(doc);
    return docToStorage(plainTextToTiptapDoc(textoBorrador));
  }, [config.context, tpl, caseItem, membreteState, textoBorrador]);

  useEffect(() => {
    draftTouchedRef.current = false;
    setDraft(editorSeed ?? textoBorrador);
    setCommentThreads({});
  }, [selectedId, editorSeed, textoBorrador]);

  useEffect(() => {
    if (!draftTouchedRef.current) setDraft(editorSeed ?? textoBorrador);
  }, [textoBorrador, editorSeed]);

  const docContent = useMemo(() => parseStorageToDoc(draft), [draft]);
  const marcadores = useMemo(() => marcadoresParaPlantilla(config.templateTipo), [config.templateTipo]);
  const resolveLabel = useCallback(
    (key: string) => marcadores.find((m) => m.clave === key)?.etiqueta ?? key,
    [marcadores],
  );

  const resolveBodyForDocx = useCallback((): string | JSONContent => {
    if (draftTouchedRef.current) return draft || textoBorrador;
    const doc =
      config.context === 'auto_tramite'
        ? textoAutoTramiteBorradorTipTapDoc(caseItem, membreteState, tpl?.contenidoBase)
        : textoSentenciaBorradorTipTapDoc(caseItem, membreteState, tpl?.contenidoBase);
    if (doc) return doc;
    return draft || textoBorrador;
  }, [config.context, caseItem, membreteState, tpl?.contenidoBase, draft, textoBorrador]);

  const buildDocxBlob = useCallback(async (): Promise<Blob> => {
    if (tpl?.docxStoragePath) {
      return generarDocxDesdePlantillaAlmacenada(
        tpl.docxStoragePath,
        caseItem,
        membreteState,
        config.plantillaContext,
      );
    }
    return buildJudicialDocxBlob({
      fullText: resolveBodyForDocx(),
      kind: 'auto',
      imageDataUrl: membreteState.membrete.membreteImageDataUrl || null,
      pageLayout: tpl?.pageLayout ?? null,
      membreteDocJson: hasMembreteRichContent(membreteState.membrete)
        ? membreteState.membrete.membreteEditorJson ?? null
        : null,
    });
  }, [tpl, caseItem, membreteState, config.plantillaContext, resolveBodyForDocx]);

  const afterEnviarOk = () => {
    setRevisionSentHint('Enviado a «Documentos por revisar». El juez aprueba el borrador y luego vincula el PDF firmado.');
    onAfterEnviarRevision?.();
  };

  const getPlainText = useCallback(
    () => tiptapJsonToPlainText(docContent) || draft || textoBorrador,
    [docContent, draft, textoBorrador],
  );

  const applyPlainText = useCallback(
    (text: string) => {
      draftTouchedRef.current = true;
      if (tpl?.docxStoragePath) {
        setDraft(text);
        return;
      }
      setDraft(docToStorage(plainTextToTiptapDoc(text)));
    },
    [tpl?.docxStoragePath],
  );

  const focusCommentBox = useCallback(() => {
    requestAnimationFrame(() => {
      document.getElementById('tutelia-despacho-new-comment')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      (document.getElementById('tutelia-despacho-new-comment') as HTMLTextAreaElement | null)?.focus();
    });
  }, []);

  if (!tplOpts.length) {
    return (
      <p className="text-xs leading-relaxed text-slate-600">
        No hay plantillas de tipo <strong className="font-semibold">{config.label}</strong> en el catálogo del despacho.{' '}
        Un administrador puede crearlas en <strong className="font-semibold">Plantillas</strong>.
      </p>
    );
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {revisionSentHint ? (
        <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-950">{revisionSentHint}</p>
      ) : null}
      {tplError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">{tplError}</p>
      ) : null}

      <label className="block text-[11px] font-semibold text-slate-600">
        Plantilla (catálogo despacho — {config.label.toLowerCase()})
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="input-modern mt-1 w-full max-w-xl text-sm"
        >
          {tplOpts.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
              {t.docxStoragePath ? ' · Word' : t.contenidoBase ? ' · texto en BD' : ' · borrador sistema'}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={docBusy || !selectedId}
          onClick={async () => {
            setDocBusy(true);
            setTplError(null);
            try {
              const blob = await buildDocxBlob();
              descargarBlob(blob, nombreArchivoDocx(radSlug, config.fileSlug));
            } catch (e) {
              setTplError(e instanceof Error ? e.message : 'No se pudo generar el Word.');
            } finally {
              setDocBusy(false);
            }
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {docBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          Generar documento (.docx)
        </button>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-700 shadow-sm hover:bg-slate-50"
        >
          {preview ? 'Ocultar borrador' : 'Borrador y vista Word'}
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(draft || textoBorrador);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              /* ignore */
            }
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50"
        >
          <Copy className="h-4 w-4" />
          {copied ? 'Copiado' : 'Copiar'}
        </button>
        <button
          type="button"
          onClick={() =>
            descargarTxt(`${config.fileSlug}-${radSlug.replace(/\s/g, '_')}.txt`, draft || textoBorrador)
          }
          className="inline-flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:bg-slate-50"
        >
          Exportar .txt
        </button>
        <button
          type="button"
          disabled={revisionBusy || docBusy || !selectedId}
          onClick={async () => {
            setRevisionBusy(true);
            setTplError(null);
            try {
              const blob = await buildDocxBlob();
              const bytes = new Uint8Array(await blob.arrayBuffer());
              const displayName = nombreArchivoDocx(radSlug, config.fileSlug);
              const tipTapContent = tpl?.docxStoragePath ? null : (bodyEditor?.getJSON() ?? docContent);
              await uploadGeneratedDocxToExpedienteWithWordReview({
                caseId,
                courtId: caseItem.courtId,
                radicado: formatRadicado(caseItem.radicado) || caseItem.radicado,
                docxBytes: bytes,
                displayName,
                docs,
                documentType: config.documentType,
                actorUserName: revisionActorDisplayName,
                tipTapContent,
              });
              try {
                await recordBorradorProvidenciaEnviadoRevision(supabase, {
                  caseId,
                  documentLabel: displayName,
                  kind: config.recordKind,
                });
              } catch (e) {
                console.error('REGISTRO_INTERNO_REVISION:', e);
              }
              afterEnviarOk();
            } catch (e) {
              setTplError(e instanceof Error ? e.message : 'No se pudo enviar a revisión.');
            } finally {
              setRevisionBusy(false);
            }
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-indigo-900 shadow-sm hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {revisionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar a revisión
        </button>
      </div>

      {preview ? (
        <>
          <JudicialDocAiToolbar
            documentLabel={config.label}
            getText={getPlainText}
            onApplyCorrectedText={tpl?.docxStoragePath ? undefined : applyPlainText}
          />
          <DespachoBorradorWordPanel
            membrete={membreteState.membrete}
            draft={draft}
            onDraftChange={(next) => {
              draftTouchedRef.current = true;
              setDraft(next);
            }}
            readOnlyDraft={Boolean(tpl?.docxStoragePath)}
            readOnlyExplanation="Plantilla Word subida: el .docx descargado se arma con marcadores en el archivo, no con el texto de esta caja."
            pageLayout={tpl?.pageLayout ?? null}
            draftBodySlot={
              !tpl?.docxStoragePath ? (
                <div className="flex w-full min-w-0 flex-col gap-0 lg:min-h-[min(50vh,24rem)] lg:flex-row lg:items-stretch">
                  <div className="flex min-h-0 min-w-0 w-full flex-col border-slate-300/70 lg:w-[70%] lg:flex-shrink-0 lg:border-r">
                    {bodyEditor ? (
                      <BubbleMenu
                        editor={bodyEditor}
                        shouldShow={({ editor: ed }) => !ed.state.selection.empty}
                        options={{ placement: 'bottom-start' }}
                      >
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={focusCommentBox}
                          className="inline-flex items-center gap-1.5 rounded-full border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-900 shadow-md hover:bg-violet-50"
                        >
                          Comentario en el margen
                        </button>
                      </BubbleMenu>
                    ) : null}
                    <JudicialDocEditor
                      unframed
                      despachoSheetChrome
                      browserSpellCheck
                      content={docContent}
                      onChange={(json) => {
                        draftTouchedRef.current = true;
                        setDraft(docToStorage(json));
                      }}
                      readOnly={false}
                      placeholder="Redacta la providencia aquí..."
                      minHeight={compact ? '420px' : '600px'}
                      plantillaResolveLabel={resolveLabel}
                      showComments
                      hideInlineCommentBubble
                      onEditorReady={setBodyEditor}
                      className="tiptap-template-focus min-w-0 px-0"
                    />
                  </div>
                  <div className="flex min-h-[min(32vh,14rem)] w-full min-w-0 flex-col lg:min-h-0 lg:w-[30%] lg:flex-shrink-0">
                    <TiptapDespachoReviewChrome
                      editor={bodyEditor}
                      disabled={false}
                      displayName={revisionActorDisplayName ?? null}
                      threads={commentThreads}
                      onThreadsChange={setCommentThreads}
                    />
                  </div>
                </div>
              ) : undefined
            }
          />
        </>
      ) : null}
    </div>
  );
}

/** Autos de trámite (uso frecuente) y sentencia (escasa) — borrador Word + revisión juez. */
export function CaseDespachoProvidenciasPanel({
  caseItem,
  caseId,
  docs,
  onAfterEnviarRevision,
  revisionActorDisplayName,
}: Props) {
  const [membreteState, setMembreteState] = useState<PlantillasStateV2>(() => loadPlantillas());
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchDocumentTemplates(caseItem.courtId);
        if (!cancelled) setTemplates(list);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'No se pudieron cargar plantillas.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseItem.courtId]);

  useEffect(() => {
    setMembreteState(loadPlantillas());
  }, [caseItem.courtId]);

  return (
    <div className="space-y-4">
      {loadError ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">{loadError}</p>
      ) : null}

      <section className="card-modern overflow-hidden">
        <div className="border-b border-slate-100 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-900">
              Despacho
            </span>
            <ScrollText className="h-4 w-4 text-violet-700" aria-hidden />
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Autos de trámite</h3>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Providencias ordinarias durante el proceso (decretos, traslados, fijación en lista, etc.). Flujo habitual del
            despacho: generar Word, enviar a revisión del juez y vincular PDF firmado en «Documentos por revisar».
          </p>
        </div>
        <div className="p-6">
          <ProvidenciaBorradorSection
            config={AUTO_TRAMITE_CONFIG}
            caseItem={caseItem}
            caseId={caseId}
            docs={docs}
            membreteState={membreteState}
            templates={templates}
            revisionActorDisplayName={revisionActorDisplayName}
            onAfterEnviarRevision={onAfterEnviarRevision}
          />
        </div>
      </section>

      <details className="card-modern overflow-hidden group">
        <summary className="cursor-pointer list-none border-b border-slate-100 bg-slate-50/80 px-6 py-4 hover:bg-slate-50">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
              Ocasional
            </span>
            <Gavel className="h-4 w-4 text-slate-600" aria-hidden />
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Sentencia</h3>
            <span className="text-[10px] font-medium text-slate-400">(aprox. 2–3 al mes)</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Use cuando el proceso está en ingreso al despacho para sentencia / fallo. Mismo ciclo de revisión y PDF
            firmado; al vincular el PDF avanza la etapa procesal.
          </p>
        </summary>
        <div className="p-6 pt-4">
          <ProvidenciaBorradorSection
            config={SENTENCIA_CONFIG}
            caseItem={caseItem}
            caseId={caseId}
            docs={docs}
            membreteState={membreteState}
            templates={templates}
            revisionActorDisplayName={revisionActorDisplayName}
            onAfterEnviarRevision={onAfterEnviarRevision}
            compact
          />
        </div>
      </details>
    </div>
  );
}
