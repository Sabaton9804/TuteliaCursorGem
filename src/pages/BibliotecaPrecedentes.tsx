import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, isValid, parseISO } from 'date-fns';
import { BookOpen, ExternalLink, FileText, Loader2, Pencil, PlusCircle, Search, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { apiUrl } from '../lib/api-base';
import { formatRadicado } from '../lib/formatters';
import { PRECEDENT_RADICADO_PENDIENTE } from '../lib/precedent-constants';
import { useSessionCourt } from '../contexts/SessionCourtContext';
import { PrecedentSourceBadge } from '../components/expediente/PrecedentSourceBadge';
import { PrecedentPdfPreviewModal } from '../components/precedentes/PrecedentPdfPreviewModal';
import { PrecedentSpecialtyBadge } from '../components/precedentes/PrecedentSpecialtyBadge';
import { PrecedentIssuerCategoryBadge } from '../components/precedentes/PrecedentIssuerCategoryBadge';
import {
  LEGAL_SPECIALTY_CODES,
  LEGAL_SPECIALTY_LABELS,
  type LegalSpecialtyCode,
} from '../lib/precedent-legal-specialties';
import {
  ISSUER_CATEGORY_CODES,
  ISSUER_CATEGORY_LABELS,
  type IssuerCategoryCode,
} from '../lib/precedent-issuer-category';
import ListPagination, { LIST_PAGE_SIZE_DEFAULT } from '../components/ui/ListPagination';
import { supabaseRange } from '../lib/list-pagination';
import type { ListPageSizeOption } from '../lib/list-pagination';

const CORPORACIONES = [
  { value: 'Corte Constitucional', label: 'Corte Constitucional' },
  { value: 'Corte Suprema Sala Civil', label: 'Corte Suprema Sala Civil' },
  { value: 'Corte Suprema Sala Laboral', label: 'Corte Suprema Sala Laboral' },
  { value: 'Consejo de Estado', label: 'Consejo de Estado' },
  { value: 'Tribunal Superior Bogotá', label: 'Tribunal Superior Bogotá' },
  { value: '__otra__', label: 'Otra' },
] as const;

type ListTab = 'despacho' | 'jurisprudencia';

type PrecRow = {
  id: string;
  source_type: string;
  legal_specialty: string | null;
  issuer_category: string | null;
  source_corporation: string | null;
  radicado: string;
  right_protected: string;
  defendant: string;
  ruling_sense: string;
  summary: string;
  decision_date: string | null;
  source_case_id: string | null;
  source_storage_path: string | null;
  created_at: string;
};

type SearchMatch = PrecRow & {
  similarity: number;
  matched_snippet?: string | null;
  matched_chunk_index?: number | null;
  matched_char_start?: number | null;
  matched_char_end?: number | null;
  source_storage_path?: string | null;
};

async function authHeadersForApi(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const h: HeadersInit = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function fetchPrecedentPdfUrl(precedentId: string): Promise<string> {
  const headers = await authHeadersForApi();
  const res = await fetch(apiUrl(`/api/precedents/${encodeURIComponent(precedentId)}/pdf-url`), { headers });
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'No se pudo obtener el PDF');
  if (!j.url) throw new Error('URL del PDF no disponible');
  return j.url;
}

async function openPrecedentPdfInNewTab(precedentId: string): Promise<void> {
  const url = await fetchPrecedentPdfUrl(precedentId);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    throw new Error('El navegador bloqueó la ventana. Permita ventanas emergentes o use Descargar en el visor.');
  }
}

function displayRadicado(radicado: string): string {
  if (!radicado || radicado === PRECEDENT_RADICADO_PENDIENTE) return 'Pendiente';
  return formatRadicado(radicado);
}

function formatFalloDate(raw: string | null): string {
  if (!raw?.trim()) return '—';
  const d = parseISO(raw.length > 10 ? raw : `${raw}T12:00:00`);
  if (!isValid(d)) return raw.slice(0, 10);
  return format(d, 'dd/MM/yyyy');
}

type PdfPreviewRow = Pick<
  PrecRow,
  'id' | 'radicado' | 'ruling_sense' | 'right_protected' | 'source_storage_path'
>;

export default function BibliotecaPrecedentes() {
  const { courtId } = useSessionCourt();
  const [listTab, setListTab] = useState<ListTab>('despacho');
  const [rows, setRows] = useState<PrecRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [queryDraft, setQueryDraft] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [jCorp, setJCorp] = useState<string>(CORPORACIONES[0].value);
  const [jCorpOtra, setJCorpOtra] = useState('');
  const [jRadicado, setJRadicado] = useState('');
  const [jDerecho, setJDerecho] = useState('');
  const [jResumen, setJResumen] = useState('');
  const [jArgumentos, setJArgumentos] = useState('');
  const [jFecha, setJFecha] = useState('');
  const [jSaving, setJSaving] = useState(false);
  const [jMsg, setJMsg] = useState<string | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploadCorpFallback, setUploadCorpFallback] = useState('');
  const [uploadRadicadoHint, setUploadRadicadoHint] = useState('');
  const [uploadLegalSpecialty, setUploadLegalSpecialty] = useState<LegalSpecialtyCode | ''>('');
  const [specialtyFilter, setSpecialtyFilter] = useState<LegalSpecialtyCode | ''>('');
  const [issuerFilter, setIssuerFilter] = useState<IssuerCategoryCode | ''>('');
  const [listPage, setListPage] = useState(1);
  const [listPageSize, setListPageSize] = useState<ListPageSizeOption>(LIST_PAGE_SIZE_DEFAULT);
  const [listTotal, setListTotal] = useState(0);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadMsgTone, setUploadMsgTone] = useState<'success' | 'warn' | 'error'>('success');
  const [uploadFileKey, setUploadFileKey] = useState(0);
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewRow | null>(null);
  const [editingRadicadoId, setEditingRadicadoId] = useState<string | null>(null);
  const [editingRadicadoDraft, setEditingRadicadoDraft] = useState('');
  const [rowFeedback, setRowFeedback] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [rowPatchingId, setRowPatchingId] = useState<string | null>(null);
  const fetchPdfUrlStable = useCallback(
    (precedentId: string) => fetchPrecedentPdfUrl(precedentId),
    []
  );

  const attachPdfInputRef = React.useRef<HTMLInputElement>(null);
  const [attachPdfTargetId, setAttachPdfTargetId] = useState<string | null>(null);
  const [attachPdfBusyId, setAttachPdfBusyId] = useState<string | null>(null);

  async function submitUploadFromFile() {
    setUploadMsg(null);
    setUploadMsgTone('success');
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    if (!file) {
      setUploadMsg('Seleccione un archivo PDF o Word (.docx).');
      setUploadMsgTone('error');
      return;
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pdf') && !lower.endsWith('.docx')) {
      setUploadMsg('Solo se admiten .pdf o .docx.');
      setUploadMsgTone('error');
      return;
    }
    const fd = new FormData();
    fd.append('archivo', file);
    fd.append('courtId', courtId);
    const corpFallback = uploadCorpFallback.trim();
    if (corpFallback) fd.append('sourceCorporation', corpFallback);
    const hint = uploadRadicadoHint.trim();
    if (hint) fd.append('radicadoHint', hint);
    if (uploadLegalSpecialty) fd.append('legalSpecialty', uploadLegalSpecialty);
    // issuer_category se infiere de corporación en servidor; opcional hint futuro
    setUploadBusy(true);
    try {
      const res = await fetch(apiUrl('/api/precedents/index-from-file'), { method: 'POST', body: fd });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        precedent?: { id: string; source_type?: string };
        warnings?: string[];
        classified?: { sourceType?: string; reason?: string };
      };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'No se pudo indexar el archivo');
      const warnings = Array.isArray(j.warnings) ? j.warnings.filter((w) => typeof w === 'string' && w.trim()) : [];
      const autoTab: ListTab =
        j.classified?.sourceType === 'despacho' || j.precedent?.source_type === 'despacho'
          ? 'despacho'
          : 'jurisprudencia';
      const tipoLabel = autoTab === 'despacho' ? 'fallo del despacho' : 'jurisprudencia de referencia';
      if (warnings.length > 0) {
        setUploadMsg(
          `Indexado como ${tipoLabel}. ${warnings.join(' ')} Revise radicado, materia y sentido en la tabla.`
        );
        setUploadMsgTone('warn');
      } else {
        setUploadMsg(
          `Indexado como ${tipoLabel}. Radicado, materia y sentido quedaron en la tabla; ya puede buscarlo.`
        );
        setUploadMsgTone('success');
      }
      setUploadRadicadoHint('');
      setUploadCorpFallback('');
      setUploadFileKey((k) => k + 1);
      if (input) input.value = '';
      setListTab(autoTab);
      setListPage(1);
      await load(autoTab, 1);
    } catch (ex) {
      setUploadMsg(ex instanceof Error ? ex.message : 'Error');
      setUploadMsgTone('error');
    } finally {
      setUploadBusy(false);
    }
  }

  const load = useCallback(
    async (tabOverride?: ListTab, pageOverride?: number) => {
      const tab = tabOverride ?? listTab;
      const page = pageOverride ?? listPage;
      setLoading(true);
      setErr(null);
      try {
        const { from, to } = supabaseRange(page, listPageSize);
        let q = supabase
          .from('precedents')
          .select(
            'id, source_type, legal_specialty, issuer_category, source_corporation, radicado, right_protected, defendant, ruling_sense, summary, decision_date, source_case_id, source_storage_path, created_at',
            { count: 'exact' }
          )
          .eq('court_id', courtId)
          .eq('source_type', tab);
        if (specialtyFilter) q = q.eq('legal_specialty', specialtyFilter);
        if (issuerFilter) q = q.eq('issuer_category', issuerFilter);
        const { data, error, count } = await q
          .order('decision_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .range(from, to);
        if (error) throw error;
        setRows((data as PrecRow[]) ?? []);
        setListTotal(count ?? 0);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Error al cargar precedentes');
        setRows([]);
        setListTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [courtId, listTab, listPage, listPageSize, specialtyFilter, issuerFilter]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setListPage(1);
  }, [listTab, listPageSize, specialtyFilter, issuerFilter]);

  async function patchPrecedentRadicado(rowId: string, rawValue: string) {
    setRowPatchingId(rowId);
    setRowFeedback(null);
    try {
      const headers: HeadersInit = {
        ...(await authHeadersForApi()),
        'Content-Type': 'application/json',
      };
      const res = await fetch(apiUrl(`/api/precedents/${encodeURIComponent(rowId)}`), {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ radicado: rawValue.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        precedent?: { id: string; radicado: string };
      };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'No se pudo guardar el radicado');
      const nextRadicado = j.precedent?.radicado;
      if (nextRadicado) {
        setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, radicado: nextRadicado } : r)));
      }
      setRowFeedback({ id: rowId, text: 'Radicado actualizado.', ok: true });
      setEditingRadicadoId(null);
    } catch (ex) {
      setRowFeedback({
        id: rowId,
        text: ex instanceof Error ? ex.message : 'Error al guardar',
        ok: false,
      });
    } finally {
      setRowPatchingId(null);
    }
  }

  function beginRadicadoEdit(row: PrecRow) {
    setEditingRadicadoId(row.id);
    setEditingRadicadoDraft(row.radicado);
    setRowFeedback(null);
  }

  function cancelRadicadoEdit() {
    setEditingRadicadoId(null);
    setEditingRadicadoDraft('');
  }

  function promptAttachPdf(precedentId: string) {
    setAttachPdfTargetId(precedentId);
    attachPdfInputRef.current?.click();
  }

  async function handleAttachPdfSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const precedentId = attachPdfTargetId;
    const file = e.target.files?.[0];
    e.target.value = '';
    setAttachPdfTargetId(null);
    if (!precedentId || !file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setRowFeedback({ id: precedentId, text: 'Solo se admiten archivos PDF.', ok: false });
      return;
    }
    setAttachPdfBusyId(precedentId);
    setRowFeedback(null);
    try {
      const fd = new FormData();
      fd.append('archivo', file);
      const headers = await authHeadersForApi();
      const res = await fetch(apiUrl(`/api/precedents/${encodeURIComponent(precedentId)}/attach-pdf`), {
        method: 'POST',
        headers,
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        precedent?: PrecRow;
      };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'No se pudo adjuntar el PDF');
      if (j.precedent) {
        setRows((prev) => prev.map((r) => (r.id === precedentId ? { ...r, ...j.precedent } : r)));
      } else {
        await load();
      }
      setRowFeedback({ id: precedentId, text: 'PDF adjuntado. Pulse Ver PDF para abrirlo.', ok: true });
    } catch (ex) {
      setRowFeedback({
        id: precedentId,
        text: ex instanceof Error ? ex.message : 'Error al adjuntar PDF',
        ok: false,
      });
    } finally {
      setAttachPdfBusyId(null);
    }
  }

  async function commitRadicadoEdit(rowId: string) {
    const draft = editingRadicadoDraft.trim();
    if (!draft) {
      setRowFeedback({ id: rowId, text: 'El radicado no puede quedar vacío.', ok: false });
      return;
    }
    const current = rows.find((r) => r.id === rowId)?.radicado;
    if (draft === current) {
      cancelRadicadoEdit();
      return;
    }
    await patchPrecedentRadicado(rowId, draft);
  }

  async function runSearch() {
    const q = queryDraft.trim();
    setSearchSubmitted(true);
    setSearchErr(null);
    setSearchResults([]);
    if (!q) return;
    setSearchLoading(true);
    try {
      const res = await fetch(apiUrl('/api/precedents/search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courtId, queryText: q }),
      });
      const j = (await res.json().catch(() => ({}))) as { results?: SearchMatch[]; error?: string };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Error en la búsqueda');
      setSearchResults(Array.isArray(j.results) ? j.results : []);
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setSearchLoading(false);
    }
  }

  async function submitJurisprudencia(e: React.FormEvent) {
    e.preventDefault();
    setJMsg(null);
    const corp =
      jCorp === '__otra__' ? jCorpOtra.trim() : jCorp;
    const ref = jRadicado.trim();
    const derecho = jDerecho.trim();
    const resumen = jResumen.trim();
    const args = jArgumentos.trim();
    if (!corp || !ref || !derecho) {
      setJMsg('Complete corporación, radicado o referencia y derecho / materia.');
      return;
    }
    if (jCorp === '__otra__' && !jCorpOtra.trim()) {
      setJMsg('Indique el nombre de la corporación en «Otra».');
      return;
    }
    const blob = [derecho, args, resumen].join(' ').trim();
    if (blob.length < 20) {
      setJMsg('Amplíe resumen o argumentos (se necesita texto suficiente para el embedding).');
      return;
    }
    setJSaving(true);
    try {
      const res = await fetch(apiUrl('/api/precedents/index'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courtId,
          sourceType: 'jurisprudencia',
          sourceCorporation: corp,
          radicado: ref,
          rightProtected: derecho,
          defendant: '',
          rulingSense: 'Jurisprudencia de referencia',
          legalArguments: args,
          summary: resumen,
          decisionDate: jFecha.trim() || new Date().toISOString().slice(0, 10),
          tags: [corp],
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'No se pudo guardar');
      setJMsg('Jurisprudencia indexada correctamente.');
      setJRadicado('');
      setJDerecho('');
      setJResumen('');
      setJArgumentos('');
      setJFecha('');
      setJCorp(CORPORACIONES[0].value);
      setJCorpOtra('');
      setListTab('jurisprudencia');
      await load('jurisprudencia');
    } catch (ex) {
      setJMsg(ex instanceof Error ? ex.message : 'Error');
    } finally {
      setJSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-10">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-slate-900">
          <BookOpen className="h-7 w-7 shrink-0 text-accent" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight">Biblioteca de precedentes</h1>
        </div>
        <p className="max-w-3xl rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
          Los fallos de expedientes en Tutelia se pueden indexar al registrar el sentido del fallo. Además puede{' '}
          <strong>subir un PDF o Word</strong>: la IA extrae radicado, corporación, materia y argumentos y genera el
          vector para búsqueda.
        </p>
        <p className="max-w-3xl text-sm text-slate-600">
          Al subir un PDF o Word, la IA clasifica si es <strong className="text-sky-800">fallo del despacho</strong> o{' '}
          <strong className="text-emerald-800">jurisprudencia externa</strong>, asigna la <strong>especialidad</strong>{' '}
          (tutela, civil, laboral, familia, agrario, etc.), la <strong>categoría de corporación</strong> (Corte
          Constitucional, Suprema, Tribunal, Juzgado…) y rellena radicado y materia. Filtre la tabla por especialidad y
          por categoría.
        </p>
      </header>

      <section className="card-modern overflow-hidden border border-violet-100 bg-violet-50/25 p-6 shadow-sm sm:p-8">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-violet-900">
          Subir sentencia o fallo (PDF / Word) — extracción con IA
        </h2>
        <p className="mb-4 max-w-3xl text-xs leading-relaxed text-slate-600">
          Adjunte el archivo: la IA detecta corporación y radicado, decide si es de este despacho o de otra corporación, y
          completa la tabla (radicado, materia, sentido). PDF con texto seleccionable o .docx con contenido.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold text-slate-700">Archivo</span>
            <input
              key={uploadFileKey}
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-violet-100 file:px-3 file:py-2 file:text-xs file:font-bold file:text-violet-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-700">
              Corporación (opcional, solo si el PDF no la trae)
            </span>
            <input
              className="input-modern text-sm"
              value={uploadCorpFallback}
              onChange={(e) => setUploadCorpFallback(e.target.value)}
              placeholder="Ej. Corte Constitucional, Juzgado 051 Civil…"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-700">
              Especialidad (opcional; si vacío, la IA la infiere)
            </span>
            <select
              className="input-modern text-sm"
              value={uploadLegalSpecialty}
              onChange={(e) => setUploadLegalSpecialty((e.target.value || '') as LegalSpecialtyCode | '')}
            >
              <option value="">— Inferir con IA —</option>
              {LEGAL_SPECIALTY_CODES.map((code) => (
                <option key={code} value={code}>
                  {LEGAL_SPECIALTY_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-700">
              Radicado o referencia (opcional, si el documento no lo trae claro)
            </span>
            <input
              className="input-modern text-sm"
              value={uploadRadicadoHint}
              onChange={(e) => setUploadRadicadoHint(e.target.value)}
              placeholder="Ej. 11001-03-24-000-12345-00"
            />
          </label>
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center">
            <button
              type="button"
              disabled={uploadBusy}
              onClick={() => void submitUploadFromFile()}
              className="btn-primary inline-flex items-center justify-center gap-2 bg-violet-700 px-6 py-2.5 text-xs hover:bg-violet-800 disabled:opacity-50"
            >
              {uploadBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Subir e indexar con IA
            </button>
            {uploadMsg ? (
              <p
                className={`text-xs font-medium ${
                  uploadMsgTone === 'success'
                    ? 'text-emerald-800'
                    : uploadMsgTone === 'warn'
                      ? 'text-amber-900'
                      : 'text-rose-800'
                }`}
              >
                {uploadMsg}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card-modern overflow-hidden p-6 shadow-sm sm:p-8">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
          <Search className="h-4 w-4 text-accent" aria-hidden />
          Buscar precedentes similares
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          Busca en <strong>fallos del despacho</strong> y en <strong>jurisprudencia de referencia</strong> a la vez; se
          muestran hasta tres coincidencias con similitud y el origen de cada una.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Texto de búsqueda</span>
            <textarea
              className="input-modern min-h-[88px] w-full resize-y text-sm"
              value={queryDraft}
              onChange={(e) => setQueryDraft(e.target.value)}
              placeholder="Ej. mínimo vital, negación de servicios de salud, debido proceso…"
              rows={3}
            />
          </label>
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={searchLoading || !queryDraft.trim()}
            className="btn-primary inline-flex shrink-0 items-center justify-center gap-2 px-6 py-2.5 text-xs disabled:opacity-50"
          >
            {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
            Buscar
          </button>
        </div>
        {searchErr ? (
          <p className="mt-3 text-xs font-medium text-rose-700">{searchErr}</p>
        ) : null}
        {searchSubmitted && !searchLoading && queryDraft.trim() && !searchErr ? (
          <div className="mt-6 space-y-3">
            {searchResults.length === 0 ? (
              <p className="text-sm text-slate-500">Ningún precedente supera el umbral de similitud para esta consulta.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-1 md:grid-cols-3">
                {searchResults.map((r) => {
                  const pct = Math.round(Number(r.similarity) * 1000) / 10;
                  return (
                    <li
                      key={r.id}
                      className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm"
                    >
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <PrecedentSourceBadge
                            sourceType={r.source_type}
                            sourceCorporation={r.source_corporation}
                            compact
                          />
                          <PrecedentSpecialtyBadge code={r.legal_specialty} />
                          <PrecedentIssuerCategoryBadge code={r.issuer_category} />
                        </div>
                        <span className="shrink-0 font-bold tabular-nums text-violet-700">{pct}%</span>
                      </div>
                      <span
                        className={`font-mono font-semibold ${
                          r.radicado === PRECEDENT_RADICADO_PENDIENTE ? 'text-amber-800' : 'text-slate-900'
                        }`}
                      >
                        {displayRadicado(r.radicado)}
                      </span>
                      <p className="mt-1 line-clamp-2 font-medium text-slate-800">{r.right_protected}</p>
                      {r.matched_snippet?.trim() ? (
                        <p className="mt-2 line-clamp-5 rounded-lg border border-violet-100 bg-violet-50/40 px-2 py-1.5 text-[10px] leading-relaxed text-slate-700">
                          {r.matched_snippet.trim()}
                        </p>
                      ) : null}
                      {r.matched_chunk_index != null ? (
                        <p className="mt-1 text-[10px] text-slate-400">
                          Fragmento {r.matched_chunk_index + 1}
                        </p>
                      ) : null}
                      {r.source_storage_path ? (
                        <button
                          type="button"
                          onClick={() =>
                            setPdfPreview({
                              id: r.id,
                              radicado: r.radicado,
                              ruling_sense: r.ruling_sense,
                              right_protected: r.right_protected,
                              source_storage_path: r.source_storage_path ?? null,
                            })
                          }
                          className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-violet-800 hover:text-violet-950 hover:underline"
                        >
                          <FileText className="h-3 w-3" aria-hidden />
                          Ver fallo PDF
                        </button>
                      ) : null}
                      <p className="mt-1 line-clamp-2 text-slate-600">
                        {r.source_type === 'jurisprudencia'
                          ? `Corporación: ${r.source_corporation || '—'}`
                          : `Demandado / Accionado: ${r.defendant}`}
                      </p>
                      <p className="mt-1 text-[10px] font-semibold uppercase text-slate-500">{r.ruling_sense}</p>
                      {r.source_case_id ? (
                        <Link
                          to={`/case/${r.source_case_id}`}
                          className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-accent hover:underline"
                        >
                          Ver expediente
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
        <button
          type="button"
          onClick={() => {
            setListTab('despacho');
            setListPage(1);
          }}
          className={`rounded-t-lg px-4 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
            listTab === 'despacho'
              ? 'border border-b-0 border-slate-200 bg-white text-sky-800'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Fallos del despacho
        </button>
        <button
          type="button"
          onClick={() => {
            setListTab('jurisprudencia');
            setListPage(1);
          }}
          className={`rounded-t-lg px-4 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
            listTab === 'jurisprudencia'
              ? 'border border-b-0 border-slate-200 bg-white text-emerald-900'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Jurisprudencia de referencia
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Especialidad</span>
        <button
          type="button"
          onClick={() => {
            setSpecialtyFilter('');
            setListPage(1);
          }}
          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
            !specialtyFilter ? 'bg-accent/15 text-accent' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Todas
        </button>
        {LEGAL_SPECIALTY_CODES.filter((c) => c !== 'otro').map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => {
              setSpecialtyFilter(code);
              setListPage(1);
            }}
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
              specialtyFilter === code ? 'bg-accent/15 text-accent' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {LEGAL_SPECIALTY_LABELS[code]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Corporación</span>
        <button
          type="button"
          onClick={() => {
            setIssuerFilter('');
            setListPage(1);
          }}
          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
            !issuerFilter ? 'bg-sky-600/15 text-sky-800' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Todas
        </button>
        {ISSUER_CATEGORY_CODES.filter((c) => c !== 'otro').map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => {
              setIssuerFilter(code);
              setListPage(1);
            }}
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
              issuerFilter === code ? 'bg-sky-600/15 text-sky-800' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {ISSUER_CATEGORY_LABELS[code]}
          </button>
        ))}
      </div>

      <section className="card-modern overflow-hidden p-6 shadow-sm sm:p-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">
            {listTab === 'despacho' ? 'Fallos del despacho' : 'Jurisprudencia cargada'} (
            {loading ? '…' : `${listTotal} en total`})
          </h2>
          <button
            type="button"
            onClick={() => void load(undefined, listPage)}
            className="text-[10px] font-bold uppercase tracking-wide text-accent hover:underline"
          >
            Actualizar lista
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-accent" aria-hidden />
            Cargando…
          </div>
        ) : err ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{err}</p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center text-sm text-slate-600">
            {listTab === 'despacho'
              ? 'No hay fallos del despacho indexados aún. Registre el tipo de decisión en un expediente.'
              : 'No hay jurisprudencia de referencia. Use el formulario siguiente para agregar sentencias de cortes o tribunales.'}
          </div>
        ) : (
          <>
            <input
              ref={attachPdfInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="sr-only"
              aria-hidden
              onChange={(e) => void handleAttachPdfSelected(e)}
            />
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/90 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Origen</th>
                  <th className="px-4 py-3">Radicado / ref.</th>
                  <th className="px-4 py-3">Materia</th>
                  <th className="px-4 py-3">{listTab === 'despacho' ? 'Demandado / Accionado' : 'Corporación'}</th>
                  <th className="px-4 py-3">Sentido / nota</th>
                  <th className="px-4 py-3">Fecha del fallo</th>
                  <th className="px-4 py-3">Documento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-1.5">
                        <PrecedentSourceBadge sourceType={r.source_type} sourceCorporation={r.source_corporation} compact />
                        <div className="flex flex-wrap gap-1">
                          <PrecedentSpecialtyBadge code={r.legal_specialty} />
                          <PrecedentIssuerCategoryBadge code={r.issuer_category} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-xs font-semibold text-slate-900">
                      {editingRadicadoId === r.id ? (
                        <input
                          className="input-modern w-[min(100%,14rem)] font-mono text-xs"
                          value={editingRadicadoDraft}
                          disabled={rowPatchingId === r.id}
                          onChange={(e) => setEditingRadicadoDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void commitRadicadoEdit(r.id);
                            if (e.key === 'Escape') cancelRadicadoEdit();
                          }}
                          onBlur={() => void commitRadicadoEdit(r.id)}
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`break-all ${
                              r.radicado === PRECEDENT_RADICADO_PENDIENTE ? 'font-sans font-bold text-amber-800' : ''
                            }`}
                          >
                            {displayRadicado(r.radicado)}
                          </span>
                          <button
                            type="button"
                            className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-accent"
                            title="Editar radicado"
                            aria-label="Editar radicado"
                            onClick={() => beginRadicadoEdit(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </div>
                      )}
                      {rowFeedback?.id === r.id ? (
                        <p
                          className={`mt-1 text-[10px] font-medium ${rowFeedback.ok ? 'text-emerald-700' : 'text-rose-700'}`}
                        >
                          {rowFeedback.text}
                        </p>
                      ) : null}
                    </td>
                    <td className="max-w-[220px] px-4 py-3 text-xs text-slate-700">
                      <span className="line-clamp-2 font-medium text-slate-800">{r.right_protected}</span>
                      {r.summary?.trim() && r.summary !== 'Sin resumen automático.' ? (
                        <span className="mt-1 line-clamp-2 block text-[10px] leading-snug text-slate-500">
                          {r.summary}
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[160px] px-4 py-3 text-xs text-slate-600">
                      <span className="line-clamp-2">
                        {listTab === 'jurisprudencia' ? r.source_corporation || '—' : r.defendant}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-800">{r.ruling_sense}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      {formatFalloDate(r.decision_date)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-1.5">
                        {r.source_storage_path ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPdfPreview({
                                id: r.id,
                                radicado: r.radicado,
                                ruling_sense: r.ruling_sense,
                                right_protected: r.right_protected,
                                source_storage_path: r.source_storage_path,
                              })
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-900 hover:bg-violet-100"
                          >
                            <FileText className="h-3.5 w-3.5" aria-hidden />
                            Ver PDF
                          </button>
                        ) : (
                          <>
                            <span className="text-[10px] text-slate-500">Sin PDF guardado</span>
                            <button
                              type="button"
                              disabled={attachPdfBusyId === r.id}
                              onClick={() => promptAttachPdf(r.id)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 hover:text-accent hover:underline disabled:opacity-50"
                            >
                              {attachPdfBusyId === r.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                              ) : (
                                <Upload className="h-3 w-3" aria-hidden />
                              )}
                              Adjuntar PDF
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <ListPagination
              page={listPage}
              pageSize={listPageSize}
              total={listTotal}
              onPageChange={setListPage}
              onPageSizeChange={(size) => {
                setListPageSize(size);
                setListPage(1);
              }}
            />
          </>
        )}
      </section>

      <section className="card-modern overflow-hidden border border-emerald-100 bg-emerald-50/20 p-6 shadow-sm sm:p-8">
        <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-900">
          <PlusCircle className="h-4 w-4 text-emerald-700" aria-hidden />
          Agregar jurisprudencia de referencia
        </h2>
        <form onSubmit={(e) => void submitJurisprudencia(e)} className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-700">Corporación</span>
            <select
              className="input-modern text-sm"
              value={jCorp}
              onChange={(e) => setJCorp(e.target.value)}
            >
              {CORPORACIONES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {jCorp === '__otra__' ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-slate-700">Nombre de la corporación</span>
              <input
                className="input-modern text-sm"
                value={jCorpOtra}
                onChange={(e) => setJCorpOtra(e.target.value)}
                placeholder="Ej. Tribunal Superior de Medellín"
              />
            </label>
          ) : (
            <div className="hidden sm:block" aria-hidden />
          )}
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold text-slate-700">Radicado o referencia</span>
            <input
              className="input-modern text-sm"
              value={jRadicado}
              onChange={(e) => setJRadicado(e.target.value)}
              placeholder="Ej. T-760/08, SU-062/18"
              required
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold text-slate-700">Derecho tutelado / materia</span>
            <textarea
              className="input-modern min-h-[72px] resize-y text-sm"
              value={jDerecho}
              onChange={(e) => setJDerecho(e.target.value)}
              rows={3}
              required
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold text-slate-700">Resumen ejecutivo</span>
            <textarea
              className="input-modern min-h-[88px] resize-y text-sm"
              value={jResumen}
              onChange={(e) => setJResumen(e.target.value)}
              rows={4}
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold text-slate-700">Argumentos principales</span>
            <textarea
              className="input-modern min-h-[88px] resize-y text-sm"
              value={jArgumentos}
              onChange={(e) => setJArgumentos(e.target.value)}
              rows={4}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-700">Fecha de la sentencia</span>
            <input type="date" className="input-modern text-sm" value={jFecha} onChange={(e) => setJFecha(e.target.value)} />
          </label>
          <div className="flex flex-col justify-end gap-2 sm:col-span-2 sm:flex-row sm:items-center">
            <button
              type="submit"
              disabled={jSaving}
              className="btn-primary inline-flex items-center justify-center gap-2 bg-emerald-700 px-6 py-2.5 text-xs hover:bg-emerald-800 disabled:opacity-50"
            >
              {jSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Guardar e indexar
            </button>
            {jMsg ? (
              <p className={`text-xs font-medium ${jMsg.includes('correctamente') ? 'text-emerald-800' : 'text-amber-900'}`}>
                {jMsg}
              </p>
            ) : null}
          </div>
        </form>
      </section>

      {pdfPreview?.source_storage_path ? (
        <PrecedentPdfPreviewModal
          precedentId={pdfPreview.id}
          radicado={pdfPreview.radicado}
          rulingSense={pdfPreview.ruling_sense}
          rightProtected={pdfPreview.right_protected}
          fetchPdfUrl={fetchPdfUrlStable}
          onClose={() => setPdfPreview(null)}
          onOpenNewTab={openPrecedentPdfInNewTab}
        />
      ) : null}
    </div>
  );
}
