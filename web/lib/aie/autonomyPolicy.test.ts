import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRST_AUTONOMY_LANE,
  getAutonomyPolicy,
  renderAutonomyPolicy,
  validateAutonomyPolicy,
} from "./autonomyPolicy";

test("default autonomy is disabled", () => {
  const policy = getAutonomyPolicy();

  assert.equal(policy.autonomy_enabled, false);
});

test("default lane is none", () => {
  const policy = getAutonomyPolicy();

  assert.equal(policy.allowed_lane, "none");
  assert.deepEqual(validateAutonomyPolicy(policy), {
    valid: true,
    errors: [],
  });
});

test("enabled policy with max_items_per_run greater than one is rejected", () => {
  const result = validateAutonomyPolicy({
    ...getAutonomyPolicy(),
    autonomy_enabled: true,
    allowed_lane: "single_queued_learning_item",
    max_items_per_run: 2,
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("single_queued_learning_item must keep max_items_per_run at 1"));
});

test("policy cannot bypass operator review yet", () => {
  const result = validateAutonomyPolicy({
    ...getAutonomyPolicy(),
    requires_operator_review: false,
  } as never);

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("autonomy policy cannot bypass operator review"));
});

test("first lane can be described but not activated by default", () => {
  const policy = getAutonomyPolicy();

  assert.equal(policy.allowed_lane, "none");
  assert.equal(FIRST_AUTONOMY_LANE.lane, "single_queued_learning_item");
  assert.equal(FIRST_AUTONOMY_LANE.enabled_by_default, false);
  assert.equal(FIRST_AUTONOMY_LANE.max_items_per_run, 1);
});

test("render output clearly says autonomy disabled", () => {
  const rendered = renderAutonomyPolicy(getAutonomyPolicy());

  assert.match(rendered, /Autonomy enabled: false/);
  assert.match(rendered, /Blocked reason: autonomy disabled/);
  assert.match(rendered, /Defined future lane: single_queued_learning_item/);
});