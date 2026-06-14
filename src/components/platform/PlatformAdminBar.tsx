import React, { useEffect, useMemo, useState } from 'react';
import { Building2, X, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabase';

type CourtOption = {
  id: string;
  name: string;
  status: string;
};

export default function PlatformAdminBar() {
  const {
    canAccessPlatformConsole,
    isRegionalPlatformAdmin,
    regionalTerritoryIds,
    viewAsCourtId,
    needsViewAsSelection,
    setViewAsCourtId,
    activeCourtId,
  } = useTenant();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<CourtOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  const displayCourtId = viewAsCourtId ?? activeCourtId;

  useEffect(() => {
    if (!canAccessPlatformConsole || !displayCourtId) {
      setActiveLabel(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from('courts')
      .select('id, name')
      .eq('id', displayCourtId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          setActiveLabel(`${data.name} (${data.id})`);
        } else {
          setActiveLabel(displayCourtId);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessPlatformConsole, displayCourtId]);

  useEffect(() => {
    if (!open || !canAccessPlatformConsole) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        let req = supabase
          .from('courts')
          .select('id, name, status')
          .eq('status', 'active')
          .order('name')
          .limit(25);
        if (isRegionalPlatformAdmin && regionalTerritoryIds.length > 0) {
          req = req.in('territory_id', regionalTerritoryIds);
        }
        const q = query.trim();
        if (q.length > 0) {
          req = req.or(`name.ilike.%${q}%,id.ilike.%${q}%`);
        }
        const { data, error } = await req;
        if (cancelled) return;
        if (error) throw error;
        setOptions((data ?? []) as CourtOption[]);
      } catch (e) {
        console.warn('[PlatformAdminBar] search', e);
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, query, canAccessPlatformConsole, isRegionalPlatformAdmin, regionalTerritoryIds]);

  const bannerText = useMemo(() => {
    if (needsViewAsSelection) {
      return 'Modo plataforma: seleccione un despacho para operar (no se mezclan datos de todos los juzgados).';
    }
    if (viewAsCourtId) {
      return `Operando como: ${activeLabel ?? viewAsCourtId}`;
    }
    return null;
  }, [needsViewAsSelection, viewAsCourtId, activeLabel]);

  if (!canAccessPlatformConsole) return null;

  return (
    <div className="border-b border-indigo-100 bg-indigo-50/90 px-4 py-2 sm:px-6 lg:px-10 shrink-0">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2 text-indigo-900 min-w-0 flex-1">
          <Building2 className="w-4 h-4 shrink-0" aria-hidden />
          <p className="text-xs sm:text-sm font-medium truncate">
            {bannerText ?? 'Administración de plataforma'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => navigate('/plataforma')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-700 transition-colors"
          >
            Consola
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-indigo-200 text-indigo-900 text-[11px] font-bold hover:bg-indigo-50 transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            {viewAsCourtId ? 'Cambiar despacho' : 'Operar como…'}
          </button>
          {viewAsCourtId && (
            <button
              type="button"
              onClick={() => {
                void setViewAsCourtId(null);
                navigate('/');
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-800 text-[11px] font-bold hover:bg-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Salir de viewAs
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-white p-3 shadow-sm max-w-xl">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o id (court-050…)"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            autoFocus
          />
          {loading ? (
            <p className="text-xs text-slate-500 px-1 py-2">Buscando…</p>
          ) : options.length === 0 ? (
            <p className="text-xs text-slate-500 px-1 py-2">Sin resultados. Escriba para filtrar.</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto divide-y divide-slate-100">
              {options.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full text-left px-2 py-2 text-sm hover:bg-indigo-50 rounded-lg"
                    onClick={() => {
                      void setViewAsCourtId(c.id);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    <span className="font-semibold text-slate-900">{c.name}</span>
                    <span className="text-slate-500 text-xs ml-2 font-mono">{c.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
