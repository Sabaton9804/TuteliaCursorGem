import dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import fs from 'fs';
import multer from 'multer';
import { simpleParser } from 'mailparser';
import JSZip from 'jszip';
import axios from 'axios';
import OpenAI from 'openai';
import {
  ACTA_REPARTO_DISPLAY_NAME,
  detectActaRepartoInPdfBuffer,
  filenameSuggestsActaReparto,
} from './pdf-acta-detect';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** Directorio donde está `server.ts` (raíz del código) */
const projectRoot = path.resolve(__dirname);

function stripUtf8Bom(content: string) {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function envValueIsUnset(v: string | undefined) {
  return v === undefined || String(v).trim() === '';
}

/**
 * Lee `.env` y `.env.local` en varios directorios (código + cwd) y fusiona:
 * - orden: `projectRoot` (.env → .env.local), luego `process.cwd()` igual;
 * - un valor no vacío en un archivo posterior sustituye al anterior;
 * - una línea vacía no borra un valor ya fusionado.
 * Así funciona aunque `npm run dev` se ejecute desde otra carpeta o haya BOM en `.env`.
 */
function loadProjectEnv() {
  const dirs = [projectRoot];
  const cwd = path.resolve(process.cwd());
  if (cwd !== projectRoot) dirs.push(cwd);

  const merged: Record<string, string> = {};
  const loadedFrom: string[] = [];

  for (const dir of dirs) {
    for (const name of ['.env', '.env.local'] as const) {
      const full = path.join(dir, name);
      if (!fs.existsSync(full)) continue;
      loadedFrom.push(full);
      const raw = stripUtf8Bom(fs.readFileSync(full, 'utf8'));
      const parsed = dotenv.parse(raw);
      for (const [key, rawVal] of Object.entries(parsed)) {
        const t = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal).trim();
        if (t !== '') merged[key] = t;
        else if (!(key in merged)) merged[key] = '';
      }
    }
  }

  for (const [key, val] of Object.entries(merged)) {
    if (val !== '' && envValueIsUnset(process.env[key])) {
      process.env[key] = val;
    }
  }

  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  console.log(
    `[tutelia] OPENAI_API_KEY: ${hasOpenAi ? 'OK' : 'NO encontrada'}. ` +
      `Raíz server: ${projectRoot}. cwd: ${cwd}. ` +
      `Archivos leídos: ${loadedFrom.length ? loadedFrom.join(' | ') : '(ninguno)'}`
  );
}

loadProjectEnv();

const PORT = 3000;
const BODY_LIMIT = '100mb';

/** Adjuntos del último parse-email: binarios en servidor; el cliente pide cada uno por GET. */
type ParseSessionRow = {
  sessionIndex: number;
  filename: string;
  originalName?: string;
  contentType: string;
  size: number;
  isFromLink?: boolean;
  order?: number;
  buffer: Buffer;
};

type ParseSession = {
  createdAt: number;
  attachments: ParseSessionRow[];
};

const parseSessions = new Map<string, ParseSession>();
const PARSE_SESSION_TTL_MS = 60 * 60 * 1000;

function sweepParseSessions() {
  const now = Date.now();
  for (const [id, s] of parseSessions) {
    if (now - s.createdAt > PARSE_SESSION_TTL_MS) parseSessions.delete(id);
  }
}

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Falta OPENAI_API_KEY. Cree .env o .env.local en la raíz del proyecto (junto a server.ts) o en la carpeta desde la que ejecuta npm run dev. Reinicie el servidor tras guardar. Revise la consola del terminal al arrancar: línea [tutelia] OPENAI_API_KEY.'
    );
  }
  return new OpenAI({ apiKey });
}

function mapAiError(error: any) {
  const status = error?.status || 500;
  const rawMessage = String(error?.message || '');
  if (status === 429 || rawMessage.includes('rate limit') || rawMessage.includes('quota')) {
    return {
      status: 429,
      message: 'Cuota o límite de OpenAI agotado temporalmente. Intente de nuevo en unos segundos.'
    };
  }
  if (status === 401 || rawMessage.toLowerCase().includes('api key')) {
    return { status: 401, message: 'API key de OpenAI inválida o no autorizada.' };
  }
  return { status, message: rawMessage || 'Error inesperado al consultar OpenAI.' };
}

async function startServer() {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage() });

  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/parse-session/:sessionId/attachment/:index', (req, res) => {
    sweepParseSessions();
    const sessionId = String(req.params.sessionId || '');
    const i = parseInt(String(req.params.index), 10);
    if (!sessionId || Number.isNaN(i) || i < 0) {
      return res.status(400).json({ error: 'Parámetros inválidos' });
    }
    const session = parseSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({
        error: 'Sesión de parseo expirada o inexistente. Vuelva a cargar el archivo .eml.',
      });
    }
    const row =
      session.attachments.find((a) => a.sessionIndex === i) ?? session.attachments[i];
    if (!row?.buffer?.length) {
      return res.status(404).json({ error: 'Adjunto no encontrado' });
    }
    res.setHeader('Content-Type', row.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', String(row.buffer.length));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(row.buffer);
  });

  // Handle EML/MSG upload and parsing
  app.post('/api/parse-email', upload.single('email'), async (req, res) => {
    console.log('Received request for /api/parse-email');
    const multerReq = req as any;
    console.log('File details:', multerReq.file ? {
      originalname: multerReq.file.originalname,
      mimetype: multerReq.file.mimetype,
      size: multerReq.file.size
    } : 'No file');

    try {
      if (!multerReq.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const parsed = await simpleParser(multerReq.file.buffer);
      
      let processedAttachments: any[] = [];
      let globalOrderIndex = 0;
      const nameCounters: Record<string, number> = {};

      const getUniqueName = (baseName: string) => {
        let finalName = baseName;
        if (nameCounters[baseName]) {
          nameCounters[baseName]++;
          finalName = `${baseName} (${nameCounters[baseName]})`;
        } else {
          nameCounters[baseName] = 1;
        }
        return finalName;
      };

      const getPriority = (name: string) => {
        const lower = name.toLowerCase();
        if (lower.includes('actareparto')) return 1;
        if (lower.includes('escritodemanda')) return 2;
        if (lower.includes('poder')) return 3;
        if (lower.includes('documentospruebasanexos')) return 4;
        return 5;
      };

      // 1. Detect and process the "Archivo" download link from the body
      const htmlBody = parsed.html || '';
      const textBody = parsed.text || '';
      
      // Look for a link containing the text "Archivo" in HTML
      let linkMatch = htmlBody.match(/<a\s+[^>]*?href=(["'])(.*?)\1[^>]*?>\s*(?:Descargar\s+)?Archivo\s*<\/a>/i);
      
      let downloadUrl = linkMatch ? linkMatch[2] : null;

      // Fallback: Look for "Archivo: http..." in text body
      if (!downloadUrl) {
        const textMatch = textBody.match(/Archivo:\s*(https?:\/\/[^\s]+)/i);
        if (textMatch) {
          downloadUrl = textMatch[1];
        }
      }
      
      let linkFound = false;
      if (downloadUrl) {
        linkFound = true;
        try {
          console.log(`Attempting to download from: ${downloadUrl}`);
          const response = await axios.get(downloadUrl, {
            responseType: 'arraybuffer',
            timeout: 60000,
            maxRedirects: 15,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              Accept: 'application/pdf,application/zip,*/*;q=0.8',
            },
            validateStatus: (status) => status < 500,
          });

          if (response.status >= 400) {
            console.error(`Download failed with status ${response.status}`);
          } else {
            const buffer = Buffer.from(response.data);
            let contentType = String(response.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();

            const isPdfMagic =
              buffer.length >= 5 &&
              buffer[0] === 0x25 &&
              buffer[1] === 0x50 &&
              buffer[2] === 0x44 &&
              buffer[3] === 0x46 &&
              buffer[4] === 0x2d;

            // Check if it's a ZIP by content type, URL or signature
            const isZip = contentType === 'application/zip' || 
                          downloadUrl.toLowerCase().split('?')[0].endsWith('.zip') ||
                          (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B);

            if (isZip) {
              const zip = new JSZip();
              const zipContent = await zip.loadAsync(buffer);
              
              // Collect files in order
              const filePromises: any[] = [];
              zip.forEach((relativePath, file) => {
                if (file.dir) return;
                filePromises.push((async () => {
                  const filename = relativePath;
                  const lowerName = filename.toLowerCase();
                  let innerContentType = 'application/octet-stream';
                  if (lowerName.endsWith('.pdf')) innerContentType = 'application/pdf';
                  else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) innerContentType = 'image/jpeg';
                  else if (lowerName.endsWith('.png')) innerContentType = 'image/png';

                  let baseName = filename;
                  if (lowerName.includes('demanda')) baseName = 'EscritoDemanda';
                  else if (lowerName.includes('prueba') || lowerName.includes('anexo')) baseName = 'DocumentosPruebasAnexos';
                  else if (lowerName.includes('poder')) baseName = 'Poder';
                  else if (filenameSuggestsActaReparto(lowerName)) baseName = 'ActaReparto';

                  let originalNameOut = filename;
                  let contentB64: string;
                  if (innerContentType === 'application/pdf') {
                    const pdfBuf = Buffer.from(await file.async('nodebuffer'));
                    if (baseName === filename && (await detectActaRepartoInPdfBuffer(pdfBuf))) {
                      baseName = 'ActaReparto';
                      originalNameOut = ACTA_REPARTO_DISPLAY_NAME;
                    }
                    contentB64 = pdfBuf.toString('base64');
                  } else {
                    contentB64 = await file.async('base64');
                  }

                  return {
                    filename: baseName,
                    originalName: baseName === 'ActaReparto' ? ACTA_REPARTO_DISPLAY_NAME : originalNameOut,
                    size: (file as any)._data?.uncompressedSize || 0,
                    contentType: innerContentType,
                    content: contentB64,
                    isFromLink: true,
                    tempOrder: globalOrderIndex++
                  };
                })());
              });
              
              const unzipFiles = await Promise.all(filePromises);
              processedAttachments = [...processedAttachments, ...unzipFiles];
            } else {
              // Single file downloaded
              let baseName = 'DocumentosPruebasAnexos';
              const lowerUrl = downloadUrl.toLowerCase();
              if (filenameSuggestsActaReparto(lowerUrl)) {
                baseName = 'ActaReparto';
              } else if (lowerUrl.includes('demanda')) {
                baseName = 'EscritoDemanda';
              }

              if (!isZip && !isPdfMagic) {
                const probe = buffer
                  .subarray(0, Math.min(800, buffer.length))
                  .toString('utf8')
                  .trimStart()
                  .toLowerCase();
                if (
                  probe.startsWith('<!doctype') ||
                  probe.startsWith('<html') ||
                  probe.startsWith('<?xml')
                ) {
                  contentType = 'text/html';
                } else if (contentType === 'application/pdf' || contentType === 'application/octet-stream') {
                  contentType = 'application/octet-stream';
                }
              } else if (isPdfMagic) {
                contentType = 'application/pdf';
              }

              let originalLinkName =
                baseName === 'ActaReparto' ? ACTA_REPARTO_DISPLAY_NAME : 'archivo_descargado';
              if (
                isPdfMagic &&
                baseName !== 'ActaReparto' &&
                (await detectActaRepartoInPdfBuffer(buffer))
              ) {
                baseName = 'ActaReparto';
                originalLinkName = ACTA_REPARTO_DISPLAY_NAME;
              }

              processedAttachments.push({
                filename: baseName,
                originalName: originalLinkName,
                size: buffer.length,
                contentType: contentType,
                content: buffer.toString('base64'),
                isFromLink: true,
                tempOrder: globalOrderIndex++
              });
            }
          }
        } catch (downloadError) {
          console.error(`Error downloading file from "Archivo" link:`, downloadError);
        }
      }

      // 2. Process physical attachments (filtering out images as they are in the PDF already)
      const validAttachments = (parsed.attachments || []).filter(att => {
        if (att.contentType?.startsWith('image/')) return false;
        return true;
      });
      
      for (const att of validAttachments) {
        const lowerOrig = (att.filename || "").toLowerCase();
        let contentType = att.contentType || 'application/octet-stream';
        
        if (lowerOrig.endsWith('.pdf')) contentType = 'application/pdf';
        
        if (contentType === 'application/zip' || att.filename?.endsWith('.zip')) {
          const zip = new JSZip();
          const zipContent = await zip.loadAsync(att.content);
          
          const filePromises: any[] = [];
          zip.forEach((relativePath, file) => {
            if (file.dir) return;
            filePromises.push((async () => {
              const filename = relativePath;
              const lowerName = filename.toLowerCase();
              let innerContentType = 'application/octet-stream';
              if (lowerName.endsWith('.pdf')) innerContentType = 'application/pdf';

              let baseName = filename;
              if (lowerName.includes('demanda')) baseName = 'EscritoDemanda';
              else if (lowerName.includes('prueba') || lowerName.includes('anexo')) baseName = 'DocumentosPruebasAnexos';
              else if (lowerName.includes('poder')) baseName = 'Poder';
              else if (filenameSuggestsActaReparto(lowerName)) baseName = 'ActaReparto';

              let originalNameZip = filename;
              let contentB64Zip: string;
              if (innerContentType === 'application/pdf') {
                const pdfBuf = Buffer.from(await file.async('nodebuffer'));
                if (baseName === filename && (await detectActaRepartoInPdfBuffer(pdfBuf))) {
                  baseName = 'ActaReparto';
                  originalNameZip = ACTA_REPARTO_DISPLAY_NAME;
                }
                contentB64Zip = pdfBuf.toString('base64');
              } else {
                contentB64Zip = await file.async('base64');
              }

              return {
                filename: baseName,
                originalName: baseName === 'ActaReparto' ? ACTA_REPARTO_DISPLAY_NAME : originalNameZip,
                size: (file as any)._data?.uncompressedSize || 0,
                contentType: innerContentType,
                content: contentB64Zip,
                tempOrder: globalOrderIndex++
              };
            })());
          });

          const unzipFiles = await Promise.all(filePromises);
          processedAttachments = [...processedAttachments, ...unzipFiles];
        } else {
          // Individual file processing
          let baseName = att.filename || 'Documento';
          let originalNameOut = att.filename || 'Documento';
          if (filenameSuggestsActaReparto(lowerOrig)) baseName = 'ActaReparto';
          else if (lowerOrig.includes('poder')) baseName = 'Poder';
          else if (lowerOrig.includes('demanda')) baseName = 'EscritoDemanda';
          else if (lowerOrig.includes('prueba') || lowerOrig.includes('anexo')) baseName = 'DocumentosPruebasAnexos';

          if (
            contentType === 'application/pdf' &&
            att.content &&
            baseName === (att.filename || 'Documento')
          ) {
            const pdfBuf = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
            if (await detectActaRepartoInPdfBuffer(pdfBuf)) {
              baseName = 'ActaReparto';
              originalNameOut = ACTA_REPARTO_DISPLAY_NAME;
            }
          }
          if (baseName === 'ActaReparto') {
            originalNameOut = ACTA_REPARTO_DISPLAY_NAME;
          }

          processedAttachments.push({
            filename: baseName,
            originalName: originalNameOut,
            size: att.size,
            contentType: contentType,
            content: att.content ? att.content.toString('base64') : '',
            tempOrder: globalOrderIndex++
          });
        }
      }

      // Final Sorting and Unique Naming
      processedAttachments.sort((a, b) => {
        const pA = getPriority(a.filename);
        const pB = getPriority(b.filename);
        if (pA !== pB) return pA - pB;
        return a.tempOrder - b.tempOrder;
      });

      // Reset counters and assign unique names + final order
      const finalProcessed = processedAttachments.map((att, idx) => {
        const uniqueName = getUniqueName(att.filename);
        return {
          ...att,
          filename: uniqueName,
          order: idx
        };
      });

      sweepParseSessions();
      const parseSessionId = randomUUID();
      const sessionAttachments: ParseSessionRow[] = finalProcessed.map((att: any, idx: number) => {
        const buf = Buffer.from(att.content || '', 'base64');
        return {
          sessionIndex: idx,
          filename: att.filename,
          originalName: att.originalName,
          contentType: att.contentType || 'application/octet-stream',
          size: typeof att.size === 'number' ? att.size : buf.length,
          isFromLink: !!att.isFromLink,
          order: att.order,
          buffer: buf,
        };
      });
      parseSessions.set(parseSessionId, {
        createdAt: Date.now(),
        attachments: sessionAttachments,
      });

      const publicAttachments = sessionAttachments.map(({ buffer: _buf, ...meta }) => meta);

      res.json({
        subject: parsed.subject,
        from: parsed.from?.text,
        to: parsed.to ? (Array.isArray(parsed.to) ? (parsed.to[0] as any).text : (parsed.to as any).text) : '',
        date: parsed.date,
        text: parsed.text,
        html: parsed.html,
        attachments: publicAttachments,
        parseSessionId,
        linkFound: linkFound,
        linkUrl: downloadUrl
      });
    } catch (error) {
      console.error('Email parsing error:', error);
      res.status(500).json({ error: 'Failed to parse email' });
    }
  });

  app.post('/api/ai/summarize', async (req, res) => {
    try {
      const { claim, rawText, contextBlock } = req.body || {};
      if (!rawText) {
        return res.status(400).json({ error: 'rawText es requerido' });
      }

      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const openai = getOpenAiClient();
      const ctx =
        typeof contextBlock === 'string' && contextBlock.trim().length > 0
          ? `\n### Datos del expediente en el sistema (plazos, piezas, asignación)\n${contextBlock.trim()}\n`
          : '';

      const prompt = `
Eres un asistente juridico especializado en derecho constitucional colombiano.
Tu tarea es sintetizar los puntos clave de una demanda de tutela por urgencia y el estado procesal útil para el despacho.

REMITENTE/ACCIONANTE: ${claim || 'No especificado'}
${ctx}
CUERPO DEL CORREO/DEMANDA (texto principal):
${rawText}

FORMATO DE SALIDA (USAR MARKDOWN):
### Sintesis Operativa
**1. Derechos presuntamente vulnerados:** (Lista breve)
**2. Hechos relevantes:** (Maximo 3 puntos clave)
**3. Pretension principal:** (Sintesis de lo pedido)
**4. Urgencia detectada:** (Por que es urgente o si hay riesgo de dano irremediable)
**5. Plazos, traslados y contestaciones:** (A partir del bloque de expediente y del texto: términos para el accionado, traslados, respuestas de la EPS u otros; si no consta indique «No consta en los datos suministrados»)
**6. Piezas y seguimiento:** (Relacione brevemente las piezas listadas con la controversia, si aplica)
`;

      const result = await openai.responses.create({
        model,
        input: prompt,
      });

      return res.json({ text: result.output_text || '' });
    } catch (error: any) {
      console.error('OpenAI summarize error:', error);
      const mapped = mapAiError(error);
      return res.status(mapped.status).json({ error: mapped.message });
    }
  });

  app.post('/api/ai/legal-analysis', async (req, res) => {
    try {
      const { prompt, pdfBase64 } = req.body || {};
      if (!prompt || !pdfBase64) {
        return res.status(400).json({ error: 'prompt y pdfBase64 son requeridos' });
      }

      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const openai = getOpenAiClient();
      const parteTutela = {
        type: 'object',
        additionalProperties: false,
        properties: {
          nombre: { type: 'string' },
          identificacion: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['nombre', 'identificacion', 'email'],
      } as const;
      const schema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          accionantes: { type: 'array', items: parteTutela, minItems: 1 },
          accionados: { type: 'array', items: parteTutela, minItems: 1 },
          derechoTutelado: { type: 'string' },
          hechos: { type: 'string' },
          pretensiones: { type: 'string' },
        },
        required: ['accionantes', 'accionados', 'derechoTutelado', 'hechos', 'pretensiones'],
      };

      const result = await openai.responses.create({
        model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              {
                type: 'input_file',
                filename: 'documento.pdf',
                file_data: `data:application/pdf;base64,${pdfBase64}`
              }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'analisis_tutela',
            schema,
            strict: true
          }
        }
      });

      const content = result.output_text || '{}';
      return res.json({ text: content });
    } catch (error: any) {
      console.error('OpenAI legal-analysis error:', error);
      const mapped = mapAiError(error);
      return res.status(mapped.status).json({ error: mapped.message });
    }
  });

  // Error handler for API routes
  app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        error: 'El documento es demasiado grande para procesarlo por API. Intente un archivo mas pequeno.'
      });
    }
    console.error('API Error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
      details: err.stack
    });
  });

  // Catch-all for /api routes that don't match
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API route ${req.method} ${req.url} not found` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
