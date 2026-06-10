import {
  issuerCategoryLabel,
  normalizeIssuerCategory,
  type IssuerCategoryCode,
} from '../../lib/precedent-issuer-category';

const TONE: Partial<Record<IssuerCategoryCode, string>> = {
  corte_constitucional: 'bg-indigo-100 text-indigo-950 border-indigo-200',
  corte_suprema: 'bg-sky-100 text-sky-950 border-sky-200',
  consejo_estado: 'bg-teal-100 text-teal-950 border-teal-200',
  tribunal: 'bg-amber-100 text-amber-950 border-amber-200',
  juzgado: 'bg-slate-100 text-slate-800 border-slate-200',
  juzgado_pequenas_causas: 'bg-slate-50 text-slate-700 border-slate-100',
};

export function PrecedentIssuerCategoryBadge({ code }: { code: string | null | undefined }) {
  const normalized = normalizeIssuerCategory(code) ?? 'otro';
  const tone = TONE[normalized] ?? 'bg-slate-50 text-slate-600 border-slate-100';
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${tone}`}
    >
      {issuerCategoryLabel(code)}
    </span>
  );
}
