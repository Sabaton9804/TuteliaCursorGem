import React, { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DocumentTemplateTipo } from '../../types';
import {
  etiquetaGrupo,
  marcadoresParaPlantilla,
  marcadadorFormateado,
  type GrupoMarcador,
} from '../../lib/plantilla-marcadores-catalog';
import {
  contenidoBaseToPlainForSubstitution,
  plainTextToTiptapDoc,
  docToStorage,
} from '../../lib/tiptap-template-storage';
import { MarcadoresPreview } from './MarcadoresPreview';
import type { TiptapTemplateEditorHandle } from './TiptapTemplateEditor';

const TiptapTemplateEditor = lazy(() =>
  import('./TiptapTemplateEditor').then((m) => ({ default: m.TiptapTemplateEditor })),
);

type Props = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  minRows?: number;
  disabled?: boolean;
  /** Define qué datos del expediente se ofrecen en el menú (informe, auto o todos). */
  templateTipo?: DocumentTemplateTipo;
};

export function TemplateBodyEditor({
  value,
  onChange,
  label = 'Texto del documento',
  placeholder,
  minRows = 12,
  disabled,
  templateTipo = 'libre',
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const tipTapRef = useRef<TiptapTemplateEditorHandle>(null);
  const selRef = useRef({ start: 0, end: 0 });
  const [menuMarcadoresKey, setMenuMarcadoresKey] = useState(0);
  /** Redacción visual (TipTap) o texto plano con {{ }}. */
  const [pestana, setPestana] = useState<'visual' | 'plano'>('visual');

  const marcadores = useMemo(() => marcadoresParaPlantilla(templateTipo), [templateTipo]);

  const resolveLabel = useCallback(
    (key: string) => marcadores.find((m) => m.clave === key)?.etiqueta ?? key,
    [marcadores],
  );

  const textoParaPreview = useMemo(
    () => contenidoBaseToPlainForSubstitution(value) ?? value,
    [value],
  );

  const porGrupo = useMemo(() => {
    const map = new Map<GrupoMarcador, typeof marcadores>();
    for (const m of marcadores) {
      const arr = map.get(m.grupo) ?? [];
      arr.push(m);
      map.set(m.grupo, arr);
    }
    return map;
  }, [marcadores]);

  const guardarSeleccion = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    selRef.current = { start: el.selectionStart, end: el.selectionEnd };
  }, []);

  const insertarEnCursor = useCallback(
    (fragmento: string) => {
      const el = taRef.current;
      const { start, end } = el
        ? { start: el.selectionStart, end: el.selectionEnd }
        : selRef.current;
      const before = value.slice(0, start);
      const after = value.slice(end);
      const necesitaEspacio = Boolean(before) && !/\s$/.test(before) && !/^[\s,.;:]/.test(fragmento);
      const insertado = (necesitaEspacio ? ' ' : '') + fragmento;
      const next = before + insertado + after;
      onChange(next);
      const pos = start + insertado.length;
      requestAnimationFrame(() => {
        const t = taRef.current;
        if (!t) return;
        t.focus();
        t.setSelectionRange(pos, pos);
        selRef.current = { start: pos, end: pos };
      });
    },
    [onChange, value],
  );

  const alElegirMarcador = useCallback(
    (clave: string) => {
      if (!clave) return;
      if (pestana === 'visual') {
        tipTapRef.current?.insertVariable(clave);
      } else {
        insertarEnCursor(marcadadorFormateado(clave));
      }
      setMenuMarcadoresKey((k) => k + 1);
    },
    [insertarEnCursor, pestana],
  );

  const textoPlanoParaArea = contenidoBaseToPlainForSubstitution(value) ?? '';

  const alCambiarTextoPlano = useCallback(
    (textoPlano: string) => {
      onChange(docToStorage(plainTextToTiptapDoc(textoPlano)));
    },
    [onChange],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200/90 bg-slate-50/60 px-4 py-3">
        <p className="text-xs leading-relaxed text-slate-700">
          <strong className="font-semibold text-slate-900">Redacción guiada.</strong> Use la pestaña{' '}
          <strong className="text-slate-800">Redacción</strong> para formato tipo procesador y el menú desplegable: los datos del
          expediente aparecen como etiquetas (sin escribir códigos). Si necesita ver o pegar solo texto con{' '}
          <code className="rounded bg-white px-1 font-mono text-[11px]">{'{{ }}'}</code>, use{' '}
          <strong className="text-slate-800">Texto plano</strong>.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[min(100%,280px)] flex-1 space-y-1.5">
          <span className="text-[11px] font-semibold text-slate-700">Insertar dato en la posición del cursor</span>
          <div className="relative" onPointerDownCapture={pestana === 'plano' ? guardarSeleccion : undefined}>
            <select
              key={menuMarcadoresKey}
              disabled={disabled}
              defaultValue=""
              onChange={(e) => {
                alElegirMarcador(e.target.value);
              }}
              className="input-modern w-full appearance-none bg-white pr-10 text-sm font-medium text-slate-800 disabled:opacity-50"
            >
              <option value="">— Elegir dato a insertar —</option>
              {(['partes', 'fechas', 'proceso', 'juzgado', 'otros'] as GrupoMarcador[]).map((g) => {
                const items = porGrupo.get(g);
                if (!items?.length) return null;
                return (
                  <optgroup key={g} label={etiquetaGrupo(g)}>
                    {items.map((m) => (
                      <option key={m.clave} value={m.clave}>
                        {m.etiqueta}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-100/80 p-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPestana('visual')}
            className={`rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition ${
              pestana === 'visual'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:bg-white/60'
            }`}
          >
            Redacción
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPestana('plano')}
            className={`rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition ${
              pestana === 'plano'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:bg-white/60'
            }`}
          >
            Texto plano
          </button>
        </div>

        <label className="block space-y-1.5">
          <span className="text-[11px] font-semibold text-slate-600">{label}</span>
          {pestana === 'visual' ? (
            <Suspense
              fallback={
                <div
                  className={`animate-pulse rounded-lg border border-slate-200 bg-slate-50 ${minRows >= 16 ? 'min-h-[18rem]' : 'min-h-[14rem]'}`}
                  aria-hidden
                />
              }
            >
              <TiptapTemplateEditor
                ref={tipTapRef}
                value={value}
                onChange={onChange}
                resolveLabel={resolveLabel}
                placeholder={placeholder}
                disabled={disabled}
                minHeightClass={minRows >= 16 ? 'min-h-[18rem]' : 'min-h-[14rem]'}
              />
            </Suspense>
          ) : (
            <textarea
              ref={taRef}
              value={textoPlanoParaArea}
              onChange={(e) => alCambiarTextoPlano(e.target.value)}
              onSelect={guardarSeleccion}
              onKeyUp={guardarSeleccion}
              onMouseUp={guardarSeleccion}
              onBlur={guardarSeleccion}
              placeholder={placeholder}
              disabled={disabled}
              spellCheck={false}
              rows={minRows}
              className="input-modern min-h-[14rem] w-full resize-y font-mono text-sm leading-relaxed text-slate-900 disabled:opacity-50"
            />
          )}
        </label>
      </div>

      <details className="group rounded-xl border border-slate-100 bg-white">
        <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold text-slate-600 marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            Ver vista previa (variables resaltadas)
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 text-slate-400" />
          </span>
        </summary>
        <div className="border-t border-slate-100 px-4 pb-4 pt-2">
          <MarcadoresPreview text={textoParaPreview} />
        </div>
      </details>
    </div>
  );
}
