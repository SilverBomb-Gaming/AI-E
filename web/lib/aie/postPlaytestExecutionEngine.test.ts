import assert from "node:assert/strict";
import test from "node:test";

import { buildPostPlaytestExecutionPlan } from "./postPlaytestExecutionEngine";

test("no_fix_needed yields no_action_needed", () => {
  const result = buildPostPlaytestExecutionPlan({
    status: "no_fix_needed",
    reason: "No repair work is needed.",
    recommended_fix_steps: ["Mark current feature stable and select next validation target."],
    safety_constraints: [],
    confidence: "high",
    source_feature: "enemy-health",
    source_outcome_session_key: "session-1",
  });

  assert.equal(result.status, "no_action_needed");
  assert.equal(result.max_changed_files, 0);
  assert.equal(result.max_retry_count, 0);
  assert.equal(result.requires_operator_approval, false);
});

test("blocked yields execution_blocked", () => {
  const result = buildPostPlaytestExecutionPlan({
    status: "blocked",
    reason: "Feature context is missing.",
    recommended_fix_steps: ["Resolve the blocking issue before generating or applying any fix plan."],
    safety_constraints: [],
    confidence: "high",
  });

  assert.equal(result.status, "execution_blocked");
  assert.equal(result.reason, "Feature context is missing.");
  assert.equal(result.requires_operator_approval, true);
});

test("needs_operator_review yields operator_approval_required", () => {
  const result = buildPostPlaytestExecutionPlan({
    status: "needs_operator_review",
    reason: "Evidence is ambiguous.",
    recommended_fix_steps: ["Inspect the reviewed playtest evidence with the operator before choosing a fix direction."],
    safety_constraints: [],
    confidence: "low",
  });

  assert.equal(result.status, "operator_approval_required");
  assert.equal(result.requires_operator_approval, true);
});

test("fix_plan_ready yields execution_ready", () => {
  const result = buildPostPlaytestExecutionPlan({
    status: "fix_plan_ready",
    reason: "A bounded fix plan is ready.",
    recommended_fix_steps: [
      "Inspect failure evidence from the reviewed Unity playtest.",
      "Identify the smallest code or configuration change that addresses the observed failure.",
    ],
    safety_constraints: [],
    confidence: "medium",
    source_feature: "enemy-health",
    source_outcome_session_key: "session-2",
  });

  assert.equal(result.status, "execution_ready");
  assert.deepEqual(result.proposed_actions, [
    "Inspect failure evidence from the reviewed Unity playtest.",
    "Identify the smallest code or configuration change that addresses the observed failure.",
  ]);
  assert.equal(result.requires_operator_approval, true);
});

test("execution_ready enforces max_changed_files equals 2", () => {
  const result = buildPostPlaytestExecutionPlan({
    status: "fix_plan_ready",
    reason: "A bounded fix plan is ready.",
    recommended_fix_steps: ["Inspect failure evidence from the reviewed Unity playtest."],
    safety_constraints: [],
    confidence: "high",
  });

  assert.equal(result.max_changed_files, 2);
});

test("execution_ready enforces max_retry_count equals 1", () => {
  const result = buildPostPlaytestExecutionPlan({
    status: "fix_plan_ready",
    reason: "A bounded fix plan is ready.",
    recommended_fix_steps: ["Inspect failure evidence from the reviewed Unity playtest."],
    safety_constraints: [],
    confidence: "high",
  });

  assert.equal(result.max_retry_count, 1);
});