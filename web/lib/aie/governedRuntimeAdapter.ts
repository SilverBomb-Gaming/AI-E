import type {
  GovernedLaneState,
  GovernedOperationLane,
  GovernedRuntimeCapability,
  GovernedRuntimeType,
} from "./governedOperationLane";
import type { SandboxApprovalState } from "./sandboxExecutionReceipt";
import type { GovernedRuntimeProposedCommand } from "./governedRuntimeValidation";

export const GOVERNED_RUNTIME_ADAPTER_VERSION = "EXEC-0046" as const;

// ---- ID helpers ----

const SIMULATION_ID_PATTERN = /^sim-[a-z0-9][a-z0-9_-]{0,79}$/;
const REQUEST_ID_PATTERN = /^req-[a-z0-9][a-z0-9_-]{0,79}$/;
const INTENT_ID_PATTERN = /^intent-[a-z0-9][a-z0-9_-]{0,79}$/;

function timestampId(now: () => string): string {
  return now().replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "unknown";
}

// ---- Capability match ----

export type GovernedRuntimeCapabilityMatch = {
  runtimeType: GovernedRuntimeType;
  runtimeId: string;
  requiredCapabilities: GovernedRuntimeCapability[];
  matchedCapabilities: GovernedRuntimeCapability[];
  unmatchedCapabilities: GovernedRuntimeCapability[];
  isMatch: boolean;
  matchRatio: number;
};

// ---- Invocation eligibility ----

export type GovernedRuntimeEligibilityBlocker =
  | "lane_not_ready"
  | "approval_pending"
  | "approval_rejected"
  | "capability_mismatch"
  | "lane_denied"
  | "lane_blocked";

export type GovernedRuntimeInvocationEligibility = {
  adapterVersion: typeof GOVERNED_RUNTIME_ADAPTER_VERSION;
  laneId: string;
  runtimeType: GovernedRuntimeType;
  runtimeId: string;
  laneState: GovernedLaneState;
  approvalState: SandboxApprovalState;
  capabilityMatch: GovernedRuntimeCapabilityMatch;
  eligible: boolean;
  blockers: GovernedRuntimeEligibilityBlocker[];
  executionAllowed: false;
  simulationOnly: true;
  checkedAt: string;
  safetyBoundary: {
    eligibilityCheckOnly: true;
    runtimeInvocationEnabled: false;
    shellExecutionEnabled: false;
    networkExecutionEnabled: false;
    autonomousExecutionEnabled: false;
  };
};

// ---- Execution intent (what AI-E intends to request — never dispatched) ----

export type GovernedRuntimeExecutionIntentStatus =
  | "pending"
  | "simulation_ready"
  | "blocked"
  | "denied";

export type GovernedRuntimeExecutionIntent = {
  adapterVersion: typeof GOVERNED_RUNTIME_ADAPTER_VERSION;
  intentId: string;
  laneId: string;
  sandboxId: string;
  runtimeType: GovernedRuntimeType;
  runtimeId: string;
  operationIds: string[];
  validationResultRefs: string[];
  intentStatus: GovernedRuntimeExecutionIntentStatus;
  createdAt: string;
  executionAllowed: false;
  dryRun: true;
  safetyBoundary: {
    intentOnlyNoExecution: true;
    runtimeInvocationEnabled: false;
    shellExecutionEnabled: false;
    networkExecutionEnabled: false;
    executionOccurred: false;
  };
};

// ---- Invocation request (what WOULD be sent to the runtime — never dispatched from this phase) ----

export type GovernedRuntimeInvocationRequest = {
  adapterVersion: typeof GOVERNED_RUNTIME_ADAPTER_VERSION;
  requestId: string;
  laneId: string;
  sandboxId: string;
  runtimeType: GovernedRuntimeType;
  runtimeId: string;
  proposedCommands: GovernedRuntimeProposedCommand[];
  requiredCapabilities: GovernedRuntimeCapability[];
  validationResultRef?: string;
  approvalState: SandboxApprovalState;
  builtAt: string;
  executionAllowed: false;
  dryRun: true;
  safetyBoundary: {
    requestOnlyNoDispatch: true;
    runtimeInvocationEnabled: false;
    shellExecutionEnabled: false;
    networkExecutionEnabled: false;
    workspaceMutationEnabled: false;
  };
};

// ---- Invocation result (what a real adapter would return — never from this phase) ----

export type GovernedRuntimeInvocationResultStatus =
  | "simulated"
  | "eligibility_blocked"
  | "denied";

export type GovernedRuntimeInvocationResult = {
  adapterVersion: typeof GOVERNED_RUNTIME_ADAPTER_VERSION;
  resultId: string;
  requestId: string;
  laneId: string;
  runtimeType: GovernedRuntimeType;
  status: GovernedRuntimeInvocationResultStatus;
  executionOccurred: false;
  dryRun: true;
  simulatedOutput?: string;
  producedAt: string;
  safetyBoundary: {
    resultOnly: true;
    runtimeInvocationEnabled: false;
    shellExecutionEnabled: false;
    networkExecutionEnabled: false;
    executionOccurred: false;
  };
};

// ---- Simulation result ----

export type GovernedRuntimeSimulationResult = {
  adapterVersion: typeof GOVERNED_RUNTIME_ADAPTER_VERSION;
  simulationId: string;
  laneId: string;
  runtimeType: GovernedRuntimeType;
  runtimeId: string;
  simulatedAt: string;
  eligibility: GovernedRuntimeInvocationEligibility;
  executionIntent: GovernedRuntimeExecutionIntent;
  invocationRequest: GovernedRuntimeInvocationRequest | null;
  result: GovernedRuntimeInvocationResult;
  executionOccurred: false;
  executionAllowed: false;
  dryRun: true;
  simulationNote: string;
  safetyBoundary: {
    adapterVersion: typeof GOVERNED_RUNTIME_ADAPTER_VERSION;
    simulationOnly: true;
    runtimeInvocationEnabled: false;
    shellExecutionEnabled: false;
    networkExecutionEnabled: false;
    workspaceMutationEnabled: false;
    rollbackExecutionEnabled: false;
    autonomousExecutionEnabled: false;
    executionOccurred: false;
    humanAuthorityRequired: true;
  };
};

// ---- Adapter interface ----

export type GovernedRuntimeAdapter = {
  readonly adapterVersion: typeof GOVERNED_RUNTIME_ADAPTER_VERSION;
  readonly runtimeType: GovernedRuntimeType;
  readonly runtimeId: string;
  readonly capabilities: ReadonlyArray<GovernedRuntimeCapability>;
  checkEligibility: (
    lane: GovernedOperationLane,
    requiredCapabilities?: GovernedRuntimeCapability[],
    input?: { now?: () => string },
  ) => GovernedRuntimeInvocationEligibility;
  buildIntent: (
    lane: GovernedOperationLane,
    input?: BuildRuntimeExecutionIntentInput,
  ) => GovernedRuntimeExecutionIntent;
  buildRequest: (
    lane: GovernedOperationLane,
    input?: BuildRuntimeInvocationRequestInput,
  ) => GovernedRuntimeInvocationRequest;
  simulate: (
    lane: GovernedOperationLane,
    input?: SimulateRuntimeInvocationInput,
  ) => GovernedRuntimeSimulationResult;
};

// ---- Input types ----

export type BuildRuntimeExecutionIntentInput = {
  validationResultRefs?: string[];
  now?: () => string;
};

export type BuildRuntimeInvocationRequestInput = {
  requiredCapabilities?: GovernedRuntimeCapability[];
  validationResultRef?: string;
  proposedCommands?: GovernedRuntimeProposedCommand[];
  now?: () => string;
};

export type SimulateRuntimeInvocationInput = {
  requiredCapabilities?: GovernedRuntimeCapability[];
  validationResultRef?: string;
  proposedCommands?: GovernedRuntimeProposedCommand[];
  simulationNote?: string;
  now?: () => string;
};

// ---- Lane states that satisfy the readiness condition ----

const READY_LANE_STATES = new Set<GovernedLaneState>(["ready"]);

// ---- Public functions ----

export function checkRuntimeCapabilityMatch(
  assignment: Pick<GovernedOperationLane["runtimeAssignment"], "runtimeType" | "runtimeId" | "runtimeCapabilities">,
  requiredCapabilities: GovernedRuntimeCapability[] = [],
): GovernedRuntimeCapabilityMatch {
  const matched = requiredCapabilities.filter((cap) => assignment.runtimeCapabilities.includes(cap));
  const unmatched = requiredCapabilities.filter((cap) => !assignment.runtimeCapabilities.includes(cap));

  return {
    runtimeType: assignment.runtimeType,
    runtimeId: assignment.runtimeId,
    requiredCapabilities: [...requiredCapabilities],
    matchedCapabilities: matched,
    unmatchedCapabilities: unmatched,
    isMatch: unmatched.length === 0,
    matchRatio: requiredCapabilities.length === 0 ? 1 : matched.length / requiredCapabilities.length,
  };
}

export function checkRuntimeInvocationEligibility(
  lane: GovernedOperationLane,
  requiredCapabilities: GovernedRuntimeCapability[] = [],
  input: { now?: () => string } = {},
): GovernedRuntimeInvocationEligibility {
  const now = input.now ?? (() => new Date().toISOString());
  const assignment = lane.runtimeAssignment;
  const capabilityMatch = checkRuntimeCapabilityMatch(assignment, requiredCapabilities);
  const blockers: GovernedRuntimeEligibilityBlocker[] = [];

  // Lane state checks
  if (lane.laneState === "denied") {
    blockers.push("lane_denied");
  } else if (lane.laneState === "blocked") {
    blockers.push("lane_blocked");
  } else if (!READY_LANE_STATES.has(lane.laneState)) {
    blockers.push("lane_not_ready");
  }

  // Approval state checks
  if (lane.approvalState === "pending") {
    blockers.push("approval_pending");
  } else if (lane.approvalState === "rejected") {
    blockers.push("approval_rejected");
  }

  // Capability checks
  if (!capabilityMatch.isMatch) {
    blockers.push("capability_mismatch");
  }

  // eligible: true means IF execution were enabled, this lane could proceed.
  // executionAllowed: false is a separate structural constant — always false from this phase.
  const eligible = blockers.length === 0;

  return {
    adapterVersion: GOVERNED_RUNTIME_ADAPTER_VERSION,
    laneId: lane.laneId,
    runtimeType: assignment.runtimeType,
    runtimeId: assignment.runtimeId,
    laneState: lane.laneState,
    approvalState: lane.approvalState,
    capabilityMatch,
    eligible,
    blockers,
    executionAllowed: false,
    simulationOnly: true,
    checkedAt: now(),
    safetyBoundary: {
      eligibilityCheckOnly: true,
      runtimeInvocationEnabled: false,
      shellExecutionEnabled: false,
      networkExecutionEnabled: false,
      autonomousExecutionEnabled: false,
    },
  };
}

export function buildRuntimeExecutionIntent(
  lane: GovernedOperationLane,
  input: BuildRuntimeExecutionIntentInput = {},
): GovernedRuntimeExecutionIntent {
  const now = input.now ?? (() => new Date().toISOString());
  const assignment = lane.runtimeAssignment;
  const intentId = `intent-${timestampId(now)}-${slugify(assignment.runtimeType)}`;

  if (!INTENT_ID_PATTERN.test(intentId)) {
    throw new Error(`Generated intent id '${intentId}' does not match the required intent-<id> format.`);
  }

  const intentStatus: GovernedRuntimeExecutionIntentStatus =
    lane.laneState === "denied"  ? "denied"
    : lane.laneState === "blocked" ? "blocked"
    : lane.laneState === "ready" && (lane.approvalState === "approved" || lane.approvalState === "not_required")
      ? "simulation_ready"
    : "pending";

  return {
    adapterVersion: GOVERNED_RUNTIME_ADAPTER_VERSION,
    intentId,
    laneId: lane.laneId,
    sandboxId: assignment.sandboxId,
    runtimeType: assignment.runtimeType,
    runtimeId: assignment.runtimeId,
    operationIds: lane.operations.map((op) => op.operationId),
    validationResultRefs: input.validationResultRefs ?? [],
    intentStatus,
    createdAt: now(),
    executionAllowed: false,
    dryRun: true,
    safetyBoundary: {
      intentOnlyNoExecution: true,
      runtimeInvocationEnabled: false,
      shellExecutionEnabled: false,
      networkExecutionEnabled: false,
      executionOccurred: false,
    },
  };
}

export function buildRuntimeInvocationRequest(
  lane: GovernedOperationLane,
  input: BuildRuntimeInvocationRequestInput = {},
): GovernedRuntimeInvocationRequest {
  const now = input.now ?? (() => new Date().toISOString());
  const assignment = lane.runtimeAssignment;
  const requestId = `req-${timestampId(now)}-${slugify(assignment.runtimeType)}`;

  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error(`Generated request id '${requestId}' does not match the required req-<id> format.`);
  }

  // Derive proposed commands from validated operations if not explicitly provided
  const proposedCommands: GovernedRuntimeProposedCommand[] = input.proposedCommands
    ?? lane.operations.flatMap((op) =>
      op.validationResult?.commandPolicyResults.map((r) => ({
        command: r.command,
        workingDirectory: r.workingDirectory.sandboxRelativePath,
        requiresApproval: r.requiresApproval,
      })) ?? []
    );

  return {
    adapterVersion: GOVERNED_RUNTIME_ADAPTER_VERSION,
    requestId,
    laneId: lane.laneId,
    sandboxId: assignment.sandboxId,
    runtimeType: assignment.runtimeType,
    runtimeId: assignment.runtimeId,
    proposedCommands,
    requiredCapabilities: [...(input.requiredCapabilities ?? [])],
    validationResultRef: input.validationResultRef,
    approvalState: lane.approvalState,
    builtAt: now(),
    executionAllowed: false,
    dryRun: true,
    safetyBoundary: {
      requestOnlyNoDispatch: true,
      runtimeInvocationEnabled: false,
      shellExecutionEnabled: false,
      networkExecutionEnabled: false,
      workspaceMutationEnabled: false,
    },
  };
}

export function simulateRuntimeInvocation(
  lane: GovernedOperationLane,
  input: SimulateRuntimeInvocationInput = {},
): GovernedRuntimeSimulationResult {
  const now = input.now ?? (() => new Date().toISOString());
  const assignment = lane.runtimeAssignment;
  const simulationId = `sim-${timestampId(now)}-${slugify(assignment.runtimeType)}`;

  if (!SIMULATION_ID_PATTERN.test(simulationId)) {
    throw new Error(`Generated simulation id '${simulationId}' does not match the required sim-<id> format.`);
  }

  // Step 1: Check invocation eligibility
  const eligibility = checkRuntimeInvocationEligibility(lane, input.requiredCapabilities ?? [], { now });

  // Step 2: Build execution intent (what AI-E would ask the runtime to do)
  const executionIntent = buildRuntimeExecutionIntent(lane, {
    validationResultRefs: input.validationResultRef ? [input.validationResultRef] : [],
    now,
  });

  // Step 3: Build invocation request only if eligible — this is what WOULD be sent, never dispatched
  const invocationRequest = eligibility.eligible
    ? buildRuntimeInvocationRequest(lane, {
        requiredCapabilities: input.requiredCapabilities,
        validationResultRef: input.validationResultRef,
        proposedCommands: input.proposedCommands,
        now,
      })
    : null;

  // Step 4: Determine result status
  const resultStatus: GovernedRuntimeInvocationResultStatus =
    lane.laneState === "denied"   ? "denied"
    : !eligibility.eligible       ? "eligibility_blocked"
    : "simulated";

  const resultId = `req-${timestampId(now)}-${slugify(`${assignment.runtimeType}-result`)}`;
  const result: GovernedRuntimeInvocationResult = {
    adapterVersion: GOVERNED_RUNTIME_ADAPTER_VERSION,
    resultId,
    requestId: invocationRequest?.requestId ?? resultId,
    laneId: lane.laneId,
    runtimeType: assignment.runtimeType,
    status: resultStatus,
    executionOccurred: false,
    dryRun: true,
    simulatedOutput: resultStatus === "simulated"
      ? `[SIMULATION] ${assignment.runtimeType} would process ${lane.operations.length} operation(s) in sandbox '${assignment.sandboxId}'. No execution occurred.`
      : undefined,
    producedAt: now(),
    safetyBoundary: {
      resultOnly: true,
      runtimeInvocationEnabled: false,
      shellExecutionEnabled: false,
      networkExecutionEnabled: false,
      executionOccurred: false,
    },
  };

  // Step 5: Compose simulation note
  const blockerSummary = eligibility.blockers.join(", ");
  const simulationNote = input.simulationNote
    ?? (resultStatus === "simulated"
      ? `Simulation complete. ${assignment.runtimeType} is eligible for invocation pending execution enablement. ` +
        `Human operator must enable execution in a future governed phase. No invocation occurred.`
      : `Simulation blocked [${blockerSummary}]. No invocation was attempted.`);

  // Step 6: Return simulation result — executionOccurred and executionAllowed always false
  return {
    adapterVersion: GOVERNED_RUNTIME_ADAPTER_VERSION,
    simulationId,
    laneId: lane.laneId,
    runtimeType: assignment.runtimeType,
    runtimeId: assignment.runtimeId,
    simulatedAt: now(),
    eligibility,
    executionIntent,
    invocationRequest,
    result,
    executionOccurred: false,
    executionAllowed: false,
    dryRun: true,
    simulationNote,
    safetyBoundary: {
      adapterVersion: GOVERNED_RUNTIME_ADAPTER_VERSION,
      simulationOnly: true,
      runtimeInvocationEnabled: false,
      shellExecutionEnabled: false,
      networkExecutionEnabled: false,
      workspaceMutationEnabled: false,
      rollbackExecutionEnabled: false,
      autonomousExecutionEnabled: false,
      executionOccurred: false,
      humanAuthorityRequired: true,
    },
  };
}

export function createGovernedRuntimeAdapter(input: {
  runtimeType: GovernedRuntimeType;
  runtimeId: string;
  capabilities: GovernedRuntimeCapability[];
}): GovernedRuntimeAdapter {
  return {
    adapterVersion: GOVERNED_RUNTIME_ADAPTER_VERSION,
    runtimeType: input.runtimeType,
    runtimeId: input.runtimeId,
    capabilities: [...input.capabilities],
    checkEligibility: (lane, requiredCapabilities, opts) =>
      checkRuntimeInvocationEligibility(lane, requiredCapabilities, opts),
    buildIntent: (lane, opts) =>
      buildRuntimeExecutionIntent(lane, opts),
    buildRequest: (lane, opts) =>
      buildRuntimeInvocationRequest(lane, opts),
    simulate: (lane, opts) =>
      simulateRuntimeInvocation(lane, opts),
  };
}
