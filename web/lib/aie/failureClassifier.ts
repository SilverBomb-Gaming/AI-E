export type AutonomousFailureClass = "environment" | "logic" | "constraint" | "transient" | "unknown";

export type FailureClassification = {
  kind: AutonomousFailureClass;
  retryable: boolean;
  severity: "low" | "medium" | "high";
  reason: string;
};

type ClassifyExecutionFailureParams = {
  actionType?: string;
  executionResult?: {
    status: "success" | "failed" | "blocked";
    output?: string;
    error?: string;
    exitCode?: number;
  };
  latestDiagnosis?: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildClassification(classification: FailureClassification): FailureClassification {
  return classification;
}

export function classifyExecutionFailure(params: ClassifyExecutionFailureParams): FailureClassification {
  const actionType = normalizeText(params.actionType).toLowerCase();
  const status = params.executionResult?.status;
  const output = normalizeText(params.executionResult?.output);
  const error = normalizeText(params.executionResult?.error);
  const diagnosis = normalizeText(params.latestDiagnosis);
  const combined = [output, error, diagnosis].filter(Boolean).join(" ").toLowerCase();

  if (status === "blocked") {
    if (/(?:approval|manual approval|outside the safe auto-execution boundary|requires manual approval)/i.test(combined)) {
      return buildClassification({
        kind: "constraint",
        retryable: false,
        severity: "high",
        reason: "The step was blocked because it requires approval outside the autonomous boundary.",
      });
    }

    if (/(?:path policy|allowed root|outside the allowed root|denied target|unsafe path|unsupported autonomous action|unsupported action type|missing bounded action)/i.test(combined)) {
      return buildClassification({
        kind: "constraint",
        retryable: false,
        severity: "high",
        reason: "The step was blocked by a bounded safety or path-policy constraint.",
      });
    }

    return buildClassification({
      kind: "constraint",
      retryable: false,
      severity: "high",
      reason: "The bounded runtime blocked the step before it could run.",
    });
  }

  if (/(?:timed out|timeout|temporar(?:y|ily)|econnreset|econnrefused|eai_again|etimedout|resource busy|ebusy|enotempty|try again)/i.test(combined)) {
    return buildClassification({
      kind: "transient",
      retryable: true,
      severity: "medium",
      reason: "The failure looks transient, so one bounded retry may be reasonable.",
    });
  }

  if (/(?:enoent|missing file|not found|invalid path|cannot find|no such file|does not exist)/i.test(combined)) {
    return buildClassification({
      kind: actionType === "file-write" ? "environment" : "constraint",
      retryable: false,
      severity: "medium",
      reason: "The failure points to a missing file, invalid path, or unavailable target.",
    });
  }

  if (
    /(?:assert(?:ion)? failed|expected .* to|failing test|tests? failed|build failed|compilation failed|type error|syntax error|ts\d{3,5}|eslint|pytest failed|vitest failed)/i.test(combined) ||
    (status === "failed" && typeof params.executionResult?.exitCode === "number" && params.executionResult.exitCode !== 0 && /(?:test|build|validation|check)/i.test(actionType))
  ) {
    return buildClassification({
      kind: "logic",
      retryable: false,
      severity: "medium",
      reason: "The failure looks like a real logic or validation problem, so rerouting is safer than retrying the same step.",
    });
  }

  if (/permission denied|access denied/i.test(combined)) {
    return buildClassification({
      kind: "constraint",
      retryable: false,
      severity: "high",
      reason: "The step hit an explicit permission boundary.",
    });
  }

  if (status === "failed") {
    return buildClassification({
      kind: "unknown",
      retryable: false,
      severity: "medium",
      reason: "The bounded runtime failed for an unknown reason, so AI-E should avoid blind retries.",
    });
  }

  return buildClassification({
    kind: "unknown",
    retryable: false,
    severity: "low",
    reason: "No actionable failure class was detected.",
  });
}