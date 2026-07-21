import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderTree,
  Link2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ensureSupabaseSessionForWrites } from '../../lib/supabase-write-auth';
import type { Case } from '../../types';
import { sgdeCreateExpediente, sgdeProbeSegundaWrite, sgdeSyncDocuments, sgdeRepairStorage, type SgdeSyncDocumentsResult } from '../../lib/sgde-api';
import {
  DOCUMENT_SGDE_SYNC_LABELS,
  DOCUMENT_SGDE_SYNC_STYLES,
  caseSgdeLinkLabel,
  caseSgdeLinkStatus,
  countDocumentSyncSummary,
  documentSgdeSyncStatus,
} from '../../lib/expediente-sgde-sync';
import type { Document } from '../../types';
import { expedientePiezasParaLista } from '../../lib/expediente-viewer-doc';
import { isSgdeAutoCreateCaseType } from '../../lib/sgde-case-scope';
import type { SgdeTreeNodeJson } from './CaseSgdePanel';

async function authHeaders(): Promise<HeadersInit> {
  await ensureSupabaseSessionForWrites();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('Inicie sesión en Tutelia para usar SGDE.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function reportSyncFeedback(
  report: SgdeSyncDocumentsResult,
  setSyncReport: (r: SgdeSyncDocumentsResult) => void,
  setSyncOpen: (o: boolean) => void,
  setErr: (e: string | null) => void,
) {
  setSyncReport(report);
  setSyncOpen(true);
  if (!report.ok || report.uploadFailed > 0 || (report.errors?.length ?? 0) > 0) {
    const detail = report.errors?.[0]?.trim();
    setErr(detail || report.message || 'No se pudieron subir todas las piezas a SGDE.');
  } else {
    setErr(null);
  }
}

function SgdeTreeMini({ node, depth }: { node: SgdeTreeNodeJson; depth: number }) {
  const pad = Math.min(depth, 8) * 10;
  if (node.isFolder && (node.children?.length ?? 0) > 0) {
    return (
      <li className="list-none">
        <details className="group" open={depth < 1}>
          <summary
            className="cursor-pointer list-none py-1 text-[11px] text-slate-700 hover:text-slate-900 [&::-webkit-details-marker]:hidden"
            style={{ paddingLeft: pad }}
          >
            <span className="inline-flex items-center gap-1">
              <ChevronRight className="h-3 w-3 shrink-0 text-slate-400 group-open:rotate-90" />
              <FolderTree className="h-3 w-3 text-emerald-600" />
              <span className="truncate">{node.name}</span>
            </span>
          </summary>
          <ul>
            {node.children!.map((ch) => (
              <SgdeTreeMini key={ch.id} node={ch} depth={depth + 1} />
            ))}
          </ul>
        </details>
      </li>
    );
  }
  if (node.isFolder) {
    return (
      <li className="list-none py-0.5 text-[11px] text-slate-500" style={{ paddingLeft: pad }}>
        <FolderTree className="mr-1 inline h-3 w-3 text-emerald-600" />
        {node.name}
      </li>
    );
  }
  return (
    <li className="list-none py-0.5 text-[11px] text-slate-600" style={{ paddingLeft: pad + 14 }}>
      <span className="truncate">{node.name}</span>
    </li>
  );
}

function SyncDocGroup({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { name: string; detail?: string; status: 'linked' | 'local_only' | 'sgde_only' }[];
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-[11px] text-slate-400">{empty}</p>
      ) : (
        <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
          {items.map((it, i) => (
            <li
              key={`${it.name}-${i}`}
              className={`flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-[11px] ${DOCUMENT_SGDE_SYNC_STYLES[it.status]}`}
            >
              <span className="min-w-0 font-medium">{it.name}</span>
              <span className="shrink-0 text-[9px] font-bold uppercase">{DOCUMENT_SGDE_SYNC_LABELS[it.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type ExpedienteSgdeBarProps = {
  caseId: string;
  caseItem: Case;
  docs: Document[];
  onRefetchCase: () => void | Promise<void>;
  /** Árbol SGDE visible debajo de la barra (panel lateral). */
  treeOpen?: boolean;
  onTreeOpenChange?: (open: boolean) => void;
};

export function ExpedienteSgdeBar({
  caseId,
  caseItem,
  docs,
  onRefetchCase,
  treeOpen: treeOpenProp,
  onTreeOpenChange,
}: ExpedienteSgdeBarProps) {
  const [treeOpenInternal, setTreeOpenInternal] = useState(false);
  const treeOpen = treeOpenProp ?? treeOpenInternal;
  const setTreeOpen = onTreeOpenChange ?? setTreeOpenInternal;

  const [tree, setTree] = useState<SgdeTreeNodeJson | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);
  const [portalBase, setPortalBase] = useState('');
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [syncReport, setSyncReport] = useState<SgdeSyncDocumentsResult | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [segundaWriteBlocked, setSegundaWriteBlocked] = useState<string | null>(null);
  const [probingWrite, setProbingWrite] = useState(false);

  const linkStatus = caseSgdeLinkStatus(caseItem);
  const syncSummary = countDocumentSyncSummary(docs);
  const piezasCount = expedientePiezasParaLista(docs).length;

  const loadTree = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch('/api/sgde/case-tree', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ caseId }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
        code?: string;
      };
      if (!res.ok) {
        setErr(
          body.code === 'USER_NOT_CONFIGURED'
            ? `${String(body.error || '')} Configure credenciales en Ajustes → Interconexión SGDE.`
            : String(body.error || res.statusText)
        );
        setTree(null);
        return;
      }
      if (body.portalBaseUrl) setPortalBase(String(body.portalBaseUrl));
      if (body.ok === false) {
        setErr(String(body.message || 'Expediente no encontrado en SGDE.'));
        setTree(null);
        return;
      }
      const t = body.tree as SgdeTreeNodeJson | undefined;
      const rid = String(body.rootId || '').trim();
      if (t && rid) {
        setTree(t);
        setRootId(rid);
        setTreeOpen(true);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [caseId, setTreeOpen]);

  const linkCase = useCallback(async () => {
    setLinking(true);
    setErr(null);
    try {
      const res = await fetch('/api/sgde/link', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ caseId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(body.error || 'No se pudo vincular');
        return;
      }
      await onRefetchCase();
      await loadTree();
      try {
        const report = await sgdeSyncDocuments({ caseId, uploadMissing: true });
        reportSyncFeedback(report, setSyncReport, setSyncOpen, setErr);
        await onRefetchCase();
      } catch {
        /* sync opcional tras vincular */
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLinking(false);
    }
  }, [caseId, loadTree, onRefetchCase]);

  useEffect(() => {
    if (caseItem.caseType !== 'tutela_segunda') {
      setSegundaWriteBlocked(null);
      setProbingWrite(false);
      return;
    }
    let cancelled = false;
    setProbingWrite(true);
    void (async () => {
      try {
        const probe = await sgdeProbeSegundaWrite({ caseId });
        if (cancelled) return;
        setSegundaWriteBlocked(probe.forbidden ? probe.message : null);
      } catch {
        if (!cancelled) setSegundaWriteBlocked(null);
      } finally {
        if (!cancelled) setProbingWrite(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId, caseItem.caseType, caseItem.sgdeId]);

  const canCreateInSgde =
    isSgdeAutoCreateCaseType(caseItem.caseType) &&
    (linkStatus === 'unlinked' || caseItem.sgdeSyncStatus === 'error');

  const createInSgde = useCallback(async () => {
    setCreating(true);
    setErr(null);
    try {
      await sgdeCreateExpediente({ caseId, uploadDocuments: true });
      await onRefetchCase();
      await loadTree();
      const report = await sgdeSyncDocuments({ caseId, uploadMissing: true });
      reportSyncFeedback(report, setSyncReport, setSyncOpen, setErr);
      await onRefetchCase();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [caseId, loadTree, onRefetchCase]);

  const syncWithSgde = useCallback(async () => {
    setSyncing(true);
    setErr(null);
    try {
      const report = await sgdeSyncDocuments({ caseId, uploadMissing: true });
      reportSyncFeedback(report, setSyncReport, setSyncOpen, setErr);
      await onRefetchCase();
      await loadTree();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [caseId, loadTree, onRefetchCase]);

  const repairFromSgde = useCallback(async () => {
    setRepairing(true);
    setErr(null);
    try {
      const res = await sgdeRepairStorage({ caseId, importSgdeOnly: true });
      setSyncReport({
        ok: res.ok,
        linked: 0,
        localOnly: 0,
        sgdeOnly: 0,
        uploaded: 0,
        uploadFailed: 0,
        repaired: res.repaired,
        imported: res.imported,
        repairFailed: res.failed,
        items: [],
        sgdeOnlyItems: [],
        errors: res.errors,
        message: res.message,
        sgdeRootId: caseItem.sgdeId || '',
      });
      setSyncOpen(true);
      await onRefetchCase();
      await loadTree();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRepairing(false);
    }
  }, [caseId, caseItem.sgdeId, loadTree, onRefetchCase]);

  const linkedDocs = docs.filter((d) => documentSgdeSyncStatus(d) === 'linked');
  const localOnlyDocs = docs.filter((d) => documentSgdeSyncStatus(d) === 'local_only');
  const showSgdeBadges = Boolean(caseItem.sgdeId?.trim()) || linkStatus !== 'unlinked';

  const portalUrl =
    portalBase && rootId
      ? `${portalBase.replace(/\/$/, '')}/expedientes/add-ficheros/${encodeURIComponent(rootId)}`
      : caseItem.sgdeId?.trim() && portalBase
        ? `${portalBase.replace(/\/$/, '')}/expedientes/add-ficheros/${encodeURIComponent(caseItem.sgdeId.trim())}`
        : '';

  const dotClass =
    linkStatus === 'linked'
      ? 'bg-emerald-500'
      : linkStatus === 'stale'
        ? 'bg-amber-500'
        : 'bg-slate-300';

  return (
    <div className="rounded-xl border border-slate-200/80 bg-gradient-to-r from-slate-50/90 to-emerald-50/30 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              Expediente electrónico
            </p>
            <p className="text-sm font-semibold text-slate-800">{caseSgdeLinkLabel(linkStatus)}</p>
            <p className="text-[11px] text-slate-500">
              {piezasCount} pieza{piezasCount === 1 ? '' : 's'}
              {syncSummary.linked > 0 ? ` · ${syncSummary.linked} sincronizadas` : ''}
              {syncSummary.localOnly > 0 ? ` · ${syncSummary.localOnly} pendientes Tutelia→SGDE` : ''}
              {syncReport && syncReport.sgdeOnly > 0 ? ` · ${syncReport.sgdeOnly} solo SGDE` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreateInSgde ? (
            <button
              type="button"
              onClick={() => void createInSgde()}
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-900 hover:bg-violet-100 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              {caseItem.sgdeSyncStatus === 'error' ? 'Reintentar SGDE' : 'Crear en SGDE'}
            </button>
          ) : null}
          {linkStatus === 'unlinked' && !canCreateInSgde ? (
            <button
              type="button"
              onClick={() => void linkCase()}
              disabled={linking}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              Vincular SGDE
            </button>
          ) : null}
          {linkStatus !== 'unlinked' ? (
            <>
            <button
              type="button"
              onClick={() => void repairFromSgde()}
              disabled={repairing || syncing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-900 hover:bg-violet-100 disabled:opacity-50"
            >
              {repairing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Reparar PDF
            </button>
            <button
              type="button"
              onClick={() => void syncWithSgde()}
              disabled={syncing}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide disabled:opacity-50 ${
                localOnlyDocs.length > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100'
                  : 'border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100'
              }`}
              title={
                localOnlyDocs.length > 0
                  ? `Sube a SGDE las ${localOnlyDocs.length} pieza(s) «Solo Tutelia» (p. ej. informe de ingreso) y alinea el expediente`
                  : 'Sincronizar piezas con SGDE'
              }
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {localOnlyDocs.length > 0
                ? `Enviar ${localOnlyDocs.length} a SGDE`
                : 'Sincronizar'}
            </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => void loadTree()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {tree ? 'Actualizar árbol' : 'Ver en SGDE'}
          </button>
          {portalUrl ? (
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Portal
            </a>
          ) : null}
          {tree ? (
            <button
              type="button"
              onClick={() => setTreeOpen(!treeOpen)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-slate-500 hover:bg-white/80"
            >
              {treeOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Árbol SGDE
            </button>
          ) : null}
          {(syncReport || showSgdeBadges) ? (
            <button
              type="button"
              onClick={() => setSyncOpen(!syncOpen)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-slate-500 hover:bg-white/80"
            >
              {syncOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Estado sync
            </button>
          ) : null}
        </div>
      </div>

      {caseItem.caseType === 'tutela_segunda' && probingWrite ? (
        <p className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Comprobando permisos de escritura en SGDE…
        </p>
      ) : null}

      {segundaWriteBlocked ? (
        <div className="mt-2 rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2.5 text-[11px] text-red-950">
          <p className="font-bold flex items-center gap-1.5 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Expediente compartido sin edición
          </p>
          <p className="mt-1.5 leading-relaxed">{segundaWriteBlocked}</p>
        </div>
      ) : null}

      {syncReport?.message ? (
        <p
          className={`mt-2 text-[11px] font-medium ${
            syncReport.uploadFailed > 0 || (syncReport.errors?.length ?? 0) > 0
              ? 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950'
              : 'text-slate-600'
          }`}
        >
          {syncReport.message}
        </p>
      ) : null}

      {caseItem.sgdeSyncStatus === 'error' && !syncReport?.message ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
          La última sincronización con SGDE falló. Pulse «Enviar a SGDE» y revise el detalle en Estado sync.
        </p>
      ) : null}

      {err ? (
        <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          {err}
        </p>
      ) : null}

      {syncOpen && showSgdeBadges ? (
        <div className="mt-3 space-y-3 rounded-lg border border-slate-100 bg-white/90 p-3">
          {(syncReport?.errors?.length ?? 0) > 0 ? (
            <ul className="max-h-24 space-y-1 overflow-y-auto rounded-md border border-red-100 bg-red-50 px-2 py-1.5 text-[11px] text-red-900">
              {syncReport!.errors!.map((line, i) => (
                <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
              ))}
            </ul>
          ) : null}
          <SyncDocGroup
            title="Sincronizados (Tutelia + SGDE)"
            empty="Ninguno todavía. Pulse Sincronizar."
            items={linkedDocs.map((d) => ({
              name: d.name,
              detail: d.sgdeFolderPath,
              status: 'linked' as const,
            }))}
          />
          <SyncDocGroup
            title="Pendientes — solo en Tutelia"
            empty="Todo lo local con PDF ya está en SGDE."
            items={localOnlyDocs.map((d) => ({
              name: d.name,
              detail: d.storagePath ? 'PDF en Storage' : 'Sin PDF',
              status: 'local_only' as const,
            }))}
          />
          <SyncDocGroup
            title="Solo en SGDE (no en Tutelia)"
            empty="No hay documentos en SGDE sin pareja local."
            items={(syncReport?.sgdeOnlyItems ?? []).map((it) => ({
              name: it.name,
              detail: it.sgdeFolderPath,
              status: 'sgde_only' as const,
            }))}
          />
        </div>
      ) : null}

      {tree && treeOpen ? (
        <ul className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-slate-100 bg-white/80 px-2 py-1">
          <SgdeTreeMini node={tree} depth={0} />
        </ul>
      ) : null}
    </div>
  );
}
