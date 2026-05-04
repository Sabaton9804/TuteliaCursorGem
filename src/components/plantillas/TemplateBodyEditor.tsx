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
  defectoJustifyCuerpoInformeEnDoc,
  plainTextToTiptapDoc,
  docToStorage,
} from '../../lib/tiptap-template-storage';
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
      let doc = plainTextToTiptapDoc(textoPlano);
      if (templateTipo === 'informe_ingreso') {
        doc = defectoJustifyCuerpoInformeEnDoc(doc);
      }
      onChange(docToStorage(doc));
    },
    [onChange, templateTipo],
  );

  /** Altura mínima modesta: el contenido crece con el texto (sin «ventana» fija a media pantalla). */
  const minH = minRows >= 16 ? 'min-h-[12rem]' : 'min-h-[10rem]';

  return (
    <div className="bg-transparent">
      <span className="sr-only">{label}</span>
      {/* Controles mínimos: sin caja alrededor del documento */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/35 pb-2">
        <div className="flex gap-0.5 rounded-md p-0.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPestana('visual')}
            className={`rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition sm:px-3 sm:text-[11px] ${
              pestana === 'visual'
                ? 'bg-slate-200/45 text-slate-900'
                : 'text-slate-600 hover:bg-slate-100/50'
            }`}
          >
            Redacción
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPestana('plano')}
            className={`rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition sm:px-3 sm:text-[11px] ${
              pestana === 'plano'
                ? 'bg-slate-200/45 text-slate-900'
                : 'text-slate-600 hover:bg-slate-100/50'
            }`}
          >
            Texto plano
          </button>
        </div>
        <div
          className="relative min-w-0 max-w-full flex-1 sm:max-w-[min(100%,280px)] sm:flex-initial"
          onPointerDownCapture={pestana === 'plano' ? guardarSeleccion : undefined}
        >
          <label className="sr-only" htmlFor="template-body-insertar-dato">
            Insertar dato del expediente en el cursor
          </label>
          <select
            id="template-body-insertar-dato"
            key={menuMarcadoresKey}
            disabled={disabled}
            defaultValue=""
            onChange={(e) => {
              alElegirMarcador(e.target.value);
            }}
            className="h-9 w-full max-w-[min(100%,17rem)] cursor-pointer appearance-none bg-transparent pr-7 text-xs font-medium text-slate-700 underline decoration-slate-300 decoration-dotted underline-offset-[5px] hover:decoration-slate-500 disabled:opacity-50 sm:text-sm"
          >
            <option value="">Insertar dato…</option>
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
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

      <div className="bg-transparent px-0 py-0">
        {pestana === 'visual' ? (
          <Suspense
            fallback={
              <div className={`animate-pulse bg-slate-50/40 ${minH}`} aria-hidden />
            }
          >
            <div className="font-serif text-[15px] leading-relaxed text-slate-900 [text-align:justify]">
              <TiptapTemplateEditor
                ref={tipTapRef}
                value={value}
                onChange={onChange}
                resolveLabel={resolveLabel}
                placeholder={placeholder ?? '…'}
                disabled={disabled}
                minHeightClass={minH}
                parseInformeBodyDefaults={templateTipo === 'informe_ingreso'}
              />
            </div>
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
            className={`input-modern w-full resize-y border-0 bg-transparent font-mono text-sm leading-relaxed text-slate-900 shadow-none ring-0 focus:ring-0 disabled:opacity-50 ${minH}`}
          />
        )}
      </div>
    </div>
  );
}
