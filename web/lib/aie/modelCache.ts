import { createHash } from "node:crypto";

const MAX_CACHE_ENTRIES = 200;

type ModelCacheEntry = {
  expiresAt: number;
  value: string;
};

const modelResponseCache = new Map<string, ModelCacheEntry>();

export function buildCacheKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

export function readCache(key: string): string | null {
  const cacheKey = String(key ?? "").trim();
  if (!cacheKey) {
    return null;
  }

  const cachedEntry = modelResponseCache.get(cacheKey);
  if (!cachedEntry) {
    return null;
  }

  if (Date.now() > cachedEntry.expiresAt) {
    modelResponseCache.delete(cacheKey);
    return null;
  }

  modelResponseCache.delete(cacheKey);
  modelResponseCache.set(cacheKey, cachedEntry);
  return cachedEntry.value;
}

export function writeCache(key: string, value: string, ttlMs: number): void {
  const cacheKey = String(key ?? "").trim();
  if (!cacheKey) {
    return;
  }

  const safeTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.floor(ttlMs) : 0;
  if (safeTtlMs <= 0) {
    return;
  }

  if (modelResponseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = modelResponseCache.keys().next().value;
    if (oldestKey) {
      modelResponseCache.delete(oldestKey);
    }
  }

  modelResponseCache.set(cacheKey, {
    expiresAt: Date.now() + safeTtlMs,
    value,
  });
}
