import React, { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { DEFAULT_DEMO_COURT_ID } from '../lib/default-court';
import { Shield, Database, CheckCircle2, UsersRound } from 'lucide-react';
import { useSessionCourt } from '../contexts/SessionCourtContext';
import { ensureSupabaseSessionForWrites } from '../lib/supabase-write-auth';
import type { SustanciadorAssignmentMode } from '../types';
import {
  parseSustanciadorAssignmentMode,
  SUSTANCIADOR_ASSIGNMENT_MODE_SHORT,
} from '../lib/sustanciador-reparto';
import { RepartoParidadPanel } from '../components/settings/RepartoParidadPanel';
import { RepartoAlternadoPanel } from '../components/settings/RepartoAlternadoPanel';

/** Manual primero: es el valor por defecto en BD para juzgados nuevos. */
const MODE_OPTIONS: SustanciadorAssignmentMode[] = [
  'manual_unassigned',
  'hash_stable',
  'radicado_parity',
  'alternating',
];

export default function Settings() {
  const queryClient = useQueryClient();
  const { courtId } = useSessionCourt();
  const [isInitializing, setIsInitializing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [repartoDraft, setRepartoDraft] = useState<SustanciadorAssignmentMode>('manual_unassigned');
  const [repartoCursor, setRepartoCursor] = useState<number | null>(null);
  const [repartoLoading, setRepartoLoading] = useState(true);
  const [repartoSaving, setRepartoSaving] = useState(false);
  const [repartoStatus, setRepartoStatus] = useState<string | null>(null);
  const [courtDisplayName, setCourtDisplayName] = useState<string | null>(null);
  const [courtCity, setCourtCity] = useState<string | null>(null);

  const loadReparto = useCallback(async () => {
    setRepartoLoading(true);
    setRepartoStatus(null);
    try {
      const { data, error } = await supabase
        .from('courts')
        .select('name, city, sustanciador_assignment_mode, sustanciador_rr_cursor')
        .eq('id', courtId)
        .maybeSingle();
      if (error) throw error;
      const nm = typeof data?.name === 'string' ? data.name.trim() : '';
      const ct = typeof data?.city === 'string' ? data.city.trim() : '';
      setCourtDisplayName(nm || null);
      setCourtCity(ct || null);
      setRepartoDraft(parseSustanciadorAssignmentMode(data?.sustanciador_assignment_mode));
      const raw = data?.sustanciador_rr_cursor;
      setRepartoCursor(typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) || 0 : 0);
    } catch (e) {
      console.error(e);
      setRepartoStatus('No se pudo cargar la configuración de reparto (¿migración aplicada?).');
    } finally {
      setRepartoLoading(false);
    }
  }, [courtId]);

  useEffect(() => {
    void loadReparto();
  }, [loadReparto]);

  const saveReparto = async () => {
    setRepartoSaving(true);
    setRepartoStatus(null);
    try {
      await ensureSupabaseSessionForWrites();
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('courts')
        .update({
          sustanciador_assignment_mode: repartoDraft,
          updated_at: now,
        })
        .eq('id', courtId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['court-sustanciador-mode', courtId] });
      setRepartoStatus('Regla de reparto guardada. Afecta a las radicaciones nuevas (y a la vista si hay expedientes sin asignar en modo manual).');
    } catch (e) {
      console.error(e);
      setRepartoStatus('Error al guardar. Verifique sesión y columnas en Supabase.');
    } finally {
      setRepartoSaving(false);
    }
  };

  const initializeDemo = async () => {
    setIsInitializing(true);
    setStatus('Iniciando...');
    try {
      await supabase.from('courts').upsert(
        {
          id: DEFAULT_DEMO_COURT_ID,
          name: 'Juzgado 051 Civil del Circuito de Bogotá',
          email: 'j051ccbog@notificaciones.jud.co',
          city: 'Bogotá D.C.',
        },
        { onConflict: 'id' }
      );

      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        const name =
          (typeof u.user.user_metadata?.full_name === 'string' && u.user.user_metadata.full_name) ||
          u.user.email?.split('@')[0] ||
          'Funcionario';
        await supabase.from('profiles').upsert(
          {
            id: u.user.id,
            email: u.user.email || '',
            name,
            role: 'admin',
            court_id: DEFAULT_DEMO_COURT_ID,
          },
          { onConflict: 'id' }
        );
      }

      setStatus('Demo inicializada con éxito (Supabase).');
      if (courtId === DEFAULT_DEMO_COURT_ID) void loadReparto();
    } catch (error) {
      console.error(error);
      setStatus('Error al inicializar.');
    } finally {
      setIsInitializing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Configuración del Sistema</h1>
        <p className="text-sm font-medium text-slate-500 mt-1">Gestión de parámetros globales y mantenimiento del despacho</p>
      </header>

      <div className="card-modern p-8 space-y-6">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 border-b border-slate-50 pb-4">
          <UsersRound className="w-4 h-4 text-accent" aria-hidden />
          Reparto de sustanciadores
        </div>
        <p className="text-sm font-medium text-slate-500 leading-relaxed">
          <span className="text-slate-800">
            Juzgado actual:{' '}
            <strong>{courtDisplayName || 'Sin nombre en base de datos'}</strong>
            {courtCity ? (
              <>
                {' '}
                <span className="text-slate-500">({courtCity})</span>
              </>
            ) : null}
          </span>
          <span className="mt-2 block text-xs text-slate-400">
            Código en sistema: <span className="font-mono text-slate-500">{courtId}</span> (coincide con su perfil y
            con los expedientes de este despacho).
          </span>
          <span className="mt-3 block">
            Por defecto (juzgados nuevos y valor recomendado) puede dejarse en{' '}
            <strong className="text-slate-700">manual</strong>: usted elige el sustanciador al abrir el expediente. Las
            otras reglas persisten <span className="font-mono">assigned_to</span> automáticamente al radicar.
          </span>
        </p>
        {repartoLoading ? (
          <p className="text-xs text-slate-400">Cargando…</p>
        ) : (
          <div className="max-w-2xl space-y-4">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400" htmlFor="reparto-mode">
              ¿Cómo se asigna el sustanciador al radicar?
            </label>
            <select
              id="reparto-mode"
              className="input-modern w-full text-sm font-medium"
              value={repartoDraft}
              onChange={(e) => setRepartoDraft(e.target.value as SustanciadorAssignmentMode)}
            >
              {MODE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {SUSTANCIADOR_ASSIGNMENT_MODE_SHORT[m]}
                </option>
              ))}
            </select>
            {repartoDraft === 'radicado_parity' ? <RepartoParidadPanel /> : null}
            {repartoDraft === 'alternating' && repartoCursor !== null ? (
              <RepartoAlternadoPanel cursor={repartoCursor} />
            ) : null}
            {repartoDraft === 'hash_stable' ? (
              <p className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 text-xs leading-relaxed text-slate-600">
                El sistema reparte de forma <strong>estable</strong> entre los dos sustanciadores del despacho: el mismo
                expediente siempre vería el mismo sustanciador si volviera a calcularse, sin depender del número del
                radicado.
              </p>
            ) : null}
            {repartoDraft === 'manual_unassigned' ? (
              <p className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 text-xs leading-relaxed text-slate-600">
                Al radicar <strong>no</strong> se guarda sustanciador todavía. Entre al expediente y use «Guardar
                asignación» cuando corresponda.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void saveReparto()}
              disabled={repartoSaving}
              className="btn-primary px-6 py-3 text-xs tracking-widest shadow-lg shadow-accent/10 disabled:opacity-50"
            >
              {repartoSaving ? 'GUARDANDO…' : 'GUARDAR REPARTO'}
            </button>
            {repartoStatus ? (
              <div className="p-3 rounded-xl border border-slate-100 bg-slate-50 text-xs font-medium text-slate-600">
                {repartoStatus}
              </div>
            ) : null}
            <p className="text-[11px] leading-relaxed text-slate-400">
              En la base puede haber otros juzgados civiles de circuito de ejemplo (p. ej. 050, 052, 053 en Bogotá). El
              que usa la aplicación es el de su perfil (<span className="font-mono">{courtId}</span>).
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="card-modern p-8 space-y-8 flex flex-col">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 border-b border-slate-50 pb-4">
            <Shield className="w-4 h-4 text-accent" /> Inicialización de Entorno
          </div>

          <div className="space-y-6 flex-1">
            <p className="text-sm font-medium text-slate-500 leading-relaxed">
              Configure el entorno inicial del despacho para habilitar la radicación de expedientes y la gestión de usuarios administrativos.
            </p>

            <button
              onClick={initializeDemo}
              disabled={isInitializing}
              className="btn-primary w-full py-4 text-xs tracking-widest shadow-lg shadow-accent/10"
            >
              {isInitializing ? 'PROCESANDO...' : 'INICIALIZAR ESTRUCTURA JUDICIAL'}
            </button>

            {status && (
              <div className="p-4 bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> {status}
              </div>
            )}
          </div>
        </div>

        <div className="card-modern p-8 space-y-8 flex flex-col relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-5 bg-accent w-32 h-32 rounded-bl-full group-hover:scale-110 transition-transform" />
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 border-b border-slate-50 pb-4">
            <Database className="w-4 h-4 text-accent" /> Interconexión SGDE
          </div>

          <div className="space-y-6 flex-1">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
              <span className="text-xs font-bold uppercase text-red-400 tracking-widest">Sin Conexión</span>
            </div>

            <p className="text-sm font-medium text-slate-400 leading-relaxed">
              La sincronización bidireccional con el Sistema de Gestión Documental Electrónica requiere credenciales de API Institucional.
            </p>

            <button className="w-full py-4 border border-slate-100 bg-slate-50 text-slate-300 rounded-xl font-bold text-xs uppercase tracking-widest cursor-not-allowed">
              CONFIGURAR TOKEN DE ACCESO
            </button>
          </div>
        </div>
      </div>

      <div className="card-modern p-10 bg-slate-900 border-none relative overflow-hidden">
        <div className="absolute top-[-50%] left-[-20%] w-[100%] h-[200%] bg-accent/10 blur-[100px] border-none" />
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-white">Estado de la Base de Datos</h3>
            <p className="text-sm font-medium text-slate-400">Su despacho está operando sobre Supabase (PostgreSQL + Auth).</p>
          </div>
          <div className="flex gap-4">
            <div className="bg-white/5 border border-white/10 px-6 py-3 rounded-2xl">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Región</div>
              <div className="text-xs font-bold text-white">us-west1 (Oregon)</div>
            </div>
            <div className="bg-white/5 border border-white/10 px-6 py-3 rounded-2xl">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Edición</div>
              <div className="text-xs font-bold text-white">Enterprise Standard</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
