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
  | "BLOCKED";

export type EliteAgentWorkflowApprovalState = "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED" | "BLOCKED";
export type EliteAgentWorkflowValidationState = "NOT_REQUIRED" | "PENDING" | "SUCCESS" | "FAILED" | "BLOCKED";
export type EliteAgentWorkflowMutationPermission = "READ_ONLY" | "MUTATION_REQUIRES_APPROVAL" | "NO_MUTATION";

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

export type EliteAgentWorkflowSessionStatus = "PENDING" | "RUNNING" | "PARTIALLY_COMPLETED" | "COMPLETED" | "BLOCKED" | "FAILED" | "ROLLBACK_AVAILABLE";

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
  deterministicSelectionReason: string;
  truthfulCapabilityBoundary: string;
  logs: EliteAgentWorkflowLogEntry[];
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
  action: "APPROVE_STAGE" | "START_STAGE" | "BEGIN_VALIDATION" | "COMPLETE_STAGE" | "FAIL_STAGE" | "BLOCK_STAGE" | "PREPARE_ROLLBACK";
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
  truthfulCapabilityBoundary: string;
};

const TRUTHFUL_WORKFLOW_BOUNDARY = "AI-E-lite Phase 2 provides supervised multi-step workflow lifecycle tracking with bounded paths, approval checkpoints, validation checkpoints, and rollback preparation. It does not provide unrestricted repo control or unattended operation.";

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
    mutationPermission: "MUTATION_REQUIRES_APPROVAL",
    validationRequired: true,
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
  if (/prepare|patch|movement|fix|change/.test(normalizedPrompt)) {
    return {
      stageTypes: ["READ_REPO_CONTEXT", "PREPARE_PATCH", "REQUEST_APPROVAL"],
      reason: "Patch preparation prompt selected context reading, scoped patch preparation, and operator approval request.",
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

function deriveSessionStatus(stages: EliteAgentWorkflowStage[]): EliteAgentWorkflowSessionStatus {
  if (stages.some((stage) => stage.lifecycleState === "ROLLBACK_AVAILABLE")) {
    return "ROLLBACK_AVAILABLE";
  }
  if (stages.some((stage) => stage.lifecycleState === "FAILED")) {
    return "FAILED";
  }
  if (stages.some((stage) => stage.lifecycleState === "BLOCKED")) {
    return stages.some((stage) => stage.lifecycleState === "COMPLETED") ? "PARTIALLY_COMPLETED" : "BLOCKED";
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

function recomputeSession(session: EliteAgentWorkflowSession): EliteAgentWorkflowSession {
  const nextIncomplete = session.stages.find((stage) => stage.lifecycleState !== "COMPLETED" && stage.lifecycleState !== "BLOCKED" && stage.lifecycleState !== "FAILED" && stage.lifecycleState !== "ROLLBACK_AVAILABLE");
  const blockedStage = session.stages.find((stage) => stage.lifecycleState === "BLOCKED" || stage.lifecycleState === "FAILED" || stage.lifecycleState === "ROLLBACK_AVAILABLE");
  const completedStageCount = session.stages.filter((stage) => stage.lifecycleState === "COMPLETED").length;
  const rollbackStage = session.stages.find((stage) => stage.rollbackAvailable || stage.rollbackPrepared);
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
    deterministicSelectionReason: selection.reason,
    truthfulCapabilityBoundary: TRUTHFUL_WORKFLOW_BOUNDARY,
    logs: [createLog(now, stages[0] ?? null, `Workflow created: ${selection.reason}`)],
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
  if (previousStage && previousStage.lifecycleState !== "COMPLETED") {
    throw new Error(`Unsafe workflow transition rejected: ${stage.stageId} cannot run before ${previousStage.stageId} completes.`);
  }
  if (stage.lifecycleState === "BLOCKED") {
    next.logs.push(createLog(now, stage, input.reason ?? "Blocked stage remained blocked.", "BLOCKED"));
    return recomputeSession(next);
  }
  if (stage.lifecycleState === "COMPLETED" && input.action !== "PREPARE_ROLLBACK") {
    throw new Error(`Unsafe workflow transition rejected: ${stage.stageId} is already completed.`);
  }

  if (input.action === "APPROVE_STAGE") {
    if (stage.approvalState === "NOT_REQUIRED") {
      throw new Error(`Approval is not required for stage ${stage.stageId}.`);
    }
    stage.approvalState = "APPROVED";
    stage.lifecycleState = "APPROVED";
    next.logs.push(createLog(now, stage, input.reason ?? "Stage approved by operator checkpoint."));
  }

  if (input.action === "START_STAGE") {
    if (stage.mutationPermission === "MUTATION_REQUIRES_APPROVAL" && stage.approvalState !== "APPROVED") {
      stage.lifecycleState = "BLOCKED";
      stage.approvalState = "BLOCKED";
      stage.blockedReason = "Mutation-capable stage cannot start until explicit operator approval is recorded.";
      next.logs.push(createLog(now, stage, stage.blockedReason, "BLOCKED"));
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

  if (stage.lifecycleState === "VALIDATING" && input.action === "BEGIN_VALIDATION") {
    stage.validationState = "PENDING";
  }
  if (input.action === "COMPLETE_STAGE" && stage.validationRequired) {
    stage.validationState = "SUCCESS";
  }

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
    truthfulCapabilityBoundary: session.truthfulCapabilityBoundary,
  };
}

export function listEliteAgentWorkflowStageDefinitions(allowedPathScope: string[] = ["runner_artifacts/lite_elite_agent"]): EliteAgentWorkflowStageDefinition[] {
  return (Object.keys(STAGE_DEFINITIONS) as EliteAgentWorkflowStageType[]).map((type) => ({
    ...STAGE_DEFINITIONS[type],
    allowedPathScope: mergeUnique(allowedPathScope),
  }));
}
