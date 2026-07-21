import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Edit2,
  Combine,
  X,
  Check,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  FolderPlus,
  FolderInput,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { LegalAnalysis } from './new-case-types';
import { isMergeableAttachment } from '../../lib/new-case-email-attachment';
import { partyRoleLabels } from '../../lib/process-product-scope';
import type { ExpedienteCuadernoExtra } from '../../lib/expediente-extra-cuadernos';
import {
  caseHasCautelarNotebook,
  matchPredefinedNotebooks,
  NOTEBOOK_META,
  NOTEBOOK_PI_C02_CAUTELAR,
  normalizeNotebookCode,
  type PredefinedNotebookSuggestion,
} from '../../lib/expediente-notebook';

export type ExtraCuadernoDraft = { label: string; code?: string };

export type CaseLegalAnalysisParsedSnapshot = {
  subject?: string;
  from?: string;
  linkFound?: boolean;
  linkUrl?: string | null;
  linkPending?: boolean;
};

export type ArchiveLinkFetchStatus = 'idle' | 'loading' | 'ok' | 'error';

export type CaseLegalAnalysisAttachmentRow = {
  filename: string;
  contentType?: string;
  size: number;
  isFromLink?: boolean;
  type?: string;
  notebookCode?: string;
};

export type NewCaseNotebookOption = { code: string; label: string };

type AiSectionProps = {
  section: 'ai';
  aiAnalysis: LegalAnalysis | null;
  onDismissAnalysis: () => void;
  /** En civil: Demandante/Demandado. En tutela: Accionante/Accionado. */
  isCivilProcess?: boolean;
  /** Permite completar/corregir datos que la IA no extrajo (p. ej. C.C. en anexos). */
  onChangeAnalysis?: (next: LegalAnalysis) => void;
};

type MetadataSectionProps = {
  section: 'metadata';
  parsedData: CaseLegalAnalysisParsedSnapshot;
  attachments: CaseLegalAnalysisAttachmentRow[];
  selectedDocIndex: number;
  onSelectDocIndex: (index: number) => void;
  mergeSelected: () => void;
  isMerging: boolean;
  selectedForMerge: number[];
  toggleSelectForMerge: (index: number) => void;
  editingIndex: number | null;
  setEditingIndex: (index: number | null) => void;
  editingName: string;
  setEditingName: (value: string) => void;
  handleRename: (index: number) => void;
  handleMove: (index: number, direction: 'up' | 'down') => void;
  onAddAttachments: (files: FileList) => void;
  onRemoveAttachment: (index: number) => void;
  isAddingAttachments?: boolean;
  archiveLinkStatus?: ArchiveLinkFetchStatus;
  archiveLinkError?: string | null;
  onRetryArchiveLink?: () => void;
  isCivilProcess?: boolean;
  /** Ejecutivo: preset C02 medidas cautelares. */
  showCautelarCuadernoOption?: boolean;
  abrirCuadernoCautelares?: boolean;
  onAbrirCuadernoCautelaresChange?: (v: boolean) => void;
  /** Cuadernos extra a crear al radicar (cualquier tipo de proceso). */
  extraCuadernos?: ExpedienteCuadernoExtra[];
  onAddExtraCuaderno?: (draft: ExtraCuadernoDraft) => void;
  onRemoveExtraCuaderno?: (code: string) => void;
  /** Opciones de cuaderno para asignar cada documento. */
  notebookOptions?: NewCaseNotebookOption[];
  defaultNotebookCode?: string;
  onChangeAttachmentNotebook?: (index: number, notebookCode: string) => void;
  cuadernosDisabled?: boolean;
};

const NEW_CASE_ATTACHMENT_ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/gif,image/tiff';

function PartyChip({
  party,
  tone = 'accent',
  editable = false,
  onChange,
}: {
  party: LegalAnalysis['accionantes'][number];
  tone?: 'accent' | 'neutral';
  editable?: boolean;
  onChange?: (patch: Partial<LegalAnalysis['accionantes'][number]>) => void;
}) {
  const id = party.identificacion?.trim();
  const email = party.email?.trim();
  const idFocus =
    tone === 'accent'
      ? 'focus:border-accent/40 focus:ring-accent/20'
      : 'focus:border-slate-300 focus:ring-slate-200';

  if (editable && onChange) {
    return (
      <li className="space-y-1.5 py-2.5 border-b border-slate-100/90 last:border-0 last:pb-0">
        <input
          type="text"
          value={party.nombre || ''}
          onChange={(e) => onChange({ nombre: e.target.value })}
          className="w-full min-w-0 rounded-md border border-transparent bg-transparent px-0 py-0 text-sm font-semibold text-slate-800 leading-snug hover:border-slate-200 focus:border-slate-200 focus:bg-slate-50 focus:px-2 focus:py-1 focus:outline-none focus:ring-2 focus:ring-slate-200/80 transition-all"
          placeholder="Nombre"
          aria-label="Nombre de la parte"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <input
            type="text"
            value={party.identificacion || ''}
            onChange={(e) => onChange({ identificacion: e.target.value })}
            className={`w-full min-w-0 rounded-md border border-slate-200 bg-slate-50/80 px-2 py-1.5 text-[11px] font-mono font-semibold text-slate-700 placeholder:text-slate-400 placeholder:font-sans placeholder:font-medium focus:outline-none focus:ring-2 ${idFocus}`}
            placeholder="C.C. / NIT (anexos)"
            aria-label="Identificación"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
          />
          <input
            type="email"
            value={party.email || ''}
            onChange={(e) => onChange({ email: e.target.value })}
            className="w-full min-w-0 rounded-md border border-slate-200 bg-slate-50/80 px-2 py-1.5 text-[11px] font-medium text-slate-600 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:border-slate-300 focus:ring-slate-200"
            placeholder="Correo (opcional)"
            aria-label="Correo electrónico"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </li>
    );
  }

  const idClass =
    tone === 'accent'
      ? 'text-accent bg-accent/5'
      : 'text-slate-500 bg-slate-100';

  return (
    <li className="flex items-start justify-between gap-3 py-2 border-b border-slate-100/90 last:border-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800 leading-snug truncate">{party.nombre || '—'}</p>
        {email ? (
          <p className="text-[10px] text-slate-500 font-medium truncate mt-0.5">{email}</p>
        ) : null}
      </div>
      <span
        className={`shrink-0 text-[9px] font-mono font-bold px-2 py-0.5 rounded-md uppercase tracking-wide ${idClass} ${
          id ? '' : 'opacity-50'
        }`}
      >
        {id || 'Sin ID'}
      </span>
    </li>
  );
}

export type CaseLegalAnalysisPanelProps = AiSectionProps | MetadataSectionProps;

export function CaseLegalAnalysisPanel(props: CaseLegalAnalysisPanelProps) {
  if (props.section === 'ai') {
    const { aiAnalysis, onDismissAnalysis, isCivilProcess = false, onChangeAnalysis } = props;
    const roles = partyRoleLabels(isCivilProcess ? 'civil_ordinario' : 'tutela_primera');
    const claimantsLabel = roles.claimantPlural;
    const defendantsLabel = roles.defendantPlural;
    const canEdit = Boolean(onChangeAnalysis);

    const patchParty = (
      side: 'accionantes' | 'accionados',
      index: number,
      patch: Partial<LegalAnalysis['accionantes'][number]>,
    ) => {
      if (!aiAnalysis || !onChangeAnalysis) return;
      const list = aiAnalysis[side].map((p, i) => (i === index ? { ...p, ...patch } : p));
      onChangeAnalysis({ ...aiAnalysis, [side]: list });
    };

    return (
      <AnimatePresence mode="wait">
        {aiAnalysis && (
          <motion.div
            key="ai-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:col-span-12 overflow-hidden"
          >
            <div className="card-modern p-6 sm:p-8 space-y-5 border-accent/20 bg-blue-50/10 shadow-2xl shadow-accent/5 backdrop-blur-sm mb-8">
              <div className="flex items-center justify-between gap-4 border-b border-accent/10 pb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 bg-accent rounded-xl flex items-center justify-center shadow-md shadow-accent/20 shrink-0">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 leading-none">
                      Análisis por Inteligencia Artificial
                    </h3>
                    <p className="text-[10px] font-bold text-accent uppercase tracking-widest mt-1.5 opacity-70 truncate">
                      {isCivilProcess
                        ? 'Extracción automática de datos judiciales (proceso civil / C.G.P.)'
                        : 'Extracción automática de datos judiciales (tutela)'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDismissAnalysis()}
                  className="text-slate-300 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-xl transition-all shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50/80 px-4 py-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-[9px] font-bold text-emerald-700/70 uppercase tracking-widest">
                    {isCivilProcess ? 'Tipo / pretensión jurídica' : 'Derecho tutelado'}
                  </p>
                  <p className="text-[12px] font-bold text-emerald-800 leading-snug mt-0.5">
                    {aiAnalysis.derechoTutelado}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:items-stretch">
                <section className="rounded-xl border border-slate-100 bg-white p-4 flex flex-col min-h-0 h-72">
                  <header className="flex items-baseline justify-between gap-2 mb-1 pb-2 border-b border-slate-100 shrink-0">
                    <div className="min-w-0">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {claimantsLabel}
                      </h4>
                      {canEdit ? (
                        <p className="text-[10px] text-slate-400 mt-0.5 font-medium normal-case tracking-normal">
                          Puede completar C.C./NIT si están en anexos
                        </p>
                      ) : null}
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 tabular-nums">
                      {aiAnalysis.accionantes.length}
                    </span>
                  </header>
                  <ul className="overflow-y-auto flex-1 min-h-0 pr-1">
                    {aiAnalysis.accionantes.map((p, i) => (
                      <PartyChip
                        key={`acc-${i}`}
                        party={p}
                        tone="accent"
                        editable={canEdit}
                        onChange={(patch) => patchParty('accionantes', i, patch)}
                      />
                    ))}
                  </ul>
                </section>

                <section className="rounded-xl border border-slate-100 bg-white p-4 flex flex-col min-h-0 h-72">
                  <header className="flex items-baseline justify-between gap-2 mb-1 pb-2 border-b border-slate-100 shrink-0">
                    <div className="min-w-0">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {defendantsLabel}
                      </h4>
                      {canEdit ? (
                        <p className="text-[10px] text-slate-400 mt-0.5 font-medium normal-case tracking-normal">
                          Puede completar C.C./NIT si están en anexos
                        </p>
                      ) : null}
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 tabular-nums">
                      {aiAnalysis.accionados.length}
                    </span>
                  </header>
                  <ul className="overflow-y-auto flex-1 min-h-0 pr-1">
                    {aiAnalysis.accionados.map((p, i) => (
                      <PartyChip
                        key={`acd-${i}`}
                        party={p}
                        tone="neutral"
                        editable={canEdit}
                        onChange={(patch) => patchParty('accionados', i, patch)}
                      />
                    ))}
                  </ul>
                </section>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:auto-rows-fr">
                <section className="rounded-xl border border-slate-100 bg-white p-4 flex flex-col h-64">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 shrink-0">
                    Resumen de pretensión
                  </h4>
                  <div className="flex-1 overflow-y-auto min-h-0 pr-1">
                    <p className="text-[12px] text-slate-600 font-medium leading-relaxed">
                      {aiAnalysis.pretensiones}
                    </p>
                  </div>
                </section>

                <section className="rounded-xl border border-slate-100 bg-white p-4 flex flex-col h-64">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 shrink-0">
                    Resumen de hechos relevantes
                  </h4>
                  <div className="flex-1 overflow-y-auto min-h-0 pr-1">
                    <p className="text-[12px] text-slate-600 font-medium leading-relaxed">
                      {aiAnalysis.hechos}
                    </p>
                  </div>
                </section>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  const {
    parsedData,
    attachments,
    selectedDocIndex,
    onSelectDocIndex,
    mergeSelected,
    isMerging,
    selectedForMerge,
    toggleSelectForMerge,
    editingIndex,
    setEditingIndex,
    editingName,
    setEditingName,
    handleRename,
    handleMove,
    onAddAttachments,
    onRemoveAttachment,
    isAddingAttachments = false,
    archiveLinkStatus = 'idle',
    archiveLinkError = null,
    onRetryArchiveLink,
    isCivilProcess = false,
    showCautelarCuadernoOption = false,
    abrirCuadernoCautelares = true,
    onAbrirCuadernoCautelaresChange,
    extraCuadernos = [],
    onAddExtraCuaderno,
    onRemoveExtraCuaderno,
    notebookOptions = [],
    defaultNotebookCode,
    onChangeAttachmentNotebook,
    cuadernosDisabled = false,
  } = props;

  const addFilesInputRef = useRef<HTMLInputElement>(null);
  const [newCuadernoLabel, setNewCuadernoLabel] = useState('');
  const [cuadernoSuggestOpen, setCuadernoSuggestOpen] = useState(false);
  const [sendToNotebookCode, setSendToNotebookCode] = useState('');

  const extrasVisible = extraCuadernos.filter(
    (e) => normalizeNotebookCode(e.code) !== NOTEBOOK_PI_C02_CAUTELAR
  );
  const cautelarAlreadyInExtras = caseHasCautelarNotebook(extraCuadernos);

  const presentNotebookCodes = useMemo(() => {
    const codes = [
      ...extraCuadernos.map((e) => e.code),
      ...(showCautelarCuadernoOption && abrirCuadernoCautelares
        ? [NOTEBOOK_PI_C02_CAUTELAR]
        : []),
    ];
    return codes;
  }, [extraCuadernos, showCautelarCuadernoOption, abrirCuadernoCautelares]);

  const cuadernoSuggestions = useMemo(
    () => matchPredefinedNotebooks(newCuadernoLabel, presentNotebookCodes),
    [newCuadernoLabel, presentNotebookCodes]
  );

  const principalNotebookCode = useMemo(
    () =>
      normalizeNotebookCode(
        defaultNotebookCode || notebookOptions[0]?.code || ''
      ),
    [defaultNotebookCode, notebookOptions]
  );

  const canMoveBetweenNotebooks =
    notebookOptions.length > 1 && Boolean(onChangeAttachmentNotebook);

  useEffect(() => {
    if (!notebookOptions.length) {
      setSendToNotebookCode('');
      return;
    }
    setSendToNotebookCode((prev) => {
      if (prev && notebookOptions.some((o) => o.code === prev)) return prev;
      const other = notebookOptions.find(
        (o) => normalizeNotebookCode(o.code) !== principalNotebookCode
      );
      return other?.code || notebookOptions[0]?.code || '';
    });
  }, [notebookOptions, principalNotebookCode]);

  const sendToLabel =
    notebookOptions.find((o) => o.code === sendToNotebookCode)?.label ||
    'cuaderno';

  const notebookShortLabelFor = (code: string | undefined) => {
    const normalized = normalizeNotebookCode(code || principalNotebookCode);
    return NOTEBOOK_META[normalized]?.shortLabel || notebookOptions.find((o) => o.code === normalized)?.label || 'C01';
  };

  const addCuadernoDraft = (draft: ExtraCuadernoDraft) => {
    if (!onAddExtraCuaderno || cuadernosDisabled) return;
    const label = draft.label.trim();
    if (!label) return;
    onAddExtraCuaderno({
      label,
      code: draft.code ? normalizeNotebookCode(draft.code) : undefined,
    });
    setNewCuadernoLabel('');
    setCuadernoSuggestOpen(false);
  };

  const submitNewCuaderno = () => {
    const label = newCuadernoLabel.trim();
    if (!label) return;
    const exact = cuadernoSuggestions.find(
      (s) => s.label.toLowerCase() === label.toLowerCase()
    );
    if (exact) {
      addCuadernoDraft({ code: exact.code, label: exact.label });
      return;
    }
    if (cuadernoSuggestions.length === 1) {
      const only = cuadernoSuggestions[0];
      addCuadernoDraft({ code: only.code, label: only.label });
      return;
    }
    addCuadernoDraft({ label });
  };

  const pickSuggestion = (item: PredefinedNotebookSuggestion) => {
    addCuadernoDraft({ code: item.code, label: item.label });
  };

  return (
    <div className="card-modern min-w-0 w-full max-w-full overflow-hidden p-5 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">Metadatos Extraídos</h2>
        <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-5 h-5" />
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            Cuadernos del expediente
          </label>
            <p className="text-[11px] leading-snug text-slate-600">
              Siempre existe el <span className="font-semibold">C01 principal</span>. Agregue
              cuadernos aquí y, en cada documento, elija a cuál va al radicar.
            </p>

          <ul className="space-y-1">
            <li className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700">
              C01 principal
              <span className="ml-2 text-[10px] font-medium text-slate-400">siempre</span>
            </li>
            {showCautelarCuadernoOption && onAbrirCuadernoCautelaresChange && !cautelarAlreadyInExtras ? (
              <li>
                <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent/30"
                    checked={abrirCuadernoCautelares}
                    disabled={cuadernosDisabled}
                    onChange={(e) => onAbrirCuadernoCautelaresChange(e.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="block text-[12px] font-semibold text-slate-800">
                      {NOTEBOOK_META[NOTEBOOK_PI_C02_CAUTELAR].label} (C02)
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Preset ejecutivo · también en SGDE al vincular
                    </span>
                  </span>
                </label>
              </li>
            ) : null}
            {extrasVisible.map((nb) => (
              <li
                key={nb.code}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <span className="min-w-0 truncate text-[12px] font-semibold text-slate-800">
                  {nb.label}
                </span>
                {onRemoveExtraCuaderno ? (
                  <button
                    type="button"
                    disabled={cuadernosDisabled}
                    onClick={() => onRemoveExtraCuaderno(nb.code)}
                    className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    title="Quitar cuaderno"
                    aria-label={`Quitar ${nb.label}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          {onAddExtraCuaderno ? (
            <div className="relative pt-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  type="text"
                  value={newCuadernoLabel}
                  disabled={cuadernosDisabled}
                  onChange={(e) => {
                    setNewCuadernoLabel(e.target.value);
                    setCuadernoSuggestOpen(true);
                  }}
                  onFocus={() => setCuadernoSuggestOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setCuadernoSuggestOpen(false), 150);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitNewCuaderno();
                    }
                    if (e.key === 'Escape') {
                      setCuadernoSuggestOpen(false);
                    }
                  }}
                  placeholder="Escriba o elija (ej. med → Medidas cautelares)"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-50"
                  autoComplete="off"
                />
                <button
                  type="button"
                  disabled={cuadernosDisabled || !newCuadernoLabel.trim()}
                  onClick={submitNewCuaderno}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 hover:border-accent/40 hover:text-accent disabled:opacity-50"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  Agregar
                </button>
              </div>
              {cuadernoSuggestOpen && cuadernoSuggestions.length > 0 ? (
                <ul
                  className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-md"
                  role="listbox"
                >
                  {cuadernoSuggestions.map((item) => (
                    <li key={item.code}>
                      <button
                        type="button"
                        role="option"
                        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-accent/5"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickSuggestion(item)}
                      >
                        <span className="text-[12px] font-semibold text-slate-800">
                          {item.label}
                        </span>
                        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                          {NOTEBOOK_META[item.code]?.shortLabel || 'Predefinido'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        {parsedData.linkFound && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-blue-500 uppercase tracking-widest flex items-center gap-2">
              <ExternalLink className="w-3 h-3" /> Link &quot;Archivo&quot; Detectado
            </label>
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-blue-700 text-[11px] font-medium break-all flex flex-col gap-2">
              <span className="opacity-90">
                {archiveLinkStatus === 'loading' ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    Descargando expediente del portal Demanda en línea (puede tardar ~30–90 s; archivos grandes)…
                  </span>
                ) : archiveLinkStatus === 'ok' ? (
                  'Expediente del enlace descargado y añadido a la lista de documentos.'
                ) : archiveLinkStatus === 'error' ? (
                  archiveLinkError ||
                  'No se pudo descargar el expediente del enlace. Puede reintentar o añadir el PDF manualmente.'
                ) : attachments.some((a) => a.isFromLink) ? (
                  'Expediente del enlace disponible en la lista de documentos.'
                ) : (
                  'Enlace detectado. La descarga del portal se hace en segundo plano (no bloquea el parseo del correo).'
                )}
              </span>
              <div className="bg-white/80 p-2 rounded-lg border border-blue-200/50 break-all">
                {parsedData.linkUrl}
              </div>
              {archiveLinkStatus === 'error' && onRetryArchiveLink ? (
                <button
                  type="button"
                  onClick={onRetryArchiveLink}
                  className="self-start text-[10px] font-bold uppercase tracking-wide text-blue-800 underline underline-offset-2"
                >
                  Reintentar descarga
                </button>
              ) : null}
            </div>
          </div>
        )}

        <div className="pt-1 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Documentos identificados
              {attachments.length > 0 ? ` (${attachments.length})` : ''}
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                ref={addFilesInputRef}
                type="file"
                multiple
                accept={NEW_CASE_ATTACHMENT_ACCEPT}
                className="sr-only"
                disabled={isAddingAttachments || isMerging || editingIndex !== null}
                onChange={(e) => {
                  const list = e.target.files;
                  if (list?.length) onAddAttachments(list);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => addFilesInputRef.current?.click()}
                disabled={isAddingAttachments || isMerging || editingIndex !== null}
                className="text-[9px] font-black tracking-tighter uppercase px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 flex items-center gap-1.5 transition-all hover:border-accent hover:text-accent disabled:opacity-50"
                title="Adjuntar PDF o imagen desde su equipo"
              >
                {isAddingAttachments ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Agregar
              </button>
              <button
                type="button"
                onClick={mergeSelected}
                disabled={isMerging || selectedForMerge.length <= 1 || editingIndex !== null}
                className={`text-[9px] font-black tracking-tighter uppercase px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all ${
                  selectedForMerge.length > 1
                    ? 'bg-accent text-white border-accent hover:bg-accent-dark'
                    : 'bg-slate-100 text-slate-400 border-slate-200 opacity-60'
                }`}
              >
                {isMerging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Combine className="w-3 h-3" />}
                Unir ({selectedForMerge.length})
              </button>
            </div>
          </div>

          {canMoveBetweenNotebooks ? (
            <div className="flex items-center gap-2 min-w-0">
              <label
                htmlFor="new-case-send-to-notebook"
                className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-400"
              >
                Enviar a
              </label>
              <select
                id="new-case-send-to-notebook"
                value={sendToNotebookCode}
                disabled={cuadernosDisabled}
                onChange={(e) => setSendToNotebookCode(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-800 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-50"
              >
                {notebookOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
            {attachments.map((att, idx) => {
              const isEditingRow = editingIndex === idx;
              const selected = selectedDocIndex === idx;
              const currentNb = normalizeNotebookCode(
                att.notebookCode || principalNotebookCode
              );
              const alreadyInTarget =
                currentNb === normalizeNotebookCode(sendToNotebookCode);
              const sizeLabel =
                att.size >= 1024 * 1024
                  ? `${(att.size / (1024 * 1024)).toFixed(1)} MB`
                  : `${(att.size / 1024).toFixed(1)} KB`;

              if (isEditingRow) {
                return (
                  <div
                    key={idx}
                    className="space-y-2 bg-blue-50/40 px-2.5 py-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                      Nombre del archivo
                    </p>
                    <input
                      id={`rename-attachment-${idx}`}
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(idx);
                        if (e.key === 'Escape') setEditingIndex(null);
                      }}
                      className="input-modern box-border block w-full max-w-full py-1.5 text-sm font-semibold text-slate-800"
                      style={{ width: '100%' }}
                      autoFocus
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleRename(idx)}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-600"
                        title="Confirmar (Enter)"
                      >
                        <Check className="h-3.5 w-3.5 shrink-0" />
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingIndex(null)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                        title="Cancelar (Esc)"
                      >
                        <X className="h-3.5 w-3.5 shrink-0" />
                        Cancelar
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  className={`group flex h-10 items-center gap-1.5 px-2 min-w-0 transition-colors cursor-pointer ${
                    selected
                      ? 'bg-blue-50/80 ring-1 ring-inset ring-accent/20'
                      : 'hover:bg-slate-50'
                  }`}
                  onClick={() => onSelectDocIndex(idx)}
                >
                  {isMergeableAttachment(att) ? (
                    <input
                      type="checkbox"
                      checked={selectedForMerge.includes(idx)}
                      onChange={() => toggleSelectForMerge(idx)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-3.5 h-3.5 shrink-0 rounded border-slate-300 text-accent focus:ring-accent accent-accent cursor-pointer"
                    />
                  ) : (
                    <span className="w-3.5 shrink-0" aria-hidden />
                  )}
                  <FileText
                    className={`w-3.5 h-3.5 shrink-0 ${
                      selected ? 'text-accent' : 'text-slate-400'
                    }`}
                  />
                  <p
                    className={`min-w-0 flex-1 truncate text-[12px] font-semibold ${
                      selected ? 'text-accent' : 'text-slate-700'
                    }`}
                    title={att.filename}
                  >
                    {att.filename}
                  </p>
                  {att.type === 'email_body' ? (
                    <span className="shrink-0 text-[8px] font-black uppercase tracking-tighter text-violet-600 bg-violet-100 px-1 py-0.5 rounded">
                      Correo
                    </span>
                  ) : null}
                  {att.isFromLink ? (
                    <span className="shrink-0 text-[8px] font-black uppercase tracking-tighter text-blue-500 bg-blue-100 px-1 py-0.5 rounded">
                      Link
                    </span>
                  ) : null}
                  {canMoveBetweenNotebooks ? (
                    <span
                      className="shrink-0 max-w-[5.5rem] truncate rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500"
                      title={notebookShortLabelFor(currentNb)}
                    >
                      {notebookShortLabelFor(currentNb)}
                    </span>
                  ) : null}
                  <span className="shrink-0 tabular-nums text-[10px] font-medium text-slate-400 w-14 text-right">
                    {sizeLabel}
                  </span>
                  {canMoveBetweenNotebooks &&
                  onChangeAttachmentNotebook &&
                  !alreadyInTarget &&
                  sendToNotebookCode ? (
                    <button
                      type="button"
                      disabled={cuadernosDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        onChangeAttachmentNotebook(idx, sendToNotebookCode);
                      }}
                      className="shrink-0 rounded-md border border-accent/30 bg-accent/5 p-1 text-accent hover:bg-accent hover:text-white disabled:opacity-40"
                      title={`Enviar a ${sendToLabel}`}
                    >
                      <FolderInput className="w-3.5 h-3.5" />
                    </button>
                  ) : canMoveBetweenNotebooks ? (
                    <span className="w-7 shrink-0" aria-hidden />
                  ) : null}
                  <div className="flex shrink-0 items-center gap-0 opacity-70 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingIndex(idx);
                        setEditingName(att.filename);
                      }}
                      className="p-1 text-slate-400 hover:text-accent rounded"
                      title="Renombrar"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveAttachment(idx);
                      }}
                      className="p-1 text-slate-400 hover:text-red-600 rounded"
                      title="Quitar de la lista"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMove(idx, 'up');
                      }}
                      disabled={idx === 0}
                      className="p-1 text-slate-400 hover:text-accent disabled:opacity-20 rounded"
                      title="Subir"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMove(idx, 'down');
                      }}
                      disabled={idx === attachments.length - 1}
                      className="p-1 text-slate-400 hover:text-accent disabled:opacity-20 rounded"
                      title="Bajar"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
