import type { FailureClassification } from "./failureClassifier";
import { isReadOnlyGoal } from "./goalEvaluator";
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
  executedActionPreview?: ExecutionActionPreview;
  actionFamily?: AutonomousActionFamily;
  executionAdapterId?: ExecutionAdapterId;
  adapterContextSummary?: string;
  executionNodeId?: string;
  executionNodeMode?: ExecutionNodeMode;
  nodeCapabilitySummary?: string;
  selectedNodeId?: string;
  selectedNodeReason?: string;
  taskId?: string;
  featureId?: string;
  featureTitle?: string;
  featureDescription?: string;
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
  | "confirm-deliverable-acceptance"
  | "reject-deliverable-acceptance"
  | "prefer-validation-next"
  | "prefer-fix-next"
  | "restart-from-last-safe-boundary"
  | "skip-current-task"
  | "pause-and-wait"
  | "stop-loop"
  | "force-stop";

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

export type AutonomousWorkflowRecommendationEscalationStatus =
  | "none"
  | "monitor"
  | "alternate-path-recommended"
  | "operator-intervention-recommended"
  | "restart-recommended"
  | "stop-recommended";

export type AutonomousWorkflowRecommendationRecoveryRecommendation =
  | "none"
  | "operator-intervention"
  | "restart-from-last-safe-boundary"
  | "validation-first"
  | "fix-first"
  | "stop-loop";

export type AutonomousWorkflowRecommendationHandoffStatus =
  | "none"
  | "waiting-on-operator-decision"
  | "escalation-acknowledged"
  | "recovery-selected"
  | "recovery-executing"
  | "recovery-completed"
  | "second-escalation-needed";

export type AutonomousWorkflowRecommendationHandoffRecoveryMode =
  | AutonomousWorkflowRecommendationRecoveryRecommendation
  | "current-recommendation";

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

export type AutonomousWorkflowRecommendationEscalationState = {
  escalationStatus: AutonomousWorkflowRecommendationEscalationStatus;
  recoveryRecommendation: AutonomousWorkflowRecommendationRecoveryRecommendation;
  likelyNeedsOperatorInterventionNow: boolean;
  repeatedIneffectiveReviewCycles: boolean;
  acceptedRecommendationsRepeatedlyRequiringCorrection: boolean;
  redirectedRecommendationsOutperformSystem: boolean;
  returnedToSameIneffectiveState: boolean;
  escalationSummary?: string;
  recoverySummary?: string;
};

export type AutonomousWorkflowRecommendationHandoffHistoryEntry = {
  initiatedAtStepIndex: number;
  escalationStatus: AutonomousWorkflowRecommendationEscalationStatus;
  recoveryRecommendation: AutonomousWorkflowRecommendationRecoveryRecommendation;
  operatorAcknowledged: boolean;
  selectedRecoveryAction?: AutonomousOperatorSteeringAction;
  selectedRecoveryMode?: AutonomousWorkflowRecommendationHandoffRecoveryMode;
  operatorNote?: string;
  overrideReason?: string;
};

export type AutonomousWorkflowRecommendationHandoffState = {
  history: AutonomousWorkflowRecommendationHandoffHistoryEntry[];
  handoffStatus: AutonomousWorkflowRecommendationHandoffStatus;
  selectedRecoveryAction?: AutonomousOperatorSteeringAction;
  selectedRecoveryMode?: AutonomousWorkflowRecommendationHandoffRecoveryMode;
  selectedRecoveryReason?: string;
  waitingOnOperatorDecision: boolean;
  recoveryExecutionInProgress: boolean;
  recoveryExecutionCompleted: boolean;
  recoveryImprovedProgress: boolean;
  secondEscalationNeeded: boolean;
  handoffSummary?: string;
  recoveryExecutionSummary?: string;
};

export type AutonomousSessionMode = "general" | "repo-coding";

export type AutonomousWorkflowCodingLoopPhase =
  | "none"
  | "implementation"
  | "validation-pending"
  | "validation-failed"
  | "correction-pending"
  | "validation-recovered"
  | "review"
  | "escalation"
  | "supervised-recovery";

export type AutonomousWorkflowCodingTargetStatus =
  | "none"
  | "implementation-in-progress"
  | "awaiting-validation"
  | "validation-failed"
  | "under-correction"
  | "accepted"
  | "under-review"
  | "escalated"
  | "supervised-recovery";

export type AutonomousWorkflowCodingCompletionState =
  | "in-progress"
  | "ready-for-acceptance"
  | "accepted"
  | "rejected";

export type AutonomousWorkflowCodingOutputArtifact = {
  stepIndex: number;
  filePath: string;
  changeSummary?: string;
  diffLikeSummary?: string;
  linkedToDeliverable: boolean;
};

export type AutonomousWorkflowRepoActionApprovalStatus = "pending" | "approved" | "executed";

export type AutonomousWorkflowRepoActionExecutionStatus = "awaiting-approval" | "approved-awaiting-execution" | "executed" | "failed";

export type AutonomousWorkflowRepoAction = {
  actionId: string;
  artifactStepIndex: number;
  artifactFilePaths: string[];
  changeSummary?: string;
  artifactReference: string;
  approvalStatus: AutonomousWorkflowRepoActionApprovalStatus;
  executionStatus: AutonomousWorkflowRepoActionExecutionStatus;
  executed: boolean;
  failureReason?: string;
  executionPreview?: ExecutionActionPreview;
};

export type AutonomousWorkflowCodingState = {
  sessionMode: AutonomousSessionMode;
  codingLoopPhase: AutonomousWorkflowCodingLoopPhase;
  targetScope?: string;
  currentCodingObjective?: string;
  currentDeliverableTarget?: string;
  expectedOutputForm?: string;
  validationSuccessTarget?: string;
  currentAcceptanceTarget?: string;
  currentTargetStatus: AutonomousWorkflowCodingTargetStatus;
  validationProves?: string;
  validationTargetMatchesDeliverable: boolean;
  validationFailureImpact?: string;
  correctionMaintainsDeliverable: boolean;
  deliverableChangedDuringCorrectionOrEscalation: boolean;
  deliverableAccepted: boolean;
  acceptanceReason?: string;
  acceptanceConfidence: AutonomousWorkflowRecommendationConfidence;
  completionState: AutonomousWorkflowCodingCompletionState;
  operatorConfirmationRequired: boolean;
  shouldTerminateLoop: boolean;
  outputArtifacts: AutonomousWorkflowCodingOutputArtifact[];
  lastOutputSummary?: string;
  outputLinkedToDeliverable: boolean;
  pendingRepoActions: AutonomousWorkflowRepoAction[];
  approvedRepoActions: AutonomousWorkflowRepoAction[];
  executedRepoActions: AutonomousWorkflowRepoAction[];
  approvalStateSummary?: string;
  repoActionSummary?: string;
  integritySummary?: string;
  acceptanceSummary?: string;
  currentValidationTarget?: string;
  validationTarget?: string;
  lastCodeChangeSummary?: string;
  lastImplementationSummary?: string;
  lastValidationSummary?: string;
  lastValidationResultSummary?: string;
  lastValidationPassed: boolean;
  currentCorrectionTarget?: string;
  lastCorrectionSummary?: string;
  repeatedValidationOutcome?: string;
  validationFirstActive: boolean;
  repeatedValidationFailureDrivingEscalation: boolean;
  nextIntendedCodingAction?: string;
  escalationActive: boolean;
  supervisedRecoveryActive: boolean;
  codingSummary?: string;
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

export type AutonomousWorkflowTaskChainStatus =
  | "idle"
  | "selecting-next-task"
  | "executing-task"
  | "validating-task"
  | "awaiting-approval"
  | "blocked"
  | "completed";

export type AutonomousFeatureBundleStatus = "planned" | "in-progress" | "completed" | "blocked";

export type AutonomousGeneratedTaskQueueEntry = {
  taskId: string;
  priority: number;
  dependsOnTaskIds: string[];
  featureId?: string;
  featureTitle?: string;
  featureDescription?: string;
  status: TaskEnvelopeStatus | "skipped";
};

export type AutonomousFeatureBundleSummary = {
  featureId: string;
  featureTitle: string;
  featureDescription?: string;
  relatedTasks: string[];
  featureStatus: AutonomousFeatureBundleStatus;
  completedTaskCount: number;
  totalTaskCount: number;
  blockedTaskIds: string[];
  currentTaskId?: string;
  nextRecommendedTaskId?: string;
};

export type AutonomousWorkflowTaskChainState = {
  generatedTaskQueue: AutonomousGeneratedTaskQueueEntry[];
  currentTaskId?: string;
  currentFeatureId?: string;
  completedTaskIds: string[];
  blockedTaskIds: string[];
  skippedTaskIds: string[];
  nextRecommendedTaskId?: string;
  nextRecommendedFeatureId?: string;
  chainStatus: AutonomousWorkflowTaskChainStatus;
};

export type AutonomousSessionPauseReason =
  | "approval-required"
  | "critical-task-failure"
  | "dependency-missing"
  | "all-tasks-blocked"
  | "all-tasks-complete"
  | "max-tasks-reached"
  | "max-failures-reached"
  | "max-runtime-reached"
  | "operator-paused"
  | "operator-stopped"
  | "session-limit-reached";

export type AutonomousSessionLoopState = {
  sessionStartedAt: string;
  lastUpdatedAt: string;
  maxTasksPerSession: number;
  maxFailuresPerSession: number;
  maxRuntimeMs?: number;
  completedTaskIds: string[];
  skippedTaskIds: string[];
  blockedTaskIds: string[];
  failureCount: number;
  currentActiveTaskId?: string;
  lastCompletedTaskId?: string;
  nextRecommendedTaskId?: string;
  pauseReason?: AutonomousSessionPauseReason;
  pauseSummary?: string;
};

export type AutonomousWorkflowContinuityState = {
  progress: AutonomousWorkflowProgressState;
  memory: AutonomousWorkflowMemoryState;
  steering: AutonomousWorkflowSteeringState;
  refinement: AutonomousWorkflowRefinementState;
  review: AutonomousWorkflowRecommendationReviewState;
  escalation: AutonomousWorkflowRecommendationEscalationState;
  handoff: AutonomousWorkflowRecommendationHandoffState;
  coding: AutonomousWorkflowCodingState;
  taskChain: AutonomousWorkflowTaskChainState;
  loopHealth: AutonomousWorkflowLoopHealthState;
};

export type AutonomousCompletionState = Pick<GoalEvaluation, "status" | "isComplete" | "reason" | "confidence">;

export type AutonomousSession = {
  sessionId: string;
  goal: string;
  sessionMode: AutonomousSessionMode;
  status: AutonomousSessionStatus;
  createdAt: string;
  updatedAt: string;
  currentStepIndex: number;
  maxSteps: number;
  sessionLoop: AutonomousSessionLoopState;
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
  oversight: AutonomousSessionOversight;
  steps: AutonomousStepRecord[];
};

export type AutonomousTaskReviewStatus = "active" | "completed" | "blocked" | "failed" | "skipped" | "pending";

export type AutonomousTaskReviewRecord = {
  taskId: string;
  title: string;
  status: AutonomousTaskReviewStatus;
  whySelected: string;
  outputsProduced: string[];
  validationResult: string;
  repoActionsGenerated: boolean;
  approvalNeeded: boolean;
  transitionSummary: string;
};

export type AutonomousOperatorAttentionKind =
  | "waiting-for-approval"
  | "blocked-by-dependency"
  | "failed-task-requires-judgment"
  | "session-limit-reached"
  | "unsafe-manual-review";

export type AutonomousOperatorAttentionItem = {
  kind: AutonomousOperatorAttentionKind;
  summary: string;
  recommendedOperatorAction: string;
};

export type AutonomousOperatorControlAction =
  | "pause-session"
  | "resume-session"
  | "skip-current-task"
  | "force-stop"
  | "approve-repo-action"
  | "reject-repo-action";

export type AutonomousOperatorControlGuide = {
  action: AutonomousOperatorControlAction;
  label: string;
  available: boolean;
  description: string;
  likelyConsequence: string;
};

export type AutonomousSessionSummaryArtifact = {
  sessionId: string;
  startTime: string;
  endTime: string;
  tasksAttempted: number;
  tasksCompleted: number;
  tasksBlocked: number;
  tasksFailed: number;
  approvalsRequested: number;
  approvalsExecuted: number;
  currentPauseReason: string;
  recommendedNextStep: string;
  currentFeatureId?: string;
  currentFeatureTitle?: string;
  currentFeatureProgress?: string;
  completedFeatures: number;
  blockedFeatures: number;
  keyFilesOrAssetsChanged: string[];
  validationSummary: string;
  safeToResume: boolean;
};

export type AutonomousSessionOversight = {
  summary: AutonomousSessionSummaryArtifact;
  operatorAttention: AutonomousOperatorAttentionItem[];
  controls: AutonomousOperatorControlGuide[];
  taskReviews: AutonomousTaskReviewRecord[];
  currentTaskId?: string;
  currentFeatureId?: string;
  currentFeatureTitle?: string;
  featureBundles: AutonomousFeatureBundleSummary[];
  recentCompletedTaskIds: string[];
  blockedTaskIds: string[];
  completedFeatureIds: string[];
  blockedFeatureIds: string[];
  pendingApprovalActionIds: string[];
};

type CreateAutonomousSessionParams = {
  goal: string;
  maxSteps?: number;
  maxTasksPerSession?: number;
  maxFailuresPerSession?: number;
  maxRuntimeMs?: number;
  sessionId?: string;
  sessionMode?: AutonomousSessionMode;
};

type AppendAutonomousStepParams = {
  proposedAction?: string;
  expectedOutcome?: string;
  executedActionPreview?: ExecutionActionPreview;
  actionFamily?: AutonomousActionFamily;
  executionAdapterId?: ExecutionAdapterId;
  adapterContextSummary?: string;
  executionNodeId?: string;
  executionNodeMode?: ExecutionNodeMode;
  nodeCapabilitySummary?: string;
  selectedNodeId?: string;
  selectedNodeReason?: string;
  taskId?: string;
  featureId?: string;
  featureTitle?: string;
  featureDescription?: string;
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

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function summarizeTaskReviewTitle(step: AutonomousStepRecord, taskId: string): string {
  const actionSummary = normalizeText(step.proposedAction);
  if (actionSummary) {
    return actionSummary.length > 96 ? `${actionSummary.slice(0, 93)}...` : actionSummary;
  }

  return `Task ${taskId}`;
}

function summarizeTaskReviewValidation(taskSteps: AutonomousStepRecord[]): string {
  const validationStep = [...taskSteps].reverse().find((step) => step.goalStatus || step.executionResult?.status || step.diagnosis);
  if (!validationStep) {
    return "No validation result was recorded for this task.";
  }

  if (validationStep.goalStatus) {
    return `Goal status: ${validationStep.goalStatus}${validationStep.executionResult?.status ? ` | runtime=${validationStep.executionResult.status}` : ""}`;
  }

  if (validationStep.executionResult?.status) {
    return `Runtime status: ${validationStep.executionResult.status}`;
  }

  return validationStep.diagnosis || "No validation result was recorded for this task.";
}

function summarizeTaskReviewTransition(status: AutonomousTaskReviewStatus, taskSteps: AutonomousStepRecord[]): string {
  const lastStep = taskSteps.at(-1);
  const reason = normalizeText(
    lastStep?.failureReason
    || lastStep?.stallReason
    || lastStep?.diagnosis
    || lastStep?.queueStateSummary
    || lastStep?.dispatchStatusSummary,
  );

  if (status === "completed") {
    return reason || "This task completed and the bounded session advanced.";
  }

  if (status === "failed" || status === "blocked") {
    return reason || "This task stopped without a successful bounded outcome and needs operator review.";
  }

  if (status === "skipped") {
    return reason || "The operator skipped this task and the session moved to the next runnable task.";
  }

  if (status === "active") {
    return reason || "This task is currently active inside the bounded session.";
  }

  return reason || "This task has not produced a terminal result yet.";
}

function buildAutonomousFeatureProgressLabel(bundle: AutonomousFeatureBundleSummary): string {
  return `${bundle.completedTaskCount}/${bundle.totalTaskCount} tasks completed`;
}

function deriveAutonomousFeatureBundles(session: AutonomousSession): AutonomousFeatureBundleSummary[] {
  const queue = session.workflowContinuity.taskChain.generatedTaskQueue;
  const currentTaskId = normalizeText(session.workflowContinuity.taskChain.currentTaskId) || undefined;
  const nextRecommendedTaskId = normalizeText(session.workflowContinuity.taskChain.nextRecommendedTaskId) || undefined;
  const groups = new Map<string, AutonomousFeatureBundleSummary>();

  for (const entry of queue) {
    const featureId = normalizeText(entry.featureId) || `task-${entry.taskId}`;
    const featureTitle = normalizeText(entry.featureTitle) || `Task ${entry.taskId}`;
    const existing = groups.get(featureId);
    if (!existing) {
      groups.set(featureId, {
        featureId,
        featureTitle,
        featureDescription: normalizeText(entry.featureDescription) || undefined,
        relatedTasks: [entry.taskId],
        featureStatus: "planned",
        completedTaskCount: entry.status === "completed" || entry.status === "skipped" ? 1 : 0,
        totalTaskCount: 1,
        blockedTaskIds:
          entry.status === "blocked" || entry.status === "failed" || entry.status === "rejected"
            ? [entry.taskId]
            : [],
        currentTaskId: currentTaskId === entry.taskId ? entry.taskId : undefined,
        nextRecommendedTaskId: nextRecommendedTaskId === entry.taskId ? entry.taskId : undefined,
      });
      continue;
    }

    existing.relatedTasks.push(entry.taskId);
    existing.totalTaskCount += 1;
    if (!existing.featureDescription) {
      existing.featureDescription = normalizeText(entry.featureDescription) || undefined;
    }
    if (entry.status === "completed" || entry.status === "skipped") {
      existing.completedTaskCount += 1;
    }
    if (entry.status === "blocked" || entry.status === "failed" || entry.status === "rejected") {
      existing.blockedTaskIds.push(entry.taskId);
    }
    if (currentTaskId === entry.taskId) {
      existing.currentTaskId = entry.taskId;
    }
    if (nextRecommendedTaskId === entry.taskId) {
      existing.nextRecommendedTaskId = entry.taskId;
    }
  }

  for (const step of session.steps) {
    const taskId = normalizeText(step.taskId) || `step-${step.index}`;
    const featureId = normalizeText(step.featureId);
    const featureTitle = normalizeText(step.featureTitle);
    if (!featureId || !featureTitle) {
      continue;
    }

    const existing = groups.get(featureId);
    const stepCountsAsCompleted = step.taskStatus === "completed";
    const stepCountsAsBlocked = step.executionResult?.status === "failed" || step.nextDecision === "stop";

    if (!existing) {
      groups.set(featureId, {
        featureId,
        featureTitle,
        featureDescription: normalizeText(step.featureDescription) || undefined,
        relatedTasks: [taskId],
        featureStatus: "planned",
        completedTaskCount: stepCountsAsCompleted ? 1 : 0,
        totalTaskCount: 1,
        blockedTaskIds: stepCountsAsBlocked ? [taskId] : [],
        currentTaskId: currentTaskId === taskId ? taskId : undefined,
        nextRecommendedTaskId: nextRecommendedTaskId === taskId ? taskId : undefined,
      });
      continue;
    }

    const taskAlreadyTracked = existing.relatedTasks.includes(taskId);

    if (!taskAlreadyTracked) {
      existing.relatedTasks.push(taskId);
      existing.totalTaskCount += 1;
    }
    if (!existing.featureDescription) {
      existing.featureDescription = normalizeText(step.featureDescription) || undefined;
    }
    if (stepCountsAsCompleted && !taskAlreadyTracked) {
      existing.completedTaskCount += 1;
    }
    if (stepCountsAsBlocked && !existing.blockedTaskIds.includes(taskId)) {
      existing.blockedTaskIds.push(taskId);
    }
    if (currentTaskId === taskId) {
      existing.currentTaskId = taskId;
    }
    if (nextRecommendedTaskId === taskId) {
      existing.nextRecommendedTaskId = taskId;
    }
  }

  return [...groups.values()]
    .map((bundle) => {
      const hasBlockedTasks = bundle.blockedTaskIds.length > 0;
      const isCurrent = Boolean(bundle.currentTaskId);
      const hasNextRecommendation = Boolean(bundle.nextRecommendedTaskId);
      const isCompleted = bundle.totalTaskCount > 0 && bundle.completedTaskCount >= bundle.totalTaskCount;
      const awaitingApprovalOnCurrentFeature = session.status === "awaiting-approval"
        && normalizeText(session.pendingAction?.id)
        && normalizeText(session.oversight.currentFeatureId) !== bundle.featureId
        ? false
        : session.status === "awaiting-approval"
          && bundle.featureId === (normalizeText(session.workflowContinuity.taskChain.currentFeatureId) || normalizeText(session.steps.at(-1)?.featureId));

      return {
        ...bundle,
        relatedTasks: [...bundle.relatedTasks],
        blockedTaskIds: [...bundle.blockedTaskIds],
        featureStatus: isCompleted
          ? "completed"
          : (hasBlockedTasks && !isCurrent && !hasNextRecommendation) || awaitingApprovalOnCurrentFeature
            ? "blocked"
            : isCurrent || hasNextRecommendation || bundle.completedTaskCount > 0
              ? "in-progress"
              : "planned",
      };
    })
    .sort((left, right) => left.featureTitle.localeCompare(right.featureTitle) || left.featureId.localeCompare(right.featureId));
}

function deriveAutonomousTaskReviewRecords(session: AutonomousSession): AutonomousTaskReviewRecord[] {
  const outputArtifacts = session.workflowContinuity.coding.outputArtifacts ?? [];
  const repoActionPaths = uniqueStrings([
    ...session.workflowContinuity.coding.pendingRepoActions.flatMap((action) => action.artifactFilePaths),
    ...session.workflowContinuity.coding.approvedRepoActions.flatMap((action) => action.artifactFilePaths),
    ...session.workflowContinuity.coding.executedRepoActions.flatMap((action) => action.artifactFilePaths),
  ]);
  const reviewGroups = new Map<string, AutonomousStepRecord[]>();

  for (const step of session.steps) {
    const taskId = normalizeText(step.taskId) || `step-${step.index}`;
    reviewGroups.set(taskId, [...(reviewGroups.get(taskId) ?? []), step]);
  }

  for (const taskId of session.workflowContinuity.taskChain.completedTaskIds) {
    if (!reviewGroups.has(taskId)) {
      reviewGroups.set(taskId, []);
    }
  }

  for (const taskId of session.workflowContinuity.taskChain.blockedTaskIds) {
    if (!reviewGroups.has(taskId)) {
      reviewGroups.set(taskId, []);
    }
  }

  for (const taskId of session.workflowContinuity.taskChain.skippedTaskIds) {
    if (!reviewGroups.has(taskId)) {
      reviewGroups.set(taskId, []);
    }
  }

  if (session.workflowContinuity.taskChain.currentTaskId && !reviewGroups.has(session.workflowContinuity.taskChain.currentTaskId)) {
    reviewGroups.set(session.workflowContinuity.taskChain.currentTaskId, []);
  }

  return [...reviewGroups.entries()].map(([taskId, taskSteps]) => {
    const firstStep = taskSteps[0];
    const taskStepIndexes = new Set(taskSteps.map((step) => step.index));
    const artifactPaths = uniqueStrings(
      outputArtifacts
        .filter((artifact) => taskStepIndexes.has(artifact.stepIndex))
        .map((artifact) => artifact.filePath),
    );
    const outputSummaries = uniqueStrings([
      ...artifactPaths.map((filePath) => `Changed ${filePath}`),
      ...taskSteps.map((step) => step.executionResult?.diffSummary),
      ...taskSteps.map((step) => step.executionResult?.output),
    ]).slice(0, 6);
    const repoActionsGenerated = artifactPaths.some((filePath) => repoActionPaths.includes(filePath));
    const approvalNeeded = Boolean(
      repoActionsGenerated
      || (session.status === "awaiting-approval" && normalizeText(session.taskId) === taskId && session.pendingAction)
      || (session.workflowContinuity.coding.operatorConfirmationRequired && normalizeText(session.taskId) === taskId),
    );

    let status: AutonomousTaskReviewStatus = "pending";
    if (session.workflowContinuity.taskChain.currentTaskId === taskId || session.sessionLoop.currentActiveTaskId === taskId) {
      status = "active";
    } else if (session.workflowContinuity.taskChain.completedTaskIds.includes(taskId) || session.sessionLoop.completedTaskIds.includes(taskId)) {
      status = "completed";
    } else if (session.workflowContinuity.taskChain.skippedTaskIds.includes(taskId) || session.sessionLoop.skippedTaskIds.includes(taskId)) {
      status = "skipped";
    } else if (session.sessionLoop.blockedTaskIds.includes(taskId)) {
      status = session.sessionLoop.failureCount > 0 && taskSteps.some((step) => step.failureReason || step.executionResult?.status === "failed")
        ? "failed"
        : "blocked";
    } else if (session.workflowContinuity.taskChain.blockedTaskIds.includes(taskId)) {
      status = "blocked";
    }

    return {
      taskId,
      title: summarizeTaskReviewTitle(firstStep ?? { index: 0, goal: session.goal, timestamp: session.updatedAt }, taskId),
      status,
      whySelected: firstStep?.planningHintSummary || firstStep?.selectedNodeReason || "No explicit task-selection rationale was recorded.",
      outputsProduced: outputSummaries.length ? outputSummaries : ["No task outputs were recorded."],
      validationResult: summarizeTaskReviewValidation(taskSteps),
      repoActionsGenerated,
      approvalNeeded,
      transitionSummary: summarizeTaskReviewTransition(status, taskSteps),
    };
  });
}

function deriveAutonomousOperatorAttention(session: AutonomousSession, taskReviews: AutonomousTaskReviewRecord[]): AutonomousOperatorAttentionItem[] {
  const attention: AutonomousOperatorAttentionItem[] = [];

  if (session.status === "awaiting-approval" || session.sessionLoop.pauseReason === "approval-required") {
    attention.push({
      kind: "waiting-for-approval",
      summary: session.stateReason || session.sessionLoop.pauseSummary || "The bounded session is waiting for approval before it can continue.",
      recommendedOperatorAction: "Approve or reject the pending repo action so the bounded session can continue safely.",
    });
  }

  if (session.sessionLoop.pauseReason === "dependency-missing") {
    attention.push({
      kind: "blocked-by-dependency",
      summary: session.sessionLoop.pauseSummary || session.stateReason || "A required dependency is missing for the current bounded task.",
      recommendedOperatorAction: "Resolve the missing dependency or reroute the session before resuming.",
    });
  }

  if (taskReviews.some((review) => review.status === "failed" || review.status === "blocked")) {
    attention.push({
      kind: "failed-task-requires-judgment",
      summary: "At least one task stopped without a successful bounded outcome and needs operator judgment.",
      recommendedOperatorAction: "Inspect the failed or blocked task review entry before resuming or skipping.",
    });
  }

  if (["max-tasks-reached", "max-failures-reached", "max-runtime-reached", "session-limit-reached"].includes(session.sessionLoop.pauseReason ?? "")) {
    attention.push({
      kind: "session-limit-reached",
      summary: session.sessionLoop.pauseSummary || "The bounded session stopped because it reached a configured limit.",
      recommendedOperatorAction: "Review the session summary, then decide whether to resume with updated bounds or leave the session stopped.",
    });
  }

  if (
    session.status === "blocked"
    || session.status === "failed"
    || session.workflowContinuity.escalation.likelyNeedsOperatorInterventionNow
    || session.workflowContinuity.handoff.waitingOnOperatorDecision
  ) {
    attention.push({
      kind: "unsafe-manual-review",
      summary: session.stateReason || session.completedReason || session.workflowContinuity.escalation.escalationSummary || "The session requires manual review before any further bounded execution.",
      recommendedOperatorAction: "Review the operator-attention reasons and select an explicit intervention before proceeding.",
    });
  }

  return attention;
}

function deriveAutonomousOperatorControls(session: AutonomousSession): AutonomousOperatorControlGuide[] {
  const resumeAvailable = canResumeAutonomousSession(session, false);
  const approvalAvailable = session.status === "awaiting-approval" && Boolean(session.pendingAction);
  const activeOrPausable = session.status === "active" || session.status === "paused" || session.status === "awaiting-approval";

  return [
    {
      action: "pause-session",
      label: "Pause session",
      available: session.status === "active",
      description: "Stop after the current bounded step and preserve the persisted session state.",
      likelyConsequence: "AI-E will not continue into another bounded step until you explicitly resume.",
    },
    {
      action: "resume-session",
      label: "Resume session",
      available: resumeAvailable,
      description: "Continue the stored bounded session from its current persisted state.",
      likelyConsequence: approvalAvailable
        ? "Resume is still blocked until you explicitly approve the pending repo action."
        : "AI-E will continue using the current limits, task chain, and operator steering state.",
    },
    {
      action: "skip-current-task",
      label: "Skip current task",
      available: activeOrPausable,
      description: "Mark the current bounded task as skipped and move to the next runnable queued task.",
      likelyConsequence: "The current task will not be retried automatically in this session.",
    },
    {
      action: "force-stop",
      label: "Force stop",
      available: activeOrPausable,
      description: "Terminate the bounded session immediately and keep its current state for review.",
      likelyConsequence: "The session will stop and require an explicit later decision before any new run continues the work.",
    },
    {
      action: "approve-repo-action",
      label: "Approve repo action",
      available: approvalAvailable,
      description: "Allow the pending approval-gated repo action to execute inside the existing bounded session.",
      likelyConsequence: "The session can continue through the current approval gate using the persisted pending action.",
    },
    {
      action: "reject-repo-action",
      label: "Reject repo action",
      available: approvalAvailable,
      description: "Decline the pending approval-gated repo action without weakening approval rules.",
      likelyConsequence: "The pending repo action will not execute and the session will remain stopped until rerouted or resumed differently.",
    },
  ];
}

function deriveAutonomousSessionOversight(session: AutonomousSession): AutonomousSessionOversight {
  const taskReviews = deriveAutonomousTaskReviewRecords(session);
  const featureBundles = deriveAutonomousFeatureBundles(session);
  const changedPaths = uniqueStrings([
    ...session.workflowContinuity.coding.outputArtifacts.map((artifact) => artifact.filePath),
    ...session.workflowContinuity.coding.pendingRepoActions.flatMap((action) => action.artifactFilePaths),
    ...session.workflowContinuity.coding.approvedRepoActions.flatMap((action) => action.artifactFilePaths),
    ...session.workflowContinuity.coding.executedRepoActions.flatMap((action) => action.artifactFilePaths),
  ]);
  const approvalActionIds = uniqueStrings([
    ...session.workflowContinuity.coding.pendingRepoActions.map((action) => action.actionId),
    ...session.workflowContinuity.coding.approvedRepoActions.map((action) => action.actionId),
    ...session.workflowContinuity.coding.executedRepoActions.map((action) => action.actionId),
  ]);
  const attention = deriveAutonomousOperatorAttention(session, taskReviews);
  const currentTaskId = normalizeText(session.sessionLoop.currentActiveTaskId || session.workflowContinuity.taskChain.currentTaskId) || undefined;
  const currentFeatureId = normalizeText(session.workflowContinuity.taskChain.currentFeatureId)
    || normalizeText(session.steps.at(-1)?.featureId)
    || undefined;
  const currentFeature = featureBundles.find((bundle) => bundle.featureId === currentFeatureId)
    ?? featureBundles.find((bundle) => bundle.currentTaskId === currentTaskId);
  const completedFeatureIds = featureBundles
    .filter((bundle) => bundle.featureStatus === "completed")
    .map((bundle) => bundle.featureId);
  const blockedFeatureIds = featureBundles
    .filter((bundle) => bundle.featureStatus === "blocked")
    .map((bundle) => bundle.featureId);

  return {
    summary: {
      sessionId: session.sessionId,
      startTime: session.sessionLoop.sessionStartedAt,
      endTime: session.updatedAt,
      tasksAttempted: uniqueStrings([
        ...taskReviews.map((review) => review.taskId.startsWith("step-") ? undefined : review.taskId),
        currentTaskId,
      ]).length,
      tasksCompleted: session.sessionLoop.completedTaskIds.length,
      tasksBlocked: uniqueStrings([...session.sessionLoop.blockedTaskIds, ...session.workflowContinuity.taskChain.blockedTaskIds]).length,
      tasksFailed: taskReviews.filter((review) => review.status === "failed").length,
      approvalsRequested: approvalActionIds.length,
      approvalsExecuted: session.workflowContinuity.coding.executedRepoActions.length,
      currentPauseReason: session.sessionLoop.pauseReason || session.stateReason || "No pause reason is currently recorded.",
      recommendedNextStep:
        session.workflowContinuity.loopHealth.recommendedNextActionSummary
        || session.workflowContinuity.progress.nextIntendedStep
        || session.sessionLoop.nextRecommendedTaskId
        || "No recommended next step is currently recorded.",
      currentFeatureId: currentFeature?.featureId,
      currentFeatureTitle: currentFeature?.featureTitle,
      currentFeatureProgress: currentFeature ? buildAutonomousFeatureProgressLabel(currentFeature) : undefined,
      completedFeatures: completedFeatureIds.length,
      blockedFeatures: blockedFeatureIds.length,
      keyFilesOrAssetsChanged: changedPaths,
      validationSummary:
        session.workflowContinuity.coding.lastValidationResultSummary
        || session.workflowContinuity.coding.lastValidationSummary
        || session.latestCompletion?.reason
        || "No validation summary is currently recorded.",
      safeToResume: canResumeAutonomousSession(session, false),
    },
    operatorAttention: attention,
    controls: deriveAutonomousOperatorControls(session),
    taskReviews,
    currentTaskId,
    currentFeatureId: currentFeature?.featureId,
    currentFeatureTitle: currentFeature?.featureTitle,
    featureBundles,
    recentCompletedTaskIds: session.sessionLoop.completedTaskIds.slice(-5).reverse(),
    blockedTaskIds: uniqueStrings([...session.sessionLoop.blockedTaskIds, ...session.workflowContinuity.taskChain.blockedTaskIds]),
    completedFeatureIds,
    blockedFeatureIds,
    pendingApprovalActionIds: session.workflowContinuity.coding.pendingRepoActions.map((action) => action.actionId),
  };
}

function refreshAutonomousSessionDerivedState(session: AutonomousSession): AutonomousSession {
  const withContinuity: AutonomousSession = {
    ...session,
    workflowContinuity: deriveAutonomousWorkflowContinuity(session),
    oversight: session.oversight,
  };

  return {
    ...withContinuity,
    oversight: deriveAutonomousSessionOversight(withContinuity),
  };
}

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

function clampAutonomousMaxTasksPerSession(value: unknown): number {
  if (value === undefined || value === null || String(value).trim() === "") {
    return 5;
  }

  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return 5;
  }

  return Math.max(1, Math.min(10, Math.floor(numericValue)));
}

function clampAutonomousMaxFailuresPerSession(value: unknown): number {
  if (value === undefined || value === null || String(value).trim() === "") {
    return 2;
  }

  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return 2;
  }

  return Math.max(1, Math.min(3, Math.floor(numericValue)));
}

function clampAutonomousMaxRuntimeMs(value: unknown): number | undefined {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }

  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return undefined;
  }

  return Math.max(1_000, Math.min(8 * 60 * 60 * 1_000, Math.floor(numericValue)));
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

function createDefaultAutonomousWorkflowRecommendationEscalationState(): AutonomousWorkflowRecommendationEscalationState {
  return {
    escalationStatus: "none",
    recoveryRecommendation: "none",
    likelyNeedsOperatorInterventionNow: false,
    repeatedIneffectiveReviewCycles: false,
    acceptedRecommendationsRepeatedlyRequiringCorrection: false,
    redirectedRecommendationsOutperformSystem: false,
    returnedToSameIneffectiveState: false,
  };
}

function createDefaultAutonomousWorkflowRecommendationHandoffState(): AutonomousWorkflowRecommendationHandoffState {
  return {
    history: [],
    handoffStatus: "none",
    waitingOnOperatorDecision: false,
    recoveryExecutionInProgress: false,
    recoveryExecutionCompleted: false,
    recoveryImprovedProgress: false,
    secondEscalationNeeded: false,
  };
}

function createDefaultAutonomousWorkflowCodingState(): AutonomousWorkflowCodingState {
  return {
    sessionMode: "general",
    codingLoopPhase: "none",
    currentTargetStatus: "none",
    validationTargetMatchesDeliverable: false,
    correctionMaintainsDeliverable: false,
    deliverableChangedDuringCorrectionOrEscalation: false,
    deliverableAccepted: false,
    acceptanceConfidence: "low",
    completionState: "in-progress",
    operatorConfirmationRequired: false,
    shouldTerminateLoop: false,
    outputArtifacts: [],
    outputLinkedToDeliverable: false,
    pendingRepoActions: [],
    approvedRepoActions: [],
    executedRepoActions: [],
    approvalStateSummary: undefined,
    integritySummary: undefined,
    lastValidationPassed: false,
    validationFirstActive: false,
    repeatedValidationFailureDrivingEscalation: false,
    escalationActive: false,
    supervisedRecoveryActive: false,
  };
}

function createDefaultAutonomousWorkflowTaskChainState(): AutonomousWorkflowTaskChainState {
  return {
    generatedTaskQueue: [],
    currentTaskId: undefined,
    currentFeatureId: undefined,
    completedTaskIds: [],
    blockedTaskIds: [],
    skippedTaskIds: [],
    nextRecommendedTaskId: undefined,
    nextRecommendedFeatureId: undefined,
    chainStatus: "idle",
  };
}

function createDefaultAutonomousSessionLoopState(params?: {
  sessionStartedAt?: string;
  lastUpdatedAt?: string;
  maxTasksPerSession?: unknown;
  maxFailuresPerSession?: unknown;
  maxRuntimeMs?: unknown;
}): AutonomousSessionLoopState {
  const timestamp = normalizeText(params?.sessionStartedAt) || createTimestamp();

  return {
    sessionStartedAt: timestamp,
    lastUpdatedAt: normalizeText(params?.lastUpdatedAt) || timestamp,
    maxTasksPerSession: clampAutonomousMaxTasksPerSession(params?.maxTasksPerSession),
    maxFailuresPerSession: clampAutonomousMaxFailuresPerSession(params?.maxFailuresPerSession),
    maxRuntimeMs: clampAutonomousMaxRuntimeMs(params?.maxRuntimeMs),
    completedTaskIds: [],
    skippedTaskIds: [],
    blockedTaskIds: [],
    failureCount: 0,
    currentActiveTaskId: undefined,
    lastCompletedTaskId: undefined,
    nextRecommendedTaskId: undefined,
    pauseReason: undefined,
    pauseSummary: undefined,
  };
}

function normalizeUniqueTaskIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    const taskId = normalizeText(typeof item === "string" ? item : "");
    if (!taskId || seen.has(taskId)) {
      continue;
    }

    seen.add(taskId);
    normalized.push(taskId);
  }

  return normalized;
}

function normalizeAutonomousWorkflowTaskChainStatus(value: unknown): AutonomousWorkflowTaskChainStatus | undefined {
  return value === "idle"
    || value === "selecting-next-task"
    || value === "executing-task"
    || value === "validating-task"
    || value === "awaiting-approval"
    || value === "blocked"
    || value === "completed"
    ? value
    : undefined;
}

function normalizeAutonomousSessionPauseReason(value: unknown): AutonomousSessionPauseReason | undefined {
  return value === "approval-required"
    || value === "critical-task-failure"
    || value === "dependency-missing"
    || value === "all-tasks-blocked"
    || value === "all-tasks-complete"
    || value === "max-tasks-reached"
    || value === "max-failures-reached"
    || value === "max-runtime-reached"
    || value === "operator-paused"
    || value === "operator-stopped"
    || value === "session-limit-reached"
    ? value
    : undefined;
}

function normalizeAutonomousSessionLoopState(value: unknown): AutonomousSessionLoopState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const sessionStartedAt = normalizeText(typeof source.sessionStartedAt === "string" ? source.sessionStartedAt : "");
  if (!sessionStartedAt) {
    return undefined;
  }

  return {
    sessionStartedAt,
    lastUpdatedAt: normalizeText(typeof source.lastUpdatedAt === "string" ? source.lastUpdatedAt : "") || sessionStartedAt,
    maxTasksPerSession: clampAutonomousMaxTasksPerSession(source.maxTasksPerSession),
    maxFailuresPerSession: clampAutonomousMaxFailuresPerSession(source.maxFailuresPerSession),
    maxRuntimeMs: clampAutonomousMaxRuntimeMs(source.maxRuntimeMs),
    completedTaskIds: normalizeUniqueTaskIdList(source.completedTaskIds),
    skippedTaskIds: normalizeUniqueTaskIdList(source.skippedTaskIds),
    blockedTaskIds: normalizeUniqueTaskIdList(source.blockedTaskIds),
    failureCount: Number.isInteger(Number(source.failureCount)) ? Math.max(0, Math.floor(Number(source.failureCount))) : 0,
    currentActiveTaskId: normalizeText(typeof source.currentActiveTaskId === "string" ? source.currentActiveTaskId : "") || undefined,
    lastCompletedTaskId: normalizeText(typeof source.lastCompletedTaskId === "string" ? source.lastCompletedTaskId : "") || undefined,
    nextRecommendedTaskId: normalizeText(typeof source.nextRecommendedTaskId === "string" ? source.nextRecommendedTaskId : "") || undefined,
    pauseReason: normalizeAutonomousSessionPauseReason(source.pauseReason),
    pauseSummary: normalizeText(typeof source.pauseSummary === "string" ? source.pauseSummary : "") || undefined,
  };
}

function normalizeAutonomousGeneratedTaskQueueEntry(value: unknown): AutonomousGeneratedTaskQueueEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const taskId = normalizeText(typeof source.taskId === "string" ? source.taskId : "");
  const status = source.status;
  if (!taskId) {
    return null;
  }

  if (
    status !== "pending"
    && status !== "assigned"
    && status !== "running"
    && status !== "blocked"
    && status !== "queued"
    && status !== "dispatching"
    && status !== "awaiting-ack"
    && status !== "executing"
    && status !== "completed"
    && status !== "failed"
    && status !== "retrying"
    && status !== "rejected"
    && status !== "skipped"
  ) {
    return null;
  }

  return {
    taskId,
    priority: Number.isFinite(Number(source.priority)) ? Math.max(0, Math.floor(Number(source.priority))) : 0,
    dependsOnTaskIds: normalizeUniqueTaskIdList(source.dependsOnTaskIds),
    featureId: normalizeText(typeof source.featureId === "string" ? source.featureId : "") || undefined,
    featureTitle: normalizeText(typeof source.featureTitle === "string" ? source.featureTitle : "") || undefined,
    featureDescription: normalizeText(typeof source.featureDescription === "string" ? source.featureDescription : "") || undefined,
    status,
  };
}

function deriveAutonomousWorkflowTaskChainState(session: AutonomousSession): AutonomousWorkflowTaskChainState {
  const previous = session.workflowContinuity?.taskChain ?? createDefaultAutonomousWorkflowTaskChainState();
  const currentTaskId = session.status === "active" || session.status === "awaiting-approval"
    ? normalizeText(session.taskId) || previous.currentTaskId
    : undefined;
  const nextRecommendedTaskId = normalizeText(previous.nextRecommendedTaskId) || undefined;
  const generatedTaskQueue = Array.isArray(previous.generatedTaskQueue) ? previous.generatedTaskQueue : [];
  const completedTaskIds = normalizeUniqueTaskIdList(previous.completedTaskIds);
  const blockedTaskIds = normalizeUniqueTaskIdList(previous.blockedTaskIds);
  const skippedTaskIds = normalizeUniqueTaskIdList(previous.skippedTaskIds);
  const currentFeatureId = generatedTaskQueue.find((entry) => entry.taskId === currentTaskId)?.featureId
    ?? (normalizeText(previous.currentFeatureId) || undefined);
  const chainStatus = session.status === "awaiting-approval"
    ? "awaiting-approval"
    : session.status === "blocked" || session.status === "failed"
      ? "blocked"
      : currentTaskId && (
        session.taskStatus === "assigned"
        || session.taskStatus === "running"
        || session.taskStatus === "dispatching"
        || session.taskStatus === "awaiting-ack"
        || session.taskStatus === "executing"
        || session.taskStatus === "queued"
        || session.taskStatus === "retrying"
      )
        ? "executing-task"
        : currentTaskId && session.taskStatus === "completed"
          ? "validating-task"
          : nextRecommendedTaskId
            ? "selecting-next-task"
            : generatedTaskQueue.length > 0
              && generatedTaskQueue.every((entry) => completedTaskIds.includes(entry.taskId) || blockedTaskIds.includes(entry.taskId) || skippedTaskIds.includes(entry.taskId))
              ? "completed"
              : "idle";
  const nextRecommendedFeatureId = generatedTaskQueue.find((entry) => entry.taskId === nextRecommendedTaskId)?.featureId
    ?? (normalizeText(previous.nextRecommendedFeatureId) || undefined);

  return {
    generatedTaskQueue,
    currentTaskId,
    currentFeatureId,
    completedTaskIds,
    blockedTaskIds,
    skippedTaskIds,
    nextRecommendedTaskId,
      nextRecommendedFeatureId,
    chainStatus,
  };
}

function normalizeAutonomousSessionMode(value: unknown): AutonomousSessionMode | undefined {
  return value === "general" || value === "repo-coding" ? value : undefined;
}

function normalizeAutonomousOperatorSteeringAction(value: unknown): AutonomousOperatorSteeringAction | undefined {
  const normalized = normalizeText(typeof value === "string" ? value : "");
  if (
    normalized === "accept-current-recommendation"
    || normalized === "confirm-deliverable-acceptance"
    || normalized === "reject-deliverable-acceptance"
    || normalized === "prefer-validation-next"
    || normalized === "prefer-fix-next"
    || normalized === "restart-from-last-safe-boundary"
    || normalized === "skip-current-task"
    || normalized === "pause-and-wait"
    || normalized === "stop-loop"
    || normalized === "force-stop"
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

function normalizeAutonomousWorkflowRecommendationEscalationStatus(
  value: unknown,
): AutonomousWorkflowRecommendationEscalationStatus | undefined {
  return value === "none"
    || value === "monitor"
    || value === "alternate-path-recommended"
    || value === "operator-intervention-recommended"
    || value === "restart-recommended"
    || value === "stop-recommended"
    ? value
    : undefined;
}

function normalizeAutonomousWorkflowRecommendationRecoveryRecommendation(
  value: unknown,
): AutonomousWorkflowRecommendationRecoveryRecommendation | undefined {
  return value === "none"
    || value === "operator-intervention"
    || value === "restart-from-last-safe-boundary"
    || value === "validation-first"
    || value === "fix-first"
    || value === "stop-loop"
    ? value
    : undefined;
}

function normalizeAutonomousWorkflowRecommendationHandoffStatus(
  value: unknown,
): AutonomousWorkflowRecommendationHandoffStatus | undefined {
  return value === "none"
    || value === "waiting-on-operator-decision"
    || value === "escalation-acknowledged"
    || value === "recovery-selected"
    || value === "recovery-executing"
    || value === "recovery-completed"
    || value === "second-escalation-needed"
    ? value
    : undefined;
}

function normalizeAutonomousWorkflowRecommendationHandoffRecoveryMode(
  value: unknown,
): AutonomousWorkflowRecommendationHandoffRecoveryMode | undefined {
  return value === "none"
    || value === "operator-intervention"
    || value === "restart-from-last-safe-boundary"
    || value === "validation-first"
    || value === "fix-first"
    || value === "stop-loop"
    || value === "current-recommendation"
    ? value as AutonomousWorkflowRecommendationHandoffRecoveryMode
    : undefined;
}

function normalizeAutonomousWorkflowCodingLoopPhase(
  value: unknown,
): AutonomousWorkflowCodingLoopPhase | undefined {
  if (value === "validation") {
    return "validation-pending";
  }

  if (value === "correction") {
    return "correction-pending";
  }

  return value === "none"
    || value === "implementation"
    || value === "validation-pending"
    || value === "validation-failed"
    || value === "correction-pending"
    || value === "validation-recovered"
    || value === "review"
    || value === "escalation"
    || value === "supervised-recovery"
    ? value
    : undefined;
}

function deriveRequestedNextPhaseOverride(
  action: AutonomousOperatorSteeringAction | undefined,
): AutonomousWorkflowRecommendedNextPhase | undefined {
  if (action === "accept-current-recommendation") {
    return undefined;
  }

  if (action === "confirm-deliverable-acceptance") {
    return "stop";
  }

  if (action === "reject-deliverable-acceptance") {
    return "fix";
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

  if (action === "skip-current-task") {
    return undefined;
  }

  if (action === "pause-and-wait") {
    return "waiting-on-operator";
  }

  if (action === "stop-loop" || action === "force-stop") {
    return "stop";
  }

  return undefined;
}

function normalizeAutonomousWorkflowCodingTargetStatus(
  value: unknown,
): AutonomousWorkflowCodingTargetStatus | undefined {
  return value === "none"
    || value === "implementation-in-progress"
    || value === "awaiting-validation"
    || value === "validation-failed"
    || value === "under-correction"
    || value === "accepted"
    || value === "under-review"
    || value === "escalated"
    || value === "supervised-recovery"
    ? value
    : undefined;
}

function normalizeAutonomousWorkflowCodingCompletionState(
  value: unknown,
): AutonomousWorkflowCodingCompletionState | undefined {
  return value === "in-progress"
    || value === "ready-for-acceptance"
    || value === "accepted"
    || value === "rejected"
    ? value
    : undefined;
}

function normalizeAutonomousWorkflowCodingOutputArtifact(
  value: unknown,
): AutonomousWorkflowCodingOutputArtifact | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const stepIndex = Number(source.stepIndex ?? 0);
  const filePath = normalizeText(typeof source.filePath === "string" ? source.filePath : "");
  if (!Number.isInteger(stepIndex) || stepIndex <= 0 || !filePath) {
    return null;
  }

  return {
    stepIndex,
    filePath,
    changeSummary:
      normalizeText(typeof source.changeSummary === "string" ? source.changeSummary : "") || undefined,
    diffLikeSummary:
      normalizeText(typeof source.diffLikeSummary === "string" ? source.diffLikeSummary : "") || undefined,
    linkedToDeliverable:
      typeof source.linkedToDeliverable === "boolean" ? source.linkedToDeliverable : false,
  };
}

function clampCodingOutputArtifacts(
  artifacts: AutonomousWorkflowCodingOutputArtifact[],
): AutonomousWorkflowCodingOutputArtifact[] {
  return artifacts.slice(-8);
}

function normalizeAutonomousWorkflowRepoActionApprovalStatus(
  value: unknown,
): AutonomousWorkflowRepoActionApprovalStatus | undefined {
  return value === "pending" || value === "approved" || value === "executed" ? value : undefined;
}

function normalizeAutonomousWorkflowRepoActionExecutionStatus(
  value: unknown,
): AutonomousWorkflowRepoActionExecutionStatus | undefined {
  return value === "awaiting-approval"
    || value === "approved-awaiting-execution"
    || value === "executed"
    || value === "failed"
    ? value
    : undefined;
}

function normalizeAutonomousWorkflowRepoAction(value: unknown): AutonomousWorkflowRepoAction | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const actionId = normalizeText(typeof source.actionId === "string" ? source.actionId : "");
  const artifactStepIndex = Number(source.artifactStepIndex ?? 0);
  const artifactFilePaths = Array.isArray(source.artifactFilePaths)
    ? source.artifactFilePaths
        .map((item) => normalizeText(typeof item === "string" ? item : String(item ?? "")))
        .filter(Boolean)
    : [];
  const artifactReference = normalizeText(typeof source.artifactReference === "string" ? source.artifactReference : "");
  const approvalStatus = normalizeAutonomousWorkflowRepoActionApprovalStatus(source.approvalStatus);
  const executionStatus = normalizeAutonomousWorkflowRepoActionExecutionStatus(source.executionStatus);

  if (!actionId || !Number.isInteger(artifactStepIndex) || artifactStepIndex <= 0 || artifactFilePaths.length === 0 || !artifactReference || !approvalStatus || !executionStatus) {
    return null;
  }

  return {
    actionId,
    artifactStepIndex,
    artifactFilePaths,
    changeSummary: normalizeText(typeof source.changeSummary === "string" ? source.changeSummary : "") || undefined,
    artifactReference,
    approvalStatus,
    executionStatus,
    executed: typeof source.executed === "boolean" ? source.executed : executionStatus === "executed",
    failureReason: normalizeText(typeof source.failureReason === "string" ? source.failureReason : "") || undefined,
    executionPreview: normalizeExecutionActionPreview(source.executionPreview),
  };
}

function clampAutonomousWorkflowRepoActions(actions: AutonomousWorkflowRepoAction[]): AutonomousWorkflowRepoAction[] {
  return actions.slice(-8);
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

function clampRecommendationHandoffHistoryEntries(
  entries: AutonomousWorkflowRecommendationHandoffHistoryEntry[],
): AutonomousWorkflowRecommendationHandoffHistoryEntry[] {
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

function normalizeAutonomousWorkflowRecommendationHandoffHistoryEntry(value: unknown): AutonomousWorkflowRecommendationHandoffHistoryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const initiatedAtStepIndex = Number(source.initiatedAtStepIndex ?? 0);
  const escalationStatus = normalizeAutonomousWorkflowRecommendationEscalationStatus(source.escalationStatus);
  const recoveryRecommendation = normalizeAutonomousWorkflowRecommendationRecoveryRecommendation(source.recoveryRecommendation);
  if (!Number.isInteger(initiatedAtStepIndex) || initiatedAtStepIndex <= 0 || !escalationStatus || !recoveryRecommendation) {
    return null;
  }

  return {
    initiatedAtStepIndex,
    escalationStatus,
    recoveryRecommendation,
    operatorAcknowledged: typeof source.operatorAcknowledged === "boolean" ? source.operatorAcknowledged : false,
    selectedRecoveryAction: normalizeAutonomousOperatorSteeringAction(source.selectedRecoveryAction),
    selectedRecoveryMode: normalizeAutonomousWorkflowRecommendationHandoffRecoveryMode(source.selectedRecoveryMode),
    operatorNote: normalizeText(typeof source.operatorNote === "string" ? source.operatorNote : "") || undefined,
    overrideReason: normalizeText(typeof source.overrideReason === "string" ? source.overrideReason : "") || undefined,
  };
}

function deriveRecommendationHandoffRecoveryMode(
  action: AutonomousOperatorSteeringAction | undefined,
  recoveryRecommendation: AutonomousWorkflowRecommendationRecoveryRecommendation,
): AutonomousWorkflowRecommendationHandoffRecoveryMode | undefined {
  if (action === "accept-current-recommendation") {
    return "current-recommendation";
  }

  if (action === "confirm-deliverable-acceptance") {
    return "current-recommendation";
  }

  if (action === "reject-deliverable-acceptance") {
    return "fix-first";
  }

  if (action === "prefer-validation-next") {
    return "validation-first";
  }

  if (action === "prefer-fix-next") {
    return "fix-first";
  }

  if (action === "restart-from-last-safe-boundary") {
    return "restart-from-last-safe-boundary";
  }

  if (action === "pause-and-wait") {
    return "operator-intervention";
  }

  if (action === "stop-loop" || action === "force-stop") {
    return "stop-loop";
  }

  return recoveryRecommendation !== "none" ? recoveryRecommendation : undefined;
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

function isExplicitValidationStep(step: AutonomousStepRecord): boolean {
  if (!summarizeValidationOutcome(step)) {
    return false;
  }

  return !Boolean(summarizeFixAttempt(step));
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

function doesOutputArtifactLinkToDeliverable(params: {
  filePath: string;
  targetScope?: string;
  currentDeliverableTarget?: string;
}): boolean {
  const normalizedPath = normalizeText(params.filePath).replace(/\\/g, "/").toLowerCase();
  if (!normalizedPath) {
    return false;
  }

  const scopeTokens = normalizeText(params.targetScope)
    .split(",")
    .map((token) => normalizeText(token).replace(/\\/g, "/").toLowerCase())
    .filter(Boolean);
  if (scopeTokens.some((token) => token === normalizedPath || normalizedPath.includes(token) || token.includes(normalizedPath))) {
    return true;
  }

  const deliverable = normalizeText(params.currentDeliverableTarget).replace(/\\/g, "/").toLowerCase();
  return Boolean(deliverable) && (deliverable.includes(normalizedPath) || normalizedPath.includes(deliverable));
}

function summarizeOutputIterationDelta(step: AutonomousStepRecord, previousStep: AutonomousStepRecord | undefined): string | undefined {
  if (!previousStep) {
    return "First recorded output iteration.";
  }

  const currentPaths = Array.isArray(step.executionResult?.changedPaths)
    ? clampWorkflowMemoryItems(step.executionResult.changedPaths)
    : [];
  const previousPaths = Array.isArray(previousStep.executionResult?.changedPaths)
    ? clampWorkflowMemoryItems(previousStep.executionResult.changedPaths)
    : [];
  const currentDiff = normalizeText(step.executionResult?.diffSummary);
  const previousDiff = normalizeText(previousStep.executionResult?.diffSummary);

  if (currentDiff && previousDiff && currentDiff !== previousDiff) {
    return `Changed from prior output iteration: ${currentDiff}`;
  }

  if (currentPaths.join(", ") !== previousPaths.join(", ") && currentPaths.length > 0) {
    return `Affected files changed from prior iteration: ${currentPaths.join(", ")}`;
  }

  if (currentDiff) {
    return `Repeated output iteration with updated summary: ${currentDiff}`;
  }

  return "Repeated output iteration without a new diff summary.";
}

function isRepoActionExecutionStep(step: AutonomousStepRecord | undefined): boolean {
  return Boolean(normalizeText(step?.executedActionPreview?.metadata?.context).includes("repo-action="));
}

function deriveCodingOutputArtifacts(params: {
  session: AutonomousSession;
  targetScope?: string;
  currentDeliverableTarget?: string;
}): AutonomousWorkflowCodingOutputArtifact[] {
  const outputSteps = params.session.steps.filter((step) => Boolean(summarizeFixAttempt(step)) && !isRepoActionExecutionStep(step));
  return clampCodingOutputArtifacts(outputSteps.flatMap((step, index) => {
    const changedPaths = Array.isArray(step.executionResult?.changedPaths)
      ? clampWorkflowMemoryItems(step.executionResult.changedPaths)
      : [];
    const scopedFallback = summarizeCodingScope(changedPaths, undefined, undefined);
    const filePaths = changedPaths.length > 0 ? changedPaths : (scopedFallback ? [scopedFallback] : []);
    if (!filePaths.length) {
      return [];
    }

    const iterationDelta = summarizeOutputIterationDelta(step, outputSteps[index - 1]);
    return filePaths.map((filePath) => ({
      stepIndex: step.index,
      filePath,
      changeSummary:
        normalizeText([
          normalizeText(step.proposedAction),
          iterationDelta,
        ].filter(Boolean).join(" | ")) || undefined,
      diffLikeSummary: normalizeText(step.executionResult?.diffSummary) || undefined,
      linkedToDeliverable: doesOutputArtifactLinkToDeliverable({
        filePath,
        targetScope: params.targetScope,
        currentDeliverableTarget: params.currentDeliverableTarget,
      }),
    }));
  }));
}

function summarizeLatestCodingOutput(params: {
  session: AutonomousSession;
  outputArtifacts: AutonomousWorkflowCodingOutputArtifact[];
}): string | undefined {
  const lastOutputStep = [...params.session.steps].reverse().find((step) => Boolean(summarizeFixAttempt(step)));
  if (!lastOutputStep) {
    return undefined;
  }

  const artifactsForStep = params.outputArtifacts.filter((artifact) => artifact.stepIndex === lastOutputStep.index);
  return normalizeText([
    `step ${lastOutputStep.index}`,
    artifactsForStep.length > 0 ? `files=${artifactsForStep.map((artifact) => artifact.filePath).join(", ")}` : "",
    artifactsForStep[0]?.changeSummary ? `change=${artifactsForStep[0].changeSummary}` : "",
    normalizeText(lastOutputStep.executionResult?.diffSummary) ? `diff=${normalizeText(lastOutputStep.executionResult?.diffSummary)}` : "",
  ].filter(Boolean).join(" | ")) || undefined;
}

function sanitizeRepoActionToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "artifact";
}

function buildRepoActionId(stepIndex: number, artifactFilePaths: string[]): string {
  return `repo-action-step-${stepIndex}-${sanitizeRepoActionToken(artifactFilePaths.join("-"))}`;
}

function buildRepoActionExecutionPreview(params: {
  actionId: string;
  sourceStep: AutonomousStepRecord | undefined;
  artifactFilePaths: string[];
  changeSummary?: string;
}): ExecutionActionPreview | undefined {
  const sourceAction = params.sourceStep?.executedActionPreview;
  const sourceActionType = sourceAction?.type ?? sourceAction?.metadata?.sourceActionType;
  const targetPath = normalizeText(sourceAction?.metadata?.targetPath);
  const allowedRoot = normalizeText(sourceAction?.metadata?.allowedRoot);

  if ((sourceActionType !== "file-write" && sourceActionType !== "write") || !targetPath || !allowedRoot || typeof sourceAction?.metadata?.content !== "string") {
    return undefined;
  }

  return {
    id: params.actionId,
    type: "file-write",
    scope: "caution",
    description: `Apply the approved repo action for ${params.artifactFilePaths.join(", ")}.`,
    expectedOutcome: params.changeSummary || `The accepted repo output should be applied to ${params.artifactFilePaths.join(", ")}.`,
    requiresApproval: true,
    suggestedCommand: sourceAction?.suggestedCommand,
    metadata: {
      ...sourceAction.metadata,
      sourceActionType: "file-write",
      context: normalizeText([
        sourceAction.metadata.context,
        `repo-action=${params.actionId}`,
        params.sourceStep ? `artifact-step=${params.sourceStep.index}` : "",
      ].filter(Boolean).join(" | ")) || undefined,
      targetPath,
      allowedRoot,
      content: sourceAction.metadata.content,
    },
  };
}

function summarizeRepoActionState(actions: AutonomousWorkflowRepoAction[]): string | undefined {
  if (actions.length === 0) {
    return undefined;
  }

  const pendingCount = actions.filter((action) => action.approvalStatus === "pending").length;
  const approvedCount = actions.filter((action) => action.approvalStatus === "approved").length;
  const executedCount = actions.filter((action) => action.approvalStatus === "executed").length;
  const failedCount = actions.filter((action) => action.executionStatus === "failed").length;
  return `pending=${pendingCount} | approved=${approvedCount} | executed=${executedCount}${failedCount > 0 ? ` | failed=${failedCount}` : ""}`;
}

function summarizeRepoApprovalState(params: {
  session: AutonomousSession;
  pendingRepoActions: AutonomousWorkflowRepoAction[];
  approvedRepoActions: AutonomousWorkflowRepoAction[];
  executedRepoActions: AutonomousWorkflowRepoAction[];
}): string | undefined {
  const pendingApprovalAction = params.session.pendingAction;
  if (params.session.status === "awaiting-approval" && pendingApprovalAction) {
    return `awaiting-explicit-approval${pendingApprovalAction.id ? ` | action=${pendingApprovalAction.id}` : ""}`;
  }

  if (params.pendingRepoActions.length > 0) {
    return `approval-required | pending=${params.pendingRepoActions.length}`;
  }

  const failedApprovedActions = params.approvedRepoActions.filter((action) => action.executionStatus === "failed");
  if (failedApprovedActions.length > 0) {
    return `approved-execution-failed | failed=${failedApprovedActions.length}`;
  }

  if (params.approvedRepoActions.length > 0) {
    return `approved-awaiting-execution | approved=${params.approvedRepoActions.length}`;
  }

  if (params.executedRepoActions.length > 0) {
    return `repo-actions-executed | executed=${params.executedRepoActions.length}`;
  }

  return undefined;
}

function deriveCodingStateIntegrityIssues(params: {
  session: AutonomousSession;
  outputArtifacts: AutonomousWorkflowCodingOutputArtifact[];
  repoActions: AutonomousWorkflowRepoAction[];
  pendingRepoActions: AutonomousWorkflowRepoAction[];
  approvedRepoActions: AutonomousWorkflowRepoAction[];
  deliverableAccepted: boolean;
  completionState: AutonomousWorkflowCodingCompletionState;
  shouldTerminateLoop: boolean;
}): string[] {
  const issues: string[] = [];

  if (params.session.status === "awaiting-approval" && !params.session.pendingAction) {
    issues.push("The session is awaiting approval without a stored pending action.");
  }

  if (
    params.session.status === "awaiting-approval"
    && params.session.pendingAction
    && params.session.pendingAction.requiresApproval !== true
  ) {
    issues.push("The session is awaiting approval for an action that is not explicitly approval-gated.");
  }

  const pendingActionId = normalizeText(params.session.pendingAction?.id);
  const pendingActionContext = normalizeText(params.session.pendingAction?.metadata?.context);
  const pendingActionLooksLikeRepoAction = Boolean(
    pendingActionId && pendingActionId.startsWith("repo-action-step-"),
  ) || pendingActionContext.includes("repo-action=");
  if (
    pendingActionLooksLikeRepoAction
    && pendingActionId
    && !params.repoActions.some((action) => action.actionId === pendingActionId)
  ) {
    issues.push("The stored approval gate no longer matches any derived repo action.");
  }

  if (params.completionState === "accepted" && !params.deliverableAccepted) {
    issues.push("Accepted completion state requires a validated deliverable.");
  }

  if (params.shouldTerminateLoop && (params.pendingRepoActions.length > 0 || params.approvedRepoActions.length > 0)) {
    issues.push("Loop closure is blocked until every derived repo action is fully executed.");
  }

  return issues;
}

function deriveAutonomousWorkflowRepoActions(params: {
  session: AutonomousSession;
  outputArtifacts: AutonomousWorkflowCodingOutputArtifact[];
  deliverableAccepted: boolean;
}): AutonomousWorkflowRepoAction[] {
  if (!params.deliverableAccepted) {
    return [];
  }

  const linkedArtifacts = params.outputArtifacts.filter((artifact) => artifact.linkedToDeliverable);
  const actionMap = new Map<number, AutonomousWorkflowCodingOutputArtifact[]>();
  for (const artifact of linkedArtifacts) {
    const existing = actionMap.get(artifact.stepIndex) ?? [];
    existing.push(artifact);
    actionMap.set(artifact.stepIndex, existing);
  }

  return clampAutonomousWorkflowRepoActions(Array.from(actionMap.entries()).map(([stepIndex, artifacts]) => {
    const sourceStep = params.session.steps.find((step) => step.index === stepIndex);
    const artifactFilePaths = Array.from(new Set(artifacts.map((artifact) => artifact.filePath).filter(Boolean)));
    const actionId = buildRepoActionId(stepIndex, artifactFilePaths);
    const latestAttempt = [...params.session.steps].reverse().find((step) => step.executedActionPreview?.id === actionId);
    const executionPreview = buildRepoActionExecutionPreview({
      actionId,
      sourceStep,
      artifactFilePaths,
      changeSummary: artifacts[0]?.changeSummary,
    });
    const pendingApproval = params.session.pendingAction?.id === actionId;
    const executed = latestAttempt?.executionResult?.status === "success";
    const attempted = Boolean(latestAttempt);
    const failed = latestAttempt?.executionResult?.status === "failed" || latestAttempt?.executionResult?.status === "blocked";

    return executionPreview ? {
      actionId,
      artifactStepIndex: stepIndex,
      artifactFilePaths,
      changeSummary: artifacts[0]?.changeSummary,
      artifactReference: artifacts.map((artifact) => `${artifact.stepIndex}:${artifact.filePath}`).join(", "),
      approvalStatus: executed ? "executed" : attempted ? "approved" : "pending",
      executionStatus: pendingApproval
        ? "awaiting-approval"
        : executed
          ? "executed"
          : failed
            ? "failed"
            : attempted
              ? "approved-awaiting-execution"
              : "awaiting-approval",
      executed,
      failureReason: normalizeText(
        latestAttempt?.failureReason
          || latestAttempt?.executionResult?.error
          || latestAttempt?.executionResult?.output,
      ) || undefined,
      executionPreview,
    } : null;
  }).filter((action): action is AutonomousWorkflowRepoAction => Boolean(action)));
}

function summarizeCodingScope(paths: string[] | undefined, fallbackTargetPath?: string, fallbackAllowedRoot?: string): string | undefined {
  const normalizedPaths = Array.isArray(paths) ? clampWorkflowMemoryItems(paths) : [];
  if (normalizedPaths.length > 0) {
    return normalizedPaths.join(", ");
  }

  return normalizeText(fallbackTargetPath) || normalizeText(fallbackAllowedRoot) || undefined;
}

function deriveRepoCodingTargetStatus(codingLoopPhase: AutonomousWorkflowCodingLoopPhase): AutonomousWorkflowCodingTargetStatus {
  switch (codingLoopPhase) {
    case "implementation":
      return "implementation-in-progress";
    case "validation-pending":
      return "awaiting-validation";
    case "validation-failed":
      return "validation-failed";
    case "correction-pending":
      return "under-correction";
    case "validation-recovered":
      return "accepted";
    case "review":
      return "under-review";
    case "escalation":
      return "escalated";
    case "supervised-recovery":
      return "supervised-recovery";
    default:
      return "none";
  }
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

function summarizeRecentOperatorAcceptanceDecision(params: {
  review: AutonomousWorkflowRecommendationReviewState;
  steeringAction: AutonomousOperatorSteeringAction | undefined;
  operatorNote?: string;
  overrideReason?: string;
}): {
  confirmed: boolean;
  rejected: boolean;
  reason?: string;
} {
  const latestReview = [...params.review.history].reverse().find((entry) => {
    return entry.operatorResponse === "confirm-deliverable-acceptance"
      || entry.operatorResponse === "reject-deliverable-acceptance";
  });
  const latestAction = params.steeringAction ?? latestReview?.operatorResponse;
  const reason = normalizeText(
    params.operatorNote
      || params.overrideReason
      || latestReview?.operatorNote
      || latestReview?.overrideReason,
  ) || undefined;

  return {
    confirmed: latestAction === "confirm-deliverable-acceptance",
    rejected: latestAction === "reject-deliverable-acceptance",
    reason,
  };
}

function deriveRepoCodingLoopPhase(params: {
  session: AutonomousSession;
  chainPhase: AutonomousWorkflowChainPhase;
  review: AutonomousWorkflowRecommendationReviewState;
  escalation: AutonomousWorkflowRecommendationEscalationState;
  handoff: AutonomousWorkflowRecommendationHandoffState;
  lastImplementationStep?: AutonomousStepRecord;
  lastValidationStep?: AutonomousStepRecord;
  lastCorrectionStep?: AutonomousStepRecord;
  currentValidationTarget?: string;
  repeatedValidationFailureDrivingEscalation: boolean;
  nextIntendedStep?: string;
}): AutonomousWorkflowCodingLoopPhase {
  if (params.session.sessionMode !== "repo-coding") {
    return "none";
  }
  const latestCompletedStep = params.session.lastStepIndex ?? params.session.steps.at(-1)?.index ?? 0;
  const latestReview = params.review.history.at(-1);
  const supervisedRecoveryActive = (
    params.handoff.handoffStatus === "recovery-executing"
    || params.handoff.handoffStatus === "recovery-completed"
    || params.handoff.recoveryExecutionInProgress
    || params.handoff.recoveryExecutionCompleted
  );

  if (supervisedRecoveryActive) {
    return "supervised-recovery";
  }

  if (
    params.handoff.waitingOnOperatorDecision
    || params.handoff.handoffStatus === "recovery-selected"
    || params.repeatedValidationFailureDrivingEscalation
    || params.escalation.escalationStatus !== "none"
  ) {
    return "escalation";
  }

  if (latestReview?.reviewedAtStepIndex === latestCompletedStep) {
    return "review";
  }

  const latestImplementationIndex = params.lastImplementationStep?.index ?? 0;
  const latestValidationIndex = params.lastValidationStep?.index ?? 0;
  const latestCorrectionIndex = params.lastCorrectionStep?.index ?? 0;
  const latestValidationFailed = params.lastValidationStep?.executionResult?.status === "failed"
    && latestValidationIndex === latestCompletedStep;
  const latestValidationRecovered = params.lastValidationStep?.executionResult?.status === "success"
    && latestValidationIndex === latestCompletedStep
    && latestCorrectionIndex > 0
    && latestCorrectionIndex < latestValidationIndex;
  const validationPending = Boolean(params.currentValidationTarget) && (
    params.chainPhase === "validation"
    || isValidationLikeText(params.nextIntendedStep)
    || latestImplementationIndex > latestValidationIndex
    || latestCorrectionIndex > latestValidationIndex
  );

  if (latestValidationFailed) {
    return "validation-failed";
  }

  if (latestValidationRecovered) {
    return "validation-recovered";
  }

  if (params.chainPhase === "fix" || params.chainPhase === "retry") {
    return "correction-pending";
  }

  if (validationPending) {
    return "validation-pending";
  }

  if (params.chainPhase === "implementation") {
    return "implementation";
  }

  if (params.session.steps.length === 0 && (isImplementationLikeText(params.nextIntendedStep) || normalizeText(params.session.goal))) {
    return "implementation";
  }

  return "none";
}

function deriveAutonomousWorkflowCodingState(params: {
  session: AutonomousSession;
  chainPhase: AutonomousWorkflowChainPhase;
  currentObjectiveSummary?: string;
  actionableFailure?: string;
  nextIntendedStep?: string;
  review: AutonomousWorkflowRecommendationReviewState;
  escalation: AutonomousWorkflowRecommendationEscalationState;
  handoff: AutonomousWorkflowRecommendationHandoffState;
}): AutonomousWorkflowCodingState {
  const sessionMode = params.session.sessionMode;
  const pendingTargetPath = normalizeText(params.session.pendingAction?.metadata?.targetPath);
  const pendingAllowedRoot = normalizeText(params.session.pendingAction?.metadata?.allowedRoot);
  const pendingTestTarget = normalizeText(params.session.pendingAction?.metadata?.testTarget);
  const lastImplementationStep = [...params.session.steps].reverse().find((step) => Boolean(summarizeFixAttempt(step)));
  const lastValidationStep = [...params.session.steps].reverse().find((step) => isExplicitValidationStep(step));
  const mostRecentFailedValidationStep = [...params.session.steps].reverse().find(
    (step) => isExplicitValidationStep(step) && step.executionResult?.status === "failed",
  );
  const lastCorrectionStep = [...params.session.steps].reverse().find((step) => {
    if (!summarizeFixAttempt(step)) {
      return false;
    }

    if (mostRecentFailedValidationStep) {
      return step.index > mostRecentFailedValidationStep.index;
    }

    const phase = deriveWorkflowPhaseForStep(step);
    return phase === "fix" || phase === "retry";
  });
  const recentValidationSteps = [...params.session.steps].reverse().filter((step) => isExplicitValidationStep(step)).slice(0, 2);
  const targetScope = summarizeCodingScope(
    lastImplementationStep?.executionResult?.changedPaths,
    pendingTargetPath,
    pendingAllowedRoot,
  );
  const correctionScope = summarizeCodingScope(lastCorrectionStep?.executionResult?.changedPaths);
  const lastImplementationSummary = lastImplementationStep ? summarizeFixAttempt(lastImplementationStep) : undefined;
  const lastValidationSummary = lastValidationStep ? summarizeValidationOutcome(lastValidationStep) : undefined;
  const lastCorrectionSummary = lastCorrectionStep
    ? summarizeFailure(lastCorrectionStep) ?? summarizeFixAttempt(lastCorrectionStep)
    : undefined;
  const repeatedValidationOutcome = recentValidationSteps.length >= 2
    && recentValidationSteps[0]?.executionResult?.status === "failed"
    && recentValidationSteps[1]?.executionResult?.status === "failed"
    && normalizeText(recentValidationSteps[0]?.failureReason || recentValidationSteps[0]?.executionResult?.error)
      === normalizeText(recentValidationSteps[1]?.failureReason || recentValidationSteps[1]?.executionResult?.error)
      ? normalizeText(recentValidationSteps[0]?.failureReason || recentValidationSteps[0]?.executionResult?.error) || lastValidationSummary
      : undefined;
  const validationTarget = pendingTestTarget
    || (isValidationLikeText(params.nextIntendedStep) ? normalizeText(params.nextIntendedStep) : "")
    || (isValidationLikeText(lastImplementationStep?.expectedOutcome) ? normalizeText(lastImplementationStep?.expectedOutcome) : "")
    || (isValidationLikeText(lastImplementationStep?.proposedAction) ? normalizeText(lastImplementationStep?.proposedAction) : "")
    || normalizeText(lastValidationStep?.proposedAction)
    || normalizeText(lastValidationStep?.expectedOutcome)
    || undefined;
  const currentDeliverableTarget = normalizeText(lastImplementationStep?.expectedOutcome)
    || normalizeText(params.session.pendingAction?.expectedOutcome)
    || normalizeText(params.session.pendingAction?.description)
    || normalizeText(params.currentObjectiveSummary)
    || normalizeText(params.session.goal)
    || undefined;
  const outputArtifacts = deriveCodingOutputArtifacts({
    session: params.session,
    targetScope,
    currentDeliverableTarget,
  });
  const lastOutputSummary = summarizeLatestCodingOutput({
    session: params.session,
    outputArtifacts,
  });
  const outputLinkedToDeliverable = outputArtifacts.some((artifact) => artifact.linkedToDeliverable);
  const deliverableChangedDuringCorrectionOrEscalation = Boolean(
    params.handoff.selectedRecoveryMode === "restart-from-last-safe-boundary"
    || params.handoff.selectedRecoveryMode === "stop-loop"
    || (Boolean(targetScope) && Boolean(correctionScope) && correctionScope !== targetScope)
  );
  const expectedOutputForm = sessionMode === "repo-coding"
    ? targetScope
      ? `repo code change in ${targetScope}`
      : currentDeliverableTarget
        ? "repo code change"
        : undefined
    : undefined;
  const validationSuccessTarget = normalizeText(lastValidationStep?.expectedOutcome)
    || (currentDeliverableTarget && lastOutputSummary
      ? `Validation should confirm the produced output ${lastOutputSummary} satisfies ${currentDeliverableTarget}`
      : currentDeliverableTarget
        ? `Validation should confirm ${currentDeliverableTarget}`
        : undefined);
  const currentAcceptanceTarget = lastValidationStep?.executionResult?.status === "success" && lastOutputSummary
    ? `Accept the produced output ${lastOutputSummary}`
    : validationSuccessTarget || currentDeliverableTarget;
  const recoverySelectionActive = params.handoff.handoffStatus === "recovery-selected"
    || params.handoff.waitingOnOperatorDecision
    || params.handoff.handoffStatus === "second-escalation-needed";
  const repeatedValidationFailureDrivingEscalation = Boolean(repeatedValidationOutcome)
    && (params.escalation.escalationStatus !== "none" || recoverySelectionActive);
  const codingLoopPhase = deriveRepoCodingLoopPhase({
    session: params.session,
    chainPhase: params.chainPhase,
    review: params.review,
    escalation: params.escalation,
    handoff: params.handoff,
    lastImplementationStep,
    lastValidationStep,
    lastCorrectionStep,
    currentValidationTarget: validationTarget,
    repeatedValidationFailureDrivingEscalation,
    nextIntendedStep: params.nextIntendedStep,
  });
  const currentCodingObjective = params.currentObjectiveSummary || normalizeText(params.session.goal) || undefined;
  const nextIntendedCodingAction = normalizeText(params.nextIntendedStep)
    || normalizeText(params.session.workflowContinuity?.loopHealth?.recommendedNextActionSummary)
    || undefined;
  const currentTargetStatus = deriveRepoCodingTargetStatus(codingLoopPhase);
  const escalationActive = params.escalation.escalationStatus !== "none" || recoverySelectionActive;
  const supervisedRecoveryActive = codingLoopPhase === "supervised-recovery";
  const validationFirstActive = sessionMode === "repo-coding" && (
    codingLoopPhase === "validation-pending"
    || codingLoopPhase === "validation-failed"
    || codingLoopPhase === "correction-pending"
    || codingLoopPhase === "validation-recovered"
    || codingLoopPhase === "escalation"
    || codingLoopPhase === "supervised-recovery"
  );
  const currentCorrectionTarget = validationFirstActive
    && codingLoopPhase !== "validation-recovered"
    ? params.actionableFailure
      || normalizeText(mostRecentFailedValidationStep?.failureReason || mostRecentFailedValidationStep?.executionResult?.error)
      || normalizeText(lastValidationStep?.failureReason || lastValidationStep?.executionResult?.error)
      || undefined
    : undefined;
  const validationTargetMatchesDeliverable = Boolean(validationTarget) && Boolean(currentDeliverableTarget) && (
    !deliverableChangedDuringCorrectionOrEscalation
    || (Boolean(targetScope) && normalizeText(currentDeliverableTarget).toLowerCase().includes(String(targetScope).toLowerCase()))
  );
  const validationProves = currentDeliverableTarget
    ? lastOutputSummary
      ? `Validation should prove the produced output ${lastOutputSummary} satisfies ${currentDeliverableTarget}`
      : `Validation should prove ${currentDeliverableTarget}`
    : currentAcceptanceTarget;
  const validationFailureImpact = currentCorrectionTarget && currentDeliverableTarget
    ? lastOutputSummary
      ? `Validation failure blocks acceptance of ${currentDeliverableTarget} until the produced output ${lastOutputSummary} is corrected.`
      : `Validation failure blocks acceptance of ${currentDeliverableTarget}`
    : undefined;
  const correctionMaintainsDeliverable = (codingLoopPhase === "correction-pending"
    || codingLoopPhase === "validation-recovered"
    || codingLoopPhase === "escalation"
    || codingLoopPhase === "supervised-recovery")
    ? !deliverableChangedDuringCorrectionOrEscalation
    : false;
  const repeatedValidationSuccessWithoutRegression = recentValidationSteps.length >= 2
    && recentValidationSteps[0]?.executionResult?.status === "success"
    && recentValidationSteps[1]?.executionResult?.status === "success";
  const stableCorrectionValidation = Boolean(lastValidationStep)
    && lastValidationStep?.executionResult?.status === "success"
    && Boolean(lastCorrectionStep)
    && (lastCorrectionStep?.index ?? 0) < (lastValidationStep?.index ?? 0);
  const acceptanceSignalsConflict = Boolean(
    deliverableChangedDuringCorrectionOrEscalation
    || (Boolean(validationTarget) && !validationTargetMatchesDeliverable)
    || (lastValidationStep?.executionResult?.status === "success" && escalationActive)
  );
  const operatorAcceptanceDecision = summarizeRecentOperatorAcceptanceDecision({
    review: params.review,
    steeringAction: params.session.workflowContinuity.steering.requestedAction,
    operatorNote: params.session.workflowContinuity.steering.operatorNote,
    overrideReason: params.session.workflowContinuity.steering.overrideReason,
  });
  const mutationIntentRequiresApprovalReadyOutput = sessionMode === "repo-coding" && !isReadOnlyGoal(
    params.session.goal,
    currentDeliverableTarget || expectedOutputForm,
  );
  const candidateRepoActions = deriveAutonomousWorkflowRepoActions({
    session: params.session,
    outputArtifacts,
    deliverableAccepted: true,
  });
  const approvalReadyOutputSatisfied = !mutationIntentRequiresApprovalReadyOutput || candidateRepoActions.length > 0;
  const deliverableAccepted = Boolean(
    lastValidationStep?.executionResult?.status === "success"
    && !acceptanceSignalsConflict
    && !operatorAcceptanceDecision.rejected
    && approvalReadyOutputSatisfied
    && (operatorAcceptanceDecision.confirmed || repeatedValidationSuccessWithoutRegression)
  );
  const completionState: AutonomousWorkflowCodingCompletionState = operatorAcceptanceDecision.rejected
    ? "rejected"
    : deliverableAccepted
      ? "accepted"
      : lastValidationStep?.executionResult?.status === "success" && stableCorrectionValidation && approvalReadyOutputSatisfied
        ? "ready-for-acceptance"
        : "in-progress";
  const operatorConfirmationRequired = completionState === "ready-for-acceptance" || acceptanceSignalsConflict;
  const acceptanceConfidence: AutonomousWorkflowRecommendationConfidence = operatorAcceptanceDecision.confirmed || deliverableAccepted
    ? "high"
    : completionState === "ready-for-acceptance"
      ? "medium"
      : "low";
  const acceptanceReason = operatorAcceptanceDecision.reason
    || (deliverableAccepted
      ? repeatedValidationSuccessWithoutRegression
        ? lastOutputSummary
          ? `Repeated successful validation without regression accepted the produced output ${lastOutputSummary}.`
          : "Repeated successful validation without regression accepted the deliverable."
        : lastOutputSummary
          ? `Operator confirmed deliverable acceptance for the produced output ${lastOutputSummary}.`
          : "Operator confirmed the deliverable acceptance after bounded validation."
      : operatorAcceptanceDecision.rejected
        ? lastOutputSummary
          ? `Operator rejected the produced output ${lastOutputSummary} and returned it to the correction loop.`
          : "Operator rejected the current deliverable and returned it to the correction loop."
        : completionState === "ready-for-acceptance"
          ? lastOutputSummary
            ? `Successful validation after bounded correction made the produced output ${lastOutputSummary} ready for acceptance.`
            : "Successful validation after bounded correction made the deliverable ready for acceptance."
          : lastValidationStep?.executionResult?.status === "success" && !approvalReadyOutputSatisfied
            ? lastOutputSummary
              ? `Validation passed, but acceptance is blocked until the produced output ${lastOutputSummary} yields an approval-ready repo action.`
              : "Validation passed, but acceptance is blocked until the session produces an approval-ready repo action for the requested repo change."
          : acceptanceSignalsConflict
            ? "Conflicting deliverable or validation signals require operator confirmation before closure."
            : undefined);
  const repoActions = deliverableAccepted ? candidateRepoActions : [];
  const pendingRepoActions = repoActions.filter((action) => action.approvalStatus === "pending");
  const approvedRepoActions = repoActions.filter((action) => action.approvalStatus === "approved");
  const executedRepoActions = repoActions.filter((action) => action.approvalStatus === "executed");
  const approvalStateSummary = summarizeRepoApprovalState({
    session: params.session,
    pendingRepoActions,
    approvedRepoActions,
    executedRepoActions,
  });
  const repoActionSummary = summarizeRepoActionState(repoActions);
  const repoActionsSatisfied = repoActions.length === 0 || executedRepoActions.length >= repoActions.length;
  let effectiveDeliverableAccepted = deliverableAccepted;
  let effectiveAcceptanceReason = acceptanceReason;
  let effectiveAcceptanceConfidence = acceptanceConfidence;
  let effectiveCompletionState = completionState;
  let effectiveOperatorConfirmationRequired = operatorConfirmationRequired;
  let effectiveShouldTerminateLoop = deliverableAccepted && repoActionsSatisfied;
  const integrityIssues = deriveCodingStateIntegrityIssues({
    session: params.session,
    outputArtifacts,
    repoActions,
    pendingRepoActions,
    approvedRepoActions,
    deliverableAccepted,
    completionState,
    shouldTerminateLoop: effectiveShouldTerminateLoop,
  });
  const integritySummary = integrityIssues.length > 0 ? integrityIssues.join(" | ") : undefined;
  if (integritySummary) {
    effectiveDeliverableAccepted = false;
    effectiveAcceptanceReason = normalizeText([effectiveAcceptanceReason, integritySummary].filter(Boolean).join(" ")) || integritySummary;
    effectiveAcceptanceConfidence = "low";
    effectiveOperatorConfirmationRequired = true;
    effectiveShouldTerminateLoop = false;
    if (effectiveCompletionState === "accepted") {
      effectiveCompletionState = "in-progress";
    }
  }
  const acceptanceSummary = currentDeliverableTarget
    ? normalizeText([
        `deliverable=${currentDeliverableTarget}`,
        currentAcceptanceTarget ? `acceptance=${currentAcceptanceTarget}` : "",
        `status=${currentTargetStatus}`,
        `completion=${effectiveCompletionState}`,
        effectiveDeliverableAccepted ? "accepted=true" : "accepted=false",
        validationTargetMatchesDeliverable ? "validation-aligned=true" : "validation-aligned=false",
        outputLinkedToDeliverable ? "output-linked=true" : "output-linked=false",
        approvalStateSummary ? `approval=${approvalStateSummary}` : "",
        repoActionSummary ? `repo-actions=${repoActionSummary}` : "",
        integritySummary ? `integrity=${integritySummary}` : "",
        lastOutputSummary ? `output=${lastOutputSummary}` : "",
      ].filter(Boolean).join(" | ")) || undefined
    : undefined;
  const codingSummary = sessionMode === "repo-coding"
    ? normalizeText([
        `phase=${codingLoopPhase}`,
        targetScope ? `scope=${targetScope}` : "",
        currentDeliverableTarget ? `deliverable=${currentDeliverableTarget}` : "",
        currentTargetStatus !== "none" ? `target-status=${currentTargetStatus}` : "",
        `completion=${effectiveCompletionState}`,
        currentCodingObjective ? `objective=${currentCodingObjective}` : "",
        validationFirstActive ? "validation-first=active" : "",
        lastValidationStep?.executionResult?.status === "success" ? "last-validation=passed" : "",
        lastValidationStep?.executionResult?.status === "failed" ? "last-validation=failed" : "",
        validationTargetMatchesDeliverable ? "validation-aligned=true" : "validation-aligned=false",
        outputArtifacts.length > 0 ? `outputs=${outputArtifacts.length}` : "",
        outputLinkedToDeliverable ? "output-linked=true" : "",
        approvalStateSummary ? `approval=${approvalStateSummary}` : "",
        repoActionSummary ? `repo-actions=${repoActionSummary}` : "",
        integritySummary ? `integrity=${integritySummary}` : "",
        currentCorrectionTarget ? `correction=${currentCorrectionTarget}` : "",
        deliverableChangedDuringCorrectionOrEscalation ? "deliverable-retargeted=true" : "",
        effectiveOperatorConfirmationRequired ? "operator-confirmation-required=true" : "",
        effectiveShouldTerminateLoop ? "terminate=true" : "",
        repeatedValidationFailureDrivingEscalation ? "escalation-driver=repeated-validation-failure" : "",
        nextIntendedCodingAction ? `next=${nextIntendedCodingAction}` : "",
      ].filter(Boolean).join(" | ")) || undefined
    : undefined;

  return {
    sessionMode,
    codingLoopPhase,
    targetScope,
    currentCodingObjective,
    currentDeliverableTarget,
    expectedOutputForm,
    validationSuccessTarget,
    currentAcceptanceTarget,
    currentTargetStatus,
    validationProves,
    validationTargetMatchesDeliverable,
    validationFailureImpact,
    correctionMaintainsDeliverable,
    deliverableChangedDuringCorrectionOrEscalation,
    deliverableAccepted: effectiveDeliverableAccepted,
    acceptanceReason: effectiveAcceptanceReason,
    acceptanceConfidence: effectiveAcceptanceConfidence,
    completionState: effectiveCompletionState,
    operatorConfirmationRequired: effectiveOperatorConfirmationRequired,
    shouldTerminateLoop: effectiveShouldTerminateLoop,
    outputArtifacts,
    lastOutputSummary,
    outputLinkedToDeliverable,
    pendingRepoActions,
    approvedRepoActions,
    executedRepoActions,
    approvalStateSummary,
    repoActionSummary,
    integritySummary,
    acceptanceSummary,
    currentValidationTarget: validationTarget,
    validationTarget,
    lastCodeChangeSummary: lastImplementationSummary,
    lastImplementationSummary,
    lastValidationSummary,
    lastValidationResultSummary: lastValidationSummary,
    lastValidationPassed: lastValidationStep?.executionResult?.status === "success",
    currentCorrectionTarget,
    lastCorrectionSummary,
    repeatedValidationOutcome,
    validationFirstActive,
    repeatedValidationFailureDrivingEscalation,
    nextIntendedCodingAction,
    escalationActive,
    supervisedRecoveryActive,
    codingSummary,
  };
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

  const isImmediateOverride = requestedAction === "accept-current-recommendation"
    || requestedAction === "skip-current-task"
    || requestedAction === "pause-and-wait"
    || requestedAction === "stop-loop"
    || requestedAction === "force-stop";
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

  if (requestedAction === "skip-current-task") {
    return {
      ...loopHealth,
      operatorInterventionPreferred: true,
      recommendedNextActionSummary: operatorNote || "Skip the current task and advance to the next runnable bounded task.",
      loopHealthReason: operatorNote
        ? `Operator requested skipping the current task: ${operatorNote}`
        : "Operator requested skipping the current task before the next bounded step.",
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

  if (requestedAction === "stop-loop" || requestedAction === "force-stop") {
    return {
      ...loopHealth,
      operatorInterventionPreferred: true,
      recommendedNextPhase: "stop",
      recommendedNextActionSummary:
        params.steering.requestedStopReason || operatorNote || "Stop the bounded loop because it is no longer useful.",
      loopHealthReason:
        params.steering.requestedStopReason
        || (operatorNote
          ? `Operator requested that the bounded loop stop immediately: ${operatorNote}`
          : "Operator requested that the bounded loop stop immediately."),
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
  const review = deriveRecommendationReviewState({
    session,
    currentLoopHealth: loopHealth,
  });
  const escalation = deriveRecommendationEscalationState({
    session,
    currentLoopHealth: loopHealth,
    lastCompletedSafeStep,
  });
  const handoff = deriveRecommendationHandoffState({
    session,
    currentEscalation: escalation,
  });
  const coding = deriveAutonomousWorkflowCodingState({
    session,
    chainPhase,
    currentObjectiveSummary,
    actionableFailure,
    nextIntendedStep,
    review,
    escalation,
    handoff,
  });
  const taskChain = deriveAutonomousWorkflowTaskChainState(session);

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
    review,
    escalation,
    handoff,
    coding,
    taskChain,
    loopHealth,
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
  const escalationSource = source.escalation && typeof source.escalation === "object" ? (source.escalation as Record<string, unknown>) : undefined;
  const handoffSource = source.handoff && typeof source.handoff === "object" ? (source.handoff as Record<string, unknown>) : undefined;
  const codingSource = source.coding && typeof source.coding === "object" ? (source.coding as Record<string, unknown>) : undefined;
  const taskChainSource = source.taskChain && typeof source.taskChain === "object" ? (source.taskChain as Record<string, unknown>) : undefined;
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
    escalation: {
      escalationStatus: normalizeAutonomousWorkflowRecommendationEscalationStatus(escalationSource?.escalationStatus) ?? "none",
      recoveryRecommendation:
        normalizeAutonomousWorkflowRecommendationRecoveryRecommendation(escalationSource?.recoveryRecommendation) ?? "none",
      likelyNeedsOperatorInterventionNow:
        typeof escalationSource?.likelyNeedsOperatorInterventionNow === "boolean" ? escalationSource.likelyNeedsOperatorInterventionNow : false,
      repeatedIneffectiveReviewCycles:
        typeof escalationSource?.repeatedIneffectiveReviewCycles === "boolean" ? escalationSource.repeatedIneffectiveReviewCycles : false,
      acceptedRecommendationsRepeatedlyRequiringCorrection:
        typeof escalationSource?.acceptedRecommendationsRepeatedlyRequiringCorrection === "boolean"
          ? escalationSource.acceptedRecommendationsRepeatedlyRequiringCorrection
          : false,
      redirectedRecommendationsOutperformSystem:
        typeof escalationSource?.redirectedRecommendationsOutperformSystem === "boolean"
          ? escalationSource.redirectedRecommendationsOutperformSystem
          : false,
      returnedToSameIneffectiveState:
        typeof escalationSource?.returnedToSameIneffectiveState === "boolean" ? escalationSource.returnedToSameIneffectiveState : false,
      escalationSummary: normalizeText(typeof escalationSource?.escalationSummary === "string" ? escalationSource.escalationSummary : "") || undefined,
      recoverySummary: normalizeText(typeof escalationSource?.recoverySummary === "string" ? escalationSource.recoverySummary : "") || undefined,
    },
    handoff: {
      history: clampRecommendationHandoffHistoryEntries(
        Array.isArray(handoffSource?.history)
          ? (handoffSource?.history as unknown[])
              .map((entry) => normalizeAutonomousWorkflowRecommendationHandoffHistoryEntry(entry))
              .filter((entry): entry is AutonomousWorkflowRecommendationHandoffHistoryEntry => entry !== null)
          : [],
      ),
      handoffStatus: normalizeAutonomousWorkflowRecommendationHandoffStatus(handoffSource?.handoffStatus) ?? "none",
      selectedRecoveryAction: normalizeAutonomousOperatorSteeringAction(handoffSource?.selectedRecoveryAction),
      selectedRecoveryMode: normalizeAutonomousWorkflowRecommendationHandoffRecoveryMode(handoffSource?.selectedRecoveryMode),
      selectedRecoveryReason: normalizeText(typeof handoffSource?.selectedRecoveryReason === "string" ? handoffSource.selectedRecoveryReason : "") || undefined,
      waitingOnOperatorDecision: typeof handoffSource?.waitingOnOperatorDecision === "boolean" ? handoffSource.waitingOnOperatorDecision : false,
      recoveryExecutionInProgress: typeof handoffSource?.recoveryExecutionInProgress === "boolean" ? handoffSource.recoveryExecutionInProgress : false,
      recoveryExecutionCompleted: typeof handoffSource?.recoveryExecutionCompleted === "boolean" ? handoffSource.recoveryExecutionCompleted : false,
      recoveryImprovedProgress: typeof handoffSource?.recoveryImprovedProgress === "boolean" ? handoffSource.recoveryImprovedProgress : false,
      secondEscalationNeeded: typeof handoffSource?.secondEscalationNeeded === "boolean" ? handoffSource.secondEscalationNeeded : false,
      handoffSummary: normalizeText(typeof handoffSource?.handoffSummary === "string" ? handoffSource.handoffSummary : "") || undefined,
      recoveryExecutionSummary:
        normalizeText(typeof handoffSource?.recoveryExecutionSummary === "string" ? handoffSource.recoveryExecutionSummary : "") || undefined,
    },
    coding: {
      sessionMode: normalizeAutonomousSessionMode(codingSource?.sessionMode) ?? "general",
      codingLoopPhase: normalizeAutonomousWorkflowCodingLoopPhase(codingSource?.codingLoopPhase) ?? "none",
      targetScope: normalizeText(typeof codingSource?.targetScope === "string" ? codingSource.targetScope : "") || undefined,
      currentCodingObjective:
        normalizeText(typeof codingSource?.currentCodingObjective === "string" ? codingSource.currentCodingObjective : "") || undefined,
      currentDeliverableTarget:
        normalizeText(typeof codingSource?.currentDeliverableTarget === "string" ? codingSource.currentDeliverableTarget : "") || undefined,
      expectedOutputForm:
        normalizeText(typeof codingSource?.expectedOutputForm === "string" ? codingSource.expectedOutputForm : "") || undefined,
      validationSuccessTarget:
        normalizeText(typeof codingSource?.validationSuccessTarget === "string" ? codingSource.validationSuccessTarget : "") || undefined,
      currentAcceptanceTarget:
        normalizeText(typeof codingSource?.currentAcceptanceTarget === "string" ? codingSource.currentAcceptanceTarget : "") || undefined,
      currentTargetStatus: normalizeAutonomousWorkflowCodingTargetStatus(codingSource?.currentTargetStatus) ?? "none",
      validationProves:
        normalizeText(typeof codingSource?.validationProves === "string" ? codingSource.validationProves : "") || undefined,
      validationTargetMatchesDeliverable:
        typeof codingSource?.validationTargetMatchesDeliverable === "boolean" ? codingSource.validationTargetMatchesDeliverable : false,
      validationFailureImpact:
        normalizeText(typeof codingSource?.validationFailureImpact === "string" ? codingSource.validationFailureImpact : "") || undefined,
      correctionMaintainsDeliverable:
        typeof codingSource?.correctionMaintainsDeliverable === "boolean" ? codingSource.correctionMaintainsDeliverable : false,
      deliverableChangedDuringCorrectionOrEscalation:
        typeof codingSource?.deliverableChangedDuringCorrectionOrEscalation === "boolean"
          ? codingSource.deliverableChangedDuringCorrectionOrEscalation
          : false,
      deliverableAccepted: typeof codingSource?.deliverableAccepted === "boolean" ? codingSource.deliverableAccepted : false,
      acceptanceReason:
        normalizeText(typeof codingSource?.acceptanceReason === "string" ? codingSource.acceptanceReason : "") || undefined,
      acceptanceConfidence:
        codingSource?.acceptanceConfidence === "low"
        || codingSource?.acceptanceConfidence === "medium"
        || codingSource?.acceptanceConfidence === "high"
          ? codingSource.acceptanceConfidence as AutonomousWorkflowRecommendationConfidence
          : "low",
      completionState:
        normalizeAutonomousWorkflowCodingCompletionState(codingSource?.completionState) ?? "in-progress",
      operatorConfirmationRequired:
        typeof codingSource?.operatorConfirmationRequired === "boolean" ? codingSource.operatorConfirmationRequired : false,
      shouldTerminateLoop:
        typeof codingSource?.shouldTerminateLoop === "boolean" ? codingSource.shouldTerminateLoop : false,
      outputArtifacts: Array.isArray(codingSource?.outputArtifacts)
        ? clampCodingOutputArtifacts(
            codingSource.outputArtifacts
              .map((artifact) => normalizeAutonomousWorkflowCodingOutputArtifact(artifact))
              .filter((artifact): artifact is AutonomousWorkflowCodingOutputArtifact => Boolean(artifact)),
          )
        : [],
      lastOutputSummary:
        normalizeText(typeof codingSource?.lastOutputSummary === "string" ? codingSource.lastOutputSummary : "") || undefined,
      outputLinkedToDeliverable:
        typeof codingSource?.outputLinkedToDeliverable === "boolean" ? codingSource.outputLinkedToDeliverable : false,
      pendingRepoActions: Array.isArray(codingSource?.pendingRepoActions)
        ? clampAutonomousWorkflowRepoActions(
            codingSource.pendingRepoActions
              .map((action) => normalizeAutonomousWorkflowRepoAction(action))
              .filter((action): action is AutonomousWorkflowRepoAction => Boolean(action)),
          )
        : [],
      approvedRepoActions: Array.isArray(codingSource?.approvedRepoActions)
        ? clampAutonomousWorkflowRepoActions(
            codingSource.approvedRepoActions
              .map((action) => normalizeAutonomousWorkflowRepoAction(action))
              .filter((action): action is AutonomousWorkflowRepoAction => Boolean(action)),
          )
        : [],
      executedRepoActions: Array.isArray(codingSource?.executedRepoActions)
        ? clampAutonomousWorkflowRepoActions(
            codingSource.executedRepoActions
              .map((action) => normalizeAutonomousWorkflowRepoAction(action))
              .filter((action): action is AutonomousWorkflowRepoAction => Boolean(action)),
          )
        : [],
      approvalStateSummary:
        normalizeText(typeof codingSource?.approvalStateSummary === "string" ? codingSource.approvalStateSummary : "") || undefined,
      repoActionSummary:
        normalizeText(typeof codingSource?.repoActionSummary === "string" ? codingSource.repoActionSummary : "") || undefined,
      integritySummary:
        normalizeText(typeof codingSource?.integritySummary === "string" ? codingSource.integritySummary : "") || undefined,
      acceptanceSummary:
        normalizeText(typeof codingSource?.acceptanceSummary === "string" ? codingSource.acceptanceSummary : "") || undefined,
      currentValidationTarget:
        normalizeText(typeof codingSource?.currentValidationTarget === "string" ? codingSource.currentValidationTarget : "") || undefined,
      validationTarget: normalizeText(typeof codingSource?.validationTarget === "string" ? codingSource.validationTarget : "") || undefined,
      lastCodeChangeSummary:
        normalizeText(typeof codingSource?.lastCodeChangeSummary === "string" ? codingSource.lastCodeChangeSummary : "") || undefined,
      lastImplementationSummary:
        normalizeText(typeof codingSource?.lastImplementationSummary === "string" ? codingSource.lastImplementationSummary : "") || undefined,
      lastValidationSummary:
        normalizeText(typeof codingSource?.lastValidationSummary === "string" ? codingSource.lastValidationSummary : "") || undefined,
      lastValidationResultSummary:
        normalizeText(typeof codingSource?.lastValidationResultSummary === "string" ? codingSource.lastValidationResultSummary : "") || undefined,
      lastValidationPassed: typeof codingSource?.lastValidationPassed === "boolean" ? codingSource.lastValidationPassed : false,
      currentCorrectionTarget:
        normalizeText(typeof codingSource?.currentCorrectionTarget === "string" ? codingSource.currentCorrectionTarget : "") || undefined,
      lastCorrectionSummary:
        normalizeText(typeof codingSource?.lastCorrectionSummary === "string" ? codingSource.lastCorrectionSummary : "") || undefined,
      repeatedValidationOutcome:
        normalizeText(typeof codingSource?.repeatedValidationOutcome === "string" ? codingSource.repeatedValidationOutcome : "") || undefined,
      validationFirstActive: typeof codingSource?.validationFirstActive === "boolean" ? codingSource.validationFirstActive : false,
      repeatedValidationFailureDrivingEscalation:
        typeof codingSource?.repeatedValidationFailureDrivingEscalation === "boolean"
          ? codingSource.repeatedValidationFailureDrivingEscalation
          : false,
      nextIntendedCodingAction:
        normalizeText(typeof codingSource?.nextIntendedCodingAction === "string" ? codingSource.nextIntendedCodingAction : "") || undefined,
      escalationActive: typeof codingSource?.escalationActive === "boolean" ? codingSource.escalationActive : false,
      supervisedRecoveryActive: typeof codingSource?.supervisedRecoveryActive === "boolean" ? codingSource.supervisedRecoveryActive : false,
      codingSummary: normalizeText(typeof codingSource?.codingSummary === "string" ? codingSource.codingSummary : "") || undefined,
    },
    taskChain: {
      generatedTaskQueue: Array.isArray(taskChainSource?.generatedTaskQueue)
        ? taskChainSource.generatedTaskQueue
            .map((entry) => normalizeAutonomousGeneratedTaskQueueEntry(entry))
            .filter((entry): entry is AutonomousGeneratedTaskQueueEntry => entry !== null)
        : [],
      currentTaskId: normalizeText(typeof taskChainSource?.currentTaskId === "string" ? taskChainSource.currentTaskId : "") || undefined,
      currentFeatureId: normalizeText(typeof taskChainSource?.currentFeatureId === "string" ? taskChainSource.currentFeatureId : "") || undefined,
      completedTaskIds: normalizeUniqueTaskIdList(taskChainSource?.completedTaskIds),
      blockedTaskIds: normalizeUniqueTaskIdList(taskChainSource?.blockedTaskIds),
      skippedTaskIds: normalizeUniqueTaskIdList(taskChainSource?.skippedTaskIds),
      nextRecommendedTaskId:
        normalizeText(typeof taskChainSource?.nextRecommendedTaskId === "string" ? taskChainSource.nextRecommendedTaskId : "") || undefined,
      nextRecommendedFeatureId:
        normalizeText(typeof taskChainSource?.nextRecommendedFeatureId === "string" ? taskChainSource.nextRecommendedFeatureId : "") || undefined,
      chainStatus: normalizeAutonomousWorkflowTaskChainStatus(taskChainSource?.chainStatus) ?? "idle",
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
    executedActionPreview: normalizeExecutionActionPreview(source.executedActionPreview),
    actionFamily: normalizeActionFamily(source.actionFamily),
    executionAdapterId: normalizeExecutionAdapterId(source.executionAdapterId),
    adapterContextSummary: normalizeText(typeof source.adapterContextSummary === "string" ? source.adapterContextSummary : "") || undefined,
    executionNodeId: normalizeText(typeof source.executionNodeId === "string" ? source.executionNodeId : "") || undefined,
    executionNodeMode: normalizeExecutionNodeMode(source.executionNodeMode),
    nodeCapabilitySummary: normalizeText(typeof source.nodeCapabilitySummary === "string" ? source.nodeCapabilitySummary : "") || undefined,
    selectedNodeId: normalizeText(typeof source.selectedNodeId === "string" ? source.selectedNodeId : "") || undefined,
    selectedNodeReason: normalizeText(typeof source.selectedNodeReason === "string" ? source.selectedNodeReason : "") || undefined,
    taskId: normalizeText(typeof source.taskId === "string" ? source.taskId : "") || undefined,
    featureId: normalizeText(typeof source.featureId === "string" ? source.featureId : "") || undefined,
    featureTitle: normalizeText(typeof source.featureTitle === "string" ? source.featureTitle : "") || undefined,
    featureDescription: normalizeText(typeof source.featureDescription === "string" ? source.featureDescription : "") || undefined,
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

function evaluateRecommendationReviewHistory(params: {
  session: AutonomousSession;
  currentLoopHealth: AutonomousWorkflowLoopHealthState;
}): Array<AutonomousWorkflowRecommendationReviewHistoryEntry & {
  outcome: AutonomousWorkflowRecommendationReviewOutcome;
  evaluationSummary: string;
  nextHistoryEntry?: AutonomousWorkflowRecommendationReviewHistoryEntry;
  followThroughStatus: AutonomousWorkflowRecommendationFollowThroughStatus;
  followThroughSummary: string;
  followThroughLedUsefulProgress: boolean;
  followThroughRequiredCorrection: boolean;
  returnedToSameRecommendationAgain: boolean;
  repeatedReviewWithoutProgress: boolean;
}> {
  const priorReview = params.session.workflowContinuity?.review ?? createDefaultAutonomousWorkflowRecommendationReviewState();
  const history = clampRecommendationReviewHistoryEntries(priorReview.history ?? []);

  return history.map((entry, index) => {
    const evaluation = deriveRecommendationReviewOutcome({
      session: params.session,
      entry,
    });
    const priorEvaluated = history.slice(Math.max(0, index - 1), index + 1).map((priorEntry) => {
      return deriveRecommendationReviewOutcome({
        session: params.session,
        entry: priorEntry,
      }).outcome;
    });
    const repeatedReviewWithoutProgress = priorEvaluated.length >= 2
      && priorEvaluated.every((outcome) => {
        return outcome === "no-clear-improvement" || outcome === "still-blocked";
      });
    const followThrough = deriveRecommendationFollowThroughStatus({
      entry,
      outcome: evaluation.outcome,
      outcomeSummary: evaluation.summary,
      nextHistoryEntry: history[index + 1],
      currentLoopHealth: params.currentLoopHealth,
      currentStepIndex: params.session.currentStepIndex,
      repeatedReviewWithoutProgress,
    });

    return {
      ...entry,
      outcome: evaluation.outcome,
      evaluationSummary: evaluation.summary,
      nextHistoryEntry: history[index + 1],
      followThroughStatus: followThrough.status,
      followThroughSummary: followThrough.summary,
      followThroughLedUsefulProgress: followThrough.ledUsefulProgress,
      followThroughRequiredCorrection: followThrough.requiredCorrection,
      returnedToSameRecommendationAgain: followThrough.returnedToSameRecommendationAgain,
      repeatedReviewWithoutProgress,
    };
  });
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
  const evaluatedHistory = evaluateRecommendationReviewHistory(params);

  if (evaluatedHistory.length === 0) {
    return createDefaultAutonomousWorkflowRecommendationReviewState();
  }
  const lastHistoryEntry = evaluatedHistory.at(-1);
  if (!lastHistoryEntry) {
    return createDefaultAutonomousWorkflowRecommendationReviewState();
  }

  const recentOverrides = evaluatedHistory.slice(-4).filter((entry) => {
    return Boolean(entry.operatorResponse) && entry.operatorResponse !== "accept-current-recommendation";
  }).length;
  const lastAcceptedRecommendationOutcome = [...evaluatedHistory].reverse().find((entry) => {
    return entry.operatorResponse === "accept-current-recommendation";
  });
  const lastRedirectedRecommendationOutcome = [...evaluatedHistory].reverse().find((entry) => {
    return Boolean(entry.operatorResponse) && entry.operatorResponse !== "accept-current-recommendation";
  });
  const acceptedFollowThrough = lastAcceptedRecommendationOutcome?.followThroughStatus;
  const redirectedFollowThrough = lastRedirectedRecommendationOutcome?.followThroughStatus;
  const lastRecommendationNeededCorrection = lastHistoryEntry.outcome === "needed-correction";
  const lastReviewImprovedProgress = lastHistoryEntry.outcome === "helped-progress" || lastHistoryEntry.outcome === "needed-correction";

  return {
    history: evaluatedHistory.map((entry) => ({
      reviewedAtStepIndex: entry.reviewedAtStepIndex,
      systemRecommendedNextPhase: entry.systemRecommendedNextPhase,
      recommendedNextPhase: entry.recommendedNextPhase,
      recommendationConfidence: entry.recommendationConfidence,
      likelyNeedsOperatorInput: entry.likelyNeedsOperatorInput,
      topContributingSignals: entry.topContributingSignals,
      recommendationRationaleSummary: entry.recommendationRationaleSummary,
      operatorResponse: entry.operatorResponse,
      requestedNextPhaseOverride: entry.requestedNextPhaseOverride,
      operatorNote: entry.operatorNote,
      overrideReason: entry.overrideReason,
    })),
    lastReviewedRecommendation: lastHistoryEntry.recommendedNextPhase,
    lastSystemRecommendation: lastHistoryEntry.systemRecommendedNextPhase,
    lastOperatorResponse: lastHistoryEntry.operatorResponse,
    lastRecommendationOutcome: lastHistoryEntry.outcome,
    lastFollowThroughStatus: lastHistoryEntry.followThroughStatus,
    lastFollowThroughSummary: lastHistoryEntry.followThroughSummary,
    lastAcceptedRecommendationOutcome: acceptedFollowThrough,
    lastRedirectedRecommendationOutcome: redirectedFollowThrough,
    lastReviewImprovedProgress,
    lastRecommendationNeededCorrection,
    followThroughLedUsefulProgress: lastHistoryEntry.followThroughLedUsefulProgress,
    followThroughRequiredCorrection: lastHistoryEntry.followThroughRequiredCorrection,
    returnedToSameRecommendationAgain: lastHistoryEntry.returnedToSameRecommendationAgain,
    repeatedReviewWithoutProgress: lastHistoryEntry.repeatedReviewWithoutProgress,
    frequentlyOverridden: recentOverrides >= 2,
    reviewSummary: `Last review: ${lastHistoryEntry.recommendedNextPhase} -> ${lastHistoryEntry.operatorResponse ?? "operator-note"} (${lastHistoryEntry.followThroughSummary})`,
  };
}

function deriveRecommendationEscalationState(params: {
  session: AutonomousSession;
  currentLoopHealth: AutonomousWorkflowLoopHealthState;
  lastCompletedSafeStep?: number;
}): AutonomousWorkflowRecommendationEscalationState {
  const evaluatedHistory = evaluateRecommendationReviewHistory({
    session: params.session,
    currentLoopHealth: params.currentLoopHealth,
  });

  if (evaluatedHistory.length === 0) {
    return createDefaultAutonomousWorkflowRecommendationEscalationState();
  }

  const recentEntries = evaluatedHistory.slice(-4);
  const repeatedIneffectiveReviewCycles = recentEntries.filter((entry) => {
    return entry.followThroughStatus === "repeated-review-no-progress" || entry.followThroughStatus === "still-blocked";
  }).length >= 2;
  const acceptedRecommendationsRepeatedlyRequiringCorrection = recentEntries.filter((entry) => {
    return entry.followThroughStatus === "accepted-needed-correction";
  }).length >= 2;
  const redirectedRecommendationsOutperformSystem = recentEntries.filter((entry) => {
    return entry.followThroughStatus === "redirected-and-improved-progress";
  }).length >= 2;
  const returnedToSameIneffectiveState = recentEntries.some((entry) => {
    return entry.returnedToSameRecommendationAgain && !entry.followThroughLedUsefulProgress;
  });
  const latestHelpfulRedirect = [...evaluatedHistory].reverse().find((entry) => {
    return entry.followThroughStatus === "redirected-and-improved-progress";
  });

  if (
    (repeatedIneffectiveReviewCycles && params.currentLoopHealth.currentPhaseRepeatCount >= 4)
    || (returnedToSameIneffectiveState && params.currentLoopHealth.currentPhaseRepeatCount >= 3 && evaluatedHistory.length >= 2)
  ) {
    return {
      escalationStatus: "stop-recommended",
      recoveryRecommendation: "stop-loop",
      likelyNeedsOperatorInterventionNow: true,
      repeatedIneffectiveReviewCycles,
      acceptedRecommendationsRepeatedlyRequiringCorrection,
      redirectedRecommendationsOutperformSystem,
      returnedToSameIneffectiveState,
      escalationSummary: "Repeated reviewed recommendations are not producing useful bounded progress.",
      recoverySummary: "Recommend stopping the current loop because repeated review cycles are not improving the outcome.",
    };
  }

  if (repeatedIneffectiveReviewCycles && typeof params.lastCompletedSafeStep === "number" && params.lastCompletedSafeStep > 0) {
    return {
      escalationStatus: "restart-recommended",
      recoveryRecommendation: "restart-from-last-safe-boundary",
      likelyNeedsOperatorInterventionNow: true,
      repeatedIneffectiveReviewCycles,
      acceptedRecommendationsRepeatedlyRequiringCorrection,
      redirectedRecommendationsOutperformSystem,
      returnedToSameIneffectiveState,
      escalationSummary: "Reviewed recommendations are cycling without useful progress and a safe boundary is available.",
      recoverySummary: "Recommend restarting from the last safe boundary instead of repeating the same ineffective recommendation path.",
    };
  }

  if (acceptedRecommendationsRepeatedlyRequiringCorrection || returnedToSameIneffectiveState) {
    return {
      escalationStatus: "operator-intervention-recommended",
      recoveryRecommendation: "operator-intervention",
      likelyNeedsOperatorInterventionNow: true,
      repeatedIneffectiveReviewCycles,
      acceptedRecommendationsRepeatedlyRequiringCorrection,
      redirectedRecommendationsOutperformSystem,
      returnedToSameIneffectiveState,
      escalationSummary: acceptedRecommendationsRepeatedlyRequiringCorrection
        ? "Accepted recommendations are repeatedly requiring correction."
        : "The loop returned to the same ineffective recommendation state.",
      recoverySummary: "Likely needs operator intervention now because the current reviewed recommendation path is not stabilizing.",
    };
  }

  if (redirectedRecommendationsOutperformSystem && latestHelpfulRedirect) {
    const prefersValidation = latestHelpfulRedirect.requestedNextPhaseOverride === "validation" || latestHelpfulRedirect.operatorResponse === "prefer-validation-next";
    const prefersFix = latestHelpfulRedirect.requestedNextPhaseOverride === "fix" || latestHelpfulRedirect.operatorResponse === "prefer-fix-next";

    return {
      escalationStatus: "alternate-path-recommended",
      recoveryRecommendation: prefersValidation ? "validation-first" : prefersFix ? "fix-first" : "operator-intervention",
      likelyNeedsOperatorInterventionNow: false,
      repeatedIneffectiveReviewCycles,
      acceptedRecommendationsRepeatedlyRequiringCorrection,
      redirectedRecommendationsOutperformSystem,
      returnedToSameIneffectiveState,
      escalationSummary: "Recent redirected recommendations have outperformed the system recommendation repeatedly.",
      recoverySummary: prefersValidation
        ? "Recommend an alternate validation-first path based on recent successful redirected follow-through."
        : prefersFix
          ? "Recommend an alternate fix-first path based on recent successful redirected follow-through."
          : "Recommend an alternate operator-guided path because redirected recommendations are outperforming the default recommendation.",
    };
  }

  if (params.currentLoopHealth.likelyNeedsOperatorInput) {
    return {
      escalationStatus: "monitor",
      recoveryRecommendation: "operator-intervention",
      likelyNeedsOperatorInterventionNow: true,
      repeatedIneffectiveReviewCycles,
      acceptedRecommendationsRepeatedlyRequiringCorrection,
      redirectedRecommendationsOutperformSystem,
      returnedToSameIneffectiveState,
      escalationSummary: "Follow-through signals suggest the supervised loop is drifting toward operator intervention.",
      recoverySummary: "Likely needs operator intervention now if the next bounded step does not improve progress.",
    };
  }

  return {
    escalationStatus: "none",
    recoveryRecommendation: "none",
    likelyNeedsOperatorInterventionNow: false,
    repeatedIneffectiveReviewCycles,
    acceptedRecommendationsRepeatedlyRequiringCorrection,
    redirectedRecommendationsOutperformSystem,
    returnedToSameIneffectiveState,
  };
}

function deriveRecommendationHandoffState(params: {
  session: AutonomousSession;
  currentEscalation: AutonomousWorkflowRecommendationEscalationState;
}): AutonomousWorkflowRecommendationHandoffState {
  const priorHandoff = params.session.workflowContinuity?.handoff ?? createDefaultAutonomousWorkflowRecommendationHandoffState();
  const history = clampRecommendationHandoffHistoryEntries(priorHandoff.history ?? []);
  const lastHistoryEntry = history.at(-1);

  if (!lastHistoryEntry) {
    if (params.currentEscalation.escalationStatus !== "none") {
      return {
        ...createDefaultAutonomousWorkflowRecommendationHandoffState(),
        handoffStatus: "waiting-on-operator-decision",
        waitingOnOperatorDecision: true,
        handoffSummary: params.currentEscalation.escalationSummary || "An escalated supervised recovery decision is waiting on the operator.",
        recoveryExecutionSummary: params.currentEscalation.recoverySummary,
      };
    }

    return createDefaultAutonomousWorkflowRecommendationHandoffState();
  }

  const followUpSteps = params.session.steps.filter((step) => step.index >= lastHistoryEntry.initiatedAtStepIndex);
  const successfulFollowUp = followUpSteps.find((step) => {
    return step.executionResult?.status === "success"
      || step.goalStatus === "progressing"
      || step.goalStatus === "complete"
      || step.nextDecision === "continue";
  });
  const selectedRecoveryAction = lastHistoryEntry.selectedRecoveryAction;
  const selectedRecoveryMode = lastHistoryEntry.selectedRecoveryMode;
  const selectedRecoveryReason = lastHistoryEntry.overrideReason || lastHistoryEntry.operatorNote || params.currentEscalation.recoverySummary;
  const newEscalationRaised = params.currentEscalation.escalationStatus !== "none"
    && lastHistoryEntry.initiatedAtStepIndex < params.session.currentStepIndex
    && (
      lastHistoryEntry.escalationStatus !== params.currentEscalation.escalationStatus
      || lastHistoryEntry.recoveryRecommendation !== params.currentEscalation.recoveryRecommendation
    );
  const waitingOnOperatorDecision = params.currentEscalation.escalationStatus !== "none"
    && (newEscalationRaised || (!selectedRecoveryAction && !selectedRecoveryMode));
  const escalationAcknowledged = lastHistoryEntry.operatorAcknowledged && !selectedRecoveryAction && !selectedRecoveryMode;
  const recoveryExecutionCompleted = Boolean(successfulFollowUp)
    || (selectedRecoveryMode === "stop-loop" && params.session.status !== "active")
    || (selectedRecoveryMode === "operator-intervention" && params.session.status === "paused");
  const recoveryImprovedProgress = Boolean(successfulFollowUp);
  const secondEscalationNeeded = (newEscalationRaised && followUpSteps.length > 0 && !successfulFollowUp)
    || (followUpSteps.length > 0
    && !recoveryExecutionCompleted
    && params.currentEscalation.escalationStatus !== "none"
    && params.currentEscalation.likelyNeedsOperatorInterventionNow
    && !newEscalationRaised);
  const recoveryExecutionInProgress = followUpSteps.length > 0 && !recoveryExecutionCompleted && !secondEscalationNeeded;

  let handoffStatus: AutonomousWorkflowRecommendationHandoffStatus = "none";
  if (waitingOnOperatorDecision) {
    handoffStatus = "waiting-on-operator-decision";
  } else if (secondEscalationNeeded) {
    handoffStatus = "second-escalation-needed";
  } else if (recoveryExecutionCompleted) {
    handoffStatus = "recovery-completed";
  } else if (recoveryExecutionInProgress) {
    handoffStatus = "recovery-executing";
  } else if (selectedRecoveryAction || selectedRecoveryMode) {
    handoffStatus = "recovery-selected";
  } else if (escalationAcknowledged) {
    handoffStatus = "escalation-acknowledged";
  }

  return {
    history,
    handoffStatus,
    selectedRecoveryAction,
    selectedRecoveryMode,
    selectedRecoveryReason,
    waitingOnOperatorDecision,
    recoveryExecutionInProgress,
    recoveryExecutionCompleted,
    recoveryImprovedProgress,
    secondEscalationNeeded,
    handoffSummary: waitingOnOperatorDecision
      ? params.currentEscalation.escalationSummary
        ? `Waiting on an operator recovery decision: ${params.currentEscalation.escalationSummary}`
        : "Waiting on an operator recovery decision."
      : escalationAcknowledged
        ? "The operator acknowledged the escalation and is preparing a supervised recovery path."
        : selectedRecoveryAction || selectedRecoveryMode
          ? `Selected supervised recovery path: ${selectedRecoveryMode ?? selectedRecoveryAction}.`
          : undefined,
    recoveryExecutionSummary: recoveryExecutionCompleted
      ? successfulFollowUp
        ? `The supervised recovery path improved progress at step ${successfulFollowUp.index}.`
        : `The supervised recovery path completed with ${selectedRecoveryMode ?? selectedRecoveryAction}.`
      : secondEscalationNeeded
        ? "The supervised recovery path did not improve progress and triggered another escalation."
        : recoveryExecutionInProgress
          ? `The supervised recovery path is in progress via ${selectedRecoveryMode ?? selectedRecoveryAction}.`
          : params.currentEscalation.recoverySummary,
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
    sessionMode: normalizeAutonomousSessionMode(params.sessionMode) ?? "general",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    currentStepIndex: 1,
    maxSteps: clampAutonomousMaxSteps(params.maxSteps),
    sessionLoop: createDefaultAutonomousSessionLoopState({
      sessionStartedAt: timestamp,
      lastUpdatedAt: timestamp,
      maxTasksPerSession: params.maxTasksPerSession,
      maxFailuresPerSession: params.maxFailuresPerSession,
      maxRuntimeMs: params.maxRuntimeMs,
    }),
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
      escalation: createDefaultAutonomousWorkflowRecommendationEscalationState(),
      handoff: createDefaultAutonomousWorkflowRecommendationHandoffState(),
      coding: createDefaultAutonomousWorkflowCodingState(),
      taskChain: createDefaultAutonomousWorkflowTaskChainState(),
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
    oversight: {
      summary: {
        sessionId: "",
        startTime: timestamp,
        endTime: timestamp,
        tasksAttempted: 0,
        tasksCompleted: 0,
        tasksBlocked: 0,
        tasksFailed: 0,
        approvalsRequested: 0,
        approvalsExecuted: 0,
        currentPauseReason: "No pause reason is currently recorded.",
        recommendedNextStep: "No recommended next step is currently recorded.",
        currentFeatureId: undefined,
        currentFeatureTitle: undefined,
        currentFeatureProgress: undefined,
        completedFeatures: 0,
        blockedFeatures: 0,
        keyFilesOrAssetsChanged: [],
        validationSummary: "No validation summary is currently recorded.",
        safeToResume: false,
      },
      operatorAttention: [],
      controls: [],
      taskReviews: [],
      currentFeatureId: undefined,
      currentFeatureTitle: undefined,
      featureBundles: [],
      recentCompletedTaskIds: [],
      blockedTaskIds: [],
      completedFeatureIds: [],
      blockedFeatureIds: [],
      pendingApprovalActionIds: [],
    },
    steps: [],
  };

  return refreshAutonomousSessionDerivedState(session);
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
    executedActionPreview: normalizeExecutionActionPreview(params.executedActionPreview),
    actionFamily: params.actionFamily,
    executionAdapterId: params.executionAdapterId,
    adapterContextSummary: normalizeText(params.adapterContextSummary) || undefined,
    executionNodeId: normalizeText(params.executionNodeId) || undefined,
    executionNodeMode: params.executionNodeMode,
    nodeCapabilitySummary: normalizeText(params.nodeCapabilitySummary) || undefined,
    selectedNodeId: normalizeText(params.selectedNodeId) || undefined,
    selectedNodeReason: normalizeText(params.selectedNodeReason) || undefined,
    taskId: normalizeText(params.taskId) || undefined,
    featureId: normalizeText(params.featureId) || undefined,
    featureTitle: normalizeText(params.featureTitle) || undefined,
    featureDescription: normalizeText(params.featureDescription) || undefined,
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

  let derivedSession = refreshAutonomousSessionDerivedState(nextSession);

  if (
    derivedSession.sessionMode === "repo-coding"
    && derivedSession.workflowContinuity.coding.deliverableAccepted
    && derivedSession.workflowContinuity.coding.shouldTerminateLoop
    && derivedSession.latestCompletion?.status !== "complete"
  ) {
    derivedSession = {
      ...derivedSession,
      latestCompletion: {
        status: "complete",
        isComplete: true,
        reason:
          derivedSession.workflowContinuity.coding.acceptanceReason
          || derivedSession.workflowContinuity.coding.acceptanceSummary
          || derivedSession.latestCompletion?.reason
          || "The repo deliverable satisfied its bounded acceptance criteria.",
        confidence: derivedSession.workflowContinuity.coding.acceptanceConfidence,
      },
    };

    derivedSession = refreshAutonomousSessionDerivedState(derivedSession);
  }

  return derivedSession;
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

  return refreshAutonomousSessionDerivedState(nextSession);
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

  return refreshAutonomousSessionDerivedState(nextSession);
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

  return refreshAutonomousSessionDerivedState(nextSession);
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

  return refreshAutonomousSessionDerivedState(nextSession);
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
    sessionMode: normalizeAutonomousSessionMode(source.sessionMode) ?? "general",
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
    sessionLoop: createDefaultAutonomousSessionLoopState({
      sessionStartedAt: normalizeText(typeof source.createdAt === "string" ? source.createdAt : "") || createTimestamp(),
      lastUpdatedAt: normalizeText(typeof source.updatedAt === "string" ? source.updatedAt : "") || undefined,
    }),
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
      escalation: createDefaultAutonomousWorkflowRecommendationEscalationState(),
      handoff: createDefaultAutonomousWorkflowRecommendationHandoffState(),
      coding: createDefaultAutonomousWorkflowCodingState(),
      taskChain: createDefaultAutonomousWorkflowTaskChainState(),
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
    oversight: {
      summary: {
        sessionId: normalizeText(source.sessionId),
        startTime: normalizeText(typeof source.createdAt === "string" ? source.createdAt : "") || createTimestamp(),
        endTime: normalizeText(typeof source.updatedAt === "string" ? source.updatedAt : "") || createTimestamp(),
        tasksAttempted: 0,
        tasksCompleted: 0,
        tasksBlocked: 0,
        tasksFailed: 0,
        approvalsRequested: 0,
        approvalsExecuted: 0,
        currentPauseReason: "No pause reason is currently recorded.",
        recommendedNextStep: "No recommended next step is currently recorded.",
        currentFeatureId: undefined,
        currentFeatureTitle: undefined,
        currentFeatureProgress: undefined,
        completedFeatures: 0,
        blockedFeatures: 0,
        keyFilesOrAssetsChanged: [],
        validationSummary: "No validation summary is currently recorded.",
        safeToResume: false,
      },
      operatorAttention: [],
      controls: [],
      taskReviews: [],
      currentFeatureId: undefined,
      currentFeatureTitle: undefined,
      featureBundles: [],
      recentCompletedTaskIds: [],
      blockedTaskIds: [],
      completedFeatureIds: [],
      blockedFeatureIds: [],
      pendingApprovalActionIds: [],
    },
    steps,
  };

  return refreshAutonomousSessionDerivedState({
    ...normalized,
    sessionLoop: normalizeAutonomousSessionLoopState(source.sessionLoop) ?? normalized.sessionLoop,
    workflowContinuity: normalizeAutonomousWorkflowContinuityState(source.workflowContinuity) ?? deriveAutonomousWorkflowContinuity(normalized),
  });
}

export function buildAutonomousSessionContextBlock(session: AutonomousSession, limit = 4): string {
  const recentSteps = session.steps.slice(-Math.max(1, limit));
  const lines = [
    "Autonomous session context:",
    `- Top-level goal: ${session.goal}`,
    `- Session mode: ${session.sessionMode}`,
    `- Session status: ${session.status}`,
    `- Current autonomous step: ${session.currentStepIndex}`,
    `- Session loop limits: tasks=${session.sessionLoop.maxTasksPerSession}, failures=${session.sessionLoop.maxFailuresPerSession}${typeof session.sessionLoop.maxRuntimeMs === "number" ? `, runtimeMs=${session.sessionLoop.maxRuntimeMs}` : ""}`,
  ];

  lines.push(
    `- Session loop progress: completed=${session.sessionLoop.completedTaskIds.length}, skipped=${session.sessionLoop.skippedTaskIds.length}, blocked=${session.sessionLoop.blockedTaskIds.length}, failures=${session.sessionLoop.failureCount}`,
  );

  if (session.sessionLoop.currentActiveTaskId) {
    lines.push(`- Active session task: ${session.sessionLoop.currentActiveTaskId}`);
  }

  if (session.sessionLoop.lastCompletedTaskId) {
    lines.push(`- Last completed session task: ${session.sessionLoop.lastCompletedTaskId}`);
  }

  if (session.sessionLoop.nextRecommendedTaskId) {
    lines.push(`- Next recommended session task: ${session.sessionLoop.nextRecommendedTaskId}`);
  }

  if (session.workflowContinuity.taskChain.currentFeatureId) {
    lines.push(`- Current feature bundle: ${session.workflowContinuity.taskChain.currentFeatureId}`);
  }

  if (session.oversight.summary.currentFeatureProgress) {
    lines.push(`- Current feature progress: ${session.oversight.summary.currentFeatureProgress}`);
  }

  if (session.oversight.summary.completedFeatures > 0 || session.oversight.summary.blockedFeatures > 0) {
    lines.push(`- Feature bundle totals: completed=${session.oversight.summary.completedFeatures}, blocked=${session.oversight.summary.blockedFeatures}`);
  }

  if (session.sessionLoop.pauseReason) {
    lines.push(`- Session pause reason: ${session.sessionLoop.pauseReason}`);
  }

  if (session.sessionLoop.pauseSummary) {
    lines.push(`- Session pause summary: ${session.sessionLoop.pauseSummary}`);
  }

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

  lines.push(`- Recommendation escalation status: ${session.workflowContinuity.escalation.escalationStatus}`);
  lines.push(`- Recommendation recovery guidance: ${session.workflowContinuity.escalation.recoveryRecommendation}`);
  lines.push(`- Likely needs operator intervention now: ${String(session.workflowContinuity.escalation.likelyNeedsOperatorInterventionNow)}`);
  lines.push(`- Repeated ineffective review cycles: ${String(session.workflowContinuity.escalation.repeatedIneffectiveReviewCycles)}`);
  lines.push(`- Accepted recommendations repeatedly requiring correction: ${String(session.workflowContinuity.escalation.acceptedRecommendationsRepeatedlyRequiringCorrection)}`);
  lines.push(`- Redirected recommendations outperforming system: ${String(session.workflowContinuity.escalation.redirectedRecommendationsOutperformSystem)}`);
  lines.push(`- Returned to same ineffective recommendation state: ${String(session.workflowContinuity.escalation.returnedToSameIneffectiveState)}`);

  if (session.workflowContinuity.escalation.escalationSummary) {
    lines.push(`- Recommendation escalation summary: ${session.workflowContinuity.escalation.escalationSummary}`);
  }

  if (session.workflowContinuity.escalation.recoverySummary) {
    lines.push(`- Recommendation recovery summary: ${session.workflowContinuity.escalation.recoverySummary}`);
  }

  lines.push(`- Coding loop phase: ${session.workflowContinuity.coding.codingLoopPhase}`);
  lines.push(`- Coding escalation active: ${String(session.workflowContinuity.coding.escalationActive)}`);
  lines.push(`- Coding supervised recovery active: ${String(session.workflowContinuity.coding.supervisedRecoveryActive)}`);
  lines.push(`- Task chain status: ${session.workflowContinuity.taskChain.chainStatus}`);

  if (session.workflowContinuity.taskChain.currentTaskId) {
    lines.push(`- Current chained task: ${session.workflowContinuity.taskChain.currentTaskId}`);
  }

  if (session.workflowContinuity.taskChain.nextRecommendedTaskId) {
    lines.push(`- Next recommended chained task: ${session.workflowContinuity.taskChain.nextRecommendedTaskId}`);
  }

  if (session.workflowContinuity.taskChain.generatedTaskQueue.length > 0) {
    lines.push(
      `- Generated task queue: ${session.workflowContinuity.taskChain.generatedTaskQueue
        .map((task) => normalizeText([
          task.taskId,
          `status=${task.status}`,
          `priority=${task.priority}`,
          task.dependsOnTaskIds.length ? `dependsOn=${task.dependsOnTaskIds.join(",")}` : "dependsOn=none",
        ].join(" | ")))
        .join(" ; ")}`,
    );
  }

  if (session.workflowContinuity.taskChain.completedTaskIds.length > 0) {
    lines.push(`- Completed chained tasks: ${session.workflowContinuity.taskChain.completedTaskIds.join(", ")}`);
  }

  if (session.workflowContinuity.taskChain.blockedTaskIds.length > 0) {
    lines.push(`- Blocked chained tasks: ${session.workflowContinuity.taskChain.blockedTaskIds.join(", ")}`);
  }

  if (session.workflowContinuity.taskChain.skippedTaskIds.length > 0) {
    lines.push(`- Skipped chained tasks: ${session.workflowContinuity.taskChain.skippedTaskIds.join(", ")}`);
  }

  if (session.workflowContinuity.coding.targetScope) {
    lines.push(`- Coding target scope: ${session.workflowContinuity.coding.targetScope}`);
  }

  if (session.workflowContinuity.coding.currentCodingObjective) {
    lines.push(`- Current coding objective: ${session.workflowContinuity.coding.currentCodingObjective}`);
  }

  if (session.workflowContinuity.coding.currentDeliverableTarget) {
    lines.push(`- Current deliverable target: ${session.workflowContinuity.coding.currentDeliverableTarget}`);
  }

  if (session.workflowContinuity.coding.expectedOutputForm) {
    lines.push(`- Expected output form: ${session.workflowContinuity.coding.expectedOutputForm}`);
  }

  lines.push(`- Current target status: ${session.workflowContinuity.coding.currentTargetStatus}`);

  if (session.workflowContinuity.coding.validationSuccessTarget) {
    lines.push(`- Validation success target: ${session.workflowContinuity.coding.validationSuccessTarget}`);
  }

  if (session.workflowContinuity.coding.currentAcceptanceTarget) {
    lines.push(`- Current acceptance target: ${session.workflowContinuity.coding.currentAcceptanceTarget}`);
  }

  if (session.workflowContinuity.coding.validationProves) {
    lines.push(`- Validation proves: ${session.workflowContinuity.coding.validationProves}`);
  }

  lines.push(`- Validation target matches deliverable: ${String(session.workflowContinuity.coding.validationTargetMatchesDeliverable)}`);

  if (session.workflowContinuity.coding.validationFailureImpact) {
    lines.push(`- Validation failure impact: ${session.workflowContinuity.coding.validationFailureImpact}`);
  }

  lines.push(`- Correction maintains deliverable: ${String(session.workflowContinuity.coding.correctionMaintainsDeliverable)}`);
  lines.push(`- Deliverable changed during correction or escalation: ${String(session.workflowContinuity.coding.deliverableChangedDuringCorrectionOrEscalation)}`);
  lines.push(`- Deliverable accepted: ${String(session.workflowContinuity.coding.deliverableAccepted)}`);
  lines.push(`- Acceptance confidence: ${session.workflowContinuity.coding.acceptanceConfidence}`);
  lines.push(`- Completion state: ${session.workflowContinuity.coding.completionState}`);
  lines.push(`- Operator confirmation required: ${String(session.workflowContinuity.coding.operatorConfirmationRequired)}`);
  lines.push(`- Loop should terminate: ${String(session.workflowContinuity.coding.shouldTerminateLoop)}`);

  if (session.workflowContinuity.coding.acceptanceReason) {
    lines.push(`- Acceptance reason: ${session.workflowContinuity.coding.acceptanceReason}`);
  }

  if (session.workflowContinuity.coding.acceptanceSummary) {
    lines.push(`- Acceptance summary: ${session.workflowContinuity.coding.acceptanceSummary}`);
  }

  lines.push(`- Output linked to deliverable: ${String(session.workflowContinuity.coding.outputLinkedToDeliverable)}`);

  if (session.workflowContinuity.coding.lastOutputSummary) {
    lines.push(`- Last output summary: ${session.workflowContinuity.coding.lastOutputSummary}`);
  }

  if (session.workflowContinuity.coding.outputArtifacts.length > 0) {
    lines.push(
      `- Output artifacts: ${session.workflowContinuity.coding.outputArtifacts
        .map((artifact) => normalizeText([
          `step ${artifact.stepIndex}`,
          artifact.filePath,
          artifact.diffLikeSummary ? `diff=${artifact.diffLikeSummary}` : "",
          artifact.linkedToDeliverable ? "linked=true" : "linked=false",
        ].filter(Boolean).join(" | ")))
        .join(" ; ")}`,
    );
  }

  if (session.workflowContinuity.coding.repoActionSummary) {
    lines.push(`- Repo action summary: ${session.workflowContinuity.coding.repoActionSummary}`);
  }

  if (session.workflowContinuity.coding.approvalStateSummary) {
    lines.push(`- Approval state: ${session.workflowContinuity.coding.approvalStateSummary}`);
  }

  if (session.workflowContinuity.coding.integritySummary) {
    lines.push(`- Readiness guardrails: ${session.workflowContinuity.coding.integritySummary}`);
  }

  if (session.workflowContinuity.coding.pendingRepoActions.length > 0) {
    lines.push(
      `- Pending repo actions: ${session.workflowContinuity.coding.pendingRepoActions
        .map((action) => `${action.actionId} -> ${action.artifactFilePaths.join(", ")} -> ${action.executionStatus}`)
        .join(" ; ")}`,
    );
  }

  if (session.workflowContinuity.coding.approvedRepoActions.length > 0) {
    lines.push(
      `- Approved repo actions: ${session.workflowContinuity.coding.approvedRepoActions
        .map((action) => `${action.actionId} -> ${action.artifactFilePaths.join(", ")} -> ${action.executionStatus}`)
        .join(" ; ")}`,
    );
  }

  if (session.workflowContinuity.coding.executedRepoActions.length > 0) {
    lines.push(
      `- Executed repo actions: ${session.workflowContinuity.coding.executedRepoActions
        .map((action) => `${action.actionId} -> ${action.artifactFilePaths.join(", ")} -> ${action.executionStatus}`)
        .join(" ; ")}`,
    );
  }

  if (session.workflowContinuity.coding.validationTarget) {
    lines.push(`- Validation target: ${session.workflowContinuity.coding.validationTarget}`);
  }

  if (session.workflowContinuity.coding.currentValidationTarget) {
    lines.push(`- Current validation target: ${session.workflowContinuity.coding.currentValidationTarget}`);
  }

  if (session.workflowContinuity.coding.lastCodeChangeSummary) {
    lines.push(`- Last code change summary: ${session.workflowContinuity.coding.lastCodeChangeSummary}`);
  }

  if (session.workflowContinuity.coding.lastImplementationSummary) {
    lines.push(`- Last implementation summary: ${session.workflowContinuity.coding.lastImplementationSummary}`);
  }

  if (session.workflowContinuity.coding.lastValidationSummary) {
    lines.push(`- Last validation summary: ${session.workflowContinuity.coding.lastValidationSummary}`);
  }

  if (session.workflowContinuity.coding.lastValidationResultSummary) {
    lines.push(`- Last validation result summary: ${session.workflowContinuity.coding.lastValidationResultSummary}`);
  }

  if (session.workflowContinuity.coding.lastCorrectionSummary) {
    lines.push(`- Last correction summary: ${session.workflowContinuity.coding.lastCorrectionSummary}`);
  }

  lines.push(`- Validation-first coding behavior active: ${String(session.workflowContinuity.coding.validationFirstActive)}`);
  lines.push(
    `- Repeated validation failure driving escalation: ${String(session.workflowContinuity.coding.repeatedValidationFailureDrivingEscalation)}`,
  );

  if (session.workflowContinuity.coding.currentCorrectionTarget) {
    lines.push(`- Current correction target: ${session.workflowContinuity.coding.currentCorrectionTarget}`);
  }

  if (session.workflowContinuity.coding.nextIntendedCodingAction) {
    lines.push(`- Next intended coding action: ${session.workflowContinuity.coding.nextIntendedCodingAction}`);
  }

  if (session.workflowContinuity.coding.codingSummary) {
    lines.push(`- Coding loop summary: ${session.workflowContinuity.coding.codingSummary}`);
  }

  lines.push(`- Recommendation handoff status: ${session.workflowContinuity.handoff.handoffStatus}`);
  lines.push(`- Waiting on operator recovery decision: ${String(session.workflowContinuity.handoff.waitingOnOperatorDecision)}`);
  lines.push(`- Recovery execution in progress: ${String(session.workflowContinuity.handoff.recoveryExecutionInProgress)}`);
  lines.push(`- Recovery execution completed: ${String(session.workflowContinuity.handoff.recoveryExecutionCompleted)}`);
  lines.push(`- Recovery improved progress: ${String(session.workflowContinuity.handoff.recoveryImprovedProgress)}`);
  lines.push(`- Second escalation needed: ${String(session.workflowContinuity.handoff.secondEscalationNeeded)}`);

  if (session.workflowContinuity.handoff.selectedRecoveryAction) {
    lines.push(`- Selected recovery action: ${session.workflowContinuity.handoff.selectedRecoveryAction}`);
  }

  if (session.workflowContinuity.handoff.selectedRecoveryMode) {
    lines.push(`- Selected recovery mode: ${session.workflowContinuity.handoff.selectedRecoveryMode}`);
  }

  if (session.workflowContinuity.handoff.selectedRecoveryReason) {
    lines.push(`- Selected recovery reason: ${session.workflowContinuity.handoff.selectedRecoveryReason}`);
  }

  if (session.workflowContinuity.handoff.handoffSummary) {
    lines.push(`- Recommendation handoff summary: ${session.workflowContinuity.handoff.handoffSummary}`);
  }

  if (session.workflowContinuity.handoff.recoveryExecutionSummary) {
    lines.push(`- Recovery execution summary: ${session.workflowContinuity.handoff.recoveryExecutionSummary}`);
  }

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
  const shouldRecordHandoff = session.workflowContinuity.escalation.escalationStatus !== "none"
    && Boolean(requestedAction || operatorNote || overrideReason);
  const selectedRecoveryMode = deriveRecommendationHandoffRecoveryMode(
    requestedAction,
    session.workflowContinuity.escalation.recoveryRecommendation,
  );
  let nextSession: AutonomousSession = {
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
      handoff: {
        ...session.workflowContinuity.handoff,
        history: shouldRecordHandoff
          ? clampRecommendationHandoffHistoryEntries([
              ...(session.workflowContinuity.handoff.history ?? []),
              {
                initiatedAtStepIndex: session.currentStepIndex,
                escalationStatus: session.workflowContinuity.escalation.escalationStatus,
                recoveryRecommendation: session.workflowContinuity.escalation.recoveryRecommendation,
                operatorAcknowledged: true,
                selectedRecoveryAction: requestedAction,
                selectedRecoveryMode,
                operatorNote,
                overrideReason,
              },
            ])
          : session.workflowContinuity.handoff.history,
      },
    },
  };

  let derivedSession = refreshAutonomousSessionDerivedState(nextSession);

  if (
    requestedAction === "confirm-deliverable-acceptance"
    && derivedSession.workflowContinuity.coding.deliverableAccepted
    && derivedSession.workflowContinuity.coding.shouldTerminateLoop
  ) {
    const completionReason = operatorNote
      || overrideReason
      || derivedSession.workflowContinuity.coding.acceptanceReason
      || derivedSession.workflowContinuity.coding.acceptanceSummary
      || "Operator confirmed the bounded deliverable acceptance.";
    derivedSession = {
      ...derivedSession,
      status: "completed",
      completedReason: completionReason,
      stateReason: completionReason,
      latestCompletion: {
        status: "complete",
        isComplete: true,
        reason: completionReason,
        confidence: derivedSession.workflowContinuity.coding.acceptanceConfidence,
      },
    };

    derivedSession = refreshAutonomousSessionDerivedState(derivedSession);
  }

  return derivedSession;
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

  return refreshAutonomousSessionDerivedState(nextSession);
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