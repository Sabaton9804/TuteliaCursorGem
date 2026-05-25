import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Eye, Download, Upload, Loader2, AlertCircle, FolderPlus, X, PenLine } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import { ensureSupabaseSessionForWrites } from '../../lib/supabase-write-auth';
import { handleDataPermissionError } from '../../lib/error-handler';
import {
  uploadCaseAttachment,
  insertCaseDocumentRows,
  CASE_DOCUMENTS_BUCKET,
  CASE_DOCUMENT_SIGNED_URL_TTL_SEC,
} from '../../lib/case-document-storage';
import type { Document } from '../../types';
import {
  DEFAULT_NOTEBOOK_CODE,
  INSTANCIA_LABELS,
  NOTEBOOK_META,
  NOTEBOOK_PI_C01_PRINCIPAL,
  NOTEBOOK_SI_C01_PRINCIPAL,
  instanciaForNotebook,
  notebookCodeForCaseType,
  normalizeNotebookCode,
  type ExpedienteInstanciaCode,
} from '../../lib/expediente-notebook';
import {
  DOCUMENT_SGDE_SYNC_LABELS,
  DOCUMENT_SGDE_SYNC_STYLES,
  documentSgdeSyncStatus,
} from '../../lib/expediente-sgde-sync';
import { ExpedienteSgdeBar } from './ExpedienteSgdeBar';
import { ExpedienteSignSgdeDialog } from './ExpedienteSignSgdeDialog';
import type { Case } from '../../types';
import { sanitizeExpedienteFilenameForDisplay } from '../../lib/sanitize-expediente-filename';
import { caseDocumentRawLabel } from '../../lib/case-document-display-name';

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

export type ExpedienteCuadernoExtra = { code: string; label: string };

function formatBytes(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Nombre índice del documento (radicación / parseo / carga); base del título sanitizado. */
function rawFileLabel(doc: Document): string {
  return caseDocumentRawLabel(doc);
}

/** Título legible en listado del expediente (sanitizado para pantalla). */
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

function badgeFor(doc: Document): { text: string; className: string } {
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

function filterByNotebook(docs: Document[], code: string): Document[] {
  return sortReparto(docs.filter((d) => normalizeNotebookCode(d.notebookCode) === code));
}

function maxSortOrder(docs: Document[], code: string): number {
  return filterByNotebook(docs, code).reduce((m, d) => Math.max(m, d.order ?? 0), -1);
}

function buildNotebookSections(
  extra: ExpedienteCuadernoExtra[],
  docs: Document[],
  caseType?: Case['caseType']
): ExpedienteCuadernoExtra[] {
  const primary =
    caseType === 'tutela_segunda' ? NOTEBOOK_SI_C01_PRINCIPAL : NOTEBOOK_PI_C01_PRINCIPAL;
  const out: ExpedienteCuadernoExtra[] = [
    { code: primary, label: NOTEBOOK_META[primary].label },
  ];
  const seen = new Set<string>([primary]);
  if (caseType === 'tutela_segunda') {
    const pi = NOTEBOOK_PI_C01_PRINCIPAL;
    if (!seen.has(pi)) {
      seen.add(pi);
      out.push({ code: pi, label: 'Expediente de origen (1ª instancia)' });
    }
  }

  for (const e of extra) {
    const code = (e.code || '').trim();
    if (!code || seen.has(code) || code === primary) continue;
    seen.add(code);
    out.push({ code, label: (e.label || '').trim() || code });
  }

  const fromDocs = new Set<string>();
  for (const d of docs) {
    const c = normalizeNotebookCode(d.notebookCode);
    if (c !== primary) fromDocs.add(c);
  }
  for (const code of [...fromDocs].sort()) {
    if (seen.has(code)) continue;
    seen.add(code);
    const label = NOTEBOOK_META[code]?.label || `Cuaderno · ${code}`;
    out.push({ code, label });
  }
  return out;
}

async function signedDownloadUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CASE_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath.trim(), CASE_DOCUMENT_SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

type Props = {
  caseId: string;
  caseItem: Case;
  extraNotebooks: ExpedienteCuadernoExtra[];
  onRefetchCase: () => void | Promise<void>;
  docs: Document[];
  selectedDoc: Document | null;
  onSelectDoc: (doc: Document) => void;
  onRefetchDocs: () => void | Promise<void>;
};

function groupSectionsByInstancia(
  sections: ExpedienteCuadernoExtra[]
): { instancia: ExpedienteInstanciaCode; notebooks: ExpedienteCuadernoExtra[] }[] {
  const order: ExpedienteInstanciaCode[] = ['PI', 'SI'];
  const buckets = new Map<ExpedienteInstanciaCode, ExpedienteCuadernoExtra[]>();
  for (const nb of sections) {
    const inst = instanciaForNotebook(nb.code);
    const list = buckets.get(inst) || [];
    list.push(nb);
    buckets.set(inst, list);
  }
  return order
    .filter((i) => (buckets.get(i)?.length ?? 0) > 0)
    .map((instancia) => ({ instancia, notebooks: buckets.get(instancia)! }));
}

export function ExpedienteDigitalPanel({
  caseId,
  caseItem,
  extraNotebooks,
  onRefetchCase,
  docs,
  selectedDoc,
  onSelectDoc,
  onRefetchDocs,
}: Props) {
  const defaultNb = notebookCodeForCaseType(caseItem.caseType);
  const [selectedNb, setSelectedNb] = useState(defaultNb);
  const [uploadingNb, setUploadingNb] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [addingNb, setAddingNb] = useState(false);
  const [addCuadernoOpen, setAddCuadernoOpen] = useState(false);
  const [newCuadernoLabel, setNewCuadernoLabel] = useState('');
  const [signDoc, setSignDoc] = useState<Document | null>(null);
  const pickNbRef = useRef(DEFAULT_NOTEBOOK_CODE);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSignInSgde = (doc: Document): boolean => {
    if (!doc.sgdeId?.trim()) return false;
    const nm = (doc.name || '').toLowerCase();
    const ct = (doc.contentType || '').toLowerCase();
    return nm.endsWith('.pdf') || ct.includes('pdf');
  };

  const sections = useMemo(
    () => buildNotebookSections(extraNotebooks, docs, caseItem.caseType),
    [extraNotebooks, docs, caseItem.caseType]
  );
  const instanciaGroups = useMemo(() => groupSectionsByInstancia(sections), [sections]);

  const activeNb =
    sections.find((s) => s.code === selectedNb) ??
    sections.find((s) => s.code === defaultNb) ??
    sections[0];
  const activeCode = activeNb?.code ?? defaultNb;
  const activeList = useMemo(() => filterByNotebook(docs, activeCode), [docs, activeCode]);
  const activeMeta = NOTEBOOK_META[activeCode];

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
      setUploadingNb(notebookCode);
      try {
        await ensureSupabaseSessionForWrites();
        let order = maxSortOrder(docs, notebookCode);
        for (const file of files) {
          order += 1;
          const body = new Uint8Array(await file.arrayBuffer());
          const up = await uploadCaseAttachment(supabase, caseId, file.name, body, file.type || 'application/octet-stream');
          if ('error' in up) throw up.error;
          const row = {
            case_id: caseId,
            name: file.name,
            original_name: file.name,
            type: 'expediente_upload',
            content_type: file.type || 'application/octet-stream',
            size: file.size,
            storage_path: up.path,
            is_from_link: false,
            sort_order: order,
            notebook_code: notebookCode,
          };
          const ins = await insertCaseDocumentRows(supabase, [row]);
          if (ins.error) {
            await handleDataPermissionError(ins.error, 'create', 'case_documents');
            throw ins.error;
          }
        }
        await onRefetchDocs();
      } catch (e) {
        console.error(e);
        setUploadErr(e instanceof Error ? e.message : 'No se pudo subir el archivo.');
      } finally {
        setUploadingNb(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [caseId, docs, onRefetchDocs]
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
    if (/expediente_cuadernos_extra/i.test(raw) && /Could not find|schema cache/i.test(raw)) {
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

  const confirmAddCuaderno = async () => {
    const label = newCuadernoLabel.trim();
    if (!label) {
      setUploadErr('Escriba un nombre para el cuaderno.');
      return;
    }
    setUploadErr(null);
    setAddingNb(true);
    try {
      await ensureSupabaseSessionForWrites();
      const code = `PI_INC_${Date.now()}`;
      const next = [...(extraNotebooks || []), { code, label }];
      const { error } = await supabase
        .from('cases')
        .update({
          expediente_cuadernos_extra: next,
          updated_at: new Date().toISOString(),
        })
        .eq('id', caseId);
      if (error) await handleDataPermissionError(error, 'update', 'cases');
      setAddCuadernoOpen(false);
      setNewCuadernoLabel('');
      await onRefetchCase();
    } catch (e) {
      console.error(e);
      setUploadErr(friendlyCaseUpdateError(e));
    } finally {
      setAddingNb(false);
    }
  };

  const onDownload = async (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation();
    const path = doc.storagePath?.trim();
    if (!path) return;
    const url = await signedDownloadUrl(path);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
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
        className="mt-3 flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white/80 px-3 py-4 text-center transition hover:border-accent/40 hover:bg-accent/[0.03] disabled:opacity-50"
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
    const badge = badgeFor(doc);
    const sgdeSync = documentSgdeSyncStatus(doc);
    const sgdeSyncStyle = DOCUMENT_SGDE_SYNC_STYLES[sgdeSync];
    const sgdeSyncLabel = DOCUMENT_SGDE_SYNC_LABELS[sgdeSync];
    const showSgdeChip = Boolean(caseItem.sgdeId?.trim()) || sgdeSync !== 'none';
    const created = doc.createdAt ? format(new Date(doc.createdAt), 'd MMM', { locale: es }) : '—';
    const canDownload = Boolean(doc.storagePath?.trim()) && !doc.ingestError;
    const ordenReparto =
      typeof doc.order === 'number' && !Number.isNaN(doc.order) ? String(doc.order) : '—';

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
        className={`flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition hover:border-slate-300 ${
          sel ? 'ring-2 ring-accent/30 border-accent/40' : ''
        }`}
      >
        <span className="w-6 shrink-0 text-center text-[11px] font-semibold tabular-nums text-slate-400">
          {String(listIndex + 1).padStart(2, '0')}
        </span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${extChipClass(ext)}`}>{ext}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 gap-y-0.5">
            <span className="truncate text-sm font-semibold text-slate-800" title={displayName}>
              {displayName}
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide ${badge.className}`}>
              {badge.text}
            </span>
            {showSgdeChip ? (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide ${sgdeSyncStyle}`}
                title={doc.sgdeFolderPath || undefined}
              >
                {sgdeSyncLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[10px] text-slate-400">
            {created} · {formatBytes(doc.size)} · orden reparto {ordenReparto}
            {doc.sgdeFolderPath ? ` · ${doc.sgdeFolderPath}` : ''}
          </p>
          {doc.ingestError ? (
            <p className="mt-0.5 text-[10px] text-amber-700">{doc.ingestError}</p>
          ) : null}
        </div>
        <span className="hidden shrink-0 text-[10px] text-slate-400 sm:inline">nº lista {listIndex + 1}</span>
        <div className="flex shrink-0 items-center gap-1">
          {canSignInSgde(doc) ? (
            <button
              type="button"
              title="Firmar en SGDE (expediente Rama)"
              onClick={(e) => {
                e.stopPropagation();
                setSignDoc(doc);
              }}
              className="rounded-full p-1.5 text-violet-600 hover:bg-violet-50 hover:text-violet-800"
            >
              <PenLine className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            title="Ver en el visor"
            onClick={(e) => {
              e.stopPropagation();
              onSelectDoc(doc);
            }}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Descargar"
            disabled={!canDownload}
            onClick={(e) => void onDownload(e, doc)}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  const renderCuadernoNav = () => (
    <nav className="flex w-full shrink-0 flex-col gap-3 sm:w-52 lg:w-56" aria-label="Cuadernos del expediente">
      {instanciaGroups.map(({ instancia, notebooks }) => (
        <div key={instancia}>
          <p className="mb-1.5 px-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
            {INSTANCIA_LABELS[instancia]}
          </p>
          <ul className="space-y-1">
            {notebooks.map((nb) => {
              const count = filterByNotebook(docs, nb.code).length;
              const sel = nb.code === activeCode;
              const meta = NOTEBOOK_META[nb.code];
              return (
                <li key={nb.code}>
                  <button
                    type="button"
                    onClick={() => setSelectedNb(nb.code)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                      sel
                        ? 'border-emerald-200 bg-emerald-50/90 shadow-sm'
                        : 'border-transparent bg-white/60 hover:border-slate-200 hover:bg-white'
                    }`}
                  >
                    <span className="block text-xs font-semibold text-slate-800">{nb.label}</span>
                    {meta?.subtitle ? (
                      <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">{meta.subtitle}</span>
                    ) : null}
                    <span className="mt-1 inline-block text-[10px] font-medium tabular-nums text-slate-400">
                      {count} pieza{count === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div id="panel-documentos" className="scroll-mt-24 space-y-4">
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
      <ExpedienteSgdeBar caseId={caseId} caseItem={caseItem} docs={docs} onRefetchCase={onRefetchCase} />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.tif,.tiff,.png,.webp,.mp3,.mpeg,.mpg"
        onChange={(e) => void handleFiles(e.target.files)}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {renderCuadernoNav()}
        <div className="min-w-0 flex-1">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{activeNb?.label ?? 'Cuaderno'}</h3>
          {activeMeta?.subtitle ? (
            <p className="text-[11px] text-slate-500">{activeMeta.subtitle}</p>
          ) : null}
        </div>
        <span className="text-[10px] text-slate-400">{activeList.length} en este cuaderno · {docs.length} total</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={addingNb}
          onClick={openAddCuadernoDialog}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 hover:border-accent/40 hover:text-accent disabled:opacity-50"
        >
          {addingNb ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
          Añadir cuaderno (incidente u otro)
        </button>
      </div>

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
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {uploadErr}
        </div>
      ) : null}

      <div className="space-y-2">
        {activeList.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-[11px] text-slate-400">
            Sin piezas en este cuaderno. Arrastre archivos abajo o impórtelos desde SGDE.
          </p>
        ) : (
          activeList.map((d, i) => renderRow(d, i))
        )}
      </div>
      {activeNb ? renderDropZone(activeNb) : null}
        </div>
      </div>
    </div>
  );
}
