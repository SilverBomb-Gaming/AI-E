export type ExecutionSessionVerificationState = "confirmed" | "falsified" | "inconclusive";
export type ExecutionSessionLoopStatus = "resolved" | "converging" | "stuck" | null;

export type ExecutionSessionStep = {
  stepIndex: number;
  attemptedStep: string;
  actionResult: string;
  verificationState: ExecutionSessionVerificationState;
  diagnosis: string;
  loopTerminationStatus: ExecutionSessionLoopStatus;
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

export function createExecutionSessionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `aie-session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeExecutionGoal(problemDescription: string, goal?: string): string {
  const normalizedGoal = normalizeText(goal);
  if (normalizedGoal) {
    return trimSentence(normalizedGoal, 140);
  }

  const firstSentence = normalizeText(problemDescription).split(/(?<=[.!?])\s+/)[0] ?? "";
  return trimSentence(firstSentence || "Resolve the current Unity issue without widening the investigation.", 140);
}

export function summarizeExecutionSessionStep(step: ExecutionSessionStep): string {
  const verificationLabel =
    step.verificationState === "confirmed"
      ? "confirmed"
      : step.verificationState === "falsified"
        ? "falsified"
        : "remained inconclusive";
  const statusLabel = step.loopTerminationStatus ? ` (${step.loopTerminationStatus})` : "";

  return trimSentence(
    `Step ${step.stepIndex} ${verificationLabel}${statusLabel}: ${step.attemptedStep}. Outcome: ${step.actionResult}`,
    220,
  );
}

export function advanceExecutionSession(params: {
  currentStepIndex: number;
  attemptedStep?: string;
  actionResult: string;
  verificationState: ExecutionSessionVerificationState;
  diagnosis: string;
  loopTerminationStatus: ExecutionSessionLoopStatus;
  steps?: ExecutionSessionStep[];
}) {
  const completedStep: ExecutionSessionStep = {
    stepIndex: Math.max(1, Math.floor(params.currentStepIndex)),
    attemptedStep: normalizeText(params.attemptedStep) || "Follow the current proposed action and compare the outcome.",
    actionResult: normalizeText(params.actionResult),
    verificationState: params.verificationState,
    diagnosis: normalizeText(params.diagnosis),
    loopTerminationStatus: params.loopTerminationStatus,
  };

  return {
    completedStep,
    nextStepIndex: completedStep.stepIndex + 1,
    previousOutcome: summarizeExecutionSessionStep(completedStep),
    steps: [...(params.steps ?? []), completedStep].slice(-6),
  };
}

export function buildExecutionSessionContextBlock(params: {
  goal?: string;
  currentStepIndex?: number;
  previousOutcome?: string;
  steps?: ExecutionSessionStep[];
}): string {
  const goal = normalizeText(params.goal);
  const previousOutcome = normalizeText(params.previousOutcome);
  const currentStepIndex = Number.isInteger(params.currentStepIndex) ? Math.max(1, Number(params.currentStepIndex)) : null;
  const recentSteps = (params.steps ?? []).slice(-3);

  if (!goal && !previousOutcome && !currentStepIndex && recentSteps.length === 0) {
    return "";
  }

  const lines = ["Controlled execution session context:"];

  if (goal) {
    lines.push(`- Goal: ${goal}`);
  }

  if (currentStepIndex) {
    lines.push(`- Current step to approve: ${currentStepIndex}`);
  }

  if (previousOutcome) {
    lines.push(`- Previous outcome: ${previousOutcome}`);
  }

  if (recentSteps.length > 0) {
    lines.push("- Recent approved steps:");
    for (const step of recentSteps) {
      lines.push(`  - ${summarizeExecutionSessionStep(step)}`);
    }
  }

  lines.push("Use this only to continue the same approved debugging session for the same goal.");
  return lines.join("\n");
}