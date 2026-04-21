import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { resetExecutionNodeRegistry } from "./executionNodeRegistry";
import {
  claimNextRunnableTask,
  executeQueuedTask,
  runSingleQueuedTask,
} from "./queueOrchestrator";
import { runAutonomousSession } from "./runAutonomousSession";
import { createTaskEnvelope } from "./taskEnvelope";
import { enqueueTask, getTask, updateTaskStatus } from "./taskQueueStore";
import type { FreeAnalysisResponse } from "./types";

function makeSafeAction(id: string) {
  return {
    id,
    type: "validation-check" as const,
    scope: "safe" as const,
    description: `Validate ${id}.`,
    expectedOutcome: `Validation ${id} should complete successfully.`,
    requiresApproval: true,
    metadata: {
      sourceActionType: "validation-check",
    },
  };
}

test("queueOrchestrator claims the oldest runnable safe task and skips non-runnable tasks", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-session-store-1");
  const taskDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-task-store-1");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });

  try {
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-dangerous-first",
        sessionId: "queue-session-1",
        stepIndex: 1,
        action: {
          ...makeSafeAction("dangerous-first"),
          scope: "dangerous",
        },
      }),
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
    });
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-safe-oldest",
        sessionId: "queue-session-2",
        stepIndex: 1,
        action: makeSafeAction("safe-oldest"),
      }),
      createdAt: "2026-04-21T00:00:01.000Z",
      updatedAt: "2026-04-21T00:00:01.000Z",
    });
    const laterTask = await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-safe-assigned",
        sessionId: "queue-session-3",
        stepIndex: 1,
        action: makeSafeAction("safe-assigned"),
      }),
      createdAt: "2026-04-21T00:00:02.000Z",
      updatedAt: "2026-04-21T00:00:02.000Z",
    });
    await updateTaskStatus(laterTask.taskId, "blocked", { statusReason: "Not runnable." });

    const claimed = await claimNextRunnableTask({ runtimeMode: "local", cwd: process.cwd() });
    const fetched = claimed?.task ? await getTask(claimed.task.taskId) : null;

    assert.equal(claimed?.task.taskId, "task-safe-oldest");
    assert.equal(claimed?.task.status, "assigned");
    assert.equal(claimed?.task.runnerMode, "local-node");
    assert.equal(typeof claimed?.task.claimToken, "string");
    assert.equal(fetched?.taskId, "task-safe-oldest");
    assert.equal(fetched?.status, "assigned");
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("queueOrchestrator executes one queued task and persists completion", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-session-store-2");
  const taskDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-task-store-2");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });

  try {
    await enqueueTask(createTaskEnvelope({
      taskId: "task-run-success",
      sessionId: "queue-session-success",
      stepIndex: 1,
      action: makeSafeAction("run-success"),
    }));

    const summary = await runSingleQueuedTask(
      { runtimeMode: "local", cwd: process.cwd(), maxSteps: 1 },
      {
        runAutonomousSession: async (params) => runAutonomousSession({
          ...params,
          dependencies: {
            runAnalysis: async () => ({
              what_happened: "The queued validation completed successfully.",
              what_matters: ["The queued task should finalize as completed."],
              what_to_do_next: ["Stop."],
              upgrade_hint: "",
              proposedAction: "Validate the queued task.",
              expectedOutcome: "The queued task should complete successfully.",
              execution: makeSafeAction("run-success"),
            }) as FreeAnalysisResponse,
            executeAction: async () => ({
              status: "success",
              output: "Queued validation succeeded.",
            }),
            saveAutonomousSession: async () => {},
          },
        }),
      },
    );

    const persisted = await getTask("task-run-success");

    assert.equal(summary.status, "completed");
    assert.equal(summary.task?.taskId, "task-run-success");
    assert.equal(summary.task?.status, "completed");
    assert.equal(summary.session?.taskId, "task-run-success");
    assert.equal(summary.session?.taskStatus, "completed");
    assert.equal(typeof summary.claimToken, "string");
    assert.match(summary.session?.sessionId ?? "", /queue-task-run-success/i);
    assert.equal(persisted?.status, "completed");
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("queueOrchestrator finalizes failed execution and prevents duplicate claims", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-session-store-3");
  const taskDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-task-store-3");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });

  try {
    await enqueueTask(createTaskEnvelope({
      taskId: "task-run-failure",
      sessionId: "queue-session-failure",
      stepIndex: 1,
      action: makeSafeAction("run-failure"),
    }));
    const claimed = await claimNextRunnableTask({ runtimeMode: "headless", cwd: process.cwd() });
    const duplicate = await claimNextRunnableTask({ taskId: "task-run-failure", runtimeMode: "headless", cwd: process.cwd() });
    const summary = claimed
      ? await executeQueuedTask(
          claimed,
          { runtimeMode: "headless", cwd: process.cwd(), maxSteps: 1 },
          {
            runAutonomousSession: async (params) => runAutonomousSession({
              ...params,
              dependencies: {
                runAnalysis: async () => ({
                  what_happened: "The queued validation failed.",
                  what_matters: ["The queued task should finalize as failed."],
                  what_to_do_next: ["Stop."],
                  upgrade_hint: "",
                  proposedAction: "Validate the queued task.",
                  expectedOutcome: "The queued task should fail.",
                  execution: makeSafeAction("run-failure"),
                }) as FreeAnalysisResponse,
                executeAction: async () => ({
                  status: "failed",
                  error: "Queued validation failed.",
                  output: "Queued validation failed.",
                }),
                saveAutonomousSession: async () => {},
              },
            }),
          },
        )
      : null;

    const persisted = await getTask("task-run-failure");

    assert.equal(claimed?.task.taskId, "task-run-failure");
    assert.equal(duplicate, null);
    assert.equal(summary?.status, "failed");
    assert.equal(summary?.task?.status, "failed");
    assert.equal(persisted?.status, "failed");
    assert.equal(typeof persisted?.failedAt, "string");
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});