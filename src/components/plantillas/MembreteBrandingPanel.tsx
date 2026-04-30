import React from 'react';
import { Building2, Landmark, Mail, MapPin, RotateCcw, Shield, Sparkles } from 'lucide-react';
import type { PlantillasStateV2 } from '../../lib/plantillas-store';
import { MembreteRichEditor } from './MembreteRichSurface';

type MembreteBrandingPanelProps = {
  data: PlantillasStateV2;
  persistMembrete: (next: PlantillasStateV2) => void;
  onResetDefaults: () => void;
  brandingError: string | null;
};

const LINE_KEYS = ['line1', 'line2', 'line3'] as const;

export function MembreteBrandingPanel({
  data,
  persistMembrete,
  onResetDefaults,
  brandingError,
}: MembreteBrandingPanelProps) {
  const m = data.membrete;

  return (
    <section className="card-modern overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/90 bg-gradient-to-br from-slate-50/95 via-white to-slate-50/40 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
            <Shield className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Membrete del despacho</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              Diseño libre: texto, negritas, alineación e imágenes donde quiera. Se guarda para todo el despacho y en este
              navegador.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          Solo administrador
        </div>
      </div>

      {brandingError ? (
        <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-xs font-medium text-red-800 sm:px-6">
          {brandingError}
        </div>
      ) : null}

      <div className="space-y-5 p-5 sm:p-6 lg:p-8">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Diseño del membrete</h3>
            <button
              type="button"
              onClick={() =>
                persistMembrete({
                  ...data,
                  membrete: { ...m, membreteEditorJson: '' },
                })
              }
              className="text-[10px] font-semibold text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-accent"
            >
              Volver a vista generada desde los campos de abajo
            </button>
          </div>
          <MembreteRichEditor
            membrete={m}
            value={m.membreteEditorJson}
            onChange={(json) =>
              persistMembrete({
                ...data,
                membrete: { ...m, membreteEditorJson: json },
              })
            }
          />
          <p className="mt-2 text-[10px] leading-snug text-slate-500">
            La primera vez se rellena con los datos que ya tenía el despacho; puede borrar, mover o insertar imágenes con el
            botón «Imagen». Si vacía el diseño libre con el enlace de arriba, el Word vuelve a usar solo los campos fijos.
          </p>
        </div>

        <details className="group overflow-hidden rounded-xl border border-slate-100 bg-slate-50/80 shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden sm:px-5">
            <Landmark className="h-4 w-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-slate-800">
              Campos para variables <code className="font-mono text-[10px] font-semibold normal-case">{'{{ }}'}</code>
            </span>
            <span className="text-[10px] font-medium text-slate-500 group-open:hidden">Abrir</span>
            <span className="hidden text-[10px] font-medium text-slate-500 group-open:inline">Cerrar</span>
          </summary>
          <div className="space-y-4 border-t border-slate-100/90 p-4 sm:p-5">
            <p className="text-[10px] leading-relaxed text-slate-500">
              Estos textos alimentan marcadores como <strong className="text-slate-700">JUZGADO_NOMBRE</strong> o{' '}
              <strong className="text-slate-700">MEMBRETE_LINEA1</strong> en las plantillas. No definen el bloque visual si ya
              guardó un diseño libre arriba.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {LINE_KEYS.map((k, i) => (
                <label key={k} className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Línea {i + 1}</span>
                  <input
                    type="text"
                    value={m.auto[k]}
                    onChange={(e) =>
                      persistMembrete({
                        ...data,
                        membrete: {
                          ...m,
                          auto: { ...m.auto, [k]: e.target.value },
                        },
                      })
                    }
                    className="input-modern text-sm"
                  />
                </label>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="block space-y-1">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <Building2 className="h-3 w-3 text-slate-400" aria-hidden />
                  Juzgado (variable)
                </span>
                <textarea
                  value={m.informe.juzgado}
                  onChange={(e) =>
                    persistMembrete({
                      ...data,
                      membrete: {
                        ...m,
                        informe: { ...m.informe, juzgado: e.target.value },
                      },
                    })
                  }
                  rows={2}
                  className="input-modern min-h-[2.75rem] resize-y text-sm"
                />
              </label>
              <label className="block space-y-1">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <MapPin className="h-3 w-3 text-slate-400" aria-hidden />
                  Dirección
                </span>
                <textarea
                  value={m.informe.direccion}
                  onChange={(e) =>
                    persistMembrete({
                      ...data,
                      membrete: {
                        ...m,
                        informe: { ...m.informe, direccion: e.target.value },
                      },
                    })
                  }
                  rows={2}
                  className="input-modern min-h-[2.75rem] resize-y text-sm"
                />
              </label>
              <label className="block space-y-1 lg:col-span-2">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <Mail className="h-3 w-3 text-slate-400" aria-hidden />
                  Correo
                </span>
                <input
                  type="email"
                  value={m.informe.correo}
                  onChange={(e) =>
                    persistMembrete({
                      ...data,
                      membrete: {
                        ...m,
                        informe: { ...m.informe, correo: e.target.value },
                      },
                    })
                  }
                  className="input-modern text-sm"
                />
              </label>
            </div>
          </div>
        </details>

        <p className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
          <button
            type="button"
            onClick={onResetDefaults}
            className="inline-flex items-center gap-1.5 font-semibold text-slate-600 underline decoration-slate-300 underline-offset-2 transition hover:text-accent hover:decoration-accent/40"
          >
            <RotateCcw className="h-3 w-3 shrink-0" aria-hidden />
            Restaurar membrete por defecto del sistema
          </button>
          <span className="hidden sm:inline">·</span>
          <span className="text-slate-400">Incluye borrar el diseño libre guardado.</span>
        </p>
      </div>
    </section>
  );
}
