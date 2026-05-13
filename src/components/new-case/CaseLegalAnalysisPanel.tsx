import React from 'react';
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
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { LegalAnalysis } from './new-case-types';

export type CaseLegalAnalysisParsedSnapshot = {
  subject?: string;
  from?: string;
  linkFound?: boolean;
  linkUrl?: string | null;
};

export type CaseLegalAnalysisAttachmentRow = {
  filename: string;
  contentType?: string;
  size: number;
  isFromLink?: boolean;
};

type AiSectionProps = {
  section: 'ai';
  aiAnalysis: LegalAnalysis | null;
  onDismissAnalysis: () => void;
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
};

export type CaseLegalAnalysisPanelProps = AiSectionProps | MetadataSectionProps;

export function CaseLegalAnalysisPanel(props: CaseLegalAnalysisPanelProps) {
  if (props.section === 'ai') {
    const { aiAnalysis, onDismissAnalysis } = props;
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
            <div className="card-modern p-10 space-y-8 border-accent/20 bg-blue-50/10 shadow-2xl shadow-accent/5 backdrop-blur-sm mb-8">
              <div className="flex items-center justify-between border-b border-accent/10 pb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-accent rounded-2xl flex items-center justify-center shadow-lg shadow-accent/20">
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 leading-none">
                      Análisis por Inteligencia Artificial
                    </h3>
                    <p className="text-[10px] font-bold text-accent uppercase tracking-widest mt-1.5 opacity-70">
                      Extracción automática de datos judiciales bajo C.P.C.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDismissAnalysis()}
                  className="text-slate-300 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-xl transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                <div className="space-y-6">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Accionantes (Demandantes)
                      {aiAnalysis.accionantes.length > 1 ? ` (${aiAnalysis.accionantes.length})` : ''}
                    </label>
                    <div className="space-y-3">
                      {aiAnalysis.accionantes.map((p, i) => (
                        <div
                          key={`acc-${i}`}
                          className="space-y-1 border-b border-slate-100/80 pb-3 last:border-0 last:pb-0"
                        >
                          <p className="text-sm font-black text-slate-800 leading-tight">{p.nombre || '—'}</p>
                          <p className="text-[10px] font-mono font-bold text-accent bg-accent/5 px-2 py-0.5 rounded-md inline-block uppercase">
                            {p.identificacion?.trim() || 'C.C. NO DETECTADA'}
                          </p>
                          <p className="text-[10px] text-slate-500 font-medium truncate">
                            {p.email?.trim() || 'Email no detectado'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Accionados (Contraparte)
                      {aiAnalysis.accionados.length > 1 ? ` (${aiAnalysis.accionados.length})` : ''}
                    </label>
                    <div className="space-y-3">
                      {aiAnalysis.accionados.map((p, i) => (
                        <div
                          key={`acd-${i}`}
                          className="space-y-1 border-b border-slate-100/80 pb-3 last:border-0 last:pb-0"
                        >
                          <p className="text-sm font-black text-slate-800 leading-tight">{p.nombre || '—'}</p>
                          <p className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md inline-block uppercase">
                            {p.identificacion?.trim() || 'NIT / ID NO DETECTADO'}
                          </p>
                          <p className="text-[10px] text-slate-500 font-medium truncate">
                            {p.email?.trim() || 'Email no detectado'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Derecho Tutelado
                    </label>
                    <div className="bg-emerald-50 border border-emerald-100 px-4 py-2.5 rounded-2xl text-[11px] font-black text-emerald-700 inline-block uppercase shadow-sm">
                      {aiAnalysis.derechoTutelado}
                    </div>
                  </div>
                  <div className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Resumen de Pretensión
                    </label>
                    <p className="text-[11px] text-slate-600 font-medium leading-relaxed mt-2 italic">
                      &quot;{aiAnalysis.pretensiones}&quot;
                    </p>
                  </div>
                </div>

                <div className="md:col-span-2 space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Resumen de Hechos Relevantes
                  </label>
                  <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-full flex flex-col justify-center">
                    <p className="text-[11px] text-slate-600 font-medium leading-loose italic">
                      &quot;{aiAnalysis.hechos}&quot;
                    </p>
                  </div>
                </div>
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
  } = props;

  return (
    <div className="card-modern p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Metadatos Extraídos</h2>
        <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
          <CheckCircle2 className="w-5 h-5" />
        </div>
      </div>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Asunto del Correo</label>
          <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl font-bold text-slate-700 text-sm">
            {parsedData.subject || 'SIN TÍTULO DETECTADO'}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Interviniente (Accionante)
          </label>
          <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-slate-600 text-sm font-medium truncate">
            {parsedData.from}
          </div>
        </div>

        {parsedData.linkFound && (
          <div className="space-y-1.5 pt-2">
            <label className="text-[10px] font-bold text-blue-500 uppercase tracking-widest px-1 flex items-center gap-2">
              <ExternalLink className="w-3 h-3" /> Link &quot;Archivo&quot; Detectado
            </label>
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-blue-700 text-[11px] font-medium break-all flex flex-col gap-2">
              <span className="opacity-70">
                Se detectó y procesó automáticamente el link de descarga mencionado en el cuerpo del correo.
              </span>
              <div className="bg-white/80 p-2 rounded-lg border border-blue-200/50 truncate">{parsedData.linkUrl}</div>
            </div>
          </div>
        )}

        <div className="pt-4 flex items-center justify-between">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">
            Documentos Identificados
          </label>
          <button
            type="button"
            onClick={mergeSelected}
            disabled={isMerging || selectedForMerge.length <= 1}
            className={`text-[9px] font-black tracking-tighter uppercase px-2 py-1 rounded-lg border flex items-center gap-1.5 transition-all ${
              selectedForMerge.length > 1
                ? 'bg-accent text-white border-accent hover:bg-accent-dark'
                : 'bg-slate-100 text-slate-400 border-slate-200 opacity-60'
            }`}
          >
            {isMerging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Combine className="w-3 h-3" />}
            Unir Seleccionados ({selectedForMerge.length})
          </button>
        </div>

        <div className="space-y-1.5">
          <div className="grid grid-cols-1 gap-2.5">
            <div
              onClick={() => onSelectDocIndex(-1)}
              className={`flex items-center justify-between p-3.5 border rounded-xl text-[11px] font-bold cursor-pointer transition-all duration-200 group ${
                selectedDocIndex === -1
                  ? 'border-accent bg-blue-50/50 text-accent ring-2 ring-accent/5 translate-x-1'
                  : 'border-slate-100 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <div
                  className={`p-1.5 rounded-lg ${
                    selectedDocIndex === -1 ? 'bg-accent text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                </div>
                CorreoReparto
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[8px] px-2 py-0.5 rounded-full font-black tracking-tighter uppercase ${
                    selectedDocIndex === -1 ? 'bg-accent text-white' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  Principal
                </span>
              </div>
            </div>

            {attachments.map((att, idx) => (
              <div
                key={idx}
                className={`group relative flex items-center justify-between p-3.5 border rounded-xl text-[11px] font-bold transition-all duration-200 ${
                  selectedDocIndex === idx
                    ? 'border-accent bg-blue-50/50 text-accent ring-2 ring-accent/5 translate-x-1'
                    : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {att.contentType === 'application/pdf' && (
                    <input
                      type="checkbox"
                      checked={selectedForMerge.includes(idx)}
                      onChange={() => toggleSelectForMerge(idx)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-slate-300 text-accent focus:ring-accent accent-accent cursor-pointer"
                    />
                  )}
                  <div
                    onClick={() => onSelectDocIndex(idx)}
                    className="flex-1 cursor-pointer flex items-center gap-2.5 min-w-0"
                  >
                    <div
                      className={`p-1.5 rounded-lg shrink-0 ${
                        selectedDocIndex === idx ? 'bg-accent text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </div>
                    {editingIndex === idx ? (
                      <div className="flex items-center gap-1 min-w-0 flex-1 bg-white" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename(idx);
                            if (e.key === 'Escape') setEditingIndex(null);
                          }}
                          className="flex-1 bg-slate-50 border border-accent/30 rounded px-2 py-1 text-[11px] font-bold focus:ring-2 focus:ring-accent/20 outline-none min-w-0 shadow-inner"
                          autoFocus
                        />
                        <div className="flex items-center gap-0.5 shrink-0 ml-1">
                          <button
                            type="button"
                            onClick={() => handleRename(idx)}
                            className="text-white bg-emerald-500 p-1 hover:bg-emerald-600 rounded transition-colors shadow-sm"
                            title="Confirmar (Enter)"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingIndex(null)}
                            className="text-slate-400 bg-slate-100 p-1 hover:bg-slate-200 rounded transition-colors"
                            title="Cancelar (Esc)"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="truncate">{att.filename}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-2">
                  {!editingIndex && (
                    <div className="hidden group-hover:flex items-center gap-1 pr-1 border-r border-slate-100 mr-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingIndex(idx);
                          setEditingName(att.filename);
                        }}
                        className="p-1 text-slate-400 hover:text-accent hover:bg-white rounded transition-colors"
                        title="Renombrar"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <div className="flex flex-col">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMove(idx, 'up');
                          }}
                          disabled={idx === 0}
                          className="p-0.5 text-slate-400 hover:text-accent disabled:opacity-20"
                          title="Subir"
                        >
                          <ArrowUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMove(idx, 'down');
                          }}
                          disabled={idx === attachments.length - 1}
                          className="p-0.5 text-slate-400 hover:text-accent disabled:opacity-20"
                          title="Bajar"
                        >
                          <ArrowDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {att.isFromLink && (
                    <span className="text-[8px] font-black tracking-tighter uppercase text-blue-500 bg-blue-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                      LINK
                    </span>
                  )}
                  <span className="text-[10px] tabular-nums font-medium text-slate-300">
                    {(att.size / 1024).toFixed(1)} KB
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
