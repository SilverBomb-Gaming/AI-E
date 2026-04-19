import { createHash } from "node:crypto";

const MAX_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;

type ModelCacheEntry = {
  createdAt: number;
  value: string;
};

const modelResponseCache = new Map<string, ModelCacheEntry>();

export function buildModelCacheKey(taskType: string, input: string): string {
  return createHash("sha256").update(`${taskType}:${input}`).digest("hex");
}

export function getCachedModelResponse(taskType: string, input: string): string | null {
  const cacheKey = buildModelCacheKey(taskType, input);
  const cachedEntry = modelResponseCache.get(cacheKey);
  if (!cachedEntry) {
    return null;
  }

  if (Date.now() - cachedEntry.createdAt > CACHE_TTL_MS) {
    modelResponseCache.delete(cacheKey);
    return null;
  }

  modelResponseCache.delete(cacheKey);
  modelResponseCache.set(cacheKey, cachedEntry);
  return cachedEntry.value;
}

export function setCachedModelResponse(taskType: string, input: string, value: string): void {
  const cacheKey = buildModelCacheKey(taskType, input);

  if (modelResponseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = modelResponseCache.keys().next().value;
    if (oldestKey) {
      modelResponseCache.delete(oldestKey);
    }
  }

  modelResponseCache.set(cacheKey, {
    createdAt: Date.now(),
    value,
  });
}
