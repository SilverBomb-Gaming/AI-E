import assert from "node:assert/strict";
import * as nodePath from "node:path";
import test from "node:test";

import { dispatchReplayMap } from "./dispatchAuthorizationBoundary";
import type { SandboxSnapshotDirectoryEntry } from "./sandboxSnapshotLifecycle";
import {
  SANDBOX_GAMEPLAY_CONFIG_ADAPTER_ID,
  SANDBOX_GAMEPLAY_CONFIG_ADAPTER_VERSION,
  SANDBOX_GAMEPLAY_CONFIG_FILE_NAME,
  DEFAULT_GAMEPLAY_CONFIG,
  GAMEPLAY_CONFIG_TUNING_STEP,
  applyGameplayTuning,
  parseGameplayConfig,
  serializeGameplayConfig,
  createSandboxGameplayConfigAdapter,
  type SandboxGameplayConfigFilesystem,
} from "./sandboxGameplayConfigAdapter";
import {
  makeDefaultSandboxRuntimeIOContract,
  type GovernedRuntimeAdapterId,
  type GovernedRuntimeInvocation,
} from "./governedRuntimeAdapterContract";
import {
  executeSandboxGameplayConfigDispatch,
  type SandboxGameplayConfigDispatchRequest,
} from "./sandboxGameplayConfigDispatch";

// =====================================================================================
// TEST FIXTURES
// =====================================================================================

const FIXED_TIME = "2026-05-22T14:00:00.000Z";
const EXPIRES_FUTURE = "2026-05-22T15:00:00.000Z";
const EXPIRES_PAST = "2026-05-22T13:00:00.000Z";
const REPO_ROOT = nodePath.resolve("E:/test-ai-e-exec0052d-gameplay");
const SANDBOX_ID = "sandbox-exec0052d-gameplay-test";

function key(absolutePath: string): string {
  return nodePath.normalize(absolutePath);
}

type SharedInMemoryFs = SandboxGameplayConfigFilesystem & {
  listDirectory: (p: string) => Promise<SandboxSnapshotDirectoryEntry[]>;
  getFileSize: (p: string) => Promise<number>;
  files: Map<string, string>;
  directories: Set<string>;
};

function makeSharedInMemoryFs(): SharedInMemoryFs {
  const files = new Map<string, string>();
  const directories = new Set<string>();

  function buildEntries(dirPath: string): SandboxSnapshotDirectoryEntry[] {
    const normalizedDir = key(dirPath);
    const entries: SandboxSnapshotDirectoryEntry[] = [];
    for (const [fp] of files) {
      if (nodePath.dirname(key(fp)) === normalizedDir) {
        entries.push({
          name: nodePath.basename(fp),
          kind: "file",
          sizeBytes: Buffer.byteLength(files.get(fp) ?? ""),
          modifiedAt: FIXED_TIME,
        });
      }
    }
    for (const dir of directories) {
      const nDir = key(dir);
      if (nodePath.dirname(nDir) === normalizedDir && nDir !== normalizedDir) {
        entries.push({ name: nodePath.basename(dir), kind: "directory" });
      }
    }
    return entries;
  }

  return {
    files,
    directories,
    createDirectory: async (p) => { directories.add(p); },
    writeFile: async (p, c) => { files.set(key(p), c); },
    readFile: async (p) => {
      const c = files.get(key(p));
      return c ?? null;
    },
    listDirectory: async (p) => {
      const nPath = key(p);
      const known = directories.has(p) || [...files.keys()].some((f) => nodePath.dirname(f) === nPath);
      if (!known) { const e = Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" }); throw e; }
      return buildEntries(p);
    },
    getFileSize: async (p) => {
      const c = files.get(key(p));
      if (c === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      return Buffer.byteLength(c);
    },
  };
}

function makeApproval(proposalId?: string) {
  return {
    authorityToken: "operator-approved" as GovernedRuntimeAdapterId,
    approvedBy: "operator-exec0052d-gameplay",
    approvedAt: FIXED_TIME,
    proposalId: proposalId ?? `proposal-exec0052d-gameplay-${Math.random().toString(36).slice(2, 10)}`,
    operationRequest: "apply movement speed tuning",
  };
}

function baseRequest(overrides?: Partial<SandboxGameplayConfigDispatchRequest>): SandboxGameplayConfigDispatchRequest {
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createSandboxGameplayConfigAdapter(sharedFs);
  return {
    approvalToken: "operator-approved",
    authorization: makeApproval(),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operatorId: "operator-exec0052d-gameplay",
    operationRequest: "apply movement speed tuning",
    now: () => FIXED_TIME,
    filesystem: sharedFs,
    adapter,
    ...overrides,
  };
}

function resetReplay() {
  dispatchReplayMap.clear();
}

function makeInvocation(workspaceRoot: string, overrides?: Partial<GovernedRuntimeInvocation>): GovernedRuntimeInvocation {
  return {
    invocationId: "invocation-20260522140000",
    dispatchId: "dispatch-20260522140000-exec0052d",
    sandboxId: SANDBOX_ID,
    operatorId: "operator-exec0052d-gameplay",
    runtimeId: SANDBOX_GAMEPLAY_CONFIG_ADAPTER_ID,
    approvalReference: "proposal-exec0052d-gameplay-test",
    approval: makeApproval(),
    operationRequest: "apply movement speed tuning",
    workspaceRoot,
    timeoutMs: 30_000,
    ioContract: makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: true }),
    requestedAt: FIXED_TIME,
    ...overrides,
  };
}

// =====================================================================================
// ADAPTER UNIT TESTS
// =====================================================================================

test("createSandboxGameplayConfigAdapter satisfies GovernedRuntimeAdapter interface", () => {
  const adapter = createSandboxGameplayConfigAdapter();
  assert.equal(typeof adapter.adapterId, "string");
  assert.equal(typeof adapter.runtimeType, "string");
  assert.equal(typeof adapter.adapterVersion, "string");
  assert.equal(typeof adapter.invoke, "function");
  assert.equal(adapter.adapterId, SANDBOX_GAMEPLAY_CONFIG_ADAPTER_ID);
  assert.equal(adapter.adapterVersion, SANDBOX_GAMEPLAY_CONFIG_ADAPTER_VERSION);
  assert.equal(adapter.runtimeType, "openclaw");
  assert.equal(adapter.capability.requiresSandbox, true);
  assert.equal(adapter.capability.requiresApproval, true);
  assert.equal(adapter.capability.shellExecutionEnabled, false);
  assert.equal(adapter.capability.networkExecutionEnabled, false);
  assert.equal(adapter.capability.productionMutationEnabled, false);
});

test("adapter invoke() rejects when ioContract.workspaceWriteAllowed=false", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxGameplayConfigAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const invocation = makeInvocation(workspaceRoot, {
    ioContract: makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: false }),
  });
  const result = await adapter.invoke(invocation);
  assert.equal(result.outcome, "rejected");
  assert.equal(result.failure?.category, "operation_rejected_by_adapter");
  assert.equal(fs.files.size, 0, "no files written on IO rejection");
});

test("adapter invoke() creates sandboxGameplayConfig.json on first invocation with default+tuning values", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxGameplayConfigAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const result = await adapter.invoke(makeInvocation(workspaceRoot));
  assert.equal(result.outcome, "completed");
  const written = [...fs.files.entries()].find(([p]) => p.includes(SANDBOX_GAMEPLAY_CONFIG_FILE_NAME));
  assert.ok(written, "sandboxGameplayConfig.json was written");
  const config = parseGameplayConfig(written[1]);
  assert.equal(config.version, DEFAULT_GAMEPLAY_CONFIG.version + 1, "version incremented from default");
  assert.equal(
    config.movementSpeed,
    Math.round((DEFAULT_GAMEPLAY_CONFIG.movementSpeed + GAMEPLAY_CONFIG_TUNING_STEP.movementSpeed) * 100) / 100,
    "movementSpeed incremented",
  );
  assert.equal(
    config.staminaCooldown,
    Math.round((DEFAULT_GAMEPLAY_CONFIG.staminaCooldown + GAMEPLAY_CONFIG_TUNING_STEP.staminaCooldown) * 100) / 100,
    "staminaCooldown decremented",
  );
  assert.equal(
    config.enemyAggroRange,
    Math.round((DEFAULT_GAMEPLAY_CONFIG.enemyAggroRange + GAMEPLAY_CONFIG_TUNING_STEP.enemyAggroRange) * 100) / 100,
    "enemyAggroRange incremented",
  );
});

test("adapter invoke() applies tuning step on second invocation", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxGameplayConfigAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  await adapter.invoke(makeInvocation(workspaceRoot));
  const result2 = await adapter.invoke(makeInvocation(workspaceRoot, {
    operationRequest: "apply second tuning step",
  }));
  assert.equal(result2.outcome, "completed");
  const written = [...fs.files.entries()].find(([p]) => p.includes(SANDBOX_GAMEPLAY_CONFIG_FILE_NAME));
  const config = parseGameplayConfig(written?.[1] ?? "{}");
  assert.equal(config.version, DEFAULT_GAMEPLAY_CONFIG.version + 2, "version is 2 steps from default");
  assert.equal(config.lastPatch, "apply second tuning step", "lastPatch updated");
});

test("adapter invoke() stdout has BEFORE, AFTER, TUNING DIFF, PATCH sections", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxGameplayConfigAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const result = await adapter.invoke(makeInvocation(workspaceRoot));
  assert.ok(result.outputCapture.stdout.includes("=== BEFORE ==="), "stdout has BEFORE section");
  assert.ok(result.outputCapture.stdout.includes("=== AFTER ==="), "stdout has AFTER section");
  assert.ok(result.outputCapture.stdout.includes("=== TUNING DIFF ==="), "stdout has TUNING DIFF section");
  assert.ok(result.outputCapture.stdout.includes("=== PATCH ==="), "stdout has PATCH section");
  assert.ok(result.outputCapture.stdout.includes("movementSpeed"), "stdout shows movementSpeed diff");
  assert.ok(result.outputCapture.stdout.includes("staminaCooldown"), "stdout shows staminaCooldown diff");
  assert.ok(result.outputCapture.stdout.includes("enemyAggroRange"), "stdout shows enemyAggroRange diff");
});

test("adapter invoke() lifecycle includes all expected states on success", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxGameplayConfigAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const result = await adapter.invoke(makeInvocation(workspaceRoot));
  const states = result.lifecycle.records.map((r) => r.state);
  assert.ok(states.includes("queued"), "has queued");
  assert.ok(states.includes("authorization_verified"), "has authorization_verified");
  assert.ok(states.includes("dispatching"), "has dispatching");
  assert.ok(states.includes("running"), "has running");
  assert.ok(states.includes("completed"), "has completed");
  assert.equal(result.lifecycle.currentState, "completed");
});

test("adapter invoke() safetyBoundary flags are all correct", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxGameplayConfigAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const result = await adapter.invoke(makeInvocation(workspaceRoot));
  assert.equal(result.safetyBoundary.sandboxScoped, true);
  assert.equal(result.safetyBoundary.approvalRequired, true);
  assert.equal(result.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(result.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(result.safetyBoundary.productionWorkspaceMutationEnabled, false);
  assert.equal(result.safetyBoundary.humanAuthorityFinal, true);
});

test("parseGameplayConfig round-trips through serializeGameplayConfig", () => {
  const config = { version: 3, movementSpeed: 6.5, staminaCooldown: 1.2, enemyAggroRange: 17.0, lastPatch: "test" };
  const serialized = serializeGameplayConfig(config);
  const parsed = parseGameplayConfig(serialized);
  assert.deepEqual(parsed, config);
});

test("applyGameplayTuning increments all fields by expected deltas", () => {
  const before = { version: 2, movementSpeed: 6.0, staminaCooldown: 1.3, enemyAggroRange: 16.0, lastPatch: "prev" };
  const { next, diffLines } = applyGameplayTuning(before, "test patch");
  assert.equal(next.version, 3);
  assert.equal(next.movementSpeed, 6.5);
  assert.equal(next.staminaCooldown, 1.2);
  assert.equal(next.enemyAggroRange, 17.0);
  assert.equal(next.lastPatch, "test patch");
  assert.ok(diffLines.length > 0, "diffLines is non-empty");
  assert.ok(diffLines.some((l) => l.includes("movementSpeed")), "diffLines includes movementSpeed");
  assert.ok(diffLines.some((l) => l.includes("staminaCooldown")), "diffLines includes staminaCooldown");
  assert.ok(diffLines.some((l) => l.includes("enemyAggroRange")), "diffLines includes enemyAggroRange");
});

test("applyGameplayTuning truncates lastPatch to 80 chars", () => {
  const before = { ...DEFAULT_GAMEPLAY_CONFIG };
  const longLabel = "x".repeat(120);
  const { next } = applyGameplayTuning(before, longLabel);
  assert.equal(next.lastPatch.length, 80, "lastPatch truncated to 80 chars");
});

// =====================================================================================
// DISPATCH ORCHESTRATOR TESTS
// =====================================================================================

test("executeSandboxGameplayConfigDispatch fails with expired authorization", async () => {
  resetReplay();
  const result = await executeSandboxGameplayConfigDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(result.outcome, "rejected");
  assert.equal(result.rollbackContract.rollbackReady, false);
});

test("executeSandboxGameplayConfigDispatch fails on replay (same approval used twice)", async () => {
  resetReplay();
  const approval = makeApproval("proposal-gameplay-replay-test");
  await executeSandboxGameplayConfigDispatch(baseRequest({ authorization: approval }));
  const result2 = await executeSandboxGameplayConfigDispatch(baseRequest({ authorization: approval }));
  assert.equal(result2.outcome, "rejected");
});

test("executeSandboxGameplayConfigDispatch rejects wrong approvalToken", async () => {
  resetReplay();
  await assert.rejects(
    () => executeSandboxGameplayConfigDispatch(baseRequest({ approvalToken: "wrong-token" })),
    /rejected/,
  );
});

test("executeSandboxGameplayConfigDispatch succeeds with valid fresh authorization", async () => {
  resetReplay();
  const result = await executeSandboxGameplayConfigDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.equal(result.manifestVersion, "EXEC-0052-D");
  assert.equal(result.runtimeType, "openclaw");
  assert.equal(result.adapterId, SANDBOX_GAMEPLAY_CONFIG_ADAPTER_ID);
});

test("executeSandboxGameplayConfigDispatch creates config file (before=0, after=1)", async () => {
  resetReplay();
  const result = await executeSandboxGameplayConfigDispatch(baseRequest());
  assert.equal(result.beforeSnapshotFileCount, 0);
  assert.equal(result.afterSnapshotFileCount, 1);
  assert.ok(result.diffEntries.some((e) => e.changeKind === "created"), "diff shows file created");
});

test("executeSandboxGameplayConfigDispatch configFilePath contains SANDBOX_GAMEPLAY_CONFIG_FILE_NAME", async () => {
  resetReplay();
  const result = await executeSandboxGameplayConfigDispatch(baseRequest());
  assert.ok(result.configFilePath.includes(SANDBOX_GAMEPLAY_CONFIG_FILE_NAME), "configFilePath contains sandboxGameplayConfig.json");
});

test("executeSandboxGameplayConfigDispatch generates receipt on success", async () => {
  resetReplay();
  const result = await executeSandboxGameplayConfigDispatch(baseRequest());
  assert.ok(result.receiptId.length > 0, "receiptId is non-empty");
  assert.ok(result.receiptSandboxPath.length > 0, "receiptSandboxPath is non-empty");
});

test("executeSandboxGameplayConfigDispatch rollback ready=true on success, false on auth failure", async () => {
  resetReplay();
  const ok = await executeSandboxGameplayConfigDispatch(baseRequest());
  assert.equal(ok.rollbackContract.rollbackReady, true);

  const fail = await executeSandboxGameplayConfigDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(fail.rollbackContract.rollbackReady, false);
});

test("executeSandboxGameplayConfigDispatch lifecycle shows completed on success, rejected on auth failure", async () => {
  resetReplay();
  const ok = await executeSandboxGameplayConfigDispatch(baseRequest());
  assert.equal(ok.lifecycle.currentState, "completed");

  const fail = await executeSandboxGameplayConfigDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(fail.lifecycle.currentState, "rejected");
});

test("executeSandboxGameplayConfigDispatch output captures BEFORE/AFTER/TUNING DIFF/PATCH sections", async () => {
  resetReplay();
  const result = await executeSandboxGameplayConfigDispatch(baseRequest());
  assert.ok(result.outputCapture.stdout.includes("=== BEFORE ==="), "has BEFORE section");
  assert.ok(result.outputCapture.stdout.includes("=== AFTER ==="), "has AFTER section");
  assert.ok(result.outputCapture.stdout.includes("=== TUNING DIFF ==="), "has TUNING DIFF section");
  assert.ok(result.outputCapture.stdout.includes("=== PATCH ==="), "has PATCH section");
  assert.ok(result.outputCapture.stdout.includes("movementSpeed"), "stdout includes movementSpeed");
  assert.ok(result.outputCapture.stdout.includes("apply movement speed tuning"), "stdout includes operationRequest");
});

test("executeSandboxGameplayConfigDispatch dispatch record maps all required fields", async () => {
  resetReplay();
  const result = await executeSandboxGameplayConfigDispatch(baseRequest());
  const dr = result.dispatchRecord;
  assert.ok(dr.recordId.length > 0, "recordId present");
  assert.equal(dr.outcome, "completed");
  assert.equal(dr.runtimeType, "openclaw");
  assert.equal(dr.adapterVersion, SANDBOX_GAMEPLAY_CONFIG_ADAPTER_VERSION);
  assert.equal(dr.safetyBoundary.humanAuthorityFinal, true);
  assert.equal(dr.safetyBoundary.shellExecutionEnabled, false);
});

test("executeSandboxGameplayConfigDispatch times out via slow adapter", async () => {
  resetReplay();
  const slowAdapter = {
    ...createSandboxGameplayConfigAdapter(),
    invoke: () => new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Sandbox gameplay config dispatch timed out after 1000ms")), 1100);
    }),
  };
  const result = await executeSandboxGameplayConfigDispatch(baseRequest({ adapter: slowAdapter, timeoutMs: 1000 }));
  assert.equal(result.outcome, "timeout");
  assert.ok(result.error?.includes("timed out"), "error mentions timeout");
}, { timeout: 5000 });

test("executeSandboxGameplayConfigDispatch second dispatch applies second tuning step (modified diff)", async () => {
  resetReplay();
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createSandboxGameplayConfigAdapter(sharedFs);

  await executeSandboxGameplayConfigDispatch({
    approvalToken: "operator-approved",
    authorization: makeApproval("proposal-gameplay-tuning-1"),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operationRequest: "apply first tuning step",
    now: () => FIXED_TIME,
    filesystem: sharedFs,
    adapter,
  });

  const result2 = await executeSandboxGameplayConfigDispatch({
    approvalToken: "operator-approved",
    authorization: makeApproval("proposal-gameplay-tuning-2"),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operationRequest: "apply second tuning step",
    now: () => "2026-05-22T14:00:01.000Z",
    filesystem: sharedFs,
    adapter,
  });

  assert.equal(result2.outcome, "completed");
  assert.ok(
    result2.diffEntries.some((e) => e.changeKind === "modified"),
    "second dispatch shows file as modified (tuning applied)",
  );
  assert.ok(result2.outputCapture.stdout.includes("apply second tuning step"), "stdout includes second patch label");
});

test("executeSandboxGameplayConfigDispatch spec example: default config tuned correctly", async () => {
  resetReplay();
  const sharedFs = makeSharedInMemoryFs();
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");

  // Pre-seed with a config matching the spec example starting point
  await sharedFs.createDirectory(workspaceRoot);
  const seedConfig = { version: 1, movementSpeed: 5.0, staminaCooldown: 1.5, enemyAggroRange: 15.0, lastPatch: "initial" };
  const seedPath = key(nodePath.join(workspaceRoot, SANDBOX_GAMEPLAY_CONFIG_FILE_NAME));
  sharedFs.files.set(seedPath, serializeGameplayConfig(seedConfig));

  const adapter = createSandboxGameplayConfigAdapter(sharedFs);
  await executeSandboxGameplayConfigDispatch({
    approvalToken: "operator-approved",
    authorization: makeApproval("proposal-gameplay-spec-example"),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operationRequest: "apply movement speed tuning",
    now: () => FIXED_TIME,
    filesystem: sharedFs,
    adapter,
  });

  const afterContent = sharedFs.files.get(seedPath) ?? "{}";
  const afterConfig = parseGameplayConfig(afterContent);
  assert.equal(afterConfig.version, 2, "version incremented to 2");
  assert.equal(afterConfig.movementSpeed, 5.5, "movementSpeed is 5.5");
  assert.equal(afterConfig.staminaCooldown, 1.4, "staminaCooldown is 1.4");
  assert.equal(afterConfig.enemyAggroRange, 16.0, "enemyAggroRange is 16.0");
  assert.equal(afterConfig.lastPatch, "apply movement speed tuning", "lastPatch updated");
});
