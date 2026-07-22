import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import { extractPlainTextFromPdfBuffer } from '../pdf-acta-detect.ts';
import { slicePdfBase64FirstPages, LEGAL_ANALYSIS_MAX_PAGES } from './pdf-first-pages.js';
import {
  runLegalAnalysisWithOpenAi,
  type LegalAnalysisResult,
} from './legal-analysis-service.js';
import {
  joinPartyField,
  pickFalloPrimeraDocument,
  type FalloPartyDocument,
} from '../src/lib/segunda-fallo-parties.ts';

const CASE_DOCUMENTS_BUCKET = 'case-documents';
const FALLO_TEXT_MAX_CHARS = 12_000;
const FALLO_TEXT_EXTRACT_PAGES = 25;

async function prepareFalloForLegalAnalysis(pdfBuffer: Buffer): Promise<{
  pdfBase64?: string;
  pdfText?: string;
  pdfWasTruncated: boolean;
  truncatedToPages?: number;
  totalPages?: number;
}> {
  const rawBase64 = pdfBuffer.toString('base64');
  try {
    const sliced = await slicePdfBase64FirstPages(rawBase64, LEGAL_ANALYSIS_MAX_PAGES);
    if (sliced.base64) {
      return {
        pdfBase64: sliced.base64,
        pdfWasTruncated: sliced.truncated,
        truncatedToPages: sliced.truncated ? sliced.usedPages : undefined,
        totalPages: sliced.totalPages || undefined,
      };
    }
  } catch (e) {
    console.warn('[segunda-fallo-parties] pdf-lib no pudo recortar fallo; fallback a texto:', e);
  }

  const text = (await extractPlainTextFromPdfBuffer(pdfBuffer, FALLO_TEXT_EXTRACT_PAGES)).slice(
    0,
    FALLO_TEXT_MAX_CHARS,
  );
  if (text.trim().length >= 200) {
    return { pdfText: text.trim(), pdfWasTruncated: false };
  }

  return {
    pdfBase64: rawBase64,
    pdfWasTruncated: false,
  };
}

type CaseDocumentRow = FalloPartyDocument & {
  storage_path?: string | null;
};

export type RefreshSegundaPartiesResult = {
  ok: boolean;
  updated: boolean;
  falloDocumentId?: string;
  falloDocumentName?: string;
  message: string;
  parties?: {
    claimant: string;
    defendant: string;
  };
};

function buildLegalIdentificaciones(analysis: LegalAnalysisResult): string {
  const acc = analysis.accionantes
    .map((p) => {
      const n = (p.nombre || '').trim();
      const id = (p.identificacion || '').trim();
      if (n && id) return `${n} (${id})`;
      return n || id;
    })
    .filter(Boolean)
    .join(' | ');
  const def = analysis.accionados
    .map((p) => {
      const n = (p.nombre || '').trim();
      const id = (p.identificacion || '').trim();
      if (n && id) return `${n} (${id})`;
      return n || id;
    })
    .filter(Boolean)
    .join(' | ');
  const parts: string[] = [];
  if (acc) parts.push(`Accionantes: ${acc}`);
  if (def) parts.push(`Accionados: ${def}`);
  return parts.join(' — ');
}

function analysisToCasePatch(analysis: LegalAnalysisResult): Record<string, string> {
  return {
    claimant: joinPartyField(analysis.accionantes, 'nombre'),
    defendant: joinPartyField(analysis.accionados, 'nombre'),
    claimant_id: joinPartyField(analysis.accionantes, 'identificacion'),
    claimant_email: joinPartyField(analysis.accionantes, 'email'),
    defendant_id: joinPartyField(analysis.accionados, 'identificacion'),
    defendant_email: joinPartyField(analysis.accionados, 'email'),
    legal_hechos: analysis.hechos,
    legal_pretensiones: analysis.pretensiones,
    legal_derecho_tutelado: analysis.derechoTutelado,
    legal_identificaciones: buildLegalIdentificaciones(analysis),
  };
}

async function downloadCaseDocumentBytes(
  admin: SupabaseClient,
  storagePath: string,
): Promise<Buffer> {
  const path = storagePath.trim();
  const { data, error } = await admin.storage.from(CASE_DOCUMENTS_BUCKET).download(path);
  if (error || !data) {
    throw new Error(error?.message || 'No se pudo descargar el fallo desde Storage.');
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function refreshSegundaPartiesFromFallo(opts: {
  admin: SupabaseClient;
  openai: OpenAI;
  caseId: string;
  force?: boolean;
  /** Si la detección automática falla, el usuario elige el PDF del fallo PI. */
  falloDocumentId?: string;
}): Promise<RefreshSegundaPartiesResult> {
  const { admin, openai, caseId } = opts;

  const { data: caseRow, error: caseErr } = await admin
    .from('cases')
    .select(
      'id, case_type, claimant, defendant, claimant_email, legal_hechos, legal_pretensiones, legal_derecho_tutelado',
    )
    .eq('id', caseId)
    .maybeSingle();
  if (caseErr || !caseRow?.id) {
    throw new Error('Expediente no encontrado.');
  }
  if (String(caseRow.case_type || '') !== 'tutela_segunda') {
    return { ok: true, updated: false, message: 'Solo aplica a tutelas de segunda instancia.' };
  }

  const hasLegal =
    Boolean(String(caseRow.legal_hechos || '').trim()) &&
    Boolean(String(caseRow.claimant || '').trim()) &&
    Boolean(String(caseRow.defendant || '').trim()) &&
    !looksLikeRemisionParties(String(caseRow.claimant), String(caseRow.defendant), caseRow.claimant_email);
  if (hasLegal && !opts.force) {
    return {
      ok: true,
      updated: false,
      message: 'Las partes ya están identificadas desde el fallo de primera instancia.',
      parties: {
        claimant: String(caseRow.claimant || ''),
        defendant: String(caseRow.defendant || ''),
      },
    };
  }

  const { data: docRows, error: docErr } = await admin
    .from('case_documents')
    .select(
      'id, name, original_name, act_code, type, notebook_code, sgde_folder_path, sort_order, storage_path',
    )
    .eq('case_id', caseId);
  if (docErr) throw new Error(docErr.message);

  const mappedDocs = (docRows || []).map((row) => ({
    id: String(row.id),
    name: String(row.name || ''),
    originalName: row.original_name ? String(row.original_name) : undefined,
    actCode: row.act_code ? String(row.act_code) : undefined,
    type: String(row.type || ''),
    notebookCode: row.notebook_code ? String(row.notebook_code) : undefined,
    sgdeFolderPath: row.sgde_folder_path ? String(row.sgde_folder_path) : undefined,
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : undefined,
  }));

  const manualId = String(opts.falloDocumentId || '').trim();
  let falloDoc: (typeof mappedDocs)[number] | null = null;
  if (manualId) {
    falloDoc = mappedDocs.find((d) => d.id === manualId) ?? null;
    if (!falloDoc) {
      return {
        ok: false,
        updated: false,
        message: 'El documento seleccionado no existe en este expediente.',
      };
    }
  } else {
    falloDoc = pickFalloPrimeraDocument(mappedDocs);
    if (!falloDoc?.id) {
      return {
        ok: true,
        updated: false,
        message:
          'No se detectó el fallo automáticamente. Seleccione el PDF del fallo de primera instancia en Síntesis cognitiva.',
      };
    }
  }

  const storagePath = (docRows || []).find((r) => String(r.id) === falloDoc!.id)?.storage_path;
  if (!storagePath) {
    return {
      ok: false,
      updated: false,
      falloDocumentId: falloDoc.id,
      falloDocumentName: falloDoc.name,
      message: 'El fallo está indexado pero falta la ruta en Storage.',
    };
  }

  const pdfBuffer = await downloadCaseDocumentBytes(admin, String(storagePath));
  const prepared = await prepareFalloForLegalAnalysis(pdfBuffer);

  const { analysis } = await runLegalAnalysisWithOpenAi(openai, {
    caseType: 'impugnacion',
    documentKind: 'fallo_primera',
    pdfBase64: prepared.pdfBase64,
    pdfText: prepared.pdfText,
    pdfWasTruncated: prepared.pdfWasTruncated,
    truncatedToPages: prepared.truncatedToPages,
    totalPages: prepared.totalPages,
  });

  const patch = analysisToCasePatch(analysis);
  if (!patch.claimant.trim() || !patch.defendant.trim()) {
    return {
      ok: false,
      updated: false,
      falloDocumentId: falloDoc.id,
      falloDocumentName: falloDoc.name,
      message: 'La IA no pudo identificar accionante y accionado en el fallo de primera instancia.',
    };
  }

  let falloText = '';
  try {
    falloText = extractPlainTextFromPdfBuffer(pdfBuffer).slice(0, FALLO_TEXT_MAX_CHARS);
  } catch {
    /* texto auxiliar opcional */
  }

  const now = new Date().toISOString();
  const updateRow: Record<string, unknown> = {
    ...patch,
    updated_at: now,
  };
  if (falloText.trim()) {
    updateRow.raw_text = [
      '=== FALLO DE PRIMERA INSTANCIA (fuente de partes y síntesis) ===',
      falloText.trim(),
    ].join('\n');
  }

  const { error: upErr } = await admin.from('cases').update(updateRow).eq('id', caseId);
  if (upErr) throw new Error(upErr.message);

  return {
    ok: true,
    updated: true,
    falloDocumentId: falloDoc.id,
    falloDocumentName: falloDoc.name,
    message: `Partes actualizadas desde ${falloDoc.name}.`,
    parties: {
      claimant: patch.claimant,
      defendant: patch.defendant,
    },
  };
}

function looksLikeRemisionParties(
  claimant: string,
  defendant: string,
  claimantEmail?: string | null,
): boolean {
  const c = claimant.trim();
  const d = defendant.trim();
  const email = (claimantEmail || '').trim().toLowerCase();
  return (
    /juzgado\s+\d+/i.test(c) ||
    /pequeñas?\s+causas/i.test(c) ||
    /competencia\s+m[uú]ltiple/i.test(c) ||
    /@.*ramajudicial\.gov\.co/i.test(email) ||
    /^despacho\s+judicial$/i.test(d)
  );
}
