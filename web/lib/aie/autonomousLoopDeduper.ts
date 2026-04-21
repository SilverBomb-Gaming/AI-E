type DetectAutonomousLoopStallParams = {
  priorActions: string[];
  priorOutputs: string[];
  nextProposedAction?: string;
  latestExecutionOutput?: string;
};

type AutonomousLoopStallDetection = {
  repeatedAction: boolean;
  repeatedOutput: boolean;
  shouldStallStop: boolean;
  reason: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .map((item) => item.trim())
      .filter((item) => item.length >= 3),
  );
}

function similarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }

  return shared / new Set([...leftTokens, ...rightTokens]).size;
}

function findSimilarCount(values: string[], target: string): number {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget) {
    return 0;
  }

  return values.filter((value) => similarity(value, normalizedTarget) >= 0.82).length;
}

export function detectAutonomousLoopStall(params: DetectAutonomousLoopStallParams): AutonomousLoopStallDetection {
  const nextAction = normalizeText(params.nextProposedAction);
  const latestOutput = normalizeText(params.latestExecutionOutput);
  const repeatedActionCount = nextAction ? findSimilarCount(params.priorActions, nextAction) : 0;
  const repeatedOutputCount = latestOutput ? findSimilarCount(params.priorOutputs, latestOutput) : 0;
  const repeatedAction = repeatedActionCount >= 1;
  const repeatedOutput = repeatedOutputCount >= 1;
  const blockedLikeOutput = /blocked|approval|path policy|allowed root|unsupported/i.test(latestOutput);

  if (repeatedAction && repeatedOutput) {
    return {
      repeatedAction,
      repeatedOutput,
      shouldStallStop: true,
      reason: "The autonomous loop repeated the same action with no meaningful output change.",
    };
  }

  if (repeatedAction && !latestOutput) {
    return {
      repeatedAction,
      repeatedOutput,
      shouldStallStop: true,
      reason: "The autonomous loop repeated the same action without producing new useful output.",
    };
  }

  if (repeatedOutput && !repeatedAction) {
    return {
      repeatedAction,
      repeatedOutput,
      shouldStallStop: true,
      reason: "Different bounded steps are producing the same output, so the loop appears stalled.",
    };
  }

  if (repeatedAction && blockedLikeOutput) {
    return {
      repeatedAction,
      repeatedOutput,
      shouldStallStop: true,
      reason: "The same blocked root cause repeated across bounded attempts.",
    };
  }

  return {
    repeatedAction,
    repeatedOutput,
    shouldStallStop: false,
    reason: repeatedAction || repeatedOutput ? "The loop shows early repetition but has not crossed the stall threshold yet." : "No duplicate-loop stall detected.",
  };
}