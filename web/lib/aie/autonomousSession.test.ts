import assert from "node:assert/strict";
import test from "node:test";

import {
  appendAutonomousStep,
  buildAutonomousSessionContextBlock,
  canResumeAutonomousSession,
  clearAutonomousSessionSteering,
  countPriorAttemptsForAction,
  createAutonomousSession,
  markAwaitingApproval,
  normalizeAutonomousSession,
  pauseAutonomousSession,
  resumeAutonomousSession,
  updateAutonomousSessionSteering,
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

test("autonomous sessions persist bounded session loop limits and surface them in context", () => {
  const session = createAutonomousSession({
    goal: "Run multiple bounded queued tasks without exceeding session limits.",
    maxTasksPerSession: 99,
    maxFailuresPerSession: 0,
    maxRuntimeMs: 9 * 60 * 60 * 1_000,
  });

  assert.equal(session.sessionLoop.maxTasksPerSession, 10);
  assert.equal(session.sessionLoop.maxFailuresPerSession, 1);
  assert.equal(session.sessionLoop.maxRuntimeMs, 8 * 60 * 60 * 1_000);
  assert.match(buildAutonomousSessionContextBlock(session), /Session loop limits: tasks=10, failures=1, runtimeMs=28800000/i);
  assert.match(buildAutonomousSessionContextBlock(session), /Session loop progress: completed=0, skipped=0, blocked=0, failures=0/i);
});

test("autonomous sessions preserve explicit skip and force-stop steering actions", () => {
  const ready = appendAutonomousStep(createAutonomousSession({ goal: "Use explicit operator-light queue controls." }), {
    proposedAction: "Run the bounded queued task.",
    executionResult: {
      status: "success",
      output: "The queued task is ready for the next operator decision.",
    },
    nextDecision: "continue",
  });
  const skipped = updateAutonomousSessionSteering(ready, {
    action: "skip-current-task",
    operatorNote: "Skip the current queued task and move on.",
  });
  const stopped = updateAutonomousSessionSteering(ready, {
    action: "force-stop",
    operatorNote: "Stop the autonomous session immediately.",
  });

  assert.equal(skipped.workflowContinuity.steering.requestedAction, "skip-current-task");
  assert.match(skipped.workflowContinuity.loopHealth.loopHealthReason ?? "", /skip/i);
  assert.equal(stopped.workflowContinuity.steering.requestedAction, "force-stop");
  assert.equal(stopped.workflowContinuity.steering.requestedNextPhaseOverride, "stop");
  assert.equal(stopped.workflowContinuity.loopHealth.recommendedNextPhase, "stop");
  assert.match(stopped.workflowContinuity.loopHealth.loopHealthReason ?? "", /stop immediately/i);
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
  assert.equal(implemented.workflowContinuity.loopHealth.recommendedNextPhase, "validation");
  assert.match(implemented.workflowContinuity.loopHealth.loopHealthReason ?? "", /validation/i);
});

test("repo coding sessions derive explicit coding loop context from implementation and validation steps", () => {
  const created = createAutonomousSession({
    goal: "Stabilize web/lib/aie/autonomousSession.ts and validate the bounded coding loop.",
    sessionMode: "repo-coding",
  });
  const implemented = appendAutonomousStep(created, {
    proposedAction: "Apply the bounded implementation patch to web/lib/aie/autonomousSession.ts.",
    expectedOutcome: "The bounded implementation change should be ready for validation.",
    executionResult: {
      status: "success",
      output: "Implementation patch applied cleanly.",
      changedPaths: ["web/lib/aie/autonomousSession.ts"],
      diffSummary: "Added bounded repo coding loop continuity.",
    },
    nextDecision: "continue",
  });

  assert.equal(implemented.workflowContinuity.coding.codingLoopPhase, "validation-pending");
  assert.equal(implemented.workflowContinuity.coding.validationFirstActive, true);
  assert.match(implemented.workflowContinuity.coding.currentValidationTarget ?? "", /ready for validation/i);

  const validated = appendAutonomousStep(implemented, {
    proposedAction: "Run the bounded autonomous session validation target.",
    expectedOutcome: "The bounded coding loop validation should pass.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the repo coding loop summary mismatch.",
      commandLabel: "npx tsx --test lib/aie/autonomousSession.test.ts",
    },
    failureReason: "Validation still reports the repo coding loop summary mismatch.",
  });

  assert.equal(validated.sessionMode, "repo-coding");
  assert.equal(validated.workflowContinuity.coding.sessionMode, "repo-coding");
  assert.equal(validated.workflowContinuity.coding.codingLoopPhase, "validation-failed");
  assert.equal(validated.workflowContinuity.coding.targetScope, "web/lib/aie/autonomousSession.ts");
  assert.match(validated.workflowContinuity.coding.currentCodingObjective ?? "", /stabilize web\/lib\/aie\/autonomoussession\.ts/i);
  assert.match(validated.workflowContinuity.coding.currentDeliverableTarget ?? "", /ready for validation/i);
  assert.match(validated.workflowContinuity.coding.expectedOutputForm ?? "", /repo code change in web\/lib\/aie\/autonomousSession\.ts/i);
  assert.match(validated.workflowContinuity.coding.validationSuccessTarget ?? "", /bounded coding loop validation should pass/i);
  assert.match(validated.workflowContinuity.coding.currentAcceptanceTarget ?? "", /bounded coding loop validation should pass/i);
  assert.equal(validated.workflowContinuity.coding.currentTargetStatus, "validation-failed");
  assert.match(validated.workflowContinuity.coding.validationProves ?? "", /ready for validation/i);
  assert.equal(validated.workflowContinuity.coding.validationTargetMatchesDeliverable, true);
  assert.match(validated.workflowContinuity.coding.validationFailureImpact ?? "", /blocks acceptance/i);
  assert.equal(validated.workflowContinuity.coding.deliverableChangedDuringCorrectionOrEscalation, false);
  assert.match(validated.workflowContinuity.coding.acceptanceSummary ?? "", /status=validation-failed/i);
  assert.match(validated.workflowContinuity.coding.lastCodeChangeSummary ?? "", /changed=web\/lib\/aie\/autonomousSession\.ts/i);
  assert.match(validated.workflowContinuity.coding.lastImplementationSummary ?? "", /runtime=success/i);
  assert.match(validated.workflowContinuity.coding.lastValidationSummary ?? "", /runtime=failed/i);
  assert.match(validated.workflowContinuity.coding.lastValidationResultSummary ?? "", /runtime=failed/i);
  assert.equal(validated.workflowContinuity.coding.lastValidationPassed, false);
  assert.equal(validated.workflowContinuity.coding.validationFirstActive, true);
  assert.match(validated.workflowContinuity.coding.currentCorrectionTarget ?? "", /summary mismatch/i);
  assert.match(validated.workflowContinuity.coding.nextIntendedCodingAction ?? "", /run the bounded autonomous session validation target/i);
  assert.match(buildAutonomousSessionContextBlock(validated), /Coding loop phase: validation-failed/i);
  assert.match(buildAutonomousSessionContextBlock(validated), /Validation-first coding behavior active: true/i);
});

test("repo coding sessions mark correction pending and validation recovered after a successful bounded fix", () => {
  const created = createAutonomousSession({
    goal: "Correct a repo coding loop regression and revalidate the bounded fix.",
    sessionMode: "repo-coding",
  });
  const failedValidation = appendAutonomousStep(created, {
    proposedAction: "Run the bounded validation target.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same bounded regression.",
      commandLabel: "npm test",
    },
    failureReason: "Validation still reports the same bounded regression.",
  });
  const corrected = appendAutonomousStep(failedValidation, {
    proposedAction: "Apply the bounded correction patch to web/lib/aie/autonomousSession.ts.",
    expectedOutcome: "The bounded correction should be ready for validation.",
    executionResult: {
      status: "success",
      output: "Correction patch applied cleanly.",
      changedPaths: ["web/lib/aie/autonomousSession.ts"],
      diffSummary: "Adjusted the validation-first coding state derivation.",
    },
    nextDecision: "continue",
  });
  const recovered = appendAutonomousStep(corrected, {
    proposedAction: "Run the bounded validation target again.",
    expectedOutcome: "The bounded correction should now validate cleanly.",
    executionResult: {
      status: "success",
      output: "Validation passed after the bounded correction.",
      commandLabel: "npm test",
    },
    nextDecision: "continue",
  });

  assert.equal(corrected.workflowContinuity.coding.codingLoopPhase, "validation-pending");
  assert.match(corrected.workflowContinuity.coding.lastCorrectionSummary ?? "", /adjusted the validation-first coding state derivation/i);
  assert.match(corrected.workflowContinuity.coding.currentCorrectionTarget ?? "", /bounded regression/i);
  assert.equal(corrected.workflowContinuity.coding.currentTargetStatus, "awaiting-validation");
  assert.equal(recovered.workflowContinuity.coding.codingLoopPhase, "validation-recovered");
  assert.equal(recovered.workflowContinuity.coding.lastValidationPassed, true);
  assert.equal(recovered.workflowContinuity.coding.validationFirstActive, true);
  assert.equal(recovered.workflowContinuity.coding.currentCorrectionTarget, undefined);
  assert.equal(recovered.workflowContinuity.coding.deliverableAccepted, false);
  assert.equal(recovered.workflowContinuity.coding.completionState, "in-progress");
  assert.equal(recovered.workflowContinuity.coding.operatorConfirmationRequired, false);
  assert.equal(recovered.workflowContinuity.coding.shouldTerminateLoop, false);
  assert.equal(recovered.workflowContinuity.coding.currentTargetStatus, "accepted");
  assert.equal(recovered.workflowContinuity.coding.correctionMaintainsDeliverable, true);
  assert.match(recovered.workflowContinuity.coding.acceptanceReason ?? "", /approval-ready repo action/i);
  assert.match(recovered.workflowContinuity.coding.codingSummary ?? "", /last-validation=passed/i);
});

test("repo coding sessions track bounded output artifacts across implementation and correction iterations", () => {
  const created = createAutonomousSession({
    goal: "Produce a bounded repo output, correct it, and revalidate it.",
    sessionMode: "repo-coding",
  });
  const implemented = appendAutonomousStep(created, {
    proposedAction: "Apply the bounded implementation patch to web/lib/aie/autonomousSession.ts.",
    expectedOutcome: "The bounded repo output should be ready for validation.",
    executionResult: {
      status: "success",
      output: "Implementation patch applied cleanly.",
      changedPaths: ["web/lib/aie/autonomousSession.ts"],
      diffSummary: "Added bounded repo output artifact tracking.",
    },
    nextDecision: "continue",
  });
  const failedValidation = appendAutonomousStep(implemented, {
    proposedAction: "Run the bounded validation target.",
    expectedOutcome: "The bounded repo output should validate cleanly.",
    executionResult: {
      status: "failed",
      error: "Validation still reports that the output summary is incomplete.",
      commandLabel: "npx tsx --test lib/aie/autonomousSession.test.ts",
    },
    failureReason: "Validation still reports that the output summary is incomplete.",
  });
  const corrected = appendAutonomousStep(failedValidation, {
    proposedAction: "Apply the bounded correction patch to web/lib/aie/autonomousSession.ts.",
    expectedOutcome: "The bounded corrected output should be ready for validation.",
    executionResult: {
      status: "success",
      output: "Correction patch applied cleanly.",
      changedPaths: ["web/lib/aie/autonomousSession.ts"],
      diffSummary: "Updated output summaries to include iteration deltas.",
    },
    nextDecision: "continue",
  });
  const recovered = appendAutonomousStep(corrected, {
    proposedAction: "Run the bounded validation target again.",
    expectedOutcome: "The bounded corrected output should now validate cleanly.",
    executionResult: {
      status: "success",
      output: "Validation passed for the corrected output.",
      commandLabel: "npx tsx --test lib/aie/autonomousSession.test.ts",
    },
    nextDecision: "continue",
  });

  assert.equal(corrected.workflowContinuity.coding.outputArtifacts.length, 2);
  assert.equal(corrected.workflowContinuity.coding.outputArtifacts[0]?.filePath, "web/lib/aie/autonomousSession.ts");
  assert.match(corrected.workflowContinuity.coding.outputArtifacts[0]?.changeSummary ?? "", /first recorded output iteration/i);
  assert.match(corrected.workflowContinuity.coding.outputArtifacts[1]?.changeSummary ?? "", /changed from prior output iteration/i);
  assert.equal(corrected.workflowContinuity.coding.outputArtifacts[1]?.linkedToDeliverable, true);
  assert.equal(corrected.workflowContinuity.coding.outputLinkedToDeliverable, true);
  assert.match(corrected.workflowContinuity.coding.lastOutputSummary ?? "", /updated output summaries to include iteration deltas/i);
  assert.match(recovered.workflowContinuity.coding.validationProves ?? "", /produced output/i);
  assert.match(recovered.workflowContinuity.coding.currentAcceptanceTarget ?? "", /accept the produced output/i);
  assert.match(recovered.workflowContinuity.coding.acceptanceSummary ?? "", /output-linked=true/i);
  assert.match(buildAutonomousSessionContextBlock(recovered), /Output linked to deliverable: true/i);
  assert.match(buildAutonomousSessionContextBlock(recovered), /Output artifacts:/i);
});

test("repo coding sessions keep repeated validation in progress until a repo action can be derived", () => {
  const created = createAutonomousSession({
    goal: "Deliver a bounded repo coding fix and close it cleanly.",
    sessionMode: "repo-coding",
  });
  const implemented = appendAutonomousStep(created, {
    proposedAction: "Apply the bounded implementation patch to web/lib/aie/autonomousSession.ts.",
    expectedOutcome: "The bounded repo coding fix should be ready for validation.",
    executionResult: {
      status: "success",
      output: "Implementation patch applied cleanly.",
      changedPaths: ["web/lib/aie/autonomousSession.ts"],
      diffSummary: "Updated completion closure derivation.",
    },
    nextDecision: "continue",
  });
  const firstSuccess = appendAutonomousStep(implemented, {
    proposedAction: "Run the bounded validation target.",
    expectedOutcome: "The bounded repo coding fix should validate cleanly.",
    executionResult: {
      status: "success",
      output: "Validation passed for the bounded repo coding fix.",
      commandLabel: "npm test",
    },
    nextDecision: "continue",
  });
  const accepted = appendAutonomousStep(firstSuccess, {
    proposedAction: "Run the bounded validation target again.",
    expectedOutcome: "The bounded repo coding fix should still validate cleanly without regression.",
    executionResult: {
      status: "success",
      output: "Validation passed again without regression.",
      commandLabel: "npm test",
    },
    nextDecision: "continue",
  });

  assert.equal(firstSuccess.workflowContinuity.coding.completionState, "in-progress");
  assert.equal(accepted.workflowContinuity.coding.deliverableAccepted, false);
  assert.equal(accepted.workflowContinuity.coding.completionState, "in-progress");
  assert.equal(accepted.workflowContinuity.coding.acceptanceConfidence, "low");
  assert.equal(accepted.workflowContinuity.coding.operatorConfirmationRequired, false);
  assert.equal(accepted.workflowContinuity.coding.shouldTerminateLoop, false);
  assert.match(accepted.workflowContinuity.coding.acceptanceReason ?? "", /approval-ready repo action/i);
  assert.notEqual(accepted.latestCompletion?.status, "complete");
  assert.match(buildAutonomousSessionContextBlock(accepted), /Completion state: in-progress/i);
});

test("repo coding sessions derive supervised repo actions from accepted materialized outputs", () => {
  const created = createAutonomousSession({
    goal: "Deliver a bounded repo coding fix and hand off a supervised repo action.",
    sessionMode: "repo-coding",
  });
  const implemented = appendAutonomousStep(created, {
    proposedAction: "Prepare the bounded implementation output for web/sandbox/repo-action.txt.",
    expectedOutcome: "The bounded repo coding fix should be ready for validation.",
    executedActionPreview: {
      id: "simulated-materialized-output",
      type: "file-write",
      scope: "caution",
      description: "Prepare the bounded implementation output for web/sandbox/repo-action.txt.",
      expectedOutcome: "The bounded repo coding fix should be ready for validation.",
      requiresApproval: true,
      metadata: {
        sourceActionType: "file-write",
        targetPath: "web/sandbox/repo-action.txt",
        allowedRoot: "web/sandbox",
        content: "phase-5f materialized output",
      },
    },
    executionResult: {
      status: "success",
      output: "Implementation output materialized for later supervised application.",
      changedPaths: ["web/sandbox/repo-action.txt"],
      diffSummary: "Created new file with 1 lines.",
    },
    nextDecision: "continue",
  });
  const firstSuccess = appendAutonomousStep(implemented, {
    proposedAction: "Run the bounded validation target.",
    expectedOutcome: "The bounded repo coding fix should validate cleanly.",
    executionResult: {
      status: "success",
      output: "Validation passed for the bounded repo coding fix.",
      commandLabel: "npm test",
    },
    nextDecision: "continue",
  });
  const accepted = appendAutonomousStep(firstSuccess, {
    proposedAction: "Run the bounded validation target again.",
    expectedOutcome: "The bounded repo coding fix should still validate cleanly without regression.",
    executionResult: {
      status: "success",
      output: "Validation passed again without regression.",
      commandLabel: "npm test",
    },
    nextDecision: "continue",
  });

  assert.equal(accepted.workflowContinuity.coding.deliverableAccepted, true);
  assert.equal(accepted.workflowContinuity.coding.pendingRepoActions.length, 1);
  assert.equal(accepted.workflowContinuity.coding.executedRepoActions.length, 0);
  assert.equal(accepted.workflowContinuity.coding.shouldTerminateLoop, false);
  assert.equal(accepted.workflowContinuity.coding.pendingRepoActions[0]?.artifactFilePaths[0], "web/sandbox/repo-action.txt");
  assert.equal(accepted.workflowContinuity.coding.pendingRepoActions[0]?.executionPreview?.type, "file-write");
  assert.match(accepted.workflowContinuity.coding.repoActionSummary ?? "", /pending=1/i);
  assert.match(buildAutonomousSessionContextBlock(accepted), /Pending repo actions:/i);
});

test("repo coding sessions do not derive supervised repo actions from incomplete output artifacts", () => {
  const created = createAutonomousSession({
    goal: "Deliver a bounded repo coding fix without allowing an unsafe closeout.",
    sessionMode: "repo-coding",
  });
  const implemented = appendAutonomousStep(created, {
    proposedAction: "Prepare the bounded implementation output for web/sandbox/incomplete-repo-action.txt.",
    expectedOutcome: "The bounded repo coding fix should be ready for validation.",
    executionResult: {
      status: "success",
      output: "Implementation output changed the repo file, but no materialized preview was preserved.",
      changedPaths: ["web/sandbox/incomplete-repo-action.txt"],
      diffSummary: "Created new file with 1 lines.",
    },
    nextDecision: "continue",
  });
  const firstSuccess = appendAutonomousStep(implemented, {
    proposedAction: "Run the bounded validation target.",
    expectedOutcome: "The bounded repo coding fix should validate cleanly.",
    executionResult: {
      status: "success",
      output: "Validation passed for the bounded repo coding fix.",
      commandLabel: "npm test",
    },
    nextDecision: "continue",
  });
  const accepted = appendAutonomousStep(firstSuccess, {
    proposedAction: "Run the bounded validation target again.",
    expectedOutcome: "The bounded repo coding fix should still validate cleanly without regression.",
    executionResult: {
      status: "success",
      output: "Validation passed again without regression.",
      commandLabel: "npm test",
    },
    nextDecision: "continue",
  });

  assert.equal(accepted.workflowContinuity.coding.deliverableAccepted, false);
  assert.equal(accepted.workflowContinuity.coding.completionState, "in-progress");
  assert.equal(accepted.workflowContinuity.coding.operatorConfirmationRequired, false);
  assert.equal(accepted.workflowContinuity.coding.shouldTerminateLoop, false);
  assert.equal(accepted.workflowContinuity.coding.pendingRepoActions.length, 0);
  assert.equal(accepted.workflowContinuity.coding.repoActionSummary, undefined);
  assert.match(accepted.workflowContinuity.coding.acceptanceReason ?? "", /approval-ready repo action/i);
});

test("repo coding sessions allow bounded operator confirmation and rejection for deliverable closure", () => {
  const failedValidation = appendAutonomousStep(createAutonomousSession({
    goal: "Close a bounded repo deliverable with explicit operator confirmation.",
    sessionMode: "repo-coding",
  }), {
    proposedAction: "Run the bounded validation target.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the bounded deliverable regression.",
      commandLabel: "npm test",
    },
    failureReason: "Validation still reports the bounded deliverable regression.",
  });
  const corrected = appendAutonomousStep(failedValidation, {
    proposedAction: "Apply the bounded correction patch to web/lib/aie/autonomousSession.ts.",
    expectedOutcome: "The bounded deliverable should be ready for validation.",
    executedActionPreview: {
      id: "confirmed-repo-action-preview",
      type: "file-write",
      scope: "caution",
      description: "Prepare the bounded deliverable output for web/sandbox/confirmed-repo-action.txt.",
      expectedOutcome: "The bounded deliverable should be ready for validation.",
      requiresApproval: true,
      metadata: {
        sourceActionType: "file-write",
        targetPath: "web/sandbox/confirmed-repo-action.txt",
        allowedRoot: "web/sandbox",
        content: "confirmed bounded deliverable output",
      },
    },
    executionResult: {
      status: "success",
      output: "Correction patch applied cleanly.",
      changedPaths: ["web/sandbox/confirmed-repo-action.txt"],
      diffSummary: "Prepared deliverable closure state.",
    },
    nextDecision: "continue",
  });
  const ready = appendAutonomousStep(corrected, {
    proposedAction: "Run the bounded validation target.",
    expectedOutcome: "The bounded deliverable should now validate cleanly.",
    executionResult: {
      status: "success",
      output: "Validation passed for the bounded deliverable.",
      commandLabel: "npm test",
    },
    nextDecision: "continue",
  });
  const rejected = updateAutonomousSessionSteering(ready, {
    action: "reject-deliverable-acceptance",
    operatorNote: "The deliverable still needs one more bounded correction before closure.",
  });
  const confirmed = updateAutonomousSessionSteering(ready, {
    action: "confirm-deliverable-acceptance",
    operatorNote: "The deliverable is accepted and can close.",
  });

  assert.equal(ready.workflowContinuity.coding.completionState, "ready-for-acceptance");
  assert.equal(rejected.workflowContinuity.coding.completionState, "rejected");
  assert.equal(rejected.workflowContinuity.coding.deliverableAccepted, false);
  assert.match(rejected.workflowContinuity.coding.acceptanceReason ?? "", /needs one more bounded correction/i);
  assert.equal(confirmed.workflowContinuity.coding.completionState, "accepted");
  assert.equal(confirmed.workflowContinuity.coding.deliverableAccepted, true);
  assert.equal(confirmed.workflowContinuity.coding.pendingRepoActions.length, 1);
  assert.equal(confirmed.workflowContinuity.coding.shouldTerminateLoop, false);
  assert.notEqual(confirmed.status, "completed");
  assert.notEqual(confirmed.latestCompletion?.status, "complete");
  assert.equal(confirmed.completedReason, undefined);
});

test("repo coding sessions surface escalation and supervised recovery as coding loop phases", () => {
  const failedValidation = appendAutonomousStep(createAutonomousSession({
    goal: "Keep a repo coding loop bounded when validation keeps failing.",
    sessionMode: "repo-coding",
  }), {
    proposedAction: "Run the bounded validation target.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved repo failure.",
      commandLabel: "npm test",
    },
    failureReason: "Validation still reports the same unresolved repo failure.",
  });
  const reviewedOne = updateAutonomousSessionSteering(failedValidation, {
    action: "accept-current-recommendation",
    operatorNote: "Accept the current bounded recommendation once.",
  });
  const secondFailure = appendAutonomousStep(reviewedOne, {
    proposedAction: "Run the bounded validation target again.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved repo failure.",
      commandLabel: "npm test",
    },
    failureReason: "Validation still reports the same unresolved repo failure.",
  });
  const acceptedTwo = updateAutonomousSessionSteering(secondFailure, {
    action: "accept-current-recommendation",
    operatorNote: "Accept the current bounded recommendation a second time.",
  });
  const escalated = updateAutonomousSessionSteering(acceptedTwo, {
    action: "prefer-validation-next",
    overrideReason: "The accepted recommendation still needs correction, so escalate to a supervised recovery choice.",
  });
  const selectedRecovery = updateAutonomousSessionSteering(escalated, {
    action: "prefer-validation-next",
    overrideReason: "Select the supervised validation-first recovery path.",
  });
  const recovered = appendAutonomousStep(selectedRecovery, {
    proposedAction: "Run the supervised validation-first recovery step.",
    executionResult: {
      status: "success",
      output: "The supervised validation-first recovery step restored the bounded validation path.",
      commandLabel: "npm test",
    },
    nextDecision: "continue",
  });

  assert.equal(escalated.workflowContinuity.coding.codingLoopPhase, "escalation");
  assert.equal(escalated.workflowContinuity.coding.validationFirstActive, true);
  assert.equal(escalated.workflowContinuity.coding.repeatedValidationFailureDrivingEscalation, true);
  assert.equal(recovered.workflowContinuity.coding.codingLoopPhase, "supervised-recovery");
  assert.equal(recovered.workflowContinuity.coding.supervisedRecoveryActive, true);
  assert.equal(recovered.workflowContinuity.coding.repeatedValidationFailureDrivingEscalation, false);
  assert.match(recovered.workflowContinuity.coding.codingSummary ?? "", /phase=supervised-recovery/i);
});

test("autonomous sessions mark repeated ineffective validation loops as stalled", () => {
  const first = appendAutonomousStep(createAutonomousSession({ goal: "Confirm the validation loop stops when it stalls." }), {
    proposedAction: "Run the bounded validation command.",
    expectedOutcome: "The validation output should report a healthy result.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });
  const second = appendAutonomousStep(first, {
    proposedAction: "Run the bounded validation command.",
    expectedOutcome: "The validation output should report a healthy result.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });
  const third = appendAutonomousStep(second, {
    proposedAction: "Run the bounded validation command.",
    expectedOutcome: "The validation output should report a healthy result.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });

  assert.equal(third.workflowContinuity.loopHealth.currentPhaseRepeatCount, 3);
  assert.equal(third.workflowContinuity.loopHealth.stalledLoop, true);
  assert.equal(third.workflowContinuity.loopHealth.operatorInterventionPreferred, true);
  assert.equal(third.workflowContinuity.loopHealth.recommendationConfidence, "low");
  assert.equal(third.workflowContinuity.loopHealth.likelyNeedsOperatorInput, true);
  assert.deepEqual(third.workflowContinuity.loopHealth.topContributingSignals, ["stalled-loop-indicators"]);
  assert.match(third.workflowContinuity.loopHealth.recommendationRationaleSummary ?? "", /stalled/i);
  assert.equal(third.workflowContinuity.loopHealth.recommendedNextPhase, "waiting-on-operator");
  assert.match(third.workflowContinuity.loopHealth.loopHealthReason ?? "", /same ineffective phase/i);
  assert.match(buildAutonomousSessionContextBlock(third), /Recommendation confidence: low/i);
  assert.match(buildAutonomousSessionContextBlock(third), /Top recommendation signals: stalled-loop-indicators/i);
  assert.match(buildAutonomousSessionContextBlock(third), /Recommended next phase: waiting-on-operator/i);
});

test("autonomous sessions persist and apply supervised steering overrides", () => {
  const implemented = appendAutonomousStep(createAutonomousSession({ goal: "Steer the bounded loop toward validation." }), {
    proposedAction: "Apply the bounded fix patch.",
    executionResult: {
      status: "success",
      output: "Patch applied cleanly.",
      changedPaths: ["web/lib/aie/autonomousSession.ts"],
      diffSummary: "Updated workflow continuity derivation.",
    },
    nextDecision: "continue",
  });
  const steered = updateAutonomousSessionSteering(implemented, {
    action: "prefer-validation-next",
    operatorNote: "Validate before another fix loop.",
  });
  const resumed = resumeAutonomousSession(pauseAutonomousSession(steered, "Waiting for operator review."), {
    reason: "Operator review finished.",
  });

  assert.equal(steered.workflowContinuity.steering.requestedAction, "prefer-validation-next");
  assert.equal(steered.workflowContinuity.steering.requestedNextPhaseOverride, "validation");
  assert.equal(steered.workflowContinuity.steering.status, "pending");
  assert.equal(steered.workflowContinuity.loopHealth.systemRecommendedNextPhase, "validation");
  assert.equal(steered.workflowContinuity.loopHealth.recommendedNextPhase, "validation");
  assert.match(steered.workflowContinuity.loopHealth.loopHealthReason ?? "", /operator requested validation/i);
  assert.match(buildAutonomousSessionContextBlock(steered), /Operator override request: prefer-validation-next/i);
  assert.equal(resumed.workflowContinuity.steering.status, "pending");
});

test("autonomous sessions record accepted recommendation reviews and bounded follow-up progress", () => {
  const implemented = appendAutonomousStep(createAutonomousSession({ goal: "Review and confirm the current recommendation." }), {
    proposedAction: "Apply the bounded change set.",
    executionResult: {
      status: "success",
      output: "Implementation finished cleanly and is ready for validation.",
    },
    nextDecision: "continue",
  });
  const reviewed = updateAutonomousSessionSteering(implemented, {
    action: "accept-current-recommendation",
    operatorNote: "The current validation recommendation is appropriate.",
  });
  const progressed = appendAutonomousStep(reviewed, {
    proposedAction: "Run the bounded validation command.",
    executionResult: {
      status: "success",
      output: "Validation confirmed the bounded implementation change.",
    },
    nextDecision: "continue",
  });

  assert.equal(reviewed.workflowContinuity.steering.status, "applied");
  assert.equal(reviewed.workflowContinuity.review.history.length, 1);
  assert.equal(reviewed.workflowContinuity.review.history[0]?.operatorResponse, "accept-current-recommendation");
  assert.equal(progressed.workflowContinuity.review.lastOperatorResponse, "accept-current-recommendation");
  assert.equal(progressed.workflowContinuity.review.lastRecommendationOutcome, "helped-progress");
  assert.equal(progressed.workflowContinuity.review.lastFollowThroughStatus, "accepted-and-succeeded");
  assert.equal(progressed.workflowContinuity.review.lastAcceptedRecommendationOutcome, "accepted-and-succeeded");
  assert.equal(progressed.workflowContinuity.review.lastReviewImprovedProgress, true);
  assert.equal(progressed.workflowContinuity.review.lastRecommendationNeededCorrection, false);
  assert.equal(progressed.workflowContinuity.review.followThroughLedUsefulProgress, true);
  assert.equal(progressed.workflowContinuity.review.followThroughRequiredCorrection, false);
  assert.match(buildAutonomousSessionContextBlock(progressed), /Last operator review response: accept-current-recommendation/i);
  assert.match(buildAutonomousSessionContextBlock(progressed), /Last recommendation review outcome: helped-progress/i);
});

test("autonomous sessions block impossible restart overrides and preserve why", () => {
  const blocked = updateAutonomousSessionSteering(createAutonomousSession({ goal: "Try a restart without a safe step." }), {
    action: "restart-from-last-safe-boundary",
    restartReason: "The loop should restart from the last verified checkpoint.",
  });

  assert.equal(blocked.workflowContinuity.steering.status, "blocked");
  assert.match(blocked.workflowContinuity.steering.blockedReason ?? "", /no last safe boundary/i);
  assert.equal(blocked.workflowContinuity.loopHealth.recommendedNextPhase, "planning");
});

test("autonomous sessions can clear a supervised steering override", () => {
  const steered = updateAutonomousSessionSteering(createAutonomousSession({ goal: "Clear an operator override." }), {
    action: "stop-loop",
    stopReason: "The loop no longer adds useful evidence.",
  });
  const cleared = clearAutonomousSessionSteering(steered);

  assert.equal(steered.workflowContinuity.steering.status, "applied");
  assert.equal(steered.workflowContinuity.loopHealth.recommendedNextPhase, "stop");
  assert.equal(cleared.workflowContinuity.steering.status, "none");
  assert.equal(cleared.workflowContinuity.steering.requestedAction, undefined);
});

test("autonomous sessions carry bounded refinement history and mark progress from prior operator guidance", () => {
  const failedValidation = appendAutonomousStep(createAutonomousSession({ goal: "Refine repeated validation loops." }), {
    proposedAction: "Run the bounded validation command.",
    expectedOutcome: "The validation output should report a healthy result.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });
  const steered = updateAutonomousSessionSteering(failedValidation, {
    action: "prefer-validation-next",
    overrideReason: "A fix would be premature until the validation path is rechecked.",
    operatorNote: "Run validation one more time before switching to a fix.",
  });
  const successfulValidation = appendAutonomousStep(steered, {
    proposedAction: "Run the bounded validation command.",
    expectedOutcome: "The validation output should report a healthy result.",
    executionResult: {
      status: "success",
      output: "Validation produced new signal and narrowed the problem safely.",
    },
    nextDecision: "continue",
  });
  const cleared = clearAutonomousSessionSteering(successfulValidation);
  const repeatedFailure = appendAutonomousStep(cleared, {
    proposedAction: "Run the bounded validation command.",
    expectedOutcome: "The validation output should report a healthy result.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });

  assert.equal(successfulValidation.workflowContinuity.refinement.history.length, 1);
  assert.equal(successfulValidation.workflowContinuity.refinement.lastOverrideReason, "A fix would be premature until the validation path is rechecked.");
  assert.equal(successfulValidation.workflowContinuity.refinement.recentOverridesImprovedProgress, true);
  assert.equal(repeatedFailure.workflowContinuity.loopHealth.systemRecommendedNextPhase, "fix");
  assert.equal(repeatedFailure.workflowContinuity.refinement.recommendationInfluencedByRecentGuidance, true);
  assert.equal(repeatedFailure.workflowContinuity.refinement.influencedRecommendedNextPhase, "validation");
  assert.match(repeatedFailure.workflowContinuity.loopHealth.recommendationRationaleSummary ?? "", /premature until the validation path is rechecked/i);
  assert.match(repeatedFailure.workflowContinuity.loopHealth.topContributingSignals.join(" | "), /helpful-operator-overrides/i);
  assert.equal(repeatedFailure.workflowContinuity.loopHealth.recommendedNextPhase, "validation");
  assert.match(repeatedFailure.workflowContinuity.loopHealth.loopHealthReason ?? "", /premature until the validation path is rechecked/i);
  assert.match(buildAutonomousSessionContextBlock(repeatedFailure), /Recommendation influenced by recent guidance: true/i);
});

test("autonomous sessions track repeated recommendation redirects and mark when correction was needed", () => {
  const implemented = appendAutonomousStep(createAutonomousSession({ goal: "Redirect repeated recommendations when needed." }), {
    proposedAction: "Apply the first bounded change set.",
    executionResult: {
      status: "success",
      output: "Implementation finished and is ready for validation.",
    },
    nextDecision: "continue",
  });
  const firstRedirect = updateAutonomousSessionSteering(implemented, {
    action: "prefer-fix-next",
    overrideReason: "Another bounded fix is safer than validating too early.",
  });
  const corrected = appendAutonomousStep(firstRedirect, {
    proposedAction: "Apply the follow-up bounded fix.",
    executionResult: {
      status: "success",
      output: "The follow-up fix removed the remaining issue.",
    },
    nextDecision: "continue",
  });
  const secondRedirect = updateAutonomousSessionSteering(corrected, {
    action: "prefer-fix-next",
    overrideReason: "One more bounded fix is still safer than a validation hop.",
  });

  assert.equal(corrected.workflowContinuity.review.lastRecommendationOutcome, "needed-correction");
  assert.equal(corrected.workflowContinuity.review.lastFollowThroughStatus, "redirected-and-improved-progress");
  assert.equal(corrected.workflowContinuity.review.lastRedirectedRecommendationOutcome, "redirected-and-improved-progress");
  assert.equal(corrected.workflowContinuity.review.lastReviewImprovedProgress, true);
  assert.equal(corrected.workflowContinuity.review.lastRecommendationNeededCorrection, true);
  assert.equal(corrected.workflowContinuity.review.followThroughLedUsefulProgress, true);
  assert.equal(corrected.workflowContinuity.review.followThroughRequiredCorrection, true);
  assert.equal(secondRedirect.workflowContinuity.review.frequentlyOverridden, true);
  assert.match(secondRedirect.workflowContinuity.review.reviewSummary ?? "", /prefer-fix-next/i);
  assert.match(buildAutonomousSessionContextBlock(secondRedirect), /Recommendation frequently overridden: true/i);
});

test("autonomous sessions mark repeated reviewed recommendations with no useful follow-through progress", () => {
  const failedValidation = appendAutonomousStep(createAutonomousSession({ goal: "Track repeated recommendation follow-through without progress." }), {
    proposedAction: "Run the bounded validation command.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });
  const accepted = updateAutonomousSessionSteering(failedValidation, {
    action: "accept-current-recommendation",
    operatorNote: "Accept the current fix recommendation and follow it through.",
  });
  const repeatedFailure = appendAutonomousStep(accepted, {
    proposedAction: "Run the bounded validation command again.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });

  assert.equal(repeatedFailure.workflowContinuity.review.lastRecommendationOutcome, "no-clear-improvement");
  assert.equal(repeatedFailure.workflowContinuity.review.lastFollowThroughStatus, "repeated-review-no-progress");
  assert.equal(repeatedFailure.workflowContinuity.review.lastAcceptedRecommendationOutcome, "repeated-review-no-progress");
  assert.equal(repeatedFailure.workflowContinuity.review.followThroughLedUsefulProgress, false);
  assert.equal(repeatedFailure.workflowContinuity.review.returnedToSameRecommendationAgain, true);
  assert.equal(repeatedFailure.workflowContinuity.review.repeatedReviewWithoutProgress, false);
});

test("autonomous sessions recommend alternate recovery paths when redirected recommendations outperform the system repeatedly", () => {
  const implemented = appendAutonomousStep(createAutonomousSession({ goal: "Prefer a repeated alternate fix-first path when redirects help." }), {
    proposedAction: "Apply the first bounded implementation change.",
    executionResult: {
      status: "success",
      output: "Implementation completed and is ready for validation.",
    },
    nextDecision: "continue",
  });
  const redirectOne = updateAutonomousSessionSteering(implemented, {
    action: "prefer-fix-next",
    overrideReason: "A bounded fix-first path is safer than validating too early.",
  });
  const fixOne = appendAutonomousStep(redirectOne, {
    proposedAction: "Apply the first bounded follow-up fix.",
    executionResult: {
      status: "success",
      output: "The first follow-up fix improved the bounded state.",
    },
    nextDecision: "continue",
  });
  const cleared = clearAutonomousSessionSteering(fixOne);
  const implementedAgain = appendAutonomousStep(cleared, {
    proposedAction: "Apply the second bounded implementation change.",
    executionResult: {
      status: "success",
      output: "Another implementation change is ready for review.",
    },
    nextDecision: "continue",
  });
  const redirectTwo = updateAutonomousSessionSteering(implementedAgain, {
    action: "prefer-fix-next",
    overrideReason: "The recent redirected fix-first path outperformed the default recommendation.",
  });
  const fixTwo = appendAutonomousStep(redirectTwo, {
    proposedAction: "Apply the second bounded follow-up fix.",
    executionResult: {
      status: "success",
      output: "The second follow-up fix improved the bounded state again.",
    },
    nextDecision: "continue",
  });

  assert.equal(fixTwo.workflowContinuity.escalation.escalationStatus, "alternate-path-recommended");
  assert.equal(fixTwo.workflowContinuity.escalation.recoveryRecommendation, "fix-first");
  assert.equal(fixTwo.workflowContinuity.escalation.redirectedRecommendationsOutperformSystem, true);
  assert.match(fixTwo.workflowContinuity.escalation.recoverySummary ?? "", /fix-first/i);
});

test("autonomous sessions escalate to operator intervention when accepted recommendations repeatedly require correction", () => {
  const failedValidation = appendAutonomousStep(createAutonomousSession({ goal: "Escalate when accepted recommendations keep needing correction." }), {
    proposedAction: "Run the bounded validation command.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });
  const acceptedOne = updateAutonomousSessionSteering(failedValidation, {
    action: "accept-current-recommendation",
    operatorNote: "Accept the current recommendation before redirecting if needed.",
  });
  const correctedOne = updateAutonomousSessionSteering(acceptedOne, {
    action: "prefer-validation-next",
    overrideReason: "The accepted recommendation still needs correction.",
  });
  const repeatedFailure = appendAutonomousStep(correctedOne, {
    proposedAction: "Run the bounded validation command again.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });
  const acceptedTwo = updateAutonomousSessionSteering(repeatedFailure, {
    action: "accept-current-recommendation",
    operatorNote: "Accept the latest recommendation again for one more bounded attempt.",
  });
  const correctedTwo = updateAutonomousSessionSteering(acceptedTwo, {
    action: "prefer-validation-next",
    overrideReason: "The accepted recommendation needed correction again.",
  });

  assert.equal(correctedTwo.workflowContinuity.escalation.escalationStatus, "operator-intervention-recommended");
  assert.equal(correctedTwo.workflowContinuity.escalation.recoveryRecommendation, "operator-intervention");
  assert.equal(correctedTwo.workflowContinuity.escalation.acceptedRecommendationsRepeatedlyRequiringCorrection, true);
  assert.equal(correctedTwo.workflowContinuity.escalation.likelyNeedsOperatorInterventionNow, true);
  assert.match(correctedTwo.workflowContinuity.escalation.escalationSummary ?? "", /requiring correction/i);
});

test("autonomous sessions recommend stopping loops after repeated ineffective reviewed follow-through cycles", () => {
  const firstFailure = appendAutonomousStep(createAutonomousSession({ goal: "Stop when repeated review cycles do not improve progress." }), {
    proposedAction: "Run the bounded validation command.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });
  const reviewedOne = updateAutonomousSessionSteering(firstFailure, {
    action: "accept-current-recommendation",
    operatorNote: "Accept the current recommendation for another bounded validation attempt.",
  });
  const secondFailure = appendAutonomousStep(reviewedOne, {
    proposedAction: "Run the bounded validation command again.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });
  const reviewedTwo = updateAutonomousSessionSteering(secondFailure, {
    action: "accept-current-recommendation",
    operatorNote: "Accept the current recommendation for one final bounded validation attempt.",
  });
  const thirdFailure = appendAutonomousStep(reviewedTwo, {
    proposedAction: "Run the bounded validation command a third time.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });

  assert.equal(thirdFailure.workflowContinuity.escalation.escalationStatus, "stop-recommended");
  assert.equal(thirdFailure.workflowContinuity.escalation.recoveryRecommendation, "stop-loop");
  assert.equal(thirdFailure.workflowContinuity.escalation.repeatedIneffectiveReviewCycles, true);
  assert.equal(thirdFailure.workflowContinuity.escalation.likelyNeedsOperatorInterventionNow, true);
  assert.match(thirdFailure.workflowContinuity.escalation.recoverySummary ?? "", /stopping the current loop/i);
});

test("autonomous sessions open an explicit handoff when escalation is waiting on an operator recovery choice", () => {
  const failedValidation = appendAutonomousStep(createAutonomousSession({ goal: "Wait for a supervised recovery decision after escalation." }), {
    proposedAction: "Run the bounded validation command.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });
  const reviewedOne = updateAutonomousSessionSteering(failedValidation, {
    action: "accept-current-recommendation",
    operatorNote: "Accept the current recommendation for another bounded validation attempt.",
  });
  const secondFailure = appendAutonomousStep(reviewedOne, {
    proposedAction: "Run the bounded validation command again.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });
  const reviewedTwo = updateAutonomousSessionSteering(secondFailure, {
    action: "accept-current-recommendation",
    operatorNote: "Accept the current recommendation for one final bounded validation attempt.",
  });
  const thirdFailure = appendAutonomousStep(reviewedTwo, {
    proposedAction: "Run the bounded validation command a third time.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });

  assert.equal(thirdFailure.workflowContinuity.escalation.escalationStatus, "stop-recommended");
  assert.equal(thirdFailure.workflowContinuity.handoff.handoffStatus, "waiting-on-operator-decision");
  assert.equal(thirdFailure.workflowContinuity.handoff.waitingOnOperatorDecision, true);
  assert.equal(thirdFailure.workflowContinuity.handoff.secondEscalationNeeded, true);
  assert.match(thirdFailure.workflowContinuity.handoff.handoffSummary ?? "", /waiting/i);
});

test("autonomous sessions track supervised recovery execution after the operator selects a bounded recovery path", () => {
  const implemented = appendAutonomousStep(createAutonomousSession({ goal: "Execute a supervised recovery path after escalation." }), {
    proposedAction: "Apply the first bounded implementation change.",
    executionResult: {
      status: "success",
      output: "Implementation completed and is ready for validation.",
    },
    nextDecision: "continue",
  });
  const redirectOne = updateAutonomousSessionSteering(implemented, {
    action: "prefer-fix-next",
    overrideReason: "A bounded fix-first path is safer than validating too early.",
  });
  const fixOne = appendAutonomousStep(redirectOne, {
    proposedAction: "Apply the first bounded follow-up fix.",
    executionResult: {
      status: "success",
      output: "The first follow-up fix improved the bounded state.",
    },
    nextDecision: "continue",
  });
  const cleared = clearAutonomousSessionSteering(fixOne);
  const implementedAgain = appendAutonomousStep(cleared, {
    proposedAction: "Apply the second bounded implementation change.",
    executionResult: {
      status: "success",
      output: "Another implementation change is ready for review.",
    },
    nextDecision: "continue",
  });
  const redirectTwo = updateAutonomousSessionSteering(implementedAgain, {
    action: "prefer-fix-next",
    overrideReason: "The recent redirected fix-first path outperformed the default recommendation.",
  });
  const fixTwo = appendAutonomousStep(redirectTwo, {
    proposedAction: "Apply the second bounded follow-up fix.",
    executionResult: {
      status: "success",
      output: "The second follow-up fix improved the bounded state again.",
    },
    nextDecision: "continue",
  });
  const selectedRecovery = updateAutonomousSessionSteering(fixTwo, {
    action: "prefer-fix-next",
    overrideReason: "Use the supervised fix-first recovery path now that the alternate path escalation is active.",
  });
  const recovered = appendAutonomousStep(selectedRecovery, {
    proposedAction: "Apply the supervised fix-first recovery step.",
    executionResult: {
      status: "success",
      output: "The supervised fix-first recovery path improved progress.",
    },
    nextDecision: "continue",
  });

  assert.equal(selectedRecovery.workflowContinuity.handoff.history.length >= 1, true);
  assert.equal(recovered.workflowContinuity.handoff.handoffStatus, "recovery-completed");
  assert.equal(recovered.workflowContinuity.handoff.selectedRecoveryAction, "prefer-fix-next");
  assert.equal(recovered.workflowContinuity.handoff.selectedRecoveryMode, "fix-first");
  assert.equal(recovered.workflowContinuity.handoff.recoveryExecutionCompleted, true);
  assert.equal(recovered.workflowContinuity.handoff.recoveryImprovedProgress, true);
  assert.match(recovered.workflowContinuity.handoff.recoveryExecutionSummary ?? "", /improved progress/i);
});

test("autonomous sessions mark a second escalation when a selected supervised recovery path still does not improve progress", () => {
  const failedValidation = appendAutonomousStep(createAutonomousSession({ goal: "Require a second escalation after an ineffective supervised recovery path." }), {
    proposedAction: "Run the bounded validation command.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });
  const acceptedOne = updateAutonomousSessionSteering(failedValidation, {
    action: "accept-current-recommendation",
    operatorNote: "Accept the current recommendation before redirecting if needed.",
  });
  const correctedOne = updateAutonomousSessionSteering(acceptedOne, {
    action: "prefer-validation-next",
    overrideReason: "The accepted recommendation still needs correction.",
  });
  const repeatedFailure = appendAutonomousStep(correctedOne, {
    proposedAction: "Run the bounded validation command again.",
    executionResult: {
      status: "failed",
      error: "Validation still reports the same unresolved failure.",
    },
    failureReason: "Validation still reports the same unresolved failure.",
  });
  const acceptedTwo = updateAutonomousSessionSteering(repeatedFailure, {
    action: "accept-current-recommendation",
    operatorNote: "Accept the latest recommendation again for one more bounded attempt.",
  });
  const correctedTwo = updateAutonomousSessionSteering(acceptedTwo, {
    action: "prefer-validation-next",
    overrideReason: "The accepted recommendation needed correction again.",
  });
  const selectedRecovery = updateAutonomousSessionSteering(correctedTwo, {
    action: "prefer-validation-next",
    overrideReason: "Select the supervised validation-first recovery path for this escalation.",
  });
  const failedRecovery = appendAutonomousStep(selectedRecovery, {
    proposedAction: "Run the supervised validation-first recovery step.",
    executionResult: {
      status: "failed",
      error: "The supervised recovery path still did not improve progress.",
    },
    failureReason: "The supervised recovery path still did not improve progress.",
  });

  assert.equal(failedRecovery.workflowContinuity.escalation.escalationStatus, "stop-recommended");
  assert.equal(failedRecovery.workflowContinuity.handoff.handoffStatus, "waiting-on-operator-decision");
  assert.equal(failedRecovery.workflowContinuity.handoff.secondEscalationNeeded, true);
  assert.equal(failedRecovery.workflowContinuity.handoff.waitingOnOperatorDecision, true);
  assert.equal(failedRecovery.workflowContinuity.handoff.selectedRecoveryAction, "prefer-validation-next");
  assert.equal(failedRecovery.workflowContinuity.handoff.selectedRecoveryMode, "validation-first");
  assert.match(failedRecovery.workflowContinuity.handoff.recoveryExecutionSummary ?? "", /triggered another escalation/i);
});

test("autonomous sessions record blocked refinement attempts for later inspection", () => {
  const blocked = updateAutonomousSessionSteering(createAutonomousSession({ goal: "Record a blocked restart refinement." }), {
    action: "restart-from-last-safe-boundary",
    overrideReason: "The loop should return to the last safe checkpoint before trying again.",
    restartReason: "No useful progress is happening from the current point.",
  });

  assert.equal(blocked.workflowContinuity.steering.overrideReason, "The loop should return to the last safe checkpoint before trying again.");
  assert.equal(blocked.workflowContinuity.refinement.history.length, 1);
  assert.equal(blocked.workflowContinuity.refinement.lastOverrideReason, "The loop should return to the last safe checkpoint before trying again.");
  assert.equal(blocked.workflowContinuity.refinement.recentOverridesImprovedProgress, false);
  assert.match(blocked.workflowContinuity.refinement.refinementSummary ?? "", /blocked/i);
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

test("autonomous sessions reject invalid approval resumes without mutating pending approval state", () => {
  const awaiting = markAwaitingApproval(
    createAutonomousSession({ goal: "Confirm invalid approval resumes stay bounded." }),
    {
      id: "pending-invalid-resume",
      type: "file-write",
      scope: "caution",
      description: "Apply a caution-scoped sandbox write.",
      expectedOutcome: "The sandbox output should become healthy.",
      requiresApproval: true,
      metadata: {
        sourceActionType: "file-write",
        targetPath: "web/sandbox/pending-invalid.txt",
        allowedRoot: "web/sandbox",
        content: "pending-invalid",
      },
    },
    "Explicit approval is required for the pending caution write.",
  );

  const resumedWithoutApproval = resumeAutonomousSession(awaiting, {
    approved: false,
    reason: "This should not resume the bounded approval gate.",
  });

  assert.equal(resumedWithoutApproval, awaiting);
  assert.equal(resumedWithoutApproval.status, "awaiting-approval");
  assert.equal(resumedWithoutApproval.pendingAction?.id, "pending-invalid-resume");
  assert.match(resumedWithoutApproval.stateReason ?? "", /approval/i);
});

test("normalized sessions surface readiness guardrails for orphaned approval states", () => {
  const normalized = normalizeAutonomousSession({
    ...createAutonomousSession({ goal: "Keep orphaned approval states visible." }),
    sessionMode: "repo-coding",
    status: "awaiting-approval",
    workflowContinuity: undefined,
    pendingAction: undefined,
    stateReason: "Waiting for approval without a pending action.",
  });

  assert.match(normalized?.workflowContinuity.coding.integritySummary ?? "", /without a stored pending action/i);
  assert.equal(normalized?.workflowContinuity.coding.operatorConfirmationRequired, true);
  assert.match(buildAutonomousSessionContextBlock(normalized as NonNullable<typeof normalized>), /Readiness guardrails:/i);
});

