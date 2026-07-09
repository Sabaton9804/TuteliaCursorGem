import React from 'react';
import { Link } from 'react-router-dom';
import { Scale, ArrowRight } from 'lucide-react';
import { PROCESOS_SUBMENU } from '../lib/procesos-nav';

export default function ProcesosHub() {
  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3 text-slate-400 mb-2">
          <Scale className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Módulo judicial</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Procesos</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-2xl">
          Catálogo operativo del despacho: procesos civiles importados desde el control de reparto y
          Microsoft Planner. Las tutelas siguen en el módulo Tutelas; aquí solo se listan asuntos de
          rama civil.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PROCESOS_SUBMENU.filter((s) => s.path !== '/procesos').map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className="card-modern p-6 flex items-center justify-between gap-4 hover:border-accent/30 hover:shadow-md transition-all group"
          >
            <div>
              <p className="text-lg font-bold text-slate-900">{item.label}</p>
              <p className="text-sm text-slate-500 mt-1">
                {item.path === '/procesos/estado'
                  ? 'Demandante, demandado, tipo, situación, etapa, ubicación y si está terminado (solo civiles).'
                  : 'Radicado, demandante, demandado, tipo de proceso, situación, ubicación y último auto.'}
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-accent shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
