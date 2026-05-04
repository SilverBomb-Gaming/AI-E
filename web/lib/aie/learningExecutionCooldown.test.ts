import assert from "node:assert/strict";
import test from "node:test";

import {
  getLearningExecutionCooldownStatus,
  recordLearningExecutionTime,
  resetLearningExecutionCooldown,
} from "./learningExecutionCooldown";

test.afterEach(() => {
  resetLearningExecutionCooldown();
});

test("cooldown allows execution when no prior execution exists", () => {
  const status = getLearningExecutionCooldownStatus({
    attemptedAt: "2026-05-04T01:00:00.000Z",
    cooldownWindowMs: 60_000,
  });

  assert.equal(status.blocked, false);
  assert.equal(status.last_execution_time, undefined);
});

test("cooldown blocks execution within the cooldown window", () => {
  recordLearningExecutionTime("2026-05-04T01:00:00.000Z");
  const status = getLearningExecutionCooldownStatus({
    attemptedAt: "2026-05-04T01:00:30.000Z",
    cooldownWindowMs: 60_000,
  });

  assert.equal(status.blocked, true);
  assert.equal(status.last_execution_time, "2026-05-04T01:00:00.000Z");
});

test("cooldown resets after sufficient delay", () => {
  recordLearningExecutionTime("2026-05-04T01:00:00.000Z");
  const status = getLearningExecutionCooldownStatus({
    attemptedAt: "2026-05-04T01:01:01.000Z",
    cooldownWindowMs: 60_000,
  });

  assert.equal(status.blocked, false);
});