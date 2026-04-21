import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { formatLocalNodeSessionOutput, formatLocalNodeTaskList, formatLocalNodeTaskOutput, runLocalNode } from "./local_node";
import { listExecutionNodes, resetExecutionNodeRegistry } from "./lib/aie/executionNodeRegistry";
import { listTasks } from "./lib/aie/taskQueueStore";
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