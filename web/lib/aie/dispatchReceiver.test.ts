import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createDispatchAuthToken } from "./dispatchAuth";
import { createTaskDispatchRequest } from "./dispatchMessages";
import { createDispatchEnvelope } from "./dispatchProtocol";
import { handleDispatchRequest } from "./dispatchReceiver";
import { createExecutionNodeDescriptor } from "./executionNode";
import { registerExecutionNode, resetExecutionNodeRegistry } from "./executionNodeRegistry";
import { createTaskEnvelope } from "./taskEnvelope";
import { enqueueTask, getTask, updateTaskDispatchMetadata, updateTaskStatus } from "./taskQueueStore";

function createRequest(params?: {
  taskId?: string;
  sessionId?: string;
  targetNodeId?: string;
  requestedCapabilities?: Array<"inspection" | "validation-check" | "file-write" | "test-run" | "repo-scan">;
  authTargetNodeId?: string;
}) {
  const taskId = params?.taskId ?? "task-dispatch-receiver-1";
  const sessionId = params?.sessionId ?? "session-dispatch-receiver-1";
  const targetNodeId = params?.targetNodeId ?? "aie-node-headless-default";

  return createDispatchEnvelope({
    messageType: "task-dispatch-request",
    sourceNodeId: "aie-node-local-default",
    targetNodeId,
    taskId,
    sessionId,
    payload: createTaskDispatchRequest({
      action: {
        id: `${taskId}-action`,
        type: "validation-check",
        scope: "safe",
        description: "Validate the bounded receive path.",
        expectedOutcome: "The request should be validated at the receive boundary.",
        requiresApproval: true,
        metadata: {
          sourceActionType: "validation-check",
        },
      },
      requestedCapabilities: params?.requestedCapabilities ?? ["validation-check", "repo-scan"],
      assignedNodeId: targetNodeId,
      authToken: createDispatchAuthToken({
        sourceNodeId: "aie-node-local-default",
        targetNodeId: params?.authTargetNodeId ?? targetNodeId,
        taskId,
        sessionId,
      }),
      dispatchAuthSummary: "auth=aie-node-local-default->aie-node-headless-default | scope=local-lab | valid=true",
      remoteDispatchPlanned: true,
    }),
  });
}

test("dispatchReceiver accepts a valid request and routes it into the shared stack", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-dispatch-receiver-session-store-1");
  const taskDirectory = path.resolve(process.cwd(), "temp-dispatch-receiver-task-store-1");
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
      cwd: process.cwd(),
      allowedRoots: [process.cwd()],
    }));
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-dispatch-receiver-1",
        sessionId: "session-dispatch-receiver-1",
        stepIndex: 1,
        action: createRequest().payload.action,
      }),
      status: "assigned",
      assignedNodeId: "aie-node-headless-default",
    });

    const result = await handleDispatchRequest({
      request: createRequest(),
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

    assert.equal(result.status, "accepted");
    assert.equal(result.ack.payload.accepted, true);
    assert.equal(result.result?.payload.status, "completed");
    assert.match(result.authSummary, /scope=local-lab/i);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("dispatchReceiver rejects invalid auth, unknown targets, and unsupported capabilities", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-dispatch-receiver-session-store-2");
  const taskDirectory = path.resolve(process.cwd(), "temp-dispatch-receiver-task-store-2");
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
      capabilities: ["validation-check"],
      active: true,
      cwd: process.cwd(),
      allowedRoots: [process.cwd()],
    }));
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-dispatch-receiver-2",
        sessionId: "session-dispatch-receiver-2",
        stepIndex: 1,
        action: createRequest({ taskId: "task-dispatch-receiver-2", sessionId: "session-dispatch-receiver-2" }).payload.action,
      }),
      status: "assigned",
      assignedNodeId: "aie-node-headless-default",
    });

    const badAuth = await handleDispatchRequest({
      request: createRequest({
        taskId: "task-dispatch-receiver-2",
        sessionId: "session-dispatch-receiver-2",
        authTargetNodeId: "aie-node-other-default",
      }),
      dependencies: {
        getTask,
        updateTaskStatus,
        updateTaskDispatchMetadata,
        executeClaimedTask: async () => {
          throw new Error("should not execute");
        },
      },
    });
    const unknownTarget = await handleDispatchRequest({
      request: createRequest({
        taskId: "task-dispatch-receiver-2",
        sessionId: "session-dispatch-receiver-2",
        targetNodeId: "aie-node-unknown-default",
      }),
      dependencies: {
        getTask,
        updateTaskStatus,
        updateTaskDispatchMetadata,
        executeClaimedTask: async () => {
          throw new Error("should not execute");
        },
      },
    });
    const unsupported = await handleDispatchRequest({
      request: createRequest({
        taskId: "task-dispatch-receiver-2",
        sessionId: "session-dispatch-receiver-2",
        requestedCapabilities: ["validation-check", "repo-scan"],
      }),
      dependencies: {
        getTask,
        updateTaskStatus,
        updateTaskDispatchMetadata,
        executeClaimedTask: async () => {
          throw new Error("should not execute");
        },
      },
    });

    assert.equal(badAuth.status, "rejected");
    assert.equal(badAuth.ack.payload.accepted, false);
    assert.equal(unknownTarget.status, "rejected");
    assert.equal(unsupported.status, "rejected");
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});