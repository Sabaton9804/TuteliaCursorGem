import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FolderTree, Loader2, Search } from 'lucide-react';

type SgdeStatus = {
  enabled?: boolean;
  configured?: boolean;
  message?: string;
};

/** SGDE se consulta y vincula por expediente (pestaña en detalle), no como proceso aparte. */
export default function SgdeSync() {
  const [status, setStatus] = useState<SgdeStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/sgde/status');
        const j = (await res.json().catch(() => ({}))) as SgdeStatus;
        if (!cancelled) setStatus(j);
      } catch {
        if (!cancelled) setStatus({ enabled: false, message: 'No se pudo consultar el estado del servidor.' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sincronización SGDE</h1>
        <p className="text-sm leading-relaxed text-slate-600">
          El árbol documental y la vinculación por radicado se gestionan dentro de cada expediente. No se abre un proceso
          nuevo en SGDE desde esta pantalla.
        </p>
      </header>

      <div className="card-modern space-y-3 border border-slate-100 p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Estado del conector (servidor)</p>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Consultando…
          </p>
        ) : (
          <p className="text-sm text-slate-700">
            {status?.enabled
              ? 'SGDE habilitado. Configure su usuario en Ajustes → Interconexión SGDE.'
              : status?.message || 'SGDE no disponible. Revise Ajustes o contacte al administrador (SGDE_CREDENTIALS_KEY).'}
          </p>
        )}
        <Link
          to="/settings"
          className="inline-flex items-center gap-2 text-xs font-semibold text-accent hover:underline"
        >
          Configuración del despacho
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <div className="card-modern space-y-4 border border-emerald-100 bg-emerald-50/40 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
          <FolderTree className="h-4 w-4 shrink-0" aria-hidden />
          Cómo vincular un expediente
        </p>
        <ol className="list-inside list-decimal space-y-2 text-sm text-slate-700">
          <li>
            Abra <Link to="/cases" className="font-semibold text-accent hover:underline">Expedientes</Link> y entre al
            detalle.
          </li>
          <li>Use la pestaña SGDE en el expediente para consultar el árbol y guardar el enlace.</li>
          <li>El identificador queda en el caso para consultas posteriores.</li>
        </ol>
        <Link to="/cases" className="btn-primary inline-flex items-center gap-2 text-xs">
          <Search className="h-4 w-4" aria-hidden />
          Ir a expedientes
        </Link>
      </div>
    </div>
  );
}
