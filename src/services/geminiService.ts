import { apiUrl } from '../lib/api-base';

function mapGeminiError(error: any): Error {
  const status = error?.status || error?.response?.status;
  const rawMessage = String(error?.message || "");
  const normalized = rawMessage.toLowerCase();

  if (status === 429 || normalized.includes("resource_exhausted") || normalized.includes("rate limit") || normalized.includes("quota")) {
    return new Error(
      "Cuota de OpenAI agotada temporalmente (429). Intente de nuevo en unos segundos o revise límites/facturación."
    );
  }

  if (status === 401 || normalized.includes("incorrect api key") || normalized.includes("api key") || normalized.includes("unauthorized")) {
    return new Error("API key de OpenAI inválida. Revise OPENAI_API_KEY en .env o .env.local.");
  }

  if (status === 404 || rawMessage.includes("models/") || rawMessage.includes("NOT_FOUND")) {
    return new Error("El modelo de OpenAI configurado no está disponible para esta cuenta.");
  }

  return error instanceof Error ? error : new Error("Error inesperado al consultar Gemini.");
}

export async function summarizeCase(
  claim: string,
  rawText: string,
  contextBlock?: string,
  extra?: Record<string, unknown>,
) {
  try {
    const response = await fetch(apiUrl('/api/ai/summarize'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claim,
        rawText,
        contextBlock: contextBlock?.trim() || undefined,
        ...extra,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw Object.assign(new Error(payload.error || 'Error al resumir el caso.'), {
        status: response.status,
      });
    }

    const payload = await response.json();
    return payload.text || '';
  } catch (error) {
    console.error("AI Summarization failed:", error);
    throw mapGeminiError(error);
  }
}
