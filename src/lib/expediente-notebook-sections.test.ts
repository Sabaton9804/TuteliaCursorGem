import { describe, expect, it } from 'vitest';
import type { Document } from '../types';
import {
  buildNotebookSections,
  docBelongsToNotebook,
  groupSectionsByInstancia,
} from './expediente-notebook-sections';
import {
  NOTEBOOK_PI_C01_PRINCIPAL,
  NOTEBOOK_SI_C01_PRINCIPAL,
  NOTEBOOK_SI_IMPUGNACION,
  instanciaForNotebook,
} from './expediente-notebook';

const doc = (partial: Partial<Document>): Document =>
  ({
    id: partial.id ?? 'd1',
    caseId: 'c1',
    name: partial.name ?? 'Pieza',
    type: partial.type ?? 'sgde_migrate',
    order: partial.order ?? 0,
    notebookCode: partial.notebookCode,
    sgdeFolderPath: partial.sgdeFolderPath,
    sgdeId: partial.sgdeId ?? 'sgde-1',
    sgdeSyncStatus: partial.sgdeSyncStatus ?? 'linked',
  }) as Document;

describe('buildNotebookSections tutela segunda', () => {
  it('no inventa Expediente de origen ni duplica Principal', () => {
    const docs = Array.from({ length: 16 }, (_, i) =>
      doc({
        id: `pi-${i}`,
        notebookCode: NOTEBOOK_PI_C01_PRINCIPAL,
        sgdeFolderPath: 'Tutela Primera / Principal',
      })
    );
    const sections = buildNotebookSections([], docs, 'tutela_segunda');
    expect(sections).toHaveLength(2);
    expect(sections[0].code).toBe(NOTEBOOK_PI_C01_PRINCIPAL);
    expect(sections[0].label).toBe('Principal');
    expect(sections.some((s) => s.code === NOTEBOOK_SI_IMPUGNACION)).toBe(true);
    expect(sections.some((s) => s.label.includes('origen'))).toBe(false);
  });

  it('agrupa Impugnación en segunda instancia, no en primera', () => {
    const docs = [
      ...Array.from({ length: 2 }, (_, i) =>
        doc({
          id: `imp-${i}`,
          notebookCode: NOTEBOOK_SI_C01_PRINCIPAL,
          sgdeFolderPath: 'Segunda instancia / Impugnación',
        })
      ),
      doc({
        id: 'pi-1',
        notebookCode: NOTEBOOK_PI_C01_PRINCIPAL,
        sgdeFolderPath: 'Tutela Primera / Principal',
      }),
    ];
    const sections = buildNotebookSections([], docs, 'tutela_segunda');
    const groups = groupSectionsByInstancia(sections);
    const pi = groups.find((g) => g.instancia === 'PI');
    const si = groups.find((g) => g.instancia === 'SI');
    expect(pi?.notebooks).toHaveLength(1);
    expect(pi?.notebooks[0].label).toBe('Principal');
    expect(si?.notebooks.some((n) => n.label === 'Impugnación')).toBe(true);
  });

  it('no crea cuadernos PI solo por notebook_code sin ruta SGDE', () => {
    const docs = [
      doc({
        notebookCode: NOTEBOOK_PI_C01_PRINCIPAL,
        sgdeFolderPath: undefined,
      }),
    ];
    const sections = buildNotebookSections([], docs, 'tutela_segunda');
    expect(sections.some((s) => instanciaForNotebook(s.code) === 'PI')).toBe(false);
  });

  it('no duplica piezas de Impugnación en Cuaderno principal', () => {
    const docs = Array.from({ length: 2 }, (_, i) =>
      doc({
        id: `imp-${i}`,
        notebookCode: NOTEBOOK_SI_C01_PRINCIPAL,
        sgdeFolderPath: 'Segunda instancia / Impugnación',
      })
    );
    const sections = buildNotebookSections([], docs, 'tutela_segunda');
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe('Impugnación');
  });

  it('tutela 2ª: huérfanos SI_C01 van a Impugnación, sin C01 principal inventado', () => {
    const docs = [
      ...Array.from({ length: 2 }, (_, i) =>
        doc({
          id: `imp-${i}`,
          notebookCode: NOTEBOOK_SI_C01_PRINCIPAL,
          sgdeFolderPath: 'Segunda instancia / Impugnación',
        })
      ),
      doc({
        id: 'acta',
        name: 'ActaReparto',
        notebookCode: NOTEBOOK_SI_C01_PRINCIPAL,
        sgdeFolderPath: undefined,
      }),
    ];
    const sections = buildNotebookSections([], docs, 'tutela_segunda');
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe('Impugnación');
    const opts = { caseType: 'tutela_segunda' as const, sections };
    expect(docs.filter((d) => docBelongsToNotebook(d, sections[0].code, opts))).toHaveLength(3);
  });

  it('tutela 2ª sin docs SGDE muestra cuaderno Impugnación', () => {
    const docs = [
      doc({
        name: 'ActaReparto.pdf',
        type: 'attachment',
        notebookCode: NOTEBOOK_SI_C01_PRINCIPAL,
        sgdeFolderPath: undefined,
      }),
    ];
    const sections = buildNotebookSections([], docs, 'tutela_segunda');
    expect(sections.some((s) => s.code === NOTEBOOK_SI_IMPUGNACION)).toBe(true);
  });
});
