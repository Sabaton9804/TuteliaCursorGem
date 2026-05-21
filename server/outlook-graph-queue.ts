/** Evita ApplicationThrottled / MailboxConcurrency de Microsoft Graph (peticiones en serie). */

const GAP_MS = Number(process.env.OUTLOOK_GRAPH_GAP_MS || 400);
const MAX_429_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterMs(res: Response): number {
  const h = res.headers.get('Retry-After');
  if (!h) return 0;
  const sec = parseInt(h, 10);
  if (!Number.isNaN(sec)) return sec * 1000;
  const when = Date.parse(h);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return 0;
}

export function isGraphThrottledError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('429') ||
    m.includes('applicationthrottled') ||
    m.includes('mailboxconcurrency') ||
    m.includes('throttled')
  );
}

export function graphThrottleUserMessage(): string {
  return 'Microsoft limitó temporalmente las consultas al buzón (demasiadas a la vez). Espere unos segundos e intente de nuevo.';
}

class MailboxGraphQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.tail.then(() => fn());
    this.tail = job
      .then(() => sleep(GAP_MS))
      .catch(() => sleep(GAP_MS));
    return job;
  }
}

const mailboxQueue = new MailboxGraphQueue();

export async function runQueuedGraphRequest<T>(fn: () => Promise<T>): Promise<T> {
  return mailboxQueue.run(async () => {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < MAX_429_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (!isGraphThrottledError(lastErr.message) || attempt === MAX_429_RETRIES - 1) {
          throw lastErr;
        }
        const waitMs = Math.max(1500 * (attempt + 1), 500);
        console.warn(`[outlook] Graph limitado, reintento ${attempt + 2}/${MAX_429_RETRIES} en ${waitMs}ms…`);
        await sleep(waitMs);
      }
    }
    throw lastErr ?? new Error('Graph request failed');
  });
}

/** Fetch con cola + reintentos ante 429 (descargas $value, etc.). */
export async function runQueuedGraphFetch(
  accessToken: string,
  url: string,
  init?: RequestInit
): Promise<Response> {
  return mailboxQueue.run(async () => {
    let lastRes: Response | null = null;
    for (let attempt = 0; attempt < MAX_429_RETRIES; attempt++) {
      const res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init?.headers || {}),
        },
      });
      if (res.ok) return res;
      lastRes = res;
      if (res.status !== 429 || attempt === MAX_429_RETRIES - 1) return res;
      const retryAfter = parseRetryAfterMs(res);
      const waitMs = Math.max(retryAfter, 1500 * (attempt + 1));
      console.warn(`[outlook] Graph 429 en fetch, reintento en ${waitMs}ms…`);
      await res.text().catch(() => '');
      await sleep(waitMs);
    }
    return lastRes!;
  });
}
