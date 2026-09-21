import assert from "node:assert/strict";
import test from "node:test";

import { planBoundedRequest } from "./planner";

test("plans a bounded Unity controller slice without claiming execution", () => {
  const plan = planBoundedRequest("Plan a Unity third-person controller for a PC prototype");

  assert.equal(plan.status, "supported_ready");
  assert.equal(plan.intent.engineTarget, "unity");
  assert.equal(plan.intent.platformTarget, "pc");
  assert.deepEqual(plan.intent.features, ["third_person_controller"]);
  assert.equal(plan.reviewRequired, true);
  assert.equal(plan.executed, false);
  assert.equal(plan.blockedItems.length, 0);
  assert.ok(plan.steps.length >= 3);
  assert.match(plan.summary, /bounded unity plan/i);
});

test("returns an honest unsupported-target result for Godot", () => {
  const plan = planBoundedRequest("Make a Godot inventory system");

  assert.equal(plan.status, "unsupported_target");
  assert.equal(plan.intent.engineTarget, "godot");
  assert.equal(plan.executed, false);
  assert.match(plan.summary, /godot/i);
  assert.match(plan.steps[0]?.detail ?? "", /unity is the only adapter/i);
});

test("blocks unsafe autonomous scene and build requests", () => {
  const plan = planBoundedRequest("Autonomously edit Unity scenes and ship the build");

  assert.equal(plan.status, "blocked_unsafe");
  assert.ok(plan.blockedItems.length >= 2);
  assert.equal(plan.executed, false);
  assert.match(plan.summary, /blocked/i);
});

test("keeps vague requests as draft plans with missing inputs", () => {
  const plan = planBoundedRequest("Make the game better");

  assert.equal(plan.status, "bounded_draft");
  assert.ok(plan.intent.missingInputs.includes("engine_target"));
  assert.ok(plan.intent.missingInputs.includes("feature_slice"));
  assert.equal(plan.executed, false);
});
