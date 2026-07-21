import { supabase } from './supabase';
import type { CaseType } from '../types';
import type { DerechoTuteladoCode } from './sierju-case-codes';
import { resolveProcessDefinitionId } from './process-definitions-service';
import { isCivilCaseType } from './process-product-scope';
import type { CaseSierjuMetadata, FundamentalRightCode } from './sierju-types';
import { derechoToFundamental, sierjuClassCodeToDerecho } from './sierju-code-bridge';
import { SIERJU_CIVIL_ACTIVE_SECTION } from './sierju-process-tipos';

export type SierjuClassOption = {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  sectionCode: string;
  sectionLabel: string;
  isDefault: boolean;
  fundamentalRight: FundamentalRightCode;
  derechoTuteladoCode: DerechoTuteladoCode;
};

const DEFAULT_FORM_TEMPLATE = 'sierju_civil_circuito_2023_v4';

let cachedKey: string | null = null;
let cachedClasses: SierjuClassOption[] = [];

function rowToClassOption(
  linkRow: Record<string, unknown>,
  classRow: Record<string, unknown>,
  sectionRow: Record<string, unknown> | null,
): SierjuClassOption | null {
  const id = String(classRow.id ?? '');
  const code = String(classRow.code ?? '');
  if (!id || !code) return null;

  const sectionCode = String(sectionRow?.code ?? '');
  const isCivilSection = sectionCode.startsWith('civil');
  const derecho = sierjuClassCodeToDerecho(code);
  if (!derecho && !isCivilSection) return null;
  const resolvedDerecho = derecho ?? ('OTROS' as DerechoTuteladoCode);

  return {
    id,
    code,
    label: String(classRow.label ?? code),
    sortOrder: Number(classRow.sort_order ?? 0),
    sectionCode,
    sectionLabel: String(sectionRow?.label ?? ''),
    isDefault: linkRow.is_default === true,
    fundamentalRight: derechoToFundamental(resolvedDerecho),
    derechoTuteladoCode: resolvedDerecho,
  };
}

export async function fetchCourtSierjuFormTemplateCode(courtId: string): Promise<string> {
  const { data, error } = await supabase
    .from('courts')
    .select('sierju_form_template_code')
    .eq('id', courtId)
    .maybeSingle();

  if (error) {
    console.warn('[sierju-catalog-service] courts:', error.message);
  }

  const code = data?.sierju_form_template_code;
  return typeof code === 'string' && code.trim() ? code.trim() : DEFAULT_FORM_TEMPLATE;
}

export async function fetchSierjuClassesForProcessDefinition(
  courtId: string,
  processDefinitionId: string,
): Promise<SierjuClassOption[]> {
  const cacheKey = `${courtId}:${processDefinitionId}`;
  if (cachedKey === cacheKey && cachedClasses.length > 0) {
    return cachedClasses;
  }

  const formTemplateCode = await fetchCourtSierjuFormTemplateCode(courtId);

  const { data, error } = await supabase
    .from('process_definition_sierju_classes')
    .select(
      `
      is_default,
      sierju_process_classes (
        id,
        code,
        label,
        sort_order,
        section_id,
        sierju_sections (
          code,
          label,
          form_template_code
        )
      )
    `,
    )
    .eq('process_definition_id', processDefinitionId);

  if (error) {
    console.warn('[sierju-catalog-service] process_definition_sierju_classes:', error.message);
    return [];
  }

  const options: SierjuClassOption[] = [];
  for (const raw of (data as Record<string, unknown>[]) ?? []) {
    const classRaw = raw.sierju_process_classes as Record<string, unknown> | null;
    if (!classRaw) continue;
    const sectionRaw = classRaw.sierju_sections as Record<string, unknown> | null;
    if (sectionRaw && String(sectionRaw.form_template_code ?? '') !== formTemplateCode) {
      continue;
    }
    const opt = rowToClassOption(raw, classRaw, sectionRaw);
    if (opt) options.push(opt);
  }

  options.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'es'));

  // Civil-Escrito = legislación anterior: si hay filas Civil-Oral, no exponer Escrito en UI.
  const hasCivilOral = options.some((o) => o.sectionCode === 'civil_1a_oral');
  const filtered = hasCivilOral
    ? options.filter((o) => o.sectionCode !== 'civil_1a_escrito')
    : options;

  cachedKey = cacheKey;
  cachedClasses = filtered;
  return filtered;
}

function filterClassesForCaseType(caseType: CaseType, options: SierjuClassOption[]): SierjuClassOption[] {
  const prefer = (section: string) => {
    const hit = options.filter((o) => o.sectionCode === section);
    return hit.length ? hit : options.filter((o) => !o.sectionCode.startsWith('acciones_const'));
  };

  // Tutela 1ª → hoja 8; tutela 2ª / impugnación → hoja 13; consulta desacato → hoja 15.
  if (caseType === 'tutela_primera') return prefer('movimiento_tutelas');
  if (caseType === 'tutela_segunda') return prefer('impugnaciones');
  if (caseType === 'consulta_desacato') return prefer('consultas_desacato');
  return options;
}

/**
 * Carga TIPOS PROCESOS de una sección SIERJU (p. ej. civil_1a_oral) del formulario del despacho,
 * sin depender del puente process_definition_sierju_classes.
 */
export async function fetchSierjuClassesBySection(
  courtId: string,
  sectionCode: string,
): Promise<SierjuClassOption[]> {
  const formTemplateCode = await fetchCourtSierjuFormTemplateCode(courtId);
  const cacheKey = `${courtId}:section:${sectionCode}:${formTemplateCode}`;
  if (cachedKey === cacheKey && cachedClasses.length > 0) {
    return cachedClasses;
  }

  const { data: sectionRow, error: sectionErr } = await supabase
    .from('sierju_sections')
    .select('id, code, label, form_template_code')
    .eq('code', sectionCode)
    .eq('form_template_code', formTemplateCode)
    .maybeSingle();

  if (sectionErr) {
    console.warn('[sierju-catalog-service] sierju_sections:', sectionErr.message);
    return [];
  }
  if (!sectionRow?.id) return [];

  const { data, error } = await supabase
    .from('sierju_process_classes')
    .select('id, code, label, sort_order, section_id')
    .eq('section_id', sectionRow.id)
    .order('sort_order', { ascending: true });

  if (error) {
    console.warn('[sierju-catalog-service] sierju_process_classes by section:', error.message);
    return [];
  }

  const sectionMeta = {
    code: String(sectionRow.code ?? sectionCode),
    label: String(sectionRow.label ?? ''),
    form_template_code: String(sectionRow.form_template_code ?? formTemplateCode),
  };

  const options: SierjuClassOption[] = [];
  for (const classRaw of (data as Record<string, unknown>[]) ?? []) {
    const opt = rowToClassOption({ is_default: false }, classRaw, sectionMeta);
    if (opt) options.push(opt);
  }
  options.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'es'));

  cachedKey = cacheKey;
  cachedClasses = options;
  return options;
}

export async function fetchSierjuClassesForCaseType(
  courtId: string,
  caseType: CaseType,
): Promise<SierjuClassOption[]> {
  const processDefinitionId = await resolveProcessDefinitionId(caseType, courtId);
  const rows = processDefinitionId
    ? await fetchSierjuClassesForProcessDefinition(courtId, processDefinitionId)
    : [];

  // Civil: el puente histórico solo enlazaba Civil-Escrito. Si no hay Oral, cargar la sección vigente.
  if (isCivilCaseType(caseType)) {
    const hasOral = rows.some((o) => o.sectionCode === SIERJU_CIVIL_ACTIVE_SECTION);
    if (!hasOral) {
      const oral = await fetchSierjuClassesBySection(courtId, SIERJU_CIVIL_ACTIVE_SECTION);
      if (oral.length) return oral;
    }
  }

  return filterClassesForCaseType(caseType, rows);
}

export function findSierjuClassByDerecho(
  classes: readonly SierjuClassOption[],
  derecho: DerechoTuteladoCode | undefined,
): SierjuClassOption | undefined {
  if (!derecho) return undefined;
  return classes.find((c) => c.derechoTuteladoCode === derecho);
}

export function findSierjuClassById(
  classes: readonly SierjuClassOption[],
  classId: string | undefined,
): SierjuClassOption | undefined {
  if (!classId) return undefined;
  return classes.find((c) => c.id === classId);
}

/** Resuelve fila SIERJU por código TIPOS PROCESOS (p. ej. declarativos_especiales_divisorio). */
export function findSierjuClassByCode(
  classes: readonly SierjuClassOption[],
  code: string | undefined | null,
  preferSection?: string,
): SierjuClassOption | undefined {
  const c = (code || '').trim();
  if (!c) return undefined;
  if (preferSection) {
    const preferred =
      classes.find((row) => row.code === c && row.sectionCode === preferSection) ||
      classes.find(
        (row) => row.code === c && String(row.sectionCode || '').includes('oral'),
      );
    if (preferred) return preferred;
  }
  return classes.find((row) => row.code === c);
}

export type SierjuCaseClassificationPatch = {
  sierju_process_class_id: string | null;
  sierju_metadata: CaseSierjuMetadata;
  derecho_tutelado_code: DerechoTuteladoCode | null;
};

export function buildSierjuClassificationPatch(
  classes: readonly SierjuClassOption[],
  input: { classId?: string | null; derechoCode?: DerechoTuteladoCode | null },
): SierjuCaseClassificationPatch {
  const byClass = findSierjuClassById(classes, input.classId ?? undefined);
  const byDerecho = findSierjuClassByDerecho(classes, input.derechoCode ?? undefined);
  const hit = byClass ?? byDerecho;

  if (!hit) {
    return {
      sierju_process_class_id: null,
      sierju_metadata: {},
      derecho_tutelado_code: input.derechoCode ?? null,
    };
  }

  return {
    sierju_process_class_id: hit.id,
    sierju_metadata: { fundamental_right: hit.fundamentalRight },
    derecho_tutelado_code: hit.derechoTuteladoCode,
  };
}

export async function resolveSierjuClassificationForCaseType(
  courtId: string,
  caseType: CaseType,
  derechoCode: DerechoTuteladoCode | undefined,
): Promise<SierjuCaseClassificationPatch> {
  const classes = await fetchSierjuClassesForCaseType(courtId, caseType);
  return buildSierjuClassificationPatch(classes, { derechoCode: derechoCode ?? null });
}

export function invalidateSierjuCatalogCache(): void {
  cachedKey = null;
  cachedClasses = [];
}

/** Resuelve classId civil a partir del código TIPOS PROCESOS (p. ej. tras tipificación IA). */
export async function resolveSierjuClassIdByCode(
  courtId: string,
  caseType: CaseType,
  code: string | null | undefined,
): Promise<SierjuClassOption | null> {
  const c = (code || '').trim();
  if (!c) return null;
  const classes = await fetchSierjuClassesForCaseType(courtId, caseType);
  return findSierjuClassByCode(classes, c, SIERJU_CIVIL_ACTIVE_SECTION) ?? null;
}
