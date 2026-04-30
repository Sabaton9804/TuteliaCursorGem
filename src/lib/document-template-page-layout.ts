import type { DocumentTemplatePageLayout } from '../types';

export { PAGE_FONT_CHOICES } from './page-font-choices';

export const DEFAULT_PAGE_LAYOUT: DocumentTemplatePageLayout = {
  /** Alineado al preajuste «Normal» de Word (es-ES): 2,5 cm sup./inf., 3 cm izq./der. */
  marginMm: { top: 25, right: 30, bottom: 25, left: 30 },
  fontFamily: 'Times New Roman',
  fontSizePt: 12,
};

/** Preajustes tipo Word (Disposición → Márgenes); valores en mm. */
export const PAGE_MARGIN_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  subtitle: string;
  marginMm: DocumentTemplatePageLayout['marginMm'];
}> = [
  {
    id: 'normal',
    label: 'Normal',
    subtitle: 'Sup./Inf. 2,5 cm · Izq./Der. 3 cm',
    marginMm: { top: 25, bottom: 25, left: 30, right: 30 },
  },
  {
    id: 'narrow',
    label: 'Estrecho',
    subtitle: '1,27 cm en todos los lados',
    marginMm: { top: 12.7, bottom: 12.7, left: 12.7, right: 12.7 },
  },
  {
    id: 'moderate',
    label: 'Moderado',
    subtitle: 'Sup./Inf. 2,54 cm · Izq./Der. 1,91 cm',
    marginMm: { top: 25.4, bottom: 25.4, left: 19.1, right: 19.1 },
  },
  {
    id: 'wide',
    label: 'Ancho',
    subtitle: 'Sup./Inf. 2,54 cm · Izq./Der. 5,08 cm',
    marginMm: { top: 25.4, bottom: 25.4, left: 50.8, right: 50.8 },
  },
];

export function matchMarginPresetId(m: DocumentTemplatePageLayout['marginMm']): string | null {
  const eps = 0.15;
  for (const p of PAGE_MARGIN_PRESETS) {
    const x = p.marginMm;
    if (
      Math.abs(m.top - x.top) < eps &&
      Math.abs(m.bottom - x.bottom) < eps &&
      Math.abs(m.left - x.left) < eps &&
      Math.abs(m.right - x.right) < eps
    ) {
      return p.id;
    }
  }
  return null;
}

const MM_MIN = 10;
const MM_MAX = 60;
const PT_MIN = 8;
const PT_MAX = 18;

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function sanitizeFont(name: string): string {
  const t = name.trim().slice(0, 80);
  if (!/^[\p{L}\p{N}\s.,'\-()]+$/u.test(t)) {
    return DEFAULT_PAGE_LAYOUT.fontFamily;
  }
  return t || DEFAULT_PAGE_LAYOUT.fontFamily;
}

/**
 * Valida y completa; si en BD hay null o JSON incompleto, rellena con el predeterminado.
 */
export function mergePageLayout(
  raw: DocumentTemplatePageLayout | null | undefined,
): DocumentTemplatePageLayout {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PAGE_LAYOUT, marginMm: { ...DEFAULT_PAGE_LAYOUT.marginMm } };
  const m = raw.marginMm;
  const marginMm = {
    top: clamp(typeof m?.top === 'number' ? m.top : DEFAULT_PAGE_LAYOUT.marginMm.top, MM_MIN, MM_MAX),
    right: clamp(typeof m?.right === 'number' ? m.right : DEFAULT_PAGE_LAYOUT.marginMm.right, MM_MIN, MM_MAX),
    bottom: clamp(typeof m?.bottom === 'number' ? m.bottom : DEFAULT_PAGE_LAYOUT.marginMm.bottom, MM_MIN, MM_MAX),
    left: clamp(typeof m?.left === 'number' ? m.left : DEFAULT_PAGE_LAYOUT.marginMm.left, MM_MIN, MM_MAX),
  };
  const fontSizePt = clamp(
    typeof raw.fontSizePt === 'number' ? raw.fontSizePt : DEFAULT_PAGE_LAYOUT.fontSizePt,
    PT_MIN,
    PT_MAX,
  );
  const fontFamily = typeof raw.fontFamily === 'string' ? sanitizeFont(raw.fontFamily) : DEFAULT_PAGE_LAYOUT.fontFamily;
  return { marginMm, fontFamily, fontSizePt };
}

/** Mitad de puntos para la API de docx (12 pt → 24). */
export function fontSizeToHalfPoints(pt: number): number {
  return Math.round(clamp(pt, PT_MIN, PT_MAX) * 2);
}
