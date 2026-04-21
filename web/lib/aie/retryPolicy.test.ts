import assert from "node:assert/strict";
import test from "node:test";

import { getRetryDecision } from "./retryPolicy";

test("retry policy allows a bounded transient retry", () => {
  const decision = getRetryDecision({
    classification: {
      kind: "transient",
      retryable: true,
      severity: "medium",
      reason: "Timed out once.",
    },
    priorAttemptsForAction: 0,
  });

  assert.equal(decision.shouldRetry, true);
  assert.equal(decision.nextAttemptCount, 1);
});

test("retry policy denies non-retryable failures", () => {
  const decision = getRetryDecision({
    classification: {
      kind: "logic",
      retryable: false,
      severity: "medium",
      reason: "Assertion failed.",
    },
    priorAttemptsForAction: 0,
  });

  assert.equal(decision.shouldRetry, false);
});

test("retry policy stops once the retry limit is reached", () => {
  const decision = getRetryDecision({
    classification: {
      kind: "transient",
      retryable: true,
      severity: "medium",
      reason: "Timed out once.",
    },
    priorAttemptsForAction: 1,
    maxRetriesPerAction: 1,
  });

  assert.equal(decision.shouldRetry, false);
});

test("retry policy never retries blocked constraints", () => {
  const decision = getRetryDecision({
    classification: {
      kind: "constraint",
      retryable: false,
      severity: "high",
      reason: "Blocked by path policy.",
    },
    priorAttemptsForAction: 0,
  });

  assert.equal(decision.shouldRetry, false);
});