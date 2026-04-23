import {
  appendAutonomousStep,
  buildAutonomousSessionContextBlock,
  canResumeAutonomousSession,
  clearAutonomousSessionSteering,
  countPriorAttemptsForAction,
  createAutonomousSession,
  markAwaitingApproval,
  resumeAutonomousSession,
  updateAutonomousSessionSteering,
  updateAutonomousSessionStatus,
  type AutonomousSession,
  type AutonomousSessionLoopState,
  type AutonomousSessionPauseReason,
  type AutonomousStepDecision,
  type AutonomousStepRecord,
  type AutonomousStepVerificationState,
  type AutonomousWorkflowTaskChainState,
  type UpdateAutonomousSessionSteeringParams,
} from "./autonomousSession";
import {
  buildRepoAwareAutonomousPlanningContext,
  deriveRepoAwarePlanningHintsFromSession,
  inferActionFamily,
} from "./autonomousPlanning";
import { detectAutonomousLoopStall } from "./autonomousLoopDeduper";
import {
  getAutonomousStopDecision,
  shouldStopBeforeApprovalEscalation,
} from "./autonomousLoopControl";
import { executeAction, getExecutableActionType, isExecutableAction } from "./executionRuntime";
import {
  selectExecutionAdapter,
  summarizeExecutionAdapterContext,
  type ExecutionAdapterContext,
} from "./executionAdapters";
import { buildExecutionAction } from "./executionBridge";
import {
  createRuntimeExecutionNodeDescriptor,
  getExecutionNodeCapabilitiesForAction,
  summarizeExecutionNodeCapabilities,
} from "./executionNode";
import { chooseExecutionNodeForAction, registerExecutionNode } from "./executionNodeRegistry";
import { classifyExecutionFailure, type FailureClassification } from "./failureClassifier";
import { doesExecutionOutputDirectlyAnswerGoal, evaluateGoalCompletion } from "./goalEvaluator";
import { runAnalysis } from "./run-analysis";
import { getRetryDecision } from "./retryPolicy";
import { getRecoveryDecision, type AutonomousRecoveryStrategy } from "./strategySwitch";
import { detectTestFiles, findRelevantFiles, resolveRepoRoot } from "./repoContext";
import { saveAutonomousSession } from "./autonomousSessionStore";
import { assignTaskToNode, enqueueTask, getRunnableTasks, listTasks, updateTaskStatus } from "./taskQueueStore";
import {
  createTaskExecutionLease,
  createTaskEnvelope,
  markTaskAssigned,
  markTaskBlocked,
  markTaskCompleted,
  markTaskFailed,
  markTaskRunning,
  summarizeTaskEnvelope,
  type TaskEnvelope,
} from "./taskEnvelope";
import type { AnalysisInput, ExecutionActionPreview, ExecutionRuntimeResult, FreeAnalysisResponse } from "./types";

type RunAutonomousSessionDependencies = {
  runAnalysis: typeof runAnalysis;
  executeAction: typeof executeAction;
  saveAutonomousSession: typeof saveAutonomousSession;
  enqueueTask: typeof enqueueTask;
  assignTaskToNode: typeof assignTaskToNode;
  listTasks: typeof listTasks;
  getRunnableTasks: typeof getRunnableTasks;
  updateTaskStatus: typeof updateTaskStatus;
};

type RunAutonomousSessionParams = {
  goal: string;
  maxSteps?: number;
  maxTasksPerSession?: number;
  maxFailuresPerSession?: number;
  maxRuntimeMs?: number;
  approved?: boolean;
  steering?: UpdateAutonomousSessionSteeringParams;
  clearSteering?: boolean;
  existingSession?: AutonomousSession;
  queuedTask?: TaskEnvelope;
  executionContext?: Partial<ExecutionAdapterContext>;
  dependencies?: Partial<RunAutonomousSessionDependencies>;
};

type SingleAutonomousStepResult = {
  nextSession: AutonomousSession;
  analysis: FreeAnalysisResponse;
  executionResult: ExecutionRuntimeResult;
  step: AutonomousStepRecord;
  goalEvaluation: ReturnType<typeof evaluateGoalCompletion>;
  failureClassification?: FailureClassification;
  recoveryStrategy?: AutonomousRecoveryStrategy;
  retryAction?: ExecutionActionPreview;
  retryCount?: number;
  pendingApprovalAction?: ExecutionActionPreview;
};

type ForcedContinuationState = {
  action: ExecutionActionPreview;
  attemptCount: number;
  reason: string;
  mode: "retry" | "resume-approved" | "chain-next-task";
  taskEnvelope?: TaskEnvelope;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveDependencies(
  dependencies: Partial<RunAutonomousSessionDependencies> | undefined,
): RunAutonomousSessionDependencies {
  return {
    runAnalysis: dependencies?.runAnalysis ?? runAnalysis,
    executeAction: dependencies?.executeAction ?? executeAction,
    saveAutonomousSession: dependencies?.saveAutonomousSession ?? saveAutonomousSession,
    enqueueTask: dependencies?.enqueueTask ?? enqueueTask,
    assignTaskToNode: dependencies?.assignTaskToNode ?? assignTaskToNode,
    listTasks: dependencies?.listTasks ?? listTasks,
    getRunnableTasks: dependencies?.getRunnableTasks ?? getRunnableTasks,
    updateTaskStatus: dependencies?.updateTaskStatus ?? updateTaskStatus,
  };
}

function applyTaskChainState(
  session: AutonomousSession,
  taskChain: AutonomousWorkflowTaskChainState,
): AutonomousSession {
  return {
    ...session,
    workflowContinuity: {
      ...session.workflowContinuity,
      taskChain,
    },
  };
}

function applySessionLoopState(
  session: AutonomousSession,
  sessionLoop: AutonomousSessionLoopState,
): AutonomousSession {
  return {
    ...session,
    sessionLoop,
  };
}

function clampSessionMaxTasks(value: unknown, fallback: number): number {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? Math.max(1, Math.min(10, Math.floor(numericValue))) : fallback;
}

function clampSessionMaxFailures(value: unknown, fallback: number): number {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? Math.max(1, Math.min(3, Math.floor(numericValue))) : fallback;
}

function clampSessionRuntimeMs(value: unknown): number | undefined {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return undefined;
  }

  return Math.max(1_000, Math.min(8 * 60 * 60 * 1_000, Math.floor(numericValue)));
}

function mergeUniqueTaskIds(...lists: Array<string[] | undefined>): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []).filter(Boolean))];
}

function getLastCompletedTaskId(queuedTasks: TaskEnvelope[], fallback?: string): string | undefined {
  return [...queuedTasks]
    .filter((task) => task.status === "completed")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))
    .map((task) => task.taskId)[0] ?? fallback;
}

function buildSessionLoopSnapshot(params: {
  session: AutonomousSession;
  queuedTasks: TaskEnvelope[];
  runnableTasks: TaskEnvelope[];
  currentTaskId?: string;
  nextRecommendedTaskId?: string;
  failureCount?: number;
  skippedTaskIds?: string[];
  clearPauseState?: boolean;
  pauseReason?: AutonomousSessionPauseReason;
  pauseSummary?: string;
  lastCompletedTaskId?: string;
  maxTasksPerSession?: number;
  maxFailuresPerSession?: number;
  maxRuntimeMs?: number;
}): AutonomousSessionLoopState {
  const previous = params.session.sessionLoop;
  const skippedTaskIds = mergeUniqueTaskIds(previous.skippedTaskIds, params.skippedTaskIds);
  const completedTaskIds = mergeUniqueTaskIds(
    previous.completedTaskIds,
    params.queuedTasks.filter((task) => task.status === "completed").map((task) => task.taskId),
  );
  const blockedTaskIds = mergeUniqueTaskIds(
    previous.blockedTaskIds,
    params.queuedTasks
      .filter((task) => (task.status === "blocked" || task.status === "failed" || task.status === "rejected") && !skippedTaskIds.includes(task.taskId))
      .map((task) => task.taskId),
  );

  return {
    sessionStartedAt: previous.sessionStartedAt,
    lastUpdatedAt: new Date().toISOString(),
    maxTasksPerSession: clampSessionMaxTasks(params.maxTasksPerSession, previous.maxTasksPerSession),
    maxFailuresPerSession: clampSessionMaxFailures(params.maxFailuresPerSession, previous.maxFailuresPerSession),
    maxRuntimeMs: params.maxRuntimeMs === undefined ? previous.maxRuntimeMs : clampSessionRuntimeMs(params.maxRuntimeMs),
    completedTaskIds,
    skippedTaskIds,
    blockedTaskIds,
    failureCount: typeof params.failureCount === "number" ? Math.max(0, Math.floor(params.failureCount)) : previous.failureCount,
    currentActiveTaskId: normalizeText(params.currentTaskId) || undefined,
    lastCompletedTaskId: normalizeText(params.lastCompletedTaskId) || getLastCompletedTaskId(params.queuedTasks, previous.lastCompletedTaskId),
    nextRecommendedTaskId: normalizeText(params.nextRecommendedTaskId) || undefined,
    pauseReason: params.clearPauseState ? undefined : params.pauseReason ?? previous.pauseReason,
    pauseSummary: params.clearPauseState ? undefined : params.pauseSummary ?? previous.pauseSummary,
  };
}

function getSessionRuntimeMs(session: AutonomousSession): number {
  const startedAt = Date.parse(session.sessionLoop.sessionStartedAt);
  const updatedAt = Date.parse(session.updatedAt || session.sessionLoop.lastUpdatedAt);
  if (Number.isNaN(startedAt) || Number.isNaN(updatedAt)) {
    return 0;
  }

  return Math.max(0, updatedAt - startedAt);
}

function getSessionLimitPauseState(session: AutonomousSession): { reason: AutonomousSessionPauseReason; summary: string } | null {
  if (session.sessionLoop.completedTaskIds.length >= session.sessionLoop.maxTasksPerSession) {
    return {
      reason: "max-tasks-reached",
      summary: `The autonomous session reached its bounded limit of ${session.sessionLoop.maxTasksPerSession} completed tasks.`,
    };
  }

  if (session.sessionLoop.failureCount >= session.sessionLoop.maxFailuresPerSession) {
    return {
      reason: "max-failures-reached",
      summary: `The autonomous session reached its bounded limit of ${session.sessionLoop.maxFailuresPerSession} failed tasks.`,
    };
  }

  if (typeof session.sessionLoop.maxRuntimeMs === "number" && getSessionRuntimeMs(session) >= session.sessionLoop.maxRuntimeMs) {
    return {
      reason: "max-runtime-reached",
      summary: `The autonomous session reached its bounded runtime limit of ${session.sessionLoop.maxRuntimeMs} ms.`,
    };
  }

  return null;
}

function sortTaskChainBacklog(left: TaskEnvelope, right: TaskEnvelope): number {
  return right.priority - left.priority
    || left.createdAt.localeCompare(right.createdAt)
    || left.taskId.localeCompare(right.taskId);
}

function buildTaskChainSnapshot(params: {
  session: AutonomousSession;
  queuedTasks: TaskEnvelope[];
  runnableTasks: TaskEnvelope[];
  currentTaskId?: string;
  nextRecommendedTaskId?: string;
  chainStatus?: AutonomousWorkflowTaskChainState["chainStatus"];
  skippedTaskIds?: string[];
}): AutonomousWorkflowTaskChainState {
  const orderedTasks = [...params.queuedTasks].sort(sortTaskChainBacklog);
  const previous = params.session.workflowContinuity.taskChain;
  const skippedTaskIds = mergeUniqueTaskIds(previous.skippedTaskIds, params.skippedTaskIds);
  const completedTaskIds = orderedTasks
    .filter((task) => task.status === "completed")
    .map((task) => task.taskId);
  const blockedTaskIds = orderedTasks
    .filter((task) => task.status === "blocked" || task.status === "failed" || task.status === "rejected")
    .map((task) => task.taskId);
  const currentTaskId = normalizeText(params.currentTaskId) || undefined;
  const nextRecommendedTaskId = normalizeText(params.nextRecommendedTaskId) || undefined;
  const chainStatus = params.chainStatus
    ?? (params.session.status === "awaiting-approval"
      ? "awaiting-approval"
      : params.session.status === "blocked" || params.session.status === "failed"
        ? "blocked"
        : currentTaskId && params.session.taskStatus === "completed"
          ? "validating-task"
          : currentTaskId
            ? "executing-task"
            : nextRecommendedTaskId
              ? "selecting-next-task"
              : orderedTasks.length > 0 && orderedTasks.every((task) => completedTaskIds.includes(task.taskId) || blockedTaskIds.includes(task.taskId) || skippedTaskIds.includes(task.taskId))
                ? "completed"
                : "idle");

  return {
    generatedTaskQueue: orderedTasks.map((task) => ({
      taskId: task.taskId,
      priority: task.priority,
      dependsOnTaskIds: [...task.dependsOnTaskIds],
      status: skippedTaskIds.includes(task.taskId) ? "skipped" : task.status,
    })),
    currentTaskId,
    completedTaskIds,
    blockedTaskIds,
    skippedTaskIds,
    nextRecommendedTaskId,
    chainStatus,
  };
}

async function syncTaskChainState(
  session: AutonomousSession,
  dependencies: RunAutonomousSessionDependencies,
  overrides?: {
    currentTaskId?: string;
    nextRecommendedTaskId?: string;
    chainStatus?: AutonomousWorkflowTaskChainState["chainStatus"];
    failureCount?: number;
    skippedTaskIds?: string[];
    clearPauseState?: boolean;
    pauseReason?: AutonomousSessionPauseReason;
    pauseSummary?: string;
    lastCompletedTaskId?: string;
    maxTasksPerSession?: number;
    maxFailuresPerSession?: number;
    maxRuntimeMs?: number;
  },
): Promise<AutonomousSession> {
  const allTasks = (await dependencies.listTasks())
    .filter((task) => task.sessionId === session.sessionId)
    .sort(sortTaskChainBacklog);
  const runnableTasks = (await dependencies.getRunnableTasks())
    .filter((task) => task.sessionId === session.sessionId)
    .sort(sortTaskChainBacklog);

  const nextRecommendedTaskId = overrides?.nextRecommendedTaskId ?? runnableTasks[0]?.taskId;
  const nextSession = applyTaskChainState(
    session,
    buildTaskChainSnapshot({
      session,
      queuedTasks: allTasks,
      runnableTasks,
      currentTaskId: overrides?.currentTaskId,
      nextRecommendedTaskId,
      chainStatus: overrides?.chainStatus,
      skippedTaskIds: overrides?.skippedTaskIds,
    }),
  );

  return applySessionLoopState(
    nextSession,
    buildSessionLoopSnapshot({
      session: nextSession,
      queuedTasks: allTasks,
      runnableTasks,
      currentTaskId: overrides?.currentTaskId,
      nextRecommendedTaskId,
      failureCount: overrides?.failureCount,
      skippedTaskIds: overrides?.skippedTaskIds,
      clearPauseState: overrides?.clearPauseState,
      pauseReason: overrides?.pauseReason,
      pauseSummary: overrides?.pauseSummary,
      lastCompletedTaskId: overrides?.lastCompletedTaskId,
      maxTasksPerSession: overrides?.maxTasksPerSession,
      maxFailuresPerSession: overrides?.maxFailuresPerSession,
      maxRuntimeMs: overrides?.maxRuntimeMs,
    }),
  );
}

async function selectNextQueuedTask(
  session: AutonomousSession,
  dependencies: RunAutonomousSessionDependencies,
): Promise<TaskEnvelope | null> {
  const skippedTaskIds = new Set(session.workflowContinuity.taskChain.skippedTaskIds);
  const runnableTasks = (await dependencies.getRunnableTasks())
    .filter((task) => task.sessionId === session.sessionId)
    .sort(sortTaskChainBacklog);

  return runnableTasks.find((task) => task.taskId !== session.taskId && !skippedTaskIds.has(task.taskId)) ?? null;
}

async function classifySessionQueueState(
  session: AutonomousSession,
  dependencies: RunAutonomousSessionDependencies,
): Promise<{
  reason: AutonomousSessionPauseReason;
  summary: string;
  chainStatus: AutonomousWorkflowTaskChainState["chainStatus"];
}> {
  const allTasks = (await dependencies.listTasks())
    .filter((task) => task.sessionId === session.sessionId)
    .sort(sortTaskChainBacklog);
  const runnableTasks = (await dependencies.getRunnableTasks())
    .filter((task) => task.sessionId === session.sessionId)
    .sort(sortTaskChainBacklog);
  const skippedTaskIds = new Set(session.sessionLoop.skippedTaskIds);
  const remainingTasks = allTasks.filter((task) => !skippedTaskIds.has(task.taskId));
  const pendingLikeTasks = remainingTasks.filter((task) =>
    task.status === "pending"
    || task.status === "queued"
    || task.status === "retrying"
    || task.status === "assigned"
    || task.status === "running",
  );
  const blockedTasks = remainingTasks.filter((task) =>
    task.status === "blocked"
    || task.status === "failed"
    || task.status === "rejected",
  );

  if (runnableTasks.length > 0) {
    return {
      reason: "session-limit-reached",
      summary: "The autonomous session paused even though runnable work remains.",
      chainStatus: "selecting-next-task",
    };
  }

  if (!remainingTasks.length || remainingTasks.every((task) => task.status === "completed")) {
    return {
      reason: "all-tasks-complete",
      summary: "All queued tasks for this autonomous session are complete or intentionally skipped.",
      chainStatus: "completed",
    };
  }

  if (blockedTasks.length > 0 && pendingLikeTasks.length === 0) {
    return {
      reason: "all-tasks-blocked",
      summary: "The remaining queued tasks are blocked, failed, or rejected, so autonomous continuation paused for inspection.",
      chainStatus: "blocked",
    };
  }

  const completedTaskIds = new Set(remainingTasks.filter((task) => task.status === "completed").map((task) => task.taskId));
  const dependencyMissing = pendingLikeTasks.some((task) => task.dependsOnTaskIds.some((dependencyId) => !completedTaskIds.has(dependencyId)));
  if (dependencyMissing) {
    return {
      reason: "dependency-missing",
      summary: "No queued task is runnable because at least one remaining task is still waiting on unmet dependencies.",
      chainStatus: "blocked",
    };
  }

  return {
    reason: "all-tasks-blocked",
    summary: "No queued task is currently runnable, so autonomous continuation paused for operator review.",
    chainStatus: "blocked",
  };
}

function buildAutonomousAnalysisInput(session: AutonomousSession, planningContext: string): AnalysisInput {
  const latestActionResult = normalizeText(session.latestExecutionResult?.output) || normalizeText(session.latestExecutionResult?.error);
  const contextSections = [
    buildAutonomousSessionContextBlock(session),
    planningContext,
    [
      "Autonomous execution contract:",
      "- Propose one bounded executable next step that fits the existing adapters only: inspection, validation-check, file-write, or test-run.",
      "- Prefer a safe inspection, validation, or test action before a broader write when a direct bounded check is available.",
      "- Do not widen into a raw shell command, generic code-change request, or unsupported action when an adapter-backed step can move the goal forward.",
      "- If a caution-scoped file write is truly required, keep it bounded and approval-aware instead of pretending it is safe.",
    ].join("\n"),
  ].filter(Boolean);

  return {
    problemDescription: session.goal,
    context: contextSections.join("\n\n"),
    actionResult: latestActionResult || undefined,
    sessionId: session.sessionId,
    stepIndex: session.currentStepIndex,
    goal: session.goal,
  };
}

function buildUnsupportedAutonomousExecutionResult(action: ExecutionActionPreview | undefined): ExecutionRuntimeResult {
  if (!action) {
    return {
      status: "blocked",
      error: "missing bounded action",
      output: "AI-E paused autonomous continuation because the analysis did not produce a safe bounded step.",
    };
  }

  if (action.requiresApproval === true && action.scope !== "safe") {
    return {
      status: "blocked",
      error: "manual approval required",
      output: "AI-E paused this autonomous session because the next action is outside the safe auto-execution boundary and still requires manual approval.",
    };
  }

  return {
    status: "blocked",
    error: "unsupported autonomous action",
    output: "AI-E blocked this autonomous step because it is outside the safe bounded runtime.",
  };
}

function classifyAutonomousVerificationState(params: {
  diagnosis: string;
  executionResult: ExecutionRuntimeResult;
  goalEvaluation: ReturnType<typeof evaluateGoalCompletion>;
}): AutonomousStepVerificationState {
  if (params.goalEvaluation.isComplete) {
    return "confirmed";
  }

  if (params.executionResult.status === "blocked" || params.executionResult.status === "failed") {
    return "falsified";
  }

  if (/\b(?:contradict|not the cause|did not affect|no effect|unchanged|falsified)\b/i.test(params.diagnosis)) {
    return "falsified";
  }

  if (/\b(?:confirmed|leading cause|clearly|resolved|fixed|complete)\b/i.test(params.diagnosis)) {
    return "confirmed";
  }

  return "inconclusive";
}

function decideAutonomousNextAction(params: {
  verificationState: AutonomousStepVerificationState;
  executionResult: ExecutionRuntimeResult;
  goalEvaluation: ReturnType<typeof evaluateGoalCompletion>;
  recoveryStrategy?: AutonomousRecoveryStrategy;
}): AutonomousStepDecision {
  if (params.goalEvaluation.isComplete) {
    return "stop";
  }

  if (params.recoveryStrategy === "stop") {
    return "stop";
  }

  if (params.recoveryStrategy === "retry-same-action") {
    return "continue";
  }

  if (params.recoveryStrategy) {
    return "reroute";
  }

  if (params.executionResult.status === "blocked") {
    return "stop";
  }

  if (params.executionResult.status === "failed" || params.verificationState === "falsified") {
    return "reroute";
  }

  return "continue";
}

function shouldStopAutonomousSession(params: {
  session: AutonomousSession;
  latestExecutionResult: ExecutionRuntimeResult;
  goalEvaluation: ReturnType<typeof evaluateGoalCompletion>;
  latestFailureClassification?: FailureClassification;
  latestRecoveryStrategy?: AutonomousRecoveryStrategy;
}) {
  return getAutonomousStopDecision({
    session: params.session,
    latestExecutionResult: params.latestExecutionResult,
    goalEvaluation: params.goalEvaluation,
    latestFailureClassification: params.latestFailureClassification,
    latestRecoveryStrategy: params.latestRecoveryStrategy,
  });
}

function summarizeExecutionObservation(executionResult: ExecutionRuntimeResult): string {
  return normalizeText(executionResult.output) || normalizeText(executionResult.error) || "no execution output recorded";
}

function summarizeExecutionTarget(params: {
  action?: ExecutionActionPreview;
  executionResult?: ExecutionRuntimeResult;
}): string | undefined {
  const actionTarget = normalizeText(params.action?.metadata?.targetPath);
  if (actionTarget) {
    return actionTarget;
  }

  return normalizeText(params.executionResult?.changedPaths?.[0]) || undefined;
}

function isReadOnlyExecutionAction(action: ExecutionActionPreview | undefined): boolean {
  if (!action) {
    return false;
  }

  return action.type === "inspection" || action.type === "validation-check" || action.type === "test-run";
}

function buildStoredCompletionGoalEvaluation(session: AutonomousSession): ReturnType<typeof evaluateGoalCompletion> {
  const latestCompletion = session.latestCompletion;
  return {
    status: latestCompletion?.status === "complete" ? "complete" : "needs-verification",
    isComplete: latestCompletion?.status === "complete",
    reason:
      latestCompletion?.reason ||
      "The prior bounded safe evidence already sufficiently answered the goal, so broader follow-up is unnecessary.",
    confidence: latestCompletion?.confidence === "high" ? "high" : "medium",
    safeEvidenceSufficient: true,
    followUpUnnecessary: true,
    outputDirectlyAnswersGoal: true,
  };
}

function buildRepoCodingAcceptanceGoalEvaluation(session: AutonomousSession): ReturnType<typeof evaluateGoalCompletion> {
  return {
    status: "complete",
    isComplete: true,
    reason:
      session.workflowContinuity.coding.acceptanceReason
      || session.workflowContinuity.coding.acceptanceSummary
      || "The repo deliverable satisfied its bounded acceptance criteria.",
    confidence: session.workflowContinuity.coding.acceptanceConfidence === "high" ? "high" : "medium",
    safeEvidenceSufficient: true,
    followUpUnnecessary: true,
    outputDirectlyAnswersGoal: true,
  };
}

function buildRepoActionApprovalGoalEvaluation(session: AutonomousSession): ReturnType<typeof evaluateGoalCompletion> {
  return {
    status: "needs-verification",
    isComplete: false,
    reason:
      session.workflowContinuity.coding.repoActionSummary
      || "The accepted repo output now requires explicit approval for the bounded repo action before final completion.",
    confidence: "medium",
    safeEvidenceSufficient: true,
    followUpUnnecessary: false,
    outputDirectlyAnswersGoal: false,
  };
}

function buildSyntheticContinuationAnalysis(state: ForcedContinuationState): FreeAnalysisResponse {
  return {
    what_happened:
      state.mode === "resume-approved"
        ? `AI-E resumed the stored bounded session after explicit approval for the pending action. ${state.reason}`
        : `AI-E retried the same bounded action after classifying the previous failure as transient. ${state.reason}`,
    what_matters: [state.reason],
    what_to_do_next: [
      state.mode === "resume-approved"
        ? "Execute the already-approved bounded step before generating a new plan."
        : "Observe whether the bounded retry changes the outcome before widening scope.",
    ],
    upgrade_hint: "",
    proposedAction: state.action.description,
    expectedOutcome: state.action.expectedOutcome,
    execution: state.action,
  };
}

function isRepoOrCodebaseGoal(goal: string): boolean {
  return /\b(?:repo|repository|file|files|test|tests|spec|trace|build|type|types|interface|interfaces|export|exports|module|modules|path|paths|directory|directories|entrypoint|entry point|summari[sz]e|locate|find|inspect|read|verify it runs)\b/i.test(
    normalizeText(goal),
  );
}

function looksGameplayDomainDrift(value: string): boolean {
  return /\b(?:initialization-order|execution-order|dependent binding|upstream state|awake|onenable|scene load|duplicate writer|ownership\/reference|projectile|prefab|lifecycle|symptom appears|same subsystem)\b/i.test(
    normalizeText(value),
  );
}

function goalRequestsTestExecution(goal: string): boolean {
  return /\b(?:test|tests|spec|trace|build|npm test|verify it runs|confirm it runs|run it)\b/i.test(normalizeText(goal));
}

function rankAutonomousTestTarget(goal: string, targetPath: string): number {
  const normalizedGoal = normalizeText(goal).toLowerCase();
  const normalizedPath = normalizeText(targetPath).replace(/\\/g, "/").toLowerCase();
  let score = 0;

  if (/^web\/lib\/aie\/.+\.(?:test|spec)\.ts$/i.test(normalizedPath)) {
    score += 10;
  } else if (/^web\/.+\.(?:test|spec)\.ts$/i.test(normalizedPath)) {
    score += 7;
  }

  if (/\.(?:test|spec)\.tsx$/i.test(normalizedPath)) {
    score -= 6;
  }

  if (/\/components\//i.test(normalizedPath) || /^web\/components\//i.test(normalizedPath)) {
    score -= 4;
  }

  if (/\/app\//i.test(normalizedPath) || /^web\/app\//i.test(normalizedPath)) {
    score -= 2;
  }

  const goalTerms = normalizeText(goal)
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9-]+/g)?.filter((term) => term.length >= 4) ?? [];
  for (const term of goalTerms) {
    if (normalizedPath.includes(term)) {
      score += 2;
    }
  }

  if (/\blocate a test file\b|\bverify it runs\b/.test(normalizedGoal)) {
    score += /(?:retrypolicy|goalEvaluator|executionBridge|repoContext|runTestExecution)\.test\.ts$/i.test(normalizedPath) ? 1 : 0;
  }

  return score;
}

function choosePreferredAutonomousTestTarget(goal: string, candidates: string[]): string | undefined {
  return [...new Set(candidates)]
    .filter(Boolean)
    .sort((left, right) => rankAutonomousTestTarget(goal, right) - rankAutonomousTestTarget(goal, left) || left.localeCompare(right))[0];
}

async function buildRepoGoalFallbackAction(params: {
  goal: string;
  repoRoot?: string;
  recentChangedPaths: string[];
}): Promise<ExecutionActionPreview | undefined> {
  if (!params.repoRoot || !isRepoOrCodebaseGoal(params.goal)) {
    return undefined;
  }

  const relevantFiles = await findRelevantFiles(params.goal, params.repoRoot, {
    recentChangedPaths: params.recentChangedPaths,
  });
  const relevantPaths = relevantFiles.map((file) => file.path);
  const relatedTestFiles = [
    ...new Set(relevantFiles.flatMap((file) => file.pairedTestFiles).concat(relevantPaths.filter((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file)))),
  ];

  if (goalRequestsTestExecution(params.goal)) {
    const testTarget = choosePreferredAutonomousTestTarget(
      params.goal,
      relatedTestFiles.concat(await detectTestFiles(params.repoRoot)),
    );

    if (testTarget) {
      return buildExecutionAction({
        proposedAction: `Run the bounded test file ${testTarget}.`,
        actionType: "test-run",
        expectedOutcome: `The bounded test file ${testTarget} should pass.`,
        context: params.goal,
        metadata: {
          testTarget,
        },
      });
    }
  }

  const inspectionTargets = relevantPaths.slice(0, 3);
  if (!inspectionTargets.length) {
    return undefined;
  }

  return buildExecutionAction({
    proposedAction: `Inspect ${inspectionTargets.join(", ")} and summarize the relevant types, exports, or file role for this goal.`,
    actionType: "inspection",
    expectedOutcome: "The bounded inspection should surface the relevant files and summary details for the requested repo goal.",
    context: params.goal,
    metadata: {
      targetPath: inspectionTargets[0],
    },
  });
}

function buildRepoFallbackAnalysis(action: ExecutionActionPreview, goal: string): FreeAnalysisResponse {
  return {
    what_happened: `The repo-aware fallback kept the autonomous plan aligned to the requested codebase goal: ${goal}`,
    what_matters: ["The next step should stay inside the bounded repo adapters and remain specific to the requested files or tests."],
    what_to_do_next: ["Execute the bounded repo-aware step before asking for a broader change."],
    upgrade_hint: "",
    proposedAction: action.description,
    expectedOutcome: action.expectedOutcome,
    execution: action,
  };
}

async function runSingleAutonomousStep(params: {
  session: AutonomousSession;
  dependencies: RunAutonomousSessionDependencies;
  executionContext: ExecutionAdapterContext;
  continuationState?: ForcedContinuationState;
}): Promise<SingleAutonomousStepResult> {
  const repoRoot = params.executionContext.repoRoot ?? await resolveRepoRoot(params.executionContext.cwd ?? process.cwd());
  const planningContext = await buildRepoAwareAutonomousPlanningContext(params.session, {
    repoRoot,
  });
  const analysis = params.continuationState
    ? buildSyntheticContinuationAnalysis(params.continuationState)
    : await params.dependencies.runAnalysis(buildAutonomousAnalysisInput(params.session, planningContext));
  const recentChangedPaths = params.session.steps.flatMap((step) => step.executionResult?.changedPaths ?? []);
  const repoFallbackAction = !params.continuationState?.action && isRepoOrCodebaseGoal(params.session.goal)
    ? await buildRepoGoalFallbackAction({
        goal: params.session.goal,
        repoRoot,
        recentChangedPaths,
      })
    : undefined;
  const shouldUseRepoFallback = Boolean(
    repoFallbackAction && looksGameplayDomainDrift([
      analysis.what_happened,
      analysis.proposedAction,
      analysis.what_to_do_next[0],
      analysis.execution?.description,
    ].filter(Boolean).join(" ")),
  );
  const effectiveAnalysis = shouldUseRepoFallback && repoFallbackAction
    ? buildRepoFallbackAnalysis(repoFallbackAction, params.session.goal)
    : analysis;
  const synthesizedAction = !params.continuationState?.action && !effectiveAnalysis.execution && effectiveAnalysis.proposedAction
    ? buildExecutionAction({
        proposedAction: effectiveAnalysis.proposedAction,
        actionType: effectiveAnalysis.actionType,
        expectedOutcome: effectiveAnalysis.expectedOutcome,
        context: params.session.goal,
      })
    : undefined;
  const action = params.continuationState?.action ?? effectiveAnalysis.execution ?? synthesizedAction;
  const executableActionType = getExecutableActionType(action);
  const pendingApprovalAction = action && action.requiresApproval === true && action.scope !== "safe" ? action : undefined;
  const planningHints = await deriveRepoAwarePlanningHintsFromSession(params.session, {
    nextActionText: action?.description ?? effectiveAnalysis.proposedAction,
    goal: params.session.goal,
    repoRoot,
  });
  const executionContext: ExecutionAdapterContext = {
    ...params.executionContext,
    sessionId: params.session.sessionId,
    repoRoot,
    allowedRoots: action?.metadata?.allowedRoot ? [action.metadata.allowedRoot] : params.executionContext.allowedRoots,
    allowedDirectories: action?.metadata?.allowedRoot ? [action.metadata.allowedRoot] : params.executionContext.allowedDirectories,
    adapterMetadata: {
      actionType: action?.type,
      sourceActionType: action?.metadata?.sourceActionType,
      targetPath: action?.metadata?.targetPath,
      testTarget: action?.metadata?.testTarget,
    },
  };
  const selectedAdapter = action ? selectExecutionAdapter(action, executionContext) : null;
  const adapterContextSummary = selectedAdapter ? summarizeExecutionAdapterContext(selectedAdapter.id, executionContext) : undefined;
  const registeredRuntimeNode = registerExecutionNode(
    createRuntimeExecutionNodeDescriptor({
      runtimeMode: executionContext.runtimeMode,
      cwd: executionContext.cwd,
      allowedRoots: executionContext.allowedRoots ?? executionContext.allowedDirectories,
    }),
  );
  const selectedNode = action
    ? chooseExecutionNodeForAction(action, {
        runtimeMode: executionContext.runtimeMode,
        preferredNodeId: registeredRuntimeNode.id,
        cwd: executionContext.cwd,
      }) ?? registeredRuntimeNode
    : null;
  const createdTaskEnvelope = action
    ? params.continuationState?.taskEnvelope ?? null
    : null;
  const queuedOrClaimedTaskEnvelope = createdTaskEnvelope
    ? createdTaskEnvelope
    : action
    ? await params.dependencies.enqueueTask(
        createTaskEnvelope({
          sessionId: params.session.sessionId,
          stepIndex: params.session.currentStepIndex,
          action,
          requestedCapabilities: getExecutionNodeCapabilitiesForAction(action),
          preferredNodeId: registeredRuntimeNode.id,
        }),
      )
    : null;
  const assignedTaskEnvelope = queuedOrClaimedTaskEnvelope
    ? params.continuationState?.taskEnvelope
      ? (
          queuedOrClaimedTaskEnvelope.status === "pending"
          || queuedOrClaimedTaskEnvelope.status === "queued"
          || queuedOrClaimedTaskEnvelope.status === "retrying"
            ? await params.dependencies.assignTaskToNode(queuedOrClaimedTaskEnvelope.taskId, (selectedNode ?? registeredRuntimeNode).id)
              ?? markTaskAssigned(queuedOrClaimedTaskEnvelope, (selectedNode ?? registeredRuntimeNode).id)
            : queuedOrClaimedTaskEnvelope
        )
      : await params.dependencies.assignTaskToNode(queuedOrClaimedTaskEnvelope.taskId, (selectedNode ?? registeredRuntimeNode).id)
        ?? markTaskAssigned(queuedOrClaimedTaskEnvelope, (selectedNode ?? registeredRuntimeNode).id)
    : null;
  const actionFamily = inferActionFamily(effectiveAnalysis.proposedAction ?? action?.description ?? "");
  const targetPathSummary = summarizeExecutionTarget({ action });
  const wasReadOnly = isReadOnlyExecutionAction(action);
  const canAutonomouslyExecute =
    Boolean(action) &&
    isExecutableAction(action) &&
    (params.continuationState?.mode === "resume-approved"
      ? true
      : executableActionType !== "file-write" || action?.scope === "safe");
  const stopBeforeApprovalEscalation = shouldStopBeforeApprovalEscalation({
    session: params.session,
    nextAction: action,
  });
  const runningLease = assignedTaskEnvelope && action && canAutonomouslyExecute
    ? assignedTaskEnvelope.lease?.status === "active"
      ? assignedTaskEnvelope.lease
      : createTaskExecutionLease({
          ownerNodeId: assignedTaskEnvelope.assignedNodeId ?? (selectedNode ?? registeredRuntimeNode).id,
          previousLease: assignedTaskEnvelope.lease,
          continuationToken: assignedTaskEnvelope.continuationToken,
          checkpointReference: assignedTaskEnvelope.checkpointReference,
          progressMarker: assignedTaskEnvelope.continuationGeneration > 0
            ? `shared-runner-continuation-${assignedTaskEnvelope.continuationGeneration}-start`
            : "shared-runner-start",
        })
    : assignedTaskEnvelope?.lease;
  const isContinuedQueuedTask = Boolean(assignedTaskEnvelope && assignedTaskEnvelope.continuationGeneration > 0);
  const runnerStartStatusReason = isContinuedQueuedTask
    ? `Continuing bounded task generation ${assignedTaskEnvelope?.continuationGeneration} inside the shared runner.`
    : "Executing bounded task inside the shared runner.";
  const runnerStartProgressMarker = isContinuedQueuedTask
    ? `shared-runner-continuation-${assignedTaskEnvelope?.continuationGeneration}-start`
    : "shared-runner-start";
  const runningTaskEnvelope = assignedTaskEnvelope && !stopBeforeApprovalEscalation && action && canAutonomouslyExecute
    ? await params.dependencies.updateTaskStatus(assignedTaskEnvelope.taskId, "running", {
        assignedNodeId: assignedTaskEnvelope.assignedNodeId,
        statusReason: runnerStartStatusReason,
        priorLeaseId: assignedTaskEnvelope.lease?.leaseId ?? assignedTaskEnvelope.priorLeaseId,
        lease: runningLease,
        resumability: assignedTaskEnvelope.resumability,
        continuationToken: assignedTaskEnvelope.continuationToken,
        checkpointReference: assignedTaskEnvelope.checkpointReference,
        lastProgressMarker: runnerStartProgressMarker,
        recoveryPending: false,
      }) ?? markTaskRunning(assignedTaskEnvelope, {
        assignedNodeId: assignedTaskEnvelope.assignedNodeId,
        statusReason: runnerStartStatusReason,
        priorLeaseId: assignedTaskEnvelope.lease?.leaseId ?? assignedTaskEnvelope.priorLeaseId,
        lease: runningLease,
        resumability: assignedTaskEnvelope.resumability,
        continuationToken: assignedTaskEnvelope.continuationToken,
        checkpointReference: assignedTaskEnvelope.checkpointReference,
        lastProgressMarker: runnerStartProgressMarker,
        recoveryPending: false,
      })
    : assignedTaskEnvelope;
  const executionResult = stopBeforeApprovalEscalation
    ? {
        status: "success" as const,
        output:
          "AI-E stopped before a broader approval-gated follow-up because the prior bounded safe evidence already sufficiently answered the goal.",
      }
    : action && canAutonomouslyExecute
      ? await params.dependencies.executeAction(action, executionContext)
      : buildUnsupportedAutonomousExecutionResult(action);
  const finalizedTaskStatus = stopBeforeApprovalEscalation
    ? "blocked"
    : executionResult.status === "success"
      ? "completed"
      : executionResult.status === "failed"
        ? "failed"
        : "blocked";
  const finalizedTaskReason = stopBeforeApprovalEscalation
    ? "The prior bounded evidence already answered the goal, so a broader follow-up task was stopped."
    : executionResult.status === "success"
      ? "The bounded task completed successfully."
      : executionResult.error ?? executionResult.output ?? "The bounded task did not complete successfully.";
  const finalizedTaskEnvelope = runningTaskEnvelope
    ? await params.dependencies.updateTaskStatus(runningTaskEnvelope.taskId, finalizedTaskStatus, {
        assignedNodeId: runningTaskEnvelope.assignedNodeId,
        statusReason: finalizedTaskReason,
      }) ?? (
        finalizedTaskStatus === "completed"
          ? markTaskCompleted(runningTaskEnvelope, {
              assignedNodeId: runningTaskEnvelope.assignedNodeId,
              statusReason: finalizedTaskReason,
            })
          : finalizedTaskStatus === "failed"
            ? markTaskFailed(runningTaskEnvelope, {
                assignedNodeId: runningTaskEnvelope.assignedNodeId,
                statusReason: finalizedTaskReason,
              })
            : markTaskBlocked(runningTaskEnvelope, {
                assignedNodeId: runningTaskEnvelope.assignedNodeId,
                statusReason: finalizedTaskReason,
              })
      )
    : null;
  const targetPathAfterExecution = summarizeExecutionTarget({ action, executionResult });
  const directGoalAnswer = doesExecutionOutputDirectlyAnswerGoal({
    goal: params.session.goal,
    output: executionResult.output,
    expectedOutcome: effectiveAnalysis.expectedOutcome ?? action?.expectedOutcome,
    targetPathSummary: targetPathAfterExecution,
    actionFamily,
  });
  const goalEvaluation = stopBeforeApprovalEscalation
    ? buildStoredCompletionGoalEvaluation(params.session)
    : evaluateGoalCompletion({
        goal: params.session.goal,
        latestDiagnosis: effectiveAnalysis.what_happened,
        latestExecutionResult: executionResult,
        latestExpectedOutcome: effectiveAnalysis.expectedOutcome ?? action?.expectedOutcome,
        latestActionFamily: actionFamily,
        latestExecutionAdapterId: selectedAdapter?.id,
        latestTargetPathSummary: targetPathAfterExecution,
        latestWasReadOnly: wasReadOnly,
        latestOutputDirectlyAnswersGoal: directGoalAnswer,
      });
  const proposedAction = effectiveAnalysis.proposedAction ?? action?.description;
  const failureClassification = executionResult.status === "success"
    ? undefined
    : classifyExecutionFailure({
        actionType: action?.type ?? action?.metadata?.sourceActionType ?? undefined,
        executionResult,
        latestDiagnosis: effectiveAnalysis.what_happened,
      });
  const priorAttemptsForAction = countPriorAttemptsForAction(params.session, proposedAction);
  const stallDetection = detectAutonomousLoopStall({
    priorActions: params.session.steps.map((step) => step.proposedAction ?? ""),
    priorOutputs: params.session.steps.map((step) => summarizeExecutionObservation(step.executionResult ?? { status: "blocked" })),
    nextProposedAction: proposedAction,
    latestExecutionOutput: summarizeExecutionObservation(executionResult),
  });
  const retryDecision = failureClassification
    ? getRetryDecision({
        classification: failureClassification,
        priorAttemptsForAction,
      })
    : undefined;
  const recoveryDecision = executionResult.status === "success"
    ? undefined
    : params.continuationState?.mode === "chain-next-task"
      ? { strategy: "stop" as const, reason: executionResult.error ?? executionResult.output ?? "The generated queued task failed." }
    : stallDetection.shouldStallStop
      ? { strategy: "stop" as const, reason: stallDetection.reason }
      : retryDecision?.shouldRetry
        ? { strategy: "retry-same-action" as const, reason: retryDecision.reason }
        : getRecoveryDecision({
            classification: failureClassification as FailureClassification,
            latestActionType: action?.type ?? action?.metadata?.sourceActionType ?? undefined,
            latestExecutionResult: executionResult,
            repeatedAction: stallDetection.repeatedAction,
            repeatedOutput: stallDetection.repeatedOutput,
          });
  const recoveryStrategy = params.continuationState?.mode === "retry" ? "retry-same-action" : recoveryDecision?.strategy;
  const verificationState = classifyAutonomousVerificationState({
    diagnosis: effectiveAnalysis.what_happened,
    executionResult,
    goalEvaluation,
  });
  const nextDecision = decideAutonomousNextAction({
    verificationState,
    executionResult,
    goalEvaluation,
    recoveryStrategy,
  });
  const retryCount = recoveryStrategy === "retry-same-action"
    ? params.continuationState?.attemptCount ?? retryDecision?.nextAttemptCount ?? 0
    : priorAttemptsForAction || undefined;
  let nextSession = appendAutonomousStep(params.session, {
    proposedAction,
    expectedOutcome: effectiveAnalysis.expectedOutcome ?? action?.expectedOutcome,
    executedActionPreview: action,
    actionFamily,
    executionAdapterId: selectedAdapter?.id,
    adapterContextSummary,
    executionNodeId: selectedNode?.id ?? registeredRuntimeNode.id,
    executionNodeMode: selectedNode?.mode ?? registeredRuntimeNode.mode,
    nodeCapabilitySummary: summarizeExecutionNodeCapabilities((selectedNode ?? registeredRuntimeNode).capabilities),
    selectedNodeId: finalizedTaskEnvelope?.selectedNodeId ?? finalizedTaskEnvelope?.assignedNodeId ?? selectedNode?.id ?? registeredRuntimeNode.id,
    selectedNodeReason: finalizedTaskEnvelope?.selectedNodeReason,
    taskId: finalizedTaskEnvelope?.taskId,
    taskStatus: finalizedTaskEnvelope?.status,
    assignedNodeId: finalizedTaskEnvelope?.assignedNodeId,
    queueStateSummary: finalizedTaskEnvelope ? summarizeTaskEnvelope(finalizedTaskEnvelope) : undefined,
    dispatchMessageId: finalizedTaskEnvelope?.dispatchMessageId,
    dispatchAckMessageId: finalizedTaskEnvelope?.dispatchAckMessageId,
    dispatchResultMessageId: finalizedTaskEnvelope?.dispatchResultMessageId,
    dispatchTargetNodeId: finalizedTaskEnvelope?.dispatchTargetNodeId,
    dispatchProtocolVersion: finalizedTaskEnvelope?.dispatchProtocolVersion,
    dispatchStatusSummary: finalizedTaskEnvelope?.dispatchStatusSummary,
    dispatchAuthSummary: finalizedTaskEnvelope?.dispatchAuthSummary,
    dispatchTransportStatus: finalizedTaskEnvelope?.dispatchTransportStatus,
    remoteDispatchPlanned: finalizedTaskEnvelope?.remoteDispatchPlanned,
    planningHintSummary: planningHints.hintSummary,
    executionResult,
    diagnosis: stopBeforeApprovalEscalation ? executionResult.output : effectiveAnalysis.what_happened,
    verificationState,
    nextDecision,
    failureClassification,
    failureReason: finalizedTaskEnvelope?.failureReason,
    recoveryStrategy,
    retryCount,
    repeatedAction: stallDetection.repeatedAction || undefined,
    repeatedOutput: stallDetection.repeatedOutput || undefined,
    stallReason: stallDetection.shouldStallStop ? stallDetection.reason : undefined,
    goalStatus: goalEvaluation.status,
    completionConfidence: goalEvaluation.confidence,
  });

  if (params.continuationState?.mode === "resume-approved") {
    nextSession = {
      ...nextSession,
      pendingAction: undefined,
    };
  }

  let effectiveGoalEvaluation = nextSession.workflowContinuity.coding.deliverableAccepted
    && nextSession.workflowContinuity.coding.shouldTerminateLoop
    ? buildRepoCodingAcceptanceGoalEvaluation(nextSession)
    : goalEvaluation;
  let effectivePendingApprovalAction = pendingApprovalAction;

  if (
    nextSession.workflowContinuity.coding.deliverableAccepted
    && !nextSession.workflowContinuity.coding.shouldTerminateLoop
    && !nextSession.pendingAction
  ) {
    const pendingRepoAction = nextSession.workflowContinuity.coding.pendingRepoActions.find((repoAction) => repoAction.executionPreview);
    if (pendingRepoAction?.executionPreview) {
      nextSession = markAwaitingApproval(
        nextSession,
        pendingRepoAction.executionPreview,
        pendingRepoAction.changeSummary
          || `Approve the bounded repo action for ${pendingRepoAction.artifactFilePaths.join(", ")} before final completion.`,
      );
      effectivePendingApprovalAction = pendingRepoAction.executionPreview;
      effectiveGoalEvaluation = buildRepoActionApprovalGoalEvaluation(nextSession);
    }
  }

  return {
    nextSession,
    analysis,
    executionResult,
    step: nextSession.steps.at(-1) as AutonomousStepRecord,
    goalEvaluation: effectiveGoalEvaluation,
    failureClassification,
    recoveryStrategy,
    retryAction: recoveryDecision?.strategy === "retry-same-action" ? action : undefined,
    retryCount,
    pendingApprovalAction: effectivePendingApprovalAction,
  };
}

export async function runAutonomousSession(params: RunAutonomousSessionParams): Promise<AutonomousSession> {
  const dependencies = resolveDependencies(params.dependencies);
  const cwd = params.executionContext?.cwd ?? process.cwd();
  const repoRoot = params.executionContext?.repoRoot ?? await resolveRepoRoot(cwd);
  const executionContext: ExecutionAdapterContext = {
    cwd,
    repoRoot,
    allowedRoots: params.executionContext?.allowedRoots,
    allowedDirectories: params.executionContext?.allowedDirectories,
    runtimeMode: params.executionContext?.runtimeMode ?? "web",
  };
  let session = params.existingSession
    ? {
        ...params.existingSession,
        goal: normalizeText(params.goal) || params.existingSession.goal,
        maxSteps: params.maxSteps ?? params.existingSession.maxSteps,
        sessionLoop: {
          ...params.existingSession.sessionLoop,
          maxTasksPerSession: clampSessionMaxTasks(
            params.maxTasksPerSession,
            params.existingSession.sessionLoop.maxTasksPerSession,
          ),
          maxFailuresPerSession: clampSessionMaxFailures(
            params.maxFailuresPerSession,
            params.existingSession.sessionLoop.maxFailuresPerSession,
          ),
          maxRuntimeMs: params.maxRuntimeMs === undefined
            ? params.existingSession.sessionLoop.maxRuntimeMs
            : clampSessionRuntimeMs(params.maxRuntimeMs),
        },
      }
    : createAutonomousSession({
        goal: params.goal,
        maxSteps: params.maxSteps,
        maxTasksPerSession: params.maxTasksPerSession,
        maxFailuresPerSession: params.maxFailuresPerSession,
        maxRuntimeMs: params.maxRuntimeMs,
        sessionMode: "repo-coding",
      });

  if (params.clearSteering) {
    session = clearAutonomousSessionSteering(session);
  } else if (params.steering) {
    session = updateAutonomousSessionSteering(session, params.steering);
  }

  let pendingContinuationState: ForcedContinuationState | undefined;

  if (params.existingSession) {
    if (session.status === "awaiting-approval") {
      if (!canResumeAutonomousSession(session, Boolean(params.approved))) {
        return session;
      }

      pendingContinuationState = session.pendingAction
        ? {
            action: session.pendingAction,
            attemptCount: session.latestRecoveryState?.retryCount ?? 0,
            reason: session.stateReason || "Manual approval was granted for the pending bounded action.",
            mode: "resume-approved",
            taskEnvelope: params.queuedTask,
          }
        : undefined;
      session = resumeAutonomousSession(session, {
        approved: true,
        reason: "Manual approval granted. Continuing the stored bounded autonomous session.",
      });
    } else if (session.status === "paused") {
      session = resumeAutonomousSession(session, {
        reason: "Resuming the stored bounded autonomous session.",
      });
    } else if (session.status !== "active") {
      return session;
    }
  } else if (session.status !== "active") {
    return session;
  }

  if (!pendingContinuationState && params.queuedTask) {
    pendingContinuationState = {
      action: params.queuedTask.action,
      attemptCount: 0,
      reason: `Executing queued generated task ${params.queuedTask.taskId} inside the bounded runner.`,
      mode: "chain-next-task",
      taskEnvelope: params.queuedTask,
    };
  }

  if (!pendingContinuationState) {
    const resumeQueuedTask = await selectNextQueuedTask(session, dependencies);
    if (resumeQueuedTask) {
      pendingContinuationState = {
        action: resumeQueuedTask.action,
        attemptCount: 0,
        reason: `Resuming autonomous execution with the next runnable queued task ${resumeQueuedTask.taskId}.`,
        mode: "chain-next-task",
        taskEnvelope: resumeQueuedTask,
      };
      session = {
        ...session,
        taskId: resumeQueuedTask.taskId,
        taskStatus: resumeQueuedTask.status,
        assignedNodeId: resumeQueuedTask.assignedNodeId,
        queueStateSummary: summarizeTaskEnvelope(resumeQueuedTask),
      };
    }
  }

  session = updateAutonomousSessionStatus(session, "active");
  session = await syncTaskChainState(session, dependencies, {
    currentTaskId: pendingContinuationState?.taskEnvelope?.taskId ?? session.taskId,
    chainStatus: pendingContinuationState?.taskEnvelope?.taskId ? "selecting-next-task" : undefined,
    clearPauseState: true,
    maxTasksPerSession: params.maxTasksPerSession,
    maxFailuresPerSession: params.maxFailuresPerSession,
    maxRuntimeMs: params.maxRuntimeMs,
  });
  await dependencies.saveAutonomousSession(session);

  while (session.steps.length < session.maxSteps) {
    const requestedAction = session.workflowContinuity.steering.requestedAction;
    const operatorStopRequested = requestedAction === "stop-loop" || requestedAction === "force-stop";
    if (requestedAction === "pause-and-wait" || operatorStopRequested) {
      const pauseSummary = operatorStopRequested
        ? session.workflowContinuity.steering.requestedStopReason
          || session.workflowContinuity.steering.operatorNote
          || "Operator forced the autonomous session to stop before the next bounded task."
        : session.workflowContinuity.steering.operatorNote
          || "Operator paused the autonomous session before the next bounded task.";
      session = clearAutonomousSessionSteering(session);
      session = updateAutonomousSessionStatus(session, "paused", pauseSummary);
      session = await syncTaskChainState(session, dependencies, {
        currentTaskId: undefined,
        chainStatus: operatorStopRequested ? "blocked" : "awaiting-approval",
        pauseReason: operatorStopRequested ? "operator-stopped" : "operator-paused",
        pauseSummary,
      });
      await dependencies.saveAutonomousSession(session);
      return session;
    }

    if (requestedAction === "skip-current-task") {
      const skippedTaskId = normalizeText(session.taskId);
      if (skippedTaskId) {
        await dependencies.updateTaskStatus(skippedTaskId, "rejected", {
          assignedNodeId: session.assignedNodeId,
          statusReason: session.workflowContinuity.steering.operatorNote || "Operator skipped the current task before the next bounded step.",
        });
        session = clearAutonomousSessionSteering({
          ...session,
          taskId: undefined,
          taskStatus: undefined,
          assignedNodeId: undefined,
          queueStateSummary: `Skipped queued task ${skippedTaskId}.`,
          stateReason: `Skipped queued task ${skippedTaskId} at operator request.`,
        });
        session = await syncTaskChainState(session, dependencies, {
          currentTaskId: undefined,
          skippedTaskIds: [skippedTaskId],
          clearPauseState: true,
          chainStatus: "selecting-next-task",
        });
        const nextQueuedTask = await selectNextQueuedTask(session, dependencies);
        if (nextQueuedTask) {
          pendingContinuationState = {
            action: nextQueuedTask.action,
            attemptCount: 0,
            reason: `Continue into the next generated task ${nextQueuedTask.taskId} after skipping ${skippedTaskId}.`,
            mode: "chain-next-task",
            taskEnvelope: nextQueuedTask,
          };
          session = {
            ...session,
            status: "active",
            completedReason: undefined,
            stateReason: `Continuing into generated task ${nextQueuedTask.taskId}.`,
            latestCompletion: undefined,
            pendingAction: undefined,
            taskId: nextQueuedTask.taskId,
            taskStatus: nextQueuedTask.status,
            assignedNodeId: nextQueuedTask.assignedNodeId,
            queueStateSummary: summarizeTaskEnvelope(nextQueuedTask),
          };
          session = await syncTaskChainState(session, dependencies, {
            currentTaskId: nextQueuedTask.taskId,
            nextRecommendedTaskId: undefined,
            clearPauseState: true,
            chainStatus: "selecting-next-task",
          });
          await dependencies.saveAutonomousSession(session);
          continue;
        }

        const queueState = await classifySessionQueueState(session, dependencies);
        session = updateAutonomousSessionStatus(
          session,
          queueState.reason === "all-tasks-complete" ? "completed" : "paused",
          queueState.summary,
        );
        session = await syncTaskChainState(session, dependencies, {
          currentTaskId: undefined,
          nextRecommendedTaskId: undefined,
          chainStatus: queueState.chainStatus,
          pauseReason: queueState.reason,
          pauseSummary: queueState.summary,
        });
        await dependencies.saveAutonomousSession(session);
        return session;
      }
    }

    const preStepLimitPause = getSessionLimitPauseState(session);
    if (preStepLimitPause) {
      session = updateAutonomousSessionStatus(session, "paused", preStepLimitPause.summary);
      session = await syncTaskChainState(session, dependencies, {
        currentTaskId: undefined,
        chainStatus: "blocked",
        pauseReason: preStepLimitPause.reason,
        pauseSummary: preStepLimitPause.summary,
      });
      await dependencies.saveAutonomousSession(session);
      return session;
    }

    const executedChainedTask = pendingContinuationState?.mode === "chain-next-task";
    const stepResult = await runSingleAutonomousStep({
      session,
      dependencies,
      executionContext,
      continuationState: pendingContinuationState,
    });

    session = await syncTaskChainState(stepResult.nextSession, dependencies, {
      currentTaskId: stepResult.nextSession.taskStatus === "completed" ? undefined : stepResult.nextSession.taskId,
      chainStatus: stepResult.nextSession.taskStatus === "completed" ? "validating-task" : undefined,
      failureCount: session.sessionLoop.failureCount + (stepResult.nextSession.taskStatus === "failed" ? 1 : 0),
      lastCompletedTaskId: stepResult.nextSession.taskStatus === "completed" ? stepResult.nextSession.taskId : undefined,
      clearPauseState: stepResult.nextSession.status === "active",
    });
    if (stepResult.pendingApprovalAction && session.status === "awaiting-approval") {
      session = await syncTaskChainState(session, dependencies, {
        currentTaskId: session.taskId,
        chainStatus: "awaiting-approval",
        pauseReason: "approval-required",
        pauseSummary: session.stateReason || "Approval is required before AI-E can continue the next bounded repo action.",
      });
      await dependencies.saveAutonomousSession(session);
      return session;
    }

    if (executedChainedTask && session.taskStatus === "completed") {
      const nextQueuedTask = await selectNextQueuedTask(session, dependencies);
      if (nextQueuedTask && session.steps.length < session.maxSteps) {
        const limitPause = getSessionLimitPauseState(session);
        if (limitPause) {
          session = updateAutonomousSessionStatus(session, "paused", limitPause.summary);
          session = await syncTaskChainState(session, dependencies, {
            currentTaskId: undefined,
            chainStatus: "blocked",
            pauseReason: limitPause.reason,
            pauseSummary: limitPause.summary,
          });
          await dependencies.saveAutonomousSession(session);
          return session;
        }

        pendingContinuationState = {
          action: nextQueuedTask.action,
          attemptCount: 0,
          reason: `Continue into the next generated task ${nextQueuedTask.taskId} after the prior task completed successfully.`,
          mode: "chain-next-task",
          taskEnvelope: nextQueuedTask,
        };
        session = {
          ...session,
          status: "active",
          completedReason: undefined,
          stateReason: `Continuing into generated task ${nextQueuedTask.taskId}.`,
          latestCompletion: undefined,
          pendingAction: undefined,
          taskId: nextQueuedTask.taskId,
          taskStatus: nextQueuedTask.status,
          assignedNodeId: nextQueuedTask.assignedNodeId,
          queueStateSummary: summarizeTaskEnvelope(nextQueuedTask),
        };
        session = await syncTaskChainState(session, dependencies, {
          currentTaskId: nextQueuedTask.taskId,
          nextRecommendedTaskId: undefined,
          clearPauseState: true,
          chainStatus: "selecting-next-task",
        });
        await dependencies.saveAutonomousSession(session);
        continue;
      }

      const queueState = await classifySessionQueueState(session, dependencies);
      session = updateAutonomousSessionStatus(
        session,
        queueState.reason === "all-tasks-complete" ? "completed" : "paused",
        queueState.summary,
      );
      session = await syncTaskChainState(session, dependencies, {
        currentTaskId: undefined,
        nextRecommendedTaskId: undefined,
        chainStatus: queueState.chainStatus,
        pauseReason: queueState.reason,
        pauseSummary: queueState.summary,
      });
      await dependencies.saveAutonomousSession(session);
      return session;
    }

    const stopDecision = shouldStopAutonomousSession({
      session,
      latestExecutionResult: stepResult.executionResult,
      goalEvaluation: stepResult.goalEvaluation,
      latestFailureClassification: stepResult.failureClassification,
      latestRecoveryStrategy: stepResult.recoveryStrategy,
    });

    session = stopDecision.status === "awaiting-approval" && stepResult.pendingApprovalAction
      ? markAwaitingApproval(session, stepResult.pendingApprovalAction, stopDecision.reason)
      : updateAutonomousSessionStatus(session, stopDecision.status, stopDecision.reason);
    session = await syncTaskChainState(session, dependencies, {
      pauseReason: stopDecision.status === "awaiting-approval"
        ? "approval-required"
        : stopDecision.status === "failed"
          ? "critical-task-failure"
          : stopDecision.status === "blocked"
            ? "all-tasks-blocked"
            : undefined,
      pauseSummary: stopDecision.shouldStop ? stopDecision.reason : undefined,
      clearPauseState: !stopDecision.shouldStop,
    });
    await dependencies.saveAutonomousSession(session);

    if (stopDecision.shouldStop) {
      const nextQueuedTask = stopDecision.status === "completed" && session.taskStatus === "completed"
        ? await selectNextQueuedTask(session, dependencies)
        : null;

      if (nextQueuedTask && session.steps.length < session.maxSteps) {
        const limitPause = getSessionLimitPauseState(session);
        if (limitPause) {
          session = updateAutonomousSessionStatus(session, "paused", limitPause.summary);
          session = await syncTaskChainState(session, dependencies, {
            currentTaskId: undefined,
            chainStatus: "blocked",
            pauseReason: limitPause.reason,
            pauseSummary: limitPause.summary,
          });
          await dependencies.saveAutonomousSession(session);
          return session;
        }

        pendingContinuationState = {
          action: nextQueuedTask.action,
          attemptCount: 0,
          reason: `Continue into the next generated task ${nextQueuedTask.taskId} after the prior task completed and validated successfully.`,
          mode: "chain-next-task",
          taskEnvelope: nextQueuedTask,
        };
        session = {
          ...session,
          status: "active",
          completedReason: undefined,
          stateReason: `Continuing into generated task ${nextQueuedTask.taskId}.`,
          latestCompletion: undefined,
          pendingAction: undefined,
          taskId: nextQueuedTask.taskId,
          taskStatus: nextQueuedTask.status,
          assignedNodeId: nextQueuedTask.assignedNodeId,
          queueStateSummary: summarizeTaskEnvelope(nextQueuedTask),
        };
        session = await syncTaskChainState(session, dependencies, {
          currentTaskId: nextQueuedTask.taskId,
          nextRecommendedTaskId: undefined,
          clearPauseState: true,
          chainStatus: "selecting-next-task",
        });
        await dependencies.saveAutonomousSession(session);
        continue;
      }

      return session;
    }

    const postStepLimitPause = getSessionLimitPauseState(session);
    if (postStepLimitPause) {
      session = updateAutonomousSessionStatus(session, "paused", postStepLimitPause.summary);
      session = await syncTaskChainState(session, dependencies, {
        currentTaskId: undefined,
        chainStatus: "blocked",
        pauseReason: postStepLimitPause.reason,
        pauseSummary: postStepLimitPause.summary,
      });
      await dependencies.saveAutonomousSession(session);
      return session;
    }

    pendingContinuationState = stepResult.retryAction && stepResult.recoveryStrategy === "retry-same-action"
      ? {
          action: stepResult.retryAction,
          attemptCount: stepResult.retryCount ?? 1,
          reason: stepResult.failureClassification?.reason || "Retrying the same bounded action once inside the retry policy.",
          mode: "retry",
        }
      : undefined;

    session = updateAutonomousSessionStatus(session, "active");
    session = await syncTaskChainState(session, dependencies, {
      currentTaskId: session.taskId,
      clearPauseState: true,
    });
    await dependencies.saveAutonomousSession(session);
  }

  session = updateAutonomousSessionStatus(
    session,
    "max-step-limit",
    `The autonomous run reached its bounded limit of ${session.maxSteps} steps.`,
  );
  await dependencies.saveAutonomousSession(session);
  return session;
}

export {
  buildAutonomousAnalysisInput,
  decideAutonomousNextAction,
  runSingleAutonomousStep,
  shouldStopAutonomousSession,
};