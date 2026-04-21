import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createDispatchAuthToken } from "./dispatchAuth";
import { createTaskDispatchRequest } from "./dispatchMessages";
import { createDispatchEnvelope } from "./dispatchProtocol";
import {
  createLocalControlledDispatchTransport,
  receiveDispatchMessage,
  sendDispatchMessage,
  simulateLocalDispatchRoundTrip,
} from "./dispatchTransport";
import { createExecutionNodeDescriptor } from "./executionNode";
import { registerExecutionNode, resetExecutionNodeRegistry } from "./executionNodeRegistry";
import { createTaskEnvelope } from "./taskEnvelope";
import { enqueueTask, getTask, updateTaskDispatchMetadata, updateTaskStatus } from "./taskQueueStore";

function createRequest(taskId: string, sessionId: string) {
  const leaseId = `aie-lease-${taskId}`;
  return createDispatchEnvelope({
    messageType: "task-dispatch-request",
    sourceNodeId: "aie-node-local-default",
    targetNodeId: "aie-node-headless-default",
    taskId,
    sessionId,
    payload: createTaskDispatchRequest({
      action: {
        id: `${taskId}-action`,
        type: "validation-check",
        scope: "safe",
        description: "Validate the transport payload.",
        expectedOutcome: "The transport payload should remain valid.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "validation-check",
        },
      },
      requestedCapabilities: ["validation-check", "repo-scan"],
      assignedNodeId: "aie-node-headless-default",
      lease: {
        leaseId,
        ownerNodeId: "aie-node-headless-default",
        epoch: 1,
        resumability: "restart-required",
      },
      authToken: createDispatchAuthToken({
        sourceNodeId: "aie-node-local-default",
        targetNodeId: "aie-node-headless-default",
        taskId,
        sessionId,
      }),
      dispatchAuthSummary: "auth=aie-node-local-default->aie-node-headless-default | scope=local-lab | valid=true",
      remoteDispatchPlanned: true,
    }),
  });
}

test("dispatchTransport serializes and rehydrates validated messages", async () => {
  const envelope = createRequest("task-dispatch-transport-1", "session-dispatch-transport-1");

  const serialized = await sendDispatchMessage(envelope);
  const received = await receiveDispatchMessage(serialized);

  assert.equal(received?.messageId, envelope.messageId);
  assert.equal(received?.messageType, "task-dispatch-request");
});

test("dispatchTransport simulates local ack and result messages without executing remotely", () => {
  const request = createRequest("task-dispatch-transport-2", "session-dispatch-transport-2");

  const roundTrip = simulateLocalDispatchRoundTrip({
    request,
    accepted: true,
    resultPayload: {
      status: "completed",
      linkedTaskId: request.taskId,
      linkedSessionId: request.sessionId,
      summary: "Completed through the shared local runner.",
    },
  });

  assert.equal(roundTrip.ack.payload.accepted, true);
  assert.equal(roundTrip.result?.payload.status, "completed");
  assert.equal(roundTrip.error, undefined);
});

test("dispatchTransport runs a controlled local request ack result flow", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-dispatch-transport-session-store");
  const taskDirectory = path.resolve(process.cwd(), "temp-dispatch-transport-task-store");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });

  try {
    registerExecutionNode(createExecutionNodeDescriptor({
      id: "aie-node-headless-default",
      mode: "headless",
      label: "AI-E Headless Test Node",
      capabilities: ["validation-check", "repo-scan"],
      active: true,
      trustState: "trusted",
      cwd: process.cwd(),
      allowedRoots: [process.cwd()],
    }));
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-dispatch-transport-3",
        sessionId: "session-dispatch-transport-3",
        stepIndex: 1,
        action: createRequest("task-dispatch-transport-3", "session-dispatch-transport-3").payload.action,
      }),
      status: "assigned",
      assignedNodeId: "aie-node-headless-default",
      lease: {
        leaseId: "aie-lease-task-dispatch-transport-3",
        ownerNodeId: "aie-node-headless-default",
        epoch: 1,
        startedAt: "2026-04-21T03:00:00.000Z",
        lastProgressAt: "2026-04-21T03:00:00.000Z",
        status: "active",
      },
    });
    const transport = createLocalControlledDispatchTransport();
    const result = await transport.sendDispatchRequest({
      request: createRequest("task-dispatch-transport-3", "session-dispatch-transport-3"),
      dependencies: {
        getTask,
        updateTaskStatus,
        updateTaskDispatchMetadata,
        executeClaimedTask: async (claimed) => ({
          status: "completed",
          nodeId: claimed.node.id,
          queueStateSummary: "task completed through the shared stack",
          task: {
            ...claimed.task,
            status: "completed",
          },
          session: null,
        }),
      },
    });

    assert.equal(result.status, "delivered");
    assert.equal(result.ack?.payload.accepted, true);
    assert.equal(result.result?.payload.status, "completed");
    assert.match(result.authSummary ?? "", /scope=local-lab/i);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("dispatchTransport reports failed delivery when the receiver execution throws", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-dispatch-transport-session-store-failed");
  const taskDirectory = path.resolve(process.cwd(), "temp-dispatch-transport-task-store-failed");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });

  try {
    registerExecutionNode(createExecutionNodeDescriptor({
      id: "aie-node-headless-default",
      mode: "headless",
      label: "AI-E Headless Test Node",
      capabilities: ["validation-check", "repo-scan"],
      active: true,
      trustState: "trusted",
      cwd: process.cwd(),
      allowedRoots: [process.cwd()],
    }));
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-dispatch-transport-4",
        sessionId: "session-dispatch-transport-4",
        stepIndex: 1,
        action: createRequest("task-dispatch-transport-4", "session-dispatch-transport-4").payload.action,
      }),
      status: "assigned",
      assignedNodeId: "aie-node-headless-default",
      lease: {
        leaseId: "aie-lease-task-dispatch-transport-4",
        ownerNodeId: "aie-node-headless-default",
        epoch: 1,
        startedAt: "2026-04-21T03:05:00.000Z",
        lastProgressAt: "2026-04-21T03:05:00.000Z",
        status: "active",
      },
    });
    const transport = createLocalControlledDispatchTransport();
    const result = await transport.sendDispatchRequest({
      request: createRequest("task-dispatch-transport-4", "session-dispatch-transport-4"),
      context: {
        runtimeMode: "headless",
        cwd: process.cwd(),
      },
      dependencies: {
        getTask,
        updateTaskStatus,
        updateTaskDispatchMetadata,
        executeClaimedTask: async () => {
          throw new Error("Receiver execution failed.");
        },
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.error?.messageType, "task-dispatch-error");
    assert.match(result.reason ?? "", /failed/i);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});