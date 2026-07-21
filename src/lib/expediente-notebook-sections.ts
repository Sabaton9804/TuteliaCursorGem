import type { CaseType, Document } from '../types';
import type { ExpedienteCuadernoExtra } from './expediente-extra-cuadernos';
import { sgdeCuadernoFromFolderPath } from './expediente-folder-tree';
import { isExpedientePiezaListable } from './expediente-viewer-doc';
import {
  NOTEBOOK_META,
  NOTEBOOK_PI_C01_PRINCIPAL,
  NOTEBOOK_SI_C01_PRINCIPAL,
  NOTEBOOK_SI_IMPUGNACION,
  instanciaForNotebook,
  notebookCodeForCaseType,
  normalizeNotebookCode,
  segundaImpugnacionNotebookExtra,
  type ExpedienteInstanciaCode,
} from './expediente-notebook';

export type DocNotebookMatchOpts = {
  caseType?: CaseType;
  sections?: ExpedienteCuadernoExtra[];
};

function siImpugnacionSection(
  sections: ExpedienteCuadernoExtra[]
): ExpedienteCuadernoExtra | undefined {
  return sections.find(
    (s) =>
      normalizeNotebookCode(s.code) === NOTEBOOK_SI_IMPUGNACION ||
      (instanciaForNotebook(s.code) === 'SI' && /impugn/i.test(s.label))
  );
}

function effectiveNotebookWithoutPath(
  doc: Document,
  opts?: DocNotebookMatchOpts
): string {
  const nb = normalizeNotebookCode(doc.notebookCode);
  if (opts?.caseType !== 'tutela_segunda' || nb !== NOTEBOOK_SI_C01_PRINCIPAL || !opts.sections?.length) {
    return nb;
  }
  const imp = siImpugnacionSection(opts.sections);
  if (imp) return imp.code;
  const siSections = opts.sections.filter((s) => instanciaForNotebook(s.code) === 'SI');
  if (siSections.length === 1) return siSections[0].code;
  return nb;
}

export function docBelongsToNotebook(
  doc: Document,
  code: string,
  opts?: DocNotebookMatchOpts
): boolean {
  const target = normalizeNotebookCode(code);
  const fromPath = sgdeCuadernoFromFolderPath(doc.sgdeFolderPath);
  if (fromPath) {
    return normalizeNotebookCode(fromPath.code) === target;
  }
  return effectiveNotebookWithoutPath(doc, opts) === target;
}

/**
 * Cuadernos visibles en el expediente. La lista sale de rutas SGDE reales;
 * en tutela 2ª no se inventan carpetas de 1ª instancia.
 */
export function buildNotebookSections(
  extra: ExpedienteCuadernoExtra[],
  docs: Document[],
  caseType?: CaseType
): ExpedienteCuadernoExtra[] {
  const isSegunda = caseType === 'tutela_segunda';
  const primary = notebookCodeForCaseType(caseType);
  const out: ExpedienteCuadernoExtra[] = [];
  const seen = new Set<string>();

  const addSection = (code: string, label: string) => {
    const c = normalizeNotebookCode((code || '').trim());
    if (!c || seen.has(c)) return;
    seen.add(c);
    const meta = NOTEBOOK_META[c];
    out.push({
      code: c,
      label: (label || '').trim() || meta?.label || c,
    });
  };

  for (const d of docs) {
    const cuaderno = sgdeCuadernoFromFolderPath(d.sgdeFolderPath);
    if (cuaderno) addSection(cuaderno.code, cuaderno.label);
  }

  const hasSgdeCuadernos = out.length > 0;
  if (!hasSgdeCuadernos) {
    addSection(primary, NOTEBOOK_META[primary]?.label || primary);
  }

  for (const e of extra) {
    const code = normalizeNotebookCode(e.code);
    if (!code || seen.has(code)) continue;
    if (isSegunda && instanciaForNotebook(code) === 'PI') continue;
    addSection(code, (e.label || '').trim() || NOTEBOOK_META[code]?.label || code);
  }

  if (!isSegunda) {
    const fromDocs = new Set<string>();
    for (const d of docs) {
      const c = normalizeNotebookCode(d.notebookCode);
      if (c !== primary && !seen.has(c)) fromDocs.add(c);
    }
    for (const code of [...fromDocs].sort()) {
      if (seen.has(code)) continue;
      const label = NOTEBOOK_META[code]?.label || `Cuaderno · ${code}`;
      addSection(code, label);
    }
  }

  const listable = docs.filter(isExpedientePiezaListable);
  const matchOpts = (sections: ExpedienteCuadernoExtra[]): DocNotebookMatchOpts => ({
    caseType,
    sections,
  });
  const orphans = listable.filter(
    (d) => !out.some((s) => docBelongsToNotebook(d, s.code, matchOpts(out)))
  );
  const skipPrimaryForSegunda =
    isSegunda && out.some((s) => instanciaForNotebook(s.code) === 'SI');
  if (orphans.length > 0 && !seen.has(primary) && !skipPrimaryForSegunda) {
    addSection(primary, NOTEBOOK_META[primary]?.label || primary);
  }

  const extraCodes = new Set(extra.map((e) => normalizeNotebookCode(e.code)));
  const withDocs = out.filter((s) =>
    docs.some((d) => docBelongsToNotebook(d, s.code, matchOpts(out)))
  );
  const withExtras = out.filter((s) => extraCodes.has(s.code) && !withDocs.some((w) => w.code === s.code));
  const merged = [...withDocs, ...withExtras];

  if (merged.length === 0) {
    if (isSegunda) {
      const imp = segundaImpugnacionNotebookExtra();
      const piFromSgde = out.filter((s) => instanciaForNotebook(s.code) === 'PI');
      if (piFromSgde.length > 0) return [...piFromSgde, imp];
      return [imp];
    }
    const siFromSgde = out.filter((s) => instanciaForNotebook(s.code) === 'SI');
    if (isSegunda && siFromSgde.length > 0) return siFromSgde;
    addSection(primary, NOTEBOOK_META[primary]?.label || primary);
    const primarySection = out.find((s) => s.code === primary);
    return primarySection ? [primarySection] : out.slice(-1);
  }

  if (isSegunda) {
    let result = merged.filter(
      (s) =>
        s.code !== NOTEBOOK_SI_C01_PRINCIPAL ||
        docs.some((d) => {
          const fp = sgdeCuadernoFromFolderPath(d.sgdeFolderPath);
          return fp && normalizeNotebookCode(fp.code) === NOTEBOOK_SI_C01_PRINCIPAL;
        })
    );
    if (!result.some((s) => normalizeNotebookCode(s.code) === NOTEBOOK_SI_IMPUGNACION)) {
      result = [...result, segundaImpugnacionNotebookExtra()];
    }
    return result;
  }

  return merged;
}

export function groupSectionsByInstancia(
  sections: ExpedienteCuadernoExtra[]
): { instancia: ExpedienteInstanciaCode; notebooks: ExpedienteCuadernoExtra[] }[] {
  const order: ExpedienteInstanciaCode[] = ['PI', 'SI'];
  const buckets = new Map<ExpedienteInstanciaCode, ExpedienteCuadernoExtra[]>();
  for (const nb of sections) {
    const inst = instanciaForNotebook(nb.code);
    const list = buckets.get(inst) || [];
    list.push(nb);
    buckets.set(inst, list);
  }
  return order
    .filter((i) => (buckets.get(i)?.length ?? 0) > 0)
    .map((instancia) => ({ instancia, notebooks: buckets.get(instancia)! }));
}

export { NOTEBOOK_PI_C01_PRINCIPAL, NOTEBOOK_SI_C01_PRINCIPAL };
