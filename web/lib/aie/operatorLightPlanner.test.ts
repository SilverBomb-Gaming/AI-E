import assert from "node:assert/strict";
import test from "node:test";

import { createOperatorLightPlan } from "./operatorLightPlanner";

test("vague gameplay request stays planning-first and requires playtesting", () => {
  const plan = createOperatorLightPlan({
    rawRequest: "Make the enemies smarter and add better grenade stuff.",
    projectName: "BABYLON Unity gameplay project",
  });

  assert.match(plan.interpreted_goal, /enemy behavior and grenade interactions/i);
  assert.equal(plan.risk_level, "medium");
  assert.equal(plan.playtest_required, true);
  assert.ok(plan.missing_information.some((item) => /enemy behavior/i.test(item)));
  assert.ok(plan.missing_information.some((item) => /grenade behavior/i.test(item)));
  assert.deepEqual(plan.execution_steps.map((step) => step.phase), ["planning", "implementation", "follow-up"]);
  assert.ok(plan.validation_steps.some((step) => step.type === "playtest"));
  assert.ok(plan.git_commit_plan.github_procedure.length >= 6);
});

test("specific repo maintenance request produces a low-risk scoped plan", () => {
  const plan = createOperatorLightPlan({
    rawRequest: "Update the README examples for the task queue and add unit tests for queue parsing.",
    repoName: "AI-E",
  });

  assert.equal(plan.risk_level, "low");
  assert.equal(plan.playtest_required, false);
  assert.ok(plan.repo_targets.includes("README.md"));
  assert.ok(plan.repo_targets.includes("matching unit or integration tests"));
  assert.ok(plan.git_commit_plan.stage_only.includes("matching tests"));
  assert.match(plan.next_operator_decision, /approve the bounded implementation packet/i);
});

test("risky autonomous request is blocked and asks for approval boundaries", () => {
  const plan = createOperatorLightPlan({
    rawRequest: "Autonomously refactor the entire repo, delete obsolete files, and push the changes without review.",
    repoName: "AI-E",
  });

  assert.equal(plan.risk_level, "blocked");
  assert.ok(plan.missing_information.some((item) => /approval boundaries/i.test(item)));
  assert.equal(plan.execution_steps[1]?.status, "blocked");
  assert.match(plan.next_operator_decision, /Provide the missing scope and approval boundary/i);
});

test("underspecified bug request stays blocked but still returns validation guidance", () => {
  const plan = createOperatorLightPlan({
    rawRequest: "Fix the bug.",
  });

  assert.equal(plan.risk_level, "blocked");
  assert.ok(plan.missing_information.some((item) => /exact bug/i.test(item)));
  assert.ok(plan.validation_steps.length >= 2);
  assert.ok(plan.validation_steps.some((step) => /Re-run the planner/i.test(step.title)));
});

test("gameplay feel request requires human playtesting", () => {
  const plan = createOperatorLightPlan({
    rawRequest: "Tighten the platformer jump feel and checkpoint spacing.",
    projectName: "OpenClaw platformer sandbox",
  });

  assert.equal(plan.playtest_required, true);
  assert.ok(plan.validation_steps.some((step) => step.type === "playtest"));
  assert.match(plan.next_operator_decision, /playtest owner, scene, or validation session/i);
});