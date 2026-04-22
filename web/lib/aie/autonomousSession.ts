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

export type AutonomousWorkflowRecommendedNextPhase =
  | "planning"
  | "implementation"
  | "validation"
  | "fix"
  | "retry"
  | "waiting-on-operator"
  | "restart-from-last-safe-boundary"
  | "completed-safe-boundary"
  | "stop";

export type AutonomousOperatorSteeringAction =
  | "accept-current-recommendation"
  | "prefer-validation-next"
  | "prefer-fix-next"
  | "restart-from-last-safe-boundary"
  | "pause-and-wait"
  | "stop-loop";

export type AutonomousOperatorSteeringStatus = "none" | "pending" | "applied" | "blocked";

export type AutonomousWorkflowSteeringState = {
  requestedAction?: AutonomousOperatorSteeringAction;
  requestedNextPhaseOverride?: AutonomousWorkflowRecommendedNextPhase;
  overrideReason?: string;
  requestedStopReason?: string;
  requestedRestartReason?: string;
  operatorNote?: string;
  requestedForStepIndex?: number;
  status: AutonomousOperatorSteeringStatus;
  blockedReason?: string;
  effectiveNextPhase?: AutonomousWorkflowRecommendedNextPhase;
};

export type AutonomousWorkflowRefinementOutcome = "pending" | "helped-progress" | "no-clear-improvement" | "still-blocked" | "blocked";

export type AutonomousWorkflowRefinementHistoryEntry = {
  requestedAtStepIndex: number;
  requestedAction?: AutonomousOperatorSteeringAction;
  requestedNextPhaseOverride?: AutonomousWorkflowRecommendedNextPhase;
  systemRecommendedNextPhase?: AutonomousWorkflowRecommendedNextPhase;
  overrideReason?: string;
  operatorNote?: string;
  requestedStopReason?: string;
  requestedRestartReason?: string;
};

export type AutonomousWorkflowRefinementState = {
  history: AutonomousWorkflowRefinementHistoryEntry[];
  lastOperatorRefinementNote?: string;
  lastOverrideReason?: string;
  recentOverridesImprovedProgress: boolean;
  similarFuturePreference?: AutonomousWorkflowRecommendedNextPhase;
  recommendationInfluencedByRecentGuidance: boolean;
  influencedRecommendedNextPhase?: AutonomousWorkflowRecommendedNextPhase;
  influenceReason?: string;
  refinementSummary?: string;
};

export type AutonomousWorkflowRecommendationReviewOutcome =
  | "pending"
  | "helped-progress"
  | "needed-correction"
  | "no-clear-improvement"
  | "still-blocked";

export type AutonomousWorkflowRecommendationFollowThroughStatus =
  | "pending"
  | "accepted-and-succeeded"
  | "accepted-needed-correction"
  | "redirected-and-improved-progress"
  | "repeated-review-no-progress"
  | "still-blocked";

export type AutonomousWorkflowRecommendationReviewHistoryEntry = {
  reviewedAtStepIndex: number;
  systemRecommendedNextPhase?: AutonomousWorkflowRecommendedNextPhase;
  recommendedNextPhase: AutonomousWorkflowRecommendedNextPhase;
  recommendationConfidence: AutonomousWorkflowRecommendationConfidence;
  likelyNeedsOperatorInput: boolean;
  topContributingSignals: AutonomousWorkflowRecommendationSignal[];
  recommendationRationaleSummary?: string;
  operatorResponse?: AutonomousOperatorSteeringAction;
  requestedNextPhaseOverride?: AutonomousWorkflowRecommendedNextPhase;
  operatorNote?: string;
  overrideReason?: string;
};

export type AutonomousWorkflowRecommendationReviewState = {
  history: AutonomousWorkflowRecommendationReviewHistoryEntry[];
  lastReviewedRecommendation?: AutonomousWorkflowRecommendedNextPhase;
  lastSystemRecommendation?: AutonomousWorkflowRecommendedNextPhase;
  lastOperatorResponse?: AutonomousOperatorSteeringAction;
  lastRecommendationOutcome?: AutonomousWorkflowRecommendationReviewOutcome;
  lastFollowThroughStatus?: AutonomousWorkflowRecommendationFollowThroughStatus;
  lastFollowThroughSummary?: string;
  lastAcceptedRecommendationOutcome?: AutonomousWorkflowRecommendationFollowThroughStatus;
  lastRedirectedRecommendationOutcome?: AutonomousWorkflowRecommendationFollowThroughStatus;
  lastReviewImprovedProgress: boolean;
  lastRecommendationNeededCorrection: boolean;
  followThroughLedUsefulProgress: boolean;
  followThroughRequiredCorrection: boolean;
  returnedToSameRecommendationAgain: boolean;
  repeatedReviewWithoutProgress: boolean;
  frequentlyOverridden: boolean;
  reviewSummary?: string;
};

export type AutonomousWorkflowRecommendationConfidence = "low" | "medium" | "high";

export type AutonomousWorkflowRecommendationSignal =
  | "recent-failed-validations"
  | "repeated-fix-attempts"
  | "helpful-operator-overrides"
  | "stalled-loop-indicators"
  | "blocker-present"
  | "blocker-persistence"
  | "safe-boundary-restart-value"
  | "fresh-implementation-change"
  | "actionable-validation-failure"
  | "retry-recovery-active"
  | "completed-safe-boundary"
  | "current-loop-progress";

export type AutonomousWorkflowLoopHealthState = {
  currentPhaseRepeatCount: number;
  recentPhaseOutcomes: string[];
  stalledLoop: boolean;
  operatorInterventionPreferred: boolean;
  topContributingSignals: AutonomousWorkflowRecommendationSignal[];
  recommendationRationaleSummary?: string;
  recommendationConfidence: AutonomousWorkflowRecommendationConfidence;
  likelyNeedsOperatorInput: boolean;
  systemRecommendedNextPhase?: AutonomousWorkflowRecommendedNextPhase;
  systemRecommendedNextActionSummary?: string;
  systemLoopHealthReason?: string;
  recommendedNextPhase: AutonomousWorkflowRecommendedNextPhase;
  recommendedNextActionSummary?: string;
  loopHealthReason?: string;
};

export type AutonomousWorkflowContinuityState = {
  progress: AutonomousWorkflowProgressState;
  memory: AutonomousWorkflowMemoryState;
  steering: AutonomousWorkflowSteeringState;
  refinement: AutonomousWorkflowRefinementState;
  review: AutonomousWorkflowRecommendationReviewState;
  loopHealth: AutonomousWorkflowLoopHealthState;
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

export type UpdateAutonomousSessionSteeringParams = {
  action?: AutonomousOperatorSteeringAction;
  operatorNote?: string;
  overrideReason?: string;
  stopReason?: string;
  restartReason?: string;
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

function createDefaultAutonomousWorkflowSteeringState(): AutonomousWorkflowSteeringState {
  return {
    status: "none",
  };
}

function createDefaultAutonomousWorkflowRefinementState(): AutonomousWorkflowRefinementState {
  return {
    history: [],
    recentOverridesImprovedProgress: false,
    recommendationInfluencedByRecentGuidance: false,
  };
}

function createDefaultAutonomousWorkflowRecommendationReviewState(): AutonomousWorkflowRecommendationReviewState {
  return {
    history: [],
    lastReviewImprovedProgress: false,
    lastRecommendationNeededCorrection: false,
    followThroughLedUsefulProgress: false,
    followThroughRequiredCorrection: false,
    returnedToSameRecommendationAgain: false,
    repeatedReviewWithoutProgress: false,
    frequentlyOverridden: false,
  };
}

function normalizeAutonomousOperatorSteeringAction(value: unknown): AutonomousOperatorSteeringAction | undefined {
  const normalized = normalizeText(typeof value === "string" ? value : "");
  if (
    normalized === "accept-current-recommendation"
    || normalized === "prefer-validation-next"
    || normalized === "prefer-fix-next"
    || normalized === "restart-from-last-safe-boundary"
    || normalized === "pause-and-wait"
    || normalized === "stop-loop"
  ) {
    return normalized as AutonomousOperatorSteeringAction;
  }

  return undefined;
}

function normalizeAutonomousOperatorSteeringStatus(value: unknown): AutonomousOperatorSteeringStatus | undefined {
  const normalized = normalizeText(typeof value === "string" ? value : "");
  if (normalized === "none" || normalized === "pending" || normalized === "applied" || normalized === "blocked") {
    return normalized as AutonomousOperatorSteeringStatus;
  }

  return undefined;
}

function normalizeAutonomousWorkflowRecommendationFollowThroughStatus(
  value: unknown,
): AutonomousWorkflowRecommendationFollowThroughStatus | undefined {
  return value === "pending"
    || value === "accepted-and-succeeded"
    || value === "accepted-needed-correction"
    || value === "redirected-and-improved-progress"
    || value === "repeated-review-no-progress"
    || value === "still-blocked"
    ? value
    : undefined;
}

function deriveRequestedNextPhaseOverride(
  action: AutonomousOperatorSteeringAction | undefined,
): AutonomousWorkflowRecommendedNextPhase | undefined {
  if (action === "accept-current-recommendation") {
    return undefined;
  }

  if (action === "prefer-validation-next") {
    return "validation";
  }

  if (action === "prefer-fix-next") {
    return "fix";
  }

  if (action === "restart-from-last-safe-boundary") {
    return "restart-from-last-safe-boundary";
  }

  if (action === "pause-and-wait") {
    return "waiting-on-operator";
  }

  if (action === "stop-loop") {
    return "stop";
  }

  return undefined;
}

function hasSteeringBeenApplied(session: AutonomousSession, requestedForStepIndex: number | undefined): boolean {
  if (typeof requestedForStepIndex !== "number") {
    return false;
  }

  const latestCompletedStep = session.lastStepIndex ?? session.steps.at(-1)?.index ?? 0;
  return latestCompletedStep >= requestedForStepIndex;
}

function clampRefinementHistoryEntries(
  entries: AutonomousWorkflowRefinementHistoryEntry[],
): AutonomousWorkflowRefinementHistoryEntry[] {
  return entries.slice(-6);
}

function clampRecommendationReviewHistoryEntries(
  entries: AutonomousWorkflowRecommendationReviewHistoryEntry[],
): AutonomousWorkflowRecommendationReviewHistoryEntry[] {
  return entries.slice(-6);
}

function normalizeAutonomousWorkflowRefinementHistoryEntry(value: unknown): AutonomousWorkflowRefinementHistoryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const requestedAtStepIndex = Number(source.requestedAtStepIndex ?? 0);
  if (!Number.isInteger(requestedAtStepIndex) || requestedAtStepIndex <= 0) {
    return null;
  }

  const requestedAction = normalizeAutonomousOperatorSteeringAction(source.requestedAction);
  const requestedNextPhaseOverride =
    normalizeAutonomousWorkflowRecommendedNextPhase(source.requestedNextPhaseOverride)
    ?? deriveRequestedNextPhaseOverride(requestedAction);

  return {
    requestedAtStepIndex,
    requestedAction,
    requestedNextPhaseOverride,
    systemRecommendedNextPhase: normalizeAutonomousWorkflowRecommendedNextPhase(source.systemRecommendedNextPhase),
    overrideReason: normalizeText(typeof source.overrideReason === "string" ? source.overrideReason : "") || undefined,
    operatorNote: normalizeText(typeof source.operatorNote === "string" ? source.operatorNote : "") || undefined,
    requestedStopReason: normalizeText(typeof source.requestedStopReason === "string" ? source.requestedStopReason : "") || undefined,
    requestedRestartReason: normalizeText(typeof source.requestedRestartReason === "string" ? source.requestedRestartReason : "") || undefined,
  };
}

function normalizeAutonomousWorkflowRecommendationReviewHistoryEntry(value: unknown): AutonomousWorkflowRecommendationReviewHistoryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const reviewedAtStepIndex = Number(source.reviewedAtStepIndex ?? 0);
  const recommendedNextPhase = normalizeAutonomousWorkflowRecommendedNextPhase(source.recommendedNextPhase);
  if (!Number.isInteger(reviewedAtStepIndex) || reviewedAtStepIndex <= 0 || !recommendedNextPhase) {
    return null;
  }

  return {
    reviewedAtStepIndex,
    systemRecommendedNextPhase: normalizeAutonomousWorkflowRecommendedNextPhase(source.systemRecommendedNextPhase),
    recommendedNextPhase,
    recommendationConfidence:
      source.recommendationConfidence === "low" || source.recommendationConfidence === "medium" || source.recommendationConfidence === "high"
        ? source.recommendationConfidence as AutonomousWorkflowRecommendationConfidence
        : "medium",
    likelyNeedsOperatorInput: typeof source.likelyNeedsOperatorInput === "boolean" ? source.likelyNeedsOperatorInput : false,
    topContributingSignals: clampWorkflowMemoryItems(
      Array.isArray(source.topContributingSignals) ? source.topContributingSignals as string[] : [],
    ) as AutonomousWorkflowRecommendationSignal[],
    recommendationRationaleSummary:
      normalizeText(typeof source.recommendationRationaleSummary === "string" ? source.recommendationRationaleSummary : "") || undefined,
    operatorResponse: normalizeAutonomousOperatorSteeringAction(source.operatorResponse),
    requestedNextPhaseOverride: normalizeAutonomousWorkflowRecommendedNextPhase(source.requestedNextPhaseOverride),
    operatorNote: normalizeText(typeof source.operatorNote === "string" ? source.operatorNote : "") || undefined,
    overrideReason: normalizeText(typeof source.overrideReason === "string" ? source.overrideReason : "") || undefined,
  };
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

function deriveWorkflowPhaseForStep(step: AutonomousStepRecord): "planning" | "implementation" | "validation" | "fix" | "retry" {
  if (step.recoveryStrategy === "retry-same-action" || step.recoveryStrategy === "narrow-scope") {
    return "retry";
  }

  if (step.executionResult?.status === "failed" && summarizeFixAttempt(step)) {
    return "fix";
  }

  if (summarizeValidationOutcome(step)) {
    return "validation";
  }

  if (summarizeFixAttempt(step)) {
    return "implementation";
  }

  return "planning";
}

function summarizePhaseOutcome(step: AutonomousStepRecord): string {
  const phase = deriveWorkflowPhaseForStep(step);
  const runtimeStatus = step.executionResult?.status ?? "unknown";
  return `${phase}:${runtimeStatus}${step.goalStatus ? `:${step.goalStatus}` : ""}`;
}

function derivePhaseRepeatCount(session: AutonomousSession, latestPhase: AutonomousWorkflowChainPhase): number {
  if (
    latestPhase === "waiting-on-operator"
    || latestPhase === "blocked"
    || latestPhase === "completed-safe-boundary"
    || latestPhase === "failed"
  ) {
    return 1;
  }

  let count = 0;
  for (let index = session.steps.length - 1; index >= 0; index -= 1) {
    if (deriveWorkflowPhaseForStep(session.steps[index] as AutonomousStepRecord) !== latestPhase) {
      break;
    }
    count += 1;
  }

  return Math.max(1, count);
}

function deriveStalledLoop(session: AutonomousSession, latestPhase: AutonomousWorkflowChainPhase, repeatCount: number): boolean {
  if (
    repeatCount < 3
    || latestPhase === "waiting-on-operator"
    || latestPhase === "blocked"
    || latestPhase === "completed-safe-boundary"
    || latestPhase === "failed"
  ) {
    return false;
  }

  const recentLoop = session.steps.slice(-repeatCount);
  const actions = new Set(recentLoop.map((step) => normalizeText(step.proposedAction) || "no-action"));
  const outcomes = new Set(recentLoop.map((step) => summarizeExecutionOutcome(step) || summarizeFailure(step) || "no-outcome"));
  const hasNewInformation = recentLoop.some((step) => {
    const changedPaths = Array.isArray(step.executionResult?.changedPaths) && step.executionResult.changedPaths.length > 0;
    return changedPaths || Boolean(normalizeText(step.executionResult?.diffSummary));
  });

  return actions.size === 1 && outcomes.size <= 1 && !hasNewInformation;
}

function countRecentPhaseFailures(session: AutonomousSession, phase: AutonomousWorkflowChainPhase): number {
  let count = 0;
  for (let index = session.steps.length - 1; index >= 0; index -= 1) {
    const step = session.steps[index] as AutonomousStepRecord;
    if (deriveWorkflowPhaseForStep(step) !== phase) {
      break;
    }

    if (step.executionResult?.status !== "failed") {
      break;
    }

    count += 1;
  }

  return count;
}

function chooseRecommendedPhaseFromScores(
  scores: Record<AutonomousWorkflowRecommendedNextPhase, number>,
): AutonomousWorkflowRecommendedNextPhase {
  const priorityOrder: AutonomousWorkflowRecommendedNextPhase[] = [
    "stop",
    "validation",
    "fix",
    "restart-from-last-safe-boundary",
    "waiting-on-operator",
    "retry",
    "implementation",
    "planning",
    "completed-safe-boundary",
  ];
  let bestPhase: AutonomousWorkflowRecommendedNextPhase = "planning";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const phase of priorityOrder) {
    const score = scores[phase] ?? 0;
    if (score > bestScore) {
      bestPhase = phase;
      bestScore = score;
    }
  }

  return bestPhase;
}

function summarizeRecommendationRationale(
  phase: AutonomousWorkflowRecommendedNextPhase,
  signals: AutonomousWorkflowRecommendationSignal[],
): string {
  if (signals.includes("blocker-present")) {
    return "A current bounded blocker is still present, so operator input remains the safest next step.";
  }

  if (signals.includes("stalled-loop-indicators") && signals.includes("safe-boundary-restart-value")) {
    return "The recent loop appears stalled and a safe restart point exists, so restarting from the last safe boundary is favored.";
  }

  if (signals.includes("fresh-implementation-change")) {
    return "A fresh bounded implementation change exists, so validation is favored before another fix attempt.";
  }

  if (signals.includes("actionable-validation-failure")) {
    return "Recent validation failures exposed a concrete issue, so a bounded fix is favored next.";
  }

  if (signals.includes("helpful-operator-overrides")) {
    return `Recent helpful operator guidance improved similar loops, so ${phase} is favored again in this bounded case.`;
  }

  if (signals.includes("retry-recovery-active")) {
    return "The bounded loop is still in an active recovery cycle, so the recommendation stays aligned with recovery.";
  }

  if (signals.includes("completed-safe-boundary")) {
    return "The goal is already complete at a safe boundary, so no broader follow-up is recommended.";
  }

  return "The bounded loop is still making useful progress with the current recommendation.";
}

function summarizeRecommendedNextAction(
  phase: AutonomousWorkflowRecommendedNextPhase,
  nextIntendedStep: string | undefined,
  currentRecoveryTarget: string | undefined,
  lastCompletedSafeStep: number | undefined,
  actionableFailure: string | undefined,
): string {
  if (phase === "validation") {
    return nextIntendedStep || "Validate next to confirm the latest bounded change or signal.";
  }

  if (phase === "fix") {
    return nextIntendedStep || (actionableFailure ? `Apply the next bounded fix for: ${actionableFailure}` : "Apply the next bounded fix.");
  }

  if (phase === "restart-from-last-safe-boundary") {
    return typeof lastCompletedSafeStep === "number"
      ? `Restart from last safe boundary at step ${lastCompletedSafeStep}.`
      : "Restart from the last safe boundary.";
  }

  if (phase === "waiting-on-operator") {
    return nextIntendedStep || "Wait for operator input before continuing.";
  }

  if (phase === "retry") {
    return nextIntendedStep || currentRecoveryTarget || "Retry with the current bounded recovery strategy.";
  }

  if (phase === "stop") {
    return "Stop because the bounded goal is complete at a safe boundary.";
  }

  return nextIntendedStep || "Continue the current bounded production loop.";
}

function deriveSystemLoopHealth(
  session: AutonomousSession,
  chainPhase: AutonomousWorkflowChainPhase,
  nextIntendedStep: string | undefined,
  currentRecoveryTarget: string | undefined,
  lastCompletedSafeStep: number | undefined,
  operatorBlockers: string | undefined,
): AutonomousWorkflowLoopHealthState {
  const currentPhaseRepeatCount = derivePhaseRepeatCount(session, chainPhase);
  const recentPhaseOutcomes = clampWorkflowMemoryItems(session.steps.slice(-4).map((step) => summarizePhaseOutcome(step)));
  const stalledLoop = deriveStalledLoop(session, chainPhase, currentPhaseRepeatCount);
  const latestStep = session.steps.at(-1);
  const recentFailedValidationCount = countRecentPhaseFailures(session, "validation");
  const recentFailedFixCount = countRecentPhaseFailures(session, "fix");
  const actionableFailure = normalizeText(session.latestRecoveryState?.failureClassification?.reason)
    || normalizeText(latestStep?.failureReason)
    || normalizeText(latestStep?.executionResult?.error)
    || undefined;
  const implementationJustChangedWork = Boolean(
    latestStep
    && summarizeFixAttempt(latestStep)
    && latestStep.executionResult?.status === "success"
    && (
      (Array.isArray(latestStep.executionResult.changedPaths) && latestStep.executionResult.changedPaths.length > 0)
      || Boolean(normalizeText(latestStep.executionResult.diffSummary))
    ),
  );
  const failedValidation = Boolean(latestStep && summarizeValidationOutcome(latestStep) && latestStep.executionResult?.status === "failed");

  if (operatorBlockers) {
    return {
      currentPhaseRepeatCount,
      recentPhaseOutcomes,
      stalledLoop,
      operatorInterventionPreferred: true,
      topContributingSignals: chainPhase === "waiting-on-operator" ? ["blocker-present", "blocker-persistence"] : ["blocker-present"],
      recommendationRationaleSummary: "A current bounded blocker is still present, so operator input remains the safest next step.",
      recommendationConfidence: "low",
      likelyNeedsOperatorInput: true,
      recommendedNextPhase: "waiting-on-operator",
      recommendedNextActionSummary: nextIntendedStep || "Wait for operator input before continuing.",
      loopHealthReason: operatorBlockers,
    };
  }

  if (stalledLoop) {
    return {
      currentPhaseRepeatCount,
      recentPhaseOutcomes,
      stalledLoop: true,
      operatorInterventionPreferred: true,
      topContributingSignals: typeof lastCompletedSafeStep === "number"
        ? ["stalled-loop-indicators", "safe-boundary-restart-value"]
        : ["stalled-loop-indicators"],
      recommendationRationaleSummary: typeof lastCompletedSafeStep === "number"
        ? "The recent loop appears stalled and a safe restart point exists, so restarting from the last safe boundary is favored."
        : "The recent loop appears stalled without a safe restart point, so operator input is favored before continuing.",
      recommendationConfidence: "low",
      likelyNeedsOperatorInput: typeof lastCompletedSafeStep !== "number",
      recommendedNextPhase: typeof lastCompletedSafeStep === "number" ? "restart-from-last-safe-boundary" : "waiting-on-operator",
      recommendedNextActionSummary: typeof lastCompletedSafeStep === "number"
        ? `Restart from last safe boundary at step ${lastCompletedSafeStep}.`
        : "Wait for operator input because the loop is repeating without new information.",
      loopHealthReason: "The current bounded loop repeated the same ineffective phase without new information.",
    };
  }

  if (chainPhase === "completed-safe-boundary") {
    return {
      currentPhaseRepeatCount,
      recentPhaseOutcomes,
      stalledLoop: false,
      operatorInterventionPreferred: false,
      topContributingSignals: ["completed-safe-boundary"],
      recommendationRationaleSummary: "The goal is already complete at a safe boundary, so no broader follow-up is recommended.",
      recommendationConfidence: "high",
      likelyNeedsOperatorInput: false,
      recommendedNextPhase: "stop",
      recommendedNextActionSummary: "Stop because the bounded goal is complete at a safe boundary.",
      loopHealthReason: "The bounded goal is complete at the current safe boundary.",
    };
  }
  const scores: Record<AutonomousWorkflowRecommendedNextPhase, number> = {
    planning: 0,
    implementation: 0,
    validation: 0,
    fix: 0,
    retry: 0,
    "waiting-on-operator": 0,
    "restart-from-last-safe-boundary": 0,
    "completed-safe-boundary": 0,
    stop: 0,
  };
  const contributingSignals: AutonomousWorkflowRecommendationSignal[] = [];
  let likelyNeedsOperatorInput = false;

  if (operatorBlockers) {
    contributingSignals.push("blocker-present");
    scores["waiting-on-operator"] += 6;
    likelyNeedsOperatorInput = true;
    if (chainPhase === "waiting-on-operator") {
      contributingSignals.push("blocker-persistence");
      scores["waiting-on-operator"] += 2;
    }
  }

  if (stalledLoop) {
    contributingSignals.push("stalled-loop-indicators");
    if (typeof lastCompletedSafeStep === "number") {
      contributingSignals.push("safe-boundary-restart-value");
      scores["restart-from-last-safe-boundary"] += 7;
    } else {
      scores["waiting-on-operator"] += 7;
      likelyNeedsOperatorInput = true;
    }
  }

  if (implementationJustChangedWork) {
    contributingSignals.push("fresh-implementation-change");
    scores.validation += 5;
  }

  if (failedValidation && actionableFailure) {
    contributingSignals.push("actionable-validation-failure");
    scores.fix += 4;
  }

  if (recentFailedValidationCount >= 2) {
    contributingSignals.push("recent-failed-validations");
    scores.fix += actionableFailure ? 2 : 1;
    if (typeof lastCompletedSafeStep === "number") {
      scores["restart-from-last-safe-boundary"] += 1;
    }
  }

  if (recentFailedFixCount >= 2) {
    contributingSignals.push("repeated-fix-attempts");
    if (typeof lastCompletedSafeStep === "number") {
      scores["restart-from-last-safe-boundary"] += 2;
    } else {
      scores["waiting-on-operator"] += 1;
    }
  }

  if (chainPhase === "retry") {
    contributingSignals.push("retry-recovery-active");
    scores.retry += 3;
    if (currentPhaseRepeatCount >= 2 && typeof lastCompletedSafeStep === "number") {
      contributingSignals.push("safe-boundary-restart-value");
      scores["restart-from-last-safe-boundary"] += 2;
    }
  }

  if (chainPhase === "completed-safe-boundary") {
    contributingSignals.push("completed-safe-boundary");
    scores.stop += 8;
  }

  if (contributingSignals.length === 0) {
    contributingSignals.push("current-loop-progress");
    scores[chainPhase === "waiting-on-operator" || chainPhase === "blocked" || chainPhase === "failed" ? "waiting-on-operator" : chainPhase] += 1;
  }

  const recommendedNextPhase = chooseRecommendedPhaseFromScores(scores);
  const recommendationRationaleSummary = summarizeRecommendationRationale(recommendedNextPhase, contributingSignals);
  const recommendationConfidence: AutonomousWorkflowRecommendationConfidence = operatorBlockers || stalledLoop
    ? "low"
    : contributingSignals.includes("fresh-implementation-change") || contributingSignals.includes("actionable-validation-failure")
      ? "high"
      : "medium";

  return {
    currentPhaseRepeatCount,
    recentPhaseOutcomes,
    stalledLoop,
    operatorInterventionPreferred: likelyNeedsOperatorInput || recommendedNextPhase === "waiting-on-operator" || recommendedNextPhase === "restart-from-last-safe-boundary",
    topContributingSignals: contributingSignals.slice(0, 4),
    recommendationRationaleSummary,
    recommendationConfidence,
    likelyNeedsOperatorInput,
    recommendedNextPhase,
    recommendedNextActionSummary: summarizeRecommendedNextAction(
      recommendedNextPhase,
      nextIntendedStep,
      currentRecoveryTarget,
      lastCompletedSafeStep,
      actionableFailure,
    ),
    loopHealthReason: operatorBlockers || recommendationRationaleSummary,
  };
}

function deriveOperatorSteeringState(params: {
  session: AutonomousSession;
  systemLoopHealth: AutonomousWorkflowLoopHealthState;
  lastCompletedSafeStep: number | undefined;
  actionableFailure: string | undefined;
  operatorBlockers: string | undefined;
}): AutonomousWorkflowSteeringState {
  const requested = params.session.workflowContinuity?.steering ?? createDefaultAutonomousWorkflowSteeringState();
  const requestedAction = normalizeAutonomousOperatorSteeringAction(requested.requestedAction);
  const requestedNextPhaseOverride =
    normalizeAutonomousWorkflowRecommendedNextPhase(requested.requestedNextPhaseOverride)
    ?? deriveRequestedNextPhaseOverride(requestedAction);
  const overrideReason = normalizeText(requested.overrideReason) || undefined;
  const operatorNote = normalizeText(requested.operatorNote) || undefined;
  const requestedStopReason = normalizeText(requested.requestedStopReason) || undefined;
  const requestedRestartReason = normalizeText(requested.requestedRestartReason) || undefined;
  const requestedForStepIndex = typeof requested.requestedForStepIndex === "number"
    ? Math.max(1, Math.floor(requested.requestedForStepIndex))
    : undefined;

  if (!requestedAction && !operatorNote) {
    return createDefaultAutonomousWorkflowSteeringState();
  }

  let blockedReason: string | undefined;
  if (requestedAction === "prefer-validation-next" && params.operatorBlockers) {
    blockedReason = params.operatorBlockers;
  } else if (requestedAction === "prefer-fix-next" && params.operatorBlockers) {
    blockedReason = params.operatorBlockers;
  } else if (requestedAction === "prefer-fix-next" && !params.actionableFailure) {
    blockedReason = "A bounded fix override needs an actionable failure before it can be applied.";
  } else if (requestedAction === "restart-from-last-safe-boundary" && params.operatorBlockers) {
    blockedReason = params.operatorBlockers;
  } else if (requestedAction === "restart-from-last-safe-boundary" && typeof params.lastCompletedSafeStep !== "number") {
    blockedReason = "No last safe boundary is recorded for this bounded loop yet.";
  }

  if (blockedReason) {
    return {
      requestedAction,
      requestedNextPhaseOverride,
      overrideReason,
      requestedStopReason,
      requestedRestartReason,
      operatorNote,
      requestedForStepIndex,
      status: "blocked",
      blockedReason,
      effectiveNextPhase: params.systemLoopHealth.recommendedNextPhase,
    };
  }

  const isImmediateOverride = requestedAction === "accept-current-recommendation" || requestedAction === "pause-and-wait" || requestedAction === "stop-loop";
  const status = isImmediateOverride
    ? "applied"
    : hasSteeringBeenApplied(params.session, requestedForStepIndex)
      ? "applied"
      : "pending";

  return {
    requestedAction,
    requestedNextPhaseOverride,
    overrideReason,
    requestedStopReason,
    requestedRestartReason,
    operatorNote,
    requestedForStepIndex,
    status,
    effectiveNextPhase: requestedNextPhaseOverride ?? params.systemLoopHealth.recommendedNextPhase,
  };
}

function applyOperatorSteeringToLoopHealth(params: {
  loopHealth: AutonomousWorkflowLoopHealthState;
  steering: AutonomousWorkflowSteeringState;
  lastCompletedSafeStep: number | undefined;
  actionableFailure: string | undefined;
}): AutonomousWorkflowLoopHealthState {
  const loopHealth: AutonomousWorkflowLoopHealthState = {
    ...params.loopHealth,
  };

  if (params.steering.status === "blocked" || params.steering.status === "none") {
    return loopHealth;
  }

  const requestedAction = params.steering.requestedAction;
  const operatorNote = params.steering.operatorNote;

  if (!requestedAction && operatorNote) {
    return {
      ...loopHealth,
      recommendedNextActionSummary: operatorNote,
      loopHealthReason: `Operator note recorded for the next bounded step: ${operatorNote}`,
    };
  }

  if (requestedAction === "accept-current-recommendation") {
    return {
      ...loopHealth,
      recommendedNextActionSummary:
        operatorNote
        || loopHealth.recommendedNextActionSummary
        || `Continue with the current bounded ${loopHealth.recommendedNextPhase} recommendation.`,
      loopHealthReason: operatorNote
        ? `Operator confirmed the current recommendation: ${operatorNote}`
        : `Operator confirmed the current bounded ${loopHealth.recommendedNextPhase} recommendation.`,
    };
  }

  if (requestedAction === "prefer-validation-next") {
    return {
      ...loopHealth,
      operatorInterventionPreferred: true,
      recommendedNextPhase: "validation",
      recommendedNextActionSummary: operatorNote || loopHealth.recommendedNextActionSummary || "Prefer validation next.",
      loopHealthReason: operatorNote
        ? `Operator requested validation next: ${operatorNote}`
        : "Operator requested validation as the next bounded step.",
    };
  }

  if (requestedAction === "prefer-fix-next") {
    return {
      ...loopHealth,
      operatorInterventionPreferred: true,
      recommendedNextPhase: "fix",
      recommendedNextActionSummary:
        operatorNote
        || (params.actionableFailure ? `Apply the next bounded fix for: ${params.actionableFailure}` : "Prefer a bounded fix next."),
      loopHealthReason: operatorNote
        ? `Operator requested a bounded fix next: ${operatorNote}`
        : "Operator requested a bounded fix as the next loop step.",
    };
  }

  if (requestedAction === "restart-from-last-safe-boundary") {
    return {
      ...loopHealth,
      operatorInterventionPreferred: true,
      recommendedNextPhase: "restart-from-last-safe-boundary",
      recommendedNextActionSummary:
        operatorNote
        || params.steering.requestedRestartReason
        || (typeof params.lastCompletedSafeStep === "number"
          ? `Restart from last safe boundary at step ${params.lastCompletedSafeStep}.`
          : "Restart from the last safe boundary."),
      loopHealthReason: operatorNote
        ? `Operator requested a restart from the last safe boundary: ${operatorNote}`
        : "Operator requested a restart from the last safe boundary.",
    };
  }

  if (requestedAction === "pause-and-wait") {
    return {
      ...loopHealth,
      operatorInterventionPreferred: true,
      recommendedNextPhase: "waiting-on-operator",
      recommendedNextActionSummary: operatorNote || "Pause and wait for operator input before continuing.",
      loopHealthReason: operatorNote
        ? `Operator paused the loop and left context for the next step: ${operatorNote}`
        : "Operator paused the loop and requested more input before continuing.",
    };
  }

  if (requestedAction === "stop-loop") {
    return {
      ...loopHealth,
      operatorInterventionPreferred: true,
      recommendedNextPhase: "stop",
      recommendedNextActionSummary:
        params.steering.requestedStopReason || operatorNote || "Stop the bounded loop because it is no longer useful.",
      loopHealthReason:
        params.steering.requestedStopReason
        || (operatorNote
          ? `Operator requested that the bounded loop stop: ${operatorNote}`
          : "Operator requested that the bounded loop stop."),
    };
  }

  return loopHealth;
}

function normalizeAutonomousWorkflowRecommendedNextPhase(value: unknown): AutonomousWorkflowRecommendedNextPhase | undefined {
  const normalized = normalizeText(typeof value === "string" ? value : "");
  if (
    normalized === "planning"
    || normalized === "implementation"
    || normalized === "validation"
    || normalized === "fix"
    || normalized === "retry"
    || normalized === "waiting-on-operator"
    || normalized === "restart-from-last-safe-boundary"
    || normalized === "completed-safe-boundary"
    || normalized === "stop"
  ) {
    return normalized as AutonomousWorkflowRecommendedNextPhase;
  }

  return undefined;
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
  const actionableFailure = normalizeText(session.latestRecoveryState?.failureClassification?.reason)
    || normalizeText(latestStep?.failureReason)
    || normalizeText(latestStep?.executionResult?.error)
    || undefined;
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
  const systemLoopHealth = deriveSystemLoopHealth(
    session,
    chainPhase,
    nextIntendedStep,
    currentRecoveryTarget,
    lastCompletedSafeStep,
    operatorBlockers,
  );
  const steering = deriveOperatorSteeringState({
    session,
    systemLoopHealth,
    lastCompletedSafeStep,
    actionableFailure,
    operatorBlockers,
  });
  const refinement = deriveOperatorRefinementState({
    session,
    systemLoopHealth,
    steering,
  });
  const refinementAwareLoopHealth = applyOperatorRefinementToLoopHealth({
    systemLoopHealth,
    steering,
    refinement,
  });
  const loopHealth = applyOperatorSteeringToLoopHealth({
    loopHealth: refinementAwareLoopHealth,
    steering,
    lastCompletedSafeStep,
    actionableFailure,
  });

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
    steering,
    refinement,
    loopHealth,
    review: deriveRecommendationReviewState({
      session,
      currentLoopHealth: loopHealth,
    }),
  };
}

function normalizeAutonomousWorkflowContinuityState(value: unknown): AutonomousWorkflowContinuityState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const progressSource = source.progress && typeof source.progress === "object" ? (source.progress as Record<string, unknown>) : undefined;
  const memorySource = source.memory && typeof source.memory === "object" ? (source.memory as Record<string, unknown>) : undefined;
  const steeringSource = source.steering && typeof source.steering === "object" ? (source.steering as Record<string, unknown>) : undefined;
  const refinementSource = source.refinement && typeof source.refinement === "object" ? (source.refinement as Record<string, unknown>) : undefined;
  const reviewSource = source.review && typeof source.review === "object" ? (source.review as Record<string, unknown>) : undefined;
  const loopHealthSource = source.loopHealth && typeof source.loopHealth === "object" ? (source.loopHealth as Record<string, unknown>) : undefined;
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
    steering: {
      requestedAction: normalizeAutonomousOperatorSteeringAction(steeringSource?.requestedAction),
      requestedNextPhaseOverride:
        normalizeAutonomousWorkflowRecommendedNextPhase(steeringSource?.requestedNextPhaseOverride)
        ?? deriveRequestedNextPhaseOverride(normalizeAutonomousOperatorSteeringAction(steeringSource?.requestedAction)),
      overrideReason: normalizeText(typeof steeringSource?.overrideReason === "string" ? steeringSource.overrideReason : "") || undefined,
      requestedStopReason: normalizeText(typeof steeringSource?.requestedStopReason === "string" ? steeringSource.requestedStopReason : "") || undefined,
      requestedRestartReason:
        normalizeText(typeof steeringSource?.requestedRestartReason === "string" ? steeringSource.requestedRestartReason : "") || undefined,
      operatorNote: normalizeText(typeof steeringSource?.operatorNote === "string" ? steeringSource.operatorNote : "") || undefined,
      requestedForStepIndex:
        Number.isInteger(Number(steeringSource?.requestedForStepIndex)) ? Math.max(1, Number(steeringSource?.requestedForStepIndex)) : undefined,
      status: normalizeAutonomousOperatorSteeringStatus(steeringSource?.status) ?? "none",
      blockedReason: normalizeText(typeof steeringSource?.blockedReason === "string" ? steeringSource.blockedReason : "") || undefined,
      effectiveNextPhase: normalizeAutonomousWorkflowRecommendedNextPhase(steeringSource?.effectiveNextPhase),
    },
    refinement: {
      history: clampRefinementHistoryEntries(
        Array.isArray(refinementSource?.history)
          ? (refinementSource?.history as unknown[])
              .map((entry) => normalizeAutonomousWorkflowRefinementHistoryEntry(entry))
              .filter((entry): entry is AutonomousWorkflowRefinementHistoryEntry => entry !== null)
          : [],
      ),
      lastOperatorRefinementNote:
        normalizeText(typeof refinementSource?.lastOperatorRefinementNote === "string" ? refinementSource.lastOperatorRefinementNote : "") || undefined,
      lastOverrideReason:
        normalizeText(typeof refinementSource?.lastOverrideReason === "string" ? refinementSource.lastOverrideReason : "") || undefined,
      recentOverridesImprovedProgress:
        typeof refinementSource?.recentOverridesImprovedProgress === "boolean" ? refinementSource.recentOverridesImprovedProgress : false,
      similarFuturePreference:
        normalizeAutonomousWorkflowRecommendedNextPhase(refinementSource?.similarFuturePreference) ?? undefined,
      recommendationInfluencedByRecentGuidance:
        typeof refinementSource?.recommendationInfluencedByRecentGuidance === "boolean"
          ? refinementSource.recommendationInfluencedByRecentGuidance
          : false,
      influencedRecommendedNextPhase:
        normalizeAutonomousWorkflowRecommendedNextPhase(refinementSource?.influencedRecommendedNextPhase) ?? undefined,
      influenceReason: normalizeText(typeof refinementSource?.influenceReason === "string" ? refinementSource.influenceReason : "") || undefined,
      refinementSummary: normalizeText(typeof refinementSource?.refinementSummary === "string" ? refinementSource.refinementSummary : "") || undefined,
    },
    review: {
      history: clampRecommendationReviewHistoryEntries(
        Array.isArray(reviewSource?.history)
          ? (reviewSource?.history as unknown[])
              .map((entry) => normalizeAutonomousWorkflowRecommendationReviewHistoryEntry(entry))
              .filter((entry): entry is AutonomousWorkflowRecommendationReviewHistoryEntry => entry !== null)
          : [],
      ),
      lastReviewedRecommendation: normalizeAutonomousWorkflowRecommendedNextPhase(reviewSource?.lastReviewedRecommendation) ?? undefined,
      lastSystemRecommendation: normalizeAutonomousWorkflowRecommendedNextPhase(reviewSource?.lastSystemRecommendation) ?? undefined,
      lastOperatorResponse: normalizeAutonomousOperatorSteeringAction(reviewSource?.lastOperatorResponse),
      lastRecommendationOutcome:
        reviewSource?.lastRecommendationOutcome === "pending"
        || reviewSource?.lastRecommendationOutcome === "helped-progress"
        || reviewSource?.lastRecommendationOutcome === "needed-correction"
        || reviewSource?.lastRecommendationOutcome === "no-clear-improvement"
        || reviewSource?.lastRecommendationOutcome === "still-blocked"
          ? reviewSource.lastRecommendationOutcome as AutonomousWorkflowRecommendationReviewOutcome
          : undefined,
      lastFollowThroughStatus: normalizeAutonomousWorkflowRecommendationFollowThroughStatus(reviewSource?.lastFollowThroughStatus),
      lastFollowThroughSummary:
        normalizeText(typeof reviewSource?.lastFollowThroughSummary === "string" ? reviewSource.lastFollowThroughSummary : "") || undefined,
      lastAcceptedRecommendationOutcome:
        normalizeAutonomousWorkflowRecommendationFollowThroughStatus(reviewSource?.lastAcceptedRecommendationOutcome),
      lastRedirectedRecommendationOutcome:
        normalizeAutonomousWorkflowRecommendationFollowThroughStatus(reviewSource?.lastRedirectedRecommendationOutcome),
      lastReviewImprovedProgress: typeof reviewSource?.lastReviewImprovedProgress === "boolean" ? reviewSource.lastReviewImprovedProgress : false,
      lastRecommendationNeededCorrection:
        typeof reviewSource?.lastRecommendationNeededCorrection === "boolean" ? reviewSource.lastRecommendationNeededCorrection : false,
      followThroughLedUsefulProgress:
        typeof reviewSource?.followThroughLedUsefulProgress === "boolean" ? reviewSource.followThroughLedUsefulProgress : false,
      followThroughRequiredCorrection:
        typeof reviewSource?.followThroughRequiredCorrection === "boolean" ? reviewSource.followThroughRequiredCorrection : false,
      returnedToSameRecommendationAgain:
        typeof reviewSource?.returnedToSameRecommendationAgain === "boolean" ? reviewSource.returnedToSameRecommendationAgain : false,
      repeatedReviewWithoutProgress:
        typeof reviewSource?.repeatedReviewWithoutProgress === "boolean" ? reviewSource.repeatedReviewWithoutProgress : false,
      frequentlyOverridden: typeof reviewSource?.frequentlyOverridden === "boolean" ? reviewSource.frequentlyOverridden : false,
      reviewSummary: normalizeText(typeof reviewSource?.reviewSummary === "string" ? reviewSource.reviewSummary : "") || undefined,
    },
    loopHealth: {
      currentPhaseRepeatCount: Number.isInteger(Number(loopHealthSource?.currentPhaseRepeatCount)) ? Math.max(1, Number(loopHealthSource?.currentPhaseRepeatCount)) : 1,
      recentPhaseOutcomes: clampWorkflowMemoryItems(Array.isArray(loopHealthSource?.recentPhaseOutcomes) ? loopHealthSource?.recentPhaseOutcomes as string[] : []),
      stalledLoop: typeof loopHealthSource?.stalledLoop === "boolean" ? loopHealthSource.stalledLoop : false,
      operatorInterventionPreferred:
        typeof loopHealthSource?.operatorInterventionPreferred === "boolean" ? loopHealthSource.operatorInterventionPreferred : false,
      topContributingSignals: clampWorkflowMemoryItems(
        Array.isArray(loopHealthSource?.topContributingSignals) ? loopHealthSource?.topContributingSignals as string[] : [],
      ) as AutonomousWorkflowRecommendationSignal[],
      recommendationRationaleSummary:
        normalizeText(typeof loopHealthSource?.recommendationRationaleSummary === "string" ? loopHealthSource.recommendationRationaleSummary : "") || undefined,
      recommendationConfidence:
        loopHealthSource?.recommendationConfidence === "low" || loopHealthSource?.recommendationConfidence === "medium" || loopHealthSource?.recommendationConfidence === "high"
          ? loopHealthSource.recommendationConfidence as AutonomousWorkflowRecommendationConfidence
          : "medium",
      likelyNeedsOperatorInput:
        typeof loopHealthSource?.likelyNeedsOperatorInput === "boolean" ? loopHealthSource.likelyNeedsOperatorInput : false,
      systemRecommendedNextPhase:
        normalizeAutonomousWorkflowRecommendedNextPhase(loopHealthSource?.systemRecommendedNextPhase) ?? undefined,
      systemRecommendedNextActionSummary:
        normalizeText(typeof loopHealthSource?.systemRecommendedNextActionSummary === "string" ? loopHealthSource.systemRecommendedNextActionSummary : "") || undefined,
      systemLoopHealthReason:
        normalizeText(typeof loopHealthSource?.systemLoopHealthReason === "string" ? loopHealthSource.systemLoopHealthReason : "") || undefined,
      recommendedNextPhase: normalizeAutonomousWorkflowRecommendedNextPhase(loopHealthSource?.recommendedNextPhase) ?? "planning",
      recommendedNextActionSummary:
        normalizeText(typeof loopHealthSource?.recommendedNextActionSummary === "string" ? loopHealthSource.recommendedNextActionSummary : "") || undefined,
      loopHealthReason: normalizeText(typeof loopHealthSource?.loopHealthReason === "string" ? loopHealthSource.loopHealthReason : "") || undefined,
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

function deriveRefinementOutcome(params: {
  session: AutonomousSession;
  entry: AutonomousWorkflowRefinementHistoryEntry;
  steering: AutonomousWorkflowSteeringState;
}): { outcome: AutonomousWorkflowRefinementOutcome; summary?: string } {
  const followUpSteps = params.session.steps.filter((step) => step.index >= params.entry.requestedAtStepIndex);
  if (
    params.steering.requestedForStepIndex === params.entry.requestedAtStepIndex
    && params.steering.status === "blocked"
  ) {
    return {
      outcome: "blocked",
      summary: params.steering.blockedReason || "The requested bounded override could not be applied.",
    };
  }

  if (followUpSteps.length === 0) {
    return {
      outcome: "pending",
      summary: "Waiting for the next bounded step to evaluate the operator guidance.",
    };
  }

  const successfulFollowUp = followUpSteps.find((step) => {
    if (step.goalStatus === "progressing" || step.goalStatus === "complete") {
      return true;
    }

    if (step.executionResult?.status === "success") {
      return true;
    }

    return false;
  });

  if (successfulFollowUp) {
    return {
      outcome: "helped-progress",
      summary: `Operator guidance improved progress at step ${successfulFollowUp.index}.`,
    };
  }

  if (
    params.session.status === "blocked"
    || params.session.status === "paused"
    || params.session.status === "awaiting-approval"
  ) {
    return {
      outcome: "still-blocked",
      summary: params.session.stateReason || "The loop is still waiting on an operator-side blocker.",
    };
  }

  return {
    outcome: "no-clear-improvement",
    summary: "The recent override did not produce clear bounded progress yet.",
  };
}

function deriveRecommendationReviewOutcome(params: {
  session: AutonomousSession;
  entry: AutonomousWorkflowRecommendationReviewHistoryEntry;
}): { outcome: AutonomousWorkflowRecommendationReviewOutcome; summary: string } {
  const followUpSteps = params.session.steps.filter((step) => step.index >= params.entry.reviewedAtStepIndex);

  if (followUpSteps.length === 0) {
    return {
      outcome: "pending",
      summary: "This recommendation review is waiting for the next bounded step.",
    };
  }

  const successfulFollowUp = followUpSteps.find((step) => {
    return step.executionResult?.status === "success"
      || step.goalStatus === "progressing"
      || step.goalStatus === "complete"
      || step.nextDecision === "continue";
  });

  if (successfulFollowUp) {
    const recommendationNeededCorrection = Boolean(
      params.entry.operatorResponse
      && params.entry.operatorResponse !== "accept-current-recommendation",
    );

    return {
      outcome: recommendationNeededCorrection ? "needed-correction" : "helped-progress",
      summary: recommendationNeededCorrection
        ? `A reviewed alternate recommendation improved progress at step ${successfulFollowUp.index}.`
        : `The reviewed recommendation helped progress at step ${successfulFollowUp.index}.`,
    };
  }

  if (
    params.session.status === "blocked"
    || params.session.status === "paused"
    || params.session.status === "awaiting-approval"
  ) {
    return {
      outcome: "still-blocked",
      summary: params.session.stateReason || "The loop is still waiting at a bounded operator-side blocker.",
    };
  }

  return {
    outcome: "no-clear-improvement",
    summary: "The reviewed recommendation does not show clear bounded improvement yet.",
  };
}

function deriveRecommendationFollowThroughStatus(params: {
  entry: AutonomousWorkflowRecommendationReviewHistoryEntry;
  outcome: AutonomousWorkflowRecommendationReviewOutcome;
  outcomeSummary: string;
  nextHistoryEntry?: AutonomousWorkflowRecommendationReviewHistoryEntry;
  currentLoopHealth: AutonomousWorkflowLoopHealthState;
  currentStepIndex: number;
  repeatedReviewWithoutProgress: boolean;
}): {
  status: AutonomousWorkflowRecommendationFollowThroughStatus;
  summary: string;
  ledUsefulProgress: boolean;
  requiredCorrection: boolean;
  returnedToSameRecommendationAgain: boolean;
} {
  const acceptedRecommendation = params.entry.operatorResponse === "accept-current-recommendation";
  const redirectedRecommendation = Boolean(
    params.entry.operatorResponse && params.entry.operatorResponse !== "accept-current-recommendation",
  );
  const returnedToSameRecommendationAgain =
    params.currentStepIndex > params.entry.reviewedAtStepIndex
    && params.currentLoopHealth.recommendedNextPhase === params.entry.recommendedNextPhase;
  const laterCorrectionApplied = acceptedRecommendation && Boolean(
    params.nextHistoryEntry?.operatorResponse
    && params.nextHistoryEntry.operatorResponse !== "accept-current-recommendation",
  );

  if (laterCorrectionApplied) {
    return {
      status: "accepted-needed-correction",
      summary: `The accepted ${params.entry.recommendedNextPhase} recommendation later needed correction.`,
      ledUsefulProgress: params.outcome === "helped-progress",
      requiredCorrection: true,
      returnedToSameRecommendationAgain,
    };
  }

  if (acceptedRecommendation && params.outcome === "helped-progress") {
    return {
      status: "accepted-and-succeeded",
      summary: `The accepted ${params.entry.recommendedNextPhase} recommendation produced useful bounded progress.`,
      ledUsefulProgress: true,
      requiredCorrection: false,
      returnedToSameRecommendationAgain,
    };
  }

  if (redirectedRecommendation && (params.outcome === "needed-correction" || params.outcome === "helped-progress")) {
    return {
      status: "redirected-and-improved-progress",
      summary: `The redirected recommendation improved bounded progress after operator review.`,
      ledUsefulProgress: true,
      requiredCorrection: true,
      returnedToSameRecommendationAgain,
    };
  }

  if (params.outcome === "still-blocked") {
    return {
      status: "still-blocked",
      summary: params.outcomeSummary,
      ledUsefulProgress: false,
      requiredCorrection: redirectedRecommendation,
      returnedToSameRecommendationAgain,
    };
  }

  if (params.outcome === "pending") {
    return {
      status: "pending",
      summary: params.outcomeSummary,
      ledUsefulProgress: false,
      requiredCorrection: false,
      returnedToSameRecommendationAgain,
    };
  }

  return {
    status: "repeated-review-no-progress",
    summary: params.repeatedReviewWithoutProgress || returnedToSameRecommendationAgain
      ? `The loop returned to the same ${params.entry.recommendedNextPhase} recommendation without useful progress yet.`
      : params.outcomeSummary,
    ledUsefulProgress: false,
    requiredCorrection: redirectedRecommendation,
    returnedToSameRecommendationAgain,
  };
}

function summarizeRefinementHistoryPreference(
  entries: Array<AutonomousWorkflowRefinementHistoryEntry & { outcome: AutonomousWorkflowRefinementOutcome }>,
): AutonomousWorkflowRecommendedNextPhase | undefined {
  const counts = new Map<AutonomousWorkflowRecommendedNextPhase, number>();
  for (const entry of entries) {
    if (entry.outcome !== "helped-progress" || !entry.requestedNextPhaseOverride) {
      continue;
    }

    counts.set(entry.requestedNextPhaseOverride, (counts.get(entry.requestedNextPhaseOverride) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function deriveOperatorRefinementState(params: {
  session: AutonomousSession;
  systemLoopHealth: AutonomousWorkflowLoopHealthState;
  steering: AutonomousWorkflowSteeringState;
}): AutonomousWorkflowRefinementState {
  const priorRefinement = params.session.workflowContinuity?.refinement ?? createDefaultAutonomousWorkflowRefinementState();
  const history = clampRefinementHistoryEntries(priorRefinement.history ?? []);

  if (history.length === 0) {
    return createDefaultAutonomousWorkflowRefinementState();
  }

  const evaluatedHistory = history.map((entry) => {
    const evaluation = deriveRefinementOutcome({
      session: params.session,
      entry,
      steering: params.steering,
    });

    return {
      ...entry,
      outcome: evaluation.outcome,
      evaluationSummary: evaluation.summary,
    };
  });
  const successfulInfluence = [...evaluatedHistory].reverse().find((entry) => {
    return entry.outcome === "helped-progress"
      && Boolean(entry.requestedNextPhaseOverride)
      && Boolean(entry.systemRecommendedNextPhase)
      && entry.systemRecommendedNextPhase === params.systemLoopHealth.recommendedNextPhase
      && entry.requestedNextPhaseOverride !== params.systemLoopHealth.recommendedNextPhase;
  });
  const similarFuturePreference = summarizeRefinementHistoryPreference(evaluatedHistory);
  const lastHistoryEntry = evaluatedHistory.at(-1);
  const influenceReason = successfulInfluence
    ? successfulInfluence.overrideReason
      || successfulInfluence.operatorNote
      || `A prior operator override improved progress by preferring ${successfulInfluence.requestedNextPhaseOverride}.`
    : undefined;
  const refinementSummary = lastHistoryEntry
    ? `Last refinement: ${lastHistoryEntry.requestedAction ?? "operator-note"} -> ${lastHistoryEntry.outcome}${lastHistoryEntry.evaluationSummary ? ` (${lastHistoryEntry.evaluationSummary})` : ""}`
    : undefined;

  return {
    history,
    lastOperatorRefinementNote: lastHistoryEntry?.operatorNote,
    lastOverrideReason: lastHistoryEntry?.overrideReason,
    recentOverridesImprovedProgress: evaluatedHistory.slice(-3).some((entry) => entry.outcome === "helped-progress"),
    similarFuturePreference,
    recommendationInfluencedByRecentGuidance:
      params.steering.status === "none"
      && Boolean(successfulInfluence?.requestedNextPhaseOverride),
    influencedRecommendedNextPhase:
      params.steering.status === "none" ? successfulInfluence?.requestedNextPhaseOverride : undefined,
    influenceReason,
    refinementSummary,
  };
}

function deriveRecommendationReviewState(params: {
  session: AutonomousSession;
  currentLoopHealth: AutonomousWorkflowLoopHealthState;
}): AutonomousWorkflowRecommendationReviewState {
  const priorReview = params.session.workflowContinuity?.review ?? createDefaultAutonomousWorkflowRecommendationReviewState();
  const history = clampRecommendationReviewHistoryEntries(priorReview.history ?? []);

  if (history.length === 0) {
    return createDefaultAutonomousWorkflowRecommendationReviewState();
  }

  const evaluatedHistory = history.map((entry, index) => {
    const evaluation = deriveRecommendationReviewOutcome({
      session: params.session,
      entry,
    });

    return {
      ...entry,
      outcome: evaluation.outcome,
      evaluationSummary: evaluation.summary,
      nextHistoryEntry: history[index + 1],
    };
  });
  const lastHistoryEntry = evaluatedHistory.at(-1);
  if (!lastHistoryEntry) {
    return createDefaultAutonomousWorkflowRecommendationReviewState();
  }

  const repeatedReviewWithoutProgress = evaluatedHistory.slice(-2).length >= 2
    && evaluatedHistory.slice(-2).every((entry) => {
      return entry.outcome === "no-clear-improvement" || entry.outcome === "still-blocked";
    });
  const followThrough = deriveRecommendationFollowThroughStatus({
    entry: lastHistoryEntry,
    outcome: lastHistoryEntry.outcome,
    outcomeSummary: lastHistoryEntry.evaluationSummary,
    nextHistoryEntry: lastHistoryEntry.nextHistoryEntry,
    currentLoopHealth: params.currentLoopHealth,
    currentStepIndex: params.session.currentStepIndex,
    repeatedReviewWithoutProgress,
  });
  const recentOverrides = history.slice(-4).filter((entry) => {
    return Boolean(entry.operatorResponse) && entry.operatorResponse !== "accept-current-recommendation";
  }).length;
  const lastAcceptedRecommendationOutcome = [...evaluatedHistory].reverse().find((entry) => {
    return entry.operatorResponse === "accept-current-recommendation";
  });
  const lastRedirectedRecommendationOutcome = [...evaluatedHistory].reverse().find((entry) => {
    return Boolean(entry.operatorResponse) && entry.operatorResponse !== "accept-current-recommendation";
  });
  const acceptedFollowThrough = lastAcceptedRecommendationOutcome
    ? deriveRecommendationFollowThroughStatus({
        entry: lastAcceptedRecommendationOutcome,
        outcome: lastAcceptedRecommendationOutcome.outcome,
        outcomeSummary: lastAcceptedRecommendationOutcome.evaluationSummary,
        nextHistoryEntry: lastAcceptedRecommendationOutcome.nextHistoryEntry,
        currentLoopHealth: params.currentLoopHealth,
        currentStepIndex: params.session.currentStepIndex,
        repeatedReviewWithoutProgress: false,
      }).status
    : undefined;
  const redirectedFollowThrough = lastRedirectedRecommendationOutcome
    ? deriveRecommendationFollowThroughStatus({
        entry: lastRedirectedRecommendationOutcome,
        outcome: lastRedirectedRecommendationOutcome.outcome,
        outcomeSummary: lastRedirectedRecommendationOutcome.evaluationSummary,
        nextHistoryEntry: lastRedirectedRecommendationOutcome.nextHistoryEntry,
        currentLoopHealth: params.currentLoopHealth,
        currentStepIndex: params.session.currentStepIndex,
        repeatedReviewWithoutProgress: false,
      }).status
    : undefined;
  const lastRecommendationNeededCorrection = lastHistoryEntry.outcome === "needed-correction";
  const lastReviewImprovedProgress = lastHistoryEntry.outcome === "helped-progress" || lastHistoryEntry.outcome === "needed-correction";

  return {
    history,
    lastReviewedRecommendation: lastHistoryEntry.recommendedNextPhase,
    lastSystemRecommendation: lastHistoryEntry.systemRecommendedNextPhase,
    lastOperatorResponse: lastHistoryEntry.operatorResponse,
    lastRecommendationOutcome: lastHistoryEntry.outcome,
    lastFollowThroughStatus: followThrough.status,
    lastFollowThroughSummary: followThrough.summary,
    lastAcceptedRecommendationOutcome: acceptedFollowThrough,
    lastRedirectedRecommendationOutcome: redirectedFollowThrough,
    lastReviewImprovedProgress,
    lastRecommendationNeededCorrection,
    followThroughLedUsefulProgress: followThrough.ledUsefulProgress,
    followThroughRequiredCorrection: followThrough.requiredCorrection,
    returnedToSameRecommendationAgain: followThrough.returnedToSameRecommendationAgain,
    repeatedReviewWithoutProgress,
    frequentlyOverridden: recentOverrides >= 2,
    reviewSummary: `Last review: ${lastHistoryEntry.recommendedNextPhase} -> ${lastHistoryEntry.operatorResponse ?? "operator-note"} (${followThrough.summary})`,
  };
}

function applyOperatorRefinementToLoopHealth(params: {
  systemLoopHealth: AutonomousWorkflowLoopHealthState;
  steering: AutonomousWorkflowSteeringState;
  refinement: AutonomousWorkflowRefinementState;
}): AutonomousWorkflowLoopHealthState {
  const loopHealth: AutonomousWorkflowLoopHealthState = {
    ...params.systemLoopHealth,
    systemRecommendedNextPhase: params.systemLoopHealth.recommendedNextPhase,
    systemRecommendedNextActionSummary: params.systemLoopHealth.recommendedNextActionSummary,
    systemLoopHealthReason: params.systemLoopHealth.loopHealthReason,
  };

  if (
    params.steering.status !== "none"
    || !params.refinement.recommendationInfluencedByRecentGuidance
    || !params.refinement.influencedRecommendedNextPhase
  ) {
    return loopHealth;
  }

  return {
    ...loopHealth,
    operatorInterventionPreferred: true,
    topContributingSignals: clampWorkflowMemoryItems([
      ...loopHealth.topContributingSignals,
      "helpful-operator-overrides",
    ]) as AutonomousWorkflowRecommendationSignal[],
    recommendationRationaleSummary:
      params.refinement.influenceReason
      || `Recent operator-guided refinement suggests preferring ${params.refinement.influencedRecommendedNextPhase}.`,
    recommendationConfidence: loopHealth.recommendationConfidence === "low" ? "medium" : loopHealth.recommendationConfidence,
    recommendedNextPhase: params.refinement.influencedRecommendedNextPhase,
    recommendedNextActionSummary:
      params.refinement.lastOperatorRefinementNote
      || `Recent operator guidance suggests preferring ${params.refinement.influencedRecommendedNextPhase} in this bounded loop.`,
    loopHealthReason:
      params.refinement.influenceReason
      || `Recent operator-guided loop refinement suggests preferring ${params.refinement.influencedRecommendedNextPhase}.`,
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
      steering: createDefaultAutonomousWorkflowSteeringState(),
      refinement: createDefaultAutonomousWorkflowRefinementState(),
      review: createDefaultAutonomousWorkflowRecommendationReviewState(),
      loopHealth: {
        currentPhaseRepeatCount: 1,
        recentPhaseOutcomes: [],
        stalledLoop: false,
        operatorInterventionPreferred: false,
        topContributingSignals: [],
        recommendationConfidence: "medium",
        likelyNeedsOperatorInput: false,
        recommendedNextPhase: "planning",
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
      steering: createDefaultAutonomousWorkflowSteeringState(),
      refinement: createDefaultAutonomousWorkflowRefinementState(),
      review: createDefaultAutonomousWorkflowRecommendationReviewState(),
      loopHealth: {
        currentPhaseRepeatCount: 1,
        recentPhaseOutcomes: [],
        stalledLoop: false,
        operatorInterventionPreferred: false,
        topContributingSignals: [],
        recommendationConfidence: "medium",
        likelyNeedsOperatorInput: false,
        recommendedNextPhase: "planning",
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

  if (session.workflowContinuity.steering.requestedAction) {
    lines.push(`- Operator override request: ${session.workflowContinuity.steering.requestedAction}`);
  }

  lines.push(`- Operator override status: ${session.workflowContinuity.steering.status}`);

  if (session.workflowContinuity.steering.overrideReason) {
    lines.push(`- Operator override reason: ${session.workflowContinuity.steering.overrideReason}`);
  }

  if (session.workflowContinuity.steering.operatorNote) {
    lines.push(`- Operator note for next step: ${session.workflowContinuity.steering.operatorNote}`);
  }

  if (session.workflowContinuity.steering.blockedReason) {
    lines.push(`- Operator override blocked reason: ${session.workflowContinuity.steering.blockedReason}`);
  }

  if (session.workflowContinuity.review.reviewSummary) {
    lines.push(`- Recommendation review summary: ${session.workflowContinuity.review.reviewSummary}`);
  }

  if (session.workflowContinuity.review.lastReviewedRecommendation) {
    lines.push(`- Last reviewed recommendation: ${session.workflowContinuity.review.lastReviewedRecommendation}`);
  }

  if (session.workflowContinuity.review.lastOperatorResponse) {
    lines.push(`- Last operator review response: ${session.workflowContinuity.review.lastOperatorResponse}`);
  }

  if (session.workflowContinuity.review.lastRecommendationOutcome) {
    lines.push(`- Last recommendation review outcome: ${session.workflowContinuity.review.lastRecommendationOutcome}`);
  }

  if (session.workflowContinuity.review.lastFollowThroughStatus) {
    lines.push(`- Last recommendation follow-through status: ${session.workflowContinuity.review.lastFollowThroughStatus}`);
  }

  if (session.workflowContinuity.review.lastFollowThroughSummary) {
    lines.push(`- Last recommendation follow-through summary: ${session.workflowContinuity.review.lastFollowThroughSummary}`);
  }

  if (session.workflowContinuity.review.lastAcceptedRecommendationOutcome) {
    lines.push(`- Last accepted recommendation outcome: ${session.workflowContinuity.review.lastAcceptedRecommendationOutcome}`);
  }

  if (session.workflowContinuity.review.lastRedirectedRecommendationOutcome) {
    lines.push(`- Last redirected recommendation outcome: ${session.workflowContinuity.review.lastRedirectedRecommendationOutcome}`);
  }

  lines.push(`- Recommendation follow-through helped: ${String(session.workflowContinuity.review.followThroughLedUsefulProgress)}`);
  lines.push(`- Recommendation follow-through required correction: ${String(session.workflowContinuity.review.followThroughRequiredCorrection)}`);
  lines.push(`- Recommendation returned to the same phase: ${String(session.workflowContinuity.review.returnedToSameRecommendationAgain)}`);
  lines.push(`- Recommendation review repeating without progress: ${String(session.workflowContinuity.review.repeatedReviewWithoutProgress)}`);

  lines.push(`- Recommendation frequently overridden: ${String(session.workflowContinuity.review.frequentlyOverridden)}`);

  if (session.workflowContinuity.loopHealth.systemRecommendedNextPhase) {
    lines.push(`- System recommended next phase: ${session.workflowContinuity.loopHealth.systemRecommendedNextPhase}`);
  }

  lines.push(`- Current phase repeat count: ${session.workflowContinuity.loopHealth.currentPhaseRepeatCount}`);
  lines.push(`- Stalled loop: ${String(session.workflowContinuity.loopHealth.stalledLoop)}`);
  lines.push(`- Operator intervention preferred: ${String(session.workflowContinuity.loopHealth.operatorInterventionPreferred)}`);
  lines.push(`- Recommendation confidence: ${session.workflowContinuity.loopHealth.recommendationConfidence}`);
  lines.push(`- Likely needs operator input: ${String(session.workflowContinuity.loopHealth.likelyNeedsOperatorInput)}`);
  lines.push(`- Recommended next phase: ${session.workflowContinuity.loopHealth.recommendedNextPhase}`);

  if (session.workflowContinuity.loopHealth.recommendationRationaleSummary) {
    lines.push(`- Recommendation rationale: ${session.workflowContinuity.loopHealth.recommendationRationaleSummary}`);
  }

  if (session.workflowContinuity.loopHealth.topContributingSignals.length) {
    lines.push(`- Top recommendation signals: ${session.workflowContinuity.loopHealth.topContributingSignals.join(", ")}`);
  }

  if (session.workflowContinuity.loopHealth.recommendedNextActionSummary) {
    lines.push(`- Recommended next action: ${session.workflowContinuity.loopHealth.recommendedNextActionSummary}`);
  }

  if (session.workflowContinuity.loopHealth.loopHealthReason) {
    lines.push(`- Loop health reason: ${session.workflowContinuity.loopHealth.loopHealthReason}`);
  }

  if (session.workflowContinuity.loopHealth.systemLoopHealthReason) {
    lines.push(`- System loop health reason: ${session.workflowContinuity.loopHealth.systemLoopHealthReason}`);
  }

  if (session.workflowContinuity.refinement.lastOperatorRefinementNote) {
    lines.push(`- Last operator refinement note: ${session.workflowContinuity.refinement.lastOperatorRefinementNote}`);
  }

  if (session.workflowContinuity.refinement.lastOverrideReason) {
    lines.push(`- Last override reason: ${session.workflowContinuity.refinement.lastOverrideReason}`);
  }

  lines.push(`- Recent overrides improved progress: ${String(session.workflowContinuity.refinement.recentOverridesImprovedProgress)}`);

  if (session.workflowContinuity.refinement.similarFuturePreference) {
    lines.push(`- Similar future preference: ${session.workflowContinuity.refinement.similarFuturePreference}`);
  }

  lines.push(
    `- Recommendation influenced by recent guidance: ${String(session.workflowContinuity.refinement.recommendationInfluencedByRecentGuidance)}`,
  );

  if (session.workflowContinuity.refinement.influenceReason) {
    lines.push(`- Refinement influence reason: ${session.workflowContinuity.refinement.influenceReason}`);
  }

  if (session.workflowContinuity.refinement.refinementSummary) {
    lines.push(`- Refinement summary: ${session.workflowContinuity.refinement.refinementSummary}`);
  }

  if (session.workflowContinuity.loopHealth.recentPhaseOutcomes.length > 0) {
    lines.push(`- Recent phase outcomes: ${session.workflowContinuity.loopHealth.recentPhaseOutcomes.join(" | ")}`);
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

export function updateAutonomousSessionSteering(
  session: AutonomousSession,
  params: UpdateAutonomousSessionSteeringParams,
): AutonomousSession {
  const requestedAction = params.action;
  const operatorNote = normalizeText(params.operatorNote) || undefined;
  const overrideReason = normalizeText(params.overrideReason) || undefined;
  const systemRecommendedNextPhase = session.workflowContinuity.loopHealth.systemRecommendedNextPhase
    ?? session.workflowContinuity.loopHealth.recommendedNextPhase;
  const requestedNextPhaseOverride = deriveRequestedNextPhaseOverride(requestedAction);
  const nextSession: AutonomousSession = {
    ...session,
    updatedAt: createTimestamp(),
    workflowContinuity: {
      ...session.workflowContinuity,
      steering: {
        requestedAction,
        requestedNextPhaseOverride,
        overrideReason,
        requestedStopReason: normalizeText(params.stopReason) || undefined,
        requestedRestartReason: normalizeText(params.restartReason) || undefined,
        operatorNote,
        requestedForStepIndex: session.currentStepIndex,
        status: requestedAction || operatorNote ? "pending" : "none",
      },
      refinement: {
        ...session.workflowContinuity.refinement,
        history: clampRefinementHistoryEntries([
          ...(session.workflowContinuity.refinement.history ?? []),
          {
            requestedAtStepIndex: session.currentStepIndex,
            requestedAction,
            requestedNextPhaseOverride,
            systemRecommendedNextPhase,
            overrideReason,
            operatorNote,
            requestedStopReason: normalizeText(params.stopReason) || undefined,
            requestedRestartReason: normalizeText(params.restartReason) || undefined,
          },
        ]),
      },
      review: {
        ...session.workflowContinuity.review,
        history: clampRecommendationReviewHistoryEntries([
          ...(session.workflowContinuity.review.history ?? []),
          {
            reviewedAtStepIndex: session.currentStepIndex,
            systemRecommendedNextPhase,
            recommendedNextPhase: session.workflowContinuity.loopHealth.recommendedNextPhase,
            recommendationConfidence: session.workflowContinuity.loopHealth.recommendationConfidence,
            likelyNeedsOperatorInput: session.workflowContinuity.loopHealth.likelyNeedsOperatorInput,
            topContributingSignals: session.workflowContinuity.loopHealth.topContributingSignals,
            recommendationRationaleSummary: session.workflowContinuity.loopHealth.recommendationRationaleSummary,
            operatorResponse: requestedAction,
            requestedNextPhaseOverride,
            operatorNote,
            overrideReason,
          },
        ]),
      },
    },
  };

  return {
    ...nextSession,
    workflowContinuity: deriveAutonomousWorkflowContinuity(nextSession),
  };
}

export function clearAutonomousSessionSteering(session: AutonomousSession): AutonomousSession {
  const nextSession: AutonomousSession = {
    ...session,
    updatedAt: createTimestamp(),
    workflowContinuity: {
      ...session.workflowContinuity,
      steering: createDefaultAutonomousWorkflowSteeringState(),
    },
  };

  return {
    ...nextSession,
    workflowContinuity: deriveAutonomousWorkflowContinuity(nextSession),
  };
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