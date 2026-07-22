import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Edit2, Loader2, Sparkles } from 'lucide-react';
import { defaultRadicacionConfig } from '../../lib/court-radicacion-config';
import { formatRadicado } from '../../lib/formatters';
import { CUI_INSTANCE_PRIMERA, CUI_INSTANCE_SEGUNDA } from '../../lib/radicado-cui';
import type { CourtRadicacionConfig } from '../../lib/process-definition-types';
import type { LegalAnalysis } from './new-case-types';

export type CaseRadicacionConsecutivePanelProps = {
  consecutive: string;
  setConsecutive: (v: string) => void;
  consecutiveLoading: boolean;
  consecutiveReady: boolean;
  radicadoConflict: { raw: string; existingCaseId: string } | null;
  /** CUI del despacho (desde courts en BD). */
  radicacion?: CourtRadicacionConfig;
  instanceCode?: string;
  /** Segunda instancia: mismo CUI base; sufijo 01, 02… según vueltas (p. ej. tras nulidad). */
  segundaInstancia?: {
    originRadicado: string;
    derivedRadicado: string | null;
    suffixLoading?: boolean;
    knownRadicados?: string[];
  };
};

export function CaseRadicacionConsecutivePanel({
  consecutive,
  setConsecutive,
  consecutiveLoading,
  consecutiveReady,
  radicadoConflict,
  radicacion,
  instanceCode,
  segundaInstancia,
}: CaseRadicacionConsecutivePanelProps) {
  const cui = radicacion ?? defaultRadicacionConfig('');
  const inst = instanceCode ?? CUI_INSTANCE_PRIMERA;
  if (segundaInstancia) {
    const originDigits = segundaInstancia.originRadicado.replace(/\D/g, '');
    const originOk = originDigits.length === 23;
    const derived = segundaInstancia.derivedRadicado;
    const derivedFormatted = derived ? formatRadicado(derived) : null;
    const suffixLoading = segundaInstancia.suffixLoading ?? false;
    const derivedSuffix = derived?.replace(/\D/g, '').slice(21, 23) ?? '';
    const priorSegunda = (segundaInstancia.knownRadicados ?? []).filter(
      (r) => r.replace(/\D/g, '').slice(21, 23) !== '00'
    );

    return (
      <motion.div layout className="rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2.5">
        <motion.div layout className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] text-slate-600">
          <span className="font-medium text-violet-900 flex items-center gap-1">
            Radicado segunda instancia (Ac. 201/1997 CSJ)
          </span>
          {suffixLoading ? (
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Calculando sufijo…
            </span>
          ) : originOk && derived ? (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <Check className="w-3 h-3 shrink-0" />
              Sufijo {derivedSuffix} propuesto
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <AlertCircle className="w-3 h-3 shrink-0" />
              Complete el radicado de origen (23 dígitos)
            </span>
          )}
        </motion.div>

        <p className="mt-2 text-[10px] leading-snug text-slate-600">
          El proceso conserva los mismos 21 dígitos; el sufijo final marca la instancia o vuelta (
          <span className="font-mono">{CUI_INSTANCE_PRIMERA}</span> primera,{' '}
          <span className="font-mono">{CUI_INSTANCE_SEGUNDA}</span> primera llegada a segunda,{' '}
          <span className="font-mono">02</span> si regresa tras nulidad, etc.).
        </p>

        {originOk && derivedFormatted ? (
          <div className="mt-3 space-y-2">
            <motion.div layout className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Origen (1.ª inst.)
            </motion.div>
            <p className="font-mono text-xs text-slate-700 tabular-nums">{formatRadicado(originDigits)}</p>
            <div className="text-[10px] font-bold uppercase tracking-widest text-violet-700">Radicado en este despacho (2.ª inst.)</div>
            <p className="font-mono text-sm font-bold text-violet-900 tabular-nums">{derivedFormatted}</p>
            {priorSegunda.length > 0 ? (
              <p className="text-[10px] text-violet-800/90 leading-snug">
                Ya hay {priorSegunda.length} radicado(s) de segunda en Tutelia con esta base; por eso se propone{' '}
                <span className="font-mono font-semibold">…{derivedSuffix}</span> y no{' '}
                <span className="font-mono">{CUI_INSTANCE_SEGUNDA}</span>.
              </p>
            ) : null}
          </div>
        ) : null}

        {radicadoConflict && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-3 text-red-600 text-[10px] font-bold uppercase tracking-widest"
          >
            <AlertCircle className="w-5 h-5 shrink-0" />
            <motion.div layout className="flex flex-col gap-2 max-w-full">
              <span className="text-[11px] font-black">Conflicto de radicación detectado</span>
              <p className="font-bold normal-case tracking-normal text-sm text-red-700/90 leading-snug">
                El radicado <span className="font-mono">{formatRadicado(radicadoConflict.raw)}</span> ya está registrado
                en este despacho.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Link
                  to={`/case/${radicadoConflict.existingCaseId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-red-200 text-[11px] font-bold text-red-700 normal-case tracking-normal hover:bg-red-50"
                >
                  Abrir expediente existente
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </motion.div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] text-slate-500">
        <span className="font-medium text-slate-600 flex items-center gap-1">
          <Edit2 className="w-3 h-3 text-slate-400 shrink-0" />
          Radicado (Ac. 201/1997 CSJ)
        </span>
        {consecutiveLoading ? (
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            Consecutivo…
          </span>
        ) : consecutiveReady ? (
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <Check className="w-3 h-3 shrink-0" />
            Consecutivo listo
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs font-mono text-slate-700">
        <span className="tabular-nums">{cui.daneCode}</span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">{cui.entityCode}</span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">{cui.specialtyCode}</span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">{cui.despachoNumber}</span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">{new Date().getFullYear()}</span>
        <span className="text-slate-300">·</span>
        <input
          type="text"
          inputMode="numeric"
          value={consecutive}
          onChange={(e) => setConsecutive(e.target.value.replace(/\D/g, '').slice(0, 5))}
          disabled={consecutiveLoading}
          className="w-[4.25rem] rounded border border-slate-300 bg-white px-1.5 py-0.5 text-center text-xs font-semibold text-slate-800 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-60"
          placeholder="—"
          title="Consecutivo de proceso (5 dígitos). Se sugiere el siguiente al último radicado en este despacho y año."
        />
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">{inst}</span>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-slate-400">
        El consecutivo se propone según el último expediente ya radicado en este despacho para el año en curso; puede
        corregirlo si corresponde.
      </p>

      {radicadoConflict && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-3 text-red-600 text-[10px] font-bold uppercase tracking-widest"
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div className="flex flex-col gap-2 max-w-full">
            <span className="text-[11px] font-black">Conflicto de radicación detectado</span>
            <p className="font-bold normal-case tracking-normal text-sm text-red-700/90 leading-snug">
              El radicado <span className="font-mono">{formatRadicado(radicadoConflict.raw)}</span> ya está en la tabla{' '}
              <span className="font-mono">cases</span> de Supabase para este despacho.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link
                to={`/case/${radicadoConflict.existingCaseId}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-red-200 text-[11px] font-bold text-red-700 normal-case tracking-normal hover:bg-red-50"
              >
                Abrir expediente existente
              </Link>
              <Link
                to={`/cases?q=${encodeURIComponent(radicadoConflict.raw)}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-red-200 text-[11px] font-bold text-red-700 normal-case tracking-normal hover:bg-red-50"
              >
                Ver en listado de expedientes
              </Link>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export type CaseRadicacionActionsProps = {
  aiAnalysis: LegalAnalysis | null;
  isRadicating: boolean;
  consecutiveReady: boolean;
  radicadoConflict?: { raw: string; existingCaseId: string } | null;
  error: string | null;
  onRadicate: () => void;
};

/** Avisos previos a radicar, error y botón principal (columna izquierda del paso final). */
export function CaseRadicacionActions({
  aiAnalysis,
  isRadicating,
  consecutiveReady,
  radicadoConflict,
  error,
  onRadicate,
}: CaseRadicacionActionsProps) {
  return (
    <>
      {!aiAnalysis && (
        <div className="p-4 bg-amber-50 text-amber-700 rounded-2xl border border-amber-100 text-[10px] font-bold uppercase tracking-widest flex items-center gap-3 animate-pulse">
          <AlertCircle className="w-4 h-4" /> Se recomienda extraer datos con IA antes de radicar
        </div>
      )}

      {aiAnalysis && (
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl border border-emerald-100 text-[10px] font-bold uppercase tracking-widest flex items-center gap-3">
          <CheckCircle2 className="w-4 h-4" /> Datos extraídos con IA listos para vinculación
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 flex items-center gap-3 text-xs font-semibold">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onRadicate}
        disabled={isRadicating || !consecutiveReady || Boolean(radicadoConflict)}
        className={`w-full py-6 rounded-2xl text-sm font-black uppercase tracking-[0.15em] flex items-center justify-center gap-4 transition-all duration-300 relative overflow-hidden group ${
          isRadicating
            ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
            : 'bg-accent text-white shadow-2xl shadow-accent/20 hover:shadow-accent/40 active:scale-[0.98] border border-accent/20'
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

        {isRadicating ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Radicando Proceso...</span>
          </>
        ) : (
          <>
            {aiAnalysis && <Sparkles className="w-5 h-5 text-blue-200" />}
            <span>Radicar y Vincular Expediente</span>
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </>
        )}
      </button>
    </>
  );
}
