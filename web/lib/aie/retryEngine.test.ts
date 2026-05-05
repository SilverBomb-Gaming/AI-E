import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { recordOutcome } from "./outcomeLearning";
import { generateAutoRetryTask, suggestRetryForLatestOutcome } from "./retryEngine";

test("retry engine recommends fixing runtime errors before retry", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-retry-engine-fail-"));

  try {
    await recordOutcome(tempRoot, {
      feature: "enemy-health",
      result: "fail",
      observation: "NullReferenceException during hit processing",
      evaluationSource: "runtime-auto",
      errors: ["NullReferenceException"],
    });

    const suggestion = await suggestRetryForLatestOutcome(tempRoot);
    assert.equal(suggestion.decision?.retryRecommended, true);
    assert.equal(suggestion.decision?.strategyAdjustment, "Fix runtime errors before retry");
    assert.match(suggestion.decision?.reason ?? "", /runtime error/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("retry engine recommends behavior refinement for partial gameplay signals", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-retry-engine-partial-"));

  try {
    await recordOutcome(tempRoot, {
      feature: "attack-feedback",
      result: "partial",
      observation: "Enemy flashes but the pulse is weak.",
      evaluationSource: "runtime-auto",
      gameplayEvents: ["Enemy flash triggered"],
    });

    const suggestion = await suggestRetryForLatestOutcome(tempRoot);
    assert.equal(suggestion.decision?.retryRecommended, true);
    assert.equal(suggestion.decision?.strategyAdjustment, "Refine feature behavior, not structure");
    assert.match(suggestion.decision?.reason ?? "", /partial/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("retry engine stops after max retries for one feature", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-retry-engine-limit-"));

  try {
    await recordOutcome(tempRoot, {
      feature: "enemy-health",
      result: "fail",
      observation: "first failure",
      evaluationSource: "runtime-auto",
    });
    await recordOutcome(tempRoot, {
      feature: "enemy-health",
      result: "fail",
      observation: "second failure",
      evaluationSource: "runtime-auto",
    });
    await recordOutcome(tempRoot, {
      feature: "enemy-health",
      result: "fail",
      observation: "third failure",
      evaluationSource: "runtime-auto",
    });

    const suggestion = await suggestRetryForLatestOutcome(tempRoot);
    const autoRetry = await generateAutoRetryTask(tempRoot);

    assert.equal(suggestion.decision?.retryRecommended, false);
    assert.match(suggestion.decision?.reason ?? "", /retry limit reached/i);
    assert.equal(autoRetry.task, undefined);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
