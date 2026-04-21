import assert from "node:assert/strict";
import test from "node:test";

import { getRecoveryDecision } from "./strategySwitch";

test("strategy switch retries transient failures when no stronger signal is present", () => {
  const decision = getRecoveryDecision({
    classification: {
      kind: "transient",
      retryable: true,
      severity: "medium",
      reason: "Timed out.",
    },
    latestActionType: "test-run",
    latestExecutionResult: {
      status: "failed",
      error: "Timed out.",
    },
    repeatedAction: false,
    repeatedOutput: false,
  });

  assert.equal(decision.strategy, "retry-same-action");
});

test("strategy switch reroutes repeated failed writes", () => {
  const decision = getRecoveryDecision({
    classification: {
      kind: "logic",
      retryable: false,
      severity: "medium",
      reason: "Write plan failed.",
    },
    latestActionType: "file-write",
    latestExecutionResult: {
      status: "failed",
      error: "Write failed.",
    },
    repeatedAction: true,
    repeatedOutput: false,
  });

  assert.equal(decision.strategy, "reroute-analysis");
});

test("strategy switch reroutes failed tests back into analysis", () => {
  const decision = getRecoveryDecision({
    classification: {
      kind: "logic",
      retryable: false,
      severity: "medium",
      reason: "Assertion failed.",
    },
    latestActionType: "test-run",
    latestExecutionResult: {
      status: "failed",
      output: "Test failed: expected READY",
    },
    repeatedAction: false,
    repeatedOutput: false,
  });

  assert.equal(decision.strategy, "reroute-analysis");
});

test("strategy switch stops on bounded constraints", () => {
  const decision = getRecoveryDecision({
    classification: {
      kind: "constraint",
      retryable: false,
      severity: "high",
      reason: "Blocked by allowed root.",
    },
    latestActionType: "file-write",
    latestExecutionResult: {
      status: "blocked",
      error: "outside allowed root",
    },
    repeatedAction: false,
    repeatedOutput: false,
  });

  assert.equal(decision.strategy, "stop");
});

test("strategy switch stops when action and output are both repeating", () => {
  const decision = getRecoveryDecision({
    classification: {
      kind: "logic",
      retryable: false,
      severity: "medium",
      reason: "No progress.",
    },
    latestActionType: "test-run",
    latestExecutionResult: {
      status: "failed",
      output: "Same failure output.",
    },
    repeatedAction: true,
    repeatedOutput: true,
  });

  assert.equal(decision.strategy, "stop");
});