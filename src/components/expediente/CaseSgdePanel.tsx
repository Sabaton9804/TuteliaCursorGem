import React, { useCallback, useState } from 'react';
import { ExternalLink, FolderTree, Loader2, Link2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { apiUrl } from '../../lib/api-base';
import type { Case } from '../../types';

export type SgdeTreeNodeJson = {
  id: string;
  name: string;
  isFolder: boolean;
  tipoDocumental?: string;
  orden?: string;
  children?: SgdeTreeNodeJson[];
};

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function TreeBranch({ node, depth }: { node: SgdeTreeNodeJson; depth: number }): React.ReactElement {
  const pad = Math.min(depth, 12) * 12;
  const meta =
    [node.tipoDocumental, node.orden].filter(Boolean).join(' · ') || null;
  if (node.isFolder && (node.children?.length ?? 0) > 0) {
    return (
      <li className="list-none">
        <details className="group border-b border-slate-50 last:border-0" open={depth < 2}>
          <summary
            className="cursor-pointer list-none py-2 pr-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50/80 [&::-webkit-details-marker]:hidden"
            style={{ paddingLeft: pad }}
          >
            <span className="inline-flex items-center gap-2">
              <span className="text-slate-400 transition-transform group-open:rotate-90">▸</span>
              <FolderTree className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
              <span className="break-words">{node.name}</span>
            </span>
          </summary>
          <ul className="pb-1">
            {node.children.map((ch) => (
              <TreeBranch key={ch.id} node={ch} depth={depth + 1} />
            ))}
          </ul>
        </details>
      </li>
    );
  }
  if (node.isFolder) {
    return (
      <li className="list-none border-b border-slate-50 py-2 text-sm last:border-0" style={{ paddingLeft: pad }}>
        <span className="inline-flex items-center gap-2 font-medium text-slate-700">
          <FolderTree className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
          {node.name}
          <span className="text-[11px] font-normal text-slate-400">(carpeta vacía)</span>
        </span>
      </li>
    );
  }
  return (
    <li className="list-none border-b border-slate-50 py-2 text-sm text-slate-600 last:border-0" style={{ paddingLeft: pad }}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 break-words">
        <span className="font-medium text-slate-800">{node.name}</span>
        {meta ? <span className="text-[11px] text-slate-400">{meta}</span> : null}
      </div>
    </li>
  );
}

export type CaseSgdePanelProps = {
  caseId: string;
  caseItem: Case;
  onRefetchCase: () => void | Promise<void>;
};

export function CaseSgdePanel({ caseId, caseItem, onRefetchCase }: CaseSgdePanelProps) {
  const [tree, setTree] = useState<SgdeTreeNodeJson | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);
  const [portalBase, setPortalBase] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);

  const loadTree = useCallback(async () => {
    setErr(null);
    setNotFoundMsg(null);
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/sgde/case-tree'), {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ caseId }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
        code?: string;
      };
      if (!res.ok) {
        const msg = String(body.error || res.statusText || 'Error al consultar SGDE');
        setErr(
          body.code === 'USER_NOT_CONFIGURED'
            ? `${msg} Configure sus credenciales en Ajustes → Interconexión SGDE.`
            : msg
        );
        setTree(null);
        setRootId(null);
        return;
      }
      if (body.portalBaseUrl) setPortalBase(String(body.portalBaseUrl));
      if (body.ok === false) {
        setNotFoundMsg(String(body.message || 'No se pudo resolver el expediente en SGDE.'));
        setTree(null);
        setRootId(null);
        return;
      }
      const t = body.tree as SgdeTreeNodeJson | undefined;
      const rid = String(body.rootId || '').trim();
      if (t && rid) {
        setTree(t);
        setRootId(rid);
      } else {
        setErr('Respuesta inesperada del servidor SGDE.');
        setTree(null);
        setRootId(null);
      }
    } catch (e) {
      setErr(String(e));
      setTree(null);
      setRootId(null);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  const linkCase = useCallback(async () => {
    setErr(null);
    setLinking(true);
    try {
      const res = await fetch(apiUrl('/api/sgde/link'), {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ caseId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; sgdeId?: string };
      if (!res.ok) {
        setErr(body.error || res.statusText || 'No se pudo vincular');
        return;
      }
      await onRefetchCase();
      await loadTree();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLinking(false);
    }
  }, [caseId, loadTree, onRefetchCase]);

  const portalFicheros =
    portalBase && rootId ? `${portalBase.replace(/\/$/, '')}/expedientes/add-ficheros/${encodeURIComponent(rootId)}` : '';

  return (
    <div className="card-modern w-full min-w-0 overflow-hidden p-6 md:p-8">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
            <FolderTree className="h-4 w-4 text-emerald-600" aria-hidden />
            Expediente en SGDE (solo lectura)
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            Vista del árbol documental en el gestor institucional. El expediente digital de Jurion (cuadernos y piezas
            subidas aquí) permanece arriba.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadTree()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refrescar
          </button>
          {!caseItem.sgdeId?.trim() ? (
            <button
              type="button"
              onClick={() => void linkCase()}
              disabled={linking || loading}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              Vincular por radicado
            </button>
          ) : null}
          {portalFicheros ? (
            <a
              href={portalFicheros}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-100"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Portal SGDE
            </a>
          ) : null}
        </div>
      </div>

      <div className="pt-4">
        {err ? (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
            {err}
          </div>
        ) : null}
        {notFoundMsg && !err ? (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900">
            {notFoundMsg}
            {!caseItem.sgdeId?.trim() ? (
              <span className="mt-2 block text-[11px] text-amber-800/90">
                Puede intentar «Vincular por radicado» si el expediente existe en SGDE con el mismo número.
              </span>
            ) : null}
          </div>
        ) : null}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-3 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs font-medium">Actualizando SGDE…</span>
          </div>
        ) : null}
        {tree && !loading ? (
          <ul className="max-h-[min(70vh,520px)] overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/40 px-2 py-1">
            <TreeBranch node={tree} depth={0} />
          </ul>
        ) : null}
        {!loading && !tree && !err && !notFoundMsg ? (
          <p className="py-8 text-center text-xs text-slate-400">
            Pulse «Refrescar» para cargar el árbol desde SGDE (requiere interconexión configurada en el servidor).
          </p>
        ) : null}
      </div>
    </div>
  );
}
