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

  assert.equal(inspectAction.type, "inspection");
  assert.equal(inspectAction.scope, "safe");
  assert.equal(inspectAction.requiresApproval, true);
  assert.equal(validationAction.type, "validation-check");
  assert.equal(validationAction.scope, "safe");
});

test("buildExecutionAction marks sandbox file writes safe and derives target metadata", () => {
  const action = buildExecutionAction({
    proposedAction: "Create web/sandbox/phase4b-note.txt with the bounded sandbox validation summary.",
    actionType: "file-write",
    expectedOutcome: "The sandbox note should be created without touching broader source files.",
    metadata: {
      content: "phase4b sandbox validation summary",
    },
  });

  assert.equal(action.type, "file-write");
  assert.equal(action.scope, "safe");
  assert.equal(action.metadata.targetPath, "web/sandbox/phase4b-note.txt");
  assert.equal(action.metadata.allowedRoot, "web/sandbox");
});

test("buildExecutionAction infers a whitelisted test target for bounded test runs", () => {
  const action = buildExecutionAction({
    proposedAction: "Run npm run test:trace after the sandbox write.",
    actionType: "test-run",
    expectedOutcome: "The bounded trace tests should stay healthy.",
  });

  assert.equal(action.type, "test-run");
  assert.equal(action.scope, "safe");
  assert.equal(action.metadata.testTarget, "trace");
});

test("buildExecutionAction preserves specific bounded test-file targets", () => {
  const action = buildExecutionAction({
    proposedAction: "Run the bounded test file web/lib/aie/repoContext.test.ts.",
    actionType: "test-run",
    expectedOutcome: "The bounded repo context test should pass.",
    metadata: {
      testTarget: "web/lib/aie/repoContext.test.ts",
    },
  });

  assert.equal(action.type, "test-run");
  assert.equal(action.scope, "safe");
  assert.equal(action.metadata.testTarget, "web/lib/aie/repoContext.test.ts");
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
  assert.equal(formatted.execution?.type, "inspection");
  assert.equal(formatted.execution?.scope, "safe");
  assert.match(formatted.execution?.description ?? "", /Inspect the owner reference/i);
});

test("formatFreeAnalysis ignores unknown actionType values and falls back to inferred dry-run types", () => {
  const formatted = formatFreeAnalysis({
    what_happened: "The projectile ownership handoff is the most likely cause of the issue.",
    what_matters: ["The failure only appears after the ownership swap."],
    what_to_do_next: ["Inspect the owner reference right after the handoff."],
    upgrade_hint: "Upgrade later.",
    actionType: "not-a-real-action-type",
    proposedAction: "Inspect the owner reference right after the handoff.",
    expectedOutcome: "The bounded check should confirm whether the owner reference is stale.",
  });

  assert.equal(formatted.actionType, "inspection");
  assert.equal(formatted.execution?.type, "inspection");
  assert.equal(formatted.execution?.scope, "safe");
});

test("formatFreeAnalysis classifies validate whether file exists as validation-check", () => {
  const formatted = formatFreeAnalysis({
    what_happened: "Validate whether web/lib/aie/types.ts exists before continuing.",
    what_matters: ["This should stay read-only."],
    what_to_do_next: ["Validate whether web/lib/aie/types.ts exists before continuing."],
    upgrade_hint: "",
  });

  assert.equal(formatted.actionType, "validation-check");
  assert.equal(formatted.execution?.type, "validation-check");
});

test("formatFreeAnalysis classifies inspect and summarize file shape as inspection", () => {
  const formatted = formatFreeAnalysis({
    what_happened: "Inspect web/lib/aie/types.ts and summarize the file shape in read-only mode.",
    what_matters: ["This should stay read-only."],
    what_to_do_next: ["Inspect web/lib/aie/types.ts and summarize the file shape in read-only mode."],
    upgrade_hint: "",
  });

  assert.equal(formatted.actionType, "inspection");
  assert.equal(formatted.execution?.type, "inspection");
});

test("formatFreeAnalysis classifies confirm file contains contract as validation-check", () => {
  const formatted = formatFreeAnalysis({
    what_happened: "Confirm web/lib/aie/types.ts contains the execution contract before continuing.",
    what_matters: ["This should stay read-only."],
    what_to_do_next: ["Confirm web/lib/aie/types.ts contains the execution contract before continuing."],
    upgrade_hint: "",
  });

  assert.equal(formatted.actionType, "validation-check");
  assert.equal(formatted.execution?.type, "validation-check");
});

test("formatFreeAnalysis still classifies real write goals as file-write", () => {
  const formatted = formatFreeAnalysis({
    what_happened: "Update web/lib/aie/types.ts to add the new bounded field.",
    what_matters: ["This is a real write."],
    what_to_do_next: ["Update web/lib/aie/types.ts to add the new bounded field."],
    upgrade_hint: "",
  });

  assert.equal(formatted.actionType, "file-write");
  assert.equal(formatted.execution?.type, "file-write");
});