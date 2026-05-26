import { extractPlainTextFromPdfBuffer } from '../pdf-acta-detect';
import {
  extractAppellantFromText,
  extractOriginRulingFromText,
  extractSegundaFieldsFromText,
  mergeSegundaFieldsExtract,
  type SegundaFieldsExtract,
} from '../src/lib/segunda-instancia-extract.ts';
import {
  extractSegundaFieldsWithOpenAi,
  leafLabel,
  pickPdfCandidatesForIa,
} from './sgde-segunda-extract-ai';
import { sgdeLeafDisplayPath, type SgdeClient, type SgdePdfLeaf } from './sgde-client';

export type { SegundaFieldsExtract };

function scoreFalloLeaf(leaf: SgdePdfLeaf): number {
  const p = sgdeLeafDisplayPath(leaf).toLowerCase();
  let s = 0;
  if (/\bfallo\b/.test(p)) s += 12;
  if (/\bsentencia\b/.test(p)) s += 9;
  if (/\bprovidencia\b/.test(p)) s += 6;
  if (/\bprimera\b/.test(p) && /\bprincipal\b/.test(p)) s += 4;
  if (/\bimpugnaci[oó]n\b/.test(p)) s -= 8;
  if (/\bcorreo\b/.test(p)) s -= 4;
  return s;
}

function scoreImpugnacionLeaf(leaf: SgdePdfLeaf): number {
  const p = sgdeLeafDisplayPath(leaf).toLowerCase();
  let s = 0;
  if (/\bimpugnaci[oó]n\b/.test(p)) s += 12;
  if (/\bcorreo\.pdf$/i.test(leaf.name)) s += 10;
  if (/\bsegunda\b/.test(p)) s += 6;
  if (/\bingreso\b/.test(p)) s += 3;
  if (/\bfallo\b/.test(p)) s -= 8;
  return s;
}

function pickBestLeaf(leaves: SgdePdfLeaf[], scoreFn: (l: SgdePdfLeaf) => number): SgdePdfLeaf | null {
  let best: SgdePdfLeaf | null = null;
  let bestScore = 0;
  for (const leaf of leaves) {
    const s = scoreFn(leaf);
    if (s > bestScore) {
      bestScore = s;
      best = leaf;
    }
  }
  return bestScore >= 6 ? best : null;
}

export async function extractSegundaFieldsFromSgdeLeaves(
  client: SgdeClient,
  leaves: SgdePdfLeaf[],
  emailDigest?: string
): Promise<SegundaFieldsExtract> {
  const partials: Array<Partial<SegundaFieldsExtract> & { sources?: string[] }> = [];

  if (emailDigest?.trim()) {
    partials.push(extractSegundaFieldsFromText(emailDigest, 'Correo de traslado'));
  }

  const falloLeaf = pickBestLeaf(leaves, scoreFalloLeaf);
  const impLeaf = pickBestLeaf(leaves, scoreImpugnacionLeaf);

  const readLeafText = async (leaf: SgdePdfLeaf): Promise<{ label: string; text: string } | null> => {
    const downloaded = await client.downloadNodeContent(leaf.id);
    if (!downloaded?.buffer?.length) return null;
    const plain = await extractPlainTextFromPdfBuffer(downloaded.buffer, 8);
    if (!plain.trim()) return null;
    const label = sgdeLeafDisplayPath(leaf);
    const text = plain.length > 45_000 ? plain.slice(0, 45_000) : plain;
    return { label, text };
  };

  if (falloLeaf) {
    const got = await readLeafText(falloLeaf);
    if (got) {
      const originRuling = extractOriginRulingFromText(got.text);
      if (originRuling) partials.push({ originRuling, sources: [got.label] });
    }
  }
  if (impLeaf && impLeaf.id !== falloLeaf?.id) {
    const got = await readLeafText(impLeaf);
    if (got) {
      const appellant = extractAppellantFromText(got.text);
      if (appellant) partials.push({ appellant, sources: [got.label] });
      if (!partials.some((p) => p.originRuling)) {
        const originRuling = extractOriginRulingFromText(got.text);
        if (originRuling) partials.push({ originRuling, sources: [got.label] });
      }
    }
  }

  const heuristic = mergeSegundaFieldsExtract(...partials);

  const iaCandidates = pickPdfCandidatesForIa(falloLeaf, impLeaf);
  const pdfFiles: Array<{ buffer: Buffer; filename: string; label: string }> = [];
  for (const leaf of iaCandidates) {
    const downloaded = await client.downloadNodeContent(leaf.id);
    if (!downloaded?.buffer?.length) continue;
    pdfFiles.push({
      buffer: downloaded.buffer,
      filename: leaf.name,
      label: leafLabel(leaf),
    });
  }

  const fromAi = await extractSegundaFieldsWithOpenAi({
    emailDigest,
    pdfFiles,
  });

  if (fromAi) {
    return mergeSegundaFieldsExtract(heuristic, fromAi);
  }
  return heuristic;
}
