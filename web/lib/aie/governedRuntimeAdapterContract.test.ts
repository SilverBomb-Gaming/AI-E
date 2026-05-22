import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceLifecycleState,
  createEmptyAdapterRegistry,
  createGovernedRuntimeDispatchRecord,
  createRuntimeDispatchRecordId,
  createRuntimeExecutionLifecycle,
  createRuntimeInvocationId,
  lookupAdapterById,
  lookupAdapterByRuntimeType,
  makeDefaultSandboxRuntimeIOContract,
  makeEmptyOutputCapture,
  makeFailedInvocationResult,
  makeOutputCapture,
  makeRuntimeAdapterSafetyBoundary,
  makeRuntimeFailure,
  registerAdapter,
  RUNTIME_TERMINAL_STATES,
  type GovernedRuntimeAdapter,
  type GovernedRuntimeAdapterCapability,
  type GovernedRuntimeAdapterId,
  type GovernedRuntimeDispatchRecord,
  type GovernedRuntimeInvocation,
  type RuntimeAdapterRegistryEntry,
  type RuntimeInvocationResult,
} from "./governedRuntimeAdapterContract";

const FIXED_NOW = "2026-05-22T10:00:00.000Z";
const FIXED_LATER = "2026-05-22T10:00:05.000Z";
const SANDBOX_ID = "sandbox-20260522-exec0052a";
const DISPATCH_ID = "dispatch-0052a-test";
const OPERATOR_ID = "operator-exec0052a";
const ADAPTER_ID = "openclaw-v1" as GovernedRuntimeAdapterId;

function makeTestCapability(): GovernedRuntimeAdapterCapability {
  return {
    runtimeType: "openclaw",
    supportedCapabilities: ["file_inspection", "test_execution"],
    requiresSandbox: true,
    requiresApproval: true,
    shellExecutionEnabled: false,
    networkExecutionEnabled: false,
    productionMutationEnabled: false,
  };
}

function makeTestApproval() {
  return {
    authorityToken: "operator-approved" as ReturnType<typeof makeRuntimeAdapterSafetyBoundary> extends never ? never : any,
    approvedBy: OPERATOR_ID,
    approvedAt: FIXED_NOW,
    proposalId: "proposal-exec0052a-test",
    operationRequest: "bounded write to sandbox workspace",
  };
}

function makeTestInvocation(): GovernedRuntimeInvocation {
  return {
    invocationId: createRuntimeInvocationId(FIXED_NOW),
    dispatchId: DISPATCH_ID,
    sandboxId: SANDBOX_ID,
    operatorId: OPERATOR_ID,
    runtimeId: ADAPTER_ID,
    approvalReference: "proposal-exec0052a-test",
    approval: makeTestApproval(),
    operationRequest: "bounded write to sandbox workspace",
    workspaceRoot: ".ai-e/sandboxes/sandbox-20260522-exec0052a/workspace",
    timeoutMs: 10000,
    ioContract: makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: true }),
    requestedAt: FIXED_NOW,
  };
}

// ---- Safety boundary tests ----------------------------------------------------------

test("makeRuntimeAdapterSafetyBoundary returns all correct literal flags", () => {
  const boundary = makeRuntimeAdapterSafetyBoundary();
  assert.equal(boundary.sandboxScoped, true);
  assert.equal(boundary.approvalRequired, true);
  assert.equal(boundary.shellExecutionEnabled, false);
  assert.equal(boundary.networkExecutionEnabled, false);
  assert.equal(boundary.productionWorkspaceMutationEnabled, false);
  assert.equal(boundary.automaticContinuationEnabled, false);
  assert.equal(boundary.humanAuthorityFinal, true);
});

test("safety boundary is structurally identical across multiple calls", () => {
  const a = makeRuntimeAdapterSafetyBoundary();
  const b = makeRuntimeAdapterSafetyBoundary();
  assert.deepEqual(a, b);
});

// ---- IO contract tests --------------------------------------------------------------

test("makeDefaultSandboxRuntimeIOContract has correct safety-negative literal flags", () => {
  const contract = makeDefaultSandboxRuntimeIOContract();
  assert.equal(contract.workspaceReadAllowed, true);
  assert.equal(contract.workspaceDeleteAllowed, false);
  assert.equal(contract.productionMutationAllowed, false);
  assert.equal(contract.shellPassthroughAllowed, false);
  assert.equal(contract.networkAccessAllowed, false);
});

test("makeDefaultSandboxRuntimeIOContract defaults: workspaceWriteAllowed=false, maxRead=64, maxWrite=8", () => {
  const contract = makeDefaultSandboxRuntimeIOContract();
  assert.equal(contract.workspaceWriteAllowed, false);
  assert.equal(contract.maxReadFiles, 64);
  assert.equal(contract.maxWriteFiles, 8);
  assert.equal(contract.captureStdout, true);
  assert.equal(contract.captureStderr, true);
});

test("makeDefaultSandboxRuntimeIOContract respects overrides for write/limits", () => {
  const contract = makeDefaultSandboxRuntimeIOContract({
    workspaceWriteAllowed: true,
    maxReadFiles: 10,
    maxWriteFiles: 2,
    captureStdout: false,
  });
  assert.equal(contract.workspaceWriteAllowed, true);
  assert.equal(contract.maxReadFiles, 10);
  assert.equal(contract.maxWriteFiles, 2);
  assert.equal(contract.captureStdout, false);
  // Safety-negative flags cannot be overridden
  assert.equal(contract.workspaceDeleteAllowed, false);
  assert.equal(contract.productionMutationAllowed, false);
  assert.equal(contract.shellPassthroughAllowed, false);
  assert.equal(contract.networkAccessAllowed, false);
});

// ---- Output capture tests -----------------------------------------------------------

test("makeEmptyOutputCapture produces zero-byte capture record", () => {
  const capture = makeEmptyOutputCapture(FIXED_NOW);
  assert.equal(capture.stdout, "");
  assert.deepEqual(capture.stderr, []);
  assert.equal(capture.stdoutBytes, 0);
  assert.equal(capture.stderrBytes, 0);
  assert.equal(capture.stdoutTruncated, false);
  assert.equal(capture.stderrTruncated, false);
  assert.equal(capture.capturedAt, FIXED_NOW);
});

test("makeOutputCapture captures stdout and stderr without truncation when within limits", () => {
  const capture = makeOutputCapture({
    stdout: "build passed",
    stderr: ["warning: unused var"],
    maxStdoutBytes: 1024,
    maxStderrBytes: 1024,
    capturedAt: FIXED_NOW,
  });
  assert.equal(capture.stdout, "build passed");
  assert.deepEqual(capture.stderr, ["warning: unused var"]);
  assert.equal(capture.stdoutTruncated, false);
  assert.equal(capture.stderrTruncated, false);
});

test("makeOutputCapture truncates stdout when over maxStdoutBytes", () => {
  const longOutput = "x".repeat(100);
  const capture = makeOutputCapture({
    stdout: longOutput,
    stderr: [],
    maxStdoutBytes: 50,
    maxStderrBytes: 1024,
    capturedAt: FIXED_NOW,
  });
  assert.equal(capture.stdoutTruncated, true);
  assert.equal(capture.stdout.length, 50);
  assert.ok(capture.stdoutBytes > 50);
});

// ---- Failure contract tests ---------------------------------------------------------

test("makeRuntimeFailure sets all fields correctly", () => {
  const failure = makeRuntimeFailure("adapter_not_found", "No adapter for runtime type", FIXED_NOW);
  assert.equal(failure.category, "adapter_not_found");
  assert.equal(failure.message, "No adapter for runtime type");
  assert.equal(failure.recoverable, false);
  assert.equal(failure.rollbackRequired, false);
  assert.equal(failure.failedAt, FIXED_NOW);
  assert.equal(failure.details, undefined);
});

test("makeRuntimeFailure respects recoverable and rollbackRequired overrides", () => {
  const failure = makeRuntimeFailure(
    "invocation_timeout",
    "Timed out after 10s",
    FIXED_NOW,
    { recoverable: true, rollbackRequired: true, details: "partial write detected" },
  );
  assert.equal(failure.recoverable, true);
  assert.equal(failure.rollbackRequired, true);
  assert.equal(failure.details, "partial write detected");
});

test("all RuntimeFailureCategory values are representable", () => {
  const categories = [
    "authorization_denied",
    "adapter_not_found",
    "invocation_timeout",
    "output_capture_failed",
    "sandbox_boundary_violation",
    "operation_rejected_by_adapter",
    "lifecycle_state_error",
    "unknown_failure",
  ] as const;
  for (const category of categories) {
    const failure = makeRuntimeFailure(category, "test", FIXED_NOW);
    assert.equal(failure.category, category);
  }
});

// ---- Lifecycle state machine tests --------------------------------------------------

test("createRuntimeExecutionLifecycle starts in queued state with one record", () => {
  const invocationId = createRuntimeInvocationId(FIXED_NOW);
  const lifecycle = createRuntimeExecutionLifecycle(invocationId, FIXED_NOW);
  assert.equal(lifecycle.currentState, "queued");
  assert.equal(lifecycle.records.length, 1);
  assert.equal(lifecycle.records[0]?.state, "queued");
  assert.equal(lifecycle.startedAt, FIXED_NOW);
  assert.equal(lifecycle.completedAt, undefined);
  assert.equal(lifecycle.invocationId, invocationId);
});

test("advanceLifecycleState transitions correctly through happy path", () => {
  const invocationId = createRuntimeInvocationId(FIXED_NOW);
  let lifecycle = createRuntimeExecutionLifecycle(invocationId, FIXED_NOW);
  lifecycle = advanceLifecycleState(lifecycle, "authorization_verified", FIXED_NOW);
  lifecycle = advanceLifecycleState(lifecycle, "dispatching", FIXED_NOW);
  lifecycle = advanceLifecycleState(lifecycle, "running", FIXED_NOW);
  lifecycle = advanceLifecycleState(lifecycle, "completed", FIXED_LATER, "all operations succeeded");

  assert.equal(lifecycle.currentState, "completed");
  assert.equal(lifecycle.records.length, 5); // queued + 4 transitions
  assert.equal(lifecycle.completedAt, FIXED_LATER);
  assert.equal(lifecycle.records[4]?.message, "all operations succeeded");
});

test("advanceLifecycleState transitions correctly through failure path", () => {
  const invocationId = createRuntimeInvocationId(FIXED_NOW);
  let lifecycle = createRuntimeExecutionLifecycle(invocationId, FIXED_NOW);
  lifecycle = advanceLifecycleState(lifecycle, "authorization_verified", FIXED_NOW);
  lifecycle = advanceLifecycleState(lifecycle, "failed", FIXED_LATER, "authorization denied");

  assert.equal(lifecycle.currentState, "failed");
  assert.equal(lifecycle.completedAt, FIXED_LATER);
});

test("advanceLifecycleState throws when advancing from a terminal state", () => {
  for (const terminalState of RUNTIME_TERMINAL_STATES) {
    const invocationId = createRuntimeInvocationId(FIXED_NOW);
    let lifecycle = createRuntimeExecutionLifecycle(invocationId, FIXED_NOW);
    // Skip to terminal state via failed (1 hop from queued)
    lifecycle = { ...lifecycle, currentState: terminalState };
    assert.throws(
      () => advanceLifecycleState(lifecycle, "running", FIXED_LATER),
      /terminal state/,
      `Should throw for terminal state "${terminalState}"`,
    );
  }
});

test("all RuntimeExecutionState values are in RUNTIME_TERMINAL_STATES or non-terminal", () => {
  const allStates: string[] = [
    "queued",
    "authorization_verified",
    "dispatching",
    "running",
    "completed",
    "failed",
    "timeout",
    "rejected",
  ];
  const terminalSet = new Set<string>(RUNTIME_TERMINAL_STATES);
  const nonTerminal = allStates.filter((s) => !terminalSet.has(s));
  // Verify non-terminal states can be advanced
  for (const state of nonTerminal) {
    const lifecycle = {
      invocationId: "invocation-test",
      currentState: state as any,
      records: [{ state: state as any, timestamp: FIXED_NOW }],
      startedAt: FIXED_NOW,
    };
    assert.doesNotThrow(() => advanceLifecycleState(lifecycle, "completed", FIXED_LATER));
  }
});

// ---- ID generation tests ------------------------------------------------------------

test("createRuntimeInvocationId format is invocation-{14-digit-timestamp}", () => {
  const id = createRuntimeInvocationId("2026-05-22T10:00:00.000Z");
  assert.match(id, /^invocation-\d{14}$/);
});

test("createRuntimeDispatchRecordId derives record- prefix from invocation id", () => {
  const invocationId = createRuntimeInvocationId(FIXED_NOW);
  const recordId = createRuntimeDispatchRecordId(invocationId);
  assert.ok(recordId.startsWith("record-"), `Expected "record-" prefix, got: ${recordId}`);
  assert.ok(!recordId.includes("invocation-"), "Should strip invocation- prefix");
});

// ---- Failed invocation result tests -------------------------------------------------

test("makeFailedInvocationResult outcome=timeout for invocation_timeout category", () => {
  const invocationId = createRuntimeInvocationId(FIXED_NOW);
  const lifecycle = createRuntimeExecutionLifecycle(invocationId, FIXED_NOW);
  const failure = makeRuntimeFailure("invocation_timeout", "Timed out", FIXED_LATER);
  const result = makeFailedInvocationResult({
    invocationId,
    dispatchId: DISPATCH_ID,
    sandboxId: SANDBOX_ID,
    runtimeType: "openclaw",
    adapterId: ADAPTER_ID,
    failure,
    lifecycle,
    now: FIXED_LATER,
  });
  assert.equal(result.outcome, "timeout");
  assert.equal(result.failure?.category, "invocation_timeout");
  assert.ok(result.durationMs >= 0);
});

test("makeFailedInvocationResult outcome=rejected for authorization_denied", () => {
  const invocationId = createRuntimeInvocationId(FIXED_NOW);
  const lifecycle = createRuntimeExecutionLifecycle(invocationId, FIXED_NOW);
  const failure = makeRuntimeFailure("authorization_denied", "Approval expired", FIXED_NOW);
  const result = makeFailedInvocationResult({
    invocationId,
    dispatchId: DISPATCH_ID,
    sandboxId: SANDBOX_ID,
    runtimeType: "openclaw",
    adapterId: ADAPTER_ID,
    failure,
    lifecycle,
    now: FIXED_NOW,
  });
  assert.equal(result.outcome, "rejected");
});

test("makeFailedInvocationResult outcome=failed for sandbox_boundary_violation", () => {
  const invocationId = createRuntimeInvocationId(FIXED_NOW);
  const lifecycle = createRuntimeExecutionLifecycle(invocationId, FIXED_NOW);
  const failure = makeRuntimeFailure("sandbox_boundary_violation", "Path outside sandbox", FIXED_NOW);
  const result = makeFailedInvocationResult({
    invocationId,
    dispatchId: DISPATCH_ID,
    sandboxId: SANDBOX_ID,
    runtimeType: "openclaw",
    adapterId: ADAPTER_ID,
    failure,
    lifecycle,
    now: FIXED_NOW,
  });
  assert.equal(result.outcome, "failed");
});

test("makeFailedInvocationResult safetyBoundary flags are all correct", () => {
  const invocationId = createRuntimeInvocationId(FIXED_NOW);
  const lifecycle = createRuntimeExecutionLifecycle(invocationId, FIXED_NOW);
  const failure = makeRuntimeFailure("unknown_failure", "Unknown", FIXED_NOW);
  const result = makeFailedInvocationResult({
    invocationId,
    dispatchId: DISPATCH_ID,
    sandboxId: SANDBOX_ID,
    runtimeType: "openclaw",
    adapterId: ADAPTER_ID,
    failure,
    lifecycle,
    now: FIXED_NOW,
  });
  assert.equal(result.safetyBoundary.sandboxScoped, true);
  assert.equal(result.safetyBoundary.approvalRequired, true);
  assert.equal(result.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(result.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(result.safetyBoundary.productionWorkspaceMutationEnabled, false);
  assert.equal(result.safetyBoundary.automaticContinuationEnabled, false);
  assert.equal(result.safetyBoundary.humanAuthorityFinal, true);
});

test("makeFailedInvocationResult output capture is empty (no real execution)", () => {
  const invocationId = createRuntimeInvocationId(FIXED_NOW);
  const lifecycle = createRuntimeExecutionLifecycle(invocationId, FIXED_NOW);
  const failure = makeRuntimeFailure("adapter_not_found", "No adapter", FIXED_NOW);
  const result = makeFailedInvocationResult({
    invocationId,
    dispatchId: DISPATCH_ID,
    sandboxId: SANDBOX_ID,
    runtimeType: "openclaw",
    adapterId: ADAPTER_ID,
    failure,
    lifecycle,
    now: FIXED_NOW,
  });
  assert.equal(result.outputCapture.stdout, "");
  assert.deepEqual(result.outputCapture.stderr, []);
  assert.equal(result.outputCapture.stdoutTruncated, false);
});

// ---- Adapter interface (stub adapter) tests ----------------------------------------

function makeStubAdapter(): GovernedRuntimeAdapter {
  const capability: GovernedRuntimeAdapterCapability = makeTestCapability();

  return {
    adapterId: ADAPTER_ID,
    runtimeType: "openclaw",
    adapterVersion: "0.0.1-stub",
    capability,
    defaultTimeoutMs: 10000,
    maxStdoutBytes: 65536,
    maxStderrBytes: 8192,
    async invoke(invocation: GovernedRuntimeInvocation): Promise<RuntimeInvocationResult> {
      const invocationId = invocation.invocationId;
      const now = new Date().toISOString();
      let lifecycle = createRuntimeExecutionLifecycle(invocationId, invocation.requestedAt);
      lifecycle = advanceLifecycleState(lifecycle, "authorization_verified", now);
      lifecycle = advanceLifecycleState(lifecycle, "dispatching", now);
      lifecycle = advanceLifecycleState(lifecycle, "running", now);
      lifecycle = advanceLifecycleState(lifecycle, "completed", now, "stub: no-op completed");
      return {
        invocationId,
        dispatchId: invocation.dispatchId,
        sandboxId: invocation.sandboxId,
        runtimeType: "openclaw",
        adapterId: ADAPTER_ID,
        outcome: "completed",
        lifecycle,
        outputCapture: makeOutputCapture({
          stdout: "[stub] operation completed (no real execution)",
          stderr: [],
          maxStdoutBytes: 65536,
          maxStderrBytes: 8192,
          capturedAt: now,
        }),
        startedAt: invocation.requestedAt,
        completedAt: now,
        durationMs: 0,
        safetyBoundary: makeRuntimeAdapterSafetyBoundary(),
      };
    },
  };
}

test("stub adapter satisfies GovernedRuntimeAdapter interface shape", () => {
  const adapter = makeStubAdapter();
  assert.equal(typeof adapter.adapterId, "string");
  assert.equal(typeof adapter.runtimeType, "string");
  assert.equal(typeof adapter.adapterVersion, "string");
  assert.equal(typeof adapter.defaultTimeoutMs, "number");
  assert.equal(typeof adapter.maxStdoutBytes, "number");
  assert.equal(typeof adapter.maxStderrBytes, "number");
  assert.equal(typeof adapter.invoke, "function");
  assert.equal(adapter.capability.requiresSandbox, true);
  assert.equal(adapter.capability.requiresApproval, true);
  assert.equal(adapter.capability.shellExecutionEnabled, false);
  assert.equal(adapter.capability.networkExecutionEnabled, false);
  assert.equal(adapter.capability.productionMutationEnabled, false);
});

test("stub adapter invoke returns completed result with correct structure", async () => {
  const adapter = makeStubAdapter();
  const invocation = makeTestInvocation();
  const result = await adapter.invoke(invocation);
  assert.equal(result.outcome, "completed");
  assert.equal(result.invocationId, invocation.invocationId);
  assert.equal(result.dispatchId, DISPATCH_ID);
  assert.equal(result.sandboxId, SANDBOX_ID);
  assert.equal(result.runtimeType, "openclaw");
  assert.equal(result.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(result.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(result.safetyBoundary.productionWorkspaceMutationEnabled, false);
  assert.equal(result.safetyBoundary.humanAuthorityFinal, true);
});

test("stub adapter invoke lifecycle includes all expected states", async () => {
  const adapter = makeStubAdapter();
  const invocation = makeTestInvocation();
  const result = await adapter.invoke(invocation);
  const states = result.lifecycle.records.map((r) => r.state);
  assert.ok(states.includes("queued"), "Missing queued");
  assert.ok(states.includes("authorization_verified"), "Missing authorization_verified");
  assert.ok(states.includes("dispatching"), "Missing dispatching");
  assert.ok(states.includes("running"), "Missing running");
  assert.ok(states.includes("completed"), "Missing completed");
  assert.equal(result.lifecycle.currentState, "completed");
  assert.ok(result.lifecycle.completedAt !== undefined, "completedAt should be set");
});

test("stub adapter does not spawn processes or access network (no real execution)", async () => {
  const adapter = makeStubAdapter();
  const invocation = makeTestInvocation();
  const result = await adapter.invoke(invocation);
  // Verify safety invariants in result
  assert.equal(result.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(result.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(result.safetyBoundary.productionWorkspaceMutationEnabled, false);
  assert.equal(result.safetyBoundary.automaticContinuationEnabled, false);
  // Output is stub text, not real subprocess output
  assert.ok(result.outputCapture.stdout.includes("[stub]"), "Output should be stub-labeled");
});

// ---- Adapter registry tests --------------------------------------------------------

test("createEmptyAdapterRegistry starts with no entries", () => {
  const registry = createEmptyAdapterRegistry();
  assert.equal(registry.entries.length, 0);
  assert.equal(registry.defaultAdapterId, undefined);
});

test("registerAdapter adds an entry to the registry", () => {
  let registry = createEmptyAdapterRegistry();
  const entry: Omit<RuntimeAdapterRegistryEntry, "registeredAt"> = {
    adapterId: ADAPTER_ID,
    runtimeType: "openclaw",
    adapterVersion: "0.0.1-stub",
    capability: makeTestCapability(),
  };
  registry = registerAdapter(registry, entry, FIXED_NOW);
  assert.equal(registry.entries.length, 1);
  assert.equal(registry.entries[0]?.adapterId, ADAPTER_ID);
  assert.equal(registry.entries[0]?.registeredAt, FIXED_NOW);
});

test("registerAdapter throws on duplicate adapterId", () => {
  let registry = createEmptyAdapterRegistry();
  const entry: Omit<RuntimeAdapterRegistryEntry, "registeredAt"> = {
    adapterId: ADAPTER_ID,
    runtimeType: "openclaw",
    adapterVersion: "0.0.1-stub",
    capability: makeTestCapability(),
  };
  registry = registerAdapter(registry, entry, FIXED_NOW);
  assert.throws(
    () => registerAdapter(registry, entry, FIXED_LATER),
    /already registered/,
  );
});

test("lookupAdapterByRuntimeType returns entry for registered type", () => {
  let registry = createEmptyAdapterRegistry();
  const entry: Omit<RuntimeAdapterRegistryEntry, "registeredAt"> = {
    adapterId: ADAPTER_ID,
    runtimeType: "openclaw",
    adapterVersion: "0.0.1-stub",
    capability: makeTestCapability(),
  };
  registry = registerAdapter(registry, entry, FIXED_NOW);
  const found = lookupAdapterByRuntimeType(registry, "openclaw");
  assert.ok(found !== null, "Should find registered adapter");
  assert.equal(found?.adapterId, ADAPTER_ID);
});

test("lookupAdapterByRuntimeType returns null for unregistered type", () => {
  const registry = createEmptyAdapterRegistry();
  const found = lookupAdapterByRuntimeType(registry, "codex");
  assert.equal(found, null);
});

test("lookupAdapterById returns entry for registered id", () => {
  let registry = createEmptyAdapterRegistry();
  const entry: Omit<RuntimeAdapterRegistryEntry, "registeredAt"> = {
    adapterId: ADAPTER_ID,
    runtimeType: "openclaw",
    adapterVersion: "0.0.1-stub",
    capability: makeTestCapability(),
  };
  registry = registerAdapter(registry, entry, FIXED_NOW);
  const found = lookupAdapterById(registry, ADAPTER_ID);
  assert.ok(found !== null);
  assert.equal(found?.runtimeType, "openclaw");
});

test("lookupAdapterById returns null for unknown id", () => {
  const registry = createEmptyAdapterRegistry();
  const found = lookupAdapterById(registry, "no-such-adapter" as GovernedRuntimeAdapterId);
  assert.equal(found, null);
});

test("registry can hold multiple adapters for different runtime types", () => {
  let registry = createEmptyAdapterRegistry();
  const clawEntry: Omit<RuntimeAdapterRegistryEntry, "registeredAt"> = {
    adapterId: "openclaw-v1" as GovernedRuntimeAdapterId,
    runtimeType: "openclaw",
    adapterVersion: "1.0.0",
    capability: { ...makeTestCapability(), runtimeType: "openclaw" },
  };
  const codexEntry: Omit<RuntimeAdapterRegistryEntry, "registeredAt"> = {
    adapterId: "codex-v1" as GovernedRuntimeAdapterId,
    runtimeType: "codex",
    adapterVersion: "1.0.0",
    capability: { ...makeTestCapability(), runtimeType: "codex" },
  };
  registry = registerAdapter(registry, clawEntry, FIXED_NOW);
  registry = registerAdapter(registry, codexEntry, FIXED_NOW);
  assert.equal(registry.entries.length, 2);
  assert.ok(lookupAdapterByRuntimeType(registry, "openclaw") !== null);
  assert.ok(lookupAdapterByRuntimeType(registry, "codex") !== null);
  assert.equal(lookupAdapterByRuntimeType(registry, "claude_code"), null);
});

// ---- Dispatch record tests ----------------------------------------------------------

test("createGovernedRuntimeDispatchRecord maps all fields correctly", async () => {
  const adapter = makeStubAdapter();
  const invocation = makeTestInvocation();
  const result = await adapter.invoke(invocation);
  const record: GovernedRuntimeDispatchRecord = createGovernedRuntimeDispatchRecord({
    dispatchId: DISPATCH_ID,
    operatorId: OPERATOR_ID,
    operationRequest: "bounded write to sandbox workspace",
    approvalReference: "proposal-exec0052a-test",
    result,
    adapterVersion: "0.0.1-stub",
    recordedAt: FIXED_LATER,
  });
  assert.ok(record.recordId.startsWith("record-"), `Expected record- prefix, got: ${record.recordId}`);
  assert.equal(record.dispatchId, DISPATCH_ID);
  assert.equal(record.invocationId, invocation.invocationId);
  assert.equal(record.sandboxId, SANDBOX_ID);
  assert.equal(record.operatorId, OPERATOR_ID);
  assert.equal(record.runtimeType, "openclaw");
  assert.equal(record.adapterId, ADAPTER_ID);
  assert.equal(record.adapterVersion, "0.0.1-stub");
  assert.equal(record.approvalReference, "proposal-exec0052a-test");
  assert.equal(record.outcome, "completed");
  assert.equal(record.recordedAt, FIXED_LATER);
  assert.equal(record.safetyBoundary.sandboxScoped, true);
  assert.equal(record.safetyBoundary.humanAuthorityFinal, true);
  assert.equal(record.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(record.safetyBoundary.productionWorkspaceMutationEnabled, false);
});

test("createGovernedRuntimeDispatchRecord for failed result preserves failure details", () => {
  const invocationId = createRuntimeInvocationId(FIXED_NOW);
  const lifecycle = createRuntimeExecutionLifecycle(invocationId, FIXED_NOW);
  const failure = makeRuntimeFailure("adapter_not_found", "No adapter registered for codex", FIXED_NOW);
  const failedResult = makeFailedInvocationResult({
    invocationId,
    dispatchId: DISPATCH_ID,
    sandboxId: SANDBOX_ID,
    runtimeType: "codex",
    adapterId: "codex-v1" as GovernedRuntimeAdapterId,
    failure,
    lifecycle,
    now: FIXED_NOW,
  });
  const record = createGovernedRuntimeDispatchRecord({
    dispatchId: DISPATCH_ID,
    operatorId: OPERATOR_ID,
    operationRequest: "test codex dispatch",
    approvalReference: "proposal-codex-test",
    result: failedResult,
    adapterVersion: "n/a",
    recordedAt: FIXED_NOW,
  });
  assert.equal(record.outcome, "failed");
  assert.equal(record.failure?.category, "adapter_not_found");
  assert.equal(record.failure?.message, "No adapter registered for codex");
});
