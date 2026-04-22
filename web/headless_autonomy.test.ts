import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  formatHeadlessQueueRunReport,
  formatHeadlessSessionReport,
  formatHeadlessSessionSummary,
  formatHeadlessTaskList,
  formatHeadlessTaskReport,
  parseArgs,
  runHeadlessAutonomy,
  runHeadlessQueuedTask,
} from "./headless_autonomy";
import { createTaskEnvelope } from "./lib/aie/taskEnvelope";
import { listExecutionNodes, resetExecutionNodeRegistry } from "./lib/aie/executionNodeRegistry";
import { enqueueTask, listTasks } from "./lib/aie/taskQueueStore";
import type { FreeAnalysisResponse } from "./lib/aie/types";

test("headless_autonomy persists a bounded session and prints a matching summary", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-headless-session-store");
  const taskDirectory = path.resolve(process.cwd(), "temp-headless-task-store");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });

  try {
    const session = await runHeadlessAutonomy(
      {
        goal: "Confirm a safe bounded headless validation result.",
        maxSteps: 2,
        cwd: process.cwd(),
      },
      {
        runAnalysis: async () => ({
          what_happened: "The headless validation confirmed the expected healthy output and resolved the bounded goal.",
          what_matters: ["The headless path should still reuse the same bounded runner."],
          what_to_do_next: ["Stop."],
          upgrade_hint: "",
          proposedAction: "Validate the bounded headless output.",
          expectedOutcome: "The healthy bounded output should be confirmed.",
          execution: {
            id: "headless-validate",
            type: "validation-check",
            scope: "safe",
            description: "Validate the bounded headless output.",
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
    const summary = JSON.parse(formatHeadlessSessionSummary(session)) as Record<string, unknown>;
    const tasks = await listTasks();
    const taskReport = tasks[0] ? formatHeadlessTaskReport(tasks[0]) : "";
    const taskList = await formatHeadlessTaskList();

    assert.equal(typeof summary.sessionId, "string");
    assert.equal(summary.status, session.status);
    assert.equal(summary.completionStatus, session.latestCompletion?.status ?? null);
    assert.equal(summary.adapter, "headless-local");
    assert.equal(summary.executionNodeMode, "headless");
    assert.equal(typeof summary.executionNodeId, "string");
    assert.match(String(summary.nodeCapabilitySummary ?? ""), /validation-check/i);
    assert.equal(summary.taskStatus, "completed");
    assert.match(formatHeadlessSessionReport(session, { verbose: true }), /Step 1/i);
    assert.match(formatHeadlessSessionReport(session), /Session mode:/i);
    assert.match(formatHeadlessSessionReport(session), /Coding loop phase:/i);
    assert.match(formatHeadlessSessionReport(session), /Current coding objective:/i);
    assert.match(formatHeadlessSessionReport(session), /Current deliverable target:/i);
    assert.match(formatHeadlessSessionReport(session), /Expected output form:/i);
    assert.match(formatHeadlessSessionReport(session), /Validation success target:/i);
    assert.match(formatHeadlessSessionReport(session), /Current acceptance target:/i);
    assert.match(formatHeadlessSessionReport(session), /Current target status:/i);
    assert.match(formatHeadlessSessionReport(session), /Validation proves:/i);
    assert.match(formatHeadlessSessionReport(session), /Validation target matches deliverable:/i);
    assert.match(formatHeadlessSessionReport(session), /Validation failure impact:/i);
    assert.match(formatHeadlessSessionReport(session), /Correction maintains deliverable:/i);
    assert.match(formatHeadlessSessionReport(session), /Deliverable changed during correction or escalation:/i);
    assert.match(formatHeadlessSessionReport(session), /Deliverable accepted:/i);
    assert.match(formatHeadlessSessionReport(session), /Acceptance confidence:/i);
    assert.match(formatHeadlessSessionReport(session), /Completion state:/i);
    assert.match(formatHeadlessSessionReport(session), /Operator confirmation required:/i);
    assert.match(formatHeadlessSessionReport(session), /Loop should terminate:/i);
    assert.match(formatHeadlessSessionReport(session), /Acceptance reason:/i);
    assert.match(formatHeadlessSessionReport(session), /Acceptance summary:/i);
    assert.match(formatHeadlessSessionReport(session), /Output linked to deliverable:/i);
    assert.match(formatHeadlessSessionReport(session), /Files affected:/i);
    assert.match(formatHeadlessSessionReport(session), /Last output summary:/i);
    assert.match(formatHeadlessSessionReport(session), /Output artifacts:/i);
    assert.match(formatHeadlessSessionReport(session), /Repo action summary:/i);
    assert.match(formatHeadlessSessionReport(session), /Pending repo actions:/i);
    assert.match(formatHeadlessSessionReport(session), /Executed repo actions:/i);
    assert.match(formatHeadlessSessionReport(session), /Current validation target:/i);
    assert.match(formatHeadlessSessionReport(session), /Last implementation summary:/i);
    assert.match(formatHeadlessSessionReport(session), /Last validation summary:/i);
    assert.match(formatHeadlessSessionReport(session), /Last validation result summary:/i);
    assert.match(formatHeadlessSessionReport(session), /Last correction summary:/i);
    assert.match(formatHeadlessSessionReport(session), /Validation-first coding behavior:/i);
    assert.match(formatHeadlessSessionReport(session), /Repeated validation failure driving escalation:/i);
    assert.match(formatHeadlessSessionReport(session), /Recommendation confidence:/i);
    assert.match(formatHeadlessSessionReport(session), /Recommendation rationale:/i);
    assert.match(formatHeadlessSessionReport(session), /Recommendation review summary:/i);
    assert.match(formatHeadlessSessionReport(session), /Last recommendation follow-through status:/i);
    assert.match(formatHeadlessSessionReport(session), /Follow-through helped:/i);
    assert.match(formatHeadlessSessionReport(session), /Recommendation escalation status:/i);
    assert.match(formatHeadlessSessionReport(session), /Recommendation recovery guidance:/i);
    assert.match(formatHeadlessSessionReport(session), /Recommendation handoff status:/i);
    assert.match(formatHeadlessSessionReport(session), /Recovery execution summary:/i);
    assert.match(formatHeadlessSessionReport(session), /Recommendation frequently overridden:/i);
    assert.match(formatHeadlessSessionReport(session, { json: true, verbose: true }), /"sessionId"/i);
    assert.equal(tasks.length, 1);
    assert.match(taskReport, /Status: completed/i);
    assert.match(taskList, /completed/i);
    assert.ok(listExecutionNodes().some((node) => node.mode === "headless"));
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("headless_autonomy queue entrypoints run one queued task and print a queue summary", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-headless-queue-session-store");
  const taskDirectory = path.resolve(process.cwd(), "temp-headless-queue-task-store");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });

  try {
    const parsed = parseArgs(["--taskId", "task-headless-queue-1", "--runTask", "--json"]);
    await enqueueTask(createTaskEnvelope({
      taskId: "task-headless-queue-1",
      sessionId: "session-headless-queue-1",
      stepIndex: 1,
      action: {
        id: "headless-queued-action",
        type: "validation-check",
        scope: "safe",
        description: "Validate the headless queued output.",
        expectedOutcome: "The headless queued output should be confirmed.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "validation-check",
        },
      },
    }));

    const summary = await runHeadlessQueuedTask(
      {
        goal: "",
        taskId: "task-headless-queue-1",
        runTask: true,
        cwd: process.cwd(),
      },
      {
        runSingleQueuedTask: async () => ({
          status: "completed",
          nodeId: "aie-node-headless-default",
          runnerMode: "headless",
          claimToken: "claim-headless-1",
          dispatchMessageId: "aie-dispatch-headless-1",
          dispatchAckMessageId: "aie-dispatch-headless-ack-1",
          dispatchResultMessageId: "aie-dispatch-headless-result-1",
          dispatchTargetNodeId: "aie-node-headless-default",
          dispatchProtocolVersion: "1",
          dispatchAuthSummary: "auth=aie-node-local-default->aie-node-headless-default | scope=local-lab | valid=true",
          dispatchTransportStatus: "completed",
          dispatchStatusSummary: "dispatch=1 | type=result | status=completed",
          queueStateSummary: "task=task-headless-queue-1 status=completed node=aie-node-headless-default",
          task: (await listTasks())[0] ?? null,
          session: {
            sessionId: "session-headless-queue-1--queue-task-headless-queue-1",
            goal: "Queued headless validation.",
            status: "completed",
            createdAt: "2026-04-21T00:00:00.000Z",
            updatedAt: "2026-04-21T00:00:01.000Z",
            currentStepIndex: 1,
            maxSteps: 1,
            dispatchMessageId: "aie-dispatch-headless-1",
            dispatchAckMessageId: "aie-dispatch-headless-ack-1",
            dispatchResultMessageId: "aie-dispatch-headless-result-1",
            dispatchTargetNodeId: "aie-node-headless-default",
            dispatchProtocolVersion: "1",
            dispatchAuthSummary: "auth=aie-node-local-default->aie-node-headless-default | scope=local-lab | valid=true",
            dispatchTransportStatus: "completed",
            dispatchStatusSummary: "dispatch=1 | type=result | status=completed",
            steps: [],
          },
        }),
      },
    );
    const output = formatHeadlessQueueRunReport(summary);

    assert.equal(parsed.runTask, true);
    assert.equal(parsed.taskId, "task-headless-queue-1");
    assert.equal(parsed.json, true);
    assert.equal(summary.status, "completed");
    assert.match(output, /Queue run: completed/i);
    assert.match(output, /Task ID: task-headless-queue-1/i);
    assert.match(output, /Claim token: claim-headless-1/i);
    assert.match(output, /Dispatch message: aie-dispatch-headless-1/i);
    assert.match(output, /Dispatch ack: aie-dispatch-headless-ack-1/i);
    assert.match(output, /Dispatch transport: completed/i);
    assert.match(output, /Dispatch summary: dispatch=1 \| type=result \| status=completed/i);
    assert.match(output, /Session mode:/i);
    assert.match(output, /Coding loop phase:/i);
    assert.match(output, /Current coding objective:/i);
    assert.match(output, /Current deliverable target:/i);
    assert.match(output, /Expected output form:/i);
    assert.match(output, /Validation success target:/i);
    assert.match(output, /Current acceptance target:/i);
    assert.match(output, /Current target status:/i);
    assert.match(output, /Validation proves:/i);
    assert.match(output, /Validation target matches deliverable:/i);
    assert.match(output, /Validation failure impact:/i);
    assert.match(output, /Correction maintains deliverable:/i);
    assert.match(output, /Deliverable changed during correction or escalation:/i);
    assert.match(output, /Deliverable accepted:/i);
    assert.match(output, /Acceptance confidence:/i);
    assert.match(output, /Completion state:/i);
    assert.match(output, /Operator confirmation required:/i);
    assert.match(output, /Loop should terminate:/i);
    assert.match(output, /Acceptance reason:/i);
    assert.match(output, /Acceptance summary:/i);
    assert.match(output, /Output linked to deliverable:/i);
    assert.match(output, /Files affected:/i);
    assert.match(output, /Last output summary:/i);
    assert.match(output, /Output artifacts:/i);
    assert.match(output, /Repo action summary:/i);
    assert.match(output, /Pending repo actions:/i);
    assert.match(output, /Executed repo actions:/i);
    assert.match(output, /Current validation target:/i);
    assert.match(output, /Last implementation summary:/i);
    assert.match(output, /Last validation summary:/i);
    assert.match(output, /Last correction summary:/i);
    assert.match(output, /Validation-first coding behavior:/i);
    assert.match(output, /Repeated validation failure driving escalation:/i);
    assert.match(output, /Recommendation confidence:/i);
    assert.match(output, /Recommendation review summary:/i);
    assert.match(output, /Last recommendation review outcome:/i);
    assert.match(output, /Last recommendation follow-through status:/i);
    assert.match(output, /Repeated review without progress:/i);
    assert.match(output, /Recommendation escalation status:/i);
    assert.match(output, /Recommendation recovery guidance:/i);
    assert.match(output, /Recommendation handoff status:/i);
    assert.match(output, /Recovery execution summary:/i);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("headless_autonomy parses bounded steering flags", () => {
  const parsed = parseArgs([
    "--sessionId",
    "session-steer-1",
    "--steering",
    "accept-current-recommendation",
    "--operatorNote",
    "Validate before the next fix.",
    "--overrideReason",
    "The prior fix recommendation is premature.",
    "--restartReason",
    "Return to the last safe checkpoint.",
  ]);

  assert.equal(parsed.sessionId, "session-steer-1");
  assert.equal(parsed.steeringAction, "accept-current-recommendation");
  assert.equal(parsed.operatorNote, "Validate before the next fix.");
  assert.equal(parsed.overrideReason, "The prior fix recommendation is premature.");
  assert.equal(parsed.restartReason, "Return to the last safe checkpoint.");
});