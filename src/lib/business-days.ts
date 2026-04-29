import Holidays from 'date-holidays';

/**
 * Días hábiles al estilo despacho judicial en Colombia:
 * - excluye sábados y domingos;
 * - festivos nacionales (Ley 51/1983 y reglas del calendario CO en date-holidays);
 * - Semana Santa completa: desde Domingo de Ramos hasta Domingo de Pascua (inclusive);
 * - 17 de diciembre (Día de la Rama / conmemoración Rama Judicial, inhábil para cómputo aquí);
 * - vacancia judicial de fin de año (fechas según circular CSJ; actualizar cada año).
 *
 * Las fechas se interpretan en calendario local (misma base que `startOfLocalDay` en el resto de la app).
 */

const colombiaHolidays = new Holidays('CO', {
  languages: 'es',
  timezone: 'America/Bogota',
});

/** Rangos inclusive YYYY-MM-DD. Actualizar con el comunicado anual del Consejo Superior de la Judicatura. */
const JUDICIAL_VACATION_PERIODS: readonly { readonly from: string; readonly to: string }[] = [
  { from: '2025-12-20', to: '2026-01-10' },
  /** Preliminar: mismo patrón habitual hasta circular oficial. */
  { from: '2026-12-20', to: '2027-01-10' },
];

function ymdLocal(d: Date): string {
  const x = startOfLocalDay(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isJudicialVacation(d: Date): boolean {
  const s = ymdLocal(d);
  return JUDICIAL_VACATION_PERIODS.some(({ from, to }) => s >= from && s <= to);
}

/** 17 de diciembre — Día de la Rama (Rama Judicial), tratado como inhábil para el cómputo. */
function isDiaDeLaRama(d: Date): boolean {
  const x = startOfLocalDay(d);
  return x.getMonth() === 11 && x.getDate() === 17;
}

/** Domingo de Pascua (calendario gregoriano occidental). */
function easterSundayGregorian(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Semana Santa completa: Domingo de Ramos (easter − 7) hasta Domingo de Pascua (easter), inclusive. */
function isSemanaSantaCompleta(d: Date): boolean {
  const y = startOfLocalDay(d).getFullYear();
  const easter = startOfLocalDay(easterSundayGregorian(y));
  const start = new Date(easter);
  start.setDate(start.getDate() - 7);
  const t = startOfLocalDay(d).getTime();
  return t >= start.getTime() && t <= easter.getTime();
}

function isColombianPublicOrBankHoliday(d: Date): boolean {
  const hits = colombiaHolidays.isHoliday(startOfLocalDay(d));
  if (!hits) return false;
  return hits.some((h) => h.type === 'public' || h.type === 'bank');
}

export function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Inhábil para cómputo de días hábiles (fin de semana, festivo CO, Semana Santa ampliada, 17-dic, vacancia). */
export function isNonBusinessDayColombia(d: Date): boolean {
  if (isWeekend(d)) return true;
  if (isJudicialVacation(d)) return true;
  if (isDiaDeLaRama(d)) return true;
  if (isSemanaSantaCompleta(d)) return true;
  if (isColombianPublicOrBankHoliday(d)) return true;
  return false;
}

export function isBusinessDayColombia(d: Date): boolean {
  return !isNonBusinessDayColombia(d);
}

/** Cuenta días hábiles entre dos fechas (inclusive en ambos extremos). */
export function inclusiveBusinessDaysBetween(from: Date, to: Date): number {
  const a = startOfLocalDay(from).getTime();
  const b = startOfLocalDay(to).getTime();
  if (a > b) return inclusiveBusinessDaysBetween(to, from);
  let n = 0;
  const cur = new Date(a);
  while (cur.getTime() <= b) {
    if (isBusinessDayColombia(cur)) n += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

/**
 * Ventana de 10 días hábiles desde radicación (día de radicación = aún 10 días por delante).
 * Días restantes = 11 - días hábiles transcurridos (inclusive radicación y hoy).
 */
export function businessDaysRemainingInTenDayWindow(filingDate: Date, today = new Date()): number {
  const used = inclusiveBusinessDaysBetween(filingDate, today);
  return 11 - used;
}

export function addBusinessDays(start: Date, businessDays: number): Date {
  const d = startOfLocalDay(start);
  let added = 0;
  while (added < businessDays) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDayColombia(d)) added += 1;
  }
  return d;
}

/** Fecha del último día del término de 10 días hábiles (día 10 hábil desde radicación, radicación = día 1). */
export function tenthBusinessDayDeadline(filingDate: Date): Date {
  const d = startOfLocalDay(filingDate);
  let counted = 1;
  while (counted < 10) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDayColombia(d)) counted += 1;
  }
  return d;
}
