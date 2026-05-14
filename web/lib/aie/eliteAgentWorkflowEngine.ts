export type EliteAgentWorkflowStageType =
  | "READ_REPO_CONTEXT"
  | "PREPARE_PATCH"
  | "VALIDATE_PATCH"
  | "VERIFY_BUILD"
  | "GENERATE_REPORT"
  | "REQUEST_APPROVAL"
  | "BLOCKED_EXTERNAL_DEPENDENCY";

export type EliteAgentWorkflowLifecycleState =
  | "PENDING"
  | "APPROVED"
  | "RUNNING"
  | "VALIDATING"
  | "COMPLETED"
  | "FAILED"
  | "ROLLBACK_AVAILABLE"
  | "PAUSED"
  | "INTERRUPTED"
  | "RESUMABLE"
  | "BLOCKED";

export type EliteAgentWorkflowApprovalState = "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED" | "BLOCKED";
export type EliteAgentWorkflowValidationState = "NOT_REQUIRED" | "PENDING" | "SUCCESS" | "FAILED" | "BLOCKED";
export type EliteAgentWorkflowMutationPermission = "READ_ONLY" | "MUTATION_REQUIRES_APPROVAL" | "NO_MUTATION";
export type EliteAgentApprovalGateState = "APPROVAL_REQUIRED" | "WAITING_FOR_APPROVAL" | "APPROVED_BY_OPERATOR" | "APPROVAL_DENIED";

export type EliteAgentWorkflowStageDefinition = {
  type: EliteAgentWorkflowStageType;
  title: string;
  mutationPermission: EliteAgentWorkflowMutationPermission;
  validationRequired: boolean;
  allowedPathScope: string[];
  rollbackSupported: boolean;
  externalDependencyRequired: boolean;
};

export type EliteAgentWorkflowStage = EliteAgentWorkflowStageDefinition & {
  stageId: string;
  order: number;
  lifecycleState: EliteAgentWorkflowLifecycleState;
  approvalState: EliteAgentWorkflowApprovalState;
  validationState: EliteAgentWorkflowValidationState;
  blockedReason: string | null;
  rollbackAvailable: boolean;
  rollbackPrepared: boolean;
  rollbackReason: string | null;
};

export type EliteAgentWorkflowLogEntry = {
  at: string;
  stageId: string | null;
  stageType: EliteAgentWorkflowStageType | null;
  lifecycleState: EliteAgentWorkflowLifecycleState;
  approvalState: EliteAgentWorkflowApprovalState | null;
  validationState: EliteAgentWorkflowValidationState | null;
  message: string;
  rollbackAvailable: boolean;
};

export type EliteAgentWorkflowApprovalEvent = {
  at: string;
  stageId: string;
  stageType: EliteAgentWorkflowStageType;
  approvalGateState: EliteAgentApprovalGateState;
  approvalState: EliteAgentWorkflowApprovalState;
  message: string;
  resultingWorkflowState: EliteAgentWorkflowSessionStatus;
};

export type EliteAgentWorkflowSessionStatus = "PENDING" | "RUNNING" | "PARTIALLY_COMPLETED" | "COMPLETED" | "BLOCKED" | "FAILED" | "ROLLBACK_AVAILABLE" | "PAUSED" | "INTERRUPTED" | "RESUMABLE";

export type EliteAgentWorkflowSession = {
  workflowSessionId: string;
  agentId: string;
  prompt: string;
  status: EliteAgentWorkflowSessionStatus;
  currentStageId: string | null;
  stages: EliteAgentWorkflowStage[];
  allowedPaths: string[];
  forbiddenPaths: string[];
  completedStageCount: number;
  blockedStageReason: string | null;
  rollbackAvailable: boolean;
  rollbackPrepared: boolean;
  rollbackReason: string | null;
  partialCompletion: boolean;
  resumeEligible: boolean;
  resumeFromStageId: string | null;
  resumeReason: string | null;
  deterministicSelectionReason: string;
  truthfulCapabilityBoundary: string;
  logs: EliteAgentWorkflowLogEntry[];
  approvalEvents: EliteAgentWorkflowApprovalEvent[];
};

export type BuildEliteAgentWorkflowInput = {
  agentId: string;
  prompt: string;
  allowedPaths: string[];
  forbiddenPaths?: string[];
  now?: string;
};

export type AdvanceEliteAgentWorkflowInput = {
  stageId: string;
  action: "APPROVE_STAGE" | "DENY_STAGE_APPROVAL" | "START_STAGE" | "BEGIN_VALIDATION" | "COMPLETE_STAGE" | "FAIL_STAGE" | "BLOCK_STAGE" | "PREPARE_ROLLBACK" | "PAUSE_WORKFLOW" | "INTERRUPT_WORKFLOW" | "MARK_RESUMABLE";
  reason?: string;
  now?: string;
};

export type EliteAgentWorkflowSummary = {
  workflowSessionId: string;
  status: EliteAgentWorkflowSessionStatus;
  currentStage: EliteAgentWorkflowStageType | null;
  stageTypes: EliteAgentWorkflowStageType[];
  completedStageCount: number;
  blockedStageReason: string | null;
  approvalCheckpoints: Array<{ stageId: string; stageType: EliteAgentWorkflowStageType; approvalState: EliteAgentWorkflowApprovalState }>;
  validationCheckpoints: Array<{ stageId: string; stageType: EliteAgentWorkflowStageType; validationState: EliteAgentWorkflowValidationState }>;
  rollbackAvailable: boolean;
  rollbackPrepared: boolean;
  rollbackReason: string | null;
  partialCompletion: boolean;
  resumeEligible: boolean;
  resumeFromStage: EliteAgentWorkflowStageType | null;
  resumeReason: string | null;
  truthfulCapabilityBoundary: string;
};

export type EliteAgentBlockedWorkflowRecoveryKind = "automatic_patch_application" | "external_runtime_dependency" | "missing_approval" | "general_blocker";

export type EliteAgentBlockedWorkflowRecoveryActionId =
  | "PREPARE_SAFE_PATCH_INSTEAD"
  | "REQUEST_APPROVAL"
  | "EXPLAIN_BLOCKER"
  | "SHOW_REQUIRED_RUNTIME"
  | "CONVERT_TO_SAFE_PLANNING_WORKFLOW"
  | "REVIEW_SCOPE";

export type EliteAgentBlockedWorkflowRecoveryGuidance = {
  kind: EliteAgentBlockedWorkflowRecoveryKind;
  title: "Safe Recovery Path";
  blockedExplanation: string;
  safetyRuleTriggered: string;
  safeAlternative: string;
  beforeProceeding: string;
  suggestedRecovery: string;
  actions: Array<{
    id: EliteAgentBlockedWorkflowRecoveryActionId;
    label: string;
    description: string;
  }>;
  technicalDetail: string;
};

export type EliteAgentApprovalGateGuidance = {
  title: "Approval Required";
  approvalGateState: EliteAgentApprovalGateState;
  actionBeingApproved: string;
  workflowStage: EliteAgentWorkflowStageType;
  stageId: string;
  allowedPathScope: string[];
  mutationPermission: EliteAgentWorkflowMutationPermission;
  validationRequirement: string;
  rollbackAvailability: string;
  riskLevel: "low" | "moderate" | "high";
  whatHappensAfterApproval: string;
  whyApprovalRequired: string;
  whatCouldGoWrong: string;
  allowedToDo: string;
  notAllowedToDo: string;
  validationAfterward: string;
};

const TRUTHFUL_WORKFLOW_BOUNDARY = "AI-E-lite Phase 3 provides supervised multi-step workflow continuity with bounded paths, approval checkpoints, validation checkpoints, resumable state tracking, and rollback preparation. It does not provide unrestricted repo control or unattended operation.";

const DEFAULT_FORBIDDEN_PATHS = [".git", "node_modules", "web/node_modules", ".env", "web/.env", "package-lock.json"];

const STAGE_DEFINITIONS: Record<EliteAgentWorkflowStageType, Omit<EliteAgentWorkflowStageDefinition, "allowedPathScope">> = {
  READ_REPO_CONTEXT: {
    type: "READ_REPO_CONTEXT",
    title: "Read repo context",
    mutationPermission: "READ_ONLY",
    validationRequired: false,
    rollbackSupported: false,
    externalDependencyRequired: false,
  },
  PREPARE_PATCH: {
    type: "PREPARE_PATCH",
    title: "Prepare scoped patch",
    mutationPermission: "READ_ONLY",
    validationRequired: false,
    rollbackSupported: true,
    externalDependencyRequired: false,
  },
  VALIDATE_PATCH: {
    type: "VALIDATE_PATCH",
    title: "Validate patch evidence",
    mutationPermission: "READ_ONLY",
    validationRequired: true,
    rollbackSupported: false,
    externalDependencyRequired: false,
  },
  VERIFY_BUILD: {
    type: "VERIFY_BUILD",
    title: "Verify build or targeted checks",
    mutationPermission: "READ_ONLY",
    validationRequired: true,
    rollbackSupported: false,
    externalDependencyRequired: false,
  },
  GENERATE_REPORT: {
    type: "GENERATE_REPORT",
    title: "Generate operator report",
    mutationPermission: "READ_ONLY",
    validationRequired: false,
    rollbackSupported: false,
    externalDependencyRequired: false,
  },
  REQUEST_APPROVAL: {
    type: "REQUEST_APPROVAL",
    title: "Request operator approval",
    mutationPermission: "NO_MUTATION",
    validationRequired: false,
    rollbackSupported: false,
    externalDependencyRequired: true,
  },
  BLOCKED_EXTERNAL_DEPENDENCY: {
    type: "BLOCKED_EXTERNAL_DEPENDENCY",
    title: "Blocked on external dependency",
    mutationPermission: "NO_MUTATION",
    validationRequired: false,
    rollbackSupported: false,
    externalDependencyRequired: true,
  },
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function isPathWithin(candidate: string, scope: string): boolean {
  const normalizedCandidate = normalizeRelativePath(candidate);
  const normalizedScope = normalizeRelativePath(scope).replace(/\/$/, "");
  return normalizedCandidate === normalizedScope || normalizedCandidate.startsWith(`${normalizedScope}/`);
}

function isUnsafePath(value: string): boolean {
  const normalized = normalizeRelativePath(value);
  return !normalized || normalized.startsWith("../") || normalized.includes("/../") || /^[a-zA-Z]:\//.test(normalized);
}

function mergeUnique(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeRelativePath).filter(Boolean)));
}

function createWorkflowSessionId(agentId: string, now: string): string {
  const timestamp = now.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  const normalizedAgent = normalizeText(agentId).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
  return `elite-workflow-${normalizedAgent}-${timestamp}`;
}

function selectWorkflowStageTypes(prompt: string): { stageTypes: EliteAgentWorkflowStageType[]; reason: string } {
  const normalizedPrompt = normalizeText(prompt).toLowerCase();
  if (/\b(dummy|demo|simulate|simulated|simulation|tutorial)\b.*\b(workflow|progress|completion|lifecycle)\b|\b(progress\s+bar|completion\s+state|ux\s+test)\b/.test(normalizedPrompt)) {
    return {
      stageTypes: ["READ_REPO_CONTEXT", "VERIFY_BUILD", "GENERATE_REPORT"],
      reason: "Demo workflow prompt selected a simulation-safe progression chain for UX pacing and completion-state testing.",
    };
  }
  if (/apply|auto.?apply|automatically|write it|make the change/.test(normalizedPrompt)) {
    return {
      stageTypes: ["BLOCKED_EXTERNAL_DEPENDENCY"],
      reason: "Mutation request was routed to a blocked external-dependency workflow until an approved runtime route is supplied.",
    };
  }
  if (/verify|build|test|latest gameplay patch|validation/.test(normalizedPrompt)) {
    return {
      stageTypes: ["VERIFY_BUILD", "VALIDATE_PATCH", "GENERATE_REPORT"],
      reason: "Verification prompt selected build verification, patch validation, and report generation.",
    };
  }
  if (/prepare|patch|movement|fix|change|modify|update|implement|increase|spawn|zombies?|enemy\s+spawner|gameplay\s+loop|round\s+\d|rounds?/.test(normalizedPrompt)) {
    return {
      stageTypes: ["REQUEST_APPROVAL", "READ_REPO_CONTEXT", "PREPARE_PATCH", "GENERATE_REPORT"],
      reason: "Concrete game-dev change prompt selected session-level approval before context reading, scoped patch preparation, and operator reporting.",
    };
  }
  if (/inspect|inventory|read|review|context/.test(normalizedPrompt)) {
    return {
      stageTypes: ["READ_REPO_CONTEXT", "GENERATE_REPORT"],
      reason: "Inspection prompt selected read-only repo context and report generation.",
    };
  }
  return {
    stageTypes: ["READ_REPO_CONTEXT", "GENERATE_REPORT"],
    reason: "Default supervised workflow selected a read-only inspection and report chain.",
  };
}

function isAutomaticPatchApplicationPrompt(prompt: string): boolean {
  const normalizedPrompt = normalizeText(prompt).toLowerCase();
  return /(apply|auto.?apply|automatically|write it|make the change)/.test(normalizedPrompt) && /patch|change|fix|mutation|file/.test(normalizedPrompt);
}

function isExternalRuntimeDependencyPrompt(prompt: string): boolean {
  const normalizedPrompt = normalizeText(prompt).toLowerCase();
  return /unity|shell|terminal|runtime|external|dependency|execute|run/.test(normalizedPrompt) && !isAutomaticPatchApplicationPrompt(prompt);
}

function validateAllowedPaths(allowedPaths: string[], forbiddenPaths: string[]): { allowedPaths: string[]; blockers: string[] } {
  const normalizedAllowed = mergeUnique(allowedPaths);
  const normalizedForbidden = mergeUnique([...DEFAULT_FORBIDDEN_PATHS, ...forbiddenPaths]);
  const blockers: string[] = [];
  for (const allowedPath of normalizedAllowed) {
    if (isUnsafePath(allowedPath)) {
      blockers.push(`Unsafe workflow path rejected: ${allowedPath}`);
    }
    if (normalizedForbidden.some((forbiddenPath) => isPathWithin(allowedPath, forbiddenPath))) {
      blockers.push(`Workflow path is blocked by policy: ${allowedPath}`);
    }
  }
  return { allowedPaths: normalizedAllowed, blockers };
}

function createStage(type: EliteAgentWorkflowStageType, order: number, allowedPaths: string[], blockedReason?: string): EliteAgentWorkflowStage {
  const definition = STAGE_DEFINITIONS[type];
  const requiresApproval = definition.mutationPermission === "MUTATION_REQUIRES_APPROVAL" || type === "REQUEST_APPROVAL";
  const isBlocked = type === "BLOCKED_EXTERNAL_DEPENDENCY" || Boolean(blockedReason);
  return {
    ...definition,
    allowedPathScope: allowedPaths,
    stageId: `stage-${order + 1}-${type.toLowerCase().replace(/_/g, "-")}`,
    order,
    lifecycleState: isBlocked ? "BLOCKED" : "PENDING",
    approvalState: isBlocked ? "BLOCKED" : requiresApproval ? "PENDING" : "NOT_REQUIRED",
    validationState: isBlocked ? "BLOCKED" : definition.validationRequired ? "PENDING" : "NOT_REQUIRED",
    blockedReason: isBlocked ? blockedReason ?? "This workflow requires an external approval/runtime route before execution." : null,
    rollbackAvailable: false,
    rollbackPrepared: false,
    rollbackReason: null,
  };
}

function currentStage(session: EliteAgentWorkflowSession): EliteAgentWorkflowStage | undefined {
  return session.stages.find((stage) => stage.stageId === session.currentStageId);
}

export function isEliteAgentWorkflowStageAutoAdvancable(stage: EliteAgentWorkflowStage | null | undefined): boolean {
  if (!stage) {
    return false;
  }
  if (stage.lifecycleState !== "PENDING" && stage.lifecycleState !== "RUNNING") {
    return false;
  }
  return stage.mutationPermission !== "MUTATION_REQUIRES_APPROVAL"
    && stage.approvalState === "NOT_REQUIRED"
    && stage.validationRequired === false
    && stage.externalDependencyRequired === false;
}

function cloneSession(session: EliteAgentWorkflowSession): EliteAgentWorkflowSession {
  return JSON.parse(JSON.stringify(session)) as EliteAgentWorkflowSession;
}

function createLog(now: string, stage: EliteAgentWorkflowStage | null, message: string, lifecycleState?: EliteAgentWorkflowLifecycleState): EliteAgentWorkflowLogEntry {
  return {
    at: now,
    stageId: stage?.stageId ?? null,
    stageType: stage?.type ?? null,
    lifecycleState: lifecycleState ?? stage?.lifecycleState ?? "PENDING",
    approvalState: stage?.approvalState ?? null,
    validationState: stage?.validationState ?? null,
    message,
    rollbackAvailable: stage?.rollbackAvailable ?? false,
  };
}

function approvalGateStateForApprovalState(approvalState: EliteAgentWorkflowApprovalState): EliteAgentApprovalGateState {
  if (approvalState === "APPROVED") {
    return "APPROVED_BY_OPERATOR";
  }
  if (approvalState === "REJECTED" || approvalState === "BLOCKED") {
    return "APPROVAL_DENIED";
  }
  if (approvalState === "PENDING") {
    return "WAITING_FOR_APPROVAL";
  }
  return "APPROVAL_REQUIRED";
}

function deriveSessionStatus(stages: EliteAgentWorkflowStage[]): EliteAgentWorkflowSessionStatus {
  if (stages.some((stage) => stage.lifecycleState === "INTERRUPTED")) {
    return "INTERRUPTED";
  }
  if (stages.some((stage) => stage.lifecycleState === "RESUMABLE")) {
    return "RESUMABLE";
  }
  if (stages.some((stage) => stage.lifecycleState === "PAUSED")) {
    return "PAUSED";
  }
  if (stages.some((stage) => stage.lifecycleState === "ROLLBACK_AVAILABLE")) {
    return "ROLLBACK_AVAILABLE";
  }
  if (stages.some((stage) => stage.lifecycleState === "FAILED")) {
    return "FAILED";
  }
  if (stages.some((stage) => stage.lifecycleState === "BLOCKED")) {
    return "BLOCKED";
  }
  if (stages.every((stage) => stage.lifecycleState === "COMPLETED")) {
    return "COMPLETED";
  }
  if (stages.some((stage) => stage.lifecycleState === "RUNNING" || stage.lifecycleState === "VALIDATING" || stage.lifecycleState === "APPROVED")) {
    return "RUNNING";
  }
  if (stages.some((stage) => stage.lifecycleState === "COMPLETED")) {
    return "PARTIALLY_COMPLETED";
  }
  return "PENDING";
}

function createApprovalEvent(now: string, stage: EliteAgentWorkflowStage, approvalGateState: EliteAgentApprovalGateState, message: string, stages: EliteAgentWorkflowStage[]): EliteAgentWorkflowApprovalEvent {
  return {
    at: now,
    stageId: stage.stageId,
    stageType: stage.type,
    approvalGateState,
    approvalState: stage.approvalState,
    message,
    resultingWorkflowState: deriveSessionStatus(stages),
  };
}

function createInitialApprovalEvents(now: string, stages: EliteAgentWorkflowStage[]): EliteAgentWorkflowApprovalEvent[] {
  return stages
    .filter((stage) => stage.approvalState === "PENDING")
    .map((stage) => createApprovalEvent(now, stage, "APPROVAL_REQUIRED", "Approval requested for supervised workflow stage.", stages));
}

function recomputeSession(session: EliteAgentWorkflowSession): EliteAgentWorkflowSession {
  const nextIncomplete = session.stages.find((stage) => stage.lifecycleState !== "COMPLETED" && stage.lifecycleState !== "BLOCKED" && stage.lifecycleState !== "FAILED" && stage.lifecycleState !== "ROLLBACK_AVAILABLE");
  const blockedStage = session.stages.find((stage) => stage.lifecycleState === "BLOCKED" || stage.lifecycleState === "FAILED" || stage.lifecycleState === "ROLLBACK_AVAILABLE" || stage.lifecycleState === "INTERRUPTED" || stage.lifecycleState === "PAUSED" || stage.lifecycleState === "RESUMABLE");
  const completedStageCount = session.stages.filter((stage) => stage.lifecycleState === "COMPLETED").length;
  const rollbackStage = session.stages.find((stage) => stage.rollbackAvailable || stage.rollbackPrepared);
  const resumableStage = session.stages.find((stage) => stage.lifecycleState === "RESUMABLE" || stage.lifecycleState === "PAUSED" || stage.lifecycleState === "INTERRUPTED");
  return {
    ...session,
    status: deriveSessionStatus(session.stages),
    currentStageId: nextIncomplete?.stageId ?? blockedStage?.stageId ?? null,
    completedStageCount,
    blockedStageReason: blockedStage?.blockedReason ?? null,
    rollbackAvailable: session.stages.some((stage) => stage.rollbackAvailable),
    rollbackPrepared: session.stages.some((stage) => stage.rollbackPrepared),
    rollbackReason: rollbackStage?.rollbackReason ?? null,
    partialCompletion: completedStageCount > 0 && completedStageCount < session.stages.length,
    resumeEligible: Boolean(resumableStage && resumableStage.lifecycleState !== "INTERRUPTED" && resumableStage.lifecycleState !== "BLOCKED"),
    resumeFromStageId: resumableStage?.stageId ?? null,
    resumeReason: resumableStage?.blockedReason ?? null,
  };
}

export function buildEliteAgentWorkflowSession(input: BuildEliteAgentWorkflowInput): EliteAgentWorkflowSession {
  const now = normalizeText(input.now) || new Date().toISOString();
  const forbiddenPaths = mergeUnique(input.forbiddenPaths ?? []);
  const { allowedPaths, blockers } = validateAllowedPaths(input.allowedPaths, forbiddenPaths);
  const selection = blockers.length > 0
    ? { stageTypes: ["BLOCKED_EXTERNAL_DEPENDENCY" as const], reason: blockers.join(" | ") }
    : selectWorkflowStageTypes(input.prompt);
  const stages = selection.stageTypes.map((type, index) => createStage(type, index, allowedPaths, blockers[index]));
  const session: EliteAgentWorkflowSession = {
    workflowSessionId: createWorkflowSessionId(input.agentId, now),
    agentId: input.agentId,
    prompt: input.prompt,
    status: "PENDING",
    currentStageId: stages[0]?.stageId ?? null,
    stages,
    allowedPaths,
    forbiddenPaths: mergeUnique([...DEFAULT_FORBIDDEN_PATHS, ...forbiddenPaths]),
    completedStageCount: 0,
    blockedStageReason: stages.find((stage) => stage.blockedReason)?.blockedReason ?? null,
    rollbackAvailable: false,
    rollbackPrepared: false,
    rollbackReason: null,
    partialCompletion: false,
    resumeEligible: false,
    resumeFromStageId: null,
    resumeReason: null,
    deterministicSelectionReason: selection.reason,
    truthfulCapabilityBoundary: TRUTHFUL_WORKFLOW_BOUNDARY,
    logs: [createLog(now, stages[0] ?? null, `Workflow created: ${selection.reason}`)],
    approvalEvents: createInitialApprovalEvents(now, stages),
  };
  return recomputeSession(session);
}

export function advanceEliteAgentWorkflow(session: EliteAgentWorkflowSession, input: AdvanceEliteAgentWorkflowInput): EliteAgentWorkflowSession {
  const now = normalizeText(input.now) || new Date().toISOString();
  const next = cloneSession(session);
  const stageIndex = next.stages.findIndex((stage) => stage.stageId === input.stageId);
  if (stageIndex < 0) {
    throw new Error(`Unknown workflow stage: ${input.stageId}`);
  }
  const stage = next.stages[stageIndex]!;
  const previousStage = stageIndex > 0 ? next.stages[stageIndex - 1] : null;
  if (stage.lifecycleState === "BLOCKED") {
    next.logs.push(createLog(now, stage, input.reason ?? "Blocked stage remained blocked.", "BLOCKED"));
    return recomputeSession(next);
  }
  if (previousStage && previousStage.lifecycleState !== "COMPLETED" && input.action !== "DENY_STAGE_APPROVAL") {
    throw new Error(`Unsafe workflow transition rejected: ${stage.stageId} cannot run before ${previousStage.stageId} completes.`);
  }
  if ((stage.lifecycleState === "PAUSED" || stage.lifecycleState === "INTERRUPTED") && input.action !== "MARK_RESUMABLE") {
    throw new Error(`Workflow stage ${stage.stageId} must be marked resumable before continuation.`);
  }
  if (stage.lifecycleState === "COMPLETED" && input.action !== "PREPARE_ROLLBACK") {
    throw new Error(`Unsafe workflow transition rejected: ${stage.stageId} is already completed.`);
  }

  if (input.action === "APPROVE_STAGE") {
    if (stage.approvalState === "NOT_REQUIRED") {
      throw new Error(`Approval is not required for stage ${stage.stageId}.`);
    }
    if (stage.approvalState === "REJECTED") {
      throw new Error(`Approval was denied for stage ${stage.stageId}; create a new supervised workflow before retrying.`);
    }
    stage.approvalState = "APPROVED";
    if (stage.type === "REQUEST_APPROVAL") {
      stage.lifecycleState = "COMPLETED";
    }
    next.logs.push(createLog(now, stage, input.reason ?? "Stage approved by operator checkpoint.", stage.lifecycleState));
    next.approvalEvents = [...(next.approvalEvents ?? []), createApprovalEvent(now, stage, "APPROVED_BY_OPERATOR", input.reason ?? "Approval granted by operator for this supervised stage only.", next.stages)];
  }

  if (input.action === "DENY_STAGE_APPROVAL") {
    if (stage.approvalState === "NOT_REQUIRED") {
      throw new Error(`Approval is not required for stage ${stage.stageId}.`);
    }
    stage.approvalState = "REJECTED";
    stage.lifecycleState = "BLOCKED";
    stage.blockedReason = input.reason ?? "Approval denied by operator; workflow remains safely stopped.";
    next.logs.push(createLog(now, stage, stage.blockedReason, "BLOCKED"));
    next.approvalEvents = [...(next.approvalEvents ?? []), createApprovalEvent(now, stage, "APPROVAL_DENIED", stage.blockedReason, next.stages)];
    return recomputeSession(next);
  }

  if (input.action === "START_STAGE") {
    if (stage.mutationPermission === "MUTATION_REQUIRES_APPROVAL" && stage.approvalState !== "APPROVED") {
      stage.lifecycleState = "BLOCKED";
      stage.approvalState = "BLOCKED";
      stage.blockedReason = "Mutation-capable stage cannot start until explicit operator approval is recorded.";
      next.logs.push(createLog(now, stage, stage.blockedReason, "BLOCKED"));
        next.approvalEvents = [...(next.approvalEvents ?? []), createApprovalEvent(now, stage, "WAITING_FOR_APPROVAL", stage.blockedReason, next.stages)];
      return recomputeSession(next);
    }
    stage.lifecycleState = "RUNNING";
    next.logs.push(createLog(now, stage, input.reason ?? "Stage started inside supervised workflow order."));
  }

  if (input.action === "BEGIN_VALIDATION") {
    if (!stage.validationRequired) {
      throw new Error(`Validation is not required for stage ${stage.stageId}.`);
    }
    if (stage.lifecycleState !== "RUNNING") {
      throw new Error(`Validation cannot begin until stage ${stage.stageId} is running.`);
    }
    stage.lifecycleState = "VALIDATING";
    stage.validationState = "PENDING";
    next.logs.push(createLog(now, stage, input.reason ?? "Validation checkpoint opened."));
  }

  if (input.action === "COMPLETE_STAGE") {
    if (stage.validationRequired && stage.validationState !== "SUCCESS") {
      stage.lifecycleState = "BLOCKED";
      stage.validationState = "BLOCKED";
      stage.blockedReason = "Validation-required stage cannot complete until validation succeeds.";
      next.logs.push(createLog(now, stage, stage.blockedReason, "BLOCKED"));
      return recomputeSession(next);
    }
    stage.lifecycleState = "COMPLETED";
    next.logs.push(createLog(now, stage, input.reason ?? "Stage completed."));
  }

  if (input.action === "FAIL_STAGE") {
    stage.lifecycleState = "FAILED";
    stage.validationState = stage.validationRequired ? "FAILED" : stage.validationState;
    stage.blockedReason = input.reason ?? "Stage failed inside supervised workflow.";
    if (stage.rollbackSupported) {
      stage.lifecycleState = "ROLLBACK_AVAILABLE";
      stage.rollbackAvailable = true;
      stage.rollbackReason = stage.blockedReason;
    }
    next.logs.push(createLog(now, stage, stage.blockedReason, stage.lifecycleState));
  }

  if (input.action === "BLOCK_STAGE") {
    stage.lifecycleState = "BLOCKED";
    stage.blockedReason = input.reason ?? "Stage blocked by supervised workflow policy.";
    stage.approvalState = stage.approvalState === "PENDING" ? "BLOCKED" : stage.approvalState;
    stage.validationState = stage.validationState === "PENDING" ? "BLOCKED" : stage.validationState;
    next.logs.push(createLog(now, stage, stage.blockedReason, "BLOCKED"));
  }

  if (input.action === "PREPARE_ROLLBACK") {
    if (!stage.rollbackSupported) {
      throw new Error(`Rollback preparation is not supported for stage ${stage.stageId}.`);
    }
    stage.rollbackAvailable = true;
    stage.rollbackPrepared = true;
    stage.rollbackReason = input.reason ?? "Rollback prepared for operator review; no autonomous rollback execution was performed.";
    if (stage.lifecycleState !== "COMPLETED") {
      stage.lifecycleState = "ROLLBACK_AVAILABLE";
    }
    next.logs.push(createLog(now, stage, stage.rollbackReason, stage.lifecycleState));
  }

  if (input.action === "PAUSE_WORKFLOW") {
    stage.lifecycleState = "PAUSED";
    stage.blockedReason = input.reason ?? "Workflow paused by operator; resume is allowed from this stage under the same governance rules.";
    next.logs.push(createLog(now, stage, stage.blockedReason, "PAUSED"));
  }

  if (input.action === "INTERRUPT_WORKFLOW") {
    stage.lifecycleState = "INTERRUPTED";
    stage.blockedReason = input.reason ?? "Workflow interrupted before completion; operator review is required before resume eligibility can be restored.";
    next.logs.push(createLog(now, stage, stage.blockedReason, "INTERRUPTED"));
  }

  if (input.action === "MARK_RESUMABLE") {
    if (stage.lifecycleState !== "PAUSED" && stage.lifecycleState !== "INTERRUPTED" && stage.lifecycleState !== "RESUMABLE") {
      throw new Error(`Workflow stage ${stage.stageId} is not paused or interrupted and cannot be marked resumable.`);
    }
    stage.lifecycleState = "RESUMABLE";
    stage.blockedReason = input.reason ?? "This workflow can be resumed from this stage while preserving approval and validation rules.";
    next.logs.push(createLog(now, stage, stage.blockedReason, "RESUMABLE"));
  }

  if (stage.lifecycleState === "VALIDATING" && input.action === "BEGIN_VALIDATION") {
    stage.validationState = "PENDING";
  }
  if (input.action === "COMPLETE_STAGE" && stage.validationRequired) {
    stage.validationState = "SUCCESS";
  }

  return recomputeSession(next);
}

export function resumeEliteAgentWorkflow(session: EliteAgentWorkflowSession, params?: { now?: string; reason?: string }): EliteAgentWorkflowSession {
  const now = normalizeText(params?.now) || new Date().toISOString();
  const next = cloneSession(session);
  const stage = next.stages.find((candidate) => candidate.stageId === next.resumeFromStageId || candidate.lifecycleState === "RESUMABLE");
  if (!stage) {
    throw new Error("No resumable workflow stage is available.");
  }
  if (stage.lifecycleState !== "RESUMABLE") {
    throw new Error(`Workflow stage ${stage.stageId} is not marked resumable.`);
  }
  if (stage.mutationPermission === "MUTATION_REQUIRES_APPROVAL" && stage.approvalState !== "APPROVED") {
    stage.lifecycleState = "BLOCKED";
    stage.approvalState = "BLOCKED";
    stage.blockedReason = "Resumed workflow remains blocked pending operator approval for the mutation-capable stage.";
    next.logs.push(createLog(now, stage, stage.blockedReason, "BLOCKED"));
    return recomputeSession(next);
  }
  stage.lifecycleState = "RUNNING";
  stage.blockedReason = null;
  next.logs.push(createLog(now, stage, params?.reason ?? "Workflow resumed from recorded history under the same governance rules.", "RUNNING"));
  return recomputeSession(next);
}

export function markEliteAgentWorkflowValidation(session: EliteAgentWorkflowSession, params: {
  stageId: string;
  validationState: Extract<EliteAgentWorkflowValidationState, "SUCCESS" | "FAILED" | "BLOCKED">;
  reason?: string;
  now?: string;
}): EliteAgentWorkflowSession {
  const now = normalizeText(params.now) || new Date().toISOString();
  const next = cloneSession(session);
  const stage = next.stages.find((candidate) => candidate.stageId === params.stageId);
  if (!stage) {
    throw new Error(`Unknown workflow stage: ${params.stageId}`);
  }
  if (!stage.validationRequired) {
    throw new Error(`Validation is not required for stage ${stage.stageId}.`);
  }
  if (stage.lifecycleState !== "VALIDATING") {
    throw new Error(`Validation result cannot be recorded until stage ${stage.stageId} is validating.`);
  }
  stage.validationState = params.validationState;
  if (params.validationState === "SUCCESS") {
    next.logs.push(createLog(now, stage, params.reason ?? "Validation checkpoint passed."));
    return recomputeSession(next);
  }
  stage.lifecycleState = params.validationState === "FAILED" && stage.rollbackSupported ? "ROLLBACK_AVAILABLE" : "BLOCKED";
  stage.blockedReason = params.reason ?? "Validation checkpoint blocked the workflow.";
  stage.rollbackAvailable = stage.rollbackSupported;
  stage.rollbackReason = stage.rollbackSupported ? stage.blockedReason : null;
  next.logs.push(createLog(now, stage, stage.blockedReason, stage.lifecycleState));
  return recomputeSession(next);
}

export function summarizeEliteAgentWorkflow(session: EliteAgentWorkflowSession): EliteAgentWorkflowSummary {
  const current = currentStage(session);
  return {
    workflowSessionId: session.workflowSessionId,
    status: session.status,
    currentStage: current?.type ?? null,
    stageTypes: session.stages.map((stage) => stage.type),
    completedStageCount: session.completedStageCount,
    blockedStageReason: session.blockedStageReason,
    approvalCheckpoints: session.stages
      .filter((stage) => stage.approvalState !== "NOT_REQUIRED")
      .map((stage) => ({ stageId: stage.stageId, stageType: stage.type, approvalState: stage.approvalState })),
    validationCheckpoints: session.stages
      .filter((stage) => stage.validationState !== "NOT_REQUIRED")
      .map((stage) => ({ stageId: stage.stageId, stageType: stage.type, validationState: stage.validationState })),
    rollbackAvailable: session.rollbackAvailable,
    rollbackPrepared: session.rollbackPrepared,
    rollbackReason: session.rollbackReason,
    partialCompletion: session.partialCompletion,
    resumeEligible: session.resumeEligible,
    resumeFromStage: current?.type ?? null,
    resumeReason: session.resumeReason,
    truthfulCapabilityBoundary: session.truthfulCapabilityBoundary,
  };
}

export function buildEliteAgentBlockedWorkflowRecoveryGuidance(session: EliteAgentWorkflowSession): EliteAgentBlockedWorkflowRecoveryGuidance | null {
  const summary = summarizeEliteAgentWorkflow(session);
  if (summary.status !== "BLOCKED") {
    return null;
  }
  const blockedStage = session.stages.find((stage) => stage.lifecycleState === "BLOCKED") ?? session.stages.find((stage) => stage.blockedReason) ?? null;
  const blockedReason = summary.blockedStageReason ?? blockedStage?.blockedReason ?? "A governance requirement or external dependency is missing.";
  const hasMutationApprovalBlocker = Boolean(blockedStage?.mutationPermission === "MUTATION_REQUIRES_APPROVAL" || /approval/i.test(blockedReason));
  const kind: EliteAgentBlockedWorkflowRecoveryKind = isAutomaticPatchApplicationPrompt(session.prompt)
    ? "automatic_patch_application"
    : isExternalRuntimeDependencyPrompt(session.prompt) || blockedStage?.type === "BLOCKED_EXTERNAL_DEPENDENCY"
      ? "external_runtime_dependency"
      : hasMutationApprovalBlocker
        ? "missing_approval"
        : "general_blocker";

  if (kind === "automatic_patch_application") {
    return {
      kind,
      title: "Safe Recovery Path",
      blockedExplanation: `Blocked: ${blockedReason}`,
      safetyRuleTriggered: "Automatic file mutation requires an approved operator route before application.",
      safeAlternative: "Prepare the patch first, then request approval before applying it.",
      beforeProceeding: "AI-E must have explicit operator approval before any mutation-capable application step can continue.",
      suggestedRecovery: "Prepare a safe patch workflow or request approval.",
      actions: [
        { id: "PREPARE_SAFE_PATCH_INSTEAD", label: "Prepare Safe Patch Instead", description: "Create a safe patch-preparation workflow without applying files." },
        { id: "REQUEST_APPROVAL", label: "Request Approval", description: "Clarify that approval is required before automatic application can proceed." },
        { id: "EXPLAIN_BLOCKER", label: "Explain Blocker", description: "Explain the blocker, safety rule, safe alternative, and approval requirement." },
      ],
      technicalDetail: `Blocked workflow ${session.workflowSessionId} remains blocked. Original request: ${session.prompt}`,
    };
  }

  if (kind === "external_runtime_dependency") {
    return {
      kind,
      title: "Safe Recovery Path",
      blockedExplanation: `Blocked: ${blockedReason}`,
      safetyRuleTriggered: "An external runtime, approved route, or dependency is required before execution can continue.",
      safeAlternative: "Convert the request into a safe planning workflow while the runtime dependency remains blocked.",
      beforeProceeding: "The required runtime or approval route must be available and explicitly authorized before execution.",
      suggestedRecovery: "Show the required runtime or convert this to a safe planning workflow.",
      actions: [
        { id: "SHOW_REQUIRED_RUNTIME", label: "Show Required Runtime", description: "Show what external runtime or route is missing." },
        { id: "CONVERT_TO_SAFE_PLANNING_WORKFLOW", label: "Convert to Safe Planning Workflow", description: "Create a planning-only workflow that does not execute the external dependency." },
        { id: "EXPLAIN_BLOCKER", label: "Explain Blocker", description: "Explain the blocker, safety rule, safe alternative, and approval requirement." },
      ],
      technicalDetail: `Blocked workflow ${session.workflowSessionId} is waiting on ${blockedStage?.type ?? "a blocked stage"}.`,
    };
  }

  if (kind === "missing_approval") {
    return {
      kind,
      title: "Safe Recovery Path",
      blockedExplanation: `Blocked: ${blockedReason}`,
      safetyRuleTriggered: "Mutation-capable work cannot continue until explicit operator approval is recorded.",
      safeAlternative: "Review the scope and request approval before continuing the mutation-capable step.",
      beforeProceeding: "Approval must be recorded for the relevant stage, and existing validation rules still apply afterward.",
      suggestedRecovery: "Request approval or review scope before continuing.",
      actions: [
        { id: "REQUEST_APPROVAL", label: "Request Approval", description: "Start the approval-first continuation path." },
        { id: "REVIEW_SCOPE", label: "Review Scope", description: "Inspect allowed paths, blocked paths, and mutation permission before approval." },
        { id: "EXPLAIN_BLOCKER", label: "Explain Blocker", description: "Explain the blocker, safety rule, safe alternative, and approval requirement." },
      ],
      technicalDetail: `Approval state: ${blockedStage?.approvalState ?? "unknown"}; mutation permission: ${blockedStage?.mutationPermission ?? "unknown"}.`,
    };
  }

  return {
    kind,
    title: "Safe Recovery Path",
    blockedExplanation: `Blocked: ${blockedReason}`,
    safetyRuleTriggered: "A supervised workflow boundary prevented continuation.",
    safeAlternative: "Review the blocker and choose a planning, approval, validation, or scope-review path before continuing.",
    beforeProceeding: "The recorded blocker must be resolved without bypassing approval, validation, path scope, or runtime boundaries.",
    suggestedRecovery: "Explain the blocker or review scope before continuing.",
    actions: [
      { id: "REVIEW_SCOPE", label: "Review Scope", description: "Inspect the workflow scope and governance metadata." },
      { id: "EXPLAIN_BLOCKER", label: "Explain Blocker", description: "Explain the blocker, safety rule, safe alternative, and approval requirement." },
    ],
    technicalDetail: `Blocked workflow ${session.workflowSessionId} remains blocked until the recorded blocker is resolved.`,
  };
}

export function convertBlockedWorkflowToSafePatchPreparation(session: EliteAgentWorkflowSession, params?: { now?: string }): EliteAgentWorkflowSession {
  const guidance = buildEliteAgentBlockedWorkflowRecoveryGuidance(session);
  if (!guidance) {
    throw new Error("Only blocked workflows can be converted into a safe recovery workflow.");
  }
  const now = normalizeText(params?.now) || new Date().toISOString();
  const recovery = buildEliteAgentWorkflowSession({
    agentId: `${session.agentId}-safe-recovery`,
    prompt: "prepare a safe patch for operator review",
    allowedPaths: session.allowedPaths,
    forbiddenPaths: session.forbiddenPaths,
    now,
  });
  return {
    ...recovery,
    deterministicSelectionReason: `${recovery.deterministicSelectionReason} Converted from blocked workflow ${session.workflowSessionId}; original blocked workflow remains visible and no patch was applied.`,
    logs: [
      ...recovery.logs,
      createLog(now, recovery.stages[0] ?? null, `Safe recovery conversion created from blocked workflow ${session.workflowSessionId}; automatic application remains blocked.`),
    ],
  };
}

function approvalRiskLevel(stage: EliteAgentWorkflowStage): EliteAgentApprovalGateGuidance["riskLevel"] {
  if (stage.mutationPermission === "MUTATION_REQUIRES_APPROVAL") {
    return "moderate";
  }
  if (stage.externalDependencyRequired) {
    return "high";
  }
  return "low";
}

export function buildEliteAgentApprovalGateGuidance(session: EliteAgentWorkflowSession): EliteAgentApprovalGateGuidance | null {
  const hasCompletedPriorStages = (candidate: EliteAgentWorkflowStage) => session.stages.slice(0, candidate.order).every((stage) => stage.lifecycleState === "COMPLETED");
  const stage = session.stages.find((candidate) => candidate.approvalState === "PENDING" && candidate.mutationPermission === "MUTATION_REQUIRES_APPROVAL" && hasCompletedPriorStages(candidate))
    ?? session.stages.find((candidate) => (candidate.approvalState === "REJECTED" || candidate.approvalState === "APPROVED") && candidate.mutationPermission === "MUTATION_REQUIRES_APPROVAL")
    ?? session.stages.find((candidate) => candidate.approvalState === "PENDING" && hasCompletedPriorStages(candidate))
    ?? session.stages.find((candidate) => candidate.approvalState === "REJECTED" || candidate.approvalState === "APPROVED")
    ?? null;
  if (!stage || stage.approvalState === "NOT_REQUIRED") {
    return null;
  }
  const isSessionBoundaryApproval = stage.type === "REQUEST_APPROVAL" && stage.order === 0;
  const approvalGateState = approvalGateStateForApprovalState(stage.approvalState);
  const actionBeingApproved = stage.mutationPermission === "MUTATION_REQUIRES_APPROVAL"
    ? "Patch preparation only"
    : isSessionBoundaryApproval
      ? "Scoped dev session boundary"
      : stage.type === "REQUEST_APPROVAL"
      ? "Patch mutation authorization"
      : stage.title;
  const whatHappensAfterApproval = stage.mutationPermission === "MUTATION_REQUIRES_APPROVAL"
    ? "AI-E may run the approved patch-preparation step when workflow order reaches it. It will not apply files automatically."
    : isSessionBoundaryApproval
      ? "AI-E may progress through in-scope, low-risk workflow stages automatically. It will pause if scope, risk, mutation authority, or validation authority changes."
      : "AI-E records the approval checkpoint. This does not apply files automatically or claim gameplay validation.";
  return {
    title: "Approval Required",
    approvalGateState,
    actionBeingApproved,
    workflowStage: stage.type,
    stageId: stage.stageId,
    allowedPathScope: [...stage.allowedPathScope],
    mutationPermission: stage.mutationPermission,
    validationRequirement: stage.validationRequired ? "Validation is required after this stage before it can be considered complete." : isSessionBoundaryApproval ? "No validation checkpoint is required for the approval itself; later validation still requires real evidence." : "No validation checkpoint is required for this approval stage.",
    rollbackAvailability: stage.rollbackSupported ? "Rollback preparation metadata can be recorded for operator review." : "Rollback preparation is not available for this stage.",
    riskLevel: approvalRiskLevel(stage),
    whatHappensAfterApproval,
    whyApprovalRequired: stage.mutationPermission === "MUTATION_REQUIRES_APPROVAL" ? "This stage can prepare mutation-capable work, so a human operator must approve the exact stage before it can run." : isSessionBoundaryApproval ? "This is the operator-approved room AI-E may work inside before it progresses through concrete game-development workflow steps." : "This workflow stage represents the human decision point before mutation-capable work can be authorized.",
    whatCouldGoWrong: isSessionBoundaryApproval ? "Approving too broad a session could let AI-E prepare work outside the operator's intended gameplay-loop, zombie spawning, or health-tuning scope. Approval still does not apply files automatically." : "Approving the wrong scope could let AI-E prepare work for files or paths the operator did not intend. Approval still does not apply files automatically.",
    allowedToDo: isSessionBoundaryApproval ? "AI-E may inspect scoped repo context, prepare scoped patch metadata or a patch proposal, update workflow state, and generate an operator report inside the approved session boundary." : "AI-E may update supervised workflow state and run only the approved stage inside the existing bounded model when workflow order allows it.",
    notAllowedToDo: "AI-E is not allowed to auto-apply patches, mutate files without a real approved route, run Unity, use unrestricted shell access, or continue unattended.",
    validationAfterward: stage.validationRequired ? "After the approved stage runs, validation evidence must be recorded before completion." : isSessionBoundaryApproval ? "After session approval, AI-E can progress through low-risk in-scope stages and must still pause for real validation evidence before claiming gameplay success." : "After approval, continue following the next supervised workflow step.",
  };
}

export function listEliteAgentWorkflowStageDefinitions(allowedPathScope: string[] = ["runner_artifacts/lite_elite_agent"]): EliteAgentWorkflowStageDefinition[] {
  return (Object.keys(STAGE_DEFINITIONS) as EliteAgentWorkflowStageType[]).map((type) => ({
    ...STAGE_DEFINITIONS[type],
    allowedPathScope: mergeUnique(allowedPathScope),
  }));
}
