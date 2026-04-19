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
  goal: string;
  currentPhase: ExecutionOrchestrationPhase;
  completedSteps: ExecutionOrchestrationStep[];
  blockedSteps: ExecutionOrchestrationStep[];
  lastActionResult: string;
  currentStatus: ExecutionOrchestrationStatus;
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

export function createExecutionOrchestrationState(params: {
  goal: string;
  orchestrationId?: string;
  currentPhase?: ExecutionOrchestrationPhase;
  maxAutonomousSteps?: number;
}): ExecutionOrchestrationState {
  const maxAutonomousSteps = Number.isInteger(params.maxAutonomousSteps)
    ? Math.max(3, Math.min(5, Number(params.maxAutonomousSteps)))
    : 5;

  return {
    orchestrationId: normalizeText(params.orchestrationId) || createExecutionOrchestrationId(),
    goal: trimSentence(params.goal, 140),
    currentPhase: params.currentPhase ?? "identify-blocker",
    completedSteps: [],
    blockedSteps: [],
    lastActionResult: "",
    currentStatus: "active",
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
    `- Goal: ${orchestration.goal}`,
    `- Status: ${orchestration.currentStatus}`,
    `- Phase: ${orchestration.currentPhase}`,
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

  lines.push("Continue only with the same bounded goal, and stop once the orchestration becomes complete, blocked, or aborted.");
  return lines.join("\n");
}

export function normalizeExecutionOrchestrationState(value: unknown): ExecutionOrchestrationState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const orchestrationId = normalizeText(String(source.orchestrationId ?? ""));
  const goal = normalizeText(String(source.goal ?? ""));
  const currentPhase = source.currentPhase;
  const currentStatus = source.currentStatus;
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

  const completedSteps = Array.isArray(source.completedSteps)
    ? source.completedSteps.map(normalizeStep).filter((item): item is ExecutionOrchestrationStep => Boolean(item)).slice(-maxAutonomousSteps)
    : [];
  const blockedSteps = Array.isArray(source.blockedSteps)
    ? source.blockedSteps.map(normalizeStep).filter((item): item is ExecutionOrchestrationStep => Boolean(item)).slice(-maxAutonomousSteps)
    : [];

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

  return {
    orchestrationId,
    goal,
    currentPhase,
    completedSteps,
    blockedSteps,
    lastActionResult: normalizeText(String(source.lastActionResult ?? "")),
    currentStatus,
    maxAutonomousSteps,
  };
}