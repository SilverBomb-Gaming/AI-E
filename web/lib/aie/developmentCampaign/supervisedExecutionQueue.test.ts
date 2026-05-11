import assert from "node:assert/strict";
import test from "node:test";

import { createSupervisedExecutionQueue } from "./supervisedExecutionQueue";

const createdAt = "2026-05-11T00:00:00.000Z";

test("supervised queue records planning-only and read-only steps without execution", () => {
  const queue = createSupervisedExecutionQueue({
    queueId: "queue-readonly",
    objective: "Inspect and plan a safe implementation",
    createdAt,
    steps: [
      {
        stepId: "plan",
        title: "Draft implementation plan",
        operationKind: "planning_only",
        requestedAction: "draft a bounded plan",
      },
      {
        stepId: "inspect",
        title: "Inspect repository files",
        operationKind: "read_only_repo_inspection",
        requestedAction: "inspect target files",
        targetPaths: ["web/lib/aie"],
      },
    ],
  });

  assert.equal(queue.queueStatus, "ready_for_supervised_execution");
  assert.deepEqual(queue.executionEligibility.eligibleStepIds, ["plan", "inspect"]);
  assert.equal(queue.executionEligibility.executionTriggered, false);
  assert.deepEqual(queue.executionEligibility.executedStepIds, []);
  assert.ok(queue.steps.every((step) => step.executedActionRecorded === false));
});

test("mutating steps wait for operator approval metadata", () => {
  const queue = createSupervisedExecutionQueue({
    queueId: "queue-approval",
    objective: "Prepare a repo edit",
    createdAt,
    steps: [
      {
        stepId: "edit",
        title: "Edit source file",
        operationKind: "repo_file_mutation",
        requestedAction: "edit a TypeScript file",
        targetPaths: ["web/lib/aie/example.ts"],
      },
    ],
  });

  assert.equal(queue.queueStatus, "awaiting_operator_approval");
  assert.deepEqual(queue.approvalMetadata.approvalRequiredStepIds, ["edit"]);
  assert.deepEqual(queue.approvalMetadata.missingApprovalStepIds, ["edit"]);
  assert.deepEqual(queue.executionEligibility.blockedStepIds, ["edit"]);
});

test("approved mutation is blocked until rollback plan is present", () => {
  const queue = createSupervisedExecutionQueue({
    queueId: "queue-rollback",
    objective: "Prepare a Unity scene change",
    createdAt,
    steps: [
      {
        stepId: "scene",
        title: "Change Unity scene",
        operationKind: "unity_scene_mutation",
        requestedAction: "add a scene marker",
        operatorApproval: {
          approved: true,
          approvedBy: "operator",
          approvedAt: createdAt,
          approvalScope: "single scene marker",
        },
      },
    ],
  });

  assert.equal(queue.queueStatus, "blocked_missing_rollback_plan");
  assert.deepEqual(queue.approvalMetadata.approvedStepIds, ["scene"]);
  assert.deepEqual(queue.rollbackPlanMetadata.missingRollbackStepIds, ["scene"]);
  assert.equal(queue.executionEligibility.canEnterSupervisedExecution, false);
});

test("approved mutation with rollback becomes eligible but still does not execute", () => {
  const queue = createSupervisedExecutionQueue({
    queueId: "queue-ready",
    objective: "Prepare supervised validation command",
    createdAt,
    steps: [
      {
        stepId: "validate",
        title: "Run focused validation",
        operationKind: "shell_command",
        requestedAction: "run focused tests",
        operatorApproval: {
          approved: true,
          approvedBy: "operator",
          approvedAt: createdAt,
          approvalScope: "focused validation command only",
        },
        rollbackPlan: {
          available: true,
          summary: "Validation command has no persistent mutation; stop process if it hangs.",
        },
      },
    ],
  });

  assert.equal(queue.queueStatus, "ready_for_supervised_execution");
  assert.deepEqual(queue.rollbackPlanMetadata.rollbackReadyStepIds, ["validate"]);
  assert.equal(queue.executionEligibility.canEnterSupervisedExecution, true);
  assert.equal(queue.executionEligibility.executionTriggered, false);
  assert.deepEqual(queue.executionEligibility.executedStepIds, []);
  assert.match(queue.truthfulnessSafeguards.join("\n"), /does not run shell commands/);
});

test("unsupported destructive and future autonomy requests are refused", () => {
  const queue = createSupervisedExecutionQueue({
    queueId: "queue-refusal",
    objective: "Attempt unsupported autonomy",
    createdAt,
    steps: [
      {
        stepId: "reset",
        title: "Reset repository",
        operationKind: "destructive_git_operation",
        requestedAction: "reset the repo",
        destructiveIntent: true,
      },
      {
        stepId: "hands-off",
        title: "Run unattended",
        operationKind: "future_hands_off_autonomy",
        requestedAction: "operate without supervision",
      },
    ],
  });

  assert.equal(queue.queueStatus, "refused_unsupported_execution");
  assert.deepEqual(queue.executionEligibility.blockedStepIds, ["reset", "hands-off"]);
  assert.equal(queue.refusalReports.length, 2);
  assert.match(queue.refusalReports.join("\n"), /future-only|Destructive operations/);
});

test("supervised queue refuses plans above the bounded multi-step limit", () => {
  const queue = createSupervisedExecutionQueue({
    queueId: "queue-too-large",
    objective: "Oversized plan",
    createdAt,
    steps: Array.from({ length: 6 }, (_, index) => ({
      stepId: `step-${index + 1}`,
      title: `Step ${index + 1}`,
      operationKind: "planning_only" as const,
      requestedAction: `plan step ${index + 1}`,
    })),
  });

  assert.equal(queue.boundedStepLimit, 5);
  assert.equal(queue.steps.length, 5);
  assert.equal(queue.queueStatus, "refused_unsupported_execution");
  assert.match(queue.refusalReports.join("\n"), /exceeds the bounded supervised limit/);
});