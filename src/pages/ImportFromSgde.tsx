import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, CloudDownload, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase';
import { ensureSupabaseSessionForWrites } from '../lib/supabase-write-auth';
import { formatRadicado } from '../lib/formatters';
import { cuiBase21, deriveRadicadoSegundaInstancia } from '../lib/radicado-cui';
import { openRadicacionStageAfterRadicate } from '../lib/case-stages-service';
import { useSessionCourt } from '../contexts/SessionCourtContext';
import {
  sgdeImportExpediente,
  type ImportFromSgdeResult,
  type SgdePreflightResult,
} from '../lib/sgde-api';
import type { CaseAppellant, CaseOriginRuling, CaseType } from '../types';
import { CaseSgdeSegundaPreflightPanel } from '../components/new-case/CaseSgdeSegundaPreflightPanel';
import { CaseFormSegundaInstancia } from '../components/new-case/CaseFormSegundaInstancia';
import { extractSgdeNodeIdFromText } from '../lib/segunda-instancia-email';

export default function ImportFromSgde() {
  const navigate = useNavigate();
  const { courtId } = useSessionCourt();

  const [caseType, setCaseType] = useState<'tutela_primera' | 'tutela_segunda'>('tutela_primera');
  const [radicado, setRadicado] = useState('');
  const [sgdeNodeHint, setSgdeNodeHint] = useState('');
  const [originCourt, setOriginCourt] = useState('');
  const [appellantSel, setAppellantSel] = useState<'' | CaseAppellant>('');
  const [originRulingSel, setOriginRulingSel] = useState<'' | CaseOriginRuling>('');
  const [forceMigrate, setForceMigrate] = useState(false);
  const [sgdePreflight, setSgdePreflight] = useState<SgdePreflightResult | null>(null);
  const [segundaKnownRadicados, setSegundaKnownRadicados] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportFromSgdeResult | null>(null);

  const digits = radicado.replace(/\D/g, '');
  const nodeHint =
    extractSgdeNodeIdFromText(sgdeNodeHint) ||
    (/^[0-9a-f-]{36}$/i.test(sgdeNodeHint.trim()) ? sgdeNodeHint.trim().toLowerCase() : null);

  const derivedSegunda = useMemo(() => {
    if (caseType !== 'tutela_segunda' || digits.length !== 23) return null;
    return deriveRadicadoSegundaInstancia(digits, segundaKnownRadicados);
  }, [caseType, digits, segundaKnownRadicados]);

  useEffect(() => {
    if (caseType !== 'tutela_segunda') {
      setSegundaKnownRadicados([]);
      return;
    }
    const base = cuiBase21(radicado);
    if (!base) {
      setSegundaKnownRadicados([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await ensureSupabaseSessionForWrites();
        const res = await supabase.from('cases').select('radicado').like('radicado', `${base}%`);
        if (cancelled) return;
        const list = (res.data ?? [])
          .map((row) => String(row.radicado || '').replace(/\D/g, ''))
          .filter((d) => d.length === 23 && d.startsWith(base));
        setSegundaKnownRadicados(list);
      } catch {
        if (!cancelled) setSegundaKnownRadicados([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseType, radicado]);

  const applySegundaExtract = useCallback(
    (extract: { appellant: CaseAppellant | null; originRuling: CaseOriginRuling | null } | null) => {
      if (!extract) return;
      if (extract.appellant === 'accionante' || extract.appellant === 'accionado') {
        setAppellantSel(extract.appellant);
      }
      if (extract.originRuling === 'concedio' || extract.originRuling === 'nego') {
        setOriginRulingSel(extract.originRuling);
      }
    },
    []
  );

  const canImport = useMemo(() => {
    if (digits.length !== 23) return false;
    if (!sgdePreflight?.sgdeRootId) return false;
    if (sgdePreflight.status === 'no_encontrado' || sgdePreflight.status === 'error_login') return false;
    if (caseType === 'tutela_segunda') {
      if (!originCourt.trim()) return false;
      if (appellantSel !== 'accionante' && appellantSel !== 'accionado') return false;
      if (originRulingSel !== 'concedio' && originRulingSel !== 'nego') return false;
      if (!derivedSegunda) return false;
    }
    return true;
  }, [
    digits.length,
    sgdePreflight,
    caseType,
    originCourt,
    appellantSel,
    originRulingSel,
    derivedSegunda,
  ]);

  const handleImport = async () => {
    if (!courtId) {
      setError('No hay despacho activo en la sesión.');
      return;
    }
    if (!canImport) return;

    setImporting(true);
    setError(null);
    try {
      const res = await sgdeImportExpediente({
        caseType,
        radicado: digits,
        sgdeNodeIdHint: nodeHint,
        originCourt: caseType === 'tutela_segunda' ? originCourt.trim() : undefined,
        appellant:
          caseType === 'tutela_segunda' && (appellantSel === 'accionante' || appellantSel === 'accionado')
            ? appellantSel
            : undefined,
        originRuling:
          caseType === 'tutela_segunda' && (originRulingSel === 'concedio' || originRulingSel === 'nego')
            ? originRulingSel
            : undefined,
        forceMigrate,
      });

      if (res.created) {
        try {
          await openRadicacionStageAfterRadicate(supabase, {
            caseId: res.caseId,
            courtId,
            radicado: res.radicado,
            caseType: caseType as CaseType,
          });
        } catch (e) {
          console.warn('Etapas tras importación SGDE:', e);
        }
      }

      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  if (result?.ok) {
    return (
      <div className="max-w-2xl mx-auto space-y-8 py-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="card-modern border border-emerald-100 bg-gradient-to-br from-emerald-50/90 to-white p-10 text-center"
        >
          <CheckCircle2 className="mx-auto mb-5 h-14 w-14 text-emerald-600" aria-hidden />
          <h1 className="text-2xl font-bold text-slate-900">Importación completada</h1>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">{result.message}</p>
          <p className="mt-2 font-mono text-xs text-slate-500 tabular-nums">
            {formatRadicado(result.radicado)}
          </p>
          {result.migrated > 0 ? (
            <p className="mt-1 text-xs text-emerald-800">{result.migrated} PDF importados a Tutelia</p>
          ) : null}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate(`/case/${result.caseId}`)}
              className="rounded-xl bg-accent px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-95"
            >
              Abrir expediente
            </button>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setRadicado('');
                setSgdePreflight(null);
              }}
              className="rounded-xl border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Importar otro
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8 py-4">
      <header className="space-y-3">
        <Link
          to="/new"
          className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          Radicación por correo
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Importar desde SGDE</h1>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              El expediente ya existe en el sistema de gestión documental. Se crea o abre el caso en Tutelia, se
              descargan los PDF y queda vinculado — sin «Crear» ni «Vincular» de nuevo.
            </p>
          </div>
          <span className="shrink-0 rounded-lg border border-violet-100 bg-violet-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-800">
            SGDE → Tutelia
          </span>
        </div>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tipo de expediente</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(
            [
              { key: 'tutela_primera' as const, title: 'Primera instancia', sub: 'CUI del expediente en SGDE' },
              {
                key: 'tutela_segunda' as const,
                title: 'Segunda instancia',
                sub: 'CUI de origen (primera instancia) en SGDE',
              },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                setCaseType(opt.key);
                setSgdePreflight(null);
                setError(null);
              }}
              className={`rounded-xl border-2 p-4 text-left transition-all ${
                caseType === opt.key
                  ? 'border-violet-400 bg-violet-50/60 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <span className="text-sm font-bold text-slate-900">{opt.title}</span>
              <span className="mt-1 block text-xs text-slate-500">{opt.sub}</span>
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            {caseType === 'tutela_segunda' ? 'Radicado de origen (23 dígitos)' : 'Radicado en SGDE (23 dígitos)'}
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={radicado}
            onChange={(e) => {
              setRadicado(e.target.value);
              setSgdePreflight(null);
              setError(null);
            }}
            placeholder="11001400300120240073000"
            className="w-full rounded-xl border border-slate-200 px-4 py-3 font-mono text-sm text-slate-800 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          {caseType === 'tutela_segunda' && derivedSegunda ? (
            <p className="text-xs text-violet-800">
              CUI en este despacho (propuesto):{' '}
              <span className="font-mono font-semibold">{formatRadicado(derivedSegunda)}</span>
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            Enlace SGDE (opcional)
          </label>
          <input
            type="text"
            value={sgdeNodeHint}
            onChange={(e) => setSgdeNodeHint(e.target.value)}
            placeholder="UUID del nodo o URL del portal SGDE"
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-800 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {caseType === 'tutela_segunda' ? (
          <>
            <CaseFormSegundaInstancia
              originCourt={originCourt}
              setOriginCourt={setOriginCourt}
              originRadicado={radicado}
              setOriginRadicado={setRadicado}
              appellantSel={appellantSel}
              setAppellantSel={setAppellantSel}
              originRulingSel={originRulingSel}
              setOriginRulingSel={setOriginRulingSel}
            />
            <CaseSgdeSegundaPreflightPanel
              key={`import-pf-${digits || 'none'}`}
              originRadicado={radicado}
              sgdeNodeIdHint={nodeHint}
              onPreflightChange={setSgdePreflight}
              onSegundaExtract={applySegundaExtract}
            />
          </>
        ) : (
          <CaseSgdeSegundaPreflightPanel
            key={`import-pf-pi-${digits || 'none'}`}
            originRadicado={radicado}
            sgdeNodeIdHint={nodeHint}
            onPreflightChange={setSgdePreflight}
          />
        )}

        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={forceMigrate}
            onChange={(e) => setForceMigrate(e.target.checked)}
            className="rounded border-slate-300 text-accent focus:ring-accent"
          />
          Reimportar PDF (si ya se migraron antes)
        </label>

        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <button
          type="button"
          disabled={!canImport || importing}
          onClick={() => void handleImport()}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-6 py-3.5 text-sm font-bold text-white shadow-md hover:bg-violet-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Importando desde SGDE…
            </>
          ) : (
            <>
              <CloudDownload className="h-5 w-5" />
              Importar expediente a Tutelia
            </>
          )}
        </button>

        <p className="text-[11px] text-slate-500 leading-relaxed text-center">
          Tras importar el expediente quedará vinculado a SGDE. Use «Sincronizar» en el expediente digital solo si
          hay cambios nuevos en SGDE.
        </p>
      </div>
    </div>
  );
}
