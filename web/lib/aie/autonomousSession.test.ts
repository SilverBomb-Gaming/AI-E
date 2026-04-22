import assert from "node:assert/strict";
import test from "node:test";

import {
  appendAutonomousStep,
  buildAutonomousSessionContextBlock,
  canResumeAutonomousSession,
  countPriorAttemptsForAction,
  createAutonomousSession,
  markAwaitingApproval,
  normalizeAutonomousSession,
  pauseAutonomousSession,
  resumeAutonomousSession,
  updateAutonomousSessionStatus,
} from "./autonomousSession";

test("autonomous sessions clamp max steps and start active", () => {
  const session = createAutonomousSession({
    goal: "Confirm the bounded validation path.",
    maxSteps: 99,
  });

  assert.equal(session.status, "active");
  assert.equal(session.currentStepIndex, 1);
  assert.equal(session.maxSteps, 5);
  assert.equal(session.steps.length, 0);
});

test("autonomous sessions append steps and preserve runtime output", () => {
  const created = createAutonomousSession({
    goal: "Confirm the bounded validation path.",
    maxSteps: 3,
  });
  const updated = appendAutonomousStep(created, {
    proposedAction: "Run the bounded validation command.",
    expectedOutcome: "The validation output should report success.",
    diagnosis: "The validation path is the current best bounded check.",
    verificationState: "inconclusive",
    nextDecision: "continue",
    executionResult: {
      status: "success",
      output: "Validation passed with a healthy status.",
    },
  });

  assert.equal(updated.steps.length, 1);
  assert.equal(updated.currentStepIndex, 2);
  assert.equal(updated.latestExecutionResult?.status, "success");
  assert.equal(updated.workflowContinuity.progress.chainPhase, "validation");
  assert.equal(updated.workflowContinuity.progress.lastCompletedSafeStep, 1);
  assert.equal(updated.workflowContinuity.memory.recentDecisions[0], "step 1: Run the bounded validation command. -> continue");
  assert.match(updated.workflowContinuity.memory.lastValidationOutcome ?? "", /runtime=success/i);
  assert.match(buildAutonomousSessionContextBlock(updated), /Validation passed with a healthy status/i);
});

test("autonomous sessions preserve optional node and task metadata", () => {
  const updated = appendAutonomousStep(createAutonomousSession({ goal: "Confirm the bounded validation path." }), {
    proposedAction: "Run the bounded validation command.",
    executionNodeId: "aie-node-local-node-test",
    executionNodeMode: "local-node",
    nodeCapabilitySummary: "inspection, validation-check, repo-scan",
    taskId: "task-123",
    executionResult: {
      status: "success",
      output: "Validation passed with a healthy status.",
    },
  });
  const normalized = normalizeAutonomousSession(JSON.parse(JSON.stringify(updated)));

  assert.equal(updated.executionNodeId, "aie-node-local-node-test");
  assert.equal(updated.steps[0]?.taskId, "task-123");
  assert.equal(normalized?.executionNodeMode, "local-node");
  assert.equal(normalized?.steps[0]?.nodeCapabilitySummary, "inspection, validation-check, repo-scan");
});

test("autonomous session normalization keeps persisted sessions readable", () => {
  const session = updateAutonomousSessionStatus(
    appendAutonomousStep(createAutonomousSession({ goal: "Confirm the bounded validation path." }), {
      proposedAction: "Run the bounded validation command.",
      executionResult: {
        status: "success",
        output: "Validation passed with a healthy status.",
      },
    }),
    "completed",
    "The bounded goal was satisfied.",
  );

  const normalized = normalizeAutonomousSession(JSON.parse(JSON.stringify(session)));

  assert.ok(normalized);
  assert.equal(normalized?.status, "completed");
  assert.equal(normalized?.completedReason, "The bounded goal was satisfied.");
});

test("autonomous sessions preserve recovery metadata and action attempt counts", () => {
  const session = appendAutonomousStep(createAutonomousSession({ goal: "Confirm the bounded validation path." }), {
    proposedAction: "Run validation.",
    executionResult: {
      status: "failed",
      error: "Timed out once.",
    },
    failureClassification: {
      kind: "transient",
      retryable: true,
      severity: "medium",
      reason: "Timed out once.",
    },
    recoveryStrategy: "retry-same-action",
    retryCount: 1,
    repeatedAction: false,
    repeatedOutput: false,
  });

  const normalized = normalizeAutonomousSession(JSON.parse(JSON.stringify(session)));

  assert.equal(normalized?.steps[0]?.failureClassification?.kind, "transient");
  assert.equal(normalized?.steps[0]?.recoveryStrategy, "retry-same-action");
  assert.equal(normalized?.workflowContinuity.progress.chainPhase, "retry");
  assert.match(normalized?.workflowContinuity.memory.restartReason ?? "", /Timed out once/i);
  assert.match(normalized?.workflowContinuity.memory.lastFailureSummary ?? "", /Timed out once/i);
  assert.equal(countPriorAttemptsForAction(session, "Run validation."), 1);
  assert.match(buildAutonomousSessionContextBlock(session), /retry-same-action/i);
});

test("autonomous sessions persist workflow continuity across awaiting approval state", () => {
  const awaiting = markAwaitingApproval(
    appendAutonomousStep(createAutonomousSession({ goal: "Confirm the bounded validation path." }), {
      proposedAction: "Inspect the bounded validation path.",
      nextDecision: "continue",
      executionResult: {
        status: "success",
        output: "Inspection completed without widening scope.",
      },
    }),
    {
      id: "pending-caution-write",
      type: "file-write",
      scope: "caution",
      description: "Apply the bounded fix.",
      expectedOutcome: "The bounded validation should become healthy.",
      requiresApproval: true,
      metadata: {
        sourceActionType: "file-write",
        targetPath: "web/sandbox/pending.txt",
        allowedRoot: "web/sandbox",
        content: "pending",
      },
    },
    "Approval is required before the bounded fix step.",
  );

  const normalized = normalizeAutonomousSession(JSON.parse(JSON.stringify(awaiting)));

  assert.equal(normalized?.workflowContinuity.progress.chainPhase, "waiting-on-operator");
  assert.equal(normalized?.workflowContinuity.progress.lastCompletedSafeStep, 1);
  assert.equal(normalized?.workflowContinuity.progress.nextIntendedStep, "Apply the bounded fix.");
  assert.match(normalized?.workflowContinuity.memory.operatorBlockers ?? "", /approval required/i);
  assert.match(normalized?.workflowContinuity.memory.pendingOperatorContext ?? "", /approval is required/i);
});

test("autonomous sessions derive implementation and fix loop memory from changed paths", () => {
  const implemented = appendAutonomousStep(createAutonomousSession({ goal: "Stabilize the bounded production loop." }), {
    proposedAction: "Apply the bounded fix patch.",
    executionResult: {
      status: "success",
      output: "Patch applied cleanly.",
      changedPaths: ["web/lib/aie/autonomousSession.ts"],
      diffSummary: "Updated workflow continuity derivation.",
    },
    nextDecision: "continue",
  });
  const failedFix = appendAutonomousStep(implemented, {
    proposedAction: "Apply a second bounded fix patch.",
    executionResult: {
      status: "failed",
      error: "Patch conflicted with the current file state.",
      changedPaths: ["web/lib/aie/autonomousSession.ts"],
      diffSummary: "Attempted to update the same continuity block.",
    },
    failureReason: "Patch conflicted with the current file state.",
  });

  assert.equal(implemented.workflowContinuity.progress.chainPhase, "implementation");
  assert.match(implemented.workflowContinuity.memory.lastFixAttemptSummary ?? "", /changed=web\/lib\/aie\/autonomousSession.ts/i);
  assert.equal(failedFix.workflowContinuity.progress.chainPhase, "fix");
  assert.match(failedFix.workflowContinuity.memory.lastFailureSummary ?? "", /patch conflicted/i);
});

test("autonomous sessions can pause and resume without losing state reason", () => {
  const created = createAutonomousSession({ goal: "Confirm the bounded validation path." });
  const paused = pauseAutonomousSession(created, "Waiting for the next bounded continuation window.");
  const resumed = resumeAutonomousSession(paused, { reason: "Continuation window reopened." });

  assert.equal(paused.status, "paused");
  assert.equal(canResumeAutonomousSession(paused), true);
  assert.equal(resumed.status, "active");
  assert.equal(resumed.stateReason, "Continuation window reopened.");
});

test("autonomous sessions persist awaiting-approval pending actions", () => {
  const awaiting = markAwaitingApproval(
    createAutonomousSession({ goal: "Confirm the bounded validation path." }),
    {
      id: "pending-caution-write",
      type: "file-write",
      scope: "caution",
      description: "Apply a caution-scoped sandbox write.",
      expectedOutcome: "The sandbox output should become healthy.",
      requiresApproval: true,
      metadata: {
        sourceActionType: "file-write",
        targetPath: "web/sandbox/pending.txt",
        allowedRoot: "web/sandbox",
        content: "pending",
      },
    },
    "Explicit approval is required for the pending caution write.",
  );
  const normalized = normalizeAutonomousSession(JSON.parse(JSON.stringify(awaiting)));

  assert.equal(awaiting.status, "awaiting-approval");
  assert.equal(canResumeAutonomousSession(awaiting), false);
  assert.equal(canResumeAutonomousSession(awaiting, true), true);
  assert.equal(normalized?.pendingAction?.type, "file-write");
  assert.equal(normalized?.pendingAction?.scope, "caution");
  assert.match(normalized?.stateReason ?? "", /approval/i);
});