import {
  legalSpecialtyLabel,
  normalizeLegalSpecialty,
  type LegalSpecialtyCode,
} from '../../lib/precedent-legal-specialties';

const TONE: Partial<Record<LegalSpecialtyCode, string>> = {
  tutela: 'bg-violet-100 text-violet-900 border-violet-200',
  civil: 'bg-slate-100 text-slate-800 border-slate-200',
  laboral: 'bg-amber-100 text-amber-950 border-amber-200',
  familia: 'bg-pink-100 text-pink-950 border-pink-200',
  penal: 'bg-red-100 text-red-950 border-red-200',
  agrario: 'bg-emerald-100 text-emerald-950 border-emerald-200',
  constitucional: 'bg-indigo-100 text-indigo-950 border-indigo-200',
};

export function PrecedentSpecialtyBadge({ code }: { code: string | null | undefined }) {
  const normalized = normalizeLegalSpecialty(code) ?? 'otro';
  const tone = TONE[normalized] ?? 'bg-slate-50 text-slate-600 border-slate-100';
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${tone}`}
    >
      {legalSpecialtyLabel(code)}
    </span>
  );
}
