import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createTaskEnvelope } from "./taskEnvelope";
import {
  assignTaskToNode,
  claimTask,
  enqueueTask,
  finalizeTask,
  getTask,
  getRunnableTasks,
  listTasks,
  listTasksByStatus,
  removeTask,
  updateTaskStatus,
} from "./taskQueueStore";
import type { ExecutionActionPreview } from "./types";

function makeAction(): ExecutionActionPreview {
  return {
    id: "queued-action",
    type: "inspection",
    scope: "safe",
    description: "Inspect the bounded target.",
    expectedOutcome: "The bounded target should be summarized.",
    requiresApproval: true,
    metadata: {
      sourceActionType: "inspection",
      targetPath: "web/lib/aie/types.ts",
    },
  };
}

test("taskQueueStore enqueues, lists, gets, assigns, and updates persisted tasks", async () => {
  const taskDirectory = path.resolve(process.cwd(), "temp-task-queue-store");
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(taskDirectory, { recursive: true });

  try {
    const queued = await enqueueTask(createTaskEnvelope({
      taskId: "task-queue-1",
      sessionId: "session-queue-1",
      stepIndex: 1,
      action: makeAction(),
    }));
    const assigned = await assignTaskToNode(queued.taskId, "aie-node-local-default");
    const running = await updateTaskStatus(queued.taskId, "running", {
      statusReason: "Executing inside the shared runner.",
    });
    const completed = await updateTaskStatus(queued.taskId, "completed", {
      statusReason: "The bounded execution completed.",
    });
    const fetched = await getTask(queued.taskId);
    const listed = await listTasks();

    assert.equal(queued.status, "queued");
    assert.equal(assigned?.status, "assigned");
    assert.equal(assigned?.assignedNodeId, "aie-node-local-default");
    assert.equal(running?.status, "running");
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.statusReason, "The bounded execution completed.");
    assert.equal(fetched?.taskId, queued.taskId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.taskId, queued.taskId);

    await removeTask(queued.taskId);
    assert.equal(await getTask(queued.taskId), null);
  } finally {
    delete process.env.AIE_TASK_QUEUE_DIR;
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("taskQueueStore persists claims, runnable filtering, and explicit finalization", async () => {
  const taskDirectory = path.resolve(process.cwd(), "temp-task-queue-claim-store");
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(taskDirectory, { recursive: true });

  try {
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-old-safe",
        sessionId: "session-queue-2",
        stepIndex: 1,
        priority: 1,
        action: makeAction(),
      }),
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
    });
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-dangerous",
        sessionId: "session-queue-3",
        stepIndex: 1,
        priority: 10,
        action: {
          ...makeAction(),
          id: "dangerous-action",
          scope: "dangerous",
        },
      }),
      createdAt: "2026-04-21T00:00:01.000Z",
      updatedAt: "2026-04-21T00:00:01.000Z",
    });
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-new-safe",
        sessionId: "session-queue-4",
        stepIndex: 1,
        priority: 5,
        action: makeAction(),
      }),
      createdAt: "2026-04-21T00:00:02.000Z",
      updatedAt: "2026-04-21T00:00:02.000Z",
    });
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-dependent-safe",
        sessionId: "session-queue-5",
        stepIndex: 1,
        priority: 9,
        dependsOnTaskIds: ["task-old-safe"],
        action: makeAction(),
      }),
      createdAt: "2026-04-21T00:00:03.000Z",
      updatedAt: "2026-04-21T00:00:03.000Z",
    });

    const runnable = await getRunnableTasks();
    const claimed = await claimTask("task-old-safe", "claim-token-1", "local-node", "aie-node-local-default");
    const secondClaim = await claimTask("task-old-safe", "claim-token-2", "local-node", "aie-node-local-default");
    const running = claimed
      ? await updateTaskStatus(claimed.taskId, "running", { statusReason: "Running inside local queue orchestration." })
      : null;
    const completed = claimed
      ? await finalizeTask(claimed.taskId, "completed", { statusReason: "Completed through explicit finalizeTask." })
      : null;
    const completedTasks = await listTasksByStatus("completed");
    const runnableAfterCompletion = await getRunnableTasks();

    assert.deepEqual(runnable.map((task) => task.taskId), ["task-new-safe", "task-old-safe"]);
    assert.equal(claimed?.status, "dispatching");
    assert.equal(claimed?.claimToken, "claim-token-1");
    assert.equal(claimed?.runnerMode, "local-node");
    assert.equal(claimed?.claimedAt, undefined);
    assert.equal(secondClaim, null);
    assert.equal(running?.status, "executing");
    assert.equal(completed?.status, "completed");
    assert.equal(typeof completed?.completedAt, "string");
    assert.deepEqual(completedTasks.map((task) => task.taskId), ["task-old-safe"]);
    assert.deepEqual(runnableAfterCompletion.map((task) => task.taskId), ["task-dependent-safe", "task-new-safe"]);
  } finally {
    delete process.env.AIE_TASK_QUEUE_DIR;
    await rm(taskDirectory, { recursive: true, force: true });
  }
});