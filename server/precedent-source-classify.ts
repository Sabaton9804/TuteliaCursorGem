export type PrecedentSourceType = 'despacho' | 'jurisprudencia';

export type CourtMetaForPrecedent = {
  displayName: string;
  daneCode: string;
  entityCode: string;
  specialtyCode: string;
  despachoNumber: string;
};

const HIGH_COURT_RE =
  /corte\s+constitucional|corte\s+suprema|consejo\s+de\s+estado|tribunal\s+superior|corte\s+interamericana|sala\s+(civil|laboral|penal)\s+de\s+la\s+corte/i;

function normalizeLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function digitsOnly(radicado: string): string {
  return radicado.replace(/\D/g, '');
}

/** Primeros 16 dígitos del CUI (territorio + entidad + especialidad + despacho + año). */
export function radicadoBelongsToCourt(radicado: string, court: CourtMetaForPrecedent): boolean {
  const d = digitsOnly(radicado);
  if (d.length !== 23) return false;
  const prefix = `${court.daneCode}${court.entityCode}${court.specialtyCode}${court.despachoNumber}`;
  if (prefix.replace(/\D/g, '').length < 12) return false;
  return d.startsWith(prefix);
}

export function isExternalHighCourtCorporation(corporation: string): boolean {
  const n = normalizeLabel(corporation);
  if (!n) return false;
  return HIGH_COURT_RE.test(n);
}

export function corporationMatchesCourt(corporation: string, court: CourtMetaForPrecedent): boolean {
  const corp = normalizeLabel(corporation);
  const name = normalizeLabel(court.displayName);
  if (!corp || !name) return false;
  if (corp.includes(name) || name.includes(corp)) return true;
  const desp = court.despachoNumber.replace(/\D/g, '');
  if (desp && corp.includes(desp)) return true;
  const juzgadoNum = name.match(/juzgado\s*(\d{2,3})/i)?.[1];
  if (juzgadoNum && corp.includes(juzgadoNum)) return true;
  if (corp.includes('juzgado') && name.includes('juzgado') && desp && corp.includes(desp)) return true;
  return false;
}

export type ClassifyPrecedentSourceResult = {
  sourceType: PrecedentSourceType;
  sourceCorporation: string | null;
  reason: string;
};

/**
 * Clasifica si el fallo es del despacho del usuario o jurisprudencia externa,
 * usando corporación extraída por IA y radicado CUI cuando aplique.
 */
export function classifyPrecedentSource(opts: {
  court: CourtMetaForPrecedent;
  sourceCorporation: string;
  radicado: string;
  userHint?: PrecedentSourceType | null;
}): ClassifyPrecedentSourceResult {
  const corp = String(opts.sourceCorporation || '').trim();
  const corpNorm = normalizeLabel(corp);

  if (opts.userHint === 'despacho' || opts.userHint === 'jurisprudencia') {
    return {
      sourceType: opts.userHint,
      sourceCorporation: opts.userHint === 'jurisprudencia' ? corp || null : null,
      reason: 'hint_usuario',
    };
  }

  if (radicadoBelongsToCourt(opts.radicado, opts.court)) {
    return {
      sourceType: 'despacho',
      sourceCorporation: null,
      reason: 'radicado_cui_despacho',
    };
  }

  if (corp && corporationMatchesCourt(corp, opts.court)) {
    return {
      sourceType: 'despacho',
      sourceCorporation: null,
      reason: 'corporacion_despacho',
    };
  }

  if (corp && isExternalHighCourtCorporation(corp)) {
    return {
      sourceType: 'jurisprudencia',
      sourceCorporation: corp,
      reason: 'corporacion_alta',
    };
  }

  if (corpNorm.includes('juzgado') || corpNorm.includes('juez')) {
    return {
      sourceType: 'despacho',
      sourceCorporation: null,
      reason: 'corporacion_juzgado',
    };
  }

  if (corp) {
    return {
      sourceType: 'jurisprudencia',
      sourceCorporation: corp,
      reason: 'corporacion_externa',
    };
  }

  return {
    sourceType: 'jurisprudencia',
    sourceCorporation: null,
    reason: 'sin_corporacion',
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';

export async function fetchCourtMetaForPrecedent(
  admin: SupabaseClient,
  courtId: string
): Promise<CourtMetaForPrecedent> {
  const { data } = await admin
    .from('courts')
    .select('name, dane_code, entity_code, specialty_code, despacho_number')
    .eq('id', courtId)
    .maybeSingle();
  const row = (data || {}) as Record<string, string | null>;
  return {
    displayName: String(row.name || '').trim() || 'Despacho judicial',
    daneCode: String(row.dane_code || '11001').trim(),
    entityCode: String(row.entity_code || '31').trim(),
    specialtyCode: String(row.specialty_code || '03').trim(),
    despachoNumber: String(row.despacho_number || '051').trim(),
  };
}
