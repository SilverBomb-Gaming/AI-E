import { createRuntimeStateStore, type RuntimeStateStore } from "./runtimeStateStore";

type OperatorRuntimeStoreCache = {
  store: RuntimeStateStore | null;
  runtimeId: string | null;
};

declare global {
  var __aieOperatorRuntimeStoreCache: OperatorRuntimeStoreCache | undefined;
}

function loadRuntimeStateStoreFromEnvironment(): RuntimeStateStore | null {
  const rawRecords = process.env.AIE_OPERATOR_RUNTIME_STATE_STORE_JSON;
  if (!rawRecords) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawRecords) as { records?: Record<string, string>; stale_after_ms?: number };
    return createRuntimeStateStore({
      records: parsed.records ?? {},
      stale_after_ms: parsed.stale_after_ms,
    });
  } catch {
    return createRuntimeStateStore({
      records: {
        [process.env.AIE_OPERATOR_RUNTIME_ID ?? "invalid-runtime"]: rawRecords,
      },
    });
  }
}

function getCache(): OperatorRuntimeStoreCache {
  if (!globalThis.__aieOperatorRuntimeStoreCache) {
    globalThis.__aieOperatorRuntimeStoreCache = {
      store: loadRuntimeStateStoreFromEnvironment(),
      runtimeId: process.env.AIE_OPERATOR_RUNTIME_ID ?? null,
    };
  }

  return globalThis.__aieOperatorRuntimeStoreCache;
}

export function getOperatorRuntimeStateStore(): RuntimeStateStore | null {
  return getCache().store;
}

export function getOperatorRuntimeId(): string | null {
  return getCache().runtimeId;
}