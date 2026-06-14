import React from 'react';
import { Building2 } from 'lucide-react';
import { useTenant } from '../../contexts/TenantContext';

/** Aviso cuando platform admin aún no eligió despacho (viewAs). */
export default function PlatformCourtSelectionPrompt() {
  const { needsViewAsSelection } = useTenant();
  if (!needsViewAsSelection) return null;

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-6 sm:p-8 text-center max-w-lg mx-auto mt-8">
      <Building2 className="w-10 h-10 text-indigo-600 mx-auto mb-3" aria-hidden />
      <h2 className="text-lg font-bold text-slate-900 mb-2">Seleccione un despacho</h2>
      <p className="text-sm text-slate-600">
        Como administrador de plataforma, use la barra superior <strong>Operar como…</strong> para
        elegir el juzgado cuyos expedientes desea ver. No se cargan datos de todos los despachos a la
        vez.
      </p>
    </div>
  );
}
