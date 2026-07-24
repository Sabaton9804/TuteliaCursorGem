import React from 'react';
import { Cloud, ExternalLink } from 'lucide-react';
import type { Case } from '../../types';
import { parseCatalogMetadata } from '../../lib/case-catalog-metadata';

function isSharePointOrOneDrive(url: string): boolean {
  return /sharepoint|onedrive|1drv\.ms/i.test(url);
}

export function ExpedientePlannerLinkBar({ caseItem }: { caseItem: Case }) {
  const meta = parseCatalogMetadata(caseItem.catalogMetadata);
  const url = meta?.link_expediente?.trim();
  if (!url || !isSharePointOrOneDrive(url)) return null;

  const deposito = meta?.planner_deposito || meta?.ubicacion_interna;
  const fuente = meta?.link_expediente_fuente === 'planner' ? 'Microsoft Planner' : 'Catálogo';

  return (
    <div className="rounded-xl border border-sky-200/80 bg-gradient-to-r from-sky-50/90 to-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-sky-700">
            Carpeta del expediente (OneDrive / SharePoint)
          </p>
          <p className="text-sm font-semibold text-slate-800">
            {deposito ? `Ubicación Planner: ${deposito}` : 'Enlace externo — sin copia en Jurion'}
          </p>
          <p className="text-[11px] text-slate-500">
            Importado desde {fuente}. Los PDF históricos permanecen en la nube; aquí solo el vínculo.
          </p>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-sky-900 shadow-sm hover:bg-sky-50"
        >
          <Cloud className="h-3.5 w-3.5" />
          Abrir carpeta
          <ExternalLink className="h-3 w-3 opacity-60" />
        </a>
      </div>
    </div>
  );
}
