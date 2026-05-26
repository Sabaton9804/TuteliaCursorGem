const TTL_MS = 10 * 60 * 1000;

type Entry = {
  bytes: Uint8Array;
  contentType: string;
  expiresAt: number;
};

const cache = new Map<string, Entry>();

export function getSgdePreviewFromCache(nodeId: string): Entry | null {
  const hit = cache.get(nodeId);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(nodeId);
    return null;
  }
  return hit;
}

export function setSgdePreviewCache(nodeId: string, bytes: Uint8Array, contentType: string): void {
  cache.set(nodeId, {
    bytes,
    contentType,
    expiresAt: Date.now() + TTL_MS,
  });
}
