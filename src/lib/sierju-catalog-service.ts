import { supabase } from './supabase';
import type { CaseType } from '../types';
import type { DerechoTuteladoCode } from './sierju-case-codes';
import { resolveProcessDefinitionId } from './process-definitions-service';
import type { CaseSierjuMetadata, FundamentalRightCode } from './sierju-types';
import { derechoToFundamental, sierjuClassCodeToDerecho } from './sierju-code-bridge';

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

export async function fetchSierjuClassesForCaseType(
  courtId: string,
  caseType: CaseType,
): Promise<SierjuClassOption[]> {
  const processDefinitionId = await resolveProcessDefinitionId(caseType, courtId);
  if (!processDefinitionId) return [];
  const rows = await fetchSierjuClassesForProcessDefinition(courtId, processDefinitionId);
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
