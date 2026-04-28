import dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import { simpleParser } from 'mailparser';
import JSZip from 'jszip';
import axios from 'axios';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config();

const PORT = 3000;
const BODY_LIMIT = '100mb';

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Falta OPENAI_API_KEY. Defina la variable en .env.local.');
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
            timeout: 15000,
            validateStatus: (status) => status < 500
          });

          if (response.status >= 400) {
            console.error(`Download failed with status ${response.status}`);
          } else {
            const buffer = Buffer.from(response.data);
            const contentType = response.headers['content-type'] || 'application/octet-stream';
            
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
                  else if (lowerName.includes('acta') || lowerName.includes('reparto') || lowerName.includes('secuencia')) baseName = 'ActaReparto';
                  
                  return {
                    filename: baseName,
                    originalName: filename,
                    size: (file as any)._data?.uncompressedSize || 0,
                    contentType: innerContentType,
                    content: await file.async('base64'),
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
              if (lowerUrl.includes('acta') || lowerUrl.includes('reparto') || lowerUrl.includes('secuencia')) {
                baseName = 'ActaReparto';
              } else if (lowerUrl.includes('demanda')) {
                baseName = 'EscritoDemanda';
              }
              
              processedAttachments.push({
                filename: baseName,
                originalName: 'archivo_descargado',
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
              else if (lowerName.includes('acta') || lowerName.includes('reparto') || lowerName.includes('secuencia')) baseName = 'ActaReparto';
              
              return {
                filename: baseName,
                originalName: filename,
                size: (file as any)._data?.uncompressedSize || 0,
                contentType: innerContentType,
                content: await file.async('base64'),
                tempOrder: globalOrderIndex++
              };
            })());
          });

          const unzipFiles = await Promise.all(filePromises);
          processedAttachments = [...processedAttachments, ...unzipFiles];
        } else {
          // Individual file processing
          let baseName = att.filename || 'Documento';
          if (lowerOrig.includes('acta') || lowerOrig.includes('reparto') || lowerOrig.includes('secuencia')) baseName = 'ActaReparto';
          else if (lowerOrig.includes('poder')) baseName = 'Poder';
          else if (lowerOrig.includes('demanda')) baseName = 'EscritoDemanda';
          else if (lowerOrig.includes('prueba') || lowerOrig.includes('anexo')) baseName = 'DocumentosPruebasAnexos';

          processedAttachments.push({
            filename: baseName,
            originalName: att.filename,
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

      res.json({
        subject: parsed.subject,
        from: parsed.from?.text,
        to: parsed.to ? (Array.isArray(parsed.to) ? (parsed.to[0] as any).text : (parsed.to as any).text) : '',
        date: parsed.date,
        text: parsed.text,
        html: parsed.html,
        attachments: finalProcessed,
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
      const { claim, rawText } = req.body || {};
      if (!rawText) {
        return res.status(400).json({ error: 'rawText es requerido' });
      }

      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const openai = getOpenAiClient();
      const prompt = `
Eres un asistente juridico especializado en derecho constitucional colombiano.
Tu tarea es sintetizar los puntos clave de una demanda de tutela por urgencia.

REMITENTE/ACCIONANTE: ${claim || 'No especificado'}
CUERPO DEL CORREO/DEMANDA:
${rawText}

FORMATO DE SALIDA (USAR MARKDOWN):
### Sintesis Operativa
**1. Derechos presuntamente vulnerados:** (Lista breve)
**2. Hechos relevantes:** (Maximo 3 puntos clave)
**3. Pretension principal:** (Sintesis de lo pedido)
**4. Urgencia detectada:** (Por que es urgente o si hay riesgo de dano irremediable)
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
      const schema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          accionante: { type: 'string' },
          accionanteId: { type: 'string' },
          accionanteEmail: { type: 'string' },
          accionado: { type: 'string' },
          accionadoId: { type: 'string' },
          accionadoEmail: { type: 'string' },
          derechoTutelado: { type: 'string' },
          hechos: { type: 'string' },
          pretensiones: { type: 'string' }
        },
        required: [
          'accionante',
          'accionanteId',
          'accionanteEmail',
          'accionado',
          'accionadoId',
          'accionadoEmail',
          'derechoTutelado',
          'hechos',
          'pretensiones'
        ]
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
