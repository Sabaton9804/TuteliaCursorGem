import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Loader2, Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatRadicado } from '../../lib/formatters';
import type { CaseType } from '../../types';

type SearchRow = {
  id: string;
  radicado: string;
  claimant: string;
  defendant: string;
  legalDerecho: string | null;
  caseType: CaseType | undefined;
  status: string;
  deadlineAt: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  received: 'Recibido',
  admitted: 'Admitido',
  transfer: 'Traslado',
  judgment: 'Fallo',
  archived: 'Archivado',
};

function caseTypeBadge(caseType: CaseType | undefined): { label: string; className: string } {
  switch (caseType) {
    case 'tutela_segunda':
      return { label: 'Segunda', className: 'bg-violet-100 text-violet-900 border-violet-200' };
    case 'consulta_desacato':
      return { label: 'Consulta', className: 'bg-amber-100 text-amber-950 border-amber-200' };
    default:
      return { label: 'Primera', className: 'bg-sky-100 text-sky-900 border-sky-200' };
  }
}

function escapeIlike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Urgencia por plazo: vencido o vence en ≤2 días (calendario). */
function deadlineUrgency(deadlineIso: string | null): 'overdue' | 'soon' | null {
  if (!deadlineIso?.trim()) return null;
  const d = parseISO(deadlineIso);
  if (!isValid(d)) return null;
  const now = new Date();
  const endInTwoDays = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 23, 59, 59, 999);
  if (d.getTime() < now.getTime()) return 'overdue';
  if (d.getTime() <= endInTwoDays.getTime()) return 'soon';
  return null;
}

function parseCaseType(v: unknown): CaseType | undefined {
  if (v === 'tutela_primera' || v === 'tutela_segunda' || v === 'consulta_desacato') return v;
  return undefined;
}

type Props = {
  courtId: string | undefined;
};

export function GlobalSearch({ courtId }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  openRef.current = open;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setDebounced('');
      setRows([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      setDebounced(q);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const runSearch = useCallback(async (q: string) => {
    const cid = courtId?.trim();
    if (!cid || !q) {
      setRows([]);
      setSearched(!!q);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const raw = q.slice(0, 80).replace(/,/g, ' ').trim();
      const esc = escapeIlike(raw);
      const wild = `%${esc}%`;
      const orClause = [
        `radicado.ilike.${wild}`,
        `claimant.ilike.${wild}`,
        `defendant.ilike.${wild}`,
        `legal_derecho_tutelado.ilike.${wild}`,
      ].join(',');
      const { data, error } = await supabase
        .from('cases')
        .select('id, radicado, claimant, defendant, legal_derecho_tutelado, case_type, status, deadline_at')
        .eq('court_id', cid)
        .or(orClause)
        .order('updated_at', { ascending: false })
        .limit(8);
      if (error) throw error;
      setRows(
        (data ?? []).map((r) => {
          const rec = r as Record<string, unknown>;
          return {
            id: String(rec.id),
            radicado: String(rec.radicado ?? ''),
            claimant: String(rec.claimant ?? ''),
            defendant: String(rec.defendant ?? ''),
            legalDerecho: rec.legal_derecho_tutelado ? String(rec.legal_derecho_tutelado) : null,
            caseType: parseCaseType(rec.case_type),
            status: String(rec.status ?? ''),
            deadlineAt:
              typeof rec.deadline_at === 'string' ? rec.deadline_at : rec.deadline_at ? String(rec.deadline_at) : null,
          };
        }),
      );
    } catch (e) {
      console.error('global search:', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [courtId]);

  useEffect(() => {
    if (!debounced) {
      setRows([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    void runSearch(debounced);
  }, [debounced, runSearch]);

  const openSearch = useCallback(() => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery('');
    setDebounced('');
    setRows([]);
    setSearched(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    const onPalette = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return;
      const el = e.target as HTMLElement | null;
      const inOtherField =
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) &&
        el.id !== 'global-search-input';
      if (inOtherField) return;
      e.preventDefault();
      if (openRef.current) closeSearch();
      else openSearch();
    };
    window.addEventListener('keydown', onPalette);
    return () => window.removeEventListener('keydown', onPalette);
  }, [closeSearch, openSearch]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeSearch();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, closeSearch]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const goCase = (id: string) => {
    closeSearch();
    navigate(`/case/${id}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => (open ? closeSearch() : openSearch())}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-accent hover:text-accent"
        title="Buscar expedientes (Ctrl+K)"
        aria-expanded={open}
        aria-controls="global-search-dialog"
      >
        <Search className="h-5 w-5" aria-hidden />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-900/45 px-4 pt-16 sm:pt-24"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeSearch();
          }}
        >
          <div
            id="global-search-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Búsqueda global de expedientes"
            className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
              <Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              <input
                id="global-search-input"
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Radicado, demandante/accionante, demandado/accionado…"
                className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={closeSearch}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Cerrar búsqueda"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="border-b border-slate-50 px-4 py-1.5 text-[10px] text-slate-400">
              Mismo despacho · máx. 8 resultados · <kbd className="rounded bg-slate-100 px-1 font-mono">Esc</kbd> cierra ·{' '}
              <kbd className="rounded bg-slate-100 px-1 font-mono">Ctrl</kbd>+<kbd className="rounded bg-slate-100 px-1 font-mono">K</kbd>
            </p>

            <div className="max-h-[min(60vh,420px)] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin text-accent" />
                  Buscando…
                </div>
              ) : searched && debounced && rows.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm font-medium text-slate-500">
                  Sin resultados para «{debounced}»
                </p>
              ) : rows.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-slate-400">Escriba para buscar en expedientes del despacho.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const badge = caseTypeBadge(r.caseType);
                    const urg = deadlineUrgency(r.deadlineAt);
                    const dlLabel =
                      r.deadlineAt && isValid(parseISO(r.deadlineAt))
                        ? format(parseISO(r.deadlineAt), "d MMM yyyy", { locale: es })
                        : null;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => goCase(r.id)}
                          className="flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-bold text-accent">{formatRadicado(r.radicado)}</span>
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-600">
                              {STATUS_LABEL[r.status] ?? r.status}
                            </span>
                            {urg === 'overdue' ? (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-black uppercase text-red-800">
                                Plazo vencido
                              </span>
                            ) : urg === 'soon' ? (
                              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[9px] font-black uppercase text-orange-900">
                                Plazo próximo
                              </span>
                            ) : dlLabel ? (
                              <span className="text-[10px] font-medium text-slate-400">Vence {dlLabel}</span>
                            ) : null}
                          </div>
                          <p className="text-xs text-slate-700">
                            <span className="font-semibold text-slate-800">{r.claimant || '—'}</span>
                            <span className="mx-1.5 text-slate-300">vs</span>
                            <span className="font-semibold text-slate-800">{r.defendant || '—'}</span>
                          </p>
                          {r.legalDerecho ? (
                            <p className="line-clamp-2 text-[11px] leading-snug text-slate-500">{r.legalDerecho}</p>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
