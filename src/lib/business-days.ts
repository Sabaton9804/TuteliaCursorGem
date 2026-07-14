import Holidays from 'date-holidays';
import {
  IMPUGNACION_BUSINESS_DAYS,
  PLAZO_FALLAR_PRIMERA_DIAS,
  PLAZO_FALLAR_SEGUNDA_DIAS,
} from './decreto-2591-plazos';

export { IMPUGNACION_BUSINESS_DAYS, PLAZO_FALLAR_PRIMERA_DIAS, PLAZO_FALLAR_SEGUNDA_DIAS };

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

/** Caché por día local: evita llamar date-holidays miles de veces al pintar listados. */
const nonBusinessDayCache = new Map<string, boolean>();
const easterCache = new Map<number, { startMs: number; endMs: number }>();

export function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function ymdLocal(d: Date): string {
  const x = startOfLocalDay(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isJudicialVacationYmd(s: string): boolean {
  return JUDICIAL_VACATION_PERIODS.some(({ from, to }) => s >= from && s <= to);
}

function isDiaDeLaRamaYmd(s: string): boolean {
  return s.slice(5) === '12-17';
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

function semanaSantaBounds(year: number): { startMs: number; endMs: number } {
  let hit = easterCache.get(year);
  if (hit) return hit;
  const easter = startOfLocalDay(easterSundayGregorian(year));
  const start = new Date(easter);
  start.setDate(start.getDate() - 7);
  hit = { startMs: start.getTime(), endMs: easter.getTime() };
  easterCache.set(year, hit);
  return hit;
}

function isSemanaSantaCompletaMs(t: number, year: number): boolean {
  const { startMs, endMs } = semanaSantaBounds(year);
  return t >= startMs && t <= endMs;
}

function isColombianPublicOrBankHoliday(d: Date): boolean {
  const hits = colombiaHolidays.isHoliday(startOfLocalDay(d));
  if (!hits) return false;
  return hits.some((h) => h.type === 'public' || h.type === 'bank');
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Inhábil para cómputo de días hábiles (fin de semana, festivo CO, Semana Santa ampliada, 17-dic, vacancia). */
export function isNonBusinessDayColombia(d: Date): boolean {
  const day = startOfLocalDay(d);
  const key = ymdLocal(day);
  const cached = nonBusinessDayCache.get(key);
  if (cached !== undefined) return cached;

  let nonBusiness = false;
  const dow = day.getDay();
  if (dow === 0 || dow === 6) {
    nonBusiness = true;
  } else if (isJudicialVacationYmd(key) || isDiaDeLaRamaYmd(key)) {
    nonBusiness = true;
  } else if (isSemanaSantaCompletaMs(day.getTime(), day.getFullYear())) {
    nonBusiness = true;
  } else if (isColombianPublicOrBankHoliday(day)) {
    nonBusiness = true;
  }

  nonBusinessDayCache.set(key, nonBusiness);
  return nonBusiness;
}

export function isBusinessDayColombia(d: Date): boolean {
  return !isNonBusinessDayColombia(d);
}

/** Tope de recorrido (~5 años) — listados no deben recorrer décadas. */
const MAX_INCLUSIVE_DAY_SPAN = 365 * 5;

/** Cuenta días hábiles entre dos fechas (inclusive en ambos extremos). */
export function inclusiveBusinessDaysBetween(from: Date, to: Date): number {
  const a = startOfLocalDay(from).getTime();
  const b = startOfLocalDay(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  if (a > b) return inclusiveBusinessDaysBetween(to, from);
  const dayMs = 24 * 60 * 60 * 1000;
  if ((b - a) / dayMs > MAX_INCLUSIVE_DAY_SPAN) {
    console.warn('[business-days] rango excesivo; se omite cómputo inclusive');
    return 0;
  }
  let n = 0;
  const cur = new Date(a);
  let guard = 0;
  while (cur.getTime() <= b) {
    if (isBusinessDayColombia(cur)) n += 1;
    cur.setDate(cur.getDate() + 1);
    if (++guard > MAX_INCLUSIVE_DAY_SPAN) break;
  }
  return n;
}

/**
 * Ventana de N días hábiles desde radicación (día de radicación = día 1).
 * Días restantes = (N + 1) − días hábiles transcurridos (inclusive radicación y hoy).
 *
 * Implementación: calcula fin de término y cuenta solo el tramo [hoy, fin]
 * (O(plazo), no O(años desde radicación)). Evita congelar el UI con ~800 expedientes.
 */
export function businessDaysRemainingInTermWindow(
  filingDate: Date,
  termBusinessDays: number,
  today = new Date(),
): number {
  if (!Number.isFinite(termBusinessDays) || termBusinessDays <= 0) return 0;
  const end = businessDayTermEnd(filingDate, termBusinessDays);
  return businessDaysRemainingWithStoredTermDeadline(filingDate, end, termBusinessDays, today);
}

/**
 * Ventana de 10 días hábiles desde radicación (día de radicación = aún 10 días por delante).
 * Días restantes = 11 - días hábiles transcurridos (inclusive radicación y hoy).
 */
export function businessDaysRemainingInTenDayWindow(filingDate: Date, today = new Date()): number {
  return businessDaysRemainingInTermWindow(filingDate, 10, today);
}

/**
 * Misma semántica que `businessDaysRemainingInTermWindow` cuando el fin del término ya está en BD.
 * Cuenta solo desde hoy hasta el deadline (barato), no desde la radicación.
 */
export function businessDaysRemainingWithStoredTermDeadline(
  _filingDate: Date,
  termEndDeadline: Date,
  _termBusinessDays: number,
  today = new Date(),
): number {
  const end = startOfLocalDay(termEndDeadline);
  const t = startOfLocalDay(today);
  if (!Number.isFinite(end.getTime()) || !Number.isFinite(t.getTime())) return 0;
  if (t.getTime() > end.getTime()) return 0;
  return inclusiveBusinessDaysBetween(t, end);
}

/**
 * Igual que {@link businessDaysRemainingWithStoredTermDeadline} con término de 10 días hábiles (tutela).
 */
export function businessDaysRemainingWithStoredDeadline(
  filingDate: Date,
  termEndDeadline: Date,
  today = new Date(),
): number {
  return businessDaysRemainingWithStoredTermDeadline(filingDate, termEndDeadline, 10, today);
}

export function addBusinessDays(start: Date, businessDays: number): Date {
  const d = startOfLocalDay(start);
  if (!Number.isFinite(d.getTime()) || !Number.isFinite(businessDays) || businessDays <= 0) {
    return d;
  }
  let added = 0;
  let guard = 0;
  const maxSteps = Math.max(businessDays * 4, 1) + 40;
  while (added < businessDays && guard++ < maxSteps) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDayColombia(d)) added += 1;
  }
  return d;
}

/** Fecha del último día del término de 10 días hábiles (día 10 hábil desde radicación, radicación = día 1). */
export function tenthBusinessDayDeadline(filingDate: Date): Date {
  return businessDayTermEnd(filingDate, 10);
}

/** Último día de un término de N días hábiles (fecha de inicio = día 1). */
export function businessDayTermEnd(startDate: Date, termBusinessDays: number): Date {
  const d = startOfLocalDay(startDate);
  if (!Number.isFinite(d.getTime()) || !Number.isFinite(termBusinessDays) || termBusinessDays <= 1) {
    return d;
  }
  let counted = 1;
  let guard = 0;
  const maxSteps = Math.max(termBusinessDays * 4, 1) + 40;
  while (counted < termBusinessDays && guard++ < maxSteps) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDayColombia(d)) counted += 1;
  }
  return d;
}

/**
 * Último día de un término de N días hábiles **siguientes** al evento (el día del evento no cuenta).
 * Ej.: impugnación art. 31 D.2591/91; remisión art. 32; contestación tras notificación.
 */
export function businessDayTermEndAfterEvent(eventDate: Date, termBusinessDays: number): Date {
  return addBusinessDays(startOfLocalDay(eventDate), termBusinessDays);
}

/** Plazo para que accionados/entidad contesten tras notificar el auto admisorio (práctica despacho; informes art. 19: 1–3 días). */
export const CONTESTACION_BUSINESS_DAYS = 2;

export function contestacionDeadlineFrom(notifiedOn: Date): Date {
  return businessDayTermEndAfterEvent(notifiedOn, CONTESTACION_BUSINESS_DAYS);
}

export function impugnacionDeadlineFrom(notifiedOn: Date): Date {
  return businessDayTermEndAfterEvent(notifiedOn, IMPUGNACION_BUSINESS_DAYS);
}
