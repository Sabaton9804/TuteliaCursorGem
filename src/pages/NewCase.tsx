import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ArrowRight, 
  ExternalLink, 
  ChevronLeft, 
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Edit2,
  Combine,
  X,
  Check,
  Sparkles,
  Search
} from 'lucide-react';
import { collection, addDoc, serverTimestamp, updateDoc, query, getDocs, limit, orderBy, where } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { signInAnonymously } from 'firebase/auth';
import { handleFirestoreError } from '../lib/error-handler';
import { motion, AnimatePresence } from 'motion/react';
import { Document, Page, pdfjs } from 'react-pdf';
import { PDFDocument } from 'pdf-lib';
import { COURT_CONSTANTS, RIGHTS_LIST } from '../constants';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configurar el worker de PDF.js usando unpkg (más compatible con Vite y ESM)
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

function PdfViewer({ content, contentType, filename }: { content?: string, contentType?: string, filename: string }) {
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
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-6">
        <div className="w-24 h-24 bg-white rounded-3xl shadow-sm flex items-center justify-center">
            <FileText className="w-12 h-12 text-slate-200" />
        </div>
        <div>
            <h3 className="text-lg font-bold text-slate-700">{filename}</h3>
            <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto">
              Vista previa generada para radicación electrónica. Pulse radicar para procesar el expediente completo.
            </p>
        </div>
        <div className="w-full max-w-md h-64 bg-white/50 border border-slate-200 border-dashed rounded-2xl flex items-center justify-center">
            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Documento Protegido (Vista Cifrada)</span>
        </div>
      </div>
    );
  }

  const isImage = contentType?.startsWith('image/');

  if (isImage && pdfBlob) {
    const imageUrl = URL.createObjectURL(pdfBlob);
    return (
      <div className="flex-1 overflow-auto bg-slate-200 p-8 flex items-center justify-center">
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
    <div className="flex-1 flex flex-col h-full bg-slate-100 overflow-hidden">
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

interface LegalAnalysis {
  accionante: string;
  accionanteId: string;
  accionanteEmail: string;
  accionado: string;
  accionadoId: string;
  accionadoEmail: string;
  derechoTutelado: string;
  hechos: string;
  pretensiones: string;
}

const NEW_CASE_DRAFT_KEY = 'tutelia_new_case_draft';
const AI_ANALYSIS_CACHE_KEY = 'tutelia_ai_analysis_cache_v1';

function getUserFriendlyAiError(err: any): string {
  const status = err?.status;
  const rawMessage = String(err?.message || "");
  const normalized = rawMessage.toLowerCase();

  if (status === 429 || normalized.includes("resource_exhausted") || normalized.includes("rate limit") || normalized.includes("quota")) {
    return "La cuota de OpenAI está agotada temporalmente (error 429). Espere unos segundos o revise límites/facturación.";
  }

  if (status === 404 || rawMessage.includes("models/") || rawMessage.includes("NOT_FOUND")) {
    return "El modelo de IA configurado no está disponible para esta API key.";
  }

  if (status === 401 || normalized.includes("incorrect api key") || normalized.includes("api key") || normalized.includes("unauthorized")) {
    return "La API key de OpenAI es inválida o no tiene permisos. Revise OPENAI_API_KEY en .env.local.";
  }

  if (status === 413 || normalized.includes("entity too large")) {
    return "El documento es demasiado grande para procesarlo por API.";
  }

  return err?.message || "Error al analizar el documento con IA.";
}

function getUserFriendlyRadicadoError(err: any): string {
  const rawMessage = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '').toLowerCase();

  if (rawMessage.includes('auth/admin-restricted-operation') || code.includes('auth/admin-restricted-operation')) {
    return 'Firebase tiene deshabilitado el acceso anónimo. Active Authentication > Sign-in method > Anonymous en su proyecto Firebase para poder radicar en modo local.';
  }

  if (rawMessage.includes('permission-denied') || rawMessage.includes('insufficient permissions')) {
    return 'Su usuario no tiene permisos en Firestore para crear expedientes. Verifique reglas y autenticación activa.';
  }

  return err?.message || 'Error desconocido al radicar expediente.';
}

export default function NewCase() {
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedData, setParsedData] = useState<any>(null);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [selectedDocIndex, setSelectedDocIndex] = useState<number>(-1); // -1 for CorreoReparto
  const [selectedForMerge, setSelectedForMerge] = useState<number[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isMerging, setIsMerging] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<LegalAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRadicating, setIsRadicating] = useState(false);
  const [consecutive, setConsecutive] = useState('00600');
  const [radicadoError, setRadicadoError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NEW_CASE_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft.parsedData) setParsedData(draft.parsedData);
      if (Array.isArray(draft.attachments)) setAttachments(draft.attachments);
      if (typeof draft.selectedDocIndex === 'number') setSelectedDocIndex(draft.selectedDocIndex);
      if (Array.isArray(draft.selectedForMerge)) setSelectedForMerge(draft.selectedForMerge);
      if (draft.aiAnalysis) setAiAnalysis(draft.aiAnalysis);
      if (typeof draft.consecutive === 'string') setConsecutive(draft.consecutive);
    } catch (e) {
      console.error('No se pudo restaurar borrador local de radicacion', e);
    }
  }, []);

  useEffect(() => {
    if (!parsedData) return;
    try {
      localStorage.setItem(NEW_CASE_DRAFT_KEY, JSON.stringify({
        parsedData,
        attachments,
        selectedDocIndex,
        selectedForMerge,
        aiAnalysis,
        consecutive,
      }));
    } catch (e) {
      console.error('No se pudo guardar borrador local de radicacion', e);
    }
  }, [parsedData, attachments, selectedDocIndex, selectedForMerge, aiAnalysis, consecutive]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  }, []);

  const parseEmail = async () => {
    if (!file) return;

    setIsParsing(true);
    setError(null);

    const formData = new FormData();
    formData.append('email', file);

    try {
      const response = await fetch('/api/parse-email', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Error al parsear el archivo');

      const data = await response.json();
      setParsedData(data);
      setAttachments(data.attachments || []);
      setSelectedDocIndex(-1); // Default to CorreoReparto
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsParsing(false);
    }
  };

  const getFullRadicado = (cons: string) => {
    const year = new Date().getFullYear().toString();
    return `${COURT_CONSTANTS.CITY_CODE}${COURT_CONSTANTS.ENTITY_CODE}${COURT_CONSTANTS.SPECIALTY_CODE}${COURT_CONSTANTS.DESPACHO_CODE}${year}${cons.padStart(5, '0')}${COURT_CONSTANTS.INSTANCE_CODE}`;
  };

  const handleRadicate = async () => {
    console.log("Iniciando radicación...");
    if (!parsedData) {
      console.error("No hay datos parseados");
      return;
    }
    
    setRadicadoError(null);
    setIsRadicating(true);
    setError(null);

    try {
      if (!auth.currentUser) {
        await signInAnonymously(auth);
      }
      if (!auth.currentUser) {
        throw new Error('No hay sesión activa de Firebase. Vuelva a iniciar sesión local para radicar.');
      }

      const year = new Date().getFullYear().toString();
      const finalConsecutive = consecutive.padStart(5, '0');
      const radicadoFormatted = getFullRadicado(finalConsecutive);
      console.log("Radicado generado:", radicadoFormatted);

      // 1. Verificar unicidad
      const casesCollectionId = 'court-1'; // Fixed for this instance
      const casesPath = `courts/${casesCollectionId}/cases`;
      
      console.log("Verificando existencia en:", casesPath);
      const q = query(
        collection(db, casesPath),
        where('radicado', '==', radicadoFormatted)
      );
      
      let hostSnap;
      try {
        hostSnap = await getDocs(q);
      } catch (e) {
        handleFirestoreError(e, 'list', casesPath);
        throw e;
      }
      
      if (!hostSnap.empty) {
        console.warn("Radicado ya existe");
        setRadicadoError(`El radicado ${radicadoFormatted} ya existe en el sistema.`);
        setIsRadicating(false);
        return;
      }

      // Prepare the case data
      const caseData = {
        radicado: radicadoFormatted,
        courtId: casesCollectionId,
        claimant: aiAnalysis?.accionante || parsedData.from || 'Anónimo',
        defendant: aiAnalysis?.accionado || 'DESPACHO JUDICIAL',
        status: 'received',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        sourceChannel: 'email',
        subject: parsedData.subject || 'Sin Asunto',
        rawText: parsedData.text || '',
        summary: '',
        
        // AI Extracted data - IMPORTANT
        claimantId: aiAnalysis?.accionanteId || '',
        claimantEmail: aiAnalysis?.accionanteEmail || '',
        defendantId: aiAnalysis?.accionadoId || '',
        defendantEmail: aiAnalysis?.accionadoEmail || '',
        legalHechos: aiAnalysis?.hechos || '',
        legalPretensiones: aiAnalysis?.pretensiones || '',
        legalDerechoTutelado: aiAnalysis?.derechoTutelado || '',
        legalIdentificaciones: aiAnalysis ? `${aiAnalysis.accionanteId} / ${aiAnalysis.accionadoId}` : '',
      };

      console.log("Guardando caso en Firestore...");
      let caseRef;
      try {
        caseRef = await addDoc(collection(db, casesPath), caseData);
      } catch (e) {
        handleFirestoreError(e, 'create', casesPath);
        throw e;
      }
      console.log("Caso creado con ID:", caseRef.id);

      // Save processed attachments as a subcollection
      const docsPath = `${casesPath}/${caseRef.id}/documents`;
      const docsCollection = collection(db, docsPath);
      
      // Virtual Email Body
      console.log("Guardando cuerpo del correo...");
      await addDoc(docsCollection, {
        name: 'CorreoReparto',
        type: 'email_body',
        createdAt: serverTimestamp(),
        size: (parsedData.text?.length || 0) * 1.5,
        order: -1
      });

      // Actual attachments
      if (attachments.length > 0) {
        console.log(`Procesando ${attachments.length} anexos...`);
        for (let i = 0; i < attachments.length; i++) {
          const att = attachments[i];
          
          // Check size limit (1MB = 1048576 bytes)
          // Base64 is ~33% larger than binary, so 1MB base64 is ~750KB binary
          if (att.content && att.content.length > 1000000) {
            console.warn(`Anexo ${att.filename} excede el límite de 1MB de Firestore. Se guardará sin contenido para el demo.`);
            await addDoc(docsCollection, {
              name: att.filename,
              originalName: att.originalName || att.filename,
              type: 'attachment',
              createdAt: serverTimestamp(),
              size: att.size,
              contentType: att.contentType,
              content: null, // Skip content if too large
              isFromLink: !!att.isFromLink,
              order: i,
              error: 'Archivo demasiado grande para Firestore (>1MB). En producción use Cloud Storage.'
            });
          } else {
            await addDoc(docsCollection, {
              name: att.filename,
              originalName: att.originalName || att.filename,
              type: 'attachment',
              createdAt: serverTimestamp(),
              size: att.size,
              contentType: att.contentType,
              content: att.content,
              isFromLink: !!att.isFromLink,
              order: i
            });
          }
        }
      }

      // Store metadata
      console.log("Actualizando metadatos...");
      await updateDoc(caseRef, {
        rawHtml: parsedData.html || '',
        emailMetadata: {
          from: parsedData.from || '',
          to: parsedData.to || '',
          subject: parsedData.subject || '',
          date: parsedData.date || new Date().toISOString(),
          linkFound: !!parsedData.linkFound,
          linkUrl: parsedData.linkUrl || null
        }
      });

      console.log("Radicación completada con éxito. Redirigiendo...");
      localStorage.removeItem(NEW_CASE_DRAFT_KEY);
      navigate(`/case/${caseRef.id}`);
    } catch (err: any) {
      console.error("Error al radicar:", err);
      let errorMsg = getUserFriendlyRadicadoError(err);
      try {
        const parsed = JSON.parse(err.message);
        if (parsed.error) errorMsg = parsed.error;
      } catch (e) {
        // keep friendly mapped message
      }
      setError(`Error de radicación: ${errorMsg}`);
    } finally {
      setIsRadicating(false);
    }
  };

  const handleRename = (idx: number) => {
    const newAttachments = [...attachments];
    newAttachments[idx].filename = editingName;
    setAttachments(newAttachments);
    setEditingIndex(null);
  };

  const handleMove = (idx: number, direction: 'up' | 'down') => {
    const newAttachments = [...attachments];
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= newAttachments.length) return;
    
    [newAttachments[idx], newAttachments[targetIdx]] = [newAttachments[targetIdx], newAttachments[idx]];
    setAttachments(newAttachments);
    if (selectedDocIndex === idx) setSelectedDocIndex(targetIdx);
    else if (selectedDocIndex === targetIdx) setSelectedDocIndex(idx);
  };

  const toggleSelectForMerge = (idx: number) => {
    setSelectedForMerge(prev => 
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const mergeSelected = async () => {
    if (selectedForMerge.length <= 1) {
      setError('Seleccione al menos 2 documentos para unir.');
      return;
    }

    const itemsToMerge = selectedForMerge
      .map(idx => attachments[idx])
      .filter(att => att.contentType === 'application/pdf');

    if (itemsToMerge.length !== selectedForMerge.length) {
      setError('Solo se pueden unir archivos PDF.');
      return;
    }

    setIsMerging(true);
    try {
      const mergedPdf = await PDFDocument.create();
      
      for (const att of itemsToMerge) {
        const pdfBytes = Uint8Array.from(atob(att.content), c => c.charCodeAt(0));
        const donorPdf = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(donorPdf, donorPdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedPdfBase64 = await mergedPdf.saveAsBase64();
      
      // Determine new list: remove selected, insert merged at first selected position
      const firstSelectedIdx = Math.min(...selectedForMerge);
      const newAttachments = attachments.filter((_, idx) => !selectedForMerge.includes(idx));
      
      const mergedDoc = {
        filename: 'DocumentosUnificados',
        originalName: 'merged_documents.pdf',
        size: Math.round(mergedPdfBase64.length * 0.75),
        contentType: 'application/pdf',
        content: mergedPdfBase64,
        isFromLink: itemsToMerge.some(a => a.isFromLink)
      };

      newAttachments.splice(firstSelectedIdx, 0, mergedDoc);
      setAttachments(newAttachments);
      setSelectedDocIndex(firstSelectedIdx);
      setSelectedForMerge([]);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Error al unir los documentos. Asegúrese de que sean PDF válidos.');
    } finally {
      setIsMerging(false);
    }
  };

  const handleAIAnalysis = async () => {
    const currentDoc = selectedDocIndex === -1 ? null : attachments[selectedDocIndex];
    if (!currentDoc || currentDoc.contentType !== 'application/pdf') {
      setError('Por favor, seleccione un documento PDF (ej. el escrito) para analizar con IA.');
      return;
    }
    
    setIsAnalyzing(true);
    setError(null);
    try {
      const cacheKey = `${currentDoc.filename || 'doc'}::${currentDoc.size || 0}::${(currentDoc.content || '').slice(0, 64)}`;
      const rawCache = localStorage.getItem(AI_ANALYSIS_CACHE_KEY);
      if (rawCache) {
        const parsedCache = JSON.parse(rawCache) as Record<string, LegalAnalysis>;
        if (parsedCache[cacheKey]) {
          setAiAnalysis(parsedCache[cacheKey]);
          setIsAnalyzing(false);
          return;
        }
      }

      const rightsListText = RIGHTS_LIST.map(r => `Art. ${r.art} — ${r.title}`).join('\n');

      const prompt = `
        Analiza este documento de tutela y extrae la siguiente información de manera muy precisa y breve:
        - Accionante: Nombre completo del demandante.
        - Identificación Accionante: Especifica si es C.C. o NIT seguido del número (ej: C.C. 1.234.567 o NIT 900.123.456-1).
        - Email Accionante: Correo electrónico del demandante si aparece.
        - Accionado: Nombre de la entidad o persona demandada.
        - Identificación Accionado: Especifica si es NIT o C.C. (si está disponible).
        - Email Accionado: Correo electrónico del demandado si aparece.
        - Derecho fundamental tutelado: DEBE ser estrictamente uno de los siguientes de la Constitución Colombiana:
        ${rightsListText}
        
        IMPORTANTE: Si el derecho mencionado no está exactamente en esa lista, identifícalo bajo el artículo más relacionado de esa lista específica (Arts 11 al 41).
        
        - Hechos: Resumen extremadamente breve de lo ocurrido, máximo 2 frases.
        - Pretensiones: Resumen extremadamente breve de lo que se pide, máximo 2 frases.

        Responde estrictamente en formato JSON según el esquema proporcionado.
      `;

      const response = await fetch('/api/ai/legal-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          pdfBase64: currentDoc.content,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw Object.assign(new Error(payload.error || 'Error al analizar el documento con IA.'), {
          status: response.status,
        });
      }

      const payload = await response.json();
      const result = JSON.parse(payload.text || "{}");
      setAiAnalysis(result);
      const raw = localStorage.getItem(AI_ANALYSIS_CACHE_KEY);
      const cache = raw ? JSON.parse(raw) : {};
      cache[cacheKey] = result;
      localStorage.setItem(AI_ANALYSIS_CACHE_KEY, JSON.stringify(cache));
    } catch (err: any) {
      console.error("AI Analysis Error:", err);
      setError(getUserFriendlyAiError(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Radicación de Expediente</h1>
          <p className="text-sm font-medium text-slate-500 mt-1">Ingesta automática y normalización de documentos judicial electrónicos</p>
        </div>
        <div className="px-4 py-2 bg-blue-50 text-accent rounded-lg border border-blue-100 text-xs font-bold uppercase tracking-widest">
           Canal Digital
        </div>
      </header>

      {!parsedData ? (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card-modern p-12"
        >
          <div 
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="border-2 border-dashed border-slate-200 rounded-2xl p-16 flex flex-col items-center justify-center text-center space-y-6 hover:border-accent hover:bg-blue-50/30 transition-all cursor-pointer group"
          >
            <div className="w-20 h-20 bg-slate-50 group-hover:bg-blue-100 rounded-3xl flex items-center justify-center transition-colors">
              <Upload className="w-10 h-10 text-slate-400 group-hover:text-accent" />
            </div>
            <div>
              <p className="text-lg font-bold text-slate-700">Arrastre el correo electrónico aquí</p>
              <p className="text-sm text-slate-400 mt-2 font-medium">Soportamos archivos .eml y .msg extraídos de Outlook</p>
            </div>
            
            <input 
              type="file" 
              id="file-upload" 
              className="hidden" 
              accept=".eml,.msg"
              onChange={handleFileChange}
            />
            <label 
              htmlFor="file-upload"
              className="px-8 py-3 bg-white border border-slate-200 rounded-xl font-bold text-sm text-slate-600 hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-all shadow-sm"
            >
              BUSCAR EN ESTE EQUIPO
            </label>
            
            {file && (
              <div className="flex items-center gap-3 mt-4 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100 animate-in fade-in zoom-in duration-300 text-xs font-bold">
                <FileText className="w-4 h-4" />
                {file.name}
              </div>
            )}
          </div>

          {file && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="pt-10"
            >
              <button 
                onClick={parseEmail}
                disabled={isParsing}
                className="btn-primary w-full flex items-center justify-center gap-3 text-lg py-5 shadow-lg shadow-accent/20"
              >
                {isParsing ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    ANALIZANDO CONTENIDO Y ANEXOS...
                  </>
                ) : (
                  <>
                    PROCESAR E INGESTAR EXPEDIENTE
                    <ArrowRight className="w-6 h-6" />
                  </>
                )}
              </button>
            </motion.div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 flex items-center gap-3 text-sm font-semibold">
              <AlertCircle className="w-5 h-5 shrink-0" />
              {error}
            </div>
          )}
        </motion.div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 lg:grid-cols-12 gap-8"
        >
          {/* Top Bar & Radicado Section (Full Width) */}
          <div className="lg:col-span-12 space-y-6">
            <div className="flex items-center gap-2">
              <button onClick={() => setParsedData(null)} className="text-xs font-bold text-slate-400 hover:text-accent flex items-center gap-1">
                <ChevronLeft className="w-3 h-3" /> VOLVER A CARGAR
              </button>
            </div>

            <div className="card-modern p-6 bg-white border-2 border-slate-100 shadow-xl overflow-hidden relative group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/50 rounded-full -mr-16 -mt-16 blur-3xl transition-all group-hover:bg-accent/10" />
              
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-5 flex items-center gap-2">
                <Edit2 className="w-3 h-3 text-accent" />
                Asignación de Radicado Único
              </h4>

              <div className="flex items-center justify-center gap-2 bg-slate-50/80 p-6 rounded-2xl border border-slate-100 relative z-10 overflow-x-auto whitespace-nowrap">
                <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-base font-bold text-slate-600">{COURT_CONSTANTS.CITY_CODE}</span>
                </div>
                <span className="flex-shrink-0 w-1 h-1 bg-slate-400 rounded-full mx-1" />
                <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-base font-bold text-slate-600">{COURT_CONSTANTS.ENTITY_CODE}</span>
                </div>
                <span className="flex-shrink-0 w-1 h-1 bg-slate-400 rounded-full mx-1" />
                <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-base font-bold text-slate-600">{COURT_CONSTANTS.SPECIALTY_CODE}</span>
                </div>
                <span className="flex-shrink-0 w-1 h-1 bg-slate-400 rounded-full mx-1" />
                <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-base font-bold text-slate-600">{COURT_CONSTANTS.DESPACHO_CODE}</span>
                </div>
                <span className="flex-shrink-0 w-1 h-1 bg-slate-400 rounded-full mx-1" />
                <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-base font-bold text-slate-600">{new Date().getFullYear()}</span>
                </div>
                <span className="flex-shrink-0 w-1 h-1 bg-slate-400 rounded-full mx-1" />
                <div className="relative group/input flex-shrink-0">
                  <input 
                    type="text"
                    value={consecutive}
                    onChange={(e) => setConsecutive(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    className="bg-accent/5 border-2 border-accent rounded-2xl px-6 py-2.5 w-40 text-accent text-2xl font-black focus:outline-none focus:ring-8 ring-accent/10 text-center transition-all shadow-lg shadow-accent/10"
                    placeholder="00600"
                  />
                </div>
                <span className="flex-shrink-0 w-1 h-1 bg-slate-400 rounded-full mx-1" />
                <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-base font-bold text-slate-600">{COURT_CONSTANTS.INSTANCE_CODE}</span>
                </div>
              </div>

              <div className="mt-8 flex items-center justify-between px-2">
                <div className="flex flex-col">
                  <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.25em] leading-loose">
                    Estructura Normalizada (Acuerdo 201/1997 CSJ)
                  </p>
                  <p className="text-xs font-bold text-slate-400 mt-1 flex items-center gap-2">
                    {COURT_CONSTANTS.CITY_CODE} <span className="text-slate-200">•</span> {COURT_CONSTANTS.ENTITY_CODE} <span className="text-slate-200">•</span> {COURT_CONSTANTS.SPECIALTY_CODE} <span className="text-slate-200">•</span> {COURT_CONSTANTS.DESPACHO_CODE} <span className="text-slate-200">•</span> {new Date().getFullYear()} <span className="text-slate-200">•</span> <span className="text-accent font-black bg-accent/5 px-2 py-0.5 rounded-md border border-accent/10">{consecutive.padStart(5, '0')}</span> <span className="text-slate-200">•</span> {COURT_CONSTANTS.INSTANCE_CODE}
                  </p>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100 text-[10px] font-black uppercase tracking-widest shadow-sm">
                   <Check className="w-4 h-4 text-emerald-500" /> Formato Válido
                </div>
              </div>

              {radicadoError && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-4 text-red-600 text-[10px] font-bold uppercase tracking-widest shadow-inner"
                >
                  <AlertCircle className="w-5 h-5 shrink-0" /> 
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-black">Conflicto de radicación detectado</span>
                    <span className="opacity-70 font-bold normal-case tracking-normal text-sm">{radicadoError}</span>
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          {/* AI Analysis (Full Width) */}
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
                        <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 leading-none">Análisis por Inteligencia Artificial</h3>
                        <p className="text-[10px] font-bold text-accent uppercase tracking-widest mt-1.5 opacity-70">Extracción automática de datos judiciales bajo C.P.C.</p>
                      </div>
                    </div>
                    <button onClick={() => setAiAnalysis(null)} className="text-slate-300 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-xl transition-all">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div className="space-y-6">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Accionante (Demandante)</label>
                        <div className="space-y-1">
                          <p className="text-sm font-black text-slate-800 leading-tight">{aiAnalysis.accionante}</p>
                          <p className="text-[10px] font-mono font-bold text-accent bg-accent/5 px-2 py-0.5 rounded-md inline-block uppercase">{aiAnalysis.accionanteId || 'C.C. NO DETECTADA'}</p>
                          <p className="text-[10px] text-slate-500 font-medium truncate">{aiAnalysis.accionanteEmail || 'Email no detectado'}</p>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Accionado (Contraparte)</label>
                        <div className="space-y-1">
                          <p className="text-sm font-black text-slate-800 leading-tight">{aiAnalysis.accionado}</p>
                          <p className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md inline-block uppercase">{aiAnalysis.accionadoId || 'NIT NO DETECTADO'}</p>
                          <p className="text-[10px] text-slate-500 font-medium truncate">{aiAnalysis.accionadoEmail || 'Email no detectado'}</p>
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
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Resumen de Pretensión</label>
                        <p className="text-[11px] text-slate-600 font-medium leading-relaxed mt-2 italic">
                          "{aiAnalysis.pretensiones}"
                        </p>
                      </div>
                    </div>

                    <div className="md:col-span-2 space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Resumen de Hechos Relevantes</label>
                      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-full flex flex-col justify-center">
                        <p className="text-[11px] text-slate-600 font-medium leading-loose italic">
                          "{aiAnalysis.hechos}"
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Grid: Actions & Viewer */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            {!aiAnalysis && (
              <div className="p-4 bg-amber-50 text-amber-700 rounded-2xl border border-amber-100 text-[10px] font-bold uppercase tracking-widest flex items-center gap-3 animate-pulse">
                <AlertCircle className="w-4 h-4" /> Se recomienda extraer datos con IA antes de radicar
              </div>
            )}

            {aiAnalysis && (
              <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl border border-emerald-100 text-[10px] font-bold uppercase tracking-widest flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4" /> Datos extraídos con IA listos para vinculación
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 flex items-center gap-3 text-xs font-semibold">
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error}
              </div>
            )}

            <button 
              onClick={handleRadicate}
              disabled={isRadicating}
              className={`w-full py-6 rounded-2xl text-sm font-black uppercase tracking-[0.15em] flex items-center justify-center gap-4 transition-all duration-300 relative overflow-hidden group ${
                isRadicating 
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200' 
                  : 'bg-accent text-white shadow-2xl shadow-accent/20 hover:shadow-accent/40 active:scale-[0.98] border border-accent/20'
              }`}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
              
              {isRadicating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Radicando Proceso...</span>
                </>
              ) : (
                <>
                  {aiAnalysis && <Sparkles className="w-5 h-5 text-blue-200" />}
                  <span>Radicar y Vincular Expediente</span>
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>

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
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Interviniente (Accionante)</label>
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-slate-600 text-sm font-medium truncate">
                    {parsedData.from}
                  </div>
                </div>

                {parsedData.linkFound && (
                  <div className="space-y-1.5 pt-2">
                    <label className="text-[10px] font-bold text-blue-500 uppercase tracking-widest px-1 flex items-center gap-2">
                      <ExternalLink className="w-3 h-3" /> Link "Archivo" Detectado
                    </label>
                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-blue-700 text-[11px] font-medium break-all flex flex-col gap-2">
                      <span className="opacity-70">Se detectó y procesó automáticamente el link de descarga mencionado en el cuerpo del correo.</span>
                      <div className="bg-white/80 p-2 rounded-lg border border-blue-200/50 truncate">
                        {parsedData.linkUrl}
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-4 flex items-center justify-between">
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Documentos Identificados</label>
                   <button 
                     onClick={mergeSelected}
                     disabled={isMerging || selectedForMerge.length <= 1}
                     className={`text-[9px] font-black tracking-tighter uppercase px-2 py-1 rounded-lg border flex items-center gap-1.5 transition-all ${
                       selectedForMerge.length > 1 
                         ? 'bg-accent text-white border-accent hover:bg-accent-dark' 
                         : 'bg-slate-100 text-slate-400 border-slate-200 opacity-60'
                     }`}
                   >
                     {isMerging ? <Loader2 className="w-3 h-3 animate-spin"/> : <Combine className="w-3 h-3" />}
                     Unir Seleccionados ({selectedForMerge.length})
                   </button>
                </div>

                <div className="space-y-1.5">
                  <div className="grid grid-cols-1 gap-2.5">
                    {/* Correo Principal */}
                    <div 
                      onClick={() => setSelectedDocIndex(-1)}
                      className={`flex items-center justify-between p-3.5 border rounded-xl text-[11px] font-bold cursor-pointer transition-all duration-200 group ${
                        selectedDocIndex === -1 
                          ? 'border-accent bg-blue-50/50 text-accent ring-2 ring-accent/5 translate-x-1' 
                          : 'border-slate-100 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                        <span className="flex items-center gap-2.5">
                           <div className={`p-1.5 rounded-lg ${selectedDocIndex === -1 ? 'bg-accent text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'}`}>
                              <FileText className="w-3.5 h-3.5" />
                           </div>
                           CorreoReparto
                        </span>
                        <div className="flex items-center gap-2">
                           <span className={`text-[8px] px-2 py-0.5 rounded-full font-black tracking-tighter uppercase ${
                             selectedDocIndex === -1 ? 'bg-accent text-white' : 'bg-slate-100 text-slate-400'
                           }`}>Principal</span>
                        </div>
                    </div>

                    {/* Otros Adjuntos */}
                    {attachments.map((att: any, idx: number) => (
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
                              onClick={() => setSelectedDocIndex(idx)}
                              className="flex-1 cursor-pointer flex items-center gap-2.5 min-w-0"
                           >
                              <div className={`p-1.5 rounded-lg shrink-0 ${selectedDocIndex === idx ? 'bg-accent text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'}`}>
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
                                      onClick={() => handleRename(idx)} 
                                      className="text-white bg-emerald-500 p-1 hover:bg-emerald-600 rounded transition-colors shadow-sm"
                                      title="Confirmar (Enter)"
                                    >
                                      <Check className="w-3.5 h-3.5"/>
                                    </button>
                                    <button 
                                      onClick={() => setEditingIndex(null)} 
                                      className="text-slate-400 bg-slate-100 p-1 hover:bg-slate-200 rounded transition-colors"
                                      title="Cancelar (Esc)"
                                    >
                                      <X className="w-3.5 h-3.5"/>
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
                                 onClick={(e) => { e.stopPropagation(); setEditingIndex(idx); setEditingName(att.filename); }}
                                 className="p-1 text-slate-400 hover:text-accent hover:bg-white rounded transition-colors"
                                 title="Renombrar"
                               >
                                 <Edit2 className="w-3 h-3" />
                               </button>
                               <div className="flex flex-col">
                                 <button 
                                   onClick={(e) => { e.stopPropagation(); handleMove(idx, 'up'); }}
                                   disabled={idx === 0}
                                   className="p-0.5 text-slate-400 hover:text-accent disabled:opacity-20"
                                   title="Subir"
                                 >
                                   <ArrowUp className="w-2.5 h-2.5" />
                                 </button>
                                 <button 
                                   onClick={(e) => { e.stopPropagation(); handleMove(idx, 'down'); }}
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
                           <span className="text-[10px] tabular-nums font-medium text-slate-300">{(att.size / 1024).toFixed(1)} KB</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Viewer Section */}
          <div className="lg:col-span-7 card-modern overflow-hidden bg-white flex flex-col h-[750px]">
             <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-widest">
                    {selectedDocIndex === -1 ? 'Vista Previa del Correo Judicial' : `Visor: ${attachments[selectedDocIndex]?.filename}`}
                  </h2>
                  {selectedDocIndex !== -1 && attachments[selectedDocIndex]?.contentType === 'application/pdf' && (
                    <button 
                      onClick={handleAIAnalysis}
                      disabled={isAnalyzing}
                      className="px-3 py-1 bg-accent text-white rounded-lg text-[9px] font-black uppercase tracking-tighter flex items-center gap-1.5 hover:bg-accent-dark transition-all shadow-sm shadow-accent/20 disabled:opacity-50"
                    >
                      {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin"/> : <Search className="w-3 h-3" />}
                      {isAnalyzing ? 'Analizando...' : 'Extraer Datos con IA'}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-bold">
                   <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                   REPRODUCCIÓN DIGITAL
                </div>
             </div>
             
             <div className="flex-1 overflow-hidden bg-white flex flex-col">
               {selectedDocIndex === -1 ? (
                 <>
                   <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-1 text-[10px]">
                     <div className="flex gap-2">
                         <span className="font-bold text-slate-400 w-12 uppercase">De:</span>
                         <span className="text-slate-600 truncate">{parsedData.from}</span>
                     </div>
                     <div className="flex gap-2">
                         <span className="font-bold text-slate-400 w-12 uppercase">Fecha:</span>
                         <span className="text-slate-600">{parsedData.date ? new Date(parsedData.date).toLocaleString('es-CO') : 'Reciente'}</span>
                     </div>
                   </div>
                   <div className="flex-1 bg-white">
                     {parsedData.html ? (
                       <iframe 
                         srcDoc={`
                           <html>
                             <head>
                               <style>
                                 body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #334155; padding: 20px; margin: 0; }
                                 img { max-width: 100%; height: auto; }
                               </style>
                             </head>
                             <body>${parsedData.html}</body>
                           </html>
                         `}
                         className="w-full h-full border-none"
                         title="Email Body"
                       />
                     ) : (
                       <div className="p-10 font-sans text-sm text-slate-600 whitespace-pre-wrap">
                         {parsedData.text}
                       </div>
                     )}
                   </div>
                 </>
               ) : (
                 <div className="flex-1 flex flex-col h-full bg-slate-100 min-h-0 overflow-hidden">
                   <PdfViewer 
                     content={attachments[selectedDocIndex]?.content} 
                     contentType={attachments[selectedDocIndex]?.contentType}
                     filename={attachments[selectedDocIndex]?.filename}
                   />
                 </div>
               )}
             </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
