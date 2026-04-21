import type { FailureClassification } from "./failureClassifier";
import type { GoalCompletionStatus, GoalEvaluation } from "./goalEvaluator";
import type { AutonomousActionFamily } from "./autonomousPlanning";
import type { ExecutionAdapterId } from "./executionAdapters";
import type { ExecutionNodeMode } from "./executionNode";
import type { AutonomousRecoveryStrategy } from "./strategySwitch";
import type { TaskEnvelopeStatus } from "./taskEnvelope";
import type { ExecutionActionPreview, ExecutionRuntimeResult } from "./types";

export type AutonomousSessionStatus =
  | "active"
  | "paused"
  | "awaiting-approval"
  | "blocked"
  | "completed"
  | "failed"
  | "max-step-limit";

export type AutonomousStepVerificationState = "confirmed" | "falsified" | "inconclusive";
export type AutonomousStepDecision = "continue" | "reroute" | "stop";

export type AutonomousStepRecord = {
  index: number;
  goal: string;
  proposedAction?: string;
  expectedOutcome?: string;
  actionFamily?: AutonomousActionFamily;
  executionAdapterId?: ExecutionAdapterId;
  adapterContextSummary?: string;
  executionNodeId?: string;
  executionNodeMode?: ExecutionNodeMode;
  nodeCapabilitySummary?: string;
  taskId?: string;
  taskStatus?: TaskEnvelopeStatus;
  assignedNodeId?: string;
  queueStateSummary?: string;
  planningHintSummary?: string;
  executionResult?: ExecutionRuntimeResult;
  diagnosis?: string;
  verificationState?: AutonomousStepVerificationState;
  nextDecision?: AutonomousStepDecision;
  failureClassification?: FailureClassification;
  recoveryStrategy?: AutonomousRecoveryStrategy;
  retryCount?: number;
  repeatedAction?: boolean;
  repeatedOutput?: boolean;
  stallReason?: string;
  goalStatus?: GoalCompletionStatus;
  completionConfidence?: GoalEvaluation["confidence"];
  timestamp: string;
};

export type AutonomousRecoveryState = {
  failureClassification?: FailureClassification;
  recoveryStrategy?: AutonomousRecoveryStrategy;
  retryCount?: number;
  repeatedAction?: boolean;
  repeatedOutput?: boolean;
  stallReason?: string;
};

export type AutonomousCompletionState = Pick<GoalEvaluation, "status" | "isComplete" | "reason" | "confidence">;

export type AutonomousSession = {
  sessionId: string;
  goal: string;
  status: AutonomousSessionStatus;
  createdAt: string;
  updatedAt: string;
  currentStepIndex: number;
  maxSteps: number;
  lastStepIndex?: number;
  completedReason?: string;
  stateReason?: string;
  lastDiagnosis?: string;
  executionAdapterId?: ExecutionAdapterId;
  adapterContextSummary?: string;
  executionNodeId?: string;
  executionNodeMode?: ExecutionNodeMode;
  nodeCapabilitySummary?: string;
  taskId?: string;
  taskStatus?: TaskEnvelopeStatus;
  assignedNodeId?: string;
  queueStateSummary?: string;
  planningHintSummary?: string;
  latestExecutionResult?: ExecutionRuntimeResult;
  pendingAction?: ExecutionActionPreview;
  latestRecoveryState?: AutonomousRecoveryState;
  latestCompletion?: AutonomousCompletionState;
  steps: AutonomousStepRecord[];
};

type CreateAutonomousSessionParams = {
  goal: string;
  maxSteps?: number;
  sessionId?: string;
};

type AppendAutonomousStepParams = {
  proposedAction?: string;
  expectedOutcome?: string;
  actionFamily?: AutonomousActionFamily;
  executionAdapterId?: ExecutionAdapterId;
  adapterContextSummary?: string;
  executionNodeId?: string;
  executionNodeMode?: ExecutionNodeMode;
  nodeCapabilitySummary?: string;
  taskId?: string;
  taskStatus?: TaskEnvelopeStatus;
  assignedNodeId?: string;
  queueStateSummary?: string;
  planningHintSummary?: string;
  executionResult?: ExecutionRuntimeResult;
  diagnosis?: string;
  verificationState?: AutonomousStepVerificationState;
  nextDecision?: AutonomousStepDecision;
  failureClassification?: FailureClassification;
  recoveryStrategy?: AutonomousRecoveryStrategy;
  retryCount?: number;
  repeatedAction?: boolean;
  repeatedOutput?: boolean;
  stallReason?: string;
  goalStatus?: GoalCompletionStatus;
  completionConfidence?: GoalEvaluation["confidence"];
  timestamp?: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampAutonomousMaxSteps(value: unknown): number {
  if (value === undefined || value === null || String(value).trim() === "") {
    return 3;
  }

  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return 3;
  }

  return Math.max(1, Math.min(5, Math.floor(numericValue)));
}

function createTimestamp(date = new Date()): string {
  return date.toISOString();
}

function normalizeFailureClassification(value: unknown): FailureClassification | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const kind = normalizeText(typeof source.kind === "string" ? source.kind : "");
  const severity = normalizeText(typeof source.severity === "string" ? source.severity : "");
  const reason = normalizeText(typeof source.reason === "string" ? source.reason : "");

  if (
    (kind !== "environment" && kind !== "logic" && kind !== "constraint" && kind !== "transient" && kind !== "unknown") ||
    (severity !== "low" && severity !== "medium" && severity !== "high")
  ) {
    return undefined;
  }

  return {
    kind: kind as FailureClassification["kind"],
    retryable: Boolean(source.retryable),
    severity: severity as FailureClassification["severity"],
    reason: reason || "No recovery reason recorded.",
  };
}

function normalizeRecoveryStrategy(value: unknown): AutonomousRecoveryStrategy | undefined {
  const normalized = normalizeText(typeof value === "string" ? value : "");
  if (
    normalized === "retry-same-action" ||
    normalized === "reroute-analysis" ||
    normalized === "narrow-scope" ||
    normalized === "validate-before-write" ||
    normalized === "stop"
  ) {
    return normalized as AutonomousRecoveryStrategy;
  }

  return undefined;
}

function normalizeExecutionRuntimeResult(value: unknown): ExecutionRuntimeResult | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  if (source.status !== "success" && source.status !== "failed" && source.status !== "blocked") {
    return undefined;
  }

  const output = normalizeText(typeof source.output === "string" ? source.output : "");
  const error = normalizeText(typeof source.error === "string" ? source.error : "");
  const changedPaths = Array.isArray(source.changedPaths)
    ? source.changedPaths.map((item) => normalizeText(typeof item === "string" ? item : String(item ?? ""))).filter(Boolean)
    : undefined;
  const diffSummary = normalizeText(typeof source.diffSummary === "string" ? source.diffSummary : "");
  const commandLabel = normalizeText(typeof source.commandLabel === "string" ? source.commandLabel : "");
  const rollback =
    source.rollback &&
    typeof source.rollback === "object" &&
    (source.rollback as Record<string, unknown>).type === "restore-file" &&
    typeof (source.rollback as Record<string, unknown>).targetPath === "string" &&
    typeof (source.rollback as Record<string, unknown>).previousContent === "string" &&
    typeof (source.rollback as Record<string, unknown>).snapshotId === "string" &&
    typeof (source.rollback as Record<string, unknown>).createdAt === "string"
      ? {
          type: "restore-file" as const,
          targetPath: normalizeText((source.rollback as Record<string, unknown>).targetPath as string),
          previousContent: String((source.rollback as Record<string, unknown>).previousContent),
          snapshotId: normalizeText((source.rollback as Record<string, unknown>).snapshotId as string),
          createdAt: normalizeText((source.rollback as Record<string, unknown>).createdAt as string),
        }
      : undefined;

  return {
    status: source.status,
    output: output || undefined,
    error: error || undefined,
    changedPaths: changedPaths?.length ? changedPaths : undefined,
    diffSummary: diffSummary || undefined,
    exitCode: Number.isInteger(Number(source.exitCode)) ? Number(source.exitCode) : undefined,
    commandLabel: commandLabel || undefined,
    rollback,
  };
}

function normalizeExecutionAdapterId(value: unknown): ExecutionAdapterId | undefined {
  const normalized = normalizeText(typeof value === "string" ? value : "");
  if (normalized === "web-sandbox" || normalized === "repo-filesystem" || normalized === "repo-tests" || normalized === "headless-local") {
    return normalized;
  }

  return undefined;
}

function normalizeExecutionNodeMode(value: unknown): ExecutionNodeMode | undefined {
  const normalized = normalizeText(typeof value === "string" ? value : "");
  if (normalized === "web" || normalized === "headless" || normalized === "local-node") {
    return normalized;
  }

  return undefined;
}

function normalizeTaskStatus(value: unknown): TaskEnvelopeStatus | undefined {
  if (
    value === "pending" ||
    value === "assigned" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "blocked"
  ) {
    return value;
  }

  return undefined;
}

function normalizeActionFamily(value: unknown): AutonomousActionFamily | undefined {
  const normalized = normalizeText(typeof value === "string" ? value : "");
  if (normalized === "write" || normalized === "test" || normalized === "validate" || normalized === "inspect" || normalized === "other") {
    return normalized;
  }

  return undefined;
}

function normalizeExecutionActionPreview(value: unknown): ExecutionActionPreview | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const type = normalizeText(typeof source.type === "string" ? source.type : "");
  const scope = normalizeText(typeof source.scope === "string" ? source.scope : "");
  const id = normalizeText(typeof source.id === "string" ? source.id : "");
  const description = normalizeText(typeof source.description === "string" ? source.description : "");
  const expectedOutcome = normalizeText(typeof source.expectedOutcome === "string" ? source.expectedOutcome : "");

  if (
    !id ||
    !description ||
    !expectedOutcome ||
    (type !== "read" &&
      type !== "write" &&
      type !== "inspect" &&
      type !== "run" &&
      type !== "inspection" &&
      type !== "validation-check" &&
      type !== "file-write" &&
      type !== "test-run" &&
      type !== "unknown") ||
    (scope !== "safe" && scope !== "caution" && scope !== "dangerous")
  ) {
    return undefined;
  }

  const metadataSource = source.metadata && typeof source.metadata === "object" ? (source.metadata as Record<string, unknown>) : {};
  return {
    id,
    type: type as ExecutionActionPreview["type"],
    scope: scope as ExecutionActionPreview["scope"],
    description,
    expectedOutcome,
    requiresApproval: true,
    suggestedCommand: normalizeText(typeof source.suggestedCommand === "string" ? source.suggestedCommand : "") || undefined,
    metadata: {
      sourceActionType: (normalizeText(typeof metadataSource.sourceActionType === "string" ? metadataSource.sourceActionType : "") || undefined) as ExecutionActionPreview["metadata"]["sourceActionType"],
      context: normalizeText(typeof metadataSource.context === "string" ? metadataSource.context : "") || undefined,
      targetPath: normalizeText(typeof metadataSource.targetPath === "string" ? metadataSource.targetPath : "") || undefined,
      allowedRoot: normalizeText(typeof metadataSource.allowedRoot === "string" ? metadataSource.allowedRoot : "") || undefined,
      patch: typeof metadataSource.patch === "string" ? metadataSource.patch : undefined,
      content: typeof metadataSource.content === "string" ? metadataSource.content : undefined,
      command: normalizeText(typeof metadataSource.command === "string" ? metadataSource.command : "") || undefined,
      testTarget: normalizeText(typeof metadataSource.testTarget === "string" ? metadataSource.testTarget : "") || undefined,
    },
  };
}

function normalizeAutonomousRecoveryState(value: unknown): AutonomousRecoveryState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  return {
    failureClassification: normalizeFailureClassification(source.failureClassification),
    recoveryStrategy: normalizeRecoveryStrategy(source.recoveryStrategy),
    retryCount: Number.isInteger(Number(source.retryCount)) ? Math.max(0, Number(source.retryCount)) : undefined,
    repeatedAction: typeof source.repeatedAction === "boolean" ? source.repeatedAction : undefined,
    repeatedOutput: typeof source.repeatedOutput === "boolean" ? source.repeatedOutput : undefined,
    stallReason: normalizeText(typeof source.stallReason === "string" ? source.stallReason : "") || undefined,
  };
}

function normalizeAutonomousCompletionState(value: unknown): AutonomousCompletionState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const status = normalizeText(typeof source.status === "string" ? source.status : "");
  const confidence = normalizeText(typeof source.confidence === "string" ? source.confidence : "");
  const reason = normalizeText(typeof source.reason === "string" ? source.reason : "");

  if (
    (status !== "incomplete" && status !== "progressing" && status !== "needs-verification" && status !== "complete" && status !== "blocked") ||
    (confidence !== "low" && confidence !== "medium" && confidence !== "high")
  ) {
    return undefined;
  }

  return {
    status: status as GoalCompletionStatus,
    isComplete: Boolean(source.isComplete),
    reason: reason || "No completion reason recorded.",
    confidence: confidence as GoalEvaluation["confidence"],
  };
}

function normalizeAutonomousStepRecord(value: unknown): AutonomousStepRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const index = Number(source.index ?? 0);
  const goal = normalizeText(typeof source.goal === "string" ? source.goal : "");
  const timestamp = normalizeText(typeof source.timestamp === "string" ? source.timestamp : "");
  const verificationState = source.verificationState;
  const nextDecision = source.nextDecision;
  const goalStatus = source.goalStatus;
  const completionConfidence = source.completionConfidence;

  if (!Number.isInteger(index) || index <= 0 || !goal || !timestamp) {
    return null;
  }

  if (
    verificationState !== undefined &&
    verificationState !== "confirmed" &&
    verificationState !== "falsified" &&
    verificationState !== "inconclusive"
  ) {
    return null;
  }

  if (nextDecision !== undefined && nextDecision !== "continue" && nextDecision !== "reroute" && nextDecision !== "stop") {
    return null;
  }

  if (
    goalStatus !== undefined &&
    goalStatus !== "incomplete" &&
    goalStatus !== "progressing" &&
    goalStatus !== "needs-verification" &&
    goalStatus !== "complete" &&
    goalStatus !== "blocked"
  ) {
    return null;
  }

  if (completionConfidence !== undefined && completionConfidence !== "low" && completionConfidence !== "medium" && completionConfidence !== "high") {
    return null;
  }

  return {
    index,
    goal,
    proposedAction: normalizeText(typeof source.proposedAction === "string" ? source.proposedAction : "") || undefined,
    expectedOutcome: normalizeText(typeof source.expectedOutcome === "string" ? source.expectedOutcome : "") || undefined,
    actionFamily: normalizeActionFamily(source.actionFamily),
    executionAdapterId: normalizeExecutionAdapterId(source.executionAdapterId),
    adapterContextSummary: normalizeText(typeof source.adapterContextSummary === "string" ? source.adapterContextSummary : "") || undefined,
    executionNodeId: normalizeText(typeof source.executionNodeId === "string" ? source.executionNodeId : "") || undefined,
    executionNodeMode: normalizeExecutionNodeMode(source.executionNodeMode),
    nodeCapabilitySummary: normalizeText(typeof source.nodeCapabilitySummary === "string" ? source.nodeCapabilitySummary : "") || undefined,
    taskId: normalizeText(typeof source.taskId === "string" ? source.taskId : "") || undefined,
    taskStatus: normalizeTaskStatus(source.taskStatus),
    assignedNodeId: normalizeText(typeof source.assignedNodeId === "string" ? source.assignedNodeId : "") || undefined,
    queueStateSummary: normalizeText(typeof source.queueStateSummary === "string" ? source.queueStateSummary : "") || undefined,
    planningHintSummary: normalizeText(typeof source.planningHintSummary === "string" ? source.planningHintSummary : "") || undefined,
    executionResult: normalizeExecutionRuntimeResult(source.executionResult),
    diagnosis: normalizeText(typeof source.diagnosis === "string" ? source.diagnosis : "") || undefined,
    verificationState: verificationState as AutonomousStepVerificationState | undefined,
    nextDecision: nextDecision as AutonomousStepDecision | undefined,
    failureClassification: normalizeFailureClassification(source.failureClassification),
    recoveryStrategy: normalizeRecoveryStrategy(source.recoveryStrategy),
    retryCount: Number.isInteger(Number(source.retryCount)) ? Math.max(0, Number(source.retryCount)) : undefined,
    repeatedAction: typeof source.repeatedAction === "boolean" ? source.repeatedAction : undefined,
    repeatedOutput: typeof source.repeatedOutput === "boolean" ? source.repeatedOutput : undefined,
    stallReason: normalizeText(typeof source.stallReason === "string" ? source.stallReason : "") || undefined,
    goalStatus: goalStatus as GoalCompletionStatus | undefined,
    completionConfidence: completionConfidence as GoalEvaluation["confidence"] | undefined,
    timestamp,
  };
}

export function createAutonomousSessionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `aie-autonomous-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAutonomousSession(params: CreateAutonomousSessionParams): AutonomousSession {
  const goal = normalizeText(params.goal);
  const timestamp = createTimestamp();

  return {
    sessionId: normalizeText(params.sessionId) || createAutonomousSessionId(),
    goal: goal || "Resolve the current bounded autonomous debugging goal.",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    currentStepIndex: 1,
    maxSteps: clampAutonomousMaxSteps(params.maxSteps),
    lastStepIndex: 0,
    steps: [],
  };
}

export function appendAutonomousStep(
  session: AutonomousSession,
  params: AppendAutonomousStepParams,
): AutonomousSession {
  const nextIndex = session.steps.length + 1;
  const timestamp = normalizeText(params.timestamp) || createTimestamp();
  const executionResult = normalizeExecutionRuntimeResult(params.executionResult);
  const step: AutonomousStepRecord = {
    index: nextIndex,
    goal: session.goal,
    proposedAction: normalizeText(params.proposedAction) || undefined,
    expectedOutcome: normalizeText(params.expectedOutcome) || undefined,
    actionFamily: params.actionFamily,
    executionAdapterId: params.executionAdapterId,
    adapterContextSummary: normalizeText(params.adapterContextSummary) || undefined,
    executionNodeId: normalizeText(params.executionNodeId) || undefined,
    executionNodeMode: params.executionNodeMode,
    nodeCapabilitySummary: normalizeText(params.nodeCapabilitySummary) || undefined,
    taskId: normalizeText(params.taskId) || undefined,
    taskStatus: params.taskStatus,
    assignedNodeId: normalizeText(params.assignedNodeId) || undefined,
    queueStateSummary: normalizeText(params.queueStateSummary) || undefined,
    planningHintSummary: normalizeText(params.planningHintSummary) || undefined,
    executionResult,
    diagnosis: normalizeText(params.diagnosis) || undefined,
    verificationState: params.verificationState,
    nextDecision: params.nextDecision,
    failureClassification: params.failureClassification,
    recoveryStrategy: params.recoveryStrategy,
    retryCount: Number.isInteger(Number(params.retryCount)) ? Math.max(0, Number(params.retryCount)) : undefined,
    repeatedAction: typeof params.repeatedAction === "boolean" ? params.repeatedAction : undefined,
    repeatedOutput: typeof params.repeatedOutput === "boolean" ? params.repeatedOutput : undefined,
    stallReason: normalizeText(params.stallReason) || undefined,
    goalStatus: params.goalStatus,
    completionConfidence: params.completionConfidence,
    timestamp,
  };

  return {
    ...session,
    updatedAt: timestamp,
    currentStepIndex: nextIndex + 1,
    lastStepIndex: nextIndex,
    lastDiagnosis: step.diagnosis ?? session.lastDiagnosis,
    executionAdapterId: step.executionAdapterId ?? session.executionAdapterId,
    adapterContextSummary: step.adapterContextSummary ?? session.adapterContextSummary,
    executionNodeId: step.executionNodeId ?? session.executionNodeId,
    executionNodeMode: step.executionNodeMode ?? session.executionNodeMode,
    nodeCapabilitySummary: step.nodeCapabilitySummary ?? session.nodeCapabilitySummary,
    taskId: step.taskId ?? session.taskId,
    taskStatus: step.taskStatus ?? session.taskStatus,
    assignedNodeId: step.assignedNodeId ?? session.assignedNodeId,
    queueStateSummary: step.queueStateSummary ?? session.queueStateSummary,
    planningHintSummary: step.planningHintSummary ?? session.planningHintSummary,
    latestExecutionResult: executionResult ?? session.latestExecutionResult,
    pendingAction: session.pendingAction,
    latestRecoveryState: {
      failureClassification: step.failureClassification,
      recoveryStrategy: step.recoveryStrategy,
      retryCount: step.retryCount,
      repeatedAction: step.repeatedAction,
      repeatedOutput: step.repeatedOutput,
      stallReason: step.stallReason,
    },
    latestCompletion: step.goalStatus
      ? {
          status: step.goalStatus,
          isComplete: step.goalStatus === "complete",
          reason: step.diagnosis ?? session.latestCompletion?.reason ?? "No completion reason recorded.",
          confidence: step.completionConfidence ?? session.latestCompletion?.confidence ?? "low",
        }
      : session.latestCompletion,
    steps: [...session.steps, step],
  };
}

export function updateAutonomousSessionStatus(
  session: AutonomousSession,
  status: AutonomousSessionStatus,
  completedReason?: string,
): AutonomousSession {
  const nextReason = normalizeText(completedReason) || undefined;
  return {
    ...session,
    status,
    updatedAt: createTimestamp(),
    completedReason: nextReason ?? session.completedReason,
    stateReason: nextReason ?? session.stateReason,
  };
}

export function pauseAutonomousSession(
  session: AutonomousSession,
  reason: string,
  pendingAction?: ExecutionActionPreview,
): AutonomousSession {
  return {
    ...updateAutonomousSessionStatus(session, "paused", reason),
    pendingAction: pendingAction ?? session.pendingAction,
    stateReason: normalizeText(reason) || session.stateReason,
  };
}

export function markAwaitingApproval(
  session: AutonomousSession,
  pendingAction: ExecutionActionPreview,
  reason: string,
): AutonomousSession {
  return {
    ...updateAutonomousSessionStatus(session, "awaiting-approval", reason),
    pendingAction,
    stateReason: normalizeText(reason) || session.stateReason,
  };
}

export function canResumeAutonomousSession(session: AutonomousSession, approved = false): boolean {
  if (session.status === "paused") {
    return true;
  }

  if (session.status === "awaiting-approval") {
    return approved && Boolean(session.pendingAction);
  }

  return false;
}

export function resumeAutonomousSession(
  session: AutonomousSession,
  options?: { approved?: boolean; reason?: string },
): AutonomousSession {
  if (!canResumeAutonomousSession(session, Boolean(options?.approved))) {
    return session;
  }

  return {
    ...updateAutonomousSessionStatus(session, "active", normalizeText(options?.reason) || session.stateReason),
    stateReason: normalizeText(options?.reason) || session.stateReason,
    pendingAction: session.status === "awaiting-approval" && options?.approved ? session.pendingAction : undefined,
  };
}

export function normalizeAutonomousSession(value: unknown): AutonomousSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const status = source.status;
  const steps = Array.isArray(source.steps)
    ? source.steps.map((step) => normalizeAutonomousStepRecord(step)).filter((step): step is AutonomousStepRecord => step !== null)
    : [];

  if (
    typeof source.sessionId !== "string" ||
    typeof source.goal !== "string" ||
    typeof source.createdAt !== "string" ||
    typeof source.updatedAt !== "string" ||
    !Number.isInteger(Number(source.currentStepIndex ?? 0)) ||
    !Number.isInteger(Number(source.maxSteps ?? 0)) ||
    (status !== "active" &&
      status !== "paused" &&
      status !== "awaiting-approval" &&
      status !== "blocked" &&
      status !== "completed" &&
      status !== "failed" &&
      status !== "max-step-limit")
  ) {
    return null;
  }

  return {
    sessionId: normalizeText(source.sessionId),
    goal: normalizeText(source.goal),
    status,
    createdAt: normalizeText(source.createdAt),
    updatedAt: normalizeText(source.updatedAt),
    currentStepIndex: Math.max(1, Math.floor(Number(source.currentStepIndex))),
    maxSteps: clampAutonomousMaxSteps(source.maxSteps),
    lastStepIndex: Number.isInteger(Number(source.lastStepIndex)) ? Math.max(0, Math.floor(Number(source.lastStepIndex))) : steps.at(-1)?.index ?? 0,
    completedReason: normalizeText(typeof source.completedReason === "string" ? source.completedReason : "") || undefined,
    stateReason: normalizeText(typeof source.stateReason === "string" ? source.stateReason : "") || undefined,
    lastDiagnosis: normalizeText(typeof source.lastDiagnosis === "string" ? source.lastDiagnosis : "") || undefined,
    executionAdapterId: normalizeExecutionAdapterId(source.executionAdapterId),
    adapterContextSummary: normalizeText(typeof source.adapterContextSummary === "string" ? source.adapterContextSummary : "") || undefined,
    executionNodeId: normalizeText(typeof source.executionNodeId === "string" ? source.executionNodeId : "") || undefined,
    executionNodeMode: normalizeExecutionNodeMode(source.executionNodeMode),
    nodeCapabilitySummary: normalizeText(typeof source.nodeCapabilitySummary === "string" ? source.nodeCapabilitySummary : "") || undefined,
    taskId: normalizeText(typeof source.taskId === "string" ? source.taskId : "") || undefined,
    taskStatus: normalizeTaskStatus(source.taskStatus),
    assignedNodeId: normalizeText(typeof source.assignedNodeId === "string" ? source.assignedNodeId : "") || undefined,
    queueStateSummary: normalizeText(typeof source.queueStateSummary === "string" ? source.queueStateSummary : "") || undefined,
    planningHintSummary: normalizeText(typeof source.planningHintSummary === "string" ? source.planningHintSummary : "") || undefined,
    latestExecutionResult: normalizeExecutionRuntimeResult(source.latestExecutionResult),
    pendingAction: normalizeExecutionActionPreview(source.pendingAction),
    latestRecoveryState: normalizeAutonomousRecoveryState(source.latestRecoveryState),
    latestCompletion: normalizeAutonomousCompletionState(source.latestCompletion),
    steps,
  };
}

export function buildAutonomousSessionContextBlock(session: AutonomousSession, limit = 4): string {
  const recentSteps = session.steps.slice(-Math.max(1, limit));
  const lines = [
    "Autonomous session context:",
    `- Top-level goal: ${session.goal}`,
    `- Session status: ${session.status}`,
    `- Current autonomous step: ${session.currentStepIndex}`,
  ];

  if (session.completedReason) {
    lines.push(`- Latest session reason: ${session.completedReason}`);
  }

  if (session.stateReason && session.stateReason !== session.completedReason) {
    lines.push(`- Current state reason: ${session.stateReason}`);
  }

  if (session.latestCompletion) {
    lines.push(
      `- Goal status: ${session.latestCompletion.status} (${session.latestCompletion.confidence} confidence) -> ${session.latestCompletion.reason}`,
    );
  }

  if (session.pendingAction) {
    lines.push(`- Pending action awaiting continuation: ${session.pendingAction.description}`);
  }

  if (recentSteps.length > 0) {
    lines.push("- Recent autonomous steps:");
    for (const step of recentSteps) {
      const output = normalizeText(step.executionResult?.output);
      const error = normalizeText(step.executionResult?.error);
      const resultSummary = output || error || "no execution output recorded";
      lines.push(
        `  - Step ${step.index}: ${step.proposedAction || "no proposed action"} -> ${step.executionResult?.status || "no runtime result"} -> ${resultSummary}`,
      );
      if (step.failureClassification) {
        lines.push(
          `    failure: ${step.failureClassification.kind} (${step.failureClassification.severity}) -> ${step.failureClassification.reason}`,
        );
      }
      if (step.recoveryStrategy) {
        lines.push(`    recovery: ${step.recoveryStrategy}${typeof step.retryCount === "number" ? ` (retry count ${step.retryCount})` : ""}`);
      }
      if (step.stallReason) {
        lines.push(`    stall: ${step.stallReason}`);
      }
      if (step.goalStatus) {
        lines.push(
          `    goal state: ${step.goalStatus}${step.completionConfidence ? ` (${step.completionConfidence} confidence)` : ""}`,
        );
      }
    }

    lines.push("Execution history:");
    for (const step of recentSteps) {
      lines.push(
        `* autonomous step ${step.index}: attempted ${step.proposedAction || "no proposed action"} -> result ${normalizeText(step.executionResult?.output) || normalizeText(step.executionResult?.error) || "no execution output recorded"}`,
      );
    }
  }

  lines.push("Continue only inside the same bounded autonomous session and do not widen scope beyond safe execution.");
  return lines.join("\n");
}

export function countPriorAttemptsForAction(session: AutonomousSession, actionText: string | null | undefined): number {
  const normalizedTarget = normalizeText(actionText).toLowerCase();
  if (!normalizedTarget) {
    return 0;
  }

  return session.steps.filter((step) => normalizeText(step.proposedAction).toLowerCase() === normalizedTarget).length;
}

export function appendRecoveryMetadata(
  step: AutonomousStepRecord,
  metadata: Pick<
    AppendAutonomousStepParams,
    "failureClassification" | "recoveryStrategy" | "retryCount" | "repeatedAction" | "repeatedOutput" | "stallReason" | "goalStatus" | "completionConfidence"
  >,
): AutonomousStepRecord {
  return {
    ...step,
    failureClassification: metadata.failureClassification ?? step.failureClassification,
    recoveryStrategy: metadata.recoveryStrategy ?? step.recoveryStrategy,
    retryCount: metadata.retryCount ?? step.retryCount,
    repeatedAction: metadata.repeatedAction ?? step.repeatedAction,
    repeatedOutput: metadata.repeatedOutput ?? step.repeatedOutput,
    stallReason: metadata.stallReason ?? step.stallReason,
    goalStatus: metadata.goalStatus ?? step.goalStatus,
    completionConfidence: metadata.completionConfidence ?? step.completionConfidence,
  };
}