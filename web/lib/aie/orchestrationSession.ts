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

export const PLANNER_AGENT_ID: ExecutionOrchestrationAgentId = "planner-agent";
export const EXECUTOR_AGENT_ID: ExecutionOrchestrationAgentId = "executor-agent";

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
}): ExecutionOrchestrationState {
  const maxAutonomousSteps = Number.isInteger(params.maxAutonomousSteps)
    ? Math.max(3, Math.min(5, Number(params.maxAutonomousSteps)))
    : 5;

  return {
    orchestrationId: normalizeText(params.orchestrationId) || createExecutionOrchestrationId(),
    multiAgentSessionId: normalizeText(params.multiAgentSessionId) || createExecutionMultiAgentSessionId(),
    goal: trimSentence(params.goal, 140),
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
  const proposedAction = trimOrFallback(params.proposedAction, "Review the current bounded state and choose the next safe action.", 180);
  const expectedOutcome = trimOrFallback(params.expectedOutcome, "The next bounded step should either narrow the issue, validate the fix, or stop the thread safely.", 180);
  const handoffTo =
    params.handoffTo !== undefined
      ? params.handoffTo
      : params.plannerDecision === "continue" || params.plannerDecision === "reroute"
        ? "executor"
        : null;
  const payloadSummary = trimOrFallback(
    params.handoffPayloadSummary,
    `${proposedAction} Expected outcome: ${expectedOutcome}`,
    200,
  );
  const nextStatus: ExecutionOrchestrationStatus =
    params.plannerDecision === "complete"
      ? "complete"
      : params.plannerDecision === "block"
        ? params.state.currentStatus === "aborted"
          ? "aborted"
          : "blocked"
        : params.state.currentStatus === "aborted"
          ? "aborted"
          : "active";

  const nextState: ExecutionOrchestrationState = {
    ...params.state,
    currentAgent: handoffTo ?? "planner",
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
      handoffTo,
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
      pendingAction: handoffTo === "executor" ? proposedAction : "",
    },
    lastHandoff: {
      stepNumber,
      handoffFrom: "planner",
      handoffTo,
      payloadSummary,
      expectedAction: proposedAction,
      status: handoffTo ? "pending" : "completed",
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
  ];

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