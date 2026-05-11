import { createInitialGameDevSessionContext } from "./gameDevSessionContext";
import type { GameDevSessionContext } from "./gameDevChatTypes";

export const gameDevSessionStorageKey = "aie.operator.chat.sessionContext.v1";

type StoredGameDevSessionContext = {
  version: 1;
  savedAt: string;
  context: GameDevSessionContext;
};

export type GameDevSessionStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function durableContext(context: GameDevSessionContext): GameDevSessionContext {
  return {
    ...context,
    unresolvedBlockers: [...context.unresolvedBlockers],
    scaffoldStatus: "LOCAL_BROWSER_PROJECT_MEMORY_PHASE1",
    memoryScope: "local-browser-storage",
    updatedAt: context.updatedAt ?? new Date().toISOString(),
  };
}

function isStoredContext(value: unknown): value is StoredGameDevSessionContext {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<StoredGameDevSessionContext>;
  return record.version === 1 && typeof record.savedAt === "string" && Boolean(record.context);
}

export function loadGameDevSessionContext(storage: GameDevSessionStorageLike | undefined): GameDevSessionContext {
  if (!storage) {
    return createInitialGameDevSessionContext();
  }
  try {
    const raw = storage.getItem(gameDevSessionStorageKey);
    if (!raw) {
      return createInitialGameDevSessionContext();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isStoredContext(parsed)) {
      return createInitialGameDevSessionContext();
    }
    return durableContext(parsed.context);
  } catch {
    return createInitialGameDevSessionContext();
  }
}

export function saveGameDevSessionContext(storage: GameDevSessionStorageLike | undefined, context: GameDevSessionContext): GameDevSessionContext {
  const durable = durableContext(context);
  if (!storage) {
    return durable;
  }
  const stored: StoredGameDevSessionContext = {
    version: 1,
    savedAt: new Date().toISOString(),
    context: durable,
  };
  storage.setItem(gameDevSessionStorageKey, JSON.stringify(stored));
  return durable;
}

export function clearGameDevSessionContext(storage: GameDevSessionStorageLike | undefined): GameDevSessionContext {
  storage?.removeItem(gameDevSessionStorageKey);
  return createInitialGameDevSessionContext();
}