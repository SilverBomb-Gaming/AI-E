import assert from "node:assert/strict";
import test from "node:test";

import { buildPostPlaytestFixPlan } from "./postPlaytestFixPlanner";

test("pass decision yields no_fix_needed", () => {
  const result = buildPostPlaytestFixPlan({
    status: "ready_for_next_feature",
    reason: "Feature is stable.",
    recommended_next_action: "Mark the feature stable and select the next validation target.",
    confidence: "high",
    source_feature: "enemy-health",
    source_outcome_session_key: "session-1",
  });

  assert.equal(result.status, "no_fix_needed");
  assert.deepEqual(result.recommended_fix_steps, [
    "Mark current feature stable and select next validation target.",
  ]);
});

test("retry decision yields a bounded fix plan", () => {
  const result = buildPostPlaytestFixPlan({
    status: "retry_recommended",
    reason: "Failure evidence suggests a small safe retry path.",
    recommended_next_action: "Review failure evidence, apply the smallest safe fix, then rerun the reviewed Unity playtest.",
    confidence: "high",
    source_feature: "enemy-health",
    source_outcome_session_key: "session-2",
  });

  assert.equal(result.status, "fix_plan_ready");
  assert.ok(result.recommended_fix_steps.some((step) => /Inspect failure evidence/i.test(step)));
  assert.ok(result.recommended_fix_steps.some((step) => /Identify the smallest code or configuration change/i.test(step)));
  assert.ok(result.recommended_fix_steps.some((step) => /Avoid broad rewrites/i.test(step)));
  assert.ok(result.recommended_fix_steps.some((step) => /Rerun the reviewed Unity playtest after operator approval/i.test(step)));
});

test("escalation decision yields operator review", () => {
  const result = buildPostPlaytestFixPlan({
    status: "escalation_recommended",
    reason: "Evidence is ambiguous.",
    recommended_next_action: "Ask the operator to inspect the playtest evidence before retrying.",
    confidence: "low",
    source_feature: "enemy-health",
    source_outcome_session_key: "session-3",
  });

  assert.equal(result.status, "needs_operator_review");
  assert.ok(result.recommended_fix_steps.some((step) => /Inspect the reviewed playtest evidence with the operator/i.test(step)));
});

test("blocked decision yields blocked fix planning", () => {
  const result = buildPostPlaytestFixPlan({
    status: "blocked",
    reason: "Feature context is missing.",
    recommended_next_action: "Provide explicit feature context before recording or deciding.",
    confidence: "high",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "Feature context is missing.");
});