import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  Download,
  Upload,
  Loader2,
  AlertCircle,
  FolderPlus,
  X,
  PenLine,
  Pencil,
  Trash2,
  MoreVertical,
  Search,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import { ensureSupabaseSessionForWrites } from '../../lib/supabase-write-auth';
import { handleDataPermissionError } from '../../lib/error-handler';
import {
  uploadCaseAttachment,
  insertCaseDocumentRows,
  removeCaseDocumentObjects,
  CASE_DOCUMENTS_BUCKET,
  CASE_DOCUMENT_SIGNED_URL_TTL_SEC,
} from '../../lib/case-document-storage';
import { pieceAiEligibility } from '../../lib/piece-ai-analysis';
import {
  canDeleteExpedientePieza,
  canRenameExpedientePieza,
  canSignExpedientePiezaInSgde,
  type PiezaActionGate,
} from '../../lib/expediente-document-actions';
import type { Document } from '../../types';
import {
  caseHasCautelarNotebook,
  cautelarNotebookExtra,
  DEFAULT_NOTEBOOK_CODE,
  INSTANCIA_LABELS,
  NOTEBOOK_META,
  NOTEBOOK_PI_C01_PRINCIPAL,
  NOTEBOOK_PI_C02_CAUTELAR,
  NOTEBOOK_SI_C01_PRINCIPAL,
  instanciaForNotebook,
  notebookCodeForCaseType,
  normalizeNotebookCode,
  type ExpedienteInstanciaCode,
} from '../../lib/expediente-notebook';
import {
  buildNotebookSections,
  docBelongsToNotebook,
  groupSectionsByInstancia,
} from '../../lib/expediente-notebook-sections';
import {
  DOCUMENT_SGDE_SYNC_LABELS,
  DOCUMENT_SGDE_SYNC_STYLES,
  documentSgdeSyncStatus,
} from '../../lib/expediente-sgde-sync';
import { ExpedienteSignSgdeDialog } from './ExpedienteSignSgdeDialog';
import type { Case } from '../../types';
import { sanitizeExpedienteFilenameForDisplay } from '../../lib/sanitize-expediente-filename';
import { caseDocumentRawLabel } from '../../lib/case-document-display-name';
import {
  expedientePiezasParaLista,
  isCaseDocumentOpenableInViewer,
  isExpedientePiezaListable,
} from '../../lib/expediente-viewer-doc';
import { Link } from 'react-router-dom';
import {
  splitSgdeFolderPath,
} from '../../lib/expediente-folder-tree';
import { ExpedienteSgdeFolderTree, ExpedienteTreeModeHint } from './ExpedienteSgdeFolderTree';
import {
  isMissingExpedienteCuadernosExtraColumn,
  loadLocalExtraCuadernos,
  mergeExtraCuadernos,
  saveLocalExtraCuadernos,
  type ExpedienteCuadernoExtra,
} from '../../lib/expediente-extra-cuadernos';
import { ExpedienteActTimeline } from './ExpedienteActTimeline';
import {
  ExpedienteUploadActDialog,
  type ExpedienteUploadActPayload,
} from './ExpedienteUploadActDialog';
import {
  inferActCodeFromDocument,
  labelForActCode,
  nextActSequenceForDocs,
  suggestedLogicalNameForAct,
  uploadableActsForCaseType,
} from '../../lib/case-act-types';
import { sortExpedienteCuadernoPiezas } from '../../lib/expediente-document-order';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  'pdf',
  'doc',
  'docx',
  'jpg',
  'jpeg',
  'tif',
  'tiff',
  'mp3',
  'mpeg',
  'mpg',
  'png',
  'webp',
]);

export type { ExpedienteCuadernoExtra } from '../../lib/expediente-extra-cuadernos';

function formatBytes(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Índice 1-based en el cuaderno: siempre 01, 02, 03… según posición en la lista ordenada. */
function indiceCuadernoDesdeLista(listIndex: number): number {
  return listIndex + 1;
}

/** Nombre índice del documento (radicación / parseo / carga); base del título sanitizado. */
function rawFileLabel(doc: Document): string {
  return caseDocumentRawLabel(doc);
}

/** Título en listado: nombre del archivo (como se radicó / cargó), no la etiqueta del acto. */
function listaTituloDocumento(doc: Document): string {
  const raw = rawFileLabel(doc);
  if (!raw) return 'Sin nombre';
  return sanitizeExpedienteFilenameForDisplay(raw);
}

function fileExtUpperFromName(name: string): string | null {
  const m = name.trim().match(/\.([a-zA-Z0-9]+)$/);
  if (!m) return null;
  const ext = m[1].toUpperCase();
  if (ext === 'JPEG') return 'JPG';
  return ext.length > 4 ? ext.slice(0, 4) : ext;
}

function typeChipForDoc(doc: Document, displayName: string): string {
  const fromName = fileExtUpperFromName(displayName);
  if (fromName) return fromName;
  const ct = (doc.contentType || '').toLowerCase();
  if (ct.includes('pdf')) return 'PDF';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'JPG';
  if (ct.includes('png')) return 'PNG';
  if (ct.includes('mpeg') || ct.includes('mpg')) return 'MPG';
  if (ct.includes('mp3')) return 'MP3';
  if (ct.includes('tiff') || ct.includes('tif')) return 'TIF';
  if (doc.type === 'email_body') return 'EML';
  return '···';
}

function extChipClass(ext: string): string {
  const e = ext.toLowerCase();
  if (e === 'doc' || e === 'docx') return 'bg-blue-700 text-white';
  if (e === 'pdf') return 'bg-red-600 text-white';
  if (e === 'msg' || e === 'eml') return 'bg-amber-400 text-amber-950';
  if (e === 'jpg' || e === 'jpeg' || e === 'png' || e === 'webp' || e === 'tif' || e === 'tiff')
    return 'bg-sky-600 text-white';
  if (e === 'mp3' || e === 'mpeg' || e === 'mpg') return 'bg-violet-600 text-white';
  if (e === '···') return 'bg-slate-400 text-white';
  return 'bg-slate-500 text-white';
}

function badgeFor(
  doc: Document,
  caseType?: Case['caseType'] | null,
): { text: string; className: string } {
  const actLabel = labelForActCode(inferActCodeFromDocument(doc), caseType);
  if (actLabel) {
    return { text: actLabel, className: 'bg-indigo-50 text-indigo-900 border border-indigo-100' };
  }
  if (doc.type === 'email_body')
    return { text: 'Constancia ingreso', className: 'bg-slate-100 text-slate-600 border border-slate-200' };
  if (doc.type === 'informe_ingreso_expediente')
    return { text: 'Informe ingreso', className: 'bg-emerald-50 text-emerald-900 border border-emerald-100' };
  if (doc.type === 'expediente_upload')
    return { text: 'Carga al expediente', className: 'bg-violet-50 text-violet-800 border border-violet-100' };
  if (doc.ingestError)
    return { text: 'Incompleto', className: 'bg-amber-50 text-amber-800 border border-amber-100' };
  if (doc.isFromLink) return { text: 'Enlace', className: 'bg-sky-50 text-sky-800 border border-sky-100' };
  return { text: 'Electrónico', className: 'bg-emerald-50 text-emerald-800 border border-emerald-100' };
}

/** Orden del reparto: solo `sort_order` (columna `order` en el modelo). */
function sortReparto(list: Document[]): Document[] {
  return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function filterByNotebook(
  docs: Document[],
  code: string,
  opts?: import('./expediente-notebook-sections').DocNotebookMatchOpts
): Document[] {
  return sortReparto(docs.filter((d) => docBelongsToNotebook(d, code, opts)));
}

function maxSortOrder(docs: Document[], code: string): number {
  return filterByNotebook(docs, code).reduce((m, d) => Math.max(m, d.order ?? 0), -1);
}

async function signedDownloadUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CASE_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath.trim(), CASE_DOCUMENT_SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

type PiezaRowMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canView: boolean;
  canDownload: boolean;
  deleting: boolean;
  signGate: PiezaActionGate;
  renameGate: PiezaActionGate;
  delGate: PiezaActionGate;
  aiGate: PiezaActionGate;
  onView: () => void;
  onDownload: (e: React.MouseEvent) => void;
  onLecturaRapida: () => void;
  onRename: () => void;
  onSign: () => void;
  onDelete: () => void;
};

function PiezaRowMenu({
  open,
  onOpenChange,
  canView,
  canDownload,
  deleting,
  signGate,
  renameGate,
  delGate,
  aiGate,
  onView,
  onDownload,
  onLecturaRapida,
  onRename,
  onSign,
  onDelete,
}: PiezaRowMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const w = 200;
      let left = r.right - w;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      setMenuPos({ top: r.bottom + 4, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, onOpenChange]);

  const itemClass = (opts?: { danger?: boolean; disabled?: boolean }) =>
    `flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition ${
      opts?.disabled
        ? 'cursor-not-allowed text-slate-300'
        : opts?.danger
          ? 'text-red-600 hover:bg-red-50'
          : 'text-slate-700 hover:bg-slate-50'
    }`;

  const run = (fn: () => void, allowed = true) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!allowed) return;
    fn();
    onOpenChange(false);
  };

  return (
    <div ref={ref} className="relative shrink-0 self-center">
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Opciones de la pieza"
        title="Opciones"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        className={`rounded-full p-1.5 transition ${
          open ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
        }`}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && menuPos ? (
        <div
          role="menu"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: '12.5rem' }}
          className="z-[100] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!canView}
            title={canView ? undefined : 'Sin archivo para visualizar'}
            className={itemClass({ disabled: !canView })}
            onClick={run(onView, canView)}
          >
            <Eye className="h-3.5 w-3.5 shrink-0" />
            Ver en visor
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canDownload}
            title={canDownload ? undefined : 'Sin archivo en Storage'}
            className={itemClass({ disabled: !canDownload })}
            onClick={(e) => {
              e.stopPropagation();
              if (!canDownload) return;
              onDownload(e);
              onOpenChange(false);
            }}
          >
            <Download className="h-3.5 w-3.5 shrink-0" />
            Descargar
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!aiGate.allowed}
            title={aiGate.reason}
            className={itemClass({ disabled: !aiGate.allowed })}
            onClick={run(onLecturaRapida, aiGate.allowed)}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            Lectura rápida con IA
          </button>
          <div className="my-1 border-t border-slate-100" role="separator" />
          <button
            type="button"
            role="menuitem"
            disabled={!renameGate.allowed}
            title={renameGate.reason}
            className={itemClass({ disabled: !renameGate.allowed })}
            onClick={run(onRename, renameGate.allowed)}
          >
            <Pencil className="h-3.5 w-3.5 shrink-0" />
            Renombrar
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!signGate.allowed}
            title={signGate.reason}
            className={itemClass({ disabled: !signGate.allowed })}
            onClick={run(onSign, signGate.allowed)}
          >
            <PenLine className="h-3.5 w-3.5 shrink-0" />
            Firmar en SGDE
          </button>
          <div className="my-1 border-t border-slate-100" role="separator" />
          <button
            type="button"
            role="menuitem"
            disabled={!delGate.allowed || deleting}
            title={delGate.reason}
            className={itemClass({ danger: true, disabled: !delGate.allowed || deleting })}
            onClick={(e) => {
              e.stopPropagation();
              if (!delGate.allowed || deleting) return;
              onDelete();
              onOpenChange(false);
            }}
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
            )}
            Eliminar
          </button>
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  caseId: string;
  caseItem: Case;
  extraNotebooks: ExpedienteCuadernoExtra[];
  onRefetchCase: () => void | Promise<void>;
  docs: Document[];
  selectedDoc: Document | null;
  onSelectDoc: (doc: Document | null) => void;
  onRefetchDocs: () => void | Promise<void>;
  /** Si hay visor o constancia a la derecha, la lista usa menos alto. */
  visorAbierto?: boolean;
  onVerConstanciaIngreso?: () => void;
  /** Páginas del PDF en visor (solo pieza seleccionada); para habilitar IA. */
  pdfPageCount?: number | null;
  /** Abre la pieza en el visor y dispara lectura rápida con IA. */
  onLecturaRapidaPieza?: (doc: Document) => void;
};

export function ExpedienteDigitalPanel({
  caseId,
  caseItem,
  extraNotebooks,
  onRefetchCase,
  docs,
  selectedDoc,
  onSelectDoc,
  onRefetchDocs,
  visorAbierto = false,
  onVerConstanciaIngreso,
  pdfPageCount = null,
  onLecturaRapidaPieza,
}: Props) {
  const defaultNb = notebookCodeForCaseType(caseItem.caseType);
  const [selectedNb, setSelectedNb] = useState(defaultNb);
  const [uploadingNb, setUploadingNb] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [addingNb, setAddingNb] = useState(false);
  const [addCuadernoOpen, setAddCuadernoOpen] = useState(false);
  const [newCuadernoLabel, setNewCuadernoLabel] = useState('');
  const [signDoc, setSignDoc] = useState<Document | null>(null);
  const [renameDoc, setRenameDoc] = useState<Document | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [piezaMenuId, setPiezaMenuId] = useState<string | null>(null);
  const [piezaBusqueda, setPiezaBusqueda] = useState('');
  const [uploadActDialog, setUploadActDialog] = useState<{
    files: File[];
    notebookCode: string;
  } | null>(null);
  const defaultInstancia: ExpedienteInstanciaCode =
    caseItem.caseType === 'tutela_segunda' ? 'SI' : 'PI';
  const [expandedInstancia, setExpandedInstancia] = useState<Set<ExpedienteInstanciaCode>>(() =>
    new Set(
      caseItem.caseType === 'tutela_segunda'
        ? (['PI', 'SI'] as ExpedienteInstanciaCode[])
        : [defaultInstancia]
    )
  );
  const pickNbRef = useRef(DEFAULT_NOTEBOOK_CODE);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listaScrollRef = useRef<HTMLDivElement>(null);
  const listaScrollTopRef = useRef(0);
  const prevCaseIdRef = useRef(caseId);

  const [localExtraNotebooks, setLocalExtraNotebooks] = useState<ExpedienteCuadernoExtra[]>(() =>
    loadLocalExtraCuadernos(caseId)
  );
  const [cuadernosExtraColumnMissing, setCuadernosExtraColumnMissing] = useState(false);

  useEffect(() => {
    setLocalExtraNotebooks(loadLocalExtraCuadernos(caseId));
    setCuadernosExtraColumnMissing(false);
  }, [caseId]);

  const mergedExtraNotebooks = useMemo(
    () => mergeExtraCuadernos(extraNotebooks, localExtraNotebooks),
    [extraNotebooks, localExtraNotebooks]
  );

  const sections = useMemo(
    () => buildNotebookSections(mergedExtraNotebooks, docs, caseItem.caseType),
    [mergedExtraNotebooks, docs, caseItem.caseType]
  );
  const instanciaGroups = useMemo(() => groupSectionsByInstancia(sections), [sections]);
  const showInstanciaGroups = instanciaGroups.length > 1;

  const activeNb =
    sections.find((s) => s.code === selectedNb) ??
    sections.find((s) => s.code === defaultNb) ??
    sections[0];
  const activeCode = activeNb?.code ?? defaultNb;
  const piezasTotal = useMemo(() => expedientePiezasParaLista(docs).length, [docs]);
  const piezasRadicacion = useMemo(
    () => expedientePiezasParaLista(docs).filter((d) => d.type !== 'email_body'),
    [docs]
  );

  useEffect(() => {
    setPiezaBusqueda('');
  }, [activeCode]);

  useEffect(() => {
    const codes = sections.map((s) => s.code);
    const codeSet = new Set(codes);
    const first = codes[0] ?? defaultNb;

    if (prevCaseIdRef.current !== caseId) {
      prevCaseIdRef.current = caseId;
      setExpandedInstancia(new Set(instanciaGroups.map((g) => g.instancia)));
      setSelectedNb(first);
      return;
    }

    setSelectedNb((prev) => (codeSet.has(prev) ? prev : first));
  }, [caseId, defaultNb, instanciaGroups, sections]);

  const selectCuaderno = useCallback(
    (code: string) => {
      setSelectedNb(code);
      setPiezaBusqueda('');
      if (showInstanciaGroups) {
        const inst = instanciaForNotebook(code);
        setExpandedInstancia((prev) => new Set(prev).add(inst));
      }
    },
    [showInstanciaGroups]
  );

  const toggleInstancia = (inst: ExpedienteInstanciaCode) => {
    setExpandedInstancia((prev) => {
      const next = new Set(prev);
      if (next.has(inst)) next.delete(inst);
      else next.add(inst);
      return next;
    });
  };

  useEffect(() => {
    const el = listaScrollRef.current;
    if (!el) return;
    const saved = listaScrollTopRef.current;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (listaScrollRef.current) listaScrollRef.current.scrollTop = saved;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [visorAbierto, selectedDoc?.id]);

  const piezasForNotebook = useCallback(
    (code: string) => {
      const list = filterByNotebook(docs, code, {
        caseType: caseItem.caseType,
        sections,
      }).filter(isExpedientePiezaListable);
      return sortExpedienteCuadernoPiezas(list, caseItem.caseType);
    },
    [docs, caseItem.caseType, sections],
  );

  const piezasFiltradasFor = useCallback(
    (code: string) => {
      const list = piezasForNotebook(code);
      const q = piezaBusqueda.trim().toLowerCase();
      if (!q || code !== activeCode) return list;
      return list.filter((d) => {
        const titulo = listaTituloDocumento(d).toLowerCase();
        const raw = caseDocumentRawLabel(d).toLowerCase();
        const acto = (labelForActCode(inferActCodeFromDocument(d), caseItem.caseType) || '').toLowerCase();
        return titulo.includes(q) || raw.includes(q) || acto.includes(q);
      });
    },
    [piezasForNotebook, piezaBusqueda, activeCode, caseItem.caseType]
  );

  const openFilePicker = (notebookCode: string) => {
    pickNbRef.current = notebookCode;
    fileInputRef.current?.click();
  };

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_UPLOAD_BYTES) return 'El archivo supera 50 MB.';
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXT.has(ext))
      return `Formato no permitido (.${ext}). Use PDF, Word (.doc/.docx), imagen, TIFF, MP3 o MPEG.`;
    return null;
  };

  const uploadFilesToExpediente = useCallback(
    async (payload: {
      files: File[];
      notebookCode: string;
      actCode?: string;
      partyEntity?: string;
    }) => {
      const { files, notebookCode, actCode, partyEntity } = payload;
      setUploadingNb(notebookCode);
      try {
        await ensureSupabaseSessionForWrites();
        let order = maxSortOrder(docs, notebookCode);
        for (const file of files) {
          order += 1;
          const logicalName = actCode
            ? suggestedLogicalNameForAct(actCode, { partyEntity, originalFilename: file.name })
            : file.name;
          const body = new Uint8Array(await file.arrayBuffer());
          const up = await uploadCaseAttachment(
            supabase,
            caseId,
            logicalName,
            body,
            file.type || 'application/octet-stream',
          );
          if ('error' in up) throw up.error;
          const displayName = logicalName.replace(/\.[^.]+$/, '');
          const row: Record<string, unknown> = {
            case_id: caseId,
            name: displayName,
            original_name: file.name,
            type: actCode ? 'expediente_acto' : 'expediente_upload',
            content_type: file.type || 'application/octet-stream',
            size: file.size,
            storage_path: up.path,
            is_from_link: false,
            sort_order: order,
            notebook_code: notebookCode,
          };
          if (actCode) {
            row.act_code = actCode;
            row.act_sequence = nextActSequenceForDocs(docs, actCode);
            row.source_channel = 'manual';
            if (partyEntity?.trim()) row.party_entity = partyEntity.trim();
          }
          const ins = await insertCaseDocumentRows(supabase, [row]);
          if (ins.error) {
            await removeCaseDocumentObjects(supabase, [up.path]);
            await handleDataPermissionError(ins.error, 'create', 'case_documents');
            throw ins.error;
          }
        }
        await onRefetchDocs();
      } catch (e) {
        console.error(e);
        setUploadErr(e instanceof Error ? e.message : 'No se pudo subir el archivo.');
        throw e;
      } finally {
        setUploadingNb(null);
      }
    },
    [caseId, docs, onRefetchDocs],
  );

  const handleFiles = useCallback(
    async (list: FileList | null) => {
      if (!list?.length) return;
      const notebookCode = pickNbRef.current;
      setUploadErr(null);
      const files = Array.from(list);
      for (const f of files) {
        const v = validateFile(f);
        if (v) {
          setUploadErr(v);
          return;
        }
      }
      // Provisional: no pedir «Tipo de acto procesal» al subir; reactivar el diálogo cuando el flujo de actos esté listo.
      const PROMPT_ACT_ON_UPLOAD = false;
      if (PROMPT_ACT_ON_UPLOAD && uploadableActsForCaseType(caseItem.caseType).length > 0) {
        setUploadActDialog({ files, notebookCode });
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      await uploadFilesToExpediente({ files, notebookCode });
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [caseItem.caseType, uploadFilesToExpediente],
  );

  const confirmUploadWithAct = useCallback(
    async (payload: ExpedienteUploadActPayload) => {
      setUploadActDialog(null);
      try {
        await uploadFilesToExpediente({
          files: payload.files,
          notebookCode: payload.notebookCode,
          actCode: payload.actCode,
          partyEntity: payload.partyEntity,
        });
      } catch {
        /* uploadFilesToExpediente ya registró el error */
      }
    },
    [uploadFilesToExpediente],
  );

  function friendlyCaseUpdateError(rawIn: unknown): string {
    const raw =
      typeof rawIn === 'string'
        ? rawIn
        : rawIn && typeof rawIn === 'object' && 'message' in rawIn
          ? String((rawIn as { message?: unknown }).message)
          : rawIn instanceof Error
            ? rawIn.message
            : String(rawIn);
    if (/notebook_code/i.test(raw) && /Could not find|schema cache/i.test(raw)) {
      return (
        'En Supabase falta la columna «notebook_code» en «case_documents». ' +
        'Ejecute supabase/migrations/20250428160000_case_documents_notebook.sql en el SQL Editor y recargue.'
      );
    }
    if (/expediente_cuadernos_extra/i.test(raw) && /Could not find|PGRST204|schema cache/i.test(raw)) {
      return (
        'En Supabase falta la columna «expediente_cuadernos_extra» en la tabla «cases». ' +
        'Ejecute la migración supabase/migrations/20250428170000_cases_expediente_cuadernos_extra.sql en el SQL Editor y recargue la página.'
      );
    }
    if (raw.startsWith('{')) {
      try {
        const j = JSON.parse(raw) as { error?: string };
        if (j.error) return j.error;
      } catch {
        /* ignore */
      }
    }
    return raw || 'No se pudo crear el cuaderno.';
  }

  const openAddCuadernoDialog = () => {
    setUploadErr(null);
    setNewCuadernoLabel('');
    setAddCuadernoOpen(true);
  };

  const persistExtraCuaderno = async (entry: ExpedienteCuadernoExtra) => {
    const code = normalizeNotebookCode(entry.code);
    const label = (entry.label || '').trim() || NOTEBOOK_META[code]?.label || code;
    if (!code) {
      setUploadErr('Código de cuaderno inválido.');
      return;
    }
    if (mergedExtraNotebooks.some((e) => normalizeNotebookCode(e.code) === code)) {
      selectCuaderno(code);
      setAddCuadernoOpen(false);
      setNewCuadernoLabel('');
      return;
    }
    setUploadErr(null);
    setAddingNb(true);
    try {
      await ensureSupabaseSessionForWrites();
      const nextEntry = { code, label };
      const localOnly = mergeExtraCuadernos(extraNotebooks, [
        ...localExtraNotebooks,
        nextEntry,
      ]).filter((e) => !extraNotebooks.some((x) => x.code === e.code));

      const finishLocal = (notice?: string) => {
        setLocalExtraNotebooks(localOnly);
        saveLocalExtraCuadernos(caseId, localOnly);
        setAddCuadernoOpen(false);
        setNewCuadernoLabel('');
        selectCuaderno(code);
        if (notice) setUploadErr(notice);
      };

      if (cuadernosExtraColumnMissing) {
        finishLocal();
        return;
      }

      const persisted = mergeExtraCuadernos(extraNotebooks, [
        ...localExtraNotebooks,
        nextEntry,
      ]);
      const { error } = await supabase
        .from('cases')
        .update({
          expediente_cuadernos_extra: persisted,
          updated_at: new Date().toISOString(),
        })
        .eq('id', caseId);

      if (error) {
        if (isMissingExpedienteCuadernosExtraColumn(error)) {
          setCuadernosExtraColumnMissing(true);
          finishLocal(
            'Cuaderno creado en esta sesión. Para persistirlo en Supabase ejecute: supabase/migrations/20250428170000_cases_expediente_cuadernos_extra.sql'
          );
          return;
        }
        await handleDataPermissionError(error, 'update', 'cases');
        throw error;
      }
      setAddCuadernoOpen(false);
      setNewCuadernoLabel('');
      selectCuaderno(code);
      setLocalExtraNotebooks([]);
      saveLocalExtraCuadernos(caseId, []);
      await onRefetchCase();
    } catch (e) {
      console.error(e);
      setUploadErr(friendlyCaseUpdateError(e));
    } finally {
      setAddingNb(false);
    }
  };

  const confirmAddCuaderno = async () => {
    const label = newCuadernoLabel.trim();
    if (!label) {
      setUploadErr('Escriba un nombre para el cuaderno.');
      return;
    }
    await persistExtraCuaderno({ code: `PI_INC_${Date.now()}`, label });
  };

  const addCautelarNotebook = async () => {
    await persistExtraCuaderno(cautelarNotebookExtra());
  };

  const showCautelarPreset =
    caseItem.caseType === 'civil_ejecutivo' && !caseHasCautelarNotebook(mergedExtraNotebooks);

  const onDownload = async (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation();
    const path = doc.storagePath?.trim();
    if (!path) return;
    const url = await signedDownloadUrl(path);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openRenameDialog = (doc: Document) => {
    setRenameDoc(doc);
    setRenameValue(doc.name || '');
    setUploadErr(null);
  };

  const confirmRenamePieza = async () => {
    if (!renameDoc) return;
    const name = renameValue.trim();
    if (!name) {
      setUploadErr('Escriba un nombre para la pieza.');
      return;
    }
    setRenameSaving(true);
    setUploadErr(null);
    try {
      await ensureSupabaseSessionForWrites();
      const { error } = await supabase
        .from('case_documents')
        .update({ name })
        .eq('id', renameDoc.id)
        .eq('case_id', caseId);
      if (error) {
        await handleDataPermissionError(error, 'update', 'case_documents');
        throw error;
      }
      setRenameDoc(null);
      setRenameValue('');
      await onRefetchDocs();
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'No se pudo renombrar la pieza.');
    } finally {
      setRenameSaving(false);
    }
  };

  const deletePieza = async (doc: Document) => {
    const gate = canDeleteExpedientePieza(doc, caseItem);
    if (!gate.allowed) {
      setUploadErr(gate.reason || 'No se puede eliminar esta pieza.');
      return;
    }
    const titulo = listaTituloDocumento(doc);
    const extra = gate.reason ? `\n\n${gate.reason}` : '';
    if (!window.confirm(`¿Eliminar «${titulo}» del expediente digital?${extra}`)) return;

    setDeletingId(doc.id);
    setUploadErr(null);
    try {
      await ensureSupabaseSessionForWrites();
      const path = doc.storagePath?.trim();
      if (path) {
        const removed = await removeCaseDocumentObjects(supabase, [path]);
        if (!removed) throw new Error('No se pudo eliminar el archivo en almacenamiento.');
      }
      const { error } = await supabase.from('case_documents').delete().eq('id', doc.id).eq('case_id', caseId);
      if (error) {
        await handleDataPermissionError(error, 'delete', 'case_documents');
        throw error;
      }
      if (caseItem?.informeIngresoDocumentId === doc.id) {
        await supabase
          .from('cases')
          .update({
            informe_ingreso_registrado_at: null,
            informe_ingreso_document_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', caseId);
      }
      if (selectedDoc?.id === doc.id) onSelectDoc(null);
      await onRefetchDocs();
      await onRefetchCase();
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'No se pudo eliminar la pieza.');
    } finally {
      setDeletingId(null);
    }
  };

  const renderDropZone = (nb: ExpedienteCuadernoExtra) => {
    const busy = uploadingNb === nb.code;
    return (
      <button
        type="button"
        disabled={Boolean(uploadingNb)}
        onClick={() => openFilePicker(nb.code)}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          e.preventDefault();
          pickNbRef.current = nb.code;
          void handleFiles(e.dataTransfer.files);
        }}
        className="flex w-full flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-slate-300 bg-white/80 px-2 py-2.5 text-center transition hover:border-accent/40 hover:bg-accent/[0.03] disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        ) : (
          <Upload className="h-5 w-5 text-slate-400" />
        )}
        <span className="text-[11px] font-medium text-slate-600">Arrastra archivos a «{nb.label}»</span>
        <span className="text-[9px] text-slate-400">PDF · Word · JPG · TIFF · MP3 · MPEG — máx. 50 MB</span>
      </button>
    );
  };

  const renderRow = (doc: Document, listIndex: number) => {
    const displayName = listaTituloDocumento(doc);
    const ext = typeChipForDoc(doc, rawFileLabel(doc) || displayName);
    const sel = selectedDoc?.id === doc.id;
    const badge = badgeFor(doc, caseItem.caseType);
    const sgdeSync = documentSgdeSyncStatus(doc);
    const sgdeSyncStyle = DOCUMENT_SGDE_SYNC_STYLES[sgdeSync];
    const sgdeSyncLabel = DOCUMENT_SGDE_SYNC_LABELS[sgdeSync];
    const showSgdeChip = Boolean(caseItem.sgdeId?.trim()) || sgdeSync !== 'none';
    const created = doc.createdAt ? format(new Date(doc.createdAt), 'd MMM', { locale: es }) : '—';
    const canDownload = Boolean(doc.storagePath?.trim()) && !doc.ingestError;
    const pageHint = selectedDoc?.id === doc.id ? pdfPageCount : null;
    const aiGate = pieceAiEligibility(doc, pageHint);
    const indiceLista = indiceCuadernoDesdeLista(listIndex);
    const sgdeIndice =
      typeof doc.actSequence === 'number' && !Number.isNaN(doc.actSequence)
        ? doc.actSequence
        : null;

    return (
      <div
        key={doc.id}
        role="button"
        tabIndex={0}
        onClick={() => onSelectDoc(doc)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectDoc(doc);
          }
        }}
        className={`flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm transition hover:border-slate-300 ${
          sel ? 'ring-2 ring-accent/30 border-accent/40' : ''
        }`}
      >
        <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
          <span
            className="text-[10px] font-semibold tabular-nums text-slate-400"
            title={
              sgdeIndice != null
                ? `Índice SGDE: ${String(sgdeIndice).padStart(2, '0')}`
                : undefined
            }
          >
            {String(indiceLista).padStart(2, '0')}
          </span>
          <span className={`rounded px-1 py-0.5 text-[8px] font-bold ${extChipClass(ext)}`}>{ext}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="text-xs font-semibold leading-snug text-slate-800 break-words"
            title={displayName}
          >
            {displayName}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span
              className={`rounded-full px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide ${badge.className}`}
            >
              {badge.text}
            </span>
            {showSgdeChip ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide ${sgdeSyncStyle}`}
                title={doc.sgdeFolderPath || undefined}
              >
                {sgdeSyncLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[9px] leading-snug text-slate-400">
            {created} · {formatBytes(doc.size)}
          </p>
          {doc.ingestError ? (
            <p className="mt-0.5 text-[10px] leading-snug text-amber-700">{doc.ingestError}</p>
          ) : null}
        </div>
        <PiezaRowMenu
          open={piezaMenuId === doc.id}
          onOpenChange={(open) => setPiezaMenuId(open ? doc.id : null)}
          canView={isCaseDocumentOpenableInViewer(doc)}
          canDownload={canDownload}
          deleting={deletingId === doc.id}
          signGate={canSignExpedientePiezaInSgde(doc)}
          renameGate={canRenameExpedientePieza(doc)}
          delGate={canDeleteExpedientePieza(doc, caseItem)}
          aiGate={aiGate}
          onView={() => onSelectDoc(doc)}
          onDownload={(e) => void onDownload(e, doc)}
          onLecturaRapida={() => onLecturaRapidaPieza?.(doc)}
          onRename={() => openRenameDialog(doc)}
          onSign={() => setSignDoc(doc)}
          onDelete={() => void deletePieza(doc)}
        />
      </div>
    );
  };

  const renderCuadernoCuerpo = (nb: ExpedienteCuadernoExtra) => {
    const code = nb.code;
    const list = piezasForNotebook(code);
    const filtradas = piezasFiltradasFor(code);
    const meta = NOTEBOOK_META[code];
    const busquedaActiva = code === activeCode && piezaBusqueda.trim().length > 0;
    const treeDocs = busquedaActiva ? filtradas : list;
    const sgdeTreeMode = list.some((d) => splitSgdeFolderPath(d.sgdeFolderPath).length > 0);

    return (
      <div className="flex min-h-0 flex-1 flex-col bg-white/90 px-2 pb-2 pt-1.5">
        {meta?.subtitle ? (
          <p className="mb-1.5 shrink-0 px-1 text-[9px] text-slate-500">{meta.subtitle}</p>
        ) : null}
        <ExpedienteTreeModeHint visible={sgdeTreeMode} />
        {code === activeCode &&
        piezasRadicacion.length === 0 &&
        list.length === 0 ? (
          <div className="mb-2 shrink-0 rounded-md border border-sky-200/90 bg-sky-50/90 px-2 py-1.5 text-[9px] leading-snug text-sky-950">
            Sin demanda/anexos aquí. Suba PDF abajo o use SGDE /{' '}
            <Link to="/correo/contestaciones" className="font-semibold underline">
              Contestaciones (correo)
            </Link>{' '}
            o{' '}
            <Link to="/correo/pendientes" className="font-semibold underline">
              Correo pendientes
            </Link>
            .
          </div>
        ) : null}
        {busquedaActiva ? (
          <p className="mb-1 shrink-0 px-1 text-[9px] text-slate-500">
            Mostrando {filtradas.length} de {list.length}
          </p>
        ) : null}
        <div
          ref={code === activeCode ? listaScrollRef : undefined}
          className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
          onScroll={
            code === activeCode
              ? (e) => {
                  listaScrollTopRef.current = e.currentTarget.scrollTop;
                }
              : undefined
          }
        >
          <ExpedienteSgdeFolderTree
            docs={treeDocs}
            cuadernoLabel={nb.label}
            searchQuery={busquedaActiva ? piezaBusqueda : ''}
            selectedDocId={selectedDoc?.id}
            renderFileRow={(d, i) => renderRow(d, i)}
          />
        </div>
        <div className="mt-1.5 shrink-0 border-t border-slate-100 pt-1.5">{renderDropZone(nb)}</div>
      </div>
    );
  };

  const renderCuadernoNavRow = (nb: ExpedienteCuadernoExtra, nested = false) => {
    const count = piezasForNotebook(nb.code).length;
    const activo = nb.code === activeCode;
    const meta = NOTEBOOK_META[nb.code];
    return (
      <button
        key={nb.code}
        type="button"
        onClick={() => selectCuaderno(nb.code)}
        aria-current={activo ? 'true' : undefined}
        className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition ${
          nested ? 'ml-2' : ''
        } ${
          activo
            ? 'bg-emerald-50 font-semibold text-emerald-950 ring-1 ring-emerald-200/80'
            : 'text-slate-700 hover:bg-slate-100/90'
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-xs">{nb.label}</span>
        {meta?.shortLabel ? (
          <span className="hidden shrink-0 text-[9px] text-slate-400 sm:inline">{meta.shortLabel}</span>
        ) : null}
        <span className="shrink-0 tabular-nums text-[10px] font-medium text-slate-500">
          {count} pieza{count === 1 ? '' : 's'}
        </span>
      </button>
    );
  };

  const renderCuadernosNav = () => (
    <div
      className="shrink-0 space-y-1 overflow-y-auto overscroll-y-contain border-b border-slate-200/80 pb-2"
      aria-label="Cuadernos del expediente"
    >
      {showInstanciaGroups
        ? instanciaGroups.map(({ instancia, notebooks }) => {
            const instOpen = expandedInstancia.has(instancia);
            const instCount = notebooks.reduce(
              (n, nb) => n + piezasForNotebook(nb.code).length,
              0
            );
            return (
              <div
                key={instancia}
                className="overflow-hidden rounded-md border border-slate-200/90 bg-slate-50/50"
              >
                <button
                  type="button"
                  onClick={() => toggleInstancia(instancia)}
                  aria-expanded={instOpen}
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-slate-100/80"
                >
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 text-slate-600 transition-transform ${
                      instOpen ? 'rotate-90' : ''
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-wide text-slate-800">
                    {INSTANCIA_LABELS[instancia]}
                  </span>
                  <span className="shrink-0 tabular-nums text-[10px] font-semibold text-slate-500">
                    {instCount} pieza{instCount === 1 ? '' : 's'}
                  </span>
                </button>
                {instOpen ? (
                  <div className="space-y-0.5 border-t border-slate-200/70 bg-white/80 p-1">
                    {notebooks.map((nb) => renderCuadernoNavRow(nb, true))}
                  </div>
                ) : null}
              </div>
            );
          })
        : sections.map((nb) => renderCuadernoNavRow(nb))}
    </div>
  );

  const renderPanelContenidoActivo = () => {
    if (!activeNb) return null;
    const instLabel = showInstanciaGroups
      ? INSTANCIA_LABELS[instanciaForNotebook(activeNb.code)]
      : null;
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-2">
        <div className="mb-1.5 shrink-0 px-1">
          <p className="text-xs font-semibold text-slate-800">{activeNb.label}</p>
          {instLabel ? (
            <p className="text-[10px] text-slate-500">{instLabel}</p>
          ) : null}
        </div>
        {renderCuadernoCuerpo(activeNb)}
      </div>
    );
  };

  return (
    <div id="panel-documentos" className="scroll-mt-24 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <ExpedienteUploadActDialog
        open={Boolean(uploadActDialog)}
        files={uploadActDialog?.files ?? []}
        notebookCode={uploadActDialog?.notebookCode ?? defaultNb}
        caseType={caseItem.caseType}
        busy={Boolean(uploadingNb)}
        onCancel={() => setUploadActDialog(null)}
        onConfirm={confirmUploadWithAct}
      />
      {uploadableActsForCaseType(caseItem.caseType).length > 0 ? (
        <ExpedienteActTimeline docs={docs} caseType={caseItem.caseType} />
      ) : null}
      <ExpedienteSignSgdeDialog
        open={Boolean(signDoc)}
        caseId={caseId}
        doc={signDoc}
        onClose={() => setSignDoc(null)}
        onSigned={() => {
          void onRefetchDocs();
          void onRefetchCase();
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.tif,.tiff,.png,.webp,.mp3,.mpeg,.mpg"
        onChange={(e) => void handleFiles(e.target.files)}
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200/80 pb-2">
        <div className="relative min-w-[8rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={piezaBusqueda}
            onChange={(e) => setPiezaBusqueda(e.target.value)}
            placeholder="Buscar en cuaderno activo…"
            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            aria-label="Buscar pieza en el cuaderno activo"
          />
        </div>
        <span className="shrink-0 tabular-nums text-[9px] font-semibold text-slate-500">
          {piezasTotal} piezas
        </span>
        {showCautelarPreset ? (
          <button
            type="button"
            disabled={addingNb}
            onClick={() => void addCautelarNotebook()}
            title="Abrir cuaderno de medidas cautelares (C02)"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-amber-900 hover:border-amber-300 disabled:opacity-50"
          >
            {addingNb ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderPlus className="h-3 w-3" />}
            <span className="hidden sm:inline">Cautelares</span>
          </button>
        ) : null}
        <button
          type="button"
          disabled={addingNb}
          onClick={openAddCuadernoDialog}
          title="Añadir cuaderno (incidente u otro)"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-600 hover:border-accent/40 hover:text-accent disabled:opacity-50"
        >
          {addingNb ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderPlus className="h-3 w-3" />}
          <span className="hidden sm:inline">Cuaderno</span>
        </button>
        {!visorAbierto && onVerConstanciaIngreso ? (
          <button
            type="button"
            onClick={onVerConstanciaIngreso}
            className="inline-flex shrink-0 items-center rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[9px] font-semibold text-slate-600 hover:border-accent/40 hover:text-accent"
          >
            Constancia correo
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {renderCuadernosNav()}
        {renderPanelContenidoActivo()}
      </div>

      {renameDoc ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-pieza-title"
          onClick={() => {
            if (!renameSaving) {
              setRenameDoc(null);
              setRenameValue('');
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h4 id="rename-pieza-title" className="text-sm font-bold text-slate-800">
                Renombrar pieza
              </h4>
              <button
                type="button"
                disabled={renameSaving}
                onClick={() => {
                  setRenameDoc(null);
                  setRenameValue('');
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Nombre visible en Jurion. No cambia el archivo en SGDE si ya estaba sincronizado.
            </p>
            <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Nombre
            </label>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmRenamePieza();
              }}
              disabled={renameSaving}
              autoFocus
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={renameSaving}
                onClick={() => {
                  setRenameDoc(null);
                  setRenameValue('');
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={renameSaving}
                onClick={() => void confirmRenamePieza()}
                className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
              >
                {renameSaving ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Guardando…
                  </span>
                ) : (
                  'Guardar'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addCuadernoOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-cuaderno-title"
          onClick={() => {
            if (!addingNb) {
              setAddCuadernoOpen(false);
              setNewCuadernoLabel('');
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h4 id="add-cuaderno-title" className="text-sm font-bold text-slate-800">
                Nuevo cuaderno
              </h4>
              <button
                type="button"
                disabled={addingNb}
                onClick={() => {
                  setAddCuadernoOpen(false);
                  setNewCuadernoLabel('');
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Ejemplo: incidente de desacato, de nulidad, otro incidente. Podrá cargar piezas en este cuaderno después de crearlo.
            </p>
            {showCautelarPreset ? (
              <button
                type="button"
                disabled={addingNb}
                onClick={() => void addCautelarNotebook()}
                className="mt-3 w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-[11px] font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
              >
                Usar preset: {NOTEBOOK_META[NOTEBOOK_PI_C02_CAUTELAR].label} (C02)
              </button>
            ) : null}
            <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Nombre del cuaderno
            </label>
            <input
              type="text"
              value={newCuadernoLabel}
              onChange={(e) => setNewCuadernoLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmAddCuaderno();
              }}
              disabled={addingNb}
              autoFocus
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
              placeholder="Incidente de desacato…"
            />
            {uploadErr && addCuadernoOpen ? (
              <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
                {uploadErr}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={addingNb}
                onClick={() => {
                  setAddCuadernoOpen(false);
                  setNewCuadernoLabel('');
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={addingNb}
                onClick={() => void confirmAddCuaderno()}
                className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
              >
                {addingNb ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Guardando…
                  </span>
                ) : (
                  'Crear cuaderno'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {uploadErr ? (
        <div className="mt-2 flex shrink-0 items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {uploadErr}
        </div>
      ) : null}
    </div>
  );
}
