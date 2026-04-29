import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Settings as SettingsIcon, Shield, Database, Trash2, CheckCircle2 } from 'lucide-react';

export default function Settings() {
  const [isInitializing, setIsInitializing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const initializeDemo = async () => {
    setIsInitializing(true);
    setStatus('Iniciando...');
    try {
      await supabase.from('courts').upsert(
        {
          id: 'court-1',
          name: 'Juzgado Civil del Circuito 01 de Bogotá',
          email: 'j01ccbog@notificaciones.jud.co',
          city: 'Bogotá',
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
            court_id: 'court-1',
          },
          { onConflict: 'id' }
        );
      }

      setStatus('Demo inicializada con éxito (Supabase).');
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
