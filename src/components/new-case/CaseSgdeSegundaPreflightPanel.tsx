import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, CloudDownload, Loader2, RefreshCw } from 'lucide-react';
import {
  SGDE_RECOMMENDED_LABELS,
  sgdePreflightOrigin,
  type SgdePreflightResult,
} from '../../lib/sgde-api';
import { extractSgdeNodeIdFromText } from '../../lib/segunda-instancia-email';

function normalizeNodeIdInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  return extractSgdeNodeIdFromText(t) || (/^[0-9a-f-]{36}$/i.test(t) ? t.toLowerCase() : null);
}

type Props = {
  originRadicado: string;
  sgdeNodeIdHint?: string | null;
  disabled?: boolean;
  onPreflightChange?: (result: SgdePreflightResult | null) => void;
};

export function CaseSgdeSegundaPreflightPanel({
  originRadicado,
  sgdeNodeIdHint,
  disabled,
  onPreflightChange,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SgdePreflightResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manualNodeId, setManualNodeId] = useState('');

  const effectiveNodeHint =
    normalizeNodeIdInput(manualNodeId) || normalizeNodeIdInput(sgdeNodeIdHint || '') || null;

  const run = useCallback(async () => {
    const digits = originRadicado.replace(/\D/g, '');
    if (digits.length !== 23) {
      setResult(null);
      setErr('Indique el radicado de origen de 23 dígitos para consultar SGDE.');
      onPreflightChange?.(null);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const r = await sgdePreflightOrigin(digits, effectiveNodeHint);
      setResult(r);
      onPreflightChange?.(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al consultar SGDE.';
      setErr(msg);
      setResult(
        /Ajustes/i.test(msg)
          ? ({
              ok: false,
              status: 'error_login' as const,
              originRadicado: digits,
              sgdeRootId: null,
              rootName: null,
              pdfCount: 0,
              recommendedFound: [],
              recommendedMissing: [],
              sampleFiles: [],
              message: msg,
              code: 'USER_NOT_CONFIGURED',
            })
          : null
      );
      onPreflightChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [originRadicado, effectiveNodeHint, onPreflightChange]);

  useEffect(() => {
    const digits = originRadicado.replace(/\D/g, '');
    if (digits.length !== 23) {
      setResult(null);
      return;
    }
    const t = window.setTimeout(() => void run(), 600);
    return () => window.clearTimeout(t);
  }, [originRadicado, effectiveNodeHint, run]);

  const statusBox =
    result?.status === 'listo'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
      : result?.status === 'incompleto' || result?.status === 'solo_compartidos'
        ? 'border-amber-200 bg-amber-50 text-amber-950'
        : 'border-red-200 bg-red-50 text-red-950';

  return (
    <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">
            Traslado digital (SGDE)
          </p>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            En SGDE el expediente son carpetas (Primera Instancia, cuadernos 01CdoPrincipal, etc.) y los PDF van
            dentro. Tutelia recorre esas carpetas si localiza el nodo del CUI.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void run()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-800 hover:bg-violet-50 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Actualizar
        </button>
      </div>

      {err ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {err}
          {result?.code === 'USER_NOT_CONFIGURED' || /Ajustes/i.test(err) ? (
            <Link to="/settings" className="font-bold underline text-violet-800">
              Ir a Ajustes → SGDE
            </Link>
          ) : null}
        </p>
      ) : null}

      {loading && !result ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Consultando SGDE…
        </p>
      ) : null}

      {result ? (
        <div className={`rounded-xl border px-4 py-3 text-xs space-y-2 ${statusBox}`}>
          <p className="font-semibold flex items-center gap-2">
            {result.status === 'listo' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {result.message}
          </p>
          {result.rootName ? (
            <p>
              <span className="font-bold">Expediente SGDE:</span> {result.rootName}
            </p>
          ) : null}
          {result.status === 'solo_compartidos' ? (
            <p className="text-[11px] leading-relaxed opacity-90">
              Si en SGDE ya ve el CUI en Mis compartidos → Con el despacho, pulse Actualizar (Tutelia consulta la misma
              API del portal). Si el correo de reparto trae enlace a SGDE, no necesita copiar nada manualmente. Solo si
              sigue sin enlazar: abra el expediente en SGDE, copie el enlace de la barra del navegador y péguelo abajo.
            </p>
          ) : (
            <>
              <p>
                <span className="font-bold">PDFs detectados:</span> {result.pdfCount}
              </p>
              {result.recommendedMissing.length > 0 ? (
                <p>
                  <span className="font-bold">Faltan recomendados:</span>{' '}
                  {result.recommendedMissing.map((k) => SGDE_RECOMMENDED_LABELS[k] || k).join('; ')}
                </p>
              ) : null}
            </>
          )}
          {result.sampleFiles.length > 0 ? (
            <ul className="list-disc list-inside text-[11px] opacity-90 max-h-24 overflow-y-auto">
              {result.sampleFiles.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
          {result.status === 'solo_compartidos' && result.portalBaseUrl ? (
            <p>
              <a
                href={`${result.portalBaseUrl.replace(/\/$/, '')}/#/mis-compartidos`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold underline"
              >
                Abrir SGDE → Mis compartidos
              </a>
              {sgdeNodeIdHint ? (
                <span className="block mt-1 text-[10px] opacity-80">
                  Enlace del correo detectado; si el preflight sigue vacío, abra el expediente en SGDE y vuelva a Actualizar.
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-violet-100 bg-white/80 px-3 py-2.5 space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-widest text-violet-800">
          Enlace o ID SGDE (solo si Actualizar no enlazó)
        </label>
        <input
          type="text"
          value={manualNodeId}
          onChange={(e) => setManualNodeId(e.target.value)}
          disabled={disabled || loading}
          placeholder="Pegue el enlace al abrir el CUI en SGDE, o el UUID si se lo indicó soporte"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-800 placeholder:text-slate-400 disabled:opacity-50"
        />
        {effectiveNodeHint ? (
          <p className="text-[10px] text-emerald-800">UUID listo para consulta: {effectiveNodeHint.slice(0, 8)}…</p>
        ) : null}
      </div>

      <p className="flex items-center gap-1.5 text-[10px] text-slate-500">
        <CloudDownload className="h-3.5 w-3.5" aria-hidden />
        Tras radicar, los PDF de SGDE se copiarán automáticamente al cuaderno de segunda instancia (si el traslado está
        listo).
      </p>
    </div>
  );
}
