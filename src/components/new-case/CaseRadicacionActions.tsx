import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Edit2, Loader2, Sparkles } from 'lucide-react';
import { COURT_CONSTANTS } from '../../constants';
import { formatRadicado } from '../../lib/formatters';
import type { LegalAnalysis } from './new-case-types';

export type CaseRadicacionConsecutivePanelProps = {
  consecutive: string;
  setConsecutive: (v: string) => void;
  consecutiveLoading: boolean;
  consecutiveReady: boolean;
  radicadoConflict: { raw: string; existingCaseId: string } | null;
};

export function CaseRadicacionConsecutivePanel({
  consecutive,
  setConsecutive,
  consecutiveLoading,
  consecutiveReady,
  radicadoConflict,
}: CaseRadicacionConsecutivePanelProps) {
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
        <span className="tabular-nums">{COURT_CONSTANTS.CITY_CODE}</span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">{COURT_CONSTANTS.ENTITY_CODE}</span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">{COURT_CONSTANTS.SPECIALTY_CODE}</span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">{COURT_CONSTANTS.DESPACHO_CODE}</span>
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
        <span className="tabular-nums">{COURT_CONSTANTS.INSTANCE_CODE}</span>
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
  error: string | null;
  onRadicate: () => void;
};

/** Avisos previos a radicar, error y botón principal (columna izquierda del paso final). */
export function CaseRadicacionActions({
  aiAnalysis,
  isRadicating,
  consecutiveReady,
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
        disabled={isRadicating || !consecutiveReady}
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
