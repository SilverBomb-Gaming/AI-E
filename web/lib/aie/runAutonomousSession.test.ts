import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { appendAutonomousStep, createAutonomousSession, markAwaitingApproval, updateAutonomousSessionSteering } from "./autonomousSession";
import { listExecutionNodes, resetExecutionNodeRegistry } from "./executionNodeRegistry";
import { runAutonomousSession } from "./runAutonomousSession";
import { createTaskEnvelope } from "./taskEnvelope";
import { enqueueTask, getTask, listTasks } from "./taskQueueStore";
import type { AnalysisInput, ExecutionActionPreview, FreeAnalysisResponse } from "./types";

function makeSafeAction(description: string): ExecutionActionPreview {
  return {
    id: `action-${description.replace(/\s+/g, "-").toLowerCase()}`,
    type: "run",
    scope: "safe",
    description,
    expectedOutcome: "The validation output should report a healthy result.",
    requiresApproval: true,
    metadata: {
      sourceActionType: "validation-check",
    },
  };
}

test("runAutonomousSession continues bounded safe steps until the goal is complete", async () => {
  resetExecutionNodeRegistry();
  const savedStatuses: string[] = [];
  const seenInputs: AnalysisInput[] = [];
  const responses: FreeAnalysisResponse[] = [
    {
      what_happened: "The first bounded validation is still narrowing the likely cause.",
      what_matters: ["The validation output is not healthy yet."],
      what_to_do_next: ["Rerun the bounded validation after the first observation."],
      upgrade_hint: "",
      proposedAction: "Run the bounded validation command.",
      expectedOutcome: "The validation output should report a healthy result.",
      execution: makeSafeAction("Run the bounded validation command."),
    },
    {
      what_happened: "The bounded validation is complete and the issue is resolved.",
      what_matters: ["The validation output is now healthy."],
      what_to_do_next: ["Treat the bounded goal as complete."],
      upgrade_hint: "",
      proposedAction: "Run the bounded validation command one final time.",
      expectedOutcome: "The validation output should report a healthy result.",
      execution: makeSafeAction("Run the bounded validation command one final time."),
    },
  ];

  const session = await runAutonomousSession({
    goal: "Confirm the validation path reports a healthy result.",
    maxSteps: 3,
    dependencies: {
      runAnalysis: async (input) => {
        seenInputs.push(input);
        return responses.shift() as FreeAnalysisResponse;
      },
      executeAction: async (action) => ({
        status: "success",
        output:
          action.description.includes("final")
            ? "Validation complete. Healthy result confirmed and issue resolved."
            : "Validation rerun completed, but the healthy result is not confirmed yet.",
      }),
      saveAutonomousSession: async (nextSession) => {
        savedStatuses.push(nextSession.status);
      },
    },
  });

  assert.equal(session.status, "completed");
  assert.equal(session.steps.length, 2);
  assert.equal(session.steps[0]?.executionAdapterId, "web-sandbox");
  assert.equal(session.steps[0]?.executionNodeMode, "web");
  assert.equal(typeof session.steps[0]?.executionNodeId, "string");
  assert.equal(typeof session.steps[0]?.taskId, "string");
  assert.match(session.steps[0]?.nodeCapabilitySummary ?? "", /validation-check/i);
  assert.ok(listExecutionNodes().some((node) => node.mode === "web"));
  assert.match(session.steps[0]?.planningHintSummary ?? "", /Preferred next lane/i);
  assert.equal(seenInputs[0]?.stepIndex, 1);
  assert.equal(seenInputs[1]?.stepIndex, 2);
  assert.match(seenInputs[1]?.actionResult ?? "", /not confirmed yet/i);
  assert.ok(savedStatuses.includes("completed"));
  resetExecutionNodeRegistry();
});

test("runAutonomousSession persists assigned task state through queue completion", async () => {
  const taskDirectory = path.resolve(process.cwd(), "temp-phase4h-task-store");
  await rm(taskDirectory, { recursive: true, force: true });
  await mkdir(taskDirectory, { recursive: true });
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;

  try {
    const session = await runAutonomousSession({
      goal: "Confirm the queued task persists assignment and completion metadata.",
      maxSteps: 2,
      dependencies: {
        runAnalysis: async () => ({
          what_happened: "The bounded validation completed and the queued task should now be marked complete.",
          what_matters: ["The queue record should capture both node assignment and completion state."],
          what_to_do_next: ["Stop."],
          upgrade_hint: "",
          proposedAction: "Run the bounded validation command.",
          expectedOutcome: "The queued task should complete successfully.",
          execution: makeSafeAction("Run the bounded validation command."),
        }),
        executeAction: async () => ({
          status: "success",
          output: "Healthy status confirmed, issue resolved, and expected outcome validated successfully.",
        }),
        saveAutonomousSession: async () => {},
      },
    });

    const tasks = await listTasks();
    const persistedTask = session.taskId ? await getTask(session.taskId) : null;

    assert.equal(session.status, "completed");
    assert.equal(session.taskStatus, "completed");
    assert.equal(session.steps[0]?.taskStatus, "completed");
    assert.equal(tasks.length, 1);
    assert.equal(persistedTask?.taskId, session.taskId);
    assert.equal(persistedTask?.status, "completed");
    assert.equal(persistedTask?.assignedNodeId, session.assignedNodeId);
    assert.match(session.queueStateSummary ?? "", /completed/i);
  } finally {
    delete process.env.AIE_TASK_QUEUE_DIR;
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("runAutonomousSession pauses when the analysis proposes a step outside safe auto-execution", async () => {
  const session = await runAutonomousSession({
    goal: "Confirm the validation path reports a healthy result.",
    maxSteps: 2,
    dependencies: {
      runAnalysis: async () => ({
        what_happened: "The next best step is a broader code change that should not be auto-executed.",
        what_matters: ["The safe bounded runtime does not cover this change."],
        what_to_do_next: ["Apply the broader code change manually."],
        upgrade_hint: "",
        proposedAction: "Apply the broader code change.",
        expectedOutcome: "The validation output should report a healthy result.",
        execution: {
          id: "manual-change",
          type: "write",
          scope: "dangerous",
          description: "Apply the broader code change.",
          expectedOutcome: "The validation output should report a healthy result.",
          requiresApproval: true,
          metadata: {
            sourceActionType: "code-change",
          },
        },
      }),
      executeAction: async () => ({
        status: "success",
        output: "This should not be called for dangerous actions.",
      }),
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(session.status, "awaiting-approval");
  assert.equal(session.steps.length, 1);
  assert.equal(session.pendingAction?.type, "write");
  assert.match(session.completedReason ?? "", /approval|auto-execution boundary/i);
});

test("runAutonomousSession resumes an awaiting-approval session from stored pending state", async () => {
  const firstPass = await runAutonomousSession({
    goal: "Confirm the validation path reports a healthy result.",
    maxSteps: 3,
    dependencies: {
      runAnalysis: async () => ({
        what_happened: "The next safe bounded step is a caution-scoped sandbox write that needs approval.",
        what_matters: ["The write is bounded but should still pause for approval."],
        what_to_do_next: ["Approve the sandbox write and continue from the stored session."],
        upgrade_hint: "",
        proposedAction: "Apply the caution-scoped sandbox write.",
        expectedOutcome: "The bounded validation output should become healthy.",
        execution: {
          id: "approved-caution-write",
          type: "file-write",
          scope: "caution",
          description: "Apply the caution-scoped sandbox write.",
          expectedOutcome: "The bounded validation output should become healthy.",
          requiresApproval: true,
          metadata: {
            sourceActionType: "file-write",
            targetPath: "web/sandbox/approved.txt",
            allowedRoot: "web/sandbox",
            content: "approved write",
          },
        },
      }),
      executeAction: async () => ({
        status: "success",
        output: "This should not run before approval.",
      }),
      saveAutonomousSession: async () => {},
    },
  });

  let analysisCalls = 0;
  const resumed = await runAutonomousSession({
    goal: firstPass.goal,
    maxSteps: firstPass.maxSteps,
    approved: true,
    existingSession: firstPass,
    dependencies: {
      runAnalysis: async () => {
        analysisCalls += 1;
        return {
          what_happened: "The post-write validation confirmed the expected healthy output and resolved the bounded goal.",
          what_matters: ["The approved write changed the bounded sandbox path and the validation is now healthy."],
          what_to_do_next: ["Treat the resumed bounded goal as complete."],
          upgrade_hint: "",
          proposedAction: "Run the bounded validation after the approved write.",
          expectedOutcome: "The validation output should report a healthy result.",
          execution: makeSafeAction("Run the bounded validation after the approved write."),
        };
      },
      executeAction: async (action) =>
        action.id === "approved-caution-write"
          ? {
              status: "success",
              output: "Bounded file write applied.",
              changedPaths: ["web/sandbox/approved.txt"],
              diffSummary: "Created new file with 1 lines.",
            }
          : {
              status: "success",
              output: "Validation complete. Healthy result confirmed and issue resolved.",
            },
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(firstPass.status, "awaiting-approval");
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.steps.length, 3);
  assert.equal(resumed.steps[1]?.executionResult?.changedPaths?.[0], "web/sandbox/approved.txt");
  assert.equal(resumed.workflowContinuity.progress.chainPhase, "completed-safe-boundary");
  assert.equal(resumed.workflowContinuity.progress.lastCompletedSafeStep, 3);
  assert.match(resumed.workflowContinuity.memory.chainSummary ?? "", /goal status: complete/i);
  assert.match(resumed.workflowContinuity.memory.lastValidationOutcome ?? "", /healthy result confirmed/i);
  assert.equal(resumed.workflowContinuity.loopHealth.recommendedNextPhase, "stop");
  assert.equal(analysisCalls, 1);
});

test("runAutonomousSession keeps a successful validation in needs-verification before final completion", async () => {
  const responses: FreeAnalysisResponse[] = [
    {
      what_happened: "The validation passed, but the expected healthy output still needs direct verification.",
      what_matters: ["The first successful command is not enough to declare the full goal complete."],
      what_to_do_next: ["Run one bounded verification step."],
      upgrade_hint: "",
      proposedAction: "Run the bounded validation command.",
      expectedOutcome: "The validation output should report a healthy result.",
      execution: makeSafeAction("Run the bounded validation command."),
    },
    {
      what_happened: "The bounded verification matched the expected healthy output and the issue is resolved.",
      what_matters: ["The expected outcome is now directly confirmed."],
      what_to_do_next: ["Treat the bounded goal as complete."],
      upgrade_hint: "",
      proposedAction: "Inspect the confirmed validation output.",
      expectedOutcome: "The validation output should report a healthy result.",
      execution: makeSafeAction("Inspect the confirmed validation output."),
    },
  ];

  const session = await runAutonomousSession({
    goal: "Confirm the validation path reports a healthy result.",
    maxSteps: 3,
    dependencies: {
      runAnalysis: async () => responses.shift() as FreeAnalysisResponse,
      executeAction: async (action) => ({
        status: "success",
        output:
          action.description.includes("Inspect")
            ? "Healthy status confirmed, issue resolved, and expected outcome validated successfully."
            : "Validation passed, but the final healthy status still needs verification.",
      }),
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(session.status, "completed");
  assert.equal(session.steps[0]?.goalStatus, "needs-verification");
  assert.equal(session.steps[1]?.goalStatus, "complete");
});

test("runAutonomousSession keeps a repo-coding loop open until approval-ready output exists", async () => {
  resetExecutionNodeRegistry();
  const responses: FreeAnalysisResponse[] = [
    {
      what_happened: "The bounded implementation is ready for validation.",
      what_matters: ["The repo deliverable now needs bounded validation."],
      what_to_do_next: ["Run validation."],
      upgrade_hint: "",
      proposedAction: "Apply the bounded implementation patch to web/lib/aie/autonomousSession.ts.",
      expectedOutcome: "The bounded deliverable should be ready for validation.",
      execution: makeSafeAction("Apply the bounded implementation patch to web/lib/aie/autonomousSession.ts."),
    },
    {
      what_happened: "The bounded validation passed once.",
      what_matters: ["The deliverable looks healthy but still needs closure evidence."],
      what_to_do_next: ["Run the bounded validation again."],
      upgrade_hint: "",
      proposedAction: "Run the bounded validation target.",
      expectedOutcome: "The bounded deliverable should now validate cleanly.",
      execution: makeSafeAction("Run the bounded validation target."),
    },
    {
      what_happened: "The bounded validation passed again without regression.",
      what_matters: ["The deliverable can now close."],
      what_to_do_next: ["Stop."],
      upgrade_hint: "",
      proposedAction: "Run the bounded validation target again.",
      expectedOutcome: "The bounded deliverable should still validate cleanly without regression.",
      execution: makeSafeAction("Run the bounded validation target again."),
    },
  ];

  const session = await runAutonomousSession({
    goal: "Deliver a bounded repo coding fix and close it cleanly.",
    maxSteps: 3,
    dependencies: {
      runAnalysis: async () => responses.shift() as FreeAnalysisResponse,
      executeAction: async (action) => {
        if (/apply the bounded implementation patch/i.test(action.description)) {
          return {
            status: "success",
            output: "Implementation patch applied cleanly.",
            changedPaths: ["web/lib/aie/autonomousSession.ts"],
            diffSummary: "Updated deliverable acceptance closure derivation.",
          };
        }

        return /again/i.test(action.description)
          ? {
              status: "success",
              output: "Validation passed again without regression.",
            }
          : {
              status: "success",
              output: "Validation passed for the bounded deliverable.",
            };
      },
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(session.status, "max-step-limit");
  assert.equal(session.workflowContinuity.coding.deliverableAccepted, false);
  assert.equal(session.workflowContinuity.coding.completionState, "in-progress");
  assert.equal(session.workflowContinuity.coding.shouldTerminateLoop, false);
  assert.match(session.workflowContinuity.coding.acceptanceReason ?? "", /approval-ready repo action/i);
  assert.notEqual(session.latestCompletion?.status, "complete");
  resetExecutionNodeRegistry();
});

test("runAutonomousSession converts accepted materialized output into an approval-gated repo action before final completion", async () => {
  const seeded = appendAutonomousStep(createAutonomousSession({
    goal: "Deliver a bounded repo coding fix and hand it off as a supervised repo action.",
    sessionMode: "repo-coding",
  }), {
    proposedAction: "Prepare the bounded implementation output for web/sandbox/repo-action.txt.",
    expectedOutcome: "The bounded repo coding fix should be ready for validation.",
    executedActionPreview: {
      id: "seeded-materialized-output",
      type: "file-write",
      scope: "caution",
      description: "Prepare the bounded implementation output for web/sandbox/repo-action.txt.",
      expectedOutcome: "The bounded repo coding fix should be ready for validation.",
      requiresApproval: true,
      metadata: {
        sourceActionType: "file-write",
        targetPath: "web/sandbox/repo-action.txt",
        allowedRoot: "web/sandbox",
        content: "phase-5f supervised repo action",
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
  const firstSuccess = appendAutonomousStep(seeded, {
    proposedAction: "Run the bounded validation target.",
    expectedOutcome: "The bounded repo coding fix should validate cleanly.",
    executionResult: {
      status: "success",
      output: "Validation passed for the bounded repo coding fix.",
      commandLabel: "npm test",
    },
    nextDecision: "continue",
  });

  const approvalPass = await runAutonomousSession({
    goal: firstSuccess.goal,
    maxSteps: 5,
    existingSession: firstSuccess,
    dependencies: {
      runAnalysis: async () => ({
        what_happened: "The bounded validation passed again without regression, so the accepted output should now hand off to a supervised repo action.",
        what_matters: ["The accepted output is ready for approval-gated repo action execution."],
        what_to_do_next: ["Approve the derived repo action before closing the loop."],
        upgrade_hint: "",
        proposedAction: "Run the bounded validation target again.",
        expectedOutcome: "The bounded repo coding fix should still validate cleanly without regression.",
        execution: makeSafeAction("Run the bounded validation target again."),
      }),
      executeAction: async () => ({
        status: "success",
        output: "Validation passed again without regression.",
        commandLabel: "npm test",
      }),
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(approvalPass.status, "awaiting-approval");
  assert.equal(approvalPass.workflowContinuity.coding.pendingRepoActions.length, 1);
  assert.equal(approvalPass.workflowContinuity.coding.shouldTerminateLoop, false);
  assert.match(approvalPass.pendingAction?.id ?? "", /repo-action-step-1/i);

  const resumed = await runAutonomousSession({
    goal: approvalPass.goal,
    maxSteps: 5,
    approved: true,
    existingSession: approvalPass,
    dependencies: {
      runAnalysis: async () => {
        throw new Error("Approved repo action execution should use the stored continuation action.");
      },
      executeAction: async (action) => ({
        status: "success",
        output: `Applied supervised repo action: ${action.description}`,
        changedPaths: ["web/sandbox/repo-action.txt"],
        diffSummary: "Created new file with 1 lines.",
      }),
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(resumed.status, "completed");
  assert.equal(resumed.workflowContinuity.coding.pendingRepoActions.length, 0);
  assert.equal(resumed.workflowContinuity.coding.executedRepoActions.length, 1);
  assert.equal(resumed.workflowContinuity.coding.shouldTerminateLoop, true);
  assert.match(resumed.workflowContinuity.coding.repoActionSummary ?? "", /executed=1/i);
  assert.match(resumed.steps.at(-1)?.executedActionPreview?.id ?? "", /repo-action-step-1/i);
});

test("runAutonomousSession does not execute a stored approval-gated action after rejection", async () => {
  let executed = false;
  const awaiting = markAwaitingApproval(
    createAutonomousSession({
      goal: "Keep approval rejection from executing the stored repo action.",
      sessionMode: "repo-coding",
    }),
    {
      id: "repo-action-step-rejected",
      type: "file-write",
      scope: "caution",
      description: "Apply the rejected repo action.",
      expectedOutcome: "The rejected repo action should never execute.",
      requiresApproval: true,
      metadata: {
        sourceActionType: "file-write",
        targetPath: "web/sandbox/rejected-repo-action.txt",
        allowedRoot: "web/sandbox",
        content: "rejected",
        context: "repo-action=repo-action-step-rejected",
      },
    },
    "Explicit approval is required before the repo action can execute.",
  );

  const result = await runAutonomousSession({
    goal: awaiting.goal,
    maxSteps: 3,
    existingSession: awaiting,
    approved: false,
    dependencies: {
      runAnalysis: async () => {
        throw new Error("Rejected approval should not re-enter analysis.");
      },
      executeAction: async () => {
        executed = true;
        return {
          status: "success",
          output: "This action should not run after rejection.",
        };
      },
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(result.status, "awaiting-approval");
  assert.equal(result.pendingAction?.id, "repo-action-step-rejected");
  assert.equal(result.stateReason, awaiting.stateReason);
  assert.equal(executed, false);
});

test("runAutonomousSession auto-executes safe sandbox file writes and preserves changed-path metadata", async () => {
  const executedActions: string[] = [];

  const session = await runAutonomousSession({
    goal: "Write a bounded sandbox note and confirm the autonomous session records the file change.",
    maxSteps: 2,
    dependencies: {
      runAnalysis: async () => ({
        what_happened: "The safe sandbox write completed and satisfied the bounded goal.",
        what_matters: ["The sandbox file changed inside the approved root."],
        what_to_do_next: ["Treat the bounded goal as complete."],
        upgrade_hint: "",
        proposedAction: "Create web/sandbox/autonomous-phase4b.txt with a bounded validation note.",
        expectedOutcome: "The sandbox note should exist and the changed path should be recorded.",
        execution: {
          id: "safe-sandbox-write",
          type: "file-write",
          scope: "safe",
          description: "Create web/sandbox/autonomous-phase4b.txt with a bounded validation note.",
          expectedOutcome: "The sandbox note should exist and the changed path should be recorded.",
          requiresApproval: true,
          metadata: {
            sourceActionType: "file-write",
            targetPath: "web/sandbox/autonomous-phase4b.txt",
            allowedRoot: "web/sandbox",
            content: "autonomous phase4b note",
          },
        },
      }),
      executeAction: async (action) => {
        executedActions.push(action.id);
        return {
          status: "success",
          output: "Sandbox file write completed.",
          changedPaths: ["web/sandbox/autonomous-phase4b.txt"],
          diffSummary: "Created new file with 1 lines.",
        };
      },
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(executedActions.length, 1);
  assert.equal(session.status, "completed");
  assert.equal(session.steps[0]?.executionAdapterId, "repo-filesystem");
  assert.equal(session.steps[0]?.actionFamily, "write");
  assert.deepEqual(session.steps[0]?.executionResult?.changedPaths, ["web/sandbox/autonomous-phase4b.txt"]);
  assert.match(session.steps[0]?.executionResult?.diffSummary ?? "", /Created new file/i);
});

test("runAutonomousSession captures adapter metadata and planning hints across write to test to validate sequencing", async () => {
  const responses: FreeAnalysisResponse[] = [
    {
      what_happened: "Apply the bounded sandbox write first, but do not treat the goal as complete until the test and validation lanes finish.",
      what_matters: ["The file change is only the first lane and still needs test coverage and final validation."],
      what_to_do_next: ["Run the bounded test lane next."],
      upgrade_hint: "",
      proposedAction: "Write web/sandbox/phase4e-sequencing.txt",
      expectedOutcome: "The sandbox file should be updated.",
      execution: {
        id: "phase4e-write",
        type: "file-write",
        scope: "safe",
        description: "Write web/sandbox/phase4e-sequencing.txt",
        expectedOutcome: "The sandbox file should be updated.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "file-write",
          targetPath: "web/sandbox/phase4e-sequencing.txt",
          allowedRoot: "web/sandbox",
          content: "phase4e",
        },
      },
    },
    {
      what_happened: "Run npm test against the bounded change before validation, because the write alone is not enough to close the goal.",
      what_matters: ["The changed file should pass the bounded test lane before the final validation claim."],
      what_to_do_next: ["Validate the result banner after the test passes."],
      upgrade_hint: "",
      proposedAction: "Run npm test for the bounded change.",
      expectedOutcome: "The bounded test command should pass.",
      execution: {
        id: "phase4e-test",
        type: "test-run",
        scope: "safe",
        description: "Run npm test for the bounded change.",
        expectedOutcome: "The bounded test command should pass.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "test-run",
          testTarget: "core",
        },
      },
    },
    {
      what_happened: "The validation now confirms the expected healthy result and resolves the goal.",
      what_matters: ["The final bounded validation confirms the complete flow."],
      what_to_do_next: ["Stop."],
      upgrade_hint: "",
      proposedAction: "Validate the updated bounded output.",
      expectedOutcome: "The healthy bounded output should be confirmed.",
      execution: makeSafeAction("Validate the updated bounded output."),
    },
  ];

  const session = await runAutonomousSession({
    goal: "Confirm the bounded output is healthy after a write, test, and validation sequence.",
    maxSteps: 4,
    dependencies: {
      runAnalysis: async () => responses.shift() as FreeAnalysisResponse,
      executeAction: async (action) => {
        if (action.id === "phase4e-write") {
          return {
            status: "success",
            output: "Sandbox file write completed.",
            changedPaths: ["web/sandbox/phase4e-sequencing.txt"],
            diffSummary: "Created new file with 1 lines.",
          };
        }

        if (action.id === "phase4e-test") {
          return {
            status: "success",
            output: "npm test passed",
            commandLabel: "npm test",
            exitCode: 0,
          };
        }

        return {
          status: "success",
          output: "Healthy status confirmed, issue resolved, and expected outcome validated successfully.",
        };
      },
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(session.status, "completed");
  assert.deepEqual(session.steps.map((step) => step.executionAdapterId), ["repo-filesystem", "repo-tests", "web-sandbox"]);
  assert.deepEqual(session.steps.map((step) => step.actionFamily), ["write", "test", "validate"]);
  assert.match(session.steps[1]?.planningHintSummary ?? "", /Preferred next lane: test|validate/i);
});

test("runAutonomousSession adds repo-aware impact zones and test pairing to planning hints", async () => {
  const fixtureRoot = path.resolve(process.cwd(), "temp-phase4f-runner-repo");
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(path.join(fixtureRoot, "web", "lib", "aie"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "web", "lib", "aie", "repoContext.ts"), "export const repoContext = true;\n", "utf8");
  await writeFile(path.join(fixtureRoot, "web", "lib", "aie", "repoContext.test.ts"), "export const repoContextTest = true;\n", "utf8");

  try {
    const responses: FreeAnalysisResponse[] = [
      {
        what_happened: "Write the repo context file first, then verify the related test path.",
        what_matters: ["The file change should be paired with the relevant test file."],
        what_to_do_next: ["Run the paired test next."],
        upgrade_hint: "",
        proposedAction: "Write web/lib/aie/repoContext.ts",
        expectedOutcome: "The repo context file should be updated.",
        execution: {
          id: "phase4f-write",
          type: "file-write",
          scope: "safe",
          description: "Write web/lib/aie/repoContext.ts",
          expectedOutcome: "The repo context file should be updated.",
          requiresApproval: true,
          metadata: {
            sourceActionType: "file-write",
            targetPath: "web/lib/aie/repoContext.ts",
            allowedRoot: "web/lib/aie",
            content: "export const repoContext = 'updated';\n",
          },
        },
      },
      {
        what_happened: "The paired repo context test now passes and the bounded goal is complete.",
        what_matters: ["The test pairing confirmed the changed lane."],
        what_to_do_next: ["Stop."],
        upgrade_hint: "",
        proposedAction: "Run the paired repo context test.",
        expectedOutcome: "The paired repo context test should pass.",
        execution: {
          id: "phase4f-test",
          type: "test-run",
          scope: "safe",
          description: "Run the paired repo context test.",
          expectedOutcome: "The paired repo context test should pass.",
          requiresApproval: true,
          metadata: {
            sourceActionType: "test-run",
            testTarget: "web/lib/aie/repoContext.test.ts",
          },
        },
      },
    ];

    const session = await runAutonomousSession({
      goal: "Update repo context and verify the paired repo context test.",
      maxSteps: 3,
      executionContext: {
        cwd: path.join(fixtureRoot, "web"),
        repoRoot: fixtureRoot,
        runtimeMode: "local",
      },
      dependencies: {
        runAnalysis: async () => responses.shift() as FreeAnalysisResponse,
        executeAction: async (action) =>
          action.id === "phase4f-write"
            ? {
                status: "success",
                output: "Repo context file write completed.",
                changedPaths: ["web/lib/aie/repoContext.ts"],
              }
            : {
                status: "success",
                output: "tsx --test web/lib/aie/repoContext.test.ts passed",
                commandLabel: "tsx --test web/lib/aie/repoContext.test.ts",
                exitCode: 0,
              },
        saveAutonomousSession: async () => {},
      },
    });

    assert.equal(session.status, "completed");
    assert.match(session.steps[0]?.planningHintSummary ?? "", /Impact zones:/i);
    assert.match(session.steps[0]?.planningHintSummary ?? "", /Pair with tests:/i);
    assert.match(session.steps[1]?.adapterContextSummary ?? "", /repoRoot=/i);
    assert.match(session.steps[1]?.adapterContextSummary ?? "", /testTarget=web\/lib\/aie\/repoContext.test.ts/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("runAutonomousSession replaces gameplay-domain drift with a repo-aware bounded fallback for local goals", async () => {
  const fixtureRoot = path.resolve(process.cwd(), "temp-phase4f-runner-fallback");
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(path.join(fixtureRoot, "web", "lib", "aie"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "web", "lib", "aie", "types.ts"), "export type AnalysisInput = { goal: string };\nexport type RunnerMode = 'local';\n", "utf8");

  try {
    const session = await runAutonomousSession({
      goal: "Find and summarize types used in web/lib/aie.",
      maxSteps: 2,
      executionContext: {
        cwd: path.join(fixtureRoot, "web"),
        repoRoot: fixtureRoot,
        runtimeMode: "local",
      },
      dependencies: {
        runAnalysis: async () => ({
          what_happened: "This is an initialization-order issue. initialization boundary is being read before the upstream state is ready.",
          what_matters: ["The dependent binding still looks early."],
          what_to_do_next: ["Temporarily delay the dependent binding until after the upstream state initializes and compare the behavior before and after."],
          upgrade_hint: "",
          proposedAction: "Temporarily delay the dependent binding until after the upstream state initializes and compare the behavior before and after.",
          expectedOutcome: "The bounded check should show whether initialization-order is the source of the issue.",
        }),
        executeAction: async () => ({
          status: "success",
          output: "Inspection completed in read-only mode. Summary: web/lib/aie/types.ts exports types including AnalysisInput and RunnerMode. No files were modified and no shell commands were executed.",
        }),
        saveAutonomousSession: async () => {},
      },
    });

    assert.equal(session.status, "completed");
    assert.equal(session.steps[0]?.executionAdapterId, "headless-local");
    assert.match(session.steps[0]?.proposedAction ?? "", /Inspect web\/lib\/aie\/types.ts/i);
    assert.match(session.steps[0]?.diagnosis ?? "", /repo-aware fallback/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("runAutonomousSession prefers runnable lib/aie tests for generic local test goals", async () => {
  const fixtureRoot = path.resolve(process.cwd(), "temp-phase4f-runner-test-targets");
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(path.join(fixtureRoot, "web", "lib", "aie"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "web", "components"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "web", "lib", "aie", "retryPolicy.test.ts"), "export const ok = true;\n", "utf8");
  await writeFile(path.join(fixtureRoot, "web", "components", "analysisResultLogic.test.tsx"), "export const ui = true;\n", "utf8");

  try {
    const session = await runAutonomousSession({
      goal: "Locate a test file and verify it runs.",
      maxSteps: 1,
      executionContext: {
        cwd: path.join(fixtureRoot, "web"),
        repoRoot: fixtureRoot,
        runtimeMode: "local",
      },
      dependencies: {
        runAnalysis: async () => ({
          what_happened: "This is an initialization-order issue. initialization boundary is being read before the upstream state is ready.",
          what_matters: ["The dependent binding still looks early."],
          what_to_do_next: ["Temporarily delay the dependent binding until after the upstream state initializes and compare the behavior before and after."],
          upgrade_hint: "",
          proposedAction: "Temporarily delay the dependent binding until after the upstream state initializes and compare the behavior before and after.",
          expectedOutcome: "The bounded check should show whether initialization-order is the source of the issue.",
        }),
        executeAction: async () => ({
          status: "success",
          output: "tsx --test web/lib/aie/retryPolicy.test.ts passed with exit code 0.",
          commandLabel: "tsx --test web/lib/aie/retryPolicy.test.ts",
          exitCode: 0,
        }),
        saveAutonomousSession: async () => {},
      },
    });

    assert.equal(session.steps[0]?.executionAdapterId, "repo-tests");
    assert.match(session.steps[0]?.proposedAction ?? "", /web\/lib\/aie\/retryPolicy.test.ts/i);
    assert.match(session.steps[0]?.adapterContextSummary ?? "", /testTarget=web\/lib\/aie\/retryPolicy.test.ts/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("runAutonomousSession uses headless-local adapter metadata when invoked in headless mode", async () => {
  const session = await runAutonomousSession({
    goal: "Inspect the bounded repo state in headless mode.",
    maxSteps: 1,
    executionContext: {
      runtimeMode: "headless",
      cwd: process.cwd(),
    },
    dependencies: {
      runAnalysis: async () => ({
        what_happened: "Inspect the bounded repo state and confirm the expected file exists.",
        what_matters: ["The repo inspection should stay read-only."],
        what_to_do_next: ["Stop after the inspection succeeds."],
        upgrade_hint: "",
        proposedAction: "Inspect web/lib/aie/types.ts and summarize the file shape.",
        expectedOutcome: "The bounded inspection should confirm the typed execution contract.",
        execution: {
          id: "headless-inspect",
          type: "inspection",
          scope: "safe",
          description: "Inspect web/lib/aie/types.ts and summarize the file shape.",
          expectedOutcome: "The bounded inspection should confirm the typed execution contract.",
          requiresApproval: true,
          metadata: {
            sourceActionType: "inspection",
          },
        },
      }),
      executeAction: async () => ({
        status: "success",
        output: "Inspection complete. The bounded file shape is confirmed.",
      }),
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(session.steps[0]?.executionAdapterId, "headless-local");
  assert.match(session.steps[0]?.adapterContextSummary ?? "", /mode=headless/i);
});

test("runAutonomousSession closes a headless safe file-existence validation without approval drift", async () => {
  const session = await runAutonomousSession({
    goal: "Validate whether web/lib/aie/types.ts exists before continuing.",
    maxSteps: 2,
    executionContext: {
      runtimeMode: "headless",
      cwd: process.cwd(),
    },
    dependencies: {
      runAnalysis: async () => ({
        what_happened: "Validate whether web/lib/aie/types.ts exists before continuing.",
        what_matters: ["This should stay read-only."],
        what_to_do_next: ["Stop after the bounded validation answers the goal."],
        upgrade_hint: "",
        proposedAction: "Validate whether web/lib/aie/types.ts exists before continuing.",
        expectedOutcome: "The validation should confirm whether web/lib/aie/types.ts exists.",
        execution: {
          id: "validate-types-exists",
          type: "validation-check",
          scope: "safe",
          description: "Validate whether web/lib/aie/types.ts exists before continuing.",
          expectedOutcome: "The validation should confirm whether web/lib/aie/types.ts exists.",
          requiresApproval: true,
          metadata: {
            sourceActionType: "validation-check",
            targetPath: "web/lib/aie/types.ts",
          },
        },
      }),
      executeAction: async () => ({
        status: "success",
        output: "Confirmed that web/lib/aie/types.ts exists and is available before continuing.",
      }),
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(session.status, "completed");
  assert.equal(session.steps.length, 1);
  assert.equal(session.steps[0]?.executionAdapterId, "headless-local");
  assert.equal(session.steps[0]?.goalStatus, "complete");
});

test("runAutonomousSession closes a read-only inspection summary without escalating to approval", async () => {
  const session = await runAutonomousSession({
    goal: "Inspect web/lib/aie/types.ts and summarize the file shape in read-only mode.",
    maxSteps: 2,
    executionContext: {
      runtimeMode: "headless",
      cwd: process.cwd(),
    },
    dependencies: {
      runAnalysis: async () => ({
        what_happened: "Inspect web/lib/aie/types.ts and summarize the file shape in read-only mode.",
        what_matters: ["This should stay read-only."],
        what_to_do_next: ["Stop after the bounded inspection answers the goal."],
        upgrade_hint: "",
        proposedAction: "Inspect web/lib/aie/types.ts and summarize the file shape in read-only mode.",
        expectedOutcome: "The inspection should summarize the file shape directly.",
        execution: {
          id: "inspect-types-shape",
          type: "inspection",
          scope: "safe",
          description: "Inspect web/lib/aie/types.ts and summarize the file shape in read-only mode.",
          expectedOutcome: "The inspection should summarize the file shape directly.",
          requiresApproval: true,
          metadata: {
            sourceActionType: "inspection",
            targetPath: "web/lib/aie/types.ts",
          },
        },
      }),
      executeAction: async () => ({
        status: "success",
        output: "Inspection summary: web/lib/aie/types.ts exports analysis and execution types, including AnalysisInput, ExecutionActionPreview, and ExecutionRuntimeResult.",
      }),
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(session.status, "completed");
  assert.equal(session.steps.length, 1);
  assert.equal(session.steps[0]?.goalStatus, "complete");
});

test("runAutonomousSession suppresses an unnecessary broader approval step after strong safe closure evidence", async () => {
  const responses: FreeAnalysisResponse[] = [
    {
      what_happened: "Validate whether web/lib/aie/types.ts exists before continuing.",
      what_matters: ["This should stay read-only."],
      what_to_do_next: ["Stop after the bounded validation answers the goal."],
      upgrade_hint: "",
      proposedAction: "Validate whether web/lib/aie/types.ts exists before continuing.",
      expectedOutcome: "The validation should confirm whether web/lib/aie/types.ts exists.",
      execution: {
        id: "safe-exists-check",
        type: "validation-check",
        scope: "safe",
        description: "Validate whether web/lib/aie/types.ts exists before continuing.",
        expectedOutcome: "The validation should confirm whether web/lib/aie/types.ts exists.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "validation-check",
          targetPath: "web/lib/aie/types.ts",
        },
      },
    },
    {
      what_happened: "A broader follow-up would update web/lib/aie/types.ts with extra logging.",
      what_matters: ["This follow-up is broader than the original read-only goal."],
      what_to_do_next: ["Update web/lib/aie/types.ts with extra logging."],
      upgrade_hint: "",
      proposedAction: "Update web/lib/aie/types.ts with extra logging.",
      expectedOutcome: "The broader write should add more diagnostics.",
      execution: {
        id: "broader-logging-write",
        type: "file-write",
        scope: "caution",
        description: "Update web/lib/aie/types.ts with extra logging.",
        expectedOutcome: "The broader write should add more diagnostics.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "file-write",
          targetPath: "web/lib/aie/types.ts",
        },
      },
    },
  ];
  let executeCalls = 0;

  const firstPass = await runAutonomousSession({
    goal: "Validate whether web/lib/aie/types.ts exists before continuing.",
    maxSteps: 1,
    executionContext: {
      runtimeMode: "headless",
      cwd: process.cwd(),
    },
    dependencies: {
      runAnalysis: async () => responses.shift() as FreeAnalysisResponse,
      executeAction: async () => {
        executeCalls += 1;
        return {
          status: "success",
          output: "Confirmed that web/lib/aie/types.ts exists and is available before continuing.",
        };
      },
      saveAutonomousSession: async () => {},
    },
  });

  const resumed = await runAutonomousSession({
    goal: firstPass.goal,
    maxSteps: 2,
    existingSession: {
      ...firstPass,
      status: "active",
      maxSteps: 2,
    },
    executionContext: {
      runtimeMode: "headless",
      cwd: process.cwd(),
    },
    dependencies: {
      runAnalysis: async () => responses.shift() as FreeAnalysisResponse,
      executeAction: async () => {
        executeCalls += 1;
        return {
          status: "success",
          output: "This broader write should not execute.",
        };
      },
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(firstPass.status, "completed");
  assert.equal(resumed.status, "completed");
  assert.equal(executeCalls, 1);
  assert.match(resumed.steps.at(-1)?.diagnosis ?? "", /stopped before a broader approval-gated follow-up/i);
});

test("runAutonomousSession keeps ambiguous safe output open", async () => {
  const session = await runAutonomousSession({
    goal: "Confirm web/lib/aie/types.ts contains the execution contract.",
    maxSteps: 1,
    executionContext: {
      runtimeMode: "headless",
      cwd: process.cwd(),
    },
    dependencies: {
      runAnalysis: async () => ({
        what_happened: "Inspect web/lib/aie/types.ts for the execution contract.",
        what_matters: ["This should stay read-only."],
        what_to_do_next: ["Keep the goal open if the output is partial."],
        upgrade_hint: "",
        proposedAction: "Inspect web/lib/aie/types.ts for the execution contract.",
        expectedOutcome: "The output should confirm that the execution contract is present.",
        execution: {
          id: "inspect-contract",
          type: "inspection",
          scope: "safe",
          description: "Inspect web/lib/aie/types.ts for the execution contract.",
          expectedOutcome: "The output should confirm that the execution contract is present.",
          requiresApproval: true,
          metadata: {
            sourceActionType: "inspection",
            targetPath: "web/lib/aie/types.ts",
          },
        },
      }),
      executeAction: async () => ({
        status: "success",
        output: "Inspection opened web/lib/aie/types.ts.",
      }),
      saveAutonomousSession: async () => {},
    },
  });

  assert.notEqual(session.status, "completed");
  assert.equal(session.steps[0]?.goalStatus, "needs-verification");
  assert.equal(session.steps[0]?.completionConfidence, "medium");
});

test("runAutonomousSession retries one transient failure and records recovery metadata", async () => {
  const executedStatuses: string[] = [];

  const session = await runAutonomousSession({
    goal: "Confirm the bounded validation succeeds after one transient retry.",
    maxSteps: 3,
    dependencies: {
      runAnalysis: async () => ({
        what_happened: "Run the bounded validation once.",
        what_matters: ["A transient timeout may still be recoverable."],
        what_to_do_next: ["Retry once if the timeout looks transient."],
        upgrade_hint: "",
        proposedAction: "Run the bounded validation command.",
        expectedOutcome: "The validation output should report a healthy result.",
        execution: makeSafeAction("Run the bounded validation command."),
      }),
      executeAction: async () => {
        const nextStatus = executedStatuses.length === 0 ? "failed" : "success";
        executedStatuses.push(nextStatus);
        return nextStatus === "failed"
          ? {
              status: "failed",
              error: "Process timed out with ETIMEDOUT",
            }
          : {
              status: "success",
              output: "Validation complete. Healthy result confirmed and issue resolved.",
            };
      },
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(session.status, "completed");
  assert.equal(session.steps.length, 2);
  assert.equal(session.steps[0]?.failureClassification?.kind, "transient");
  assert.equal(session.steps[0]?.recoveryStrategy, "retry-same-action");
  assert.equal(session.steps[0]?.retryCount, 1);
  assert.equal(session.steps[1]?.recoveryStrategy, "retry-same-action");
});

test("runAutonomousSession reroutes failed test output into the next analysis step", async () => {
  const seenInputs: AnalysisInput[] = [];
  const responses: FreeAnalysisResponse[] = [
    {
      what_happened: "Run the bounded trace validation.",
      what_matters: ["The trace check is still failing."],
      what_to_do_next: ["Use the failure output to pick a narrower bounded next step."],
      upgrade_hint: "",
      proposedAction: "Run the bounded trace validation.",
      expectedOutcome: "The trace command should pass.",
      execution: {
        id: "trace-test",
        type: "test-run",
        scope: "safe",
        description: "Run the bounded trace validation.",
        expectedOutcome: "The trace command should pass.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "test-run",
          testTarget: "trace",
        },
      },
    },
    {
      what_happened: "The bounded trace output identified the failure source and the rerouted goal is complete.",
      what_matters: ["The failure output points to a narrower trace assertion and confirms the reroute."],
      what_to_do_next: ["Treat the rerouted bounded goal as complete after inspection."],
      upgrade_hint: "",
      proposedAction: "Inspect the bounded trace output.",
      expectedOutcome: "The bounded failure source should be identified and the rerouted goal should be complete.",
      execution: {
        id: "inspect-trace-output",
        type: "inspection",
        scope: "safe",
        description: "Inspect the bounded trace output.",
        expectedOutcome: "The bounded failure source should be identified.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "inspection",
        },
      },
    },
  ];

  const session = await runAutonomousSession({
    goal: "Use the failed bounded trace output to choose a different bounded step.",
    maxSteps: 3,
    dependencies: {
      runAnalysis: async (input) => {
        seenInputs.push(input);
        return responses.shift() as FreeAnalysisResponse;
      },
      executeAction: async (action) =>
        action.type === "test-run"
          ? {
              status: "failed",
              output: "Test failed: expected 20 complete traces but saw 19.",
              exitCode: 1,
            }
          : {
              status: "success",
              output: "Inspection complete. The bounded failure source is identified and the rerouted bounded goal is resolved.",
            },
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(session.status, "completed");
  assert.equal(session.steps[0]?.recoveryStrategy, "reroute-analysis");
  assert.match(seenInputs[1]?.actionResult ?? "", /expected 20 complete traces/i);
});

test("runAutonomousSession stops after repeated write failures stall the loop", async () => {
  const responses: FreeAnalysisResponse[] = [
    {
      what_happened: "Write the same sandbox note.",
      what_matters: ["The write keeps failing."],
      what_to_do_next: ["Try a narrower write plan."],
      upgrade_hint: "",
      proposedAction: "Write web/sandbox/repeated-write.txt",
      expectedOutcome: "The sandbox note should be written.",
      execution: {
        id: "repeat-write-1",
        type: "file-write",
        scope: "safe",
        description: "Write web/sandbox/repeated-write.txt",
        expectedOutcome: "The sandbox note should be written.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "file-write",
          targetPath: "web/sandbox/repeated-write.txt",
          allowedRoot: "web/sandbox",
          content: "same content",
        },
      },
    },
    {
      what_happened: "Write the same sandbox note again.",
      what_matters: ["The write still keeps failing."],
      what_to_do_next: ["Try again."],
      upgrade_hint: "",
      proposedAction: "Write web/sandbox/repeated-write.txt",
      expectedOutcome: "The sandbox note should be written.",
      execution: {
        id: "repeat-write-2",
        type: "file-write",
        scope: "safe",
        description: "Write web/sandbox/repeated-write.txt",
        expectedOutcome: "The sandbox note should be written.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "file-write",
          targetPath: "web/sandbox/repeated-write.txt",
          allowedRoot: "web/sandbox",
          content: "same content",
        },
      },
    },
  ];

  const session = await runAutonomousSession({
    goal: "Stop if the same sandbox write keeps failing without progress.",
    maxSteps: 3,
    dependencies: {
      runAnalysis: async () => responses.shift() as FreeAnalysisResponse,
      executeAction: async () => ({
        status: "failed",
        error: "Write failed with the same sandbox validation error.",
      }),
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(session.status, "failed");
  assert.equal(session.steps.length, 2);
  assert.equal(session.steps[1]?.repeatedAction, true);
  assert.match(session.steps[1]?.stallReason ?? "", /repeated the same action/i);
});

test("runAutonomousSession stops when different actions keep producing the same output", async () => {
  const responses: FreeAnalysisResponse[] = [
    {
      what_happened: "Run bounded test target A.",
      what_matters: ["The first bounded attempt failed."],
      what_to_do_next: ["Try a different bounded angle."],
      upgrade_hint: "",
      proposedAction: "Run bounded test target A.",
      expectedOutcome: "The bounded command should pass.",
      execution: {
        id: "test-a",
        type: "test-run",
        scope: "safe",
        description: "Run bounded test target A.",
        expectedOutcome: "The bounded command should pass.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "test-run",
          testTarget: "trace",
        },
      },
    },
    {
      what_happened: "Inspect bounded trace target B.",
      what_matters: ["The second bounded attempt still failed the same way."],
      what_to_do_next: ["Try a different bounded angle."],
      upgrade_hint: "",
      proposedAction: "Inspect bounded trace target B.",
      expectedOutcome: "The bounded command should isolate the source.",
      execution: {
        id: "inspect-b",
        type: "inspection",
        scope: "safe",
        description: "Inspect bounded trace target B.",
        expectedOutcome: "The bounded command should isolate the source.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "inspection",
        },
      },
    },
  ];

  const session = await runAutonomousSession({
    goal: "Stop if bounded attempts keep producing the same output.",
    maxSteps: 3,
    dependencies: {
      runAnalysis: async () => responses.shift() as FreeAnalysisResponse,
      executeAction: async () => ({
        status: "failed",
        output: "Same bounded failure output.",
      }),
      saveAutonomousSession: async () => {},
    },
  });

  assert.equal(session.status, "failed");
  assert.equal(session.steps[1]?.repeatedOutput, true);
  assert.match(session.completedReason ?? "", /same output|stalled/i);
});

test("runAutonomousSession continues into the next runnable generated queued task after successful completion", async () => {
  const taskDirectory = path.resolve(process.cwd(), "temp-phase7b-chain-store");
  await rm(taskDirectory, { recursive: true, force: true });
  await mkdir(taskDirectory, { recursive: true });
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;

  try {
    const seedSession = createAutonomousSession({
      goal: "Complete the generated queued task backlog in priority order.",
      sessionId: "phase7b-chain-session",
      maxSteps: 4,
      sessionMode: "repo-coding",
    });
    const firstTask = await enqueueTask(createTaskEnvelope({
      taskId: "phase7b-task-1",
      sessionId: seedSession.sessionId,
      stepIndex: 1,
      priority: 10,
      action: makeSafeAction("Execute generated queued task 1."),
    }));
    await enqueueTask(createTaskEnvelope({
      taskId: "phase7b-task-2",
      sessionId: seedSession.sessionId,
      stepIndex: 2,
      priority: 5,
      dependsOnTaskIds: [firstTask.taskId],
      action: makeSafeAction("Execute generated queued task 2."),
    }));

    let analysisCalls = 0;
    const session = await runAutonomousSession({
      goal: seedSession.goal,
      maxSteps: 4,
      existingSession: seedSession,
      queuedTask: firstTask,
      dependencies: {
        runAnalysis: async () => {
          analysisCalls += 1;
          return {
            what_happened: "Unexpected analysis call.",
            what_matters: ["The queued-task chain should not need a fresh analysis step here."],
            what_to_do_next: ["Stop."],
            upgrade_hint: "",
            proposedAction: "Stop.",
            expectedOutcome: "Stop.",
            execution: makeSafeAction("Unexpected analysis path."),
          };
        },
        executeAction: async (action) => ({
          status: "success",
          output: `${action.description} completed successfully and validated the expected outcome.`,
        }),
        saveAutonomousSession: async () => {},
      },
    });

    assert.equal(analysisCalls, 0);
    assert.equal(session.status, "completed");
    assert.equal(session.steps.length, 2);
    assert.deepEqual(session.steps.map((step) => step.taskId), ["phase7b-task-1", "phase7b-task-2"]);
    assert.equal(session.workflowContinuity.taskChain.chainStatus, "completed");
    assert.deepEqual(session.workflowContinuity.taskChain.completedTaskIds, ["phase7b-task-1", "phase7b-task-2"]);
    assert.equal(session.workflowContinuity.taskChain.nextRecommendedTaskId, undefined);
  } finally {
    delete process.env.AIE_TASK_QUEUE_DIR;
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("runAutonomousSession does not advance to the next generated queued task after a failed task", async () => {
  const taskDirectory = path.resolve(process.cwd(), "temp-phase7b-chain-failure-store");
  await rm(taskDirectory, { recursive: true, force: true });
  await mkdir(taskDirectory, { recursive: true });
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;

  try {
    const seedSession = createAutonomousSession({
      goal: "Stop the generated queued task chain when the active task fails.",
      sessionId: "phase7b-chain-failure-session",
      maxSteps: 4,
      sessionMode: "repo-coding",
    });
    const firstTask = await enqueueTask(createTaskEnvelope({
      taskId: "phase7b-fail-task-1",
      sessionId: seedSession.sessionId,
      stepIndex: 1,
      priority: 10,
      action: makeSafeAction("Execute generated queued task that fails."),
    }));
    await enqueueTask(createTaskEnvelope({
      taskId: "phase7b-fail-task-2",
      sessionId: seedSession.sessionId,
      stepIndex: 2,
      priority: 5,
      dependsOnTaskIds: [firstTask.taskId],
      action: makeSafeAction("Execute generated queued task 2 after failure."),
    }));

    const session = await runAutonomousSession({
      goal: seedSession.goal,
      maxSteps: 4,
      existingSession: seedSession,
      queuedTask: firstTask,
      dependencies: {
        runAnalysis: async () => ({
          what_happened: "Unexpected analysis call.",
          what_matters: ["The queued-task chain should stay on the current bounded task."],
          what_to_do_next: ["Stop."],
          upgrade_hint: "",
          proposedAction: "Stop.",
          expectedOutcome: "Stop.",
          execution: makeSafeAction("Unexpected analysis path."),
        }),
        executeAction: async () => ({
          status: "failed",
          error: "The first generated queued task failed.",
          output: "The first generated queued task failed.",
        }),
        saveAutonomousSession: async () => {},
      },
    });

    const secondTask = await getTask("phase7b-fail-task-2");

    assert.equal(session.steps.length, 1);
    assert.notEqual(session.status, "completed");
    assert.equal(session.workflowContinuity.taskChain.completedTaskIds.length, 0);
    assert.equal(secondTask?.status, "queued");
  } finally {
    delete process.env.AIE_TASK_QUEUE_DIR;
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("runAutonomousSession pauses at the bounded task limit and resumes into the next queued task", async () => {
  const taskDirectory = path.resolve(process.cwd(), "temp-phase7c-session-limit-store");
  await rm(taskDirectory, { recursive: true, force: true });
  await mkdir(taskDirectory, { recursive: true });
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;

  try {
    const seedSession = createAutonomousSession({
      goal: "Pause after one completed queued task and resume later.",
      sessionId: "phase7c-session-limit-session",
      maxSteps: 4,
      maxTasksPerSession: 1,
      sessionMode: "repo-coding",
    });
    const firstTask = await enqueueTask(createTaskEnvelope({
      taskId: "phase7c-limit-task-1",
      sessionId: seedSession.sessionId,
      stepIndex: 1,
      priority: 10,
      action: makeSafeAction("Execute queued task 1."),
    }));
    await enqueueTask(createTaskEnvelope({
      taskId: "phase7c-limit-task-2",
      sessionId: seedSession.sessionId,
      stepIndex: 2,
      priority: 5,
      dependsOnTaskIds: [firstTask.taskId],
      action: makeSafeAction("Execute queued task 2."),
    }));

    let analysisCalls = 0;
    const dependencies = {
      runAnalysis: async () => {
        analysisCalls += 1;
        return {
          what_happened: "Unexpected analysis call.",
          what_matters: ["The queued session should resume directly into the next runnable task."],
          what_to_do_next: ["Stop."],
          upgrade_hint: "",
          proposedAction: "Stop.",
          expectedOutcome: "Stop.",
          execution: makeSafeAction("Unexpected analysis path."),
        };
      },
      executeAction: async (action: ExecutionActionPreview) => ({
        status: "success" as const,
        output: `${action.description} completed successfully.`,
      }),
      saveAutonomousSession: async () => {},
    };

    const firstPass = await runAutonomousSession({
      goal: seedSession.goal,
      maxSteps: 4,
      maxTasksPerSession: 1,
      existingSession: seedSession,
      queuedTask: firstTask,
      dependencies,
    });

    assert.equal(firstPass.status, "paused");
    assert.equal(firstPass.sessionLoop.pauseReason, "max-tasks-reached");
    assert.deepEqual(firstPass.sessionLoop.completedTaskIds, ["phase7c-limit-task-1"]);
    assert.equal(firstPass.sessionLoop.nextRecommendedTaskId, "phase7c-limit-task-2");
    assert.equal(firstPass.steps.length, 1);

    const resumed = await runAutonomousSession({
      goal: firstPass.goal,
      maxSteps: 4,
      maxTasksPerSession: 2,
      existingSession: firstPass,
      dependencies,
    });

    assert.equal(analysisCalls, 0);
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.steps.length, 2);
    assert.deepEqual(resumed.steps.map((step) => step.taskId), ["phase7c-limit-task-1", "phase7c-limit-task-2"]);
    assert.deepEqual(resumed.sessionLoop.completedTaskIds, ["phase7c-limit-task-1", "phase7c-limit-task-2"]);
  } finally {
    delete process.env.AIE_TASK_QUEUE_DIR;
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("runAutonomousSession continues within the current feature bundle before switching bundles", async () => {
  const taskDirectory = path.resolve(process.cwd(), "temp-phase7d-feature-bundle-store");
  await rm(taskDirectory, { recursive: true, force: true });
  await mkdir(taskDirectory, { recursive: true });
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;

  try {
    const seedSession = createAutonomousSession({
      goal: "Finish the active feature bundle before switching to unrelated queued work.",
      sessionId: "phase7d-feature-bundle-session",
      maxSteps: 4,
      sessionMode: "repo-coding",
    });
    const firstTask = await enqueueTask(createTaskEnvelope({
      taskId: "phase7d-feature-a-1",
      sessionId: seedSession.sessionId,
      stepIndex: 1,
      priority: 5,
      featureId: "feature-a",
      featureTitle: "Feature A",
      action: makeSafeAction("Execute feature A task 1."),
    }));
    await enqueueTask(createTaskEnvelope({
      taskId: "phase7d-feature-a-2",
      sessionId: seedSession.sessionId,
      stepIndex: 2,
      priority: 1,
      dependsOnTaskIds: [firstTask.taskId],
      featureId: "feature-a",
      featureTitle: "Feature A",
      action: makeSafeAction("Execute feature A task 2."),
    }));
    await enqueueTask(createTaskEnvelope({
      taskId: "phase7d-feature-b-1",
      sessionId: seedSession.sessionId,
      stepIndex: 3,
      priority: 10,
      featureId: "feature-b",
      featureTitle: "Feature B",
      action: makeSafeAction("Execute feature B task 1."),
    }));

    const session = await runAutonomousSession({
      goal: seedSession.goal,
      maxSteps: 4,
      existingSession: seedSession,
      queuedTask: firstTask,
      dependencies: {
        runAnalysis: async () => ({
          what_happened: "Unexpected analysis call.",
          what_matters: ["The queued-task chain should continue from the current feature bundle."],
          what_to_do_next: ["Stop."],
          upgrade_hint: "",
          proposedAction: "Stop.",
          expectedOutcome: "Stop.",
          execution: makeSafeAction("Unexpected analysis path."),
        }),
        executeAction: async (action) => ({
          status: "success",
          output: `${action.description} completed successfully.`,
        }),
        saveAutonomousSession: async () => {},
      },
    });

    assert.deepEqual(session.steps.map((step) => step.taskId), ["phase7d-feature-a-1", "phase7d-feature-a-2", "phase7d-feature-b-1"]);
    assert.equal(session.oversight.summary.completedFeatures, 2);
  } finally {
    delete process.env.AIE_TASK_QUEUE_DIR;
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("runAutonomousSession skips blocked features and prioritizes unlockers before unrelated ready work", async () => {
  const taskDirectory = path.resolve(process.cwd(), "temp-phase7d-feature-dependency-store");
  await rm(taskDirectory, { recursive: true, force: true });
  await mkdir(taskDirectory, { recursive: true });
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;

  try {
    const seedSession = createAutonomousSession({
      goal: "Respect feature dependencies when choosing the next queued feature.",
      sessionId: "phase7d-feature-dependency-session",
      maxSteps: 4,
      sessionMode: "repo-coding",
    });
    await enqueueTask(createTaskEnvelope({
      taskId: "phase7d-feature-a-1",
      sessionId: seedSession.sessionId,
      stepIndex: 1,
      priority: 1,
      featureId: "feature-a",
      featureTitle: "Feature A",
      action: makeSafeAction("Execute feature A task 1."),
    }));
    await enqueueTask(createTaskEnvelope({
      taskId: "phase7d-feature-b-1",
      sessionId: seedSession.sessionId,
      stepIndex: 2,
      priority: 10,
      dependsOnFeatureIds: ["feature-a"],
      featureId: "feature-b",
      featureTitle: "Feature B",
      action: makeSafeAction("Execute feature B task 1."),
    }));
    await enqueueTask(createTaskEnvelope({
      taskId: "phase7d-feature-c-1",
      sessionId: seedSession.sessionId,
      stepIndex: 3,
      priority: 9,
      featureId: "feature-c",
      featureTitle: "Feature C",
      action: makeSafeAction("Execute feature C task 1."),
    }));

    const session = await runAutonomousSession({
      goal: seedSession.goal,
      maxSteps: 4,
      existingSession: seedSession,
      dependencies: {
        runAnalysis: async () => ({
          what_happened: "Unexpected analysis call.",
          what_matters: ["Queued feature execution should stay dependency-aware."],
          what_to_do_next: ["Stop."],
          upgrade_hint: "",
          proposedAction: "Stop.",
          expectedOutcome: "Stop.",
          execution: makeSafeAction("Unexpected analysis path."),
        }),
        executeAction: async (action) => ({
          status: "success",
          output: `${action.description} completed successfully.`,
        }),
        saveAutonomousSession: async () => {},
      },
    });

    assert.deepEqual(session.steps.map((step) => step.taskId), ["phase7d-feature-a-1", "phase7d-feature-b-1", "phase7d-feature-c-1"]);
    assert.ok(session.oversight.featureDependencyGraph.includes("feature-b <- feature-a"));
    assert.deepEqual(session.oversight.completedFeatureIds, ["feature-a", "feature-b", "feature-c"]);
  } finally {
    delete process.env.AIE_TASK_QUEUE_DIR;
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("runAutonomousSession can skip the current queued task and continue to the next runnable task", async () => {
  const taskDirectory = path.resolve(process.cwd(), "temp-phase7c-skip-task-store");
  await rm(taskDirectory, { recursive: true, force: true });
  await mkdir(taskDirectory, { recursive: true });
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;

  try {
    const baseSession = createAutonomousSession({
      goal: "Skip the current queued task and keep the bounded session moving.",
      sessionId: "phase7c-skip-task-session",
      maxSteps: 4,
      sessionMode: "repo-coding",
    });
    const firstTask = await enqueueTask(createTaskEnvelope({
      taskId: "phase7c-skip-task-1",
      sessionId: baseSession.sessionId,
      stepIndex: 1,
      priority: 10,
      action: makeSafeAction("Execute queued task that should be skipped."),
    }));
    await enqueueTask(createTaskEnvelope({
      taskId: "phase7c-skip-task-2",
      sessionId: baseSession.sessionId,
      stepIndex: 2,
      priority: 5,
      action: makeSafeAction("Execute queued task after skip."),
    }));
    const steeredSession = updateAutonomousSessionSteering({
      ...baseSession,
      taskId: firstTask.taskId,
      taskStatus: firstTask.status,
    }, {
      action: "skip-current-task",
      operatorNote: "Skip the first queued task.",
    });

    let analysisCalls = 0;
    const session = await runAutonomousSession({
      goal: steeredSession.goal,
      maxSteps: 4,
      existingSession: steeredSession,
      queuedTask: firstTask,
      dependencies: {
        runAnalysis: async () => {
          analysisCalls += 1;
          return {
            what_happened: "Unexpected analysis call.",
            what_matters: ["Skipping the current queued task should continue directly into the next runnable task."],
            what_to_do_next: ["Stop."],
            upgrade_hint: "",
            proposedAction: "Stop.",
            expectedOutcome: "Stop.",
            execution: makeSafeAction("Unexpected analysis path."),
          };
        },
        executeAction: async (action: ExecutionActionPreview) => ({
          status: "success",
          output: `${action.description} completed successfully after the skipped task.`,
        }),
        saveAutonomousSession: async () => {},
      },
    });

    const skippedTask = await getTask("phase7c-skip-task-1");

    assert.equal(analysisCalls, 0);
    assert.equal(session.status, "completed");
    assert.deepEqual(session.workflowContinuity.taskChain.skippedTaskIds, ["phase7c-skip-task-1"]);
    assert.deepEqual(session.sessionLoop.skippedTaskIds, ["phase7c-skip-task-1"]);
    assert.deepEqual(session.steps.map((step) => step.taskId), ["phase7c-skip-task-2"]);
    assert.equal(skippedTask?.status, "rejected");
  } finally {
    delete process.env.AIE_TASK_QUEUE_DIR;
    await rm(taskDirectory, { recursive: true, force: true });
  }
});