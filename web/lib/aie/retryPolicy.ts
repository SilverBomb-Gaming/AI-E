import type { FailureClassification } from "./failureClassifier";

export type RetryDecision = {
  shouldRetry: boolean;
  reason: string;
  nextAttemptCount: number;
};

type GetRetryDecisionParams = {
  classification: FailureClassification;
  priorAttemptsForAction: number;
  maxRetriesPerAction?: number;
};

export function getRetryDecision(params: GetRetryDecisionParams): RetryDecision {
  const maxRetriesPerAction = Math.max(0, Math.min(2, Math.floor(params.maxRetriesPerAction ?? 1)));

  if (params.classification.kind === "constraint" || params.classification.retryable === false) {
    return {
      shouldRetry: false,
      reason: params.classification.reason,
      nextAttemptCount: params.priorAttemptsForAction,
    };
  }

  if (params.priorAttemptsForAction >= maxRetriesPerAction) {
    return {
      shouldRetry: false,
      reason: `The action already used ${params.priorAttemptsForAction} retry attempt(s), which reaches the bounded retry limit of ${maxRetriesPerAction}.`,
      nextAttemptCount: params.priorAttemptsForAction,
    };
  }

  if (params.classification.kind !== "transient") {
    return {
      shouldRetry: false,
      reason: "The failure does not look transient enough to justify repeating the same action.",
      nextAttemptCount: params.priorAttemptsForAction,
    };
  }

  return {
    shouldRetry: true,
    reason: "The failure looks transient and remains within the bounded retry budget.",
    nextAttemptCount: params.priorAttemptsForAction + 1,
  };
}