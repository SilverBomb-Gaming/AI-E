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
  getLatestExecutionOrchestrationStep,
  type ExecutionOrchestrationAgentId,
  type ExecutionOrchestrationAgentRole,
  type ExecutionOrchestrationPlannerDecision,
  type ExecutionOrchestrationState,
  type ExecutionOrchestrationStatus,
} from "./orchestrationSession";
import type { AnalysisInput, DryRunActionType, FreeAnalysisResponse } from "./types";

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
  orchestrationId: string | null;
  multiAgentSessionId: string | null;
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
  orchestrationState?: ExecutionOrchestrationState;
};

export const REQUIRED_TRACE_FIELDS = [
  "input",
  "sessionId",
  "stepIndex",
  "goal",
  "orchestrationId",
  "multiAgentSessionId",
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

  return {
    input: params.input,
    sessionId: params.input.sessionId?.trim() || null,
    stepIndex: Number.isInteger(params.input.stepIndex) ? params.input.stepIndex ?? null : null,
    goal: params.input.goal?.trim() || null,
    orchestrationId: params.orchestrationState?.orchestrationId?.trim() || null,
    multiAgentSessionId: params.orchestrationState?.multiAgentSessionId?.trim() || null,
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