import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function summarizeCase(claim: string, rawText: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        Eres un asistente jurídico especializado en derecho constitucional colombiano.
        Tu tarea es sintetizar los puntos clave de una demanda de tutela por urgencia.
        
        REMITENTE/ACCIONANTE: ${claim}
        CUERPO DEL CORREO/DEMANDA:
        ${rawText}
        
        FORMATO DE SALIDA (USAR MARKDOWN):
        ### Síntesis Operativa
        **1. Derechos presuntamente vulnerados:** (Lista breve)
        **2. Hechos relevantes:** (Máximo 3 puntos clave)
        **3. Pretensión principal:** (Síntesis de lo pedido)
        **4. Urgencia detectada:** (Por qué es urgente o si hay riesgo de daño irremediable)
        
        REGLA DE ORO: Sé conciso, preciso y usa un tono profesional judicial.
      `,
    });

    return response.text;
  } catch (error) {
    console.error("AI Summarization failed:", error);
    throw error;
  }
}
