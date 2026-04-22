import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { listExecutionNodes, resetExecutionNodeRegistry } from "./executionNodeRegistry";
import { runAutonomousSession } from "./runAutonomousSession";
import { getTask, listTasks } from "./taskQueueStore";
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
  assert.equal(resumed.workflowContinuity.progress.chainPhase, "completed");
  assert.equal(resumed.workflowContinuity.progress.lastCompletedSafeStep, 3);
  assert.match(resumed.workflowContinuity.memory.chainSummary ?? "", /goal status: complete/i);
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