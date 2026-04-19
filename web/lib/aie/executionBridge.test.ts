import assert from "node:assert/strict";
import test from "node:test";

import { buildExecutionAction } from "./executionBridge";
import { formatFreeAnalysis } from "./format-result";

test("buildExecutionAction classifies inspection and validation checks as safe", () => {
  const inspectAction = buildExecutionAction({
    proposedAction: "Inspect the live projectile owner reference during the failing handoff.",
    actionType: "inspection",
    expectedOutcome: "The bounded check should confirm whether the owner reference is stale.",
  });
  const validationAction = buildExecutionAction({
    proposedAction: "Re-run the bounded validation check in the same scene.",
    actionType: "validation-check",
    expectedOutcome: "The same signal should confirm or falsify cleanly.",
  });

  assert.equal(inspectAction.type, "inspect");
  assert.equal(inspectAction.scope, "safe");
  assert.equal(inspectAction.requiresApproval, true);
  assert.equal(validationAction.type, "run");
  assert.equal(validationAction.scope, "safe");
});

test("buildExecutionAction classifies instrumentation and code change with bounded caution", () => {
  const instrumentationAction = buildExecutionAction({
    proposedAction: "Add a focused timestamp log around the Animator handoff.",
    actionType: "instrumentation",
    expectedOutcome: "The log should show whether the handoff fires during the failing transition.",
  });
  const codeChangeAction = buildExecutionAction({
    proposedAction: "Consolidate the duplicate zoom writer into one path.",
    actionType: "code-change",
    expectedOutcome: "The targeted change should remove the conflicting same-frame write.",
  });

  assert.equal(instrumentationAction.type, "write");
  assert.equal(instrumentationAction.scope, "caution");
  assert.equal(codeChangeAction.type, "write");
  assert.equal(codeChangeAction.scope, "dangerous");
});

test("formatFreeAnalysis attaches an optional execution preview when a proposed action exists", () => {
  const formatted = formatFreeAnalysis({
    what_happened: "The projectile ownership handoff is the most likely cause of the issue.",
    what_matters: ["The failure only appears after the ownership swap."],
    what_to_do_next: ["Inspect the owner reference right after the handoff."],
    upgrade_hint: "Upgrade later.",
    actionType: "inspection",
    proposedAction: "Inspect the owner reference right after the handoff.",
    expectedOutcome: "The bounded check should confirm whether the owner reference is stale.",
  });

  assert.ok(formatted.execution);
  assert.equal(formatted.execution?.requiresApproval, true);
  assert.equal(formatted.execution?.type, "inspect");
  assert.equal(formatted.execution?.scope, "safe");
  assert.match(formatted.execution?.description ?? "", /Inspect the owner reference/i);
});