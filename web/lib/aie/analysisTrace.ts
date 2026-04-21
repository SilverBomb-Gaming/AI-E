import type {
  ActionChainIntent,
  CommitmentValidationState,
  ConfidenceAlignment,
  ConfidenceLevel,
  DebuggingMode,
  DecisionCommitment,
  LoopTerminationStatus,
  SuggestedNextAction,
} from "../../components/analysisResultLogic";
import { deriveAnalysisResultSignals } from "../../components/analysisResultLogic";
import type { FollowUpVerificationState, StoredActionChainState } from "../../components/AnalysisForm";
import { deriveDryRunActionProposal } from "./executionBridge";
import {
  getLatestExecutionOrchestrationAgentHistoryEntry,
  getLatestExecutionOrchestrationAgentHistoryEntryByRole,
  getExecutionSelfDirectionSnapshot,
  getLatestExecutionOrchestrationStep,
  summarizeExecutionSelfDirectedSubgoal,
  type ExecutionOrchestrationAgentId,
  type ExecutionOrchestrationAgentRole,
  type ExecutionOrchestrationPlannerDecision,
  type ExecutionOrchestrationState,
  type ExecutionOrchestrationStatus,
} from "./orchestrationSession";
import type { AnalysisInput, DryRunActionType, ExecutionRuntimeResult, FreeAnalysisResponse } from "./types";
import type { FailureClassification } from "./failureClassifier";
import type { GoalCompletionStatus, GoalEvaluation } from "./goalEvaluator";
import type { AutonomousActionFamily } from "./autonomousPlanning";
import type { DispatchProtocolVersion } from "./dispatchProtocol";
import type { ExecutionAdapterId } from "./executionAdapters";
import type { ExecutionNodeMode } from "./executionNode";
import type { AutonomousRecoveryStrategy } from "./strategySwitch";
import type { TaskEnvelopeStatus } from "./taskEnvelope";

export type AnalysisTraceActionChain = {
  state: "none" | "guided" | "confirmation";
  stepIndicator: string | null;
  activeStepIndex: number | null;
  totalSteps: number;
  currentIntent: ActionChainIntent | null;
  currentLabel: string | null;
  currentWatchFor: string | null;
};

export type AnalysisTraceLoop = {
  status: LoopTerminationStatus | null;
  active: boolean;
  canContinue: boolean;
  reachedLimit: boolean;
};

export type AnalysisTraceRecord = {
  input: AnalysisInput;
  sessionId: string | null;
  stepIndex: number | null;
  goal: string | null;
  autonomousSessionId: string | null;
  autonomousStepIndex: number | null;
  autonomousStatus: string | null;
  autonomousCompletedReason: string | null;
  autonomousGoalStatus: GoalCompletionStatus | null;
  autonomousCompletionConfidence: GoalEvaluation["confidence"] | null;
  autonomousPauseReason: string | null;
  autonomousAwaitingApproval: boolean | null;
  autonomousPendingActionType: string | null;
  executionAdapterId: ExecutionAdapterId | null;
  adapterContextSummary: string | null;
  executionNodeId: string | null;
  executionNodeMode: ExecutionNodeMode | null;
  nodeCapabilitySummary: string | null;
  selectedNodeId: string | null;
  taskId: string | null;
  taskStatus: TaskEnvelopeStatus | null;
  assignedNodeId: string | null;
  queueStateSummary: string | null;
  dispatchMessageId: string | null;
  dispatchAckMessageId: string | null;
  dispatchResultMessageId: string | null;
  dispatchTargetNodeId: string | null;
  dispatchProtocolVersion: DispatchProtocolVersion | null;
  dispatchStatusSummary: string | null;
  dispatchAuthSummary: string | null;
  dispatchTransportStatus: string | null;
  remoteDispatchPlanned: boolean | null;
  autonomousPlanningHintSummary: string | null;
  autonomousRecentActionFamily: AutonomousActionFamily | null;
  failureClass: FailureClassification["kind"] | null;
  failureReason: string | null;
  recoveryStrategy: AutonomousRecoveryStrategy | null;
  retryCount: number | null;
  repeatedAction: boolean | null;
  repeatedOutput: boolean | null;
  autonomousStopReason: string | null;
  orchestrationId: string | null;
  multiAgentSessionId: string | null;
  selfDirectionId: string | null;
  topLevelGoal: string | null;
  selfDirectionStatus: string | null;
  currentSubgoal: string | null;
  subgoalQueueSnapshot: string[];
  subgoalSelectionReason: string | null;
  subgoalRerouteReason: string | null;
  selfStopReason: string | null;
  selfBlockReason: string | null;
  selfPauseReason: string | null;
  orchestrationStepNumber: number | null;
  orchestrationStatus: ExecutionOrchestrationStatus | null;
  orchestrationPhase: string | null;
  agentId: ExecutionOrchestrationAgentId | null;
  agentRole: ExecutionOrchestrationAgentRole | null;
  handoffFrom: ExecutionOrchestrationAgentRole | null;
  handoffTo: ExecutionOrchestrationAgentRole | null;
  handoffPayloadSummary: string | null;
  diagnosis: string;
  actionType: DryRunActionType;
  proposedAction: string;
  executedAction: string | null;
  expectedOutcome: string;
  actionResult: string | null;
  executionNotes: string | null;
  executionResult?: ExecutionRuntimeResult;
  recommendedMode: DebuggingMode | null;
  confidenceLevel: ConfidenceLevel;
  confidenceTrend: ConfidenceAlignment | null;
  decisionCommitment: DecisionCommitment;
  commitmentValidationState: CommitmentValidationState;
  verificationState: FollowUpVerificationState | null;
  validationResult: FollowUpVerificationState | null;
  plannerDecision: ExecutionOrchestrationPlannerDecision | null;
  actionChain: AnalysisTraceActionChain;
  loop: AnalysisTraceLoop;
  suggestedNextAction: SuggestedNextAction;
  alignedSignalCount: number;
};

export type BuildAnalysisTraceRecordParams = {
  input: AnalysisInput;
  result: FreeAnalysisResponse;
  isRefined?: boolean;
  lastObservation?: string;
  verificationState?: FollowUpVerificationState;
  previousActionChainState?: StoredActionChainState;
  executedAction?: string;
  executionResult?: ExecutionRuntimeResult;
  orchestrationState?: ExecutionOrchestrationState;
  autonomousSessionId?: string;
  autonomousStepIndex?: number;
  autonomousStatus?: string;
  autonomousCompletedReason?: string;
  autonomousGoalStatus?: GoalCompletionStatus;
  autonomousCompletionConfidence?: GoalEvaluation["confidence"];
  autonomousPauseReason?: string;
  autonomousAwaitingApproval?: boolean;
  autonomousPendingActionType?: string;
  executionAdapterId?: ExecutionAdapterId;
  adapterContextSummary?: string;
  executionNodeId?: string;
  executionNodeMode?: ExecutionNodeMode;
  nodeCapabilitySummary?: string;
  selectedNodeId?: string;
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
  dispatchTransportStatus?: string;
  remoteDispatchPlanned?: boolean;
  autonomousPlanningHintSummary?: string;
  autonomousRecentActionFamily?: AutonomousActionFamily;
  failureClassification?: FailureClassification;
  failureReason?: string;
  recoveryStrategy?: AutonomousRecoveryStrategy;
  retryCount?: number;
  repeatedAction?: boolean;
  repeatedOutput?: boolean;
  autonomousStopReason?: string;
};

function normalizeExecutionRuntimeResult(result: ExecutionRuntimeResult | undefined): ExecutionRuntimeResult | undefined {
  if (!result) {
    return undefined;
  }

  const output = result.output?.trim();
  const error = result.error?.trim();
  const diffSummary = result.diffSummary?.trim();
  const commandLabel = result.commandLabel?.trim();
  const changedPaths = result.changedPaths?.map((item) => item.trim()).filter(Boolean);

  return {
    status: result.status,
    output: output || undefined,
    error: error || undefined,
    changedPaths: changedPaths?.length ? changedPaths : undefined,
    diffSummary: diffSummary || undefined,
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : undefined,
    commandLabel: commandLabel || undefined,
    rollback: result.rollback,
  };
}

export const REQUIRED_TRACE_FIELDS = [
  "input",
  "sessionId",
  "stepIndex",
  "goal",
  "orchestrationId",
  "multiAgentSessionId",
  "selfDirectionId",
  "topLevelGoal",
  "selfDirectionStatus",
  "currentSubgoal",
  "subgoalQueueSnapshot",
  "subgoalSelectionReason",
  "subgoalRerouteReason",
  "selfStopReason",
  "selfBlockReason",
  "selfPauseReason",
  "orchestrationStepNumber",
  "orchestrationStatus",
  "orchestrationPhase",
  "agentId",
  "agentRole",
  "handoffFrom",
  "handoffTo",
  "handoffPayloadSummary",
  "diagnosis",
  "actionType",
  "proposedAction",
  "executedAction",
  "expectedOutcome",
  "actionResult",
  "executionNotes",
  "recommendedMode",
  "confidenceLevel",
  "confidenceTrend",
  "decisionCommitment",
  "commitmentValidationState",
  "verificationState",
  "validationResult",
  "plannerDecision",
  "actionChain.state",
  "actionChain.stepIndicator",
  "actionChain.activeStepIndex",
  "actionChain.totalSteps",
  "actionChain.currentIntent",
  "actionChain.currentLabel",
  "actionChain.currentWatchFor",
  "loop.status",
  "loop.active",
  "loop.canContinue",
  "loop.reachedLimit",
] as const;

export function buildAnalysisTraceRecord(params: BuildAnalysisTraceRecordParams): AnalysisTraceRecord {
  const signals = deriveAnalysisResultSignals({
    result: params.result,
    problemDescription: params.input.problemDescription,
    isRefined: params.isRefined,
    lastObservation: params.lastObservation,
    verificationState: params.verificationState,
    previousActionChainState: params.previousActionChainState,
  });

  const actionChainState = signals.supervisedActionChainStepIndicator === "Confirmation mode"
    ? "confirmation"
    : signals.supervisedActionChain?.length
      ? "guided"
      : "none";
  const proposal = deriveDryRunActionProposal(params.result);
  const orchestrationStep = getLatestExecutionOrchestrationStep(params.orchestrationState);
  const latestAgentEntry = getLatestExecutionOrchestrationAgentHistoryEntry(params.orchestrationState);
  const latestPlannerEntry = getLatestExecutionOrchestrationAgentHistoryEntryByRole(params.orchestrationState, "planner");
  const latestExecutorEntry = getLatestExecutionOrchestrationAgentHistoryEntryByRole(params.orchestrationState, "executor");
  const selfDirectionState = getExecutionSelfDirectionSnapshot(params.orchestrationState);

  return {
    input: params.input,
    sessionId: params.input.sessionId?.trim() || null,
    stepIndex: Number.isInteger(params.input.stepIndex) ? params.input.stepIndex ?? null : null,
    goal: params.input.goal?.trim() || null,
    autonomousSessionId: params.autonomousSessionId?.trim() || null,
    autonomousStepIndex: Number.isInteger(params.autonomousStepIndex) ? params.autonomousStepIndex ?? null : null,
    autonomousStatus: params.autonomousStatus?.trim() || null,
    autonomousCompletedReason: params.autonomousCompletedReason?.trim() || null,
    autonomousGoalStatus: params.autonomousGoalStatus ?? null,
    autonomousCompletionConfidence: params.autonomousCompletionConfidence ?? null,
    autonomousPauseReason: params.autonomousPauseReason?.trim() || null,
    autonomousAwaitingApproval: typeof params.autonomousAwaitingApproval === "boolean" ? params.autonomousAwaitingApproval : null,
    autonomousPendingActionType: params.autonomousPendingActionType?.trim() || null,
    executionAdapterId: params.executionAdapterId ?? null,
    adapterContextSummary: params.adapterContextSummary?.trim() || null,
    executionNodeId: params.executionNodeId?.trim() || null,
    executionNodeMode: params.executionNodeMode ?? null,
    nodeCapabilitySummary: params.nodeCapabilitySummary?.trim() || null,
    selectedNodeId: params.selectedNodeId?.trim() || null,
    taskId: params.taskId?.trim() || null,
    taskStatus: params.taskStatus ?? null,
    assignedNodeId: params.assignedNodeId?.trim() || null,
    queueStateSummary: params.queueStateSummary?.trim() || null,
    dispatchMessageId: params.dispatchMessageId?.trim() || null,
    dispatchAckMessageId: params.dispatchAckMessageId?.trim() || null,
    dispatchResultMessageId: params.dispatchResultMessageId?.trim() || null,
    dispatchTargetNodeId: params.dispatchTargetNodeId?.trim() || null,
    dispatchProtocolVersion: params.dispatchProtocolVersion ?? null,
    dispatchStatusSummary: params.dispatchStatusSummary?.trim() || null,
    dispatchAuthSummary: params.dispatchAuthSummary?.trim() || null,
    dispatchTransportStatus: params.dispatchTransportStatus?.trim() || null,
    remoteDispatchPlanned: typeof params.remoteDispatchPlanned === "boolean" ? params.remoteDispatchPlanned : null,
    autonomousPlanningHintSummary: params.autonomousPlanningHintSummary?.trim() || null,
    autonomousRecentActionFamily: params.autonomousRecentActionFamily ?? null,
    failureClass: params.failureClassification?.kind ?? null,
    failureReason: params.failureReason?.trim() || null,
    recoveryStrategy: params.recoveryStrategy ?? null,
    retryCount: Number.isInteger(Number(params.retryCount)) ? Number(params.retryCount) : null,
    repeatedAction: typeof params.repeatedAction === "boolean" ? params.repeatedAction : null,
    repeatedOutput: typeof params.repeatedOutput === "boolean" ? params.repeatedOutput : null,
    autonomousStopReason: params.autonomousStopReason?.trim() || null,
    orchestrationId: params.orchestrationState?.orchestrationId?.trim() || null,
    multiAgentSessionId: params.orchestrationState?.multiAgentSessionId?.trim() || null,
    selfDirectionId: selfDirectionState?.selfDirectionId ?? null,
    topLevelGoal: selfDirectionState?.topLevelGoal ?? null,
    selfDirectionStatus: selfDirectionState?.selfDirectionStatus ?? null,
    currentSubgoal: summarizeExecutionSelfDirectedSubgoal(selfDirectionState?.currentSubgoal) ?? null,
    subgoalQueueSnapshot: selfDirectionState?.subgoalQueue.map((subgoal) => subgoal.title) ?? [],
    subgoalSelectionReason: selfDirectionState?.lastSelectionReason || null,
    subgoalRerouteReason: selfDirectionState?.lastRerouteReason || null,
    selfStopReason: selfDirectionState?.lastStopReason || null,
    selfBlockReason: selfDirectionState?.lastBlockReason || null,
    selfPauseReason: selfDirectionState?.lastPauseReason || null,
    orchestrationStepNumber: orchestrationStep?.stepNumber ?? null,
    orchestrationStatus: params.orchestrationState?.currentStatus ?? null,
    orchestrationPhase: params.orchestrationState?.currentPhase ?? null,
    agentId: latestAgentEntry?.agentId ?? null,
    agentRole: latestAgentEntry?.agentRole ?? null,
    handoffFrom: params.orchestrationState?.lastHandoff?.handoffFrom ?? null,
    handoffTo: params.orchestrationState?.lastHandoff?.handoffTo ?? null,
    handoffPayloadSummary: params.orchestrationState?.lastHandoff?.payloadSummary ?? null,
    diagnosis: params.result.what_happened,
    actionType: proposal.actionType,
    proposedAction: proposal.proposedAction,
    executedAction: params.executedAction?.trim() || latestExecutorEntry?.executedAction || orchestrationStep?.executedAction || null,
    expectedOutcome: proposal.expectedOutcome,
    actionResult: params.input.actionResult?.trim() || params.lastObservation?.trim() || null,
    executionNotes: latestExecutorEntry?.executionNotes ?? (params.orchestrationState?.executorState.executionNotes || null),
    executionResult: normalizeExecutionRuntimeResult(params.executionResult),
    recommendedMode: signals.recommendedDebuggingMode,
    confidenceLevel: signals.confidenceLevel,
    confidenceTrend: signals.confidenceAlignment,
    decisionCommitment: signals.decisionCommitment,
    commitmentValidationState: signals.commitmentValidationState,
    verificationState: params.verificationState ?? null,
    validationResult: latestExecutorEntry?.validationResult ?? params.verificationState ?? null,
    plannerDecision: latestPlannerEntry?.plannerDecision ?? null,
    actionChain: {
      state: actionChainState,
      stepIndicator: signals.supervisedActionChainStepIndicator,
      activeStepIndex: signals.supervisedActionChain?.length ? signals.supervisedActionChainActiveStepIndex : null,
      totalSteps: signals.supervisedActionChain?.length ?? 0,
      currentIntent: signals.currentSupervisedActionChainStep?.intent ?? null,
      currentLabel: signals.currentSupervisedActionChainStep?.label ?? null,
      currentWatchFor: signals.currentSupervisedActionChainStep?.watchFor ?? null,
    },
    loop: {
      status: signals.loopTerminationStatus,
      active: signals.isGuidedLoopActive,
      canContinue: signals.canContinueGuidedLoop,
      reachedLimit: signals.reachedGuidedStepLimit,
    },
    suggestedNextAction: signals.suggestedNextAction,
    alignedSignalCount: signals.alignedSignalCount,
  };
}

export function listMissingAnalysisTraceFields(trace: AnalysisTraceRecord): string[] {
  const checks: Array<[string, unknown]> = [
    ["input", trace.input],
    ["sessionId", trace.sessionId],
    ["stepIndex", trace.stepIndex],
    ["goal", trace.goal],
    ["orchestrationId", trace.orchestrationId],
    ["multiAgentSessionId", trace.multiAgentSessionId],
    ["selfDirectionId", trace.selfDirectionId],
    ["topLevelGoal", trace.topLevelGoal],
    ["selfDirectionStatus", trace.selfDirectionStatus],
    ["currentSubgoal", trace.currentSubgoal],
    ["subgoalQueueSnapshot", trace.subgoalQueueSnapshot],
    ["subgoalSelectionReason", trace.subgoalSelectionReason],
    ["subgoalRerouteReason", trace.subgoalRerouteReason],
    ["selfStopReason", trace.selfStopReason],
    ["selfBlockReason", trace.selfBlockReason],
    ["selfPauseReason", trace.selfPauseReason],
    ["orchestrationStepNumber", trace.orchestrationStepNumber],
    ["orchestrationStatus", trace.orchestrationStatus],
    ["orchestrationPhase", trace.orchestrationPhase],
    ["agentId", trace.agentId],
    ["agentRole", trace.agentRole],
    ["handoffFrom", trace.handoffFrom],
    ["handoffTo", trace.handoffTo],
    ["handoffPayloadSummary", trace.handoffPayloadSummary],
    ["diagnosis", trace.diagnosis],
    ["actionType", trace.actionType],
    ["proposedAction", trace.proposedAction],
    ["executedAction", trace.executedAction],
    ["expectedOutcome", trace.expectedOutcome],
    ["actionResult", trace.actionResult],
    ["executionNotes", trace.executionNotes],
    ["recommendedMode", trace.recommendedMode],
    ["confidenceLevel", trace.confidenceLevel],
    ["confidenceTrend", trace.confidenceTrend],
    ["decisionCommitment", trace.decisionCommitment],
    ["commitmentValidationState", trace.commitmentValidationState],
    ["verificationState", trace.verificationState],
    ["validationResult", trace.validationResult],
    ["plannerDecision", trace.plannerDecision],
    ["actionChain.state", trace.actionChain.state],
    ["actionChain.stepIndicator", trace.actionChain.stepIndicator],
    ["actionChain.activeStepIndex", trace.actionChain.activeStepIndex],
    ["actionChain.totalSteps", trace.actionChain.totalSteps],
    ["actionChain.currentIntent", trace.actionChain.currentIntent],
    ["actionChain.currentLabel", trace.actionChain.currentLabel],
    ["actionChain.currentWatchFor", trace.actionChain.currentWatchFor],
    ["loop.status", trace.loop.status],
    ["loop.active", trace.loop.active],
    ["loop.canContinue", trace.loop.canContinue],
    ["loop.reachedLimit", trace.loop.reachedLimit],
  ];

  return checks
    .filter(([, value]) => value === undefined)
    .map(([field]) => field);
}