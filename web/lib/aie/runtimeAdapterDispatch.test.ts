import assert from "node:assert/strict";
import * as nodePath from "node:path";
import test from "node:test";

import { dispatchReplayMap } from "./dispatchAuthorizationBoundary";
import type { SandboxSnapshotDirectoryEntry } from "./sandboxSnapshotLifecycle";
import {
  BOUNDED_LOCAL_ADAPTER_ID,
  BOUNDED_LOCAL_ADAPTER_VERSION,
  RUNTIME_PROOF_FILE_NAME,
  buildRuntimeProofContent,
  createBoundedLocalRuntimeAdapter,
  type BoundedLocalAdapterFilesystem,
} from "./boundedLocalRuntimeAdapter";
import {
  createRuntimeExecutionLifecycle,
  makeDefaultSandboxRuntimeIOContract,
  type GovernedRuntimeAdapterId,
  type GovernedRuntimeInvocation,
} from "./governedRuntimeAdapterContract";
import {
  executeRuntimeAdapterDispatch,
  type RuntimeAdapterDispatchRequest,
} from "./runtimeAdapterDispatch";

// =====================================================================================
// TEST FIXTURES
// =====================================================================================

const FIXED_TIME = "2026-05-22T10:00:00.000Z";
const EXPIRES_FUTURE = "2026-05-22T11:00:00.000Z";
const EXPIRES_PAST = "2026-05-22T09:00:00.000Z";
const REPO_ROOT = nodePath.resolve("E:/test-ai-e-exec0052b");
const SANDBOX_ID = "sandbox-exec0052b-test";

function key(absolutePath: string): string {
  return nodePath.normalize(absolutePath);
}

// In-memory filesystem shared between dispatch and adapter
type SharedInMemoryFs = BoundedLocalAdapterFilesystem & {
  readFile: (p: string) => Promise<string>;
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
        entries.push({ name: nodePath.basename(fp), kind: "file", sizeBytes: Buffer.byteLength(files.get(fp) ?? ""), modifiedAt: FIXED_TIME });
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
      if (c === undefined) { const e = Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" }); throw e; }
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
    authorityToken: "operator-approved" as any,
    approvedBy: "operator-exec0052b",
    approvedAt: FIXED_TIME,
    proposalId: proposalId ?? `proposal-exec0052b-${Math.random().toString(36).slice(2, 10)}`,
    operationRequest: "Invoke bounded local runtime adapter",
  };
}

function baseRequest(overrides?: Partial<RuntimeAdapterDispatchRequest>): RuntimeAdapterDispatchRequest {
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createBoundedLocalRuntimeAdapter(sharedFs);
  return {
    approvalToken: "operator-approved",
    authorization: makeApproval(),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operatorId: "operator-exec0052b",
    operationRequest: "Invoke bounded local runtime adapter",
    now: () => FIXED_TIME,
    filesystem: sharedFs,
    adapter,
    ...overrides,
  };
}

function resetReplay() {
  dispatchReplayMap.clear();
}

// =====================================================================================
// ADAPTER UNIT TESTS (invoke() directly)
// =====================================================================================

test("createBoundedLocalRuntimeAdapter satisfies GovernedRuntimeAdapter interface", () => {
  const adapter = createBoundedLocalRuntimeAdapter();
  assert.equal(typeof adapter.adapterId, "string");
  assert.equal(typeof adapter.runtimeType, "string");
  assert.equal(typeof adapter.adapterVersion, "string");
  assert.equal(typeof adapter.invoke, "function");
  assert.equal(adapter.capability.requiresSandbox, true);
  assert.equal(adapter.capability.requiresApproval, true);
  assert.equal(adapter.capability.shellExecutionEnabled, false);
  assert.equal(adapter.capability.networkExecutionEnabled, false);
  assert.equal(adapter.capability.productionMutationEnabled, false);
  assert.equal(adapter.adapterId, BOUNDED_LOCAL_ADAPTER_ID);
  assert.equal(adapter.adapterVersion, BOUNDED_LOCAL_ADAPTER_VERSION);
  assert.equal(adapter.runtimeType, "openclaw");
});

test("adapter invoke() rejects when ioContract.workspaceWriteAllowed=false", async () => {
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createBoundedLocalRuntimeAdapter(sharedFs);
  const ioContract = makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: false });
  const invocation: GovernedRuntimeInvocation = {
    invocationId: "invocation-test-reject",
    dispatchId: "dispatch-test",
    sandboxId: SANDBOX_ID,
    operatorId: "operator-test",
    runtimeId: BOUNDED_LOCAL_ADAPTER_ID,
    approvalReference: "proposal-test",
    approval: makeApproval(),
    operationRequest: "test operation",
    workspaceRoot: nodePath.join(REPO_ROOT, ".ai-e", "sandboxes", SANDBOX_ID, "workspace"),
    timeoutMs: 10000,
    ioContract,
    requestedAt: FIXED_TIME,
  };
  const result = await adapter.invoke(invocation);
  assert.equal(result.outcome, "rejected");
  assert.equal(result.failure?.category, "operation_rejected_by_adapter");
});

test("adapter invoke() writes AI_E_RUNTIME_PROOF.txt to workspace", async () => {
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createBoundedLocalRuntimeAdapter(sharedFs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e", "sandboxes", SANDBOX_ID, "workspace");
  const ioContract = makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: true });
  const invocation: GovernedRuntimeInvocation = {
    invocationId: "invocation-proof-write-test",
    dispatchId: "dispatch-proof-write",
    sandboxId: SANDBOX_ID,
    operatorId: "operator-test",
    runtimeId: BOUNDED_LOCAL_ADAPTER_ID,
    approvalReference: "proposal-proof-write",
    approval: makeApproval(),
    operationRequest: "Write runtime proof file",
    workspaceRoot,
    timeoutMs: 10000,
    ioContract,
    requestedAt: FIXED_TIME,
  };
  const result = await adapter.invoke(invocation);
  assert.equal(result.outcome, "completed");

  const writtenFiles = [...sharedFs.files.keys()].filter((p) => p.includes(RUNTIME_PROOF_FILE_NAME));
  assert.ok(writtenFiles.length > 0, "Expected proof file in in-memory filesystem");
});

test("adapter invoke() proof file content contains all required fields", async () => {
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createBoundedLocalRuntimeAdapter(sharedFs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e", "sandboxes", SANDBOX_ID, "workspace");
  const ioContract = makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: true });
  const invocation: GovernedRuntimeInvocation = {
    invocationId: "invocation-proof-content-test",
    dispatchId: "dispatch-proof-content",
    sandboxId: SANDBOX_ID,
    operatorId: "operator-exec0052b",
    runtimeId: BOUNDED_LOCAL_ADAPTER_ID,
    approvalReference: "proposal-content-test",
    approval: makeApproval(),
    operationRequest: "Write runtime proof file",
    workspaceRoot,
    timeoutMs: 10000,
    ioContract,
    requestedAt: FIXED_TIME,
  };
  await adapter.invoke(invocation);

  const proofPath = [...sharedFs.files.keys()].find((p) => p.includes(RUNTIME_PROOF_FILE_NAME));
  const content = proofPath ? sharedFs.files.get(proofPath) ?? "" : "";

  assert.ok(content.includes("AI-E RUNTIME PROOF"), "Missing header");
  assert.ok(content.includes("Runtime ID:"), "Missing Runtime ID");
  assert.ok(content.includes("Runtime Type:"), "Missing Runtime Type");
  assert.ok(content.includes("Adapter Version:"), "Missing Adapter Version");
  assert.ok(content.includes("Invocation ID:"), "Missing Invocation ID");
  assert.ok(content.includes("Dispatch ID:"), "Missing Dispatch ID");
  assert.ok(content.includes("Sandbox ID:"), "Missing Sandbox ID");
  assert.ok(content.includes("Operator ID:"), "Missing Operator ID");
  assert.ok(content.includes("Approval Reference:"), "Missing Approval Reference");
  assert.ok(content.includes("Executed At:"), "Missing Executed At");
  assert.ok(content.includes("EXEC-0052-B"), "Missing EXEC-0052-B marker");
});

test("adapter invoke() lifecycle includes all expected states on success", async () => {
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createBoundedLocalRuntimeAdapter(sharedFs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e", "sandboxes", SANDBOX_ID, "workspace");
  const ioContract = makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: true });
  const invocation: GovernedRuntimeInvocation = {
    invocationId: "invocation-lifecycle-test",
    dispatchId: "dispatch-lifecycle",
    sandboxId: SANDBOX_ID,
    operatorId: "operator-test",
    runtimeId: BOUNDED_LOCAL_ADAPTER_ID,
    approvalReference: "proposal-lifecycle",
    approval: makeApproval(),
    operationRequest: "Write runtime proof file",
    workspaceRoot,
    timeoutMs: 10000,
    ioContract,
    requestedAt: FIXED_TIME,
  };
  const result = await adapter.invoke(invocation);
  assert.equal(result.outcome, "completed");
  const states = result.lifecycle.records.map((r) => r.state);
  assert.ok(states.includes("queued"), "Missing queued");
  assert.ok(states.includes("authorization_verified"), "Missing authorization_verified");
  assert.ok(states.includes("dispatching"), "Missing dispatching");
  assert.ok(states.includes("running"), "Missing running");
  assert.ok(states.includes("completed"), "Missing completed");
  assert.equal(result.lifecycle.currentState, "completed");
});

test("adapter invoke() safetyBoundary flags are all correct", async () => {
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createBoundedLocalRuntimeAdapter(sharedFs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e", "sandboxes", SANDBOX_ID, "workspace");
  const ioContract = makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: true });
  const invocation: GovernedRuntimeInvocation = {
    invocationId: "invocation-safety-test",
    dispatchId: "dispatch-safety",
    sandboxId: SANDBOX_ID,
    operatorId: "operator-test",
    runtimeId: BOUNDED_LOCAL_ADAPTER_ID,
    approvalReference: "proposal-safety",
    approval: makeApproval(),
    operationRequest: "safety boundary test",
    workspaceRoot,
    timeoutMs: 10000,
    ioContract,
    requestedAt: FIXED_TIME,
  };
  const result = await adapter.invoke(invocation);
  assert.equal(result.safetyBoundary.sandboxScoped, true);
  assert.equal(result.safetyBoundary.approvalRequired, true);
  assert.equal(result.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(result.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(result.safetyBoundary.productionWorkspaceMutationEnabled, false);
  assert.equal(result.safetyBoundary.automaticContinuationEnabled, false);
  assert.equal(result.safetyBoundary.humanAuthorityFinal, true);
});

test("buildRuntimeProofContent includes all mandatory fields", () => {
  const content = buildRuntimeProofContent({
    invocationId: "invocation-20260522100000",
    dispatchId: "dispatch-20260522100000-exec0052b",
    sandboxId: SANDBOX_ID,
    operatorId: "operator-test",
    approvalReference: "proposal-content-check",
    operationRequest: "Write runtime proof file",
    workspaceRoot: "/test/workspace",
    timestamp: FIXED_TIME,
  });
  assert.ok(content.includes("AI-E RUNTIME PROOF"), "Missing header");
  assert.ok(content.includes(BOUNDED_LOCAL_ADAPTER_ID), "Missing adapter ID");
  assert.ok(content.includes(BOUNDED_LOCAL_ADAPTER_VERSION), "Missing adapter version");
  assert.ok(content.includes(SANDBOX_ID), "Missing sandbox ID");
  assert.ok(content.includes("EXEC-0052-B"), "Missing EXEC-0052-B marker");
  assert.ok(content.includes("Shell: DISABLED"), "Missing shell disabled note");
  assert.ok(content.includes("Network: DISABLED"), "Missing network disabled note");
});

// =====================================================================================
// DISPATCH ORCHESTRATOR TESTS (executeRuntimeAdapterDispatch)
// =====================================================================================

test("executeRuntimeAdapterDispatch fails with expired authorization", async () => {
  resetReplay();
  const result = await executeRuntimeAdapterDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(result.outcome, "rejected");
  assert.ok(result.error?.includes("denied"), `Expected denied error, got: ${result.error}`);
  assert.equal(result.authorizationReceipt.result.authorized, false);
  assert.equal(result.authorizationReceipt.result.reason, "approval-expired");
  assert.equal(result.receiptId, "");
  assert.equal(result.rollbackContract.rollbackReady, false);
});

test("executeRuntimeAdapterDispatch fails on replay (second dispatch with same approval)", async () => {
  resetReplay();
  const approval = makeApproval("proposal-replay-exec0052b");
  const sharedFs1 = makeSharedInMemoryFs();
  const first = await executeRuntimeAdapterDispatch(baseRequest({
    authorization: approval,
    filesystem: sharedFs1,
    adapter: createBoundedLocalRuntimeAdapter(sharedFs1),
  }));
  assert.equal(first.outcome, "completed", "First dispatch should complete");

  const sharedFs2 = makeSharedInMemoryFs();
  const second = await executeRuntimeAdapterDispatch(baseRequest({
    authorization: approval,
    filesystem: sharedFs2,
    adapter: createBoundedLocalRuntimeAdapter(sharedFs2),
  }));
  assert.equal(second.outcome, "rejected", "Second dispatch with same approval should be rejected");
  assert.equal(second.authorizationReceipt.replayGuard.replayed, true);
});

test("executeRuntimeAdapterDispatch succeeds with valid fresh authorization", async () => {
  resetReplay();
  const result = await executeRuntimeAdapterDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.equal(result.manifestVersion, "EXEC-0052-B");
  assert.equal(result.authorizationReceipt.result.authorized, true);
  assert.equal(result.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(result.safetyBoundary.productionWorkspaceMutationEnabled, false);
  assert.equal(result.safetyBoundary.humanAuthorityFinal, true);
});

test("executeRuntimeAdapterDispatch writes proof file to sandbox workspace (before=0, after=1)", async () => {
  resetReplay();
  const result = await executeRuntimeAdapterDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.equal(result.beforeSnapshotFileCount, 0, "Workspace should be empty before dispatch");
  assert.equal(result.afterSnapshotFileCount, 1, "Workspace should have 1 file after dispatch");
  assert.equal(result.diffEntries.length, 1);
  assert.equal(result.diffEntries[0]?.changeKind, "created");
  assert.ok(result.diffEntries[0]?.sandboxRelativePath.includes(RUNTIME_PROOF_FILE_NAME));
});

test("executeRuntimeAdapterDispatch proof file path matches RUNTIME_PROOF_FILE_NAME", async () => {
  resetReplay();
  const result = await executeRuntimeAdapterDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.equal(result.proofFilePath, RUNTIME_PROOF_FILE_NAME);
});

test("executeRuntimeAdapterDispatch generates receipt on success", async () => {
  resetReplay();
  const result = await executeRuntimeAdapterDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.ok(result.receiptId.startsWith("receipt-"), `Expected receipt- prefix, got: ${result.receiptId}`);
  assert.ok(result.receiptSandboxPath.includes(result.receiptId), "Receipt path should contain receipt ID");
});

test("executeRuntimeAdapterDispatch rollback contract ready=true on success", async () => {
  resetReplay();
  const result = await executeRuntimeAdapterDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.equal(result.rollbackContract.rollbackReady, true);
  assert.ok(result.rollbackContract.rollbackMetadata.changedFiles.length > 0);
  assert.ok(result.rollbackContract.rollbackMetadata.diffSummary.includes("created"));
  assert.equal(result.rollbackContract.verification.valid, true);
});

test("executeRuntimeAdapterDispatch rollback contract ready=false on auth failure", async () => {
  resetReplay();
  const result = await executeRuntimeAdapterDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(result.rollbackContract.rollbackReady, false);
  assert.equal(result.rollbackContract.verification.valid, false);
});

test("executeRuntimeAdapterDispatch lifecycle on success includes all expected states", async () => {
  resetReplay();
  const result = await executeRuntimeAdapterDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  const states = result.lifecycle.records.map((r) => r.state);
  assert.ok(states.includes("queued"), "Missing queued");
  assert.ok(states.includes("authorization_verified"), "Missing authorization_verified");
  assert.ok(states.includes("dispatching"), "Missing dispatching");
  assert.ok(states.includes("running"), "Missing running");
  assert.ok(states.includes("completed"), "Missing completed");
  assert.equal(result.lifecycle.currentState, "completed");
  assert.ok(result.lifecycle.completedAt !== undefined, "completedAt should be set");
});

test("executeRuntimeAdapterDispatch lifecycle shows rejected on auth failure", async () => {
  resetReplay();
  const result = await executeRuntimeAdapterDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(result.outcome, "rejected");
  assert.equal(result.lifecycle.currentState, "rejected");
  assert.ok(!result.lifecycle.records.some((r) => r.state === "completed"),
    "Should not reach completed state");
});

test("executeRuntimeAdapterDispatch output capture has stdout content from adapter", async () => {
  resetReplay();
  const result = await executeRuntimeAdapterDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.ok(result.outputCapture.stdout.length > 0, "stdout should have proof file content");
  assert.ok(result.outputCapture.stdout.includes("AI-E RUNTIME PROOF"), "stdout should contain proof header");
  assert.equal(result.outputCapture.stdoutTruncated, false);
});

test("executeRuntimeAdapterDispatch dispatch record maps all fields", async () => {
  resetReplay();
  const result = await executeRuntimeAdapterDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  const rec = result.dispatchRecord;
  assert.ok(rec.recordId.startsWith("record-"), `Expected record- prefix, got: ${rec.recordId}`);
  assert.equal(rec.dispatchId, result.dispatchId);
  assert.equal(rec.invocationId, result.invocationId);
  assert.equal(rec.sandboxId, SANDBOX_ID);
  assert.equal(rec.runtimeType, "openclaw");
  assert.equal(rec.adapterId, BOUNDED_LOCAL_ADAPTER_ID);
  assert.equal(rec.adapterVersion, BOUNDED_LOCAL_ADAPTER_VERSION);
  assert.equal(rec.outcome, "completed");
  assert.equal(rec.safetyBoundary.humanAuthorityFinal, true);
  assert.equal(rec.safetyBoundary.shellExecutionEnabled, false);
});

test("executeRuntimeAdapterDispatch rejects wrong approvalToken", async () => {
  resetReplay();
  await assert.rejects(
    () => executeRuntimeAdapterDispatch(baseRequest({ approvalToken: "wrong-token" })),
    /approvalToken must be/,
  );
});

test("executeRuntimeAdapterDispatch runtime adapter type is openclaw", async () => {
  resetReplay();
  const result = await executeRuntimeAdapterDispatch(baseRequest());
  assert.equal(result.runtimeType, "openclaw");
  assert.equal(result.adapterId, BOUNDED_LOCAL_ADAPTER_ID);
  assert.equal(result.adapterVersion, BOUNDED_LOCAL_ADAPTER_VERSION);
});

test("executeRuntimeAdapterDispatch times out via slow adapter", async () => {
  resetReplay();
  // Create a slow adapter that never resolves
  const slowAdapter = {
    adapterId: BOUNDED_LOCAL_ADAPTER_ID,
    runtimeType: "openclaw" as const,
    adapterVersion: BOUNDED_LOCAL_ADAPTER_VERSION,
    capability: createBoundedLocalRuntimeAdapter().capability,
    defaultTimeoutMs: 100,
    maxStdoutBytes: 65536,
    maxStderrBytes: 8192,
    invoke: () => new Promise<never>(() => undefined),
  };
  const sharedFs = makeSharedInMemoryFs();
  const result = await executeRuntimeAdapterDispatch(baseRequest({
    adapter: slowAdapter,
    filesystem: sharedFs,
    timeoutMs: 100,
  }));
  assert.equal(result.outcome, "timeout");
  assert.ok(result.error?.includes("timed out"), `Expected timeout error, got: ${result.error}`);
});
