import type { FailureClassification } from "./failureClassifier";

export type AutonomousRecoveryStrategy =
  | "retry-same-action"
  | "reroute-analysis"
  | "narrow-scope"
  | "validate-before-write"
  | "stop";

export type RecoveryDecision = {
  strategy: AutonomousRecoveryStrategy;
  reason: string;
};

type GetRecoveryDecisionParams = {
  classification: FailureClassification;
  latestActionType?: string;
  latestExecutionResult?: {
    status: "success" | "failed" | "blocked";
    output?: string;
    error?: string;
  };
  repeatedAction: boolean;
  repeatedOutput: boolean;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getRecoveryDecision(params: GetRecoveryDecisionParams): RecoveryDecision {
  const latestActionType = normalizeText(params.latestActionType).toLowerCase();
  const latestOutput = normalizeText(params.latestExecutionResult?.output);
  const latestError = normalizeText(params.latestExecutionResult?.error);
  const combined = [latestOutput, latestError].filter(Boolean).join(" ").toLowerCase();

  if (params.classification.kind === "constraint") {
    return {
      strategy: "stop",
      reason: "The failure is a bounded constraint, so autonomous recovery should stop instead of trying to bypass it.",
    };
  }

  if (params.repeatedAction && params.repeatedOutput) {
    return {
      strategy: "stop",
      reason: "The loop is repeating the same action and the same output, so additional retries would be wasteful.",
    };
  }

  if (params.repeatedOutput) {
    return {
      strategy: "narrow-scope",
      reason: "The output is repeating without useful change, so the next step should narrow scope instead of repeating the same broad move.",
    };
  }

  if (latestActionType === "file-write" && params.repeatedAction) {
    return {
      strategy: "reroute-analysis",
      reason: "The same write keeps failing, so AI-E should reroute analysis instead of repeating it.",
    };
  }

  if (latestActionType === "test-run" && /(?:failed|assert|build|type error|syntax error|ts\d{3,5})/i.test(combined)) {
    return {
      strategy: "reroute-analysis",
      reason: "The failed bounded test output should be fed back into the next analysis step to choose a different fix path.",
    };
  }

  if (latestActionType === "file-write" && params.classification.kind === "logic") {
    return {
      strategy: "validate-before-write",
      reason: "The failure suggests the write plan needs more validation before another file change is attempted.",
    };
  }

  if (params.classification.kind === "environment") {
    return {
      strategy: "narrow-scope",
      reason: "The failure looks environmental, so the next step should narrow the target before trying again.",
    };
  }

  if (params.classification.kind === "transient") {
    return {
      strategy: "retry-same-action",
      reason: "The failure looks transient, so a bounded retry is the least disruptive recovery path.",
    };
  }

  return {
    strategy: "reroute-analysis",
    reason: "The failure should be fed back into analysis so AI-E can choose a different bounded strategy.",
  };
}