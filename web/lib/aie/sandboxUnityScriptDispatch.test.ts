import assert from "node:assert/strict";
import * as nodePath from "node:path";
import test from "node:test";

import { dispatchReplayMap } from "./dispatchAuthorizationBoundary";
import type { SandboxSnapshotDirectoryEntry } from "./sandboxSnapshotLifecycle";
import {
  SANDBOX_UNITY_SCRIPT_ADAPTER_ID,
  SANDBOX_UNITY_SCRIPT_ADAPTER_VERSION,
  SANDBOX_UNITY_SCRIPT_FILE_NAME,
  UNITY_SCRIPT_DEFAULTS,
  applyUnityScriptMutation,
  buildInitialUnityScriptContent,
  createSandboxUnityScriptAdapter,
  type SandboxUnityScriptFilesystem,
} from "./sandboxUnityScriptAdapter";
import {
  makeDefaultSandboxRuntimeIOContract,
  type GovernedRuntimeAdapterId,
  type GovernedRuntimeInvocation,
} from "./governedRuntimeAdapterContract";
import {
  executeSandboxUnityScriptDispatch,
  type SandboxUnityScriptDispatchRequest,
} from "./sandboxUnityScriptDispatch";

// =====================================================================================
// TEST FIXTURES
// =====================================================================================

const FIXED_TIME = "2026-05-22T14:00:00.000Z";
const EXPIRES_FUTURE = "2026-05-22T15:00:00.000Z";
const EXPIRES_PAST = "2026-05-22T13:00:00.000Z";
const REPO_ROOT = nodePath.resolve("E:/test-ai-e-exec0052e-unity");
const SANDBOX_ID = "sandbox-exec0052e-unity-test";

function key(absolutePath: string): string {
  return nodePath.normalize(absolutePath);
}

type SharedInMemoryFs = SandboxUnityScriptFilesystem & {
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
    approvedBy: "operator-exec0052e-unity",
    approvedAt: FIXED_TIME,
    proposalId: proposalId ?? `proposal-exec0052e-unity-${Math.random().toString(36).slice(2, 10)}`,
    operationRequest: "apply Unity script movement speed mutation",
  };
}

function baseRequest(overrides?: Partial<SandboxUnityScriptDispatchRequest>): SandboxUnityScriptDispatchRequest {
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createSandboxUnityScriptAdapter(sharedFs);
  return {
    approvalToken: "operator-approved",
    authorization: makeApproval(),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operatorId: "operator-exec0052e-unity",
    operationRequest: "apply Unity script movement speed mutation",
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
    dispatchId: "dispatch-20260522140000-exec0052e",
    sandboxId: SANDBOX_ID,
    operatorId: "operator-exec0052e-unity",
    runtimeId: SANDBOX_UNITY_SCRIPT_ADAPTER_ID,
    approvalReference: "proposal-exec0052e-unity-test",
    approval: makeApproval(),
    operationRequest: "apply Unity script movement speed mutation",
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

test("createSandboxUnityScriptAdapter satisfies GovernedRuntimeAdapter interface", () => {
  const adapter = createSandboxUnityScriptAdapter();
  assert.equal(typeof adapter.adapterId, "string");
  assert.equal(typeof adapter.runtimeType, "string");
  assert.equal(typeof adapter.adapterVersion, "string");
  assert.equal(typeof adapter.invoke, "function");
  assert.equal(adapter.adapterId, SANDBOX_UNITY_SCRIPT_ADAPTER_ID);
  assert.equal(adapter.adapterVersion, SANDBOX_UNITY_SCRIPT_ADAPTER_VERSION);
  assert.equal(adapter.runtimeType, "openclaw");
  assert.equal(adapter.capability.requiresSandbox, true);
  assert.equal(adapter.capability.requiresApproval, true);
  assert.equal(adapter.capability.shellExecutionEnabled, false);
  assert.equal(adapter.capability.networkExecutionEnabled, false);
  assert.equal(adapter.capability.productionMutationEnabled, false);
});

test("adapter invoke() rejects when ioContract.workspaceWriteAllowed=false", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxUnityScriptAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const invocation = makeInvocation(workspaceRoot, {
    ioContract: makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: false }),
  });
  const result = await adapter.invoke(invocation);
  assert.equal(result.outcome, "rejected");
  assert.equal(result.failure?.category, "operation_rejected_by_adapter");
  assert.equal(fs.files.size, 0, "no files written on IO rejection");
});

test("adapter invoke() creates sandboxPlayerMovement.cs on first invocation with defaults", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxUnityScriptAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const result = await adapter.invoke(makeInvocation(workspaceRoot));
  assert.equal(result.outcome, "completed");
  const written = [...fs.files.entries()].find(([p]) => p.includes(SANDBOX_UNITY_SCRIPT_FILE_NAME));
  assert.ok(written, "sandboxPlayerMovement.cs was written");
  assert.ok(written[1].includes(`public float movementSpeed = ${UNITY_SCRIPT_DEFAULTS.movementSpeed.toFixed(1)}f;`),
    "default movementSpeed is set");
  assert.ok(written[1].includes("SandboxPlayerMovement"), "class name present");
  assert.ok(written[1].includes("SANDBOX ONLY"), "sandbox-only notice in file");
  assert.ok(written[1].includes("patch version: 1"), "initial patch version is 1");
});

test("adapter invoke() increments movementSpeed by 0.5f on second invocation", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxUnityScriptAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  await adapter.invoke(makeInvocation(workspaceRoot));
  const result2 = await adapter.invoke(makeInvocation(workspaceRoot, {
    operationRequest: "apply second speed tuning",
  }));
  assert.equal(result2.outcome, "completed");
  const written = [...fs.files.entries()].find(([p]) => p.includes(SANDBOX_UNITY_SCRIPT_FILE_NAME));
  assert.ok(written?.[1].includes("movementSpeed = 5.5f"), "movementSpeed incremented to 5.5f");
  assert.ok(written?.[1].includes("patch version: 2"), "patch version incremented to 2");
});

test("adapter invoke() stdout has BEFORE, AFTER, MUTATION sections", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxUnityScriptAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const result = await adapter.invoke(makeInvocation(workspaceRoot));
  assert.ok(result.outputCapture.stdout.includes("=== BEFORE ==="), "stdout has BEFORE section");
  assert.ok(result.outputCapture.stdout.includes("=== AFTER ==="), "stdout has AFTER section");
  assert.ok(result.outputCapture.stdout.includes("=== MUTATION ==="), "stdout has MUTATION section");
  assert.ok(result.outputCapture.stdout.includes("movementSpeed"), "stdout mentions movementSpeed");
});

test("adapter invoke() lifecycle includes all expected states on success", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxUnityScriptAdapter(fs);
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
  const adapter = createSandboxUnityScriptAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const result = await adapter.invoke(makeInvocation(workspaceRoot));
  assert.equal(result.safetyBoundary.sandboxScoped, true);
  assert.equal(result.safetyBoundary.approvalRequired, true);
  assert.equal(result.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(result.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(result.safetyBoundary.productionWorkspaceMutationEnabled, false);
  assert.equal(result.safetyBoundary.humanAuthorityFinal, true);
});

test("buildInitialUnityScriptContent contains required C# class structure", () => {
  const content = buildInitialUnityScriptContent("test-sandbox-id");
  assert.ok(content.includes("using UnityEngine;"), "has UnityEngine import");
  assert.ok(content.includes("public class SandboxPlayerMovement : MonoBehaviour"), "has MonoBehaviour");
  assert.ok(content.includes("public float movementSpeed = 5.0f;"), "has movementSpeed default");
  assert.ok(content.includes("public float jumpForce = 8.0f;"), "has jumpForce default");
  assert.ok(content.includes("public float staminaCooldown = 1.5f;"), "has staminaCooldown default");
  assert.ok(content.includes("SANDBOX ONLY"), "has sandbox-only warning");
  assert.ok(content.includes("test-sandbox-id"), "has sandbox id embedded");
  assert.ok(content.includes("patch version: 1"), "has initial patch version");
});

test("applyUnityScriptMutation increments movementSpeed and patch version", () => {
  const content = buildInitialUnityScriptContent("test-sandbox");
  const result = applyUnityScriptMutation(content);
  assert.equal(result.prevMovementSpeed, 5.0);
  assert.equal(result.nextMovementSpeed, 5.5);
  assert.equal(result.prevPatchVersion, 1);
  assert.equal(result.nextPatchVersion, 2);
  assert.ok(result.next.includes("movementSpeed = 5.5f;"), "next has 5.5f");
  assert.ok(result.next.includes("patch version: 2"), "next has patch version 2");
});

test("applyUnityScriptMutation can be applied multiple times", () => {
  let content = buildInitialUnityScriptContent("test-sandbox");
  for (let i = 1; i <= 4; i++) {
    const result = applyUnityScriptMutation(content);
    content = result.next;
    assert.equal(result.nextMovementSpeed, Math.round((5.0 + i * 0.5) * 10) / 10,
      `step ${i} movementSpeed`);
    assert.equal(result.nextPatchVersion, i + 1, `step ${i} patch version`);
  }
  assert.ok(content.includes("movementSpeed = 7.0f;"), "after 4 mutations is 7.0f");
});

test("applyUnityScriptMutation throws on missing movementSpeed", () => {
  assert.throws(
    () => applyUnityScriptMutation("// no valid movementSpeed field\npublic class Foo {}"),
    /movementSpeed/,
  );
});

// =====================================================================================
// DISPATCH ORCHESTRATOR TESTS
// =====================================================================================

test("executeSandboxUnityScriptDispatch fails with expired authorization", async () => {
  resetReplay();
  const result = await executeSandboxUnityScriptDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(result.outcome, "rejected");
  assert.equal(result.rollbackContract.rollbackReady, false);
});

test("executeSandboxUnityScriptDispatch fails on replay (same approval used twice)", async () => {
  resetReplay();
  const approval = makeApproval("proposal-unity-replay-test");
  await executeSandboxUnityScriptDispatch(baseRequest({ authorization: approval }));
  const result2 = await executeSandboxUnityScriptDispatch(baseRequest({ authorization: approval }));
  assert.equal(result2.outcome, "rejected");
});

test("executeSandboxUnityScriptDispatch rejects wrong approvalToken", async () => {
  resetReplay();
  await assert.rejects(
    () => executeSandboxUnityScriptDispatch(baseRequest({ approvalToken: "wrong-token" })),
    /rejected/,
  );
});

test("executeSandboxUnityScriptDispatch succeeds with valid fresh authorization", async () => {
  resetReplay();
  const result = await executeSandboxUnityScriptDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.equal(result.manifestVersion, "EXEC-0052-E");
  assert.equal(result.runtimeType, "openclaw");
  assert.equal(result.adapterId, SANDBOX_UNITY_SCRIPT_ADAPTER_ID);
});

test("executeSandboxUnityScriptDispatch creates script file (before=0, after=1)", async () => {
  resetReplay();
  const result = await executeSandboxUnityScriptDispatch(baseRequest());
  assert.equal(result.beforeSnapshotFileCount, 0);
  assert.equal(result.afterSnapshotFileCount, 1);
  assert.ok(result.diffEntries.some((e) => e.changeKind === "created"), "diff shows file created");
});

test("executeSandboxUnityScriptDispatch scriptFilePath contains SANDBOX_UNITY_SCRIPT_FILE_NAME", async () => {
  resetReplay();
  const result = await executeSandboxUnityScriptDispatch(baseRequest());
  assert.ok(result.scriptFilePath.includes(SANDBOX_UNITY_SCRIPT_FILE_NAME),
    "scriptFilePath contains sandboxPlayerMovement.cs");
});

test("executeSandboxUnityScriptDispatch generates receipt on success", async () => {
  resetReplay();
  const result = await executeSandboxUnityScriptDispatch(baseRequest());
  assert.ok(result.receiptId.length > 0, "receiptId is non-empty");
  assert.ok(result.receiptSandboxPath.length > 0, "receiptSandboxPath is non-empty");
});

test("executeSandboxUnityScriptDispatch rollback ready=true on success, false on auth failure", async () => {
  resetReplay();
  const ok = await executeSandboxUnityScriptDispatch(baseRequest());
  assert.equal(ok.rollbackContract.rollbackReady, true);

  const fail = await executeSandboxUnityScriptDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(fail.rollbackContract.rollbackReady, false);
});

test("executeSandboxUnityScriptDispatch lifecycle shows completed on success, rejected on auth failure", async () => {
  resetReplay();
  const ok = await executeSandboxUnityScriptDispatch(baseRequest());
  assert.equal(ok.lifecycle.currentState, "completed");

  const fail = await executeSandboxUnityScriptDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(fail.lifecycle.currentState, "rejected");
});

test("executeSandboxUnityScriptDispatch output captures BEFORE/AFTER/MUTATION sections", async () => {
  resetReplay();
  const result = await executeSandboxUnityScriptDispatch(baseRequest());
  assert.ok(result.outputCapture.stdout.includes("=== BEFORE ==="), "has BEFORE section");
  assert.ok(result.outputCapture.stdout.includes("=== AFTER ==="), "has AFTER section");
  assert.ok(result.outputCapture.stdout.includes("=== MUTATION ==="), "has MUTATION section");
  assert.ok(result.outputCapture.stdout.includes("movementSpeed"), "stdout includes movementSpeed");
});

test("executeSandboxUnityScriptDispatch dispatch record maps all required fields", async () => {
  resetReplay();
  const result = await executeSandboxUnityScriptDispatch(baseRequest());
  const dr = result.dispatchRecord;
  assert.ok(dr.recordId.length > 0, "recordId present");
  assert.equal(dr.outcome, "completed");
  assert.equal(dr.runtimeType, "openclaw");
  assert.equal(dr.adapterVersion, SANDBOX_UNITY_SCRIPT_ADAPTER_VERSION);
  assert.equal(dr.safetyBoundary.humanAuthorityFinal, true);
  assert.equal(dr.safetyBoundary.shellExecutionEnabled, false);
});

test("executeSandboxUnityScriptDispatch times out via slow adapter", async () => {
  resetReplay();
  const slowAdapter = {
    ...createSandboxUnityScriptAdapter(),
    invoke: () => new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Sandbox Unity script dispatch timed out after 1000ms")), 1100);
    }),
  };
  const result = await executeSandboxUnityScriptDispatch(baseRequest({ adapter: slowAdapter, timeoutMs: 1000 }));
  assert.equal(result.outcome, "timeout");
  assert.ok(result.error?.includes("timed out"), "error mentions timeout");
}, { timeout: 5000 });

test("executeSandboxUnityScriptDispatch second dispatch applies second mutation (modified diff)", async () => {
  resetReplay();
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createSandboxUnityScriptAdapter(sharedFs);

  await executeSandboxUnityScriptDispatch({
    approvalToken: "operator-approved",
    authorization: makeApproval("proposal-unity-tuning-1"),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operationRequest: "apply first speed tuning",
    now: () => FIXED_TIME,
    filesystem: sharedFs,
    adapter,
  });

  const result2 = await executeSandboxUnityScriptDispatch({
    approvalToken: "operator-approved",
    authorization: makeApproval("proposal-unity-tuning-2"),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operationRequest: "apply second speed tuning",
    now: () => "2026-05-22T14:00:01.000Z",
    filesystem: sharedFs,
    adapter,
  });

  assert.equal(result2.outcome, "completed");
  assert.ok(
    result2.diffEntries.some((e) => e.changeKind === "modified"),
    "second dispatch shows file as modified",
  );
  assert.ok(result2.outputCapture.stdout.includes("apply second speed tuning"), "stdout includes second operation request");
});

test("executeSandboxUnityScriptDispatch spec example: default script tuned correctly", async () => {
  resetReplay();
  const sharedFs = makeSharedInMemoryFs();
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");

  // Pre-seed with initial content (as if first run already happened)
  await sharedFs.createDirectory(workspaceRoot);
  const seedContent = buildInitialUnityScriptContent(SANDBOX_ID);
  const seedPath = key(nodePath.join(workspaceRoot, SANDBOX_UNITY_SCRIPT_FILE_NAME));
  sharedFs.files.set(seedPath, seedContent);

  const adapter = createSandboxUnityScriptAdapter(sharedFs);
  await executeSandboxUnityScriptDispatch({
    approvalToken: "operator-approved",
    authorization: makeApproval("proposal-unity-spec-example"),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operationRequest: "apply movement speed tuning",
    now: () => FIXED_TIME,
    filesystem: sharedFs,
    adapter,
  });

  const afterContent = sharedFs.files.get(seedPath) ?? "";
  assert.ok(afterContent.includes("movementSpeed = 5.5f;"), "movementSpeed is 5.5f after first mutation");
  assert.ok(afterContent.includes("patch version: 2"), "patch version is 2 after first mutation");
});
