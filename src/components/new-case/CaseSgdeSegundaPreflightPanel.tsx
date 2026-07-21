import React, { useCallback, useEffect, useState } from 'react';

import { Link } from 'react-router-dom';

import { AlertCircle, CheckCircle2, CloudDownload, Loader2, RefreshCw } from 'lucide-react';

import {

  SGDE_RECOMMENDED_LABELS,

  sgdePreflightOrigin,

  type SegundaFieldsExtract,

  type SgdePreflightResult,

} from '../../lib/sgde-api';

import { extractSgdeNodeIdFromText } from '../../lib/segunda-instancia-email';

import { SgdeDocumentTree } from './SgdeDocumentTree';
import { SgdePdfPreviewModal } from './SgdePdfPreviewModal';



function normalizeNodeIdInput(raw: string): string | null {

  const t = raw.trim();

  if (!t) return null;

  return extractSgdeNodeIdFromText(t) || (/^[0-9a-f-]{36}$/i.test(t) ? t.toLowerCase() : null);

}



function appellantLabel(v: SegundaFieldsExtract['appellant']): string {

  if (v === 'accionante') return 'Accionante';

  if (v === 'accionado') return 'Accionado';

  return '—';

}



function rulingLabel(v: SegundaFieldsExtract['originRuling']): string {

  if (v === 'concedio') return 'Concedió';

  if (v === 'nego') return 'Negó';

  return '—';

}



type Props = {

  originRadicado: string;

  sgdeNodeIdHint?: string | null;

  emailDigest?: string | null;

  disabled?: boolean;

  onPreflightChange?: (result: SgdePreflightResult | null) => void;

  onPreflightLoadingChange?: (loading: boolean) => void;

  onSegundaExtract?: (extract: SegundaFieldsExtract | null) => void;

};



export function CaseSgdeSegundaPreflightPanel({

  originRadicado,

  sgdeNodeIdHint,

  emailDigest,

  disabled,

  onPreflightChange,

  onPreflightLoadingChange,

  onSegundaExtract,

}: Props) {

  const [loading, setLoading] = useState(false);

  const [result, setResult] = useState<SgdePreflightResult | null>(null);

  const [err, setErr] = useState<string | null>(null);

  const [manualNodeId, setManualNodeId] = useState('');

  const [previewFile, setPreviewFile] = useState<{ id: string; name: string; path?: string } | null>(null);



  const effectiveNodeHint =

    normalizeNodeIdInput(manualNodeId) || normalizeNodeIdInput(sgdeNodeIdHint || '') || null;



  const run = useCallback(async () => {

    const digits = originRadicado.replace(/\D/g, '');

    if (digits.length !== 23) {

      setResult(null);

      setErr('Indique el radicado de origen de 23 dígitos para consultar SGDE.');

      onPreflightChange?.(null);

      onSegundaExtract?.(null);

      return;

    }

    setLoading(true);
    onPreflightLoadingChange?.(true);

    setErr(null);

    try {

      const r = await sgdePreflightOrigin(digits, effectiveNodeHint, emailDigest);

      setResult(r);

      onPreflightChange?.(r);

      onSegundaExtract?.(r.segundaExtract ?? null);

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

              pdfFiles: [],

              documentTree: [],

              segundaExtract: null,

              message: msg,

              code: 'USER_NOT_CONFIGURED',

            })

          : null

      );

      onPreflightChange?.(null);

      onSegundaExtract?.(null);

    } finally {

      setLoading(false);
      onPreflightLoadingChange?.(false);

    }

  }, [originRadicado, effectiveNodeHint, emailDigest, onPreflightChange, onPreflightLoadingChange, onSegundaExtract]);



  useEffect(() => {

    const digits = originRadicado.replace(/\D/g, '');

    if (digits.length !== 23) {

      setResult(null);

      setErr(null);

      onPreflightChange?.(null);

      onSegundaExtract?.(null);

      return;

    }

    setResult(null);

    setErr(null);

    onPreflightChange?.(null);

    onSegundaExtract?.(null);

    const t = window.setTimeout(() => void run(), 0);

    return () => window.clearTimeout(t);

  }, [originRadicado, effectiveNodeHint, emailDigest, run, onPreflightChange, onSegundaExtract]);



  const documentTree = result?.documentTree?.length ? result.documentTree : [];

  const extract = result?.segundaExtract;

  const extractNote =

    extract?.appellant || extract?.originRuling

      ? `IA / documentos: Impugnante ${appellantLabel(extract.appellant)} · Fallo en origen ${rulingLabel(extract.originRuling)}${

          extract.sources.length ? ` (${extract.sources.slice(0, 2).join('; ')})` : ''

        }`

      : result && result.pdfCount > 0 && !loading

        ? 'La IA no pudo completar impugnante o fallo; abra el fallo y el correo de impugnación con Ver o complételos arriba.'

        : null;



  const statusBox =

    result?.status === 'listo'

      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'

      : result?.status === 'sin_permiso_escritura'

        ? 'border-red-300 bg-red-50 text-red-950'

      : result?.status === 'incompleto' || result?.status === 'solo_compartidos'

        ? 'border-amber-200 bg-amber-50 text-amber-950'

        : result?.status === 'no_encontrado'

          ? 'border-red-200 bg-red-50 text-red-950'

          : 'border-red-200 bg-red-50 text-red-950';



  return (

    <>

      <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-5 space-y-3">

        <div className="flex items-start justify-between gap-3">

          <div>

            <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">

              Traslado digital (SGDE)

            </p>

            <p className="text-xs text-slate-600 mt-1 leading-relaxed">

              Misma jerarquía de carpetas que SGDE. La IA lee fallo e impugnación para sugerir impugnante y fallo; use Ver en cada PDF.

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



        {result?.status === 'sin_permiso_escritura' ? (
          <div className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 text-xs text-red-950 shadow-sm">
            <p className="font-bold flex items-center gap-2 text-sm">
              <AlertCircle className="h-5 w-5 shrink-0" />
              Sin permiso de edición en SGDE
            </p>
            <p className="mt-2 leading-relaxed">{result.message}</p>
            <p className="mt-2 font-semibold">
              Solicite al juzgado de primera instancia compartir el expediente con permisos de edición antes de
              subir piezas a Impugnación.
            </p>
          </div>
        ) : null}



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



        {originRadicado.replace(/\D/g, '').length === 23 ? (

          <p className="text-[10px] font-mono text-violet-900/80 break-all">

            CUI consultado: {originRadicado.replace(/\D/g, '')}

          </p>

        ) : null}



        {loading && !result ? (

          <p className="flex items-center gap-2 text-xs text-slate-500">

            <Loader2 className="h-4 w-4 animate-spin" />

            Consultando SGDE, analizando PDF con IA… (puede tardar unos segundos)

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

            {result.originRadicado ? (

              <p className="text-[10px] font-mono opacity-80 break-all">

                Resultado para CUI {result.originRadicado}

                {result.sgdeRootId ? ` · nodo ${result.sgdeRootId.slice(0, 8)}…` : ''}

              </p>

            ) : null}

            {result.rootName ? (

              <p>

                <span className="font-bold">Expediente SGDE:</span> {result.rootName}

              </p>

            ) : null}

            {extractNote ? (

              <p className="text-[11px] leading-relaxed rounded-lg bg-white/60 px-2 py-1.5 border border-violet-100/80">

                {extractNote}

              </p>

            ) : null}

            {result.status === 'solo_compartidos' || result.status === 'no_encontrado' ? (

              <p className="text-[11px] leading-relaxed opacity-90">

                Si en SGDE ya ve el CUI en la grilla principal o en Mis compartidos, abra ese expediente en el portal,

                copie el enlace de la barra del navegador y péguelo abajo; luego pulse Actualizar.

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

            {documentTree.length > 0 ? (

              <div className="rounded-lg border border-white/50 bg-white/40 max-h-56 overflow-y-auto px-2 py-2">

                <p className="pb-1 text-[10px] font-bold uppercase tracking-widest opacity-80">

                  Expediente SGDE (carpetas)

                </p>

                <SgdeDocumentTree

                  nodes={documentTree}

                  disabled={disabled || loading}

                  onPreview={(f) => setPreviewFile(f)}

                />

              </div>

            ) : result.sampleFiles.length > 0 ? (

              <ul className="list-disc list-inside text-[11px] opacity-90 max-h-24 overflow-y-auto">

                {result.sampleFiles.map((f) => (

                  <li key={f}>{f}</li>

                ))}

              </ul>

            ) : null}

            {(result.status === 'solo_compartidos' || result.status === 'no_encontrado') && result.portalBaseUrl ? (

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

                    Enlace del correo detectado; si el preflight sigue vacío, abra el expediente en SGDE y vuelva a

                    Actualizar.

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



      {previewFile ? (

        <SgdePdfPreviewModal

          nodeId={previewFile.id}

          displayName={previewFile.path || previewFile.name}

          onClose={() => setPreviewFile(null)}

        />

      ) : null}

    </>

  );

}

