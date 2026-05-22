// AI-E GOVERNED RUNTIME ADAPTER CONTRACT (EXEC-0052-A)
//
// Defines the adapter abstraction boundary between AI-E governed dispatch and real runtimes
// (OpenClaw, Claude Code, Codex, future adapters).
//
// This file is the TRUST BOUNDARY DEFINITION for real bounded runtime execution.
// It defines: adapter interface, invocation contract, output capture semantics,
// failure handling, lifecycle state machine, sandbox IO contract, capability metadata,
// adapter registry, and dispatch record structure.
//
// NO real runtime is invoked here.
// NO child_process. NO shell. NO spawn/exec/execFile. NO network. NO production mutation.
// NO autonomous continuation. NO recursive orchestration.

import type { GovernedRuntimeCapability, GovernedRuntimeType } from "./governedOperationLane";
import type { GovernedExecutionApproval } from "./sandboxedRuntimeDispatch";

// Re-export shared types so callers can import from one place
export type { GovernedRuntimeCapability, GovernedRuntimeType };

// =====================================================================================
// ADAPTER IDENTITY
// =====================================================================================

export type GovernedRuntimeAdapterId = string & { readonly __adapterId: unique symbol };

// =====================================================================================
// SANDBOX RUNTIME IO CONTRACT
// Declares what the adapter is permitted to do inside the sandbox workspace.
// All safety-negative flags are literal false — no adapter can override them.
// =====================================================================================

export type SandboxRuntimeIOContract = {
  workspaceReadAllowed: true;
  workspaceWriteAllowed: boolean;
  workspaceDeleteAllowed: false;
  productionMutationAllowed: false;
  shellPassthroughAllowed: false;
  networkAccessAllowed: false;
  maxReadFiles: number;
  maxWriteFiles: number;
  captureStdout: boolean;
  captureStderr: boolean;
};

// =====================================================================================
// RUNTIME INVOCATION REQUEST
// Everything the adapter needs to perform the bounded operation — nothing more.
// =====================================================================================

export type GovernedRuntimeInvocation = {
  invocationId: string;
  dispatchId: string;
  sandboxId: string;
  operatorId: string;
  runtimeId: GovernedRuntimeAdapterId;
  approvalReference: string;
  approval: GovernedExecutionApproval;
  operationRequest: string;
  workspaceRoot: string;
  timeoutMs: number;
  ioContract: SandboxRuntimeIOContract;
  requestedAt: string;
};

// =====================================================================================
// RUNTIME OUTPUT CAPTURE
// Captures stdout/stderr from the adapter invocation with byte-level truncation tracking.
// =====================================================================================

export type RuntimeOutputCapture = {
  stdout: string;
  stderr: string[];
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  capturedAt: string;
};

// =====================================================================================
// RUNTIME FAILURE CONTRACT
// Every non-successful invocation must produce one of these.
// Failure categories are exhaustive; unknown_failure is the catch-all.
// =====================================================================================

export type RuntimeFailureCategory =
  | "authorization_denied"
  | "adapter_not_found"
  | "invocation_timeout"
  | "output_capture_failed"
  | "sandbox_boundary_violation"
  | "operation_rejected_by_adapter"
  | "lifecycle_state_error"
  | "unknown_failure";

export type RuntimeFailureContract = {
  category: RuntimeFailureCategory;
  message: string;
  recoverable: boolean;
  rollbackRequired: boolean;
  failedAt: string;
  details?: string;
};

// =====================================================================================
// RUNTIME EXECUTION LIFECYCLE
// Ordered state machine for a single adapter invocation.
// Terminal states (completed | failed | timeout | rejected) cannot be advanced further.
// =====================================================================================

export type RuntimeExecutionState =
  | "queued"
  | "authorization_verified"
  | "dispatching"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "rejected";

export const RUNTIME_TERMINAL_STATES: readonly RuntimeExecutionState[] = [
  "completed",
  "failed",
  "timeout",
  "rejected",
] as const;

export type RuntimeExecutionLifecycleRecord = {
  state: RuntimeExecutionState;
  timestamp: string;
  message?: string;
};

export type RuntimeExecutionLifecycle = {
  invocationId: string;
  currentState: RuntimeExecutionState;
  records: RuntimeExecutionLifecycleRecord[];
  startedAt: string;
  completedAt?: string;
};

// =====================================================================================
// ADAPTER SAFETY BOUNDARY
// Explicit proof-of-bounds attached to every invocation result and dispatch record.
// All safety-negative flags are literal false — cannot be widened by any adapter.
// =====================================================================================

export type RuntimeAdapterSafetyBoundary = {
  sandboxScoped: true;
  approvalRequired: true;
  shellExecutionEnabled: false;
  networkExecutionEnabled: false;
  productionWorkspaceMutationEnabled: false;
  automaticContinuationEnabled: false;
  humanAuthorityFinal: true;
};

// =====================================================================================
// RUNTIME INVOCATION RESULT
// Returned by GovernedRuntimeAdapter.invoke(). Contains the full outcome,
// lifecycle, output capture, optional failure, and safety boundary proof.
// =====================================================================================

export type RuntimeInvocationOutcome = "completed" | "failed" | "timeout" | "rejected";

export type RuntimeInvocationResult = {
  invocationId: string;
  dispatchId: string;
  sandboxId: string;
  runtimeType: GovernedRuntimeType;
  adapterId: GovernedRuntimeAdapterId;
  outcome: RuntimeInvocationOutcome;
  lifecycle: RuntimeExecutionLifecycle;
  outputCapture: RuntimeOutputCapture;
  failure?: RuntimeFailureContract;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  rollbackReference?: string;
  safetyBoundary: RuntimeAdapterSafetyBoundary;
};

// =====================================================================================
// GOVERNED RUNTIME ADAPTER INTERFACE
// The contract all runtime adapters must satisfy.
//
// invoke() MUST:
//   - Operate within the sandbox workspace declared in the invocation's ioContract
//   - Return a RuntimeInvocationResult with outcome and safetyBoundary populated
//
// invoke() MUST NOT:
//   - Spawn processes, access the network, mutate the production workspace
//   - Exceed the ioContract file/byte limits
//   - Continue autonomously after returning
//   - Invoke other adapters or recursive runtimes
// =====================================================================================

export interface GovernedRuntimeAdapter {
  adapterId: GovernedRuntimeAdapterId;
  runtimeType: GovernedRuntimeType;
  adapterVersion: string;
  capability: GovernedRuntimeAdapterCapability;
  defaultTimeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  invoke(invocation: GovernedRuntimeInvocation): Promise<RuntimeInvocationResult>;
}

// =====================================================================================
// ADAPTER CAPABILITY METADATA
// Declares what this adapter supports. Safety-negative flags are literal false.
// Distinct from GovernedRuntimeCapability (the string-union capability enum from
// governedOperationLane.ts) — this is the structured capability record for an adapter.
// =====================================================================================

export type GovernedRuntimeAdapterCapability = {
  runtimeType: GovernedRuntimeType;
  supportedCapabilities: GovernedRuntimeCapability[];
  requiresSandbox: true;
  requiresApproval: true;
  shellExecutionEnabled: false;
  networkExecutionEnabled: false;
  productionMutationEnabled: false;
};

// =====================================================================================
// GOVERNED RUNTIME DISPATCH RECORD
// Persisted audit record for a completed dispatch. Ties together dispatch ID,
// invocation ID, approval reference, outcome, and safety boundary.
// =====================================================================================

export type GovernedRuntimeDispatchRecord = {
  recordId: string;
  dispatchId: string;
  invocationId: string;
  sandboxId: string;
  operatorId: string;
  runtimeType: GovernedRuntimeType;
  adapterId: GovernedRuntimeAdapterId;
  adapterVersion: string;
  approvalReference: string;
  operationRequest: string;
  outcome: RuntimeInvocationOutcome;
  lifecycle: RuntimeExecutionLifecycle;
  outputCapture: RuntimeOutputCapture;
  failure?: RuntimeFailureContract;
  rollbackReference?: string;
  recordedAt: string;
  safetyBoundary: RuntimeAdapterSafetyBoundary;
};

// =====================================================================================
// ADAPTER REGISTRY
// In-memory registry of known adapters. No dynamic loading, no network lookups.
// Immutable after registration. Registry entries carry capability and version metadata.
// =====================================================================================

export type RuntimeAdapterRegistryEntry = {
  adapterId: GovernedRuntimeAdapterId;
  runtimeType: GovernedRuntimeType;
  adapterVersion: string;
  capability: GovernedRuntimeAdapterCapability;
  registeredAt: string;
};

export type RuntimeAdapterRegistry = {
  entries: RuntimeAdapterRegistryEntry[];
  defaultAdapterId?: GovernedRuntimeAdapterId;
};

// =====================================================================================
// FACTORY HELPERS — SAFETY BOUNDARY & IO CONTRACT
// Pure functions. No I/O, no side effects.
// =====================================================================================

export function makeRuntimeAdapterSafetyBoundary(): RuntimeAdapterSafetyBoundary {
  return {
    sandboxScoped: true,
    approvalRequired: true,
    shellExecutionEnabled: false,
    networkExecutionEnabled: false,
    productionWorkspaceMutationEnabled: false,
    automaticContinuationEnabled: false,
    humanAuthorityFinal: true,
  };
}

export function makeDefaultSandboxRuntimeIOContract(
  overrides?: Partial<
    Pick<
      SandboxRuntimeIOContract,
      "workspaceWriteAllowed" | "maxReadFiles" | "maxWriteFiles" | "captureStdout" | "captureStderr"
    >
  >,
): SandboxRuntimeIOContract {
  return {
    workspaceReadAllowed: true,
    workspaceWriteAllowed: overrides?.workspaceWriteAllowed ?? false,
    workspaceDeleteAllowed: false,
    productionMutationAllowed: false,
    shellPassthroughAllowed: false,
    networkAccessAllowed: false,
    maxReadFiles: overrides?.maxReadFiles ?? 64,
    maxWriteFiles: overrides?.maxWriteFiles ?? 8,
    captureStdout: overrides?.captureStdout ?? true,
    captureStderr: overrides?.captureStderr ?? true,
  };
}

// =====================================================================================
// FACTORY HELPERS — OUTPUT CAPTURE
// =====================================================================================

export function makeEmptyOutputCapture(capturedAt: string): RuntimeOutputCapture {
  return {
    stdout: "",
    stderr: [],
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    capturedAt,
  };
}

export function makeOutputCapture(params: {
  stdout: string;
  stderr: string[];
  maxStdoutBytes: number;
  maxStderrBytes: number;
  capturedAt: string;
}): RuntimeOutputCapture {
  const stdoutBytes = Buffer.byteLength(params.stdout, "utf8");
  const stderrJoined = params.stderr.join("\n");
  const stderrBytes = Buffer.byteLength(stderrJoined, "utf8");
  const stdoutTruncated = stdoutBytes > params.maxStdoutBytes;
  const stderrTruncated = stderrBytes > params.maxStderrBytes;
  return {
    stdout: stdoutTruncated ? params.stdout.slice(0, params.maxStdoutBytes) : params.stdout,
    stderr: stderrTruncated ? [stderrJoined.slice(0, params.maxStderrBytes)] : params.stderr,
    stdoutBytes,
    stderrBytes,
    stdoutTruncated,
    stderrTruncated,
    capturedAt: params.capturedAt,
  };
}

// =====================================================================================
// FACTORY HELPERS — FAILURE CONTRACT
// =====================================================================================

export function makeRuntimeFailure(
  category: RuntimeFailureCategory,
  message: string,
  failedAt: string,
  options?: { recoverable?: boolean; rollbackRequired?: boolean; details?: string },
): RuntimeFailureContract {
  return {
    category,
    message,
    recoverable: options?.recoverable ?? false,
    rollbackRequired: options?.rollbackRequired ?? false,
    failedAt,
    details: options?.details,
  };
}

// =====================================================================================
// FACTORY HELPERS — ID GENERATION
// =====================================================================================

export function createRuntimeInvocationId(now: string): string {
  const ts = now.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  return `invocation-${ts}`;
}

export function createRuntimeDispatchRecordId(invocationId: string): string {
  return `record-${invocationId.replace(/^invocation-/, "")}`;
}

// =====================================================================================
// LIFECYCLE HELPERS
// =====================================================================================

export function createRuntimeExecutionLifecycle(
  invocationId: string,
  startedAt: string,
): RuntimeExecutionLifecycle {
  return {
    invocationId,
    currentState: "queued",
    records: [{ state: "queued", timestamp: startedAt }],
    startedAt,
  };
}

export function advanceLifecycleState(
  lifecycle: RuntimeExecutionLifecycle,
  nextState: RuntimeExecutionState,
  timestamp: string,
  message?: string,
): RuntimeExecutionLifecycle {
  if ((RUNTIME_TERMINAL_STATES as readonly string[]).includes(lifecycle.currentState)) {
    throw new Error(
      `Cannot advance lifecycle from terminal state "${lifecycle.currentState}" to "${nextState}".`,
    );
  }
  const record: RuntimeExecutionLifecycleRecord = { state: nextState, timestamp, message };
  const isTerminal = (RUNTIME_TERMINAL_STATES as readonly string[]).includes(nextState);
  return {
    ...lifecycle,
    currentState: nextState,
    records: [...lifecycle.records, record],
    completedAt: isTerminal ? timestamp : lifecycle.completedAt,
  };
}

// =====================================================================================
// FAILED INVOCATION RESULT
// Builds a fully-formed RuntimeInvocationResult for an invocation that was rejected
// or failed before any real execution occurred. No adapter invocation takes place.
// =====================================================================================

export function makeFailedInvocationResult(params: {
  invocationId: string;
  dispatchId: string;
  sandboxId: string;
  runtimeType: GovernedRuntimeType;
  adapterId: GovernedRuntimeAdapterId;
  failure: RuntimeFailureContract;
  lifecycle: RuntimeExecutionLifecycle;
  now: string;
}): RuntimeInvocationResult {
  const outcome: RuntimeInvocationOutcome =
    params.failure.category === "invocation_timeout" ? "timeout"
    : params.failure.category === "authorization_denied" || params.failure.category === "operation_rejected_by_adapter" ? "rejected"
    : "failed";
  const started = new Date(params.lifecycle.startedAt).getTime();
  const ended = new Date(params.now).getTime();
  return {
    invocationId: params.invocationId,
    dispatchId: params.dispatchId,
    sandboxId: params.sandboxId,
    runtimeType: params.runtimeType,
    adapterId: params.adapterId,
    outcome,
    lifecycle: params.lifecycle,
    outputCapture: makeEmptyOutputCapture(params.now),
    failure: params.failure,
    startedAt: params.lifecycle.startedAt,
    completedAt: params.now,
    durationMs: Math.max(0, ended - started),
    safetyBoundary: makeRuntimeAdapterSafetyBoundary(),
  };
}

// =====================================================================================
// ADAPTER REGISTRY HELPERS
// =====================================================================================

export function createEmptyAdapterRegistry(): RuntimeAdapterRegistry {
  return { entries: [] };
}

export function registerAdapter(
  registry: RuntimeAdapterRegistry,
  entry: Omit<RuntimeAdapterRegistryEntry, "registeredAt">,
  now: string,
): RuntimeAdapterRegistry {
  if (registry.entries.some((e) => e.adapterId === entry.adapterId)) {
    throw new Error(`Adapter "${entry.adapterId}" is already registered.`);
  }
  return {
    ...registry,
    entries: [...registry.entries, { ...entry, registeredAt: now }],
  };
}

export function lookupAdapterByRuntimeType(
  registry: RuntimeAdapterRegistry,
  runtimeType: GovernedRuntimeType,
): RuntimeAdapterRegistryEntry | null {
  return registry.entries.find((e) => e.runtimeType === runtimeType) ?? null;
}

export function lookupAdapterById(
  registry: RuntimeAdapterRegistry,
  adapterId: GovernedRuntimeAdapterId,
): RuntimeAdapterRegistryEntry | null {
  return registry.entries.find((e) => e.adapterId === adapterId) ?? null;
}

// =====================================================================================
// DISPATCH RECORD FACTORY
// =====================================================================================

export function createGovernedRuntimeDispatchRecord(params: {
  dispatchId: string;
  operatorId: string;
  operationRequest: string;
  approvalReference: string;
  result: RuntimeInvocationResult;
  adapterVersion: string;
  recordedAt: string;
}): GovernedRuntimeDispatchRecord {
  return {
    recordId: createRuntimeDispatchRecordId(params.result.invocationId),
    dispatchId: params.dispatchId,
    invocationId: params.result.invocationId,
    sandboxId: params.result.sandboxId,
    operatorId: params.operatorId,
    runtimeType: params.result.runtimeType,
    adapterId: params.result.adapterId,
    adapterVersion: params.adapterVersion,
    approvalReference: params.approvalReference,
    operationRequest: params.operationRequest,
    outcome: params.result.outcome,
    lifecycle: params.result.lifecycle,
    outputCapture: params.result.outputCapture,
    failure: params.result.failure,
    rollbackReference: params.result.rollbackReference,
    recordedAt: params.recordedAt,
    safetyBoundary: makeRuntimeAdapterSafetyBoundary(),
  };
}
