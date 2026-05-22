import assert from "node:assert/strict";
import * as nodePath from "node:path";
import test from "node:test";

import { dispatchReplayMap } from "./dispatchAuthorizationBoundary";
import type { SandboxSnapshotDirectoryEntry } from "./sandboxSnapshotLifecycle";
import {
  SANDBOX_PATCH_ADAPTER_ID,
  SANDBOX_PATCH_ADAPTER_VERSION,
  SANDBOX_PATCH_FILE_NAME,
  applyPatchMutation,
  buildInitialPatchFileContent,
  createSandboxPatchRuntimeAdapter,
  type SandboxPatchAdapterFilesystem,
} from "./sandboxPatchRuntimeAdapter";
import {
  createRuntimeExecutionLifecycle,
  makeDefaultSandboxRuntimeIOContract,
  type GovernedRuntimeAdapterId,
  type GovernedRuntimeInvocation,
} from "./governedRuntimeAdapterContract";
import {
  executeSandboxPatchDispatch,
  type SandboxPatchDispatchRequest,
} from "./sandboxPatchDispatch";

// =====================================================================================
// TEST FIXTURES
// =====================================================================================

const FIXED_TIME = "2026-05-22T12:00:00.000Z";
const EXPIRES_FUTURE = "2026-05-22T13:00:00.000Z";
const EXPIRES_PAST = "2026-05-22T11:00:00.000Z";
const REPO_ROOT = nodePath.resolve("E:/test-ai-e-exec0052c");
const SANDBOX_ID = "sandbox-exec0052c-test";

function key(absolutePath: string): string {
  return nodePath.normalize(absolutePath);
}

// In-memory filesystem shared between dispatch and adapter
type SharedInMemoryFs = SandboxPatchAdapterFilesystem & {
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
      if (c === undefined) return null;
      return c;
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
    approvedBy: "operator-exec0052c",
    approvedAt: FIXED_TIME,
    proposalId: proposalId ?? `proposal-exec0052c-${Math.random().toString(36).slice(2, 10)}`,
    operationRequest: "Apply sandbox patch mutation",
  };
}

function baseRequest(overrides?: Partial<SandboxPatchDispatchRequest>): SandboxPatchDispatchRequest {
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createSandboxPatchRuntimeAdapter(sharedFs);
  return {
    approvalToken: "operator-approved",
    authorization: makeApproval(),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operatorId: "operator-exec0052c",
    operationRequest: "Apply sandbox patch mutation",
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
    invocationId: "invocation-20260522120000",
    dispatchId: "dispatch-20260522120000-exec0052c",
    sandboxId: SANDBOX_ID,
    operatorId: "operator-exec0052c",
    runtimeId: SANDBOX_PATCH_ADAPTER_ID,
    approvalReference: "proposal-exec0052c-test",
    approval: makeApproval(),
    operationRequest: "Apply sandbox patch mutation",
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

test("createSandboxPatchRuntimeAdapter satisfies GovernedRuntimeAdapter interface", () => {
  const adapter = createSandboxPatchRuntimeAdapter();
  assert.equal(typeof adapter.adapterId, "string");
  assert.equal(typeof adapter.runtimeType, "string");
  assert.equal(typeof adapter.adapterVersion, "string");
  assert.equal(typeof adapter.invoke, "function");
  assert.equal(adapter.adapterId, SANDBOX_PATCH_ADAPTER_ID);
  assert.equal(adapter.adapterVersion, SANDBOX_PATCH_ADAPTER_VERSION);
  assert.equal(adapter.runtimeType, "openclaw");
  assert.equal(adapter.capability.requiresSandbox, true);
  assert.equal(adapter.capability.requiresApproval, true);
  assert.equal(adapter.capability.shellExecutionEnabled, false);
  assert.equal(adapter.capability.networkExecutionEnabled, false);
  assert.equal(adapter.capability.productionMutationEnabled, false);
});

test("adapter invoke() rejects when ioContract.workspaceWriteAllowed=false", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxPatchRuntimeAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const invocation = makeInvocation(workspaceRoot, {
    ioContract: makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: false }),
  });
  const result = await adapter.invoke(invocation);
  assert.equal(result.outcome, "rejected");
  assert.ok(result.failure?.category === "operation_rejected_by_adapter");
  assert.ok(fs.files.size === 0, "no files written on IO rejection");
});

test("adapter invoke() creates sandboxPatch.ts on first invocation (file absent)", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxPatchRuntimeAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const invocation = makeInvocation(workspaceRoot);
  const result = await adapter.invoke(invocation);
  assert.equal(result.outcome, "completed");
  const written = [...fs.files.entries()].find(([p]) => p.includes(SANDBOX_PATCH_FILE_NAME));
  assert.ok(written, "sandboxPatch.ts was written");
  assert.ok(written[1].includes("patchVersion = 1"), "initial patchVersion = 1");
});

test("adapter invoke() increments patchVersion on second invocation", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxPatchRuntimeAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const invocation = makeInvocation(workspaceRoot);
  // First invocation — creates file
  await adapter.invoke(invocation);
  // Second invocation — increments
  const result2 = await adapter.invoke(invocation);
  assert.equal(result2.outcome, "completed");
  const written = [...fs.files.entries()].find(([p]) => p.includes(SANDBOX_PATCH_FILE_NAME));
  assert.ok(written?.[1].includes("patchVersion = 2"), "patchVersion incremented to 2");
  assert.ok(result2.outputCapture.stdout.includes("=== BEFORE ==="), "stdout has before section");
  assert.ok(result2.outputCapture.stdout.includes("=== AFTER ==="), "stdout has after section");
  assert.ok(result2.outputCapture.stdout.includes("1 → 2"), "mutation description shows increment");
});

test("adapter invoke() lifecycle includes all expected states on success", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxPatchRuntimeAdapter(fs);
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
  const adapter = createSandboxPatchRuntimeAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const result = await adapter.invoke(makeInvocation(workspaceRoot));
  assert.equal(result.safetyBoundary.sandboxScoped, true);
  assert.equal(result.safetyBoundary.approvalRequired, true);
  assert.equal(result.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(result.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(result.safetyBoundary.productionWorkspaceMutationEnabled, false);
  assert.equal(result.safetyBoundary.humanAuthorityFinal, true);
});

test("buildInitialPatchFileContent contains patchVersion and sandboxId", () => {
  const content = buildInitialPatchFileContent("sandbox-test-123");
  assert.ok(content.includes("patchVersion = 1"), "has patchVersion = 1");
  assert.ok(content.includes("sandbox-test-123"), "has sandboxId");
  assert.ok(content.includes("EXEC-0052-C"), "has version marker");
});

test("applyPatchMutation increments version correctly", () => {
  const input = buildInitialPatchFileContent("sandbox-test");
  const { next, prevVersion, nextVersion } = applyPatchMutation(input);
  assert.equal(prevVersion, 1);
  assert.equal(nextVersion, 2);
  assert.ok(next.includes("patchVersion = 2"), "next content has incremented version");
  assert.ok(!next.includes("patchVersion = 1"), "old version not present");
});

test("applyPatchMutation throws if patchVersion constant is absent", () => {
  assert.throws(() => applyPatchMutation("export const foo = 42;\n"), /patchVersion/);
});

// =====================================================================================
// DISPATCH ORCHESTRATOR TESTS
// =====================================================================================

test("executeSandboxPatchDispatch fails with expired authorization", async () => {
  resetReplay();
  const result = await executeSandboxPatchDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(result.outcome, "rejected");
  assert.ok(result.error?.includes("authorization denied") || result.error?.includes("expired"), "error mentions denial");
  assert.equal(result.rollbackContract.rollbackReady, false);
});

test("executeSandboxPatchDispatch fails on replay (second dispatch with same approval)", async () => {
  resetReplay();
  const approval = makeApproval("proposal-replay-test-0052c");
  await executeSandboxPatchDispatch(baseRequest({ authorization: approval }));
  const result2 = await executeSandboxPatchDispatch(baseRequest({ authorization: approval }));
  assert.equal(result2.outcome, "rejected");
  assert.ok(result2.error?.toLowerCase().includes("authorization denied") ||
    result2.error?.toLowerCase().includes("replay"), "replay rejected");
});

test("executeSandboxPatchDispatch rejects wrong approvalToken", async () => {
  resetReplay();
  await assert.rejects(
    () => executeSandboxPatchDispatch(baseRequest({ approvalToken: "wrong-token" })),
    /rejected/,
  );
});

test("executeSandboxPatchDispatch succeeds with valid fresh authorization", async () => {
  resetReplay();
  const result = await executeSandboxPatchDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.equal(result.manifestVersion, "EXEC-0052-C");
});

test("executeSandboxPatchDispatch creates sandboxPatch.ts (before=0, after=1)", async () => {
  resetReplay();
  const result = await executeSandboxPatchDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.equal(result.beforeSnapshotFileCount, 0);
  assert.equal(result.afterSnapshotFileCount, 1);
  assert.ok(result.diffEntries.some((e) => e.changeKind === "created"), "diff shows file created");
});

test("executeSandboxPatchDispatch patchFilePath contains SANDBOX_PATCH_FILE_NAME", async () => {
  resetReplay();
  const result = await executeSandboxPatchDispatch(baseRequest());
  assert.ok(result.patchFilePath.includes(SANDBOX_PATCH_FILE_NAME), "patchFilePath contains sandboxPatch.ts");
});

test("executeSandboxPatchDispatch generates receipt on success", async () => {
  resetReplay();
  const result = await executeSandboxPatchDispatch(baseRequest());
  assert.ok(result.receiptId.length > 0, "receiptId is non-empty");
  assert.ok(result.receiptSandboxPath.length > 0, "receiptSandboxPath is non-empty");
});

test("executeSandboxPatchDispatch rollback contract ready=true on success", async () => {
  resetReplay();
  const result = await executeSandboxPatchDispatch(baseRequest());
  assert.equal(result.rollbackContract.rollbackReady, true);
  assert.ok(result.rollbackContract.rollbackMetadata.diffSummary.includes("created"), "diff summary mentions created");
});

test("executeSandboxPatchDispatch rollback contract ready=false on auth failure", async () => {
  resetReplay();
  const result = await executeSandboxPatchDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(result.rollbackContract.rollbackReady, false);
});

test("executeSandboxPatchDispatch lifecycle on success includes all expected states", async () => {
  resetReplay();
  const result = await executeSandboxPatchDispatch(baseRequest());
  const states = result.lifecycle.records.map((r) => r.state);
  assert.ok(states.includes("queued"), "has queued");
  assert.ok(states.includes("authorization_verified"), "has authorization_verified");
  assert.ok(states.includes("dispatching"), "has dispatching");
  assert.ok(states.includes("running"), "has running");
  assert.ok(states.includes("completed"), "has completed");
  assert.equal(result.lifecycle.currentState, "completed");
});

test("executeSandboxPatchDispatch lifecycle shows rejected on auth failure", async () => {
  resetReplay();
  const result = await executeSandboxPatchDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(result.lifecycle.currentState, "rejected");
});

test("executeSandboxPatchDispatch output capture has before/after stdout content", async () => {
  resetReplay();
  const result = await executeSandboxPatchDispatch(baseRequest());
  assert.ok(result.outputCapture.stdout.includes("=== BEFORE ==="), "stdout has BEFORE section");
  assert.ok(result.outputCapture.stdout.includes("=== AFTER ==="), "stdout has AFTER section");
  assert.ok(result.outputCapture.stdout.includes("patchVersion"), "stdout has patchVersion");
});

test("executeSandboxPatchDispatch dispatch record maps all required fields", async () => {
  resetReplay();
  const result = await executeSandboxPatchDispatch(baseRequest());
  const dr = result.dispatchRecord;
  assert.ok(dr.recordId.length > 0, "recordId present");
  assert.equal(dr.outcome, "completed");
  assert.equal(dr.runtimeType, "openclaw");
  assert.equal(dr.adapterVersion, SANDBOX_PATCH_ADAPTER_VERSION);
  assert.equal(dr.safetyBoundary.humanAuthorityFinal, true);
});

test("executeSandboxPatchDispatch runtimeType is openclaw", async () => {
  resetReplay();
  const result = await executeSandboxPatchDispatch(baseRequest());
  assert.equal(result.runtimeType, "openclaw");
  assert.equal(result.adapterId, SANDBOX_PATCH_ADAPTER_ID);
});

test("executeSandboxPatchDispatch times out via slow adapter", async () => {
  resetReplay();
  const slowAdapter = {
    ...createSandboxPatchRuntimeAdapter(),
    invoke: () => new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Sandbox patch dispatch timed out after 1000ms")), 1100);
    }),
  };
  const result = await executeSandboxPatchDispatch(baseRequest({ adapter: slowAdapter, timeoutMs: 1000 }));
  assert.equal(result.outcome, "timeout");
  assert.ok(result.error?.includes("timed out"), "error mentions timeout");
}, { timeout: 5000 });

test("executeSandboxPatchDispatch second dispatch with same sandbox increments patchVersion (modified)", async () => {
  resetReplay();
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createSandboxPatchRuntimeAdapter(sharedFs);

  const result1 = await executeSandboxPatchDispatch({
    approvalToken: "operator-approved",
    authorization: makeApproval("proposal-incr-1"),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    now: () => FIXED_TIME,
    filesystem: sharedFs,
    adapter,
  });
  assert.equal(result1.outcome, "completed");
  assert.equal(result1.afterSnapshotFileCount, 1);

  const FIXED_TIME_2 = "2026-05-22T12:00:01.000Z";
  // Second dispatch — same sandbox, same adapter, different approval + slightly later time
  const result2 = await executeSandboxPatchDispatch({
    approvalToken: "operator-approved",
    authorization: makeApproval("proposal-incr-2"),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    now: () => FIXED_TIME_2,
    filesystem: sharedFs,
    adapter,
  });
  assert.equal(result2.outcome, "completed");
  assert.equal(result2.afterSnapshotFileCount, 1);
  assert.ok(
    result2.diffEntries.some((e) => e.changeKind === "modified"),
    "second dispatch shows file as modified (patchVersion incremented)",
  );
  assert.ok(result2.outputCapture.stdout.includes("patchVersion = 1"), "BEFORE shows v1");
  assert.ok(result2.outputCapture.stdout.includes("patchVersion = 2"), "AFTER shows v2");
});
