import type { SandboxApprovalState, SandboxVerificationStatus } from "./sandboxExecutionReceipt";
import type { GovernedRuntimeValidationResult } from "./governedRuntimeValidation";

export const GOVERNED_OPERATION_LANE_VERSION = "EXEC-0045" as const;

// ---- ID patterns and helpers ----

const LANE_ID_PATTERN = /^lane-[a-z0-9][a-z0-9_-]{0,79}$/;
const QUEUE_ID_PATTERN = /^queue-[a-z0-9][a-z0-9_-]{0,79}$/;
const RUNTIME_ID_PATTERN = /^runtime-[a-z0-9][a-z0-9_-]{0,79}$/;
const OPERATION_ID_PATTERN = /^op-[a-z0-9][a-z0-9_-]{0,79}$/;

function timestampId(now: () => string): string {
  return now().replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "unknown";
}

// ---- Runtime metadata ----

export type GovernedRuntimeType =
  | "openclaw"
  | "claude_code"
  | "codex"
  | "copilot"
  | "human"
  | "unknown";

export type GovernedRuntimeCapability =
  | "command_validation"
  | "patch_preview"
  | "file_inspection"
  | "test_execution"
  | "build_execution"
  | "lint_execution"
  | "git_readonly"
  | "approval_review";

export type GovernedRuntimeAssignment = {
  runtimeId: string;
  runtimeType: GovernedRuntimeType;
  runtimeCapabilities: GovernedRuntimeCapability[];
  sandboxId: string;
  assignedAt: string;
  approvalRequired: boolean;
  executionAllowed: false;
  dryRunOnly: true;
  safetyBoundary: {
    runtimeInvocationEnabled: false;
    shellExecutionEnabled: false;
    networkExecutionEnabled: false;
    autonomousExecutionEnabled: false;
    metadataOnly: true;
  };
};

// ---- Lane state ----

export type GovernedLaneState =
  | "planned"
  | "validating"
  | "approval_pending"
  | "ready"
  | "blocked"
  | "denied"
  | "verified"
  | "completed";

export type GovernedLaneStateTransition = {
  fromState: GovernedLaneState;
  toState: GovernedLaneState;
  transitionAt: string;
  reason: string;
  authorizedBy?: string;
};

// ---- Operation execution state ----

export type GovernedOperationExecutionState =
  | "not_started"
  | "validation_pending"
  | "validation_passed"
  | "validation_failed"
  | "approval_pending"
  | "approval_granted"
  | "approval_denied"
  | "execution_ready"
  | "blocked_by_dependency"
  | "blocked_by_policy"
  | "blocked_by_error";

// ---- Dependencies ----

export type GovernedOperationDependencyKind =
  | "requires_completion"
  | "requires_approval"
  | "requires_verification"
  | "requires_ready";

export type GovernedOperationDependency = {
  dependencyId: string;
  dependsOnLaneId: string;
  dependsOnOperationId?: string;
  dependencyKind: GovernedOperationDependencyKind;
  resolvedAt?: string;
  resolved: boolean;
};

// ---- Lane operation ----

export type GovernedLaneOperation = {
  operationId: string;
  sandboxId: string;
  executionState: GovernedOperationExecutionState;
  validationResult?: GovernedRuntimeValidationResult;
  scheduledAt: string;
  updatedAt: string;
  warnings: Array<{ code: string; message: string }>;
  errors: Array<{ code: string; message: string }>;
};

// ---- Operation lane ----

export type GovernedOperationLane = {
  laneId: string;
  laneState: GovernedLaneState;
  runtimeAssignment: GovernedRuntimeAssignment;
  operations: GovernedLaneOperation[];
  dependencies: GovernedOperationDependency[];
  stateHistory: GovernedLaneStateTransition[];
  approvalState: SandboxApprovalState;
  verificationState: SandboxVerificationStatus;
  createdAt: string;
  updatedAt: string;
  executionAllowed: false;
  dryRun: true;
  safetyBoundary: {
    laneIsolationEnforced: true;
    crossLaneExecutionEnabled: false;
    automaticContinuationEnabled: false;
    runtimeInvocationEnabled: false;
    shellExecutionEnabled: false;
    networkExecutionEnabled: false;
  };
};

// ---- Queue snapshot ----

export type GovernedLaneStateCount = {
  state: GovernedLaneState;
  count: number;
  laneIds: string[];
};

export type GovernedOperationQueueSnapshot = {
  snapshotVersion: typeof GOVERNED_OPERATION_LANE_VERSION;
  queueId: string;
  snapshotAt: string;
  totalLanes: number;
  laneStateCounts: GovernedLaneStateCount[];
  pendingApprovalCount: number;
  blockedCount: number;
  deniedCount: number;
  verifiedCount: number;
  completedCount: number;
  allLanesExecutionAllowed: false;
  allLanesDryRun: true;
};

// ---- Operation queue ----

export type GovernedOperationQueue = {
  manifestVersion: typeof GOVERNED_OPERATION_LANE_VERSION;
  queueId: string;
  createdAt: string;
  updatedAt: string;
  lanes: GovernedOperationLane[];
  safetyBoundary: {
    governanceOnly: true;
    executionAllowed: false;
    dryRunEnforced: true;
    laneIsolationEnforced: true;
    autonomousExecutionEnabled: false;
    recursiveOrchestrationEnabled: false;
    shellExecutionEnabled: false;
    networkExecutionEnabled: false;
    humanAuthorityRequired: true;
  };
};

// ---- Dependency resolution result ----

export type GovernedDependencyResolutionResult = {
  laneId: string;
  resolved: GovernedOperationDependency[];
  unresolved: GovernedOperationDependency[];
};

// ---- Input types ----

export type CreateGovernedRuntimeAssignmentInput = {
  runtimeId?: string;
  runtimeType: GovernedRuntimeType;
  runtimeCapabilities?: GovernedRuntimeCapability[];
  sandboxId: string;
  approvalRequired?: boolean;
  now?: () => string;
};

export type CreateGovernedOperationLaneInput = {
  laneId?: string;
  runtimeAssignment: GovernedRuntimeAssignment;
  now?: () => string;
};

export type TransitionGovernedLaneStateInput = {
  reason: string;
  authorizedBy?: string;
  now?: () => string;
};

export type AddGovernedLaneDependencyInput = {
  dependencyId?: string;
  dependsOnLaneId: string;
  dependsOnOperationId?: string;
  dependencyKind?: GovernedOperationDependencyKind;
  now?: () => string;
};

export type AddGovernedLaneOperationInput = {
  operationId: string;
  executionState?: GovernedOperationExecutionState;
  validationResult?: GovernedRuntimeValidationResult;
  warnings?: Array<{ code: string; message: string }>;
  errors?: Array<{ code: string; message: string }>;
  now?: () => string;
};

export type CreateGovernedOperationQueueInput = {
  queueId?: string;
  label?: string;
  now?: () => string;
};

// ---- Valid state transition table ----

const VALID_TRANSITIONS: Record<GovernedLaneState, ReadonlyArray<GovernedLaneState>> = {
  planned:         ["validating", "approval_pending", "blocked", "denied"],
  validating:      ["approval_pending", "blocked", "denied"],
  approval_pending: ["ready", "denied"],
  ready:           ["verified", "blocked"],
  blocked:         ["validating", "approval_pending", "denied"],
  denied:          [],
  verified:        ["completed"],
  completed:       [],
};

// ---- ID factories ----

export function createGovernedLaneId(input: { label?: string; now?: () => string } = {}): string {
  const id = `lane-${timestampId(input.now ?? (() => new Date().toISOString()))}-${slugify(input.label ?? "lane")}`;
  if (!LANE_ID_PATTERN.test(id)) {
    throw new Error(`Generated lane id '${id}' does not match the required lane-<id> format.`);
  }
  return id;
}

export function createGovernedQueueId(input: { label?: string; now?: () => string } = {}): string {
  const id = `queue-${timestampId(input.now ?? (() => new Date().toISOString()))}-${slugify(input.label ?? "queue")}`;
  if (!QUEUE_ID_PATTERN.test(id)) {
    throw new Error(`Generated queue id '${id}' does not match the required queue-<id> format.`);
  }
  return id;
}

function createRuntimeId(runtimeType: GovernedRuntimeType, now: () => string): string {
  const id = `runtime-${timestampId(now)}-${slugify(runtimeType)}`;
  if (!RUNTIME_ID_PATTERN.test(id)) {
    throw new Error(`Generated runtime id '${id}' does not match the required runtime-<id> format.`);
  }
  return id;
}

// ---- Approval / verification derivation from lane state ----

function deriveApprovalStateForTransition(
  toState: GovernedLaneState,
  current: SandboxApprovalState,
): SandboxApprovalState {
  if (toState === "ready")   return "approved";
  if (toState === "denied")  return "rejected";
  return current;
}

function deriveVerificationStateForTransition(
  toState: GovernedLaneState,
  current: SandboxVerificationStatus,
): SandboxVerificationStatus {
  if (toState === "verified")                    return "passed";
  if (toState === "denied" || toState === "blocked") return "blocked";
  return current;
}

// ---- Public API ----

export function createGovernedRuntimeAssignment(
  input: CreateGovernedRuntimeAssignmentInput,
): GovernedRuntimeAssignment {
  const now = input.now ?? (() => new Date().toISOString());
  const runtimeId = input.runtimeId ?? createRuntimeId(input.runtimeType, now);

  if (!RUNTIME_ID_PATTERN.test(runtimeId)) {
    throw new Error(
      `Runtime id '${runtimeId}' must use the runtime-<id> format with only lowercase letters, numbers, dashes, or underscores.`,
    );
  }
  if (!input.sandboxId.trim()) {
    throw new Error("A sandbox id is required for runtime assignment.");
  }

  return {
    runtimeId,
    runtimeType: input.runtimeType,
    runtimeCapabilities: [...(input.runtimeCapabilities ?? [])],
    sandboxId: input.sandboxId,
    assignedAt: now(),
    approvalRequired: input.approvalRequired !== false,
    executionAllowed: false,
    dryRunOnly: true,
    safetyBoundary: {
      runtimeInvocationEnabled: false,
      shellExecutionEnabled: false,
      networkExecutionEnabled: false,
      autonomousExecutionEnabled: false,
      metadataOnly: true,
    },
  };
}

export function createGovernedOperationLane(
  input: CreateGovernedOperationLaneInput,
): GovernedOperationLane {
  const now = input.now ?? (() => new Date().toISOString());
  const laneId = input.laneId ?? createGovernedLaneId({
    label: input.runtimeAssignment.runtimeType,
    now,
  });

  if (!LANE_ID_PATTERN.test(laneId)) {
    throw new Error(
      `Lane id '${laneId}' must use the lane-<id> format with only lowercase letters, numbers, dashes, or underscores.`,
    );
  }

  const timestamp = now();
  const approvalState: SandboxApprovalState =
    input.runtimeAssignment.approvalRequired ? "pending" : "not_required";

  return {
    laneId,
    laneState: "planned",
    runtimeAssignment: input.runtimeAssignment,
    operations: [],
    dependencies: [],
    stateHistory: [],
    approvalState,
    verificationState: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
    executionAllowed: false,
    dryRun: true,
    safetyBoundary: {
      laneIsolationEnforced: true,
      crossLaneExecutionEnabled: false,
      automaticContinuationEnabled: false,
      runtimeInvocationEnabled: false,
      shellExecutionEnabled: false,
      networkExecutionEnabled: false,
    },
  };
}

export function transitionGovernedLaneState(
  lane: GovernedOperationLane,
  toState: GovernedLaneState,
  input: TransitionGovernedLaneStateInput,
): GovernedOperationLane {
  const now = input.now ?? (() => new Date().toISOString());
  const validNext = VALID_TRANSITIONS[lane.laneState];

  if (!validNext.includes(toState)) {
    const allowed = validNext.length > 0 ? `[${validNext.join(", ")}]` : "none — terminal state";
    throw new Error(
      `Invalid lane state transition: '${lane.laneState}' → '${toState}'. Allowed from '${lane.laneState}': ${allowed}.`,
    );
  }

  const transitionAt = now();
  const transition: GovernedLaneStateTransition = {
    fromState: lane.laneState,
    toState,
    transitionAt,
    reason: input.reason,
    authorizedBy: input.authorizedBy,
  };

  return {
    ...lane,
    laneState: toState,
    approvalState: deriveApprovalStateForTransition(toState, lane.approvalState),
    verificationState: deriveVerificationStateForTransition(toState, lane.verificationState),
    stateHistory: [...lane.stateHistory, transition],
    updatedAt: transitionAt,
  };
}

export function addGovernedLaneDependency(
  lane: GovernedOperationLane,
  input: AddGovernedLaneDependencyInput,
): GovernedOperationLane {
  const now = input.now ?? (() => new Date().toISOString());

  if (!input.dependsOnLaneId.trim()) {
    throw new Error("A dependsOnLaneId is required for a lane dependency.");
  }
  if (input.dependsOnLaneId === lane.laneId) {
    throw new Error("A lane cannot declare a dependency on itself.");
  }

  const dependencyId =
    input.dependencyId ?? `dep-${timestampId(now)}-${String(lane.dependencies.length + 1).padStart(3, "0")}`;

  const dependency: GovernedOperationDependency = {
    dependencyId,
    dependsOnLaneId: input.dependsOnLaneId,
    dependsOnOperationId: input.dependsOnOperationId,
    dependencyKind: input.dependencyKind ?? "requires_completion",
    resolved: false,
  };

  return {
    ...lane,
    dependencies: [...lane.dependencies, dependency],
    updatedAt: now(),
  };
}

export function addGovernedLaneOperation(
  lane: GovernedOperationLane,
  input: AddGovernedLaneOperationInput,
): GovernedOperationLane {
  const now = input.now ?? (() => new Date().toISOString());

  if (!OPERATION_ID_PATTERN.test(input.operationId)) {
    throw new Error(`Operation id '${input.operationId}' must use the op-<id> format with only lowercase letters, numbers, dashes, or underscores.`);
  }

  // Lane isolation: validation result sandbox must match lane sandbox
  if (
    input.validationResult !== undefined &&
    input.validationResult.sandboxId !== lane.runtimeAssignment.sandboxId
  ) {
    throw new Error(
      `Lane isolation violation: validation result sandbox '${input.validationResult.sandboxId}' ` +
      `does not match lane sandbox '${lane.runtimeAssignment.sandboxId}'.`,
    );
  }

  const timestamp = now();
  const operation: GovernedLaneOperation = {
    operationId: input.operationId,
    sandboxId: lane.runtimeAssignment.sandboxId,
    executionState: input.executionState ?? "not_started",
    validationResult: input.validationResult,
    scheduledAt: timestamp,
    updatedAt: timestamp,
    warnings: [...(input.warnings ?? [])],
    errors: [...(input.errors ?? [])],
  };

  return {
    ...lane,
    operations: [...lane.operations, operation],
    updatedAt: timestamp,
  };
}

export function createGovernedOperationQueue(
  input: CreateGovernedOperationQueueInput = {},
): GovernedOperationQueue {
  const now = input.now ?? (() => new Date().toISOString());
  const queueId = input.queueId ?? createGovernedQueueId({ label: input.label ?? "queue", now });

  if (!QUEUE_ID_PATTERN.test(queueId)) {
    throw new Error(
      `Queue id '${queueId}' must use the queue-<id> format with only lowercase letters, numbers, dashes, or underscores.`,
    );
  }

  const timestamp = now();

  return {
    manifestVersion: GOVERNED_OPERATION_LANE_VERSION,
    queueId,
    createdAt: timestamp,
    updatedAt: timestamp,
    lanes: [],
    safetyBoundary: {
      governanceOnly: true,
      executionAllowed: false,
      dryRunEnforced: true,
      laneIsolationEnforced: true,
      autonomousExecutionEnabled: false,
      recursiveOrchestrationEnabled: false,
      shellExecutionEnabled: false,
      networkExecutionEnabled: false,
      humanAuthorityRequired: true,
    },
  };
}

export function registerGovernedOperationLane(
  queue: GovernedOperationQueue,
  lane: GovernedOperationLane,
  input: { now?: () => string } = {},
): GovernedOperationQueue {
  const now = input.now ?? (() => new Date().toISOString());

  if (queue.lanes.some((existing) => existing.laneId === lane.laneId)) {
    throw new Error(`Lane '${lane.laneId}' is already registered in queue '${queue.queueId}'.`);
  }

  return {
    ...queue,
    lanes: [...queue.lanes, lane],
    updatedAt: now(),
  };
}

export function snapshotGovernedOperationQueue(
  queue: GovernedOperationQueue,
  input: { now?: () => string } = {},
): GovernedOperationQueueSnapshot {
  const now = input.now ?? (() => new Date().toISOString());

  const allStates: GovernedLaneState[] = [
    "planned", "validating", "approval_pending", "ready",
    "blocked", "denied", "verified", "completed",
  ];

  const laneStateCounts: GovernedLaneStateCount[] = allStates.map((state) => {
    const matching = queue.lanes.filter((l) => l.laneState === state);
    return { state, count: matching.length, laneIds: matching.map((l) => l.laneId) };
  });

  return {
    snapshotVersion: GOVERNED_OPERATION_LANE_VERSION,
    queueId: queue.queueId,
    snapshotAt: now(),
    totalLanes: queue.lanes.length,
    laneStateCounts,
    pendingApprovalCount: queue.lanes.filter((l) => l.approvalState === "pending").length,
    blockedCount: queue.lanes.filter((l) => l.laneState === "blocked").length,
    deniedCount: queue.lanes.filter((l) => l.laneState === "denied").length,
    verifiedCount: queue.lanes.filter((l) => l.laneState === "verified").length,
    completedCount: queue.lanes.filter((l) => l.laneState === "completed").length,
    allLanesExecutionAllowed: false,
    allLanesDryRun: true,
  };
}

export function resolveGovernedLaneDependencies(
  queue: GovernedOperationQueue,
  laneId: string,
  input: { now?: () => string } = {},
): GovernedDependencyResolutionResult {
  const now = input.now ?? (() => new Date().toISOString());
  const lane = queue.lanes.find((l) => l.laneId === laneId);

  if (!lane) {
    throw new Error(`Lane '${laneId}' is not registered in queue '${queue.queueId}'.`);
  }

  const resolved: GovernedOperationDependency[] = [];
  const unresolved: GovernedOperationDependency[] = [];

  for (const dep of lane.dependencies) {
    const dependedUpon = queue.lanes.find((l) => l.laneId === dep.dependsOnLaneId);

    if (!dependedUpon) {
      unresolved.push(dep);
      continue;
    }

    const satisfied =
      dep.dependencyKind === "requires_completion"   ? dependedUpon.laneState === "completed"
      : dep.dependencyKind === "requires_approval"   ? dependedUpon.approvalState === "approved"
      : dep.dependencyKind === "requires_verification" ? (dependedUpon.laneState === "verified" || dependedUpon.laneState === "completed")
      : dep.dependencyKind === "requires_ready"      ? (["ready", "verified", "completed"] as GovernedLaneState[]).includes(dependedUpon.laneState)
      : false;

    if (satisfied) {
      resolved.push({ ...dep, resolved: true, resolvedAt: now() });
    } else {
      unresolved.push(dep);
    }
  }

  return { laneId, resolved, unresolved };
}
