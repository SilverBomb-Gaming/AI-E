import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  formatLocalNodeQueueRunOutput,
  formatLocalNodeSessionOutput,
  formatLocalNodeTaskList,
  formatLocalNodeTaskOutput,
  parseLocalNodeArgs,
  runLocalNode,
  runLocalNodeQueuedTask,
} from "./local_node";
import { createTaskEnvelope } from "./lib/aie/taskEnvelope";
import { listExecutionNodes, resetExecutionNodeRegistry } from "./lib/aie/executionNodeRegistry";
import { enqueueTask, listTasks } from "./lib/aie/taskQueueStore";
import type { FreeAnalysisResponse } from "./lib/aie/types";

test("local_node runs a bounded goal, creates a session, and prints a structured summary", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-local-node-session-store");
  const taskDirectory = path.resolve(process.cwd(), "temp-local-node-task-store");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });

  try {
    const session = await runLocalNode(
      {
        goal: "Confirm the local node can validate a bounded repo goal.",
        maxSteps: 2,
        cwd: process.cwd(),
      },
      {
        runAnalysis: async () => ({
          what_happened: "The local validation confirmed the expected healthy output and resolved the bounded goal.",
          what_matters: ["The local node should keep using the shared runner."],
          what_to_do_next: ["Stop."],
          upgrade_hint: "",
          proposedAction: "Validate the bounded local output.",
          expectedOutcome: "The healthy bounded output should be confirmed.",
          execution: {
            id: "local-validate",
            type: "validation-check",
            scope: "safe",
            description: "Validate the bounded local output.",
            expectedOutcome: "The healthy bounded output should be confirmed.",
            requiresApproval: true,
            metadata: {
              sourceActionType: "validation-check",
            },
          },
        }) as FreeAnalysisResponse,
        executeAction: async () => ({
          status: "success",
          output: "Healthy status confirmed, issue resolved, and expected outcome validated successfully.",
        }),
        saveAutonomousSession: async () => {},
      },
    );

    const textOutput = formatLocalNodeSessionOutput(session, { verbose: true });
    const jsonOutput = formatLocalNodeSessionOutput(session, { json: true });
    const jsonSummary = JSON.parse(jsonOutput) as Record<string, unknown>;
    const tasks = await listTasks();
    const taskOutput = tasks[0] ? formatLocalNodeTaskOutput(tasks[0]) : "";
    const taskListOutput = await formatLocalNodeTaskList();

    assert.equal(typeof session.sessionId, "string");
    assert.equal(session.status, "completed");
    assert.equal(session.executionAdapterId, "headless-local");
    assert.equal(session.executionNodeMode, "local-node");
    assert.equal(session.taskStatus, "completed");
    assert.match(textOutput, /Session ID:/i);
    assert.match(textOutput, /Step 1/i);
    assert.match(jsonOutput, /"sessionId"/i);
    assert.equal(typeof jsonSummary.executionNodeId, "string");
    assert.match(String(jsonSummary.nodeCapabilitySummary ?? ""), /validation-check/i);
    assert.equal(tasks.length, 1);
    assert.match(taskOutput, /Task ID:/i);
    assert.match(taskOutput, /Status: completed/i);
    assert.match(taskListOutput, /completed/i);
    assert.ok(listExecutionNodes().some((node) => node.mode === "local-node"));
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("local_node queue entrypoints run one queued task and print a queue summary", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-local-node-queue-session-store");
  const taskDirectory = path.resolve(process.cwd(), "temp-local-node-queue-task-store");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });

  try {
    const parsed = parseLocalNodeArgs(["--runNextTask", "--json"]);
    await enqueueTask(createTaskEnvelope({
      taskId: "task-local-queue-1",
      sessionId: "session-local-queue-1",
      stepIndex: 1,
      action: {
        id: "local-queued-action",
        type: "validation-check",
        scope: "safe",
        description: "Validate the local queued output.",
        expectedOutcome: "The local queued output should be confirmed.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "validation-check",
        },
      },
    }));

    const summary = await runLocalNodeQueuedTask(
      {
        goal: "",
        runNextTask: true,
        cwd: process.cwd(),
      },
      {
        runSingleQueuedTask: async () => ({
          status: "completed",
          nodeId: "aie-node-local-default",
          runnerMode: "local-node",
          claimToken: "claim-local-1",
          queueStateSummary: "task=task-local-queue-1 status=completed node=aie-node-local-default",
          task: (await listTasks())[0] ?? null,
          session: {
            sessionId: "session-local-queue-1--queue-task-local-queue-1",
            goal: "Queued local validation.",
            status: "completed",
            createdAt: "2026-04-21T00:00:00.000Z",
            updatedAt: "2026-04-21T00:00:01.000Z",
            currentStepIndex: 1,
            maxSteps: 1,
            steps: [],
          },
        }),
      },
    );
    const output = formatLocalNodeQueueRunOutput(summary);

    assert.equal(parsed.runNextTask, true);
    assert.equal(parsed.json, true);
    assert.equal(summary.status, "completed");
    assert.match(output, /Queue run: completed/i);
    assert.match(output, /Task ID: task-local-queue-1/i);
    assert.match(output, /Claim token: claim-local-1/i);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});