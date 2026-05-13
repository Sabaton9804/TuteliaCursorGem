import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Circle, Eraser, Minus, Pencil, Sparkles, Trash2 } from 'lucide-react';
import type { FreehandStrokeTool, FreehandStrokeV1, PreviewSketchV1 } from '../../lib/review-markup-payload';
import { emptyPreviewSketch } from '../../lib/review-markup-payload';

const EMPTY_SKETCH = emptyPreviewSketch();

type Props = {
  value: PreviewSketchV1 | undefined;
  onChange: (next: PreviewSketchV1) => void;
  readOnly?: boolean;
  /** Si se pasa, la barra de herramientas se renderiza aquí (p. ej. banda sticky del preview). */
  toolbarPortalEl?: HTMLDivElement | null;
};

const COLORS = ['#0f172a', '#b91c1c', '#1d4ed8', '#15803d'];

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}`;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function circleFromTwoPoints(a: { x: number; y: number }, b: { x: number; y: number }, steps = 36): Array<{ x: number; y: number }> {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const r = Math.max(0.002, dist(a, b) / 2);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    pts.push({ x: cx + (r * Math.cos(t)) / 1, y: cy + (r * Math.sin(t)) / 1 });
  }
  return pts;
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: FreehandStrokeV1,
  w: number,
  h: number,
): void {
  if (!stroke.points.length) return;
  const pts = stroke.points.map((p) => ({ x: p.x * w, y: p.y * h }));
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = Math.max(1, stroke.widthPx);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = Math.max(8, stroke.widthPx * 2);
  } else {
    ctx.globalAlpha = 1;
  }

  if (stroke.tool === 'arrow' && pts.length >= 2) {
    const [p0, p1] = pts;
    const dx = p1!.x - p0!.x;
    const dy = p1!.y - p0!.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const head = 12;
    const wing = 7;
    ctx.beginPath();
    ctx.moveTo(p0!.x, p0!.y);
    ctx.lineTo(p1!.x, p1!.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p1!.x, p1!.y);
    ctx.lineTo(p1!.x - ux * head + uy * wing, p1!.y - uy * head - ux * wing);
    ctx.lineTo(p1!.x - ux * head - uy * wing, p1!.y - uy * head + ux * wing);
    ctx.closePath();
    ctx.fillStyle = stroke.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  if (stroke.tool === 'circle' && pts.length >= 2) {
    const cpts = circleFromTwoPoints(pts[0]!, pts[1]!);
    ctx.beginPath();
    ctx.moveTo(cpts[0]!.x, cpts[0]!.y);
    for (let i = 1; i < cpts.length; i += 1) {
      ctx.lineTo(cpts[i]!.x, cpts[i]!.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i += 1) {
    ctx.lineTo(pts[i]!.x, pts[i]!.y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Capa canvas encima de la vista previa: trazos libres, resaltador grueso, flecha y círculo (dos clics / arrastre).
 */
export function PreviewFreehandSketch({ value, onChange, readOnly, toolbarPortalEl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [tool, setTool] = useState<FreehandStrokeTool>('pen');
  const [color, setColor] = useState(COLORS[0]!);
  const [widthPx, setWidthPx] = useState(2);
  const draftRef = useRef<{ tool: FreehandStrokeTool; color: string; widthPx: number; points: Array<{ x: number; y: number }> } | null>(null);
  const sketch = value?.strokes?.length ? value : (value ?? EMPTY_SKETCH);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w < 2 || h < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const s of sketch.strokes) {
      drawStroke(ctx, s, w, h);
    }
    const d = draftRef.current;
    if (d?.points.length) {
      drawStroke(
        ctx,
        {
          id: 'draft',
          tool: d.tool,
          color: d.color,
          widthPx: d.widthPx,
          points: d.points,
        },
        w,
        h,
      );
    }
  }, [sketch.strokes]);

  useEffect(() => {
    redraw();
  }, [redraw, value]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  const normPoint = (e: React.PointerEvent): { x: number; y: number } | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    const x = (e.clientX - r.left) / Math.max(1, r.width);
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  };

  const commitStroke = (stroke: FreehandStrokeV1) => {
    if (stroke.points.length < 2 && stroke.tool !== 'pen') return;
    if (stroke.tool === 'pen' && stroke.points.length < 2) return;
    const next: PreviewSketchV1 = { v: 1, strokes: [...sketch.strokes, stroke] };
    onChange(next);
    draftRef.current = null;
    redraw();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly || !drawMode) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = normPoint(e);
    if (!p) return;
    if (tool === 'arrow' || tool === 'circle') {
      draftRef.current = { tool, color, widthPx, points: [p] };
      return;
    }
    draftRef.current = { tool, color, widthPx, points: [p] };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (readOnly || !drawMode || !draftRef.current) return;
    const p = normPoint(e);
    if (!p) return;
    if (tool === 'pen' || tool === 'highlighter') {
      const d = draftRef.current;
      const last = d.points[d.points.length - 1];
      if (last && dist(last, p) < 0.0015) return;
      d.points.push(p);
      redraw();
      return;
    }
    if ((tool === 'arrow' || tool === 'circle') && draftRef.current.points.length === 1) {
      draftRef.current.points[1] = p;
      redraw();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (readOnly || !drawMode || !draftRef.current) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const d = draftRef.current;
    const p = normPoint(e);
    if (tool === 'arrow' || tool === 'circle') {
      if (p && d.points[0]) {
        d.points[1] = p;
      }
      if (d.points.length >= 2) {
        commitStroke({
          id: newId(),
          tool,
          color,
          widthPx,
          points: [...d.points],
        });
      } else {
        draftRef.current = null;
        redraw();
      }
      return;
    }
    if (d.points.length >= 2) {
      commitStroke({
        id: newId(),
        tool,
        color,
        widthPx,
        points: d.points,
      });
    } else {
      draftRef.current = null;
      redraw();
    }
  };

  const undo = () => {
    if (readOnly || sketch.strokes.length === 0) return;
    onChange({ v: 1, strokes: sketch.strokes.slice(0, -1) });
  };

  const clearAll = () => {
    if (readOnly) return;
    onChange(emptyPreviewSketch());
  };

  const toolbarInner = !readOnly ? (
    <div className="pointer-events-auto z-[7] flex max-w-[min(100%,20rem)] flex-wrap items-center gap-1 rounded-lg border border-violet-200 bg-violet-50/95 px-2 py-1.5 shadow-md">
      <button
        type="button"
        onClick={() => setDrawMode((d) => !d)}
        className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
          drawMode ? 'bg-violet-700 text-white' : 'bg-white text-violet-800 ring-1 ring-violet-200'
        }`}
      >
        {drawMode ? 'Anotar: on' : 'Anotar: off'}
      </button>
      <span className="mx-0.5 h-4 w-px bg-violet-200" aria-hidden />
      <button
        type="button"
        title="Lápiz"
        aria-label="Lápiz"
        onClick={() => setTool('pen')}
        className={`rounded p-1 ${tool === 'pen' ? 'bg-white shadow ring-1 ring-violet-300' : 'text-slate-600'}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Resaltador"
        aria-label="Resaltador"
        onClick={() => setTool('highlighter')}
        className={`rounded p-1 ${tool === 'highlighter' ? 'bg-white shadow ring-1 ring-violet-300' : 'text-slate-600'}`}
      >
        <Sparkles className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Flecha (arrastre)"
        aria-label="Flecha"
        onClick={() => setTool('arrow')}
        className={`rounded p-1 ${tool === 'arrow' ? 'bg-white shadow ring-1 ring-violet-300' : 'text-slate-600'}`}
      >
        <Minus className="h-3.5 w-3.5 rotate-[-45deg]" />
      </button>
      <button
        type="button"
        title="Círculo (arrastre diagonal)"
        aria-label="Círculo"
        onClick={() => setTool('circle')}
        className={`rounded p-1 ${tool === 'circle' ? 'bg-white shadow ring-1 ring-violet-300' : 'text-slate-600'}`}
      >
        <Circle className="h-3.5 w-3.5" />
      </button>
      <span className="mx-0.5 h-4 w-px bg-violet-200" aria-hidden />
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Color ${c}`}
          onClick={() => setColor(c)}
          className={`h-5 w-5 rounded-full border-2 ${color === c ? 'border-violet-700' : 'border-white shadow'}`}
          style={{ backgroundColor: c }}
        />
      ))}
      <span className="mx-0.5 h-4 w-px bg-violet-200" aria-hidden />
      <label className="flex items-center gap-1 text-[10px] text-slate-600">
        Grosor
        <input
          type="range"
          min={1}
          max={8}
          value={widthPx}
          onChange={(ev) => setWidthPx(Number(ev.target.value))}
          className="w-16"
        />
      </label>
      <button
        type="button"
        onClick={undo}
        disabled={sketch.strokes.length === 0}
        className="rounded p-1 text-slate-600 hover:bg-white disabled:opacity-30"
        title="Deshacer último trazo"
        aria-label="Deshacer último trazo"
      >
        <Eraser className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={clearAll}
        disabled={sketch.strokes.length === 0}
        className="rounded p-1 text-rose-700 hover:bg-white disabled:opacity-30"
        title="Borrar todas las anotaciones"
        aria-label="Borrar todas las anotaciones"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[6]">
      {toolbarInner && toolbarPortalEl ? createPortal(toolbarInner, toolbarPortalEl) : null}
      {toolbarInner && !toolbarPortalEl ? (
        <div className="pointer-events-auto absolute right-2 top-2 z-[7]">{toolbarInner}</div>
      ) : null}
      <div ref={wrapRef} className="pointer-events-none absolute inset-0">
        <canvas
          ref={canvasRef}
          className={`absolute left-0 top-0 h-full w-full ${drawMode && !readOnly ? 'pointer-events-auto touch-none' : 'pointer-events-none'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
}
