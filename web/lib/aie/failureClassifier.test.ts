import assert from "node:assert/strict";
import test from "node:test";

import { classifyExecutionFailure } from "./failureClassifier";

test("failure classifier marks path-policy blocks as non-retryable constraints", () => {
  const result = classifyExecutionFailure({
    actionType: "file-write",
    executionResult: {
      status: "blocked",
      error: "outside the allowed root",
      output: "AI-E blocked this execution request because it is outside the safe bounded runtime path policy.",
    },
  });

  assert.equal(result.kind, "constraint");
  assert.equal(result.retryable, false);
});

test("failure classifier marks transient process failures as retryable", () => {
  const result = classifyExecutionFailure({
    actionType: "test-run",
    executionResult: {
      status: "failed",
      error: "Process timed out with ETIMEDOUT",
      exitCode: 1,
    },
  });

  assert.equal(result.kind, "transient");
  assert.equal(result.retryable, true);
});

test("failure classifier marks test failures as logic failures", () => {
  const result = classifyExecutionFailure({
    actionType: "test-run",
    executionResult: {
      status: "failed",
      output: "Test failed: expected banner to equal READY",
      exitCode: 1,
    },
  });

  assert.equal(result.kind, "logic");
  assert.equal(result.retryable, false);
});

test("failure classifier falls back to unknown conservatively", () => {
  const result = classifyExecutionFailure({
    actionType: "inspection",
    executionResult: {
      status: "failed",
      output: "Unexpected issue occurred.",
    },
  });

  assert.equal(result.kind, "unknown");
  assert.equal(result.retryable, false);
});