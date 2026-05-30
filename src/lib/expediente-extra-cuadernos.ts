export type ExpedienteCuadernoExtra = { code: string; label: string };

const STORAGE_PREFIX = 'tutelia:expediente_cuadernos_extra:';

export function isMissingExpedienteCuadernosExtraColumn(err: unknown): boolean {
  const msg = String(
    err && typeof err === 'object' && 'message' in err ? (err as { message: string }).message : err
  );
  const code = String(err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '');
  return (
    code === 'PGRST204' ||
    (/expediente_cuadernos_extra/i.test(msg) &&
      (/schema cache/i.test(msg) || /could not find/i.test(msg)))
  );
}

export function loadLocalExtraCuadernos(caseId: string): ExpedienteCuadernoExtra[] {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${caseId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((e) => ({
        code: String((e as { code?: string }).code || '').trim(),
        label: String((e as { label?: string }).label || '').trim(),
      }))
      .filter((e) => e.code && e.label);
  } catch {
    return [];
  }
}

export function saveLocalExtraCuadernos(caseId: string, list: ExpedienteCuadernoExtra[]): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${caseId}`, JSON.stringify(list));
  } catch {
    /* quota / private mode */
  }
}

export function mergeExtraCuadernos(
  fromCase: ExpedienteCuadernoExtra[] | undefined,
  local: ExpedienteCuadernoExtra[]
): ExpedienteCuadernoExtra[] {
  const out: ExpedienteCuadernoExtra[] = [];
  const seen = new Set<string>();
  for (const e of [...(fromCase || []), ...local]) {
    const code = (e.code || '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, label: (e.label || '').trim() || code });
  }
  return out;
}
