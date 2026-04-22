import type { FailureClassification } from "./failureClassifier";
import type { GoalCompletionStatus, GoalEvaluation } from "./goalEvaluator";
import type { AutonomousActionFamily } from "./autonomousPlanning";
import type { ExecutionAdapterId } from "./executionAdapters";
import type { DispatchProtocolVersion } from "./dispatchProtocol";
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
  selectedNodeId?: string;
  selectedNodeReason?: string;
  taskId?: string;
  taskStatus?: TaskEnvelopeStatus;
  assignedNodeId?: string;
  queueStateSummary?: string;
  dispatchMessageId?: string;
  dispatchAckMessageId?: string;
  dispatchResultMessageId?: string;
  dispatchTargetNodeId?: string;
  dispatchProtocolVersion?: DispatchProtocolVersion;
  dispatchStatusSummary?: string;
  dispatchAuthSummary?: string;
  dispatchTransportStatus?: "pending" | "accepted" | "rejected" | "delivered" | "failed" | "completed";
  remoteDispatchPlanned?: boolean;
  planningHintSummary?: string;
  executionResult?: ExecutionRuntimeResult;
  diagnosis?: string;
  verificationState?: AutonomousStepVerificationState;
  nextDecision?: AutonomousStepDecision;
  failureClassification?: FailureClassification;
  failureReason?: string;
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

export type AutonomousWorkflowChainPhase =
  | "planning"
  | "implementation"
  | "validation"
  | "fix"
  | "retry"
  | "waiting-on-operator"
  | "blocked"
  | "completed-safe-boundary"
  | "failed";

export type AutonomousWorkflowProgressState = {
  chainPhase: AutonomousWorkflowChainPhase;
  currentChainStep: number;
  totalKnownSteps: number;
  lastCompletedSafeStep?: number;
  currentRecoveryTarget?: string;
  nextIntendedStep?: string;
};

export type AutonomousWorkflowMemoryState = {
  chainSummary?: string;
  currentObjectiveSummary?: string;
  lastValidationOutcome?: string;
  lastFailureSummary?: string;
  lastFixAttemptSummary?: string;
  pendingNextActionSummary?: string;
  operatorBlockers?: string;
  recentDecisions: string[];
  restartReason?: string;
  priorRecoveryOutcomes: string[];
  pendingOperatorContext?: string;
};

export type AutonomousWorkflowContinuityState = {
  progress: AutonomousWorkflowProgressState;
  memory: AutonomousWorkflowMemoryState;
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
  selectedNodeId?: string;
  selectedNodeReason?: string;
  taskId?: string;
  taskStatus?: TaskEnvelopeStatus;
  assignedNodeId?: string;
  queueStateSummary?: string;
  dispatchMessageId?: string;
  dispatchAckMessageId?: string;
  dispatchResultMessageId?: string;
  dispatchTargetNodeId?: string;
  dispatchProtocolVersion?: DispatchProtocolVersion;
  dispatchStatusSummary?: string;
  dispatchAuthSummary?: string;
  dispatchTransportStatus?: "pending" | "accepted" | "rejected" | "delivered" | "failed" | "completed";
  remoteDispatchPlanned?: boolean;
  planningHintSummary?: string;
  failureReason?: string;
  latestExecutionResult?: ExecutionRuntimeResult;
  pendingAction?: ExecutionActionPreview;
  latestRecoveryState?: AutonomousRecoveryState;
  latestCompletion?: AutonomousCompletionState;
  workflowContinuity: AutonomousWorkflowContinuityState;
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
  selectedNodeId?: string;
  selectedNodeReason?: string;
  taskId?: string;
  taskStatus?: TaskEnvelopeStatus;
  assignedNodeId?: string;
  queueStateSummary?: string;
  dispatchMessageId?: string;
  dispatchAckMessageId?: string;
  dispatchResultMessageId?: string;
  dispatchTargetNodeId?: string;
  dispatchProtocolVersion?: DispatchProtocolVersion;
  dispatchStatusSummary?: string;
  dispatchAuthSummary?: string;
  dispatchTransportStatus?: "pending" | "accepted" | "rejected" | "delivered" | "failed" | "completed";
  remoteDispatchPlanned?: boolean;
  planningHintSummary?: string;
  executionResult?: ExecutionRuntimeResult;
  diagnosis?: string;
  verificationState?: AutonomousStepVerificationState;
  nextDecision?: AutonomousStepDecision;
  failureClassification?: FailureClassification;
  failureReason?: string;
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
    value === "queued" ||
    value === "dispatching" ||
    value === "awaiting-ack" ||
    value === "executing" ||
    value === "completed" ||
    value === "failed" ||
    value === "blocked" ||
    value === "retrying" ||
    value === "rejected"
  ) {
    return value;
  }

  return undefined;
}

function normalizeDispatchProtocolVersion(value: unknown): DispatchProtocolVersion | undefined {
  return value === "1" ? "1" : undefined;
}

function normalizeDispatchTransportStatus(value: unknown): AutonomousStepRecord["dispatchTransportStatus"] {
  return value === "pending" || value === "accepted" || value === "rejected" || value === "delivered" || value === "failed" || value === "completed"
    ? value
    : undefined;
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

function clampWorkflowMemoryItems(values: Array<string | undefined>, limit = 4): string[] {
  return values.map((value) => normalizeText(value)).filter(Boolean).slice(-Math.max(1, limit));
}

function summarizeWorkflowDecision(step: AutonomousStepRecord): string | undefined {
  const action = normalizeText(step.proposedAction);
  const decision = normalizeText(step.nextDecision);
  const goalState = normalizeText(step.goalStatus);

  if (!action && !decision && !goalState) {
    return undefined;
  }

  return `step ${step.index}: ${action || "no-action"}${decision ? ` -> ${decision}` : ""}${goalState ? ` (${goalState})` : ""}`;
}

function summarizeWorkflowRecoveryOutcome(step: AutonomousStepRecord): string | undefined {
  if (!step.recoveryStrategy && !step.failureClassification) {
    return undefined;
  }

  const recovery = normalizeText(step.recoveryStrategy);
  const failure = step.failureClassification
    ? `${step.failureClassification.kind}:${step.failureClassification.reason}`
    : normalizeText(step.failureReason);

  return `step ${step.index}: ${recovery || "recovery-recorded"}${failure ? ` -> ${failure}` : ""}`;
}

function summarizeExecutionOutcome(step: AutonomousStepRecord): string | undefined {
  const output = normalizeText(step.executionResult?.output);
  const error = normalizeText(step.executionResult?.error);
  const changedPaths = Array.isArray(step.executionResult?.changedPaths)
    ? clampWorkflowMemoryItems(step.executionResult.changedPaths)
    : [];
  const diffSummary = normalizeText(step.executionResult?.diffSummary);

  return normalizeText([
    step.executionResult?.status ? `runtime=${step.executionResult.status}` : "",
    output ? `output=${output}` : "",
    error ? `error=${error}` : "",
    changedPaths.length > 0 ? `changed=${changedPaths.join(", ")}` : "",
    diffSummary ? `diff=${diffSummary}` : "",
  ].filter(Boolean).join(" | ")) || undefined;
}

function isValidationLikeText(value: string | undefined): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  return /(validate|validation|verify|verification|test|smoke|check|confirm|build|lint|prove)/i.test(normalized);
}

function isImplementationLikeText(value: string | undefined): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  return /(implement|implementation|apply|edit|patch|change|update|create|modify|write|refactor)/i.test(normalized);
}

function summarizeFailure(step: AutonomousStepRecord): string | undefined {
  const failureReason = step.failureClassification
    ? `${step.failureClassification.kind}:${step.failureClassification.reason}`
    : normalizeText(step.failureReason);
  const outcome = summarizeExecutionOutcome(step);

  return normalizeText([
    `step ${step.index}`,
    failureReason ? `failure=${failureReason}` : "",
    step.recoveryStrategy ? `recovery=${step.recoveryStrategy}` : "",
    outcome,
  ].filter(Boolean).join(" | ")) || undefined;
}

function summarizeValidationOutcome(step: AutonomousStepRecord): string | undefined {
  if (!isValidationLikeText(step.proposedAction) && !isValidationLikeText(step.expectedOutcome)) {
    return undefined;
  }

  return normalizeText([
    `step ${step.index}`,
    summarizeExecutionOutcome(step),
    step.goalStatus ? `goal=${step.goalStatus}` : "",
  ].filter(Boolean).join(" | ")) || undefined;
}

function summarizeFixAttempt(step: AutonomousStepRecord): string | undefined {
  const changedPaths = Array.isArray(step.executionResult?.changedPaths)
    ? clampWorkflowMemoryItems(step.executionResult.changedPaths)
    : [];
  const hasImplementationSignal = isImplementationLikeText(step.proposedAction)
    || changedPaths.length > 0
    || Boolean(normalizeText(step.executionResult?.diffSummary));

  if (!hasImplementationSignal) {
    return undefined;
  }

  return normalizeText([
    `step ${step.index}`,
    step.proposedAction ? `action=${step.proposedAction}` : "",
    step.executionResult?.status ? `runtime=${step.executionResult.status}` : "",
    changedPaths.length > 0 ? `changed=${changedPaths.join(", ")}` : "",
    normalizeText(step.executionResult?.diffSummary) ? `diff=${normalizeText(step.executionResult?.diffSummary)}` : "",
  ].filter(Boolean).join(" | ")) || undefined;
}

function deriveProductionLoopFocus(session: AutonomousSession): "planning" | "implementation" | "validation" | undefined {
  const latestStep = session.steps.at(-1);
  const candidateTexts = [
    session.pendingAction?.description,
    session.pendingAction?.expectedOutcome,
    session.planningHintSummary,
    latestStep?.proposedAction,
    latestStep?.expectedOutcome,
  ];

  if (candidateTexts.some((value) => isValidationLikeText(value))) {
    return "validation";
  }

  if (
    candidateTexts.some((value) => isImplementationLikeText(value))
    || Array.isArray(latestStep?.executionResult?.changedPaths)
    || Boolean(normalizeText(latestStep?.executionResult?.diffSummary))
  ) {
    return "implementation";
  }

  return session.steps.length === 0 ? "planning" : undefined;
}

function deriveAutonomousWorkflowChainPhase(session: AutonomousSession): AutonomousWorkflowChainPhase {
  if (session.status === "completed") {
    return "completed-safe-boundary";
  }

  if (session.status === "failed" || session.status === "max-step-limit") {
    return "failed";
  }

  if (session.status === "blocked") {
    return "blocked";
  }

  if (session.status === "paused" || session.status === "awaiting-approval") {
    return "waiting-on-operator";
  }

  if (
    session.taskStatus === "retrying" ||
    session.latestRecoveryState?.recoveryStrategy === "retry-same-action" ||
    session.latestRecoveryState?.recoveryStrategy === "narrow-scope"
  ) {
    return "retry";
  }

  const latestStep = session.steps.at(-1);
  const focus = deriveProductionLoopFocus(session);

  if (latestStep?.executionResult?.status === "failed" && focus === "implementation") {
    return "fix";
  }

  if (focus === "validation") {
    return "validation";
  }

  if (focus === "implementation") {
    return "implementation";
  }

  return "planning";
}

export function deriveAutonomousWorkflowContinuity(session: AutonomousSession): AutonomousWorkflowContinuityState {
  const recentSteps = session.steps.slice(-4);
  const latestStep = session.steps.at(-1);
  const lastValidationStep = [...session.steps].reverse().find((step) => summarizeValidationOutcome(step));
  const lastFixStep = [...session.steps].reverse().find((step) => summarizeFixAttempt(step));
  const lastFailureStep = [...session.steps].reverse().find((step) => summarizeFailure(step));
  const lastCompletedSafeStep = [...session.steps]
    .reverse()
    .find((step) => step.executionResult?.status === "success" || step.goalStatus === "complete")?.index;
  const currentRecoveryTarget = normalizeText(session.pendingAction?.description)
    || normalizeText(session.latestRecoveryState?.failureClassification?.reason)
    || normalizeText(session.failureReason)
    || undefined;
  const nextIntendedStep = normalizeText(session.pendingAction?.description)
    || normalizeText(session.planningHintSummary)
    || normalizeText(latestStep?.proposedAction)
    || undefined;
  const chainPhase = deriveAutonomousWorkflowChainPhase(session);
  const totalKnownSteps = session.steps.length + (session.pendingAction ? 1 : 0);
  const summarySource = [
    `${session.goal}`,
    latestStep?.diagnosis ? `Latest diagnosis: ${latestStep.diagnosis}` : "",
    session.latestCompletion ? `Goal status: ${session.latestCompletion.status}` : "",
  ].filter(Boolean).join(" | ");
  const currentObjectiveSummary = normalizeText([
    session.goal,
    nextIntendedStep ? `Next bounded action: ${nextIntendedStep}` : "",
  ].filter(Boolean).join(" | ")) || undefined;
  const operatorBlockers = normalizeText([
    session.status === "awaiting-approval" ? "Approval required before the next bounded step." : "",
    session.status === "blocked" ? (session.stateReason || "The session is blocked at the current bounded boundary.") : "",
    session.pendingAction?.requiresApproval ? `Pending approval: ${session.pendingAction.description}` : "",
  ].filter(Boolean).join(" | ")) || undefined;

  return {
    progress: {
      chainPhase,
      currentChainStep: Math.max(1, session.currentStepIndex),
      totalKnownSteps: Math.max(session.steps.length, totalKnownSteps),
      lastCompletedSafeStep,
      currentRecoveryTarget,
      nextIntendedStep,
    },
    memory: {
      chainSummary: normalizeText(summarySource) || undefined,
      currentObjectiveSummary,
      lastValidationOutcome: lastValidationStep ? summarizeValidationOutcome(lastValidationStep) : undefined,
      lastFailureSummary: lastFailureStep ? summarizeFailure(lastFailureStep) : undefined,
      lastFixAttemptSummary: lastFixStep ? summarizeFixAttempt(lastFixStep) : undefined,
      pendingNextActionSummary: nextIntendedStep,
      operatorBlockers,
      recentDecisions: clampWorkflowMemoryItems(recentSteps.map((step) => summarizeWorkflowDecision(step))),
      restartReason:
        chainPhase === "retry"
          ? normalizeText(session.latestRecoveryState?.failureClassification?.reason)
            || normalizeText(session.stateReason)
            || normalizeText(session.failureReason)
            || undefined
          : undefined,
      priorRecoveryOutcomes: clampWorkflowMemoryItems(session.steps.map((step) => summarizeWorkflowRecoveryOutcome(step))),
      pendingOperatorContext:
        normalizeText(session.stateReason)
        || normalizeText(session.pendingAction?.expectedOutcome)
        || normalizeText(session.planningHintSummary)
        || undefined,
    },
  };
}

function normalizeAutonomousWorkflowContinuityState(value: unknown): AutonomousWorkflowContinuityState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const progressSource = source.progress && typeof source.progress === "object" ? (source.progress as Record<string, unknown>) : undefined;
  const memorySource = source.memory && typeof source.memory === "object" ? (source.memory as Record<string, unknown>) : undefined;
  const chainPhase = normalizeText(typeof progressSource?.chainPhase === "string" ? progressSource.chainPhase : "");

  if (
    chainPhase !== "planning" &&
    chainPhase !== "implementation" &&
    chainPhase !== "validation" &&
    chainPhase !== "fix" &&
    chainPhase !== "retry" &&
    chainPhase !== "waiting-on-operator" &&
    chainPhase !== "blocked" &&
    chainPhase !== "completed-safe-boundary" &&
    chainPhase !== "failed"
  ) {
    return undefined;
  }

  return {
    progress: {
      chainPhase: chainPhase as AutonomousWorkflowChainPhase,
      currentChainStep: Number.isInteger(Number(progressSource?.currentChainStep)) ? Math.max(1, Number(progressSource?.currentChainStep)) : 1,
      totalKnownSteps: Number.isInteger(Number(progressSource?.totalKnownSteps)) ? Math.max(0, Number(progressSource?.totalKnownSteps)) : 0,
      lastCompletedSafeStep: Number.isInteger(Number(progressSource?.lastCompletedSafeStep)) ? Math.max(0, Number(progressSource?.lastCompletedSafeStep)) : undefined,
      currentRecoveryTarget: normalizeText(typeof progressSource?.currentRecoveryTarget === "string" ? progressSource.currentRecoveryTarget : "") || undefined,
      nextIntendedStep: normalizeText(typeof progressSource?.nextIntendedStep === "string" ? progressSource.nextIntendedStep : "") || undefined,
    },
    memory: {
      chainSummary: normalizeText(typeof memorySource?.chainSummary === "string" ? memorySource.chainSummary : "") || undefined,
      currentObjectiveSummary:
        normalizeText(typeof memorySource?.currentObjectiveSummary === "string" ? memorySource.currentObjectiveSummary : "") || undefined,
      lastValidationOutcome:
        normalizeText(typeof memorySource?.lastValidationOutcome === "string" ? memorySource.lastValidationOutcome : "") || undefined,
      lastFailureSummary:
        normalizeText(typeof memorySource?.lastFailureSummary === "string" ? memorySource.lastFailureSummary : "") || undefined,
      lastFixAttemptSummary:
        normalizeText(typeof memorySource?.lastFixAttemptSummary === "string" ? memorySource.lastFixAttemptSummary : "") || undefined,
      pendingNextActionSummary:
        normalizeText(typeof memorySource?.pendingNextActionSummary === "string" ? memorySource.pendingNextActionSummary : "") || undefined,
      operatorBlockers:
        normalizeText(typeof memorySource?.operatorBlockers === "string" ? memorySource.operatorBlockers : "") || undefined,
      recentDecisions: clampWorkflowMemoryItems(Array.isArray(memorySource?.recentDecisions) ? memorySource?.recentDecisions as string[] : []),
      restartReason: normalizeText(typeof memorySource?.restartReason === "string" ? memorySource.restartReason : "") || undefined,
      priorRecoveryOutcomes: clampWorkflowMemoryItems(Array.isArray(memorySource?.priorRecoveryOutcomes) ? memorySource?.priorRecoveryOutcomes as string[] : []),
      pendingOperatorContext: normalizeText(typeof memorySource?.pendingOperatorContext === "string" ? memorySource.pendingOperatorContext : "") || undefined,
    },
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
    selectedNodeId: normalizeText(typeof source.selectedNodeId === "string" ? source.selectedNodeId : "") || undefined,
    selectedNodeReason: normalizeText(typeof source.selectedNodeReason === "string" ? source.selectedNodeReason : "") || undefined,
    taskId: normalizeText(typeof source.taskId === "string" ? source.taskId : "") || undefined,
    taskStatus: normalizeTaskStatus(source.taskStatus),
    assignedNodeId: normalizeText(typeof source.assignedNodeId === "string" ? source.assignedNodeId : "") || undefined,
    queueStateSummary: normalizeText(typeof source.queueStateSummary === "string" ? source.queueStateSummary : "") || undefined,
    dispatchMessageId: normalizeText(typeof source.dispatchMessageId === "string" ? source.dispatchMessageId : "") || undefined,
    dispatchAckMessageId: normalizeText(typeof source.dispatchAckMessageId === "string" ? source.dispatchAckMessageId : "") || undefined,
    dispatchResultMessageId: normalizeText(typeof source.dispatchResultMessageId === "string" ? source.dispatchResultMessageId : "") || undefined,
    dispatchTargetNodeId: normalizeText(typeof source.dispatchTargetNodeId === "string" ? source.dispatchTargetNodeId : "") || undefined,
    dispatchProtocolVersion: normalizeDispatchProtocolVersion(source.dispatchProtocolVersion),
    dispatchStatusSummary: normalizeText(typeof source.dispatchStatusSummary === "string" ? source.dispatchStatusSummary : "") || undefined,
    dispatchAuthSummary: normalizeText(typeof source.dispatchAuthSummary === "string" ? source.dispatchAuthSummary : "") || undefined,
    dispatchTransportStatus: normalizeDispatchTransportStatus(source.dispatchTransportStatus),
    remoteDispatchPlanned: typeof source.remoteDispatchPlanned === "boolean" ? source.remoteDispatchPlanned : undefined,
    planningHintSummary: normalizeText(typeof source.planningHintSummary === "string" ? source.planningHintSummary : "") || undefined,
    executionResult: normalizeExecutionRuntimeResult(source.executionResult),
    diagnosis: normalizeText(typeof source.diagnosis === "string" ? source.diagnosis : "") || undefined,
    verificationState: verificationState as AutonomousStepVerificationState | undefined,
    nextDecision: nextDecision as AutonomousStepDecision | undefined,
    failureClassification: normalizeFailureClassification(source.failureClassification),
    failureReason: normalizeText(typeof source.failureReason === "string" ? source.failureReason : "") || undefined,
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

  const session: AutonomousSession = {
    sessionId: normalizeText(params.sessionId) || createAutonomousSessionId(),
    goal: goal || "Resolve the current bounded autonomous debugging goal.",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    currentStepIndex: 1,
    maxSteps: clampAutonomousMaxSteps(params.maxSteps),
    lastStepIndex: 0,
    workflowContinuity: {
      progress: {
        chainPhase: "planning",
        currentChainStep: 1,
        totalKnownSteps: 0,
      },
      memory: {
        recentDecisions: [],
        priorRecoveryOutcomes: [],
      },
    },
    steps: [],
  };

  return {
    ...session,
    workflowContinuity: deriveAutonomousWorkflowContinuity(session),
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
    selectedNodeId: normalizeText(params.selectedNodeId) || undefined,
    selectedNodeReason: normalizeText(params.selectedNodeReason) || undefined,
    taskId: normalizeText(params.taskId) || undefined,
    taskStatus: params.taskStatus,
    assignedNodeId: normalizeText(params.assignedNodeId) || undefined,
    queueStateSummary: normalizeText(params.queueStateSummary) || undefined,
    dispatchMessageId: normalizeText(params.dispatchMessageId) || undefined,
    dispatchAckMessageId: normalizeText(params.dispatchAckMessageId) || undefined,
    dispatchResultMessageId: normalizeText(params.dispatchResultMessageId) || undefined,
    dispatchTargetNodeId: normalizeText(params.dispatchTargetNodeId) || undefined,
    dispatchProtocolVersion: params.dispatchProtocolVersion,
    dispatchStatusSummary: normalizeText(params.dispatchStatusSummary) || undefined,
    dispatchAuthSummary: normalizeText(params.dispatchAuthSummary) || undefined,
    dispatchTransportStatus: params.dispatchTransportStatus,
    remoteDispatchPlanned: typeof params.remoteDispatchPlanned === "boolean" ? params.remoteDispatchPlanned : undefined,
    planningHintSummary: normalizeText(params.planningHintSummary) || undefined,
    executionResult,
    diagnosis: normalizeText(params.diagnosis) || undefined,
    verificationState: params.verificationState,
    nextDecision: params.nextDecision,
    failureClassification: params.failureClassification,
    failureReason: normalizeText(params.failureReason) || undefined,
    recoveryStrategy: params.recoveryStrategy,
    retryCount: Number.isInteger(Number(params.retryCount)) ? Math.max(0, Number(params.retryCount)) : undefined,
    repeatedAction: typeof params.repeatedAction === "boolean" ? params.repeatedAction : undefined,
    repeatedOutput: typeof params.repeatedOutput === "boolean" ? params.repeatedOutput : undefined,
    stallReason: normalizeText(params.stallReason) || undefined,
    goalStatus: params.goalStatus,
    completionConfidence: params.completionConfidence,
    timestamp,
  };

  const nextSession: AutonomousSession = {
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
    selectedNodeId: step.selectedNodeId ?? session.selectedNodeId,
    selectedNodeReason: step.selectedNodeReason ?? session.selectedNodeReason,
    taskId: step.taskId ?? session.taskId,
    taskStatus: step.taskStatus ?? session.taskStatus,
    assignedNodeId: step.assignedNodeId ?? session.assignedNodeId,
    queueStateSummary: step.queueStateSummary ?? session.queueStateSummary,
    dispatchMessageId: step.dispatchMessageId ?? session.dispatchMessageId,
    dispatchAckMessageId: step.dispatchAckMessageId ?? session.dispatchAckMessageId,
    dispatchResultMessageId: step.dispatchResultMessageId ?? session.dispatchResultMessageId,
    dispatchTargetNodeId: step.dispatchTargetNodeId ?? session.dispatchTargetNodeId,
    dispatchProtocolVersion: step.dispatchProtocolVersion ?? session.dispatchProtocolVersion,
    dispatchStatusSummary: step.dispatchStatusSummary ?? session.dispatchStatusSummary,
    dispatchAuthSummary: step.dispatchAuthSummary ?? session.dispatchAuthSummary,
    dispatchTransportStatus: step.dispatchTransportStatus ?? session.dispatchTransportStatus,
    remoteDispatchPlanned: step.remoteDispatchPlanned ?? session.remoteDispatchPlanned,
    planningHintSummary: step.planningHintSummary ?? session.planningHintSummary,
    failureReason: step.failureReason ?? session.failureReason,
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
    workflowContinuity: session.workflowContinuity,
    steps: [...session.steps, step],
  };

  return {
    ...nextSession,
    workflowContinuity: deriveAutonomousWorkflowContinuity(nextSession),
  };
}

export function updateAutonomousSessionStatus(
  session: AutonomousSession,
  status: AutonomousSessionStatus,
  completedReason?: string,
): AutonomousSession {
  const nextReason = normalizeText(completedReason) || undefined;
  const nextSession: AutonomousSession = {
    ...session,
    status,
    updatedAt: createTimestamp(),
    completedReason: nextReason ?? session.completedReason,
    stateReason: nextReason ?? session.stateReason,
    workflowContinuity: session.workflowContinuity,
  };

  return {
    ...nextSession,
    workflowContinuity: deriveAutonomousWorkflowContinuity(nextSession),
  };
}

export function pauseAutonomousSession(
  session: AutonomousSession,
  reason: string,
  pendingAction?: ExecutionActionPreview,
): AutonomousSession {
  const nextSession: AutonomousSession = {
    ...updateAutonomousSessionStatus(session, "paused", reason),
    pendingAction: pendingAction ?? session.pendingAction,
    stateReason: normalizeText(reason) || session.stateReason,
    workflowContinuity: session.workflowContinuity,
  };

  return {
    ...nextSession,
    workflowContinuity: deriveAutonomousWorkflowContinuity(nextSession),
  };
}

export function markAwaitingApproval(
  session: AutonomousSession,
  pendingAction: ExecutionActionPreview,
  reason: string,
): AutonomousSession {
  const nextSession: AutonomousSession = {
    ...updateAutonomousSessionStatus(session, "awaiting-approval", reason),
    pendingAction,
    stateReason: normalizeText(reason) || session.stateReason,
    workflowContinuity: session.workflowContinuity,
  };

  return {
    ...nextSession,
    workflowContinuity: deriveAutonomousWorkflowContinuity(nextSession),
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

  const nextSession: AutonomousSession = {
    ...updateAutonomousSessionStatus(session, "active", normalizeText(options?.reason) || session.stateReason),
    stateReason: normalizeText(options?.reason) || session.stateReason,
    pendingAction: session.status === "awaiting-approval" && options?.approved ? session.pendingAction : undefined,
    workflowContinuity: session.workflowContinuity,
  };

  return {
    ...nextSession,
    workflowContinuity: deriveAutonomousWorkflowContinuity(nextSession),
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

  const normalized: AutonomousSession = {
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
    selectedNodeId: normalizeText(typeof source.selectedNodeId === "string" ? source.selectedNodeId : "") || undefined,
    selectedNodeReason: normalizeText(typeof source.selectedNodeReason === "string" ? source.selectedNodeReason : "") || undefined,
    taskId: normalizeText(typeof source.taskId === "string" ? source.taskId : "") || undefined,
    taskStatus: normalizeTaskStatus(source.taskStatus),
    assignedNodeId: normalizeText(typeof source.assignedNodeId === "string" ? source.assignedNodeId : "") || undefined,
    queueStateSummary: normalizeText(typeof source.queueStateSummary === "string" ? source.queueStateSummary : "") || undefined,
    dispatchMessageId: normalizeText(typeof source.dispatchMessageId === "string" ? source.dispatchMessageId : "") || undefined,
    dispatchAckMessageId: normalizeText(typeof source.dispatchAckMessageId === "string" ? source.dispatchAckMessageId : "") || undefined,
    dispatchResultMessageId: normalizeText(typeof source.dispatchResultMessageId === "string" ? source.dispatchResultMessageId : "") || undefined,
    dispatchTargetNodeId: normalizeText(typeof source.dispatchTargetNodeId === "string" ? source.dispatchTargetNodeId : "") || undefined,
    dispatchProtocolVersion: normalizeDispatchProtocolVersion(source.dispatchProtocolVersion),
    dispatchStatusSummary: normalizeText(typeof source.dispatchStatusSummary === "string" ? source.dispatchStatusSummary : "") || undefined,
    dispatchAuthSummary: normalizeText(typeof source.dispatchAuthSummary === "string" ? source.dispatchAuthSummary : "") || undefined,
    dispatchTransportStatus: normalizeDispatchTransportStatus(source.dispatchTransportStatus),
    remoteDispatchPlanned: typeof source.remoteDispatchPlanned === "boolean" ? source.remoteDispatchPlanned : undefined,
    planningHintSummary: normalizeText(typeof source.planningHintSummary === "string" ? source.planningHintSummary : "") || undefined,
    failureReason: normalizeText(typeof source.failureReason === "string" ? source.failureReason : "") || undefined,
    latestExecutionResult: normalizeExecutionRuntimeResult(source.latestExecutionResult),
    pendingAction: normalizeExecutionActionPreview(source.pendingAction),
    latestRecoveryState: normalizeAutonomousRecoveryState(source.latestRecoveryState),
    latestCompletion: normalizeAutonomousCompletionState(source.latestCompletion),
    workflowContinuity: {
      progress: {
        chainPhase: "planning",
        currentChainStep: 1,
        totalKnownSteps: 0,
      },
      memory: {
        recentDecisions: [],
        priorRecoveryOutcomes: [],
      },
    },
    steps,
  };

  return {
    ...normalized,
    workflowContinuity: normalizeAutonomousWorkflowContinuityState(source.workflowContinuity) ?? deriveAutonomousWorkflowContinuity(normalized),
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

  lines.push(
    `- Workflow continuity: phase=${session.workflowContinuity.progress.chainPhase}, current=${session.workflowContinuity.progress.currentChainStep}, total=${session.workflowContinuity.progress.totalKnownSteps}`,
  );

  if (typeof session.workflowContinuity.progress.lastCompletedSafeStep === "number") {
    lines.push(`- Last completed safe step: ${session.workflowContinuity.progress.lastCompletedSafeStep}`);
  }

  if (session.workflowContinuity.progress.currentRecoveryTarget) {
    lines.push(`- Current recovery target: ${session.workflowContinuity.progress.currentRecoveryTarget}`);
  }

  if (session.workflowContinuity.progress.nextIntendedStep) {
    lines.push(`- Next intended bounded step: ${session.workflowContinuity.progress.nextIntendedStep}`);
  }

  if (session.workflowContinuity.memory.chainSummary) {
    lines.push(`- Chain summary: ${session.workflowContinuity.memory.chainSummary}`);
  }

  if (session.workflowContinuity.memory.currentObjectiveSummary) {
    lines.push(`- Current objective summary: ${session.workflowContinuity.memory.currentObjectiveSummary}`);
  }

  if (session.workflowContinuity.memory.lastValidationOutcome) {
    lines.push(`- Last validation outcome: ${session.workflowContinuity.memory.lastValidationOutcome}`);
  }

  if (session.workflowContinuity.memory.lastFailureSummary) {
    lines.push(`- Last failure summary: ${session.workflowContinuity.memory.lastFailureSummary}`);
  }

  if (session.workflowContinuity.memory.lastFixAttemptSummary) {
    lines.push(`- Last fix attempt: ${session.workflowContinuity.memory.lastFixAttemptSummary}`);
  }

  if (session.workflowContinuity.memory.pendingNextActionSummary) {
    lines.push(`- Pending next action: ${session.workflowContinuity.memory.pendingNextActionSummary}`);
  }

  if (session.workflowContinuity.memory.operatorBlockers) {
    lines.push(`- Operator blockers: ${session.workflowContinuity.memory.operatorBlockers}`);
  }

  if (session.workflowContinuity.memory.pendingOperatorContext) {
    lines.push(`- Pending operator context: ${session.workflowContinuity.memory.pendingOperatorContext}`);
  }

  if (session.workflowContinuity.memory.recentDecisions.length > 0) {
    lines.push(`- Recent decisions: ${session.workflowContinuity.memory.recentDecisions.join(" | ")}`);
  }

  if (session.workflowContinuity.memory.restartReason) {
    lines.push(`- Restart reason: ${session.workflowContinuity.memory.restartReason}`);
  }

  if (session.workflowContinuity.memory.priorRecoveryOutcomes.length > 0) {
    lines.push(`- Prior recovery outcomes: ${session.workflowContinuity.memory.priorRecoveryOutcomes.join(" | ")}`);
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