import assert from "node:assert/strict";
import test from "node:test";

import { loadGameDevSessionContext, saveGameDevSessionContext, clearGameDevSessionContext, gameDevSessionStorageKey, type GameDevSessionStorageLike } from "./gameDevDurableSessionStore";
import { planGameDevChatResponse } from "./gameDevResponsePlanner";

function createMemoryStorage(): GameDevSessionStorageLike & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

test("saves and loads local-browser durable session context", () => {
  const storage = createMemoryStorage();
  const response = planGameDevChatResponse("Make me a Codex handoff for adding collectibles in Unity.");
  const saved = saveGameDevSessionContext(storage, response.sessionContext);
  const loaded = loadGameDevSessionContext(storage);

  assert.equal(saved.memoryScope, "local-browser-storage");
  assert.equal(saved.scaffoldStatus, "LOCAL_BROWSER_PROJECT_MEMORY_PHASE1");
  assert.equal(loaded.memoryScope, "local-browser-storage");
  assert.equal(loaded.latestCodexHandoffTopic?.includes("collectible"), true);
  assert.ok(storage.entries.has(gameDevSessionStorageKey));
});

test("corrupt durable session context falls back truthfully to empty session context", () => {
  const storage = createMemoryStorage();
  storage.setItem(gameDevSessionStorageKey, "not-json");
  const loaded = loadGameDevSessionContext(storage);

  assert.equal(loaded.memoryScope, "in-memory-session");
  assert.equal(loaded.scaffoldStatus, "SESSION_CONTEXT_MEMORY_PHASE1_EMPTY");
});

test("clearing local durable session context removes stored state", () => {
  const storage = createMemoryStorage();
  const response = planGameDevChatResponse("I want my player jump to feel less floaty.");
  saveGameDevSessionContext(storage, response.sessionContext);
  const cleared = clearGameDevSessionContext(storage);

  assert.equal(storage.getItem(gameDevSessionStorageKey), null);
  assert.equal(cleared.memoryScope, "in-memory-session");
  assert.equal(cleared.scaffoldStatus, "SESSION_CONTEXT_MEMORY_PHASE1_EMPTY");
});