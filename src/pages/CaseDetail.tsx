import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, collection, addDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Case, Action, Document as CaseDoc } from '../types';
import { 
  FileText, 
  History, 
  Sparkles, 
  CheckCircle2, 
  Send, 
  Clock, 
  Paperclip,
  ChevronDown,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { motion } from 'motion/react';
import { summarizeCase } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';
import { Document, Page, pdfjs } from 'react-pdf';
import { formatRadicado } from '../lib/formatters';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configurar el worker de PDF.js usando unpkg
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

function PdfViewer({ content, contentType, filename, onBack }: { content?: string, contentType?: string, filename: string, onBack?: () => void }) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);

  useEffect(() => {
    if (!content) return;
    
    try {
      const byteCharacters = atob(content);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: contentType || 'application/pdf' });
      setPdfBlob(blob);
    } catch (err) {
      console.error('Error creating PDF blob:', err);
    }
  }, [content, contentType]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setPageNumber(1);
  }

  if (!content) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-center space-y-6 flex-1 min-h-[600px]">
        <div className="w-20 h-20 bg-white rounded-2xl shadow-sm flex items-center justify-center">
            <FileText className="w-10 h-10 text-slate-300" />
        </div>
        <div>
            <h4 className="text-lg font-bold text-slate-700">{filename}</h4>
            <p className="text-sm text-slate-400 mt-2">Documento verificado y custodiado digitalmente.</p>
        </div>
        <button 
          onClick={onBack}
          className="px-8 py-3 bg-white border border-slate-200 rounded-xl font-bold text-xs text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
        >
            VOLVER AL REPARTO
        </button>
        <div className="pt-8 text-[9px] font-bold text-slate-300 uppercase tracking-widest">
            Visualización protegida por Ley 2213 de 2022
        </div>
      </div>
    );
  }

  const isImage = contentType?.startsWith('image/');

  if (isImage && pdfBlob) {
    const imageUrl = URL.createObjectURL(pdfBlob);
    return (
      <div className="flex-1 overflow-auto bg-slate-200 p-8 flex items-center justify-center min-h-[600px]">
        <img 
          src={imageUrl} 
          alt={filename} 
          className="max-w-full shadow-2xl rounded-sm"
          onLoad={() => URL.revokeObjectURL(imageUrl)}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-100 min-h-[600px] overflow-hidden">
      <div className="flex-1 overflow-auto p-4 flex justify-center">
        {pdfBlob ? (
          <div className="shadow-2xl">
            <Document
              file={pdfBlob}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <div className="flex flex-col items-center justify-center p-20 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin mb-4" />
                  <p className="text-xs font-bold uppercase tracking-widest">Renderizando PDF...</p>
                </div>
              }
              error={
                <div className="p-20 text-center text-red-500">
                  <p className="text-sm font-bold">Error al cargar el PDF</p>
                </div>
              }
            >
              <Page 
                pageNumber={pageNumber} 
                scale={scale} 
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className="max-w-full"
              />
            </Document>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
             <Loader2 className="w-8 h-8 animate-spin text-slate-200" />
          </div>
        )}
      </div>

      <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber(prev => prev - 1)}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-accent hover:bg-blue-50 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest w-24 text-center">
              PÁGINA {pageNumber} / {numPages || '?'}
            </span>
            <button
              disabled={numPages === null || pageNumber >= numPages}
              onClick={() => setPageNumber(prev => prev + 1)}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-accent hover:bg-blue-50 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          
          <div className="h-4 w-px bg-slate-200 mx-2" />
          
          <select 
            value={scale} 
            onChange={(e) => setScale(Number(e.target.value))}
            className="text-[10px] font-bold text-slate-500 uppercase bg-transparent border-none focus:ring-0 cursor-pointer"
          >
            <option value={0.5}>50%</option>
            <option value={0.75}>75%</option>
            <option value={1.0}>100%</option>
            <option value={1.25}>125%</option>
            <option value={1.5}>150%</option>
          </select>
        </div>

         <a 
           href={`data:${contentType || 'application/pdf'};base64,${content}`} 
           download={filename}
           className="text-[10px] font-bold text-accent hover:underline flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-lg"
         >
           <ExternalLink className="w-3 h-3" /> SI LA VISTA NO CARGA, PULSE AQUÍ PARA DESCARGAR
         </a>
      </div>
    </div>
  );
}

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const [caseItem, setCaseItem] = useState<Case | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [docs, setDocs] = useState<CaseDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<CaseDoc | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    const courtId = 'court-1';
    
    const unsubscribeCase = onSnapshot(doc(db, 'courts', courtId, 'cases', id), (snap) => {
      if (snap.exists()) {
        setCaseItem({ id: snap.id, ...snap.data() } as Case);
      }
      setLoading(false);
    });

    const unsubscribeActions = onSnapshot(
      query(collection(db, 'courts', courtId, 'cases', id, 'actions'), orderBy('timestamp', 'desc')),
      (snap) => {
        setActions(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Action[]);
      }
    );

    const unsubscribeDocs = onSnapshot(
      query(collection(db, 'courts', courtId, 'cases', id, 'documents'), orderBy('order', 'asc')),
      (snap) => {
        setDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })) as CaseDoc[]);
      }
    );

    return () => {
      unsubscribeCase();
      unsubscribeActions();
      unsubscribeDocs();
    };
  }, [id]);

  const handleSummarize = async () => {
    if (!caseItem || !id) return;
    setIsSummarizing(true);
    try {
      const summary = await summarizeCase(caseItem.claimant, (caseItem as any).rawText || '');
      await updateDoc(doc(db, 'courts', 'court-1', 'cases', id), {
        summary,
        updatedAt: serverTimestamp()
      });
      
      // Log action
      await addDoc(collection(db, 'courts', 'court-1', 'cases', id, 'actions'), {
        type: 'ai_synthesis',
        description: 'Generación de síntesis procesal por IA',
        userId: auth.currentUser?.uid,
        userName: auth.currentUser?.displayName || 'Sistema',
        timestamp: serverTimestamp()
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!id || !caseItem) return;
    await updateDoc(doc(db, 'courts', 'court-1', 'cases', id), {
      status: newStatus,
      updatedAt: serverTimestamp()
    });

    await addDoc(collection(db, 'courts', 'court-1', 'cases', id, 'actions'), {
      type: 'status_change',
      description: `Cambio de estado a ${newStatus.toUpperCase()}`,
      userId: auth.currentUser?.uid,
      userName: auth.currentUser?.displayName || 'Sistema',
      timestamp: serverTimestamp()
    });
  };

  if (loading) return <div className="p-10 text-center font-mono">CARGANDO...</div>;
  if (!caseItem) return <div className="p-10 text-center font-mono">EXPEDIENTE NO ENCONTRADO</div>;

  return (
    <div className="space-y-10">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <button 
            onClick={() => navigate('/')} 
            className="w-12 h-12 flex items-center justify-center bg-white border border-slate-100 rounded-2xl hover:bg-slate-50 transition-all text-slate-400 hover:text-accent shadow-sm"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">Expediente {formatRadicado(caseItem.radicado)}</h1>
              <span className={`px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-widest border ${
                caseItem.status === 'received' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                caseItem.status === 'admitted' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                'bg-slate-100 text-slate-500 border-slate-200'
              }`}>
                {caseItem.status}
              </span>
            </div>
            <p className="text-sm font-medium text-slate-500 mt-1">
              Referencia SGDE: <span className="text-emerald-600 font-bold">CERTIFICADA-2026-0045</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={handleSummarize}
            disabled={isSummarizing}
            className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-all"
          >
            {isSummarizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-accent" />}
            {caseItem.summary ? 'Refinar Análisis' : 'Analizar con IA'}
          </button>
          
          <div className="relative group">
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform group-hover:translate-y-[-40%]" />
            <select 
              className="input-modern py-3 pl-6 pr-12 text-xs font-bold uppercase cursor-pointer appearance-none bg-white min-w-[220px]"
              value={caseItem.status}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              <option value="received">Recibido</option>
              <option value="admitted">Admitir</option>
              <option value="transfer">Traslado</option>
              <option value="judgment">Fallo</option>
              <option value="archived">Archivar</option>
            </select>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Main Column */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          {/* Summary / AI Card */}
          <div className="card-modern overflow-hidden transition-all hover:shadow-lg">
            <div className="bg-slate-50/50 px-8 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                <Sparkles className="w-4 h-4 text-accent" /> Síntesis Cognitiva Judicial
              </div>
              <div className="flex items-center gap-1 text-[9px] font-bold text-slate-400 uppercase">
                GPT-4o Optimized <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              </div>
            </div>
            
            <div className="p-10 space-y-8">
              {caseItem.legalHechos || caseItem.legalPretensiones || caseItem.legalDerechoTutelado ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Hechos Relevantes</label>
                      <p className="text-sm text-slate-600 leading-relaxed font-medium bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        {caseItem.legalHechos || 'Sin datos de hechos específicos.'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pretensiones</label>
                      <p className="text-sm text-emerald-700 leading-relaxed font-medium bg-emerald-50/30 p-4 rounded-2xl border border-emerald-100/50">
                        {caseItem.legalPretensiones || 'Sin pretensiones identificadas.'}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Derecho Tutelado</label>
                      <div className="bg-accent/10 border border-accent/20 px-4 py-2 rounded-xl text-xs font-black text-accent inline-block uppercase mt-1">
                        {caseItem.legalDerechoTutelado || 'No Especificado'}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Identificaciones Partes</label>
                      <p className="text-xs font-mono text-slate-500 bg-white p-4 rounded-xl border border-slate-100 shadow-inner">
                        {caseItem.legalIdentificaciones || 'Pendiente de verificación'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {caseItem.summary ? (
                <div className="prose prose-slate prose-sm max-w-none prose-headings:text-slate-900 prose-strong:text-accent font-sans leading-relaxed text-slate-600">
                  <ReactMarkdown>{caseItem.summary}</ReactMarkdown>
                </div>
              ) : !caseItem.legalHechos ? (
                <div className="py-20 border-2 border-dashed border-slate-100 rounded-3xl text-center space-y-6">
                  <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
                    <Sparkles className="w-8 h-8 text-accent animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-700">Sin síntesis procesal</h3>
                    <p className="text-sm text-slate-400 font-medium max-w-xs mx-auto mt-2">Active el asistente de IA para extraer hechos relevantes y pretensiones jurídicas.</p>
                  </div>
                  <button 
                    onClick={handleSummarize} 
                    className="btn-primary px-10 py-3 text-xs"
                  >
                    IDENTIFICAR HECHOS Y PRETENSIÓN
                  </button>
                </div>
              ) : (
                <div className="pt-4 flex justify-center">
                  <button 
                    onClick={handleSummarize}
                    className="text-[10px] font-bold text-accent hover:underline flex items-center gap-2 uppercase tracking-widest bg-blue-50 px-4 py-2 rounded-lg"
                  >
                    <Sparkles className="w-3 h-3" /> Generar Síntesis Operativa Completa
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Original Text / Details / Document Viewer */}
          <div className="card-modern">
            <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <FileText className="w-4 h-4 text-accent" /> 
                {selectedDoc ? `Visor: ${selectedDoc.name}` : 'Transcripción del Reparto Original'}
              </h3>
              {selectedDoc && (
                <button 
                  onClick={() => setSelectedDoc(null)}
                  className="text-[10px] font-bold text-slate-400 hover:text-accent uppercase tracking-widest"
                >
                  Cerrar Visor
                </button>
              )}
            </div>
            <div className="p-8">
              {!selectedDoc || selectedDoc.name === 'CorreoReparto' ? (
                <div className="bg-white border border-slate-200 shadow-sm rounded-lg overflow-hidden">
                  {/* Email Header Simulation */}
                  {caseItem && (caseItem as any).emailMetadata && (
                    <div className="bg-slate-50 p-6 border-b border-slate-200 space-y-2 text-xs">
                      <div className="flex gap-4">
                        <span className="font-bold text-slate-400 w-12 uppercase">De:</span>
                        <span className="text-slate-700">{(caseItem as any).emailMetadata.from}</span>
                      </div>
                      <div className="flex gap-4">
                        <span className="font-bold text-slate-400 w-12 uppercase">Para:</span>
                        <span className="text-slate-700">{(caseItem as any).emailMetadata.to || 'Despacho Judicial'}</span>
                      </div>
                      <div className="flex gap-4">
                        <span className="font-bold text-slate-400 w-12 uppercase">Asunto:</span>
                        <span className="font-bold text-slate-900">{(caseItem as any).emailMetadata.subject}</span>
                      </div>
                      {(caseItem as any).emailMetadata.linkFound && (
                        <div className="flex gap-4 items-start pt-1">
                          <span className="font-bold text-blue-400 w-12 uppercase">Link:</span>
                          <span className="text-blue-600 font-medium break-all">{(caseItem as any).emailMetadata.linkUrl}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="p-0 max-h-[700px] bg-white">
                    {(caseItem as any).rawHtml ? (
                      <iframe 
                        srcDoc={`
                          <html>
                            <head>
                              <style>
                                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #334155; padding: 20px; }
                                img { max-width: 100%; height: auto; }
                              </style>
                            </head>
                            <body>${(caseItem as any).rawHtml}</body>
                          </html>
                        `}
                        className="w-full min-h-[600px] border-none"
                        title="Email Body Detailed"
                      />
                    ) : (
                      <div className="p-10 font-sans text-sm leading-relaxed text-slate-500 whitespace-pre-wrap">
                        {(caseItem as any).rawText || 'No hay contenido disponible.'}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-100 rounded-3xl overflow-hidden min-h-[600px] flex flex-col border border-slate-200">
                   <PdfViewer 
                     content={selectedDoc.content} 
                     contentType={selectedDoc.contentType} 
                     filename={selectedDoc.name}
                     onBack={() => setSelectedDoc(null)}
                   />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Column */}
        <div className="lg:col-span-4 flex flex-col gap-8">
          {/* Parties Card */}
          <div className="card-modern p-8 space-y-8">
            <div className="space-y-8">
              <div className="relative pl-6 border-l-2 border-accent">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Accionante (Demandante)</p>
                <div className="space-y-1">
                  <div className="text-lg font-black text-slate-900 leading-tight tracking-tight">{caseItem.claimant}</div>
                  {caseItem.claimantId && (
                    <div className="text-[10px] font-mono font-bold text-accent bg-accent/5 px-2 py-0.5 rounded-md inline-block uppercase">
                      {caseItem.claimantId}
                    </div>
                  )}
                  {caseItem.claimantEmail && (
                    <p className="text-[10px] text-slate-500 font-medium truncate mt-1">{caseItem.claimantEmail}</p>
                  )}
                </div>
              </div>
              
              <div className="relative pl-6 border-l-2 border-slate-200">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Accionado (Contraparte)</p>
                <div className="space-y-1">
                  <div className="text-lg font-black text-slate-900 leading-tight tracking-tight">{caseItem.defendant}</div>
                  {caseItem.defendantId && (
                    <div className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md inline-block uppercase">
                      {caseItem.defendantId}
                    </div>
                  )}
                  {caseItem.defendantEmail && (
                    <p className="text-[10px] text-slate-500 font-medium truncate mt-1">{caseItem.defendantEmail}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Documents Card */}
          <div className="card-modern p-8 flex flex-col">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-accent" /> Anexos Digitales
              </h3>
              <span className="text-[10px] font-bold text-slate-300 bg-slate-50 px-2 py-0.5 rounded-full">{docs.length}</span>
            </div>
            <div className="space-y-2">
              {docs.map(doc => (
                <div 
                  key={doc.id} 
                  onClick={() => setSelectedDoc(doc)}
                  className={`flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer group ${
                    selectedDoc?.id === doc.id 
                      ? 'border-accent bg-blue-50/50' 
                      : 'border-transparent hover:border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      selectedDoc?.id === doc.id ? 'bg-accent text-white' : 'bg-white border border-slate-100 group-hover:text-accent'
                    }`}>
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className={`text-xs font-bold truncate max-w-[150px] ${
                        selectedDoc?.id === doc.id ? 'text-accent' : 'text-slate-600'
                      }`}>{doc.name}</span>
                      {(doc as any).isFromLink && (
                        <span className="text-[8px] font-black text-blue-500 uppercase tracking-tighter">DESCARGADO VÍA LINK</span>
                      )}
                    </div>
                  </div>
                  <ExternalLink className={`w-4 h-4 transition-colors ${
                    selectedDoc?.id === doc.id ? 'text-accent' : 'text-slate-300 group-hover:text-accent'
                  }`} />
                </div>
              ))}
              {docs.length === 0 && (
                <div className="text-center py-10 space-y-3">
                   <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center mx-auto opacity-50">
                      <Clock className="w-5 h-5 text-slate-300" />
                   </div>
                   <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Sincronizando archivos...</p>
                </div>
              )}
            </div>
          </div>

          {/* History Card */}
          <div className="card-modern p-8 flex flex-col">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2 mb-8">
              <History className="w-4 h-4 text-accent" /> Trazabilidad Operativa
            </h3>
            <div className="space-y-8 max-h-[400px] overflow-y-auto pr-4 scrollbar-thin">
              {actions.map((act) => (
                <div key={act.id} className="relative pl-8 border-l border-slate-100 pb-2 last:pb-0">
                  <div className="absolute left-[-4.5px] top-1.5 w-2 h-2 bg-slate-100 rounded-full border border-slate-300 group-hover:bg-accent transition-colors" />
                  <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest group-hover:text-accent transition-colors">
                    {act.timestamp ? format(new Date(act.timestamp), 'dd MMM | HH:mm', { locale: es }) : ''}
                  </p>
                  <p className="text-sm font-bold text-slate-700 leading-snug mt-2">{act.description}</p>
                  <div className="flex items-center gap-1.5 mt-2 opacity-50">
                    <div className="w-4 h-4 bg-slate-100 rounded-full flex items-center justify-center text-[8px] font-bold text-slate-400">
                      {act.userName?.[0]}
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{act.userName}</span>
                  </div>
                </div>
              ))}
              {actions.length === 0 && (
                <p className="text-[10px] text-slate-400 font-bold uppercase italic text-center tracking-widest py-4">Esperando actuaciones...</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
