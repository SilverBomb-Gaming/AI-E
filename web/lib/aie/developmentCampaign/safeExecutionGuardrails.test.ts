import assert from "node:assert/strict";
import test from "node:test";

import { buildSafeExecutionGuardrailInventory, evaluateSafeExecutionGuardrail } from "./safeExecutionGuardrails";

test("planning-only work is allowed without mutation authority", () => {
  const decision = evaluateSafeExecutionGuardrail({
    operationKind: "planning_only",
    requestedAction: "draft a campaign handoff",
  });

  assert.equal(decision.decisionStatus, "allowed_planning_only");
  assert.equal(decision.canProceed, true);
  assert.equal(decision.canMutate, false);
  assert.equal(decision.approvalRequired, false);
  assert.match(decision.truthfulnessWarnings.join("\n"), /does not execute/);
});

test("mutating repo work is blocked until explicit approval exists", () => {
  const decision = evaluateSafeExecutionGuardrail({
    operationKind: "repo_file_mutation",
    requestedAction: "edit a TypeScript source file",
    targetPaths: ["web/lib/aie/example.ts"],
  });

  assert.equal(decision.decisionStatus, "blocked_pending_operator_approval");
  assert.equal(decision.blocked, true);
  assert.equal(decision.canMutate, false);
  assert.match(decision.blockedOperationReport, /Explicit operator approval is required/);
});

test("approved mutating work is blocked when rollback boundary is missing", () => {
  const decision = evaluateSafeExecutionGuardrail({
    operationKind: "unity_scene_mutation",
    requestedAction: "modify a Unity scene",
    operatorApproval: {
      approved: true,
      approvalScope: "single Unity scene object mutation",
      approvedAt: "2026-05-10T00:00:00.000Z",
    },
  });

  assert.equal(decision.decisionStatus, "blocked_missing_rollback_boundary");
  assert.equal(decision.operatorApprovalPresent, true);
  assert.equal(decision.rollbackBoundaryPresent, false);
  assert.match(decision.blockedOperationReport, /rollback boundary is required/);
});

test("approved mutating work with rollback is only eligible for supervised execution", () => {
  const decision = evaluateSafeExecutionGuardrail({
    operationKind: "shell_command",
    requestedAction: "run a focused validation command",
    operatorApproval: {
      approved: true,
      approvalScope: "focused validation only",
      approvedAt: "2026-05-10T00:00:00.000Z",
    },
    rollbackBoundary: {
      available: true,
      summary: "No persistent mutation expected; command is validation-only.",
    },
  });

  assert.equal(decision.decisionStatus, "eligible_for_supervised_execution");
  assert.equal(decision.executionAuthority, "requires_supervised_approval");
  assert.equal(decision.canProceed, true);
  assert.equal(decision.blocked, false);
  assert.match(decision.blockedOperationReport, /separate supervised execution path/);
});

test("destructive and future-only operations remain blocked", () => {
  const destructiveDecision = evaluateSafeExecutionGuardrail({
    operationKind: "destructive_git_operation",
    requestedAction: "reset the repo",
    destructiveIntent: true,
  });
  const futureDecision = evaluateSafeExecutionGuardrail({
    operationKind: "future_hands_off_autonomy",
    requestedAction: "run hands-off overnight without supervision",
  });

  assert.equal(destructiveDecision.decisionStatus, "blocked_destructive_operation");
  assert.equal(futureDecision.decisionStatus, "blocked_future_only");
  assert.equal(destructiveDecision.canProceed, false);
  assert.equal(futureDecision.canProceed, false);
});

test("inventory reports the real guardrail boundary without claiming execution", () => {
  const inventory = buildSafeExecutionGuardrailInventory();

  assert.equal(inventory.status, "real");
  assert.ok(inventory.requiresApprovalAndRollback.includes("repo_file_mutation"));
  assert.ok(inventory.alwaysBlocked.includes("future_hands_off_autonomy"));
  assert.match(inventory.truthfulnessBoundary, /do not execute/);
});