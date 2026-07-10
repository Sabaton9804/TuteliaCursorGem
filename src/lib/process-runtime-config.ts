/**
 * F1: runtime de etapas desde BD (`process_definitions`) vs fallback TS.
 * En producción: `VITE_PROCESS_RUNTIME_BD_ONLY=true` (o `PROCESS_RUNTIME_BD_ONLY` en Node).
 */

function readEnvFlag(): boolean {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PROCESS_RUNTIME_BD_ONLY === 'true') {
    return true;
  }
  if (typeof process !== 'undefined' && process.env?.PROCESS_RUNTIME_BD_ONLY === 'true') {
    return true;
  }
  return false;
}

let cachedBdOnly: boolean | null = null;

export function isProcessRuntimeBdOnly(): boolean {
  if (cachedBdOnly == null) cachedBdOnly = readEnvFlag();
  return cachedBdOnly;
}

/** Solo dev/test: permite fallback a `STAGE_PIPELINE_BY_CASE_TYPE`. */
export function warnProcessPipelineFallback(caseType: string, reason: string): void {
  const msg = `[process-runtime] Fallback TS pipeline para "${caseType}": ${reason}`;
  if (isProcessRuntimeBdOnly()) {
    console.error(msg);
  } else if (import.meta.env?.DEV) {
    console.warn(msg);
  }
}
