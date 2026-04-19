import type { ExecutionSessionLoopStatus, ExecutionSessionVerificationState } from "./executionSession";

export type ExecutionOrchestrationStatus = "active" | "blocked" | "complete" | "aborted";
export type ExecutionOrchestrationPhase =
  | "identify-blocker"
  | "apply-fix"
  | "rerun-validation"
  | "recover"
  | "decide-next-step"
  | "complete"
  | "blocked"
  | "aborted";

export type ExecutionOrchestrationStepStatus = "completed" | "blocked" | "aborted";

export type ExecutionOrchestrationAgentRole = "planner" | "executor";
export type ExecutionOrchestrationAgentId = "planner-agent" | "executor-agent";
export type ExecutionOrchestrationPlannerDecision = "continue" | "reroute" | "complete" | "block";
export type ExecutionOrchestrationHandoffStatus = "pending" | "completed" | "cancelled";

export type ExecutionSelfDirectionStatus = "active" | "paused" | "blocked" | "complete" | "aborted";
export type ExecutionSelfDirectedSubgoalDisposition = "queued" | "active" | "completed" | "blocked" | "abandoned";

export const PLANNER_AGENT_ID: ExecutionOrchestrationAgentId = "planner-agent";
export const EXECUTOR_AGENT_ID: ExecutionOrchestrationAgentId = "executor-agent";

export type ExecutionSelfDirectedSubgoal = {
  subgoalId: string;
  title: string;
  proposedAction: string;
  expectedOutcome: string;
  selectionReason: string;
  priority: number;
  status: ExecutionSelfDirectedSubgoalDisposition;
  requiresUserApproval: boolean;
};

export type ExecutionSelfDirectionState = {
  selfDirectionId: string;
  topLevelGoal: string;
  subgoalQueue: ExecutionSelfDirectedSubgoal[];
  currentSubgoal: ExecutionSelfDirectedSubgoal | null;
  completedSubgoals: ExecutionSelfDirectedSubgoal[];
  blockedSubgoals: ExecutionSelfDirectedSubgoal[];
  abandonedSubgoals: ExecutionSelfDirectedSubgoal[];
  selfDirectionStatus: ExecutionSelfDirectionStatus;
  lastSelectionReason: string;
  lastRerouteReason: string;
  lastStopReason: string;
  lastBlockReason: string;
  lastPauseReason: string;
  maxSubgoals: number;
};

export type ExecutionOrchestrationAgentHistoryEntry = {
  entryNumber: number;
  stepNumber: number;
  agentId: ExecutionOrchestrationAgentId;
  agentRole: ExecutionOrchestrationAgentRole;
  summary: string;
  handoffFrom: ExecutionOrchestrationAgentRole | null;
  handoffTo: ExecutionOrchestrationAgentRole | null;
  handoffPayloadSummary: string;
  executedAction: string | null;
  actionResult: string | null;
  validationResult: ExecutionSessionVerificationState | null;
  executionNotes: string | null;
  plannerDecision: ExecutionOrchestrationPlannerDecision | null;
};

export type ExecutionOrchestrationPlannerState = {
  lastDiagnosis: string;
  lastDecision: ExecutionOrchestrationPlannerDecision | null;
  proposedAction: string;
  expectedOutcome: string;
  lastUpdatedStep: number;
};

export type ExecutionOrchestrationExecutorState = {
  pendingAction: string;
  lastExecutedAction: string;
  lastActionResult: string;
  lastValidationResult: ExecutionSessionVerificationState | null;
  executionNotes: string;
  lastUpdatedStep: number;
};

export type ExecutionOrchestrationHandoff = {
  stepNumber: number;
  handoffFrom: ExecutionOrchestrationAgentRole | null;
  handoffTo: ExecutionOrchestrationAgentRole | null;
  payloadSummary: string;
  expectedAction: string;
  status: ExecutionOrchestrationHandoffStatus;
};

export type ExecutionOrchestrationStep = {
  stepNumber: number;
  phase: ExecutionOrchestrationPhase;
  proposedAction: string;
  executedAction: string;
  actionResult: string;
  verificationState: ExecutionSessionVerificationState;
  diagnosis: string;
  loopTerminationStatus: ExecutionSessionLoopStatus;
  status: ExecutionOrchestrationStepStatus;
};

export type ExecutionOrchestrationState = {
  orchestrationId: string;
  multiAgentSessionId: string;
  goal: string;
  selfDirectionState: ExecutionSelfDirectionState;
  currentPhase: ExecutionOrchestrationPhase;
  completedSteps: ExecutionOrchestrationStep[];
  blockedSteps: ExecutionOrchestrationStep[];
  lastActionResult: string;
  currentStatus: ExecutionOrchestrationStatus;
  currentAgent: ExecutionOrchestrationAgentRole;
  agentHistory: ExecutionOrchestrationAgentHistoryEntry[];
  plannerState: ExecutionOrchestrationPlannerState;
  executorState: ExecutionOrchestrationExecutorState;
  lastHandoff: ExecutionOrchestrationHandoff | null;
  maxAutonomousSteps: number;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimSentence(value: string, maxLength: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function createExecutionOrchestrationId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `aie-orchestration-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createExecutionSelfDirectionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `aie-self-direction-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createExecutionSelfDirectedSubgoalId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `aie-subgoal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createExecutionMultiAgentSessionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `aie-multi-agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createPlannerState(): ExecutionOrchestrationPlannerState {
  return {
    lastDiagnosis: "",
    lastDecision: null,
    proposedAction: "",
    expectedOutcome: "",
    lastUpdatedStep: 0,
  };
}

function createExecutorState(): ExecutionOrchestrationExecutorState {
  return {
    pendingAction: "",
    lastExecutedAction: "",
    lastActionResult: "",
    lastValidationResult: null,
    executionNotes: "",
    lastUpdatedStep: 0,
  };
}

function looksLikeHighRiskAction(value: string): boolean {
  return /(delete|drop|destroy|reset|overwrite|rewrite|publish|deploy|push|bulk|migrate|schema|rename)/i.test(value);
}

function looksLikeVagueSubgoal(value: string): boolean {
  return /^(continue|keep going|keep improving|continue working|continue debugging|keep working|improve things?)$/i.test(normalizeText(value));
}

function stripSubgoalLeadIn(value: string): string {
  return value
    .replace(
      /^(?:temporarily\s+)?(?:inspect|confirm|validate|run|rerun|execute|apply|keep|log|isolate|recover|patch|fix|review|choose|identify|add|stop|treat)\s+(?:the\s+)?/i,
      "",
    )
    .replace(/^(?:the\s+)?planner wants(?: the executor)? to\s+/i, "")
    .replace(/^(?:the planner selected\s+)/i, "")
    .replace(/\b(?:and compare.*|so you can.*|until .*|before .*|after .*|that confirms?.*|whether .*)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSubgoalKey(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\b(?:confirm|validate|execute|recover|subgoal|goal|bounded|action|outcome|latest|next|approved|planner|top|level|result|active)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ");
}

function buildConcreteSubgoalTitle(value: string | null | undefined, fallback: string, prefix?: string): string {
  const normalized = trimSentence(stripSubgoalLeadIn(normalizeText(value)), 120);
  if (!normalized || looksLikeVagueSubgoal(normalized)) {
    return trimSentence(fallback, 120);
  }

  const withPrefix =
    prefix && !normalized.toLowerCase().startsWith(prefix.toLowerCase().split(":")[0] ?? "")
      ? `${prefix}: ${normalized}`
      : normalized;
  return trimSentence(withPrefix, 120);
}

function appendUniqueSubgoal(
  target: ExecutionSelfDirectedSubgoal[],
  params: {
    title: string;
    proposedAction: string;
    expectedOutcome: string;
    selectionReason: string;
    priority: number;
  },
): ExecutionSelfDirectedSubgoal[] {
  const normalizedTitle = normalizeText(params.title).toLowerCase();
  const dedupKey = normalizeSubgoalKey(`${params.title} ${params.proposedAction}`);
  if (
    !normalizedTitle ||
    target.some((subgoal) => {
      const existingTitle = normalizeText(subgoal.title).toLowerCase();
      const existingKey = normalizeSubgoalKey(`${subgoal.title} ${subgoal.proposedAction}`);
      return existingTitle === normalizedTitle || (dedupKey && existingKey === dedupKey);
    })
  ) {
    return target;
  }

  return [
    ...target,
    {
      subgoalId: createExecutionSelfDirectedSubgoalId(),
      title: trimSentence(params.title, 120),
      proposedAction: trimSentence(params.proposedAction, 180),
      expectedOutcome: trimSentence(params.expectedOutcome, 180),
      selectionReason: trimSentence(params.selectionReason, 180),
      priority: params.priority,
      status: "queued",
      requiresUserApproval: looksLikeHighRiskAction(`${params.title} ${params.proposedAction}`),
    },
  ];
}

function deriveExecutionSelfDirectedSubgoals(params: {
  topLevelGoal: string;
  currentPhase?: ExecutionOrchestrationPhase;
  diagnosis?: string;
  proposedAction?: string;
  expectedOutcome?: string;
  maxSubgoals?: number;
}): ExecutionSelfDirectedSubgoal[] {
  const maxSubgoals = Number.isInteger(params.maxSubgoals)
    ? Math.max(3, Math.min(5, Number(params.maxSubgoals)))
    : 3;
  const goal = trimSentence(params.topLevelGoal, 140);
  const diagnosis = trimSentence(normalizeText(params.diagnosis), 180);
  const proposedAction = trimSentence(normalizeText(params.proposedAction), 180);
  const expectedOutcome = trimSentence(normalizeText(params.expectedOutcome), 180);

  let subgoals: ExecutionSelfDirectedSubgoal[] = [];

  if (params.currentPhase === "identify-blocker" || params.currentPhase === "recover" || diagnosis) {
    subgoals = appendUniqueSubgoal(subgoals, {
      title: buildConcreteSubgoalTitle(
        diagnosis,
        `Confirm the active blocker for ${goal}`,
        params.currentPhase === "recover" ? "Recover blocker path" : "Confirm blocker",
      ),
      proposedAction: proposedAction || `Inspect the active blocker that prevents progress on ${goal}.`,
      expectedOutcome: expectedOutcome || `The active blocker for ${goal} should be explicit enough to act on safely.`,
      selectionReason: diagnosis || `The planner must keep the top-level goal concrete before taking the next bounded action.`,
      priority: 1,
    });
  }

  if (proposedAction) {
    subgoals = appendUniqueSubgoal(subgoals, {
      title: buildConcreteSubgoalTitle(proposedAction, `Execute the next bounded action for ${goal}`, "Execute bounded action"),
      proposedAction,
      expectedOutcome: expectedOutcome || `This bounded action should move ${goal} closer to completion without widening scope.`,
      selectionReason: `This action is the planner-selected next move for the approved top-level goal.`,
      priority: 2,
    });
  }

  subgoals = appendUniqueSubgoal(subgoals, {
    title: buildConcreteSubgoalTitle(
      expectedOutcome ? `Validate ${expectedOutcome}` : "Validate the top-level goal against the latest bounded result.",
      `Validate whether ${goal} is satisfied`,
      "Validate outcome",
    ),
    proposedAction: expectedOutcome
      ? `Run the bounded validation that confirms whether ${expectedOutcome}`
      : `Run the bounded validation that confirms whether ${goal} is satisfied.`,
    expectedOutcome: expectedOutcome || `The system should know whether ${goal} is complete, still active, or blocked.`,
    selectionReason: `Self-direction must explicitly validate completion instead of assuming the goal is satisfied.`,
    priority: 3,
  });

  return subgoals.slice(0, maxSubgoals).map((subgoal, index) => ({
    ...subgoal,
    priority: index + 1,
  }));
}

export function summarizeExecutionSelfDirectedSubgoal(
  subgoal: ExecutionSelfDirectedSubgoal | null | undefined,
): string | null {
  if (!subgoal) {
    return null;
  }

  return trimSentence(`${subgoal.title} [${subgoal.status}]`, 140);
}

export function createExecutionSelfDirectionState(params: {
  topLevelGoal: string;
  selfDirectionId?: string;
  maxSubgoals?: number;
}): ExecutionSelfDirectionState {
  const maxSubgoals = Number.isInteger(params.maxSubgoals)
    ? Math.max(3, Math.min(5, Number(params.maxSubgoals)))
    : 3;

  return {
    selfDirectionId: normalizeText(params.selfDirectionId) || createExecutionSelfDirectionId(),
    topLevelGoal: trimSentence(params.topLevelGoal, 140),
    subgoalQueue: [],
    currentSubgoal: null,
    completedSubgoals: [],
    blockedSubgoals: [],
    abandonedSubgoals: [],
    selfDirectionStatus: "active",
    lastSelectionReason: "",
    lastRerouteReason: "",
    lastStopReason: "",
    lastBlockReason: "",
    lastPauseReason: "",
    maxSubgoals,
  };
}

export function initializeExecutionSelfDirection(params: {
  state: ExecutionSelfDirectionState;
  currentPhase?: ExecutionOrchestrationPhase;
  diagnosis?: string;
  proposedAction?: string;
  expectedOutcome?: string;
}) {
  const derivedSubgoals = deriveExecutionSelfDirectedSubgoals({
    topLevelGoal: params.state.topLevelGoal,
    currentPhase: params.currentPhase,
    diagnosis: params.diagnosis,
    proposedAction: params.proposedAction,
    expectedOutcome: params.expectedOutcome,
    maxSubgoals: params.state.maxSubgoals,
  });
  const [firstSubgoal, ...remainingSubgoals] = derivedSubgoals;
  const currentSubgoal = firstSubgoal ? { ...firstSubgoal, status: "active" as const } : null;
  const selectionReason = currentSubgoal?.selectionReason || "No safe bounded subgoal could be derived from the approved top-level goal.";

  return {
    ...params.state,
    currentSubgoal,
    subgoalQueue: remainingSubgoals,
    selfDirectionStatus: currentSubgoal
      ? currentSubgoal.requiresUserApproval
        ? "paused"
        : "active"
      : "blocked",
    lastSelectionReason: selectionReason,
    lastBlockReason: currentSubgoal ? "" : selectionReason,
    lastPauseReason: currentSubgoal?.requiresUserApproval
      ? `The active subgoal requires explicit approval before execution: ${currentSubgoal.title}`
      : "",
  } satisfies ExecutionSelfDirectionState;
}

function pickNextExecutionSelfDirectedSubgoal(
  state: ExecutionSelfDirectionState,
): { currentSubgoal: ExecutionSelfDirectedSubgoal | null; subgoalQueue: ExecutionSelfDirectedSubgoal[] } {
  const [nextSubgoal, ...remainingSubgoals] = state.subgoalQueue;
  return {
    currentSubgoal: nextSubgoal ? { ...nextSubgoal, status: "active" } : null,
    subgoalQueue: remainingSubgoals,
  };
}

function createRecoveryExecutionSelfDirectedSubgoal(params: {
  state: ExecutionSelfDirectionState;
  nextProposedAction: string;
  nextExpectedOutcome?: string;
  rerouteReason: string;
}): ExecutionSelfDirectedSubgoal {
  return {
    subgoalId: createExecutionSelfDirectedSubgoalId(),
    title: buildConcreteSubgoalTitle(params.nextProposedAction, `Recover the blocked path for ${params.state.topLevelGoal}`, "Recovery subgoal"),
    proposedAction: trimSentence(params.nextProposedAction, 180),
    expectedOutcome: trimSentence(
      normalizeText(params.nextExpectedOutcome) || `The rerouted bounded path should restore progress on ${params.state.topLevelGoal}.`,
      180,
    ),
    selectionReason: trimSentence(params.rerouteReason, 180),
    priority: 1,
    status: "queued",
    requiresUserApproval: looksLikeHighRiskAction(params.nextProposedAction),
  };
}

function hasDuplicateExecutionSelfDirectedSubgoal(
  state: ExecutionSelfDirectionState,
  candidate: Pick<ExecutionSelfDirectedSubgoal, "title" | "proposedAction">,
): boolean {
  const candidateKey = normalizeSubgoalKey(`${candidate.title} ${candidate.proposedAction}`);
  const candidateActionKey = normalizeSubgoalKey(candidate.proposedAction);
  if (!candidateKey) {
    return false;
  }

  const existingSubgoals = [
    ...(state.currentSubgoal ? [state.currentSubgoal] : []),
    ...state.subgoalQueue,
    ...state.completedSubgoals,
    ...state.blockedSubgoals,
    ...state.abandonedSubgoals,
  ];

  return existingSubgoals.some((subgoal) => {
    const existingKey = normalizeSubgoalKey(`${subgoal.title} ${subgoal.proposedAction}`);
    const existingActionKey = normalizeSubgoalKey(subgoal.proposedAction);
    return existingKey === candidateKey || (candidateActionKey && existingActionKey === candidateActionKey);
  });
}

export function advanceExecutionSelfDirection(params: {
  state: ExecutionSelfDirectionState;
  verificationState: ExecutionSessionVerificationState;
  loopTerminationStatus: ExecutionSessionLoopStatus;
  plannerDecision: ExecutionOrchestrationPlannerDecision;
  nextProposedAction?: string | null;
  nextExpectedOutcome?: string | null;
  confidenceLevel?: "high" | "medium" | "low" | null;
  selectionReason?: string | null;
  rerouteReason?: string | null;
  stopReason?: string | null;
  blockReason?: string | null;
  pauseReason?: string | null;
}) {
  const nextProposedAction = normalizeText(params.nextProposedAction);
  const nextExpectedOutcome = normalizeText(params.nextExpectedOutcome);
  const currentSubgoal = params.state.currentSubgoal;
  let nextState: ExecutionSelfDirectionState = {
    ...params.state,
    currentSubgoal: currentSubgoal ? { ...currentSubgoal } : null,
    subgoalQueue: [...params.state.subgoalQueue],
    completedSubgoals: [...params.state.completedSubgoals],
    blockedSubgoals: [...params.state.blockedSubgoals],
    abandonedSubgoals: [...params.state.abandonedSubgoals],
    lastSelectionReason: trimSentence(normalizeText(params.selectionReason) || params.state.lastSelectionReason, 180),
    lastRerouteReason: trimSentence(normalizeText(params.rerouteReason) || params.state.lastRerouteReason, 180),
    lastStopReason: trimSentence(normalizeText(params.stopReason) || params.state.lastStopReason, 180),
    lastBlockReason: trimSentence(normalizeText(params.blockReason) || params.state.lastBlockReason, 180),
    lastPauseReason: trimSentence(normalizeText(params.pauseReason) || params.state.lastPauseReason, 180),
  };

  const totalHandledSubgoals =
    nextState.completedSubgoals.length + nextState.blockedSubgoals.length + nextState.abandonedSubgoals.length;

  if (totalHandledSubgoals >= nextState.maxSubgoals && params.plannerDecision !== "complete") {
    return {
      ...nextState,
      selfDirectionStatus: "aborted",
      currentSubgoal: null,
      subgoalQueue: [],
      lastStopReason: "The self-directed run reached its bounded subgoal limit and stopped automatically.",
    } satisfies ExecutionSelfDirectionState;
  }

  if (params.confidenceLevel === "low" && params.plannerDecision !== "complete") {
    return {
      ...nextState,
      selfDirectionStatus: "paused",
      currentSubgoal: currentSubgoal ? { ...currentSubgoal, status: "active" } : null,
      lastPauseReason:
        trimSentence(normalizeText(params.pauseReason) || "Confidence is too low to continue the self-directed run without widening risk.", 180),
    } satisfies ExecutionSelfDirectionState;
  }

  if (params.loopTerminationStatus === "resolved" || params.plannerDecision === "complete") {
    if (currentSubgoal) {
      nextState.completedSubgoals.push({ ...currentSubgoal, status: "completed" });
    }

    return {
      ...nextState,
      currentSubgoal: null,
      subgoalQueue: [],
      selfDirectionStatus: "complete",
      lastStopReason:
        trimSentence(normalizeText(params.stopReason) || `The top-level goal is satisfied, so the self-directed run stopped automatically.`, 180),
    } satisfies ExecutionSelfDirectionState;
  }

  if (params.plannerDecision === "block" || params.loopTerminationStatus === "stuck") {
    if (currentSubgoal) {
      nextState.blockedSubgoals.push({ ...currentSubgoal, status: "blocked" });
    }

    return {
      ...nextState,
      currentSubgoal: null,
      subgoalQueue: [],
      selfDirectionStatus: "blocked",
      lastBlockReason:
        trimSentence(normalizeText(params.blockReason) || "No safe next subgoal exists within the current bounded scope.", 180),
    } satisfies ExecutionSelfDirectionState;
  }

  if (params.verificationState === "falsified" && nextProposedAction) {
    if (currentSubgoal) {
      nextState.abandonedSubgoals.push({ ...currentSubgoal, status: "abandoned" });
    }

    const recoverySubgoal = createRecoveryExecutionSelfDirectedSubgoal({
      state: nextState,
      nextProposedAction,
      nextExpectedOutcome,
      rerouteReason:
        trimSentence(normalizeText(params.rerouteReason) || "The previous subgoal failed, so the planner inserted a bounded recovery subgoal.", 180),
    });

    if (hasDuplicateExecutionSelfDirectedSubgoal(nextState, recoverySubgoal)) {
      return {
        ...nextState,
        currentSubgoal: null,
        subgoalQueue: [],
        selfDirectionStatus: "blocked",
        lastBlockReason: trimSentence(
          normalizeText(params.blockReason) ||
            normalizeText(params.rerouteReason) ||
            "The reroute only produced a near-duplicate bounded subgoal, so the self-directed run blocked instead of looping.",
          180,
        ),
      } satisfies ExecutionSelfDirectionState;
    }

    const boundedQueue = [recoverySubgoal, ...nextState.subgoalQueue].slice(0, nextState.maxSubgoals);
    const [currentRecoverySubgoal, ...remainingSubgoals] = boundedQueue;

    return {
      ...nextState,
      currentSubgoal: currentRecoverySubgoal ? { ...currentRecoverySubgoal, status: "active" } : null,
      subgoalQueue: remainingSubgoals,
      selfDirectionStatus: currentRecoverySubgoal?.requiresUserApproval ? "paused" : "active",
      lastSelectionReason: currentRecoverySubgoal?.selectionReason || nextState.lastSelectionReason,
      lastRerouteReason:
        trimSentence(normalizeText(params.rerouteReason) || "The planner inserted a bounded recovery subgoal after a failed subgoal.", 180),
      lastPauseReason:
        currentRecoverySubgoal?.requiresUserApproval
          ? `The inserted recovery subgoal requires approval before execution: ${currentRecoverySubgoal.title}`
          : "",
    } satisfies ExecutionSelfDirectionState;
  }

  if (currentSubgoal) {
    nextState.completedSubgoals.push({ ...currentSubgoal, status: "completed" });
  }

  const nextSelection = pickNextExecutionSelfDirectedSubgoal(nextState);
  if (!nextSelection.currentSubgoal) {
    return {
      ...nextState,
      currentSubgoal: null,
      subgoalQueue: [],
      selfDirectionStatus: "complete",
      lastStopReason:
        trimSentence(normalizeText(params.stopReason) || "All bounded self-directed subgoals are complete, so the run stopped automatically.", 180),
    } satisfies ExecutionSelfDirectionState;
  }

  return {
    ...nextState,
    currentSubgoal: nextSelection.currentSubgoal,
    subgoalQueue: nextSelection.subgoalQueue,
    selfDirectionStatus: nextSelection.currentSubgoal.requiresUserApproval ? "paused" : "active",
    lastSelectionReason:
      trimSentence(
        normalizeText(params.selectionReason) || nextSelection.currentSubgoal.selectionReason || "The planner selected the next queued bounded subgoal.",
        180,
      ),
    lastPauseReason:
      nextSelection.currentSubgoal.requiresUserApproval
        ? `The next subgoal requires explicit approval before execution: ${nextSelection.currentSubgoal.title}`
        : "",
  } satisfies ExecutionSelfDirectionState;
}

function trimOrFallback(value: string | null | undefined, fallback: string, maxLength = 220): string {
  const normalized = normalizeText(value);
  return trimSentence(normalized || fallback, maxLength);
}

function appendAgentHistory(
  state: ExecutionOrchestrationState,
  entry: Omit<ExecutionOrchestrationAgentHistoryEntry, "entryNumber">,
): ExecutionOrchestrationAgentHistoryEntry[] {
  return [
    ...state.agentHistory,
    {
      ...entry,
      entryNumber: state.agentHistory.length + 1,
    },
  ].slice(-Math.max(state.maxAutonomousSteps * 2, 6));
}

export function createExecutionOrchestrationState(params: {
  goal: string;
  orchestrationId?: string;
  multiAgentSessionId?: string;
  currentPhase?: ExecutionOrchestrationPhase;
  currentAgent?: ExecutionOrchestrationAgentRole;
  maxAutonomousSteps?: number;
  selfDirectionState?: ExecutionSelfDirectionState;
}): ExecutionOrchestrationState {
  const maxAutonomousSteps = Number.isInteger(params.maxAutonomousSteps)
    ? Math.max(3, Math.min(5, Number(params.maxAutonomousSteps)))
    : 5;

  return {
    orchestrationId: normalizeText(params.orchestrationId) || createExecutionOrchestrationId(),
    multiAgentSessionId: normalizeText(params.multiAgentSessionId) || createExecutionMultiAgentSessionId(),
    goal: trimSentence(params.goal, 140),
    selfDirectionState:
      params.selfDirectionState ?? createExecutionSelfDirectionState({ topLevelGoal: trimSentence(params.goal, 140) }),
    currentPhase: params.currentPhase ?? "identify-blocker",
    completedSteps: [],
    blockedSteps: [],
    lastActionResult: "",
    currentStatus: "active",
    currentAgent: params.currentAgent ?? "planner",
    agentHistory: [],
    plannerState: createPlannerState(),
    executorState: createExecutorState(),
    lastHandoff: null,
    maxAutonomousSteps,
  };
}

export function getExecutionOrchestrationStepCount(state: ExecutionOrchestrationState | null | undefined): number {
  if (!state) {
    return 0;
  }

  return state.completedSteps.length + state.blockedSteps.length;
}

export function getLatestExecutionOrchestrationStep(
  state: ExecutionOrchestrationState | null | undefined,
): ExecutionOrchestrationStep | null {
  if (!state) {
    return null;
  }

  const steps = [...state.completedSteps, ...state.blockedSteps].sort((left, right) => left.stepNumber - right.stepNumber);
  return steps.at(-1) ?? null;
}

export function getLatestExecutionOrchestrationAgentHistoryEntry(
  state: ExecutionOrchestrationState | null | undefined,
): ExecutionOrchestrationAgentHistoryEntry | null {
  if (!state) {
    return null;
  }

  return state.agentHistory.at(-1) ?? null;
}

export function getLatestExecutionOrchestrationAgentHistoryEntryByRole(
  state: ExecutionOrchestrationState | null | undefined,
  role: ExecutionOrchestrationAgentRole,
): ExecutionOrchestrationAgentHistoryEntry | null {
  if (!state) {
    return null;
  }

  const matching = [...state.agentHistory].reverse().find((entry) => entry.agentRole === role);
  return matching ?? null;
}

export function getExecutionSelfDirectionSnapshot(
  state: ExecutionOrchestrationState | null | undefined,
): ExecutionSelfDirectionState | null {
  return state?.selfDirectionState ?? null;
}

export function recordPlannerHandoff(params: {
  state: ExecutionOrchestrationState;
  stepNumber?: number;
  diagnosis: string;
  proposedAction?: string;
  expectedOutcome?: string;
  plannerDecision: ExecutionOrchestrationPlannerDecision;
  handoffPayloadSummary?: string;
  handoffTo?: ExecutionOrchestrationAgentRole | null;
}) {
  const stepNumber = Math.max(1, Math.floor(params.stepNumber ?? (getExecutionOrchestrationStepCount(params.state) + 1)));
  const handoffTo =
    params.handoffTo !== undefined
      ? params.handoffTo
      : params.plannerDecision === "continue" || params.plannerDecision === "reroute"
        ? "executor"
        : null;
  const shouldAdvertiseNextAction = Boolean(handoffTo);
  const proposedAction = shouldAdvertiseNextAction
    ? trimOrFallback(params.proposedAction, "Review the current bounded state and choose the next safe action.", 180)
    : "";
  const expectedOutcome = shouldAdvertiseNextAction
    ? trimOrFallback(params.expectedOutcome, "The next bounded step should either narrow the issue, validate the fix, or stop the thread safely.", 180)
    : "";
  const payloadSummary = trimOrFallback(
    params.handoffPayloadSummary,
    shouldAdvertiseNextAction
      ? `${proposedAction} Expected outcome: ${expectedOutcome}`
      : params.plannerDecision === "block"
        ? trimOrFallback(params.diagnosis, "No safe bounded next action is available.", 200)
        : params.plannerDecision === "complete"
          ? trimOrFallback(params.diagnosis, "The bounded goal is complete and no further action is required.", 200)
          : trimOrFallback(params.diagnosis, "No executor handoff is required.", 200),
    200,
  );
  const nextStatus: ExecutionOrchestrationStatus =
    params.state.selfDirectionState.selfDirectionStatus === "complete" || params.plannerDecision === "complete"
      ? "complete"
      : params.state.selfDirectionState.selfDirectionStatus === "blocked" || params.plannerDecision === "block"
        ? params.state.currentStatus === "aborted"
          ? "aborted"
          : "blocked"
        : params.state.currentStatus === "aborted"
          ? "aborted"
          : "active";
  const requiresUserApproval = params.state.selfDirectionState.currentSubgoal?.requiresUserApproval === true;
  const selfDirectionAllowsExecutor = params.state.selfDirectionState.selfDirectionStatus === "active" && !requiresUserApproval;
  const derivedHandoffTo = selfDirectionAllowsExecutor ? handoffTo : null;

  const nextState: ExecutionOrchestrationState = {
    ...params.state,
    currentAgent: derivedHandoffTo ?? "planner",
    currentStatus: nextStatus,
    currentPhase:
      nextStatus === "complete"
        ? "complete"
        : nextStatus === "blocked"
          ? "blocked"
          : nextStatus === "aborted"
            ? "aborted"
            : params.state.currentPhase,
    agentHistory: appendAgentHistory(params.state, {
      stepNumber,
      agentId: PLANNER_AGENT_ID,
      agentRole: "planner",
      summary: trimSentence(params.diagnosis, 220),
      handoffFrom: params.state.lastHandoff?.handoffFrom ?? null,
      handoffTo: derivedHandoffTo,
      handoffPayloadSummary: payloadSummary,
      executedAction: null,
      actionResult: params.state.lastActionResult || null,
      validationResult: params.state.executorState.lastValidationResult,
      executionNotes: params.state.executorState.executionNotes || null,
      plannerDecision: params.plannerDecision,
    }),
    plannerState: {
      lastDiagnosis: trimSentence(params.diagnosis, 220),
      lastDecision: params.plannerDecision,
      proposedAction,
      expectedOutcome,
      lastUpdatedStep: stepNumber,
    },
    executorState: {
      ...params.state.executorState,
      pendingAction: derivedHandoffTo === "executor" ? proposedAction : "",
    },
    lastHandoff: {
      stepNumber,
      handoffFrom: "planner",
      handoffTo: derivedHandoffTo,
      payloadSummary,
      expectedAction: proposedAction,
      status: derivedHandoffTo ? "pending" : "completed",
    },
  };

  return {
    state: nextState,
    handoff: nextState.lastHandoff,
  };
}

export function recordExecutorOutcome(params: {
  state: ExecutionOrchestrationState;
  stepNumber?: number;
  executedAction?: string;
  actionResult: string;
  validationResult: ExecutionSessionVerificationState;
  executionNotes?: string;
  handoffPayloadSummary?: string;
}) {
  const stepNumber = Math.max(1, Math.floor(params.stepNumber ?? Math.max(1, getExecutionOrchestrationStepCount(params.state))));
  const executedAction = trimOrFallback(
    params.executedAction,
    params.state.executorState.pendingAction || "Execute the current bounded step.",
    180,
  );
  const actionResult = trimSentence(params.actionResult, 220);
  const executionNotes = trimOrFallback(params.executionNotes, actionResult, 220);
  const payloadSummary = trimOrFallback(
    params.handoffPayloadSummary,
    `${params.validationResult}: ${actionResult}`,
    200,
  );

  const nextState: ExecutionOrchestrationState = {
    ...params.state,
    currentAgent: "planner",
    lastActionResult: actionResult,
    agentHistory: appendAgentHistory(params.state, {
      stepNumber,
      agentId: EXECUTOR_AGENT_ID,
      agentRole: "executor",
      summary: executionNotes,
      handoffFrom: params.state.lastHandoff?.handoffFrom ?? "planner",
      handoffTo: "planner",
      handoffPayloadSummary: payloadSummary,
      executedAction,
      actionResult,
      validationResult: params.validationResult,
      executionNotes,
      plannerDecision: null,
    }),
    executorState: {
      pendingAction: "",
      lastExecutedAction: executedAction,
      lastActionResult: actionResult,
      lastValidationResult: params.validationResult,
      executionNotes,
      lastUpdatedStep: stepNumber,
    },
    lastHandoff: {
      stepNumber,
      handoffFrom: "executor",
      handoffTo: "planner",
      payloadSummary,
      expectedAction: "Planner should review the bounded execution result and decide whether to continue, reroute, complete, or block.",
      status: "completed",
    },
  };

  return {
    state: nextState,
    handoff: nextState.lastHandoff,
  };
}

export function deriveNextExecutionOrchestrationPhase(params: {
  currentPhase: ExecutionOrchestrationPhase;
  verificationState: ExecutionSessionVerificationState;
  loopTerminationStatus: ExecutionSessionLoopStatus;
  nextSafeAction?: string | null;
  statusOverride?: ExecutionOrchestrationStatus;
}): ExecutionOrchestrationPhase {
  if (params.statusOverride === "complete" || params.loopTerminationStatus === "resolved") {
    return "complete";
  }

  if (params.statusOverride === "blocked" || !normalizeText(params.nextSafeAction)) {
    return "blocked";
  }

  if (params.statusOverride === "aborted") {
    return "aborted";
  }

  if (params.verificationState === "falsified") {
    return "recover";
  }

  switch (params.currentPhase) {
    case "identify-blocker":
      return "apply-fix";
    case "apply-fix":
      return "rerun-validation";
    case "rerun-validation":
      return "decide-next-step";
    case "recover":
      return "apply-fix";
    case "decide-next-step":
      return "apply-fix";
    default:
      return params.currentPhase;
  }
}

export function advanceExecutionOrchestration(params: {
  state: ExecutionOrchestrationState;
  phase?: ExecutionOrchestrationPhase;
  proposedAction?: string;
  executedAction?: string;
  actionResult: string;
  verificationState: ExecutionSessionVerificationState;
  diagnosis: string;
  loopTerminationStatus: ExecutionSessionLoopStatus;
  nextPhase?: ExecutionOrchestrationPhase;
  nextSafeAction?: string | null;
  statusOverride?: ExecutionOrchestrationStatus;
}) {
  const stepNumber = getExecutionOrchestrationStepCount(params.state) + 1;
  const nextSafeAction = normalizeText(params.nextSafeAction);

  let currentStatus: ExecutionOrchestrationStatus;
  if (params.statusOverride) {
    currentStatus = params.statusOverride;
  } else if (params.loopTerminationStatus === "resolved") {
    currentStatus = "complete";
  } else if (stepNumber >= params.state.maxAutonomousSteps && nextSafeAction) {
    currentStatus = "blocked";
  } else if (!nextSafeAction) {
    currentStatus = "blocked";
  } else {
    currentStatus = "active";
  }

  const stepStatus: ExecutionOrchestrationStepStatus =
    currentStatus === "aborted"
      ? "aborted"
      : currentStatus === "blocked" || params.verificationState === "falsified"
        ? "blocked"
        : "completed";
  const completedStep: ExecutionOrchestrationStep = {
    stepNumber,
    phase: params.phase ?? params.state.currentPhase,
    proposedAction: normalizeText(params.proposedAction) || "Follow the current bounded orchestration action.",
    executedAction: normalizeText(params.executedAction) || normalizeText(params.proposedAction) || "Execute the current bounded step.",
    actionResult: normalizeText(params.actionResult),
    verificationState: params.verificationState,
    diagnosis: trimSentence(params.diagnosis, 220),
    loopTerminationStatus: params.loopTerminationStatus,
    status: stepStatus,
  };

  return {
    completedStep,
    nextStepNumber: stepNumber + 1,
    state: {
      ...params.state,
      currentPhase:
        currentStatus === "complete"
          ? "complete"
          : currentStatus === "blocked"
            ? "blocked"
            : currentStatus === "aborted"
              ? "aborted"
              : params.nextPhase ?? params.state.currentPhase,
      completedSteps:
        stepStatus === "completed"
          ? [...params.state.completedSteps, completedStep].slice(-params.state.maxAutonomousSteps)
          : params.state.completedSteps,
      blockedSteps:
        stepStatus === "blocked" || stepStatus === "aborted"
          ? [...params.state.blockedSteps, completedStep].slice(-params.state.maxAutonomousSteps)
          : params.state.blockedSteps,
      lastActionResult: normalizeText(params.actionResult),
      currentStatus,
    } satisfies ExecutionOrchestrationState,
  };
}

export function buildExecutionOrchestrationContextBlock(params: {
  orchestration: ExecutionOrchestrationState | null | undefined;
}): string {
  const orchestration = params.orchestration;
  if (!orchestration) {
    return "";
  }

  const lines = [
    "Bounded orchestration context:",
    `- Orchestration ID: ${orchestration.orchestrationId}`,
    `- Multi-agent session ID: ${orchestration.multiAgentSessionId}`,
    `- Goal: ${orchestration.goal}`,
    `- Status: ${orchestration.currentStatus}`,
    `- Phase: ${orchestration.currentPhase}`,
    `- Current agent: ${orchestration.currentAgent}`,
    `- Max autonomous steps: ${orchestration.maxAutonomousSteps}`,
    `- Self-direction ID: ${orchestration.selfDirectionState.selfDirectionId}`,
    `- Self-direction status: ${orchestration.selfDirectionState.selfDirectionStatus}`,
    `- Top-level goal: ${orchestration.selfDirectionState.topLevelGoal}`,
  ];

  if (orchestration.selfDirectionState.currentSubgoal) {
    lines.push(`- Current subgoal: ${summarizeExecutionSelfDirectedSubgoal(orchestration.selfDirectionState.currentSubgoal)}`);
  }

  if (orchestration.selfDirectionState.subgoalQueue.length > 0) {
    lines.push(`- Queued subgoals: ${orchestration.selfDirectionState.subgoalQueue.map((subgoal) => subgoal.title).join(" | ")}`);
  }

  if (orchestration.selfDirectionState.lastSelectionReason) {
    lines.push(`- Subgoal selection reason: ${trimSentence(orchestration.selfDirectionState.lastSelectionReason, 180)}`);
  }

  if (orchestration.selfDirectionState.lastRerouteReason) {
    lines.push(`- Last reroute reason: ${trimSentence(orchestration.selfDirectionState.lastRerouteReason, 180)}`);
  }

  if (orchestration.selfDirectionState.lastPauseReason) {
    lines.push(`- Last pause reason: ${trimSentence(orchestration.selfDirectionState.lastPauseReason, 180)}`);
  }

  if (orchestration.selfDirectionState.lastBlockReason) {
    lines.push(`- Last block reason: ${trimSentence(orchestration.selfDirectionState.lastBlockReason, 180)}`);
  }

  if (orchestration.selfDirectionState.lastStopReason) {
    lines.push(`- Last stop reason: ${trimSentence(orchestration.selfDirectionState.lastStopReason, 180)}`);
  }

  if (orchestration.lastActionResult) {
    lines.push(`- Last action result: ${trimSentence(orchestration.lastActionResult, 220)}`);
  }

  if (orchestration.completedSteps.length > 0) {
    lines.push("- Completed orchestration steps:");
    for (const step of orchestration.completedSteps.slice(-3)) {
      lines.push(`  - Step ${step.stepNumber} (${step.phase}): ${trimSentence(step.executedAction, 120)}`);
    }
  }

  if (orchestration.blockedSteps.length > 0) {
    lines.push("- Blocked orchestration steps:");
    for (const step of orchestration.blockedSteps.slice(-2)) {
      lines.push(`  - Step ${step.stepNumber} (${step.phase}): ${trimSentence(step.actionResult, 140)}`);
    }
  }

  if (orchestration.lastHandoff) {
    lines.push(
      `- Last handoff: ${orchestration.lastHandoff.handoffFrom ?? "none"} -> ${orchestration.lastHandoff.handoffTo ?? "none"} (${orchestration.lastHandoff.status})`,
    );
    lines.push(`- Handoff payload: ${trimSentence(orchestration.lastHandoff.payloadSummary, 180)}`);
  }

  if (orchestration.plannerState.lastDiagnosis || orchestration.plannerState.proposedAction) {
    lines.push(`- Planner diagnosis: ${trimSentence(orchestration.plannerState.lastDiagnosis, 180)}`);
    lines.push(`- Planner next action: ${trimSentence(orchestration.plannerState.proposedAction, 160)}`);
  }

  if (orchestration.executorState.lastExecutedAction || orchestration.executorState.pendingAction) {
    lines.push(`- Executor last action: ${trimSentence(orchestration.executorState.lastExecutedAction || orchestration.executorState.pendingAction, 160)}`);
  }

  if (orchestration.agentHistory.length > 0) {
    lines.push("- Recent agent history:");
    for (const entry of orchestration.agentHistory.slice(-4)) {
      lines.push(`  - ${entry.agentRole} step ${entry.stepNumber}: ${trimSentence(entry.summary, 140)}`);
    }
  }

  lines.push("Continue only with the same bounded goal, and stop once the orchestration becomes complete, blocked, or aborted.");
  return lines.join("\n");
}

export function normalizeExecutionOrchestrationState(value: unknown): ExecutionOrchestrationState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const orchestrationId = normalizeText(String(source.orchestrationId ?? ""));
  const multiAgentSessionId = normalizeText(String(source.multiAgentSessionId ?? `${orchestrationId}-multi`));
  const goal = normalizeText(String(source.goal ?? ""));
  const selfDirectionSource = source.selfDirectionState;
  const currentPhase = source.currentPhase;
  const currentStatus = source.currentStatus;
  const currentAgent = source.currentAgent;
  const maxAutonomousSteps = Math.max(3, Math.min(5, Math.floor(Number(source.maxAutonomousSteps ?? 5) || 5)));

  if (!orchestrationId || !goal) {
    return undefined;
  }

  const normalizeStep = (entry: unknown): ExecutionOrchestrationStep | null => {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const item = entry as Record<string, unknown>;
    const phase = item.phase;
    const verificationState = item.verificationState;
    const loopTerminationStatus = item.loopTerminationStatus;
    const status = item.status;
    const stepNumber = Math.floor(Number(item.stepNumber ?? 0));

    if (
      stepNumber <= 0 ||
      typeof item.proposedAction !== "string" ||
      typeof item.executedAction !== "string" ||
      typeof item.actionResult !== "string" ||
      typeof item.diagnosis !== "string" ||
      (phase !== "identify-blocker" &&
        phase !== "apply-fix" &&
        phase !== "rerun-validation" &&
        phase !== "recover" &&
        phase !== "decide-next-step" &&
        phase !== "complete" &&
        phase !== "blocked" &&
        phase !== "aborted") ||
      (verificationState !== "confirmed" && verificationState !== "falsified" && verificationState !== "inconclusive") ||
      (loopTerminationStatus !== null &&
        loopTerminationStatus !== undefined &&
        loopTerminationStatus !== "resolved" &&
        loopTerminationStatus !== "converging" &&
        loopTerminationStatus !== "stuck") ||
      (status !== "completed" && status !== "blocked" && status !== "aborted")
    ) {
      return null;
    }

    return {
      stepNumber,
      phase,
      proposedAction: normalizeText(String(item.proposedAction)),
      executedAction: normalizeText(String(item.executedAction)),
      actionResult: normalizeText(String(item.actionResult)),
      verificationState,
      diagnosis: normalizeText(String(item.diagnosis)),
      loopTerminationStatus: loopTerminationStatus ?? null,
      status,
    };
  };

  const normalizeAgentHistoryEntry = (entry: unknown): ExecutionOrchestrationAgentHistoryEntry | null => {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const item = entry as Record<string, unknown>;
    const agentId = item.agentId;
    const agentRole = item.agentRole;
    const validationResult = item.validationResult;
    const plannerDecision = item.plannerDecision;
    const handoffFrom = item.handoffFrom;
    const handoffTo = item.handoffTo;
    const entryNumber = Math.floor(Number(item.entryNumber ?? 0));
    const stepNumber = Math.floor(Number(item.stepNumber ?? 0));

    if (
      entryNumber <= 0 ||
      stepNumber <= 0 ||
      (agentId !== PLANNER_AGENT_ID && agentId !== EXECUTOR_AGENT_ID) ||
      (agentRole !== "planner" && agentRole !== "executor") ||
      typeof item.summary !== "string" ||
      typeof item.handoffPayloadSummary !== "string" ||
      (handoffFrom !== null && handoffFrom !== undefined && handoffFrom !== "planner" && handoffFrom !== "executor") ||
      (handoffTo !== null && handoffTo !== undefined && handoffTo !== "planner" && handoffTo !== "executor") ||
      (item.executedAction !== null && item.executedAction !== undefined && typeof item.executedAction !== "string") ||
      (item.actionResult !== null && item.actionResult !== undefined && typeof item.actionResult !== "string") ||
      (validationResult !== null && validationResult !== undefined && validationResult !== "confirmed" && validationResult !== "falsified" && validationResult !== "inconclusive") ||
      (item.executionNotes !== null && item.executionNotes !== undefined && typeof item.executionNotes !== "string") ||
      (plannerDecision !== null && plannerDecision !== undefined && plannerDecision !== "continue" && plannerDecision !== "reroute" && plannerDecision !== "complete" && plannerDecision !== "block")
    ) {
      return null;
    }

    return {
      entryNumber,
      stepNumber,
      agentId,
      agentRole,
      summary: normalizeText(String(item.summary)),
      handoffFrom: handoffFrom ?? null,
      handoffTo: handoffTo ?? null,
      handoffPayloadSummary: normalizeText(String(item.handoffPayloadSummary)),
      executedAction: item.executedAction == null ? null : normalizeText(String(item.executedAction)),
      actionResult: item.actionResult == null ? null : normalizeText(String(item.actionResult)),
      validationResult: validationResult ?? null,
      executionNotes: item.executionNotes == null ? null : normalizeText(String(item.executionNotes)),
      plannerDecision: plannerDecision ?? null,
    };
  };

  const normalizePlannerState = (entry: unknown): ExecutionOrchestrationPlannerState => {
    if (!entry || typeof entry !== "object") {
      return createPlannerState();
    }

    const item = entry as Record<string, unknown>;
    const lastDecision = item.lastDecision;
    return {
      lastDiagnosis: normalizeText(String(item.lastDiagnosis ?? "")),
      lastDecision:
        lastDecision === "continue" || lastDecision === "reroute" || lastDecision === "complete" || lastDecision === "block"
          ? lastDecision
          : null,
      proposedAction: normalizeText(String(item.proposedAction ?? "")),
      expectedOutcome: normalizeText(String(item.expectedOutcome ?? "")),
      lastUpdatedStep: Math.max(0, Math.floor(Number(item.lastUpdatedStep ?? 0) || 0)),
    };
  };

  const normalizeExecutorState = (entry: unknown): ExecutionOrchestrationExecutorState => {
    if (!entry || typeof entry !== "object") {
      return createExecutorState();
    }

    const item = entry as Record<string, unknown>;
    const lastValidationResult = item.lastValidationResult;
    return {
      pendingAction: normalizeText(String(item.pendingAction ?? "")),
      lastExecutedAction: normalizeText(String(item.lastExecutedAction ?? "")),
      lastActionResult: normalizeText(String(item.lastActionResult ?? "")),
      lastValidationResult:
        lastValidationResult === "confirmed" || lastValidationResult === "falsified" || lastValidationResult === "inconclusive"
          ? lastValidationResult
          : null,
      executionNotes: normalizeText(String(item.executionNotes ?? "")),
      lastUpdatedStep: Math.max(0, Math.floor(Number(item.lastUpdatedStep ?? 0) || 0)),
    };
  };

  const normalizeHandoff = (entry: unknown): ExecutionOrchestrationHandoff | null => {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const item = entry as Record<string, unknown>;
    const handoffFrom = item.handoffFrom;
    const handoffTo = item.handoffTo;
    const status = item.status;
    const stepNumber = Math.floor(Number(item.stepNumber ?? 0));

    if (
      stepNumber <= 0 ||
      typeof item.payloadSummary !== "string" ||
      typeof item.expectedAction !== "string" ||
      (handoffFrom !== null && handoffFrom !== undefined && handoffFrom !== "planner" && handoffFrom !== "executor") ||
      (handoffTo !== null && handoffTo !== undefined && handoffTo !== "planner" && handoffTo !== "executor") ||
      (status !== "pending" && status !== "completed" && status !== "cancelled")
    ) {
      return null;
    }

    return {
      stepNumber,
      handoffFrom: handoffFrom ?? null,
      handoffTo: handoffTo ?? null,
      payloadSummary: normalizeText(String(item.payloadSummary)),
      expectedAction: normalizeText(String(item.expectedAction)),
      status,
    };
  };

  const normalizeSelfDirectedSubgoal = (entry: unknown): ExecutionSelfDirectedSubgoal | null => {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const item = entry as Record<string, unknown>;
    const status = item.status;
    const priority = Math.max(1, Math.floor(Number(item.priority ?? 0) || 0));

    if (
      typeof item.subgoalId !== "string" ||
      typeof item.title !== "string" ||
      typeof item.proposedAction !== "string" ||
      typeof item.expectedOutcome !== "string" ||
      typeof item.selectionReason !== "string" ||
      !priority ||
      (status !== "queued" && status !== "active" && status !== "completed" && status !== "blocked" && status !== "abandoned")
    ) {
      return null;
    }

    return {
      subgoalId: normalizeText(String(item.subgoalId)),
      title: normalizeText(String(item.title)),
      proposedAction: normalizeText(String(item.proposedAction)),
      expectedOutcome: normalizeText(String(item.expectedOutcome)),
      selectionReason: normalizeText(String(item.selectionReason)),
      priority,
      status,
      requiresUserApproval: Boolean(item.requiresUserApproval),
    };
  };

  const normalizeSelfDirectionState = (entry: unknown): ExecutionSelfDirectionState => {
    if (!entry || typeof entry !== "object") {
      return createExecutionSelfDirectionState({ topLevelGoal: goal });
    }

    const item = entry as Record<string, unknown>;
    const selfDirectionStatus = item.selfDirectionStatus;
    const currentSubgoal = normalizeSelfDirectedSubgoal(item.currentSubgoal);
    const maxSubgoals = Math.max(3, Math.min(5, Math.floor(Number(item.maxSubgoals ?? 3) || 3)));

    return {
      selfDirectionId: normalizeText(String(item.selfDirectionId ?? "")) || createExecutionSelfDirectionId(),
      topLevelGoal: normalizeText(String(item.topLevelGoal ?? goal)) || goal,
      subgoalQueue: Array.isArray(item.subgoalQueue)
        ? item.subgoalQueue.map(normalizeSelfDirectedSubgoal).filter((subgoal): subgoal is ExecutionSelfDirectedSubgoal => Boolean(subgoal)).slice(0, maxSubgoals)
        : [],
      currentSubgoal: currentSubgoal ?? null,
      completedSubgoals: Array.isArray(item.completedSubgoals)
        ? item.completedSubgoals.map(normalizeSelfDirectedSubgoal).filter((subgoal): subgoal is ExecutionSelfDirectedSubgoal => Boolean(subgoal)).slice(0, maxSubgoals)
        : [],
      blockedSubgoals: Array.isArray(item.blockedSubgoals)
        ? item.blockedSubgoals.map(normalizeSelfDirectedSubgoal).filter((subgoal): subgoal is ExecutionSelfDirectedSubgoal => Boolean(subgoal)).slice(0, maxSubgoals)
        : [],
      abandonedSubgoals: Array.isArray(item.abandonedSubgoals)
        ? item.abandonedSubgoals.map(normalizeSelfDirectedSubgoal).filter((subgoal): subgoal is ExecutionSelfDirectedSubgoal => Boolean(subgoal)).slice(0, maxSubgoals)
        : [],
      selfDirectionStatus:
        selfDirectionStatus === "active" ||
        selfDirectionStatus === "paused" ||
        selfDirectionStatus === "blocked" ||
        selfDirectionStatus === "complete" ||
        selfDirectionStatus === "aborted"
          ? selfDirectionStatus
          : currentSubgoal
            ? currentSubgoal.requiresUserApproval
              ? "paused"
              : "active"
            : "active",
      lastSelectionReason: normalizeText(String(item.lastSelectionReason ?? "")),
      lastRerouteReason: normalizeText(String(item.lastRerouteReason ?? "")),
      lastStopReason: normalizeText(String(item.lastStopReason ?? "")),
      lastBlockReason: normalizeText(String(item.lastBlockReason ?? "")),
      lastPauseReason: normalizeText(String(item.lastPauseReason ?? "")),
      maxSubgoals,
    };
  };

  const completedSteps = Array.isArray(source.completedSteps)
    ? source.completedSteps.map(normalizeStep).filter((item): item is ExecutionOrchestrationStep => Boolean(item)).slice(-maxAutonomousSteps)
    : [];
  const blockedSteps = Array.isArray(source.blockedSteps)
    ? source.blockedSteps.map(normalizeStep).filter((item): item is ExecutionOrchestrationStep => Boolean(item)).slice(-maxAutonomousSteps)
    : [];
  const agentHistory = Array.isArray(source.agentHistory)
    ? source.agentHistory
        .map(normalizeAgentHistoryEntry)
        .filter((item): item is ExecutionOrchestrationAgentHistoryEntry => Boolean(item))
        .slice(-Math.max(maxAutonomousSteps * 2, 6))
    : [];
  const plannerState = normalizePlannerState(source.plannerState);
  const executorState = normalizeExecutorState(source.executorState);
  const lastHandoff = normalizeHandoff(source.lastHandoff);
  const selfDirectionState = normalizeSelfDirectionState(selfDirectionSource);

  if (
    currentPhase !== "identify-blocker" &&
    currentPhase !== "apply-fix" &&
    currentPhase !== "rerun-validation" &&
    currentPhase !== "recover" &&
    currentPhase !== "decide-next-step" &&
    currentPhase !== "complete" &&
    currentPhase !== "blocked" &&
    currentPhase !== "aborted"
  ) {
    return undefined;
  }

  if (currentStatus !== "active" && currentStatus !== "blocked" && currentStatus !== "complete" && currentStatus !== "aborted") {
    return undefined;
  }

  if (currentAgent !== undefined && currentAgent !== "planner" && currentAgent !== "executor") {
    return undefined;
  }

  const normalizedCurrentAgent: ExecutionOrchestrationAgentRole =
    currentAgent === "planner" || currentAgent === "executor"
      ? currentAgent
      : lastHandoff?.handoffTo === "planner" || lastHandoff?.handoffTo === "executor"
        ? lastHandoff.handoffTo
        : currentStatus === "active"
          ? "executor"
          : "planner";

  return {
    orchestrationId,
    multiAgentSessionId,
    goal,
    selfDirectionState,
    currentPhase,
    completedSteps,
    blockedSteps,
    lastActionResult: normalizeText(String(source.lastActionResult ?? "")),
    currentStatus,
    currentAgent: normalizedCurrentAgent,
    agentHistory,
    plannerState,
    executorState,
    lastHandoff,
    maxAutonomousSteps,
  };
}