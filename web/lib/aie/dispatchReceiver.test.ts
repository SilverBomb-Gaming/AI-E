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
  leaseId?: string;
  continuationToken?: string;
  continuation?: {
    priorLeaseId?: string;
    sourceNodeId?: string;
    targetNodeId?: string;
    generation: number;
    reason?: string;
    resumedFromCheckpointReference?: string;
    resumedFromContinuationToken?: string;
  };
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
      lease: {
        leaseId: params?.leaseId ?? `aie-lease-${taskId}`,
        ownerNodeId: targetNodeId,
        epoch: 1,
        continuationToken: params?.continuationToken,
        resumability: params?.continuationToken ? "resumable" : "restart-required",
      },
      continuation: params?.continuation
        ? {
            isContinuation: true,
            priorLeaseId: params.continuation.priorLeaseId,
            sourceNodeId: params.continuation.sourceNodeId,
            targetNodeId: params.continuation.targetNodeId,
            generation: params.continuation.generation,
            reason: params.continuation.reason,
            resumedFromCheckpointReference: params.continuation.resumedFromCheckpointReference,
            resumedFromContinuationToken: params.continuation.resumedFromContinuationToken,
          }
        : undefined,
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
      lease: {
        leaseId: "aie-lease-task-dispatch-receiver-1",
        ownerNodeId: "aie-node-headless-default",
        epoch: 1,
        startedAt: "2026-04-21T04:00:00.000Z",
        lastProgressAt: "2026-04-21T04:00:00.000Z",
        status: "active",
      },
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
      lease: {
        leaseId: "aie-lease-task-dispatch-receiver-2",
        ownerNodeId: "aie-node-headless-default",
        epoch: 1,
        startedAt: "2026-04-21T04:05:00.000Z",
        lastProgressAt: "2026-04-21T04:05:00.000Z",
        status: "active",
      },
    });
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-dispatch-receiver-3",
        sessionId: "session-dispatch-receiver-3",
        stepIndex: 1,
        action: createRequest({ taskId: "task-dispatch-receiver-3", sessionId: "session-dispatch-receiver-3" }).payload.action,
      }),
      status: "assigned",
      assignedNodeId: "aie-node-headless-default",
      lease: {
        leaseId: "aie-lease-task-dispatch-receiver-3",
        ownerNodeId: "aie-node-headless-default",
        epoch: 1,
        startedAt: "2026-04-21T04:06:00.000Z",
        lastProgressAt: "2026-04-21T04:06:00.000Z",
        status: "active",
      },
    });
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-dispatch-receiver-4",
        sessionId: "session-dispatch-receiver-4",
        stepIndex: 1,
        action: createRequest({ taskId: "task-dispatch-receiver-4", sessionId: "session-dispatch-receiver-4" }).payload.action,
      }),
      status: "assigned",
      assignedNodeId: "aie-node-headless-default",
      lease: {
        leaseId: "aie-lease-task-dispatch-receiver-4",
        ownerNodeId: "aie-node-headless-default",
        epoch: 1,
        startedAt: "2026-04-21T04:07:00.000Z",
        lastProgressAt: "2026-04-21T04:07:00.000Z",
        status: "active",
      },
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
        taskId: "task-dispatch-receiver-3",
        sessionId: "session-dispatch-receiver-3",
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
        taskId: "task-dispatch-receiver-4",
        sessionId: "session-dispatch-receiver-4",
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

test("dispatchReceiver rejects requests whose lease does not match persisted ownership", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-dispatch-receiver-session-store-3");
  const taskDirectory = path.resolve(process.cwd(), "temp-dispatch-receiver-task-store-3");
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
        taskId: "task-dispatch-receiver-5",
        sessionId: "session-dispatch-receiver-5",
        stepIndex: 1,
        action: createRequest({ taskId: "task-dispatch-receiver-5", sessionId: "session-dispatch-receiver-5", continuationToken: "persisted-token" }).payload.action,
      }),
      status: "assigned",
      assignedNodeId: "aie-node-headless-default",
      resumability: "resumable",
      continuationSourceNodeId: "aie-node-web-default",
      continuationTargetNodeId: "aie-node-headless-default",
      continuationGeneration: 1,
      continuationReason: "timeout-recovery",
      resumedFromCheckpointReference: "checkpoint://persisted-token",
      resumedFromContinuationToken: "persisted-token",
      continuationToken: "persisted-token",
      lease: {
        leaseId: "aie-lease-task-dispatch-receiver-5",
        ownerNodeId: "aie-node-headless-default",
        epoch: 1,
        startedAt: "2026-04-21T04:10:00.000Z",
        lastProgressAt: "2026-04-21T04:10:00.000Z",
        status: "active",
        continuationToken: "persisted-token",
      },
    });

    const result = await handleDispatchRequest({
      request: createRequest({
        taskId: "task-dispatch-receiver-5",
        sessionId: "session-dispatch-receiver-5",
        leaseId: "aie-lease-mismatch",
        continuationToken: "wrong-token",
        continuation: {
          priorLeaseId: "aie-lease-task-dispatch-receiver-4",
          sourceNodeId: "aie-node-web-default",
          targetNodeId: "aie-node-headless-default",
          generation: 1,
          reason: "timeout-recovery",
          resumedFromCheckpointReference: "checkpoint://persisted-token",
          resumedFromContinuationToken: "persisted-token",
        },
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

    assert.equal(result.status, "rejected");
    assert.equal(result.ack.payload.accepted, false);
    assert.match(result.reason ?? "", /lease ownership/i);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("dispatchReceiver rejects requests whose continuation lineage does not match persisted state", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-dispatch-receiver-session-store-4");
  const taskDirectory = path.resolve(process.cwd(), "temp-dispatch-receiver-task-store-4");
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
        taskId: "task-dispatch-receiver-6",
        sessionId: "session-dispatch-receiver-6",
        stepIndex: 1,
        action: createRequest({
          taskId: "task-dispatch-receiver-6",
          sessionId: "session-dispatch-receiver-6",
          continuationToken: "persisted-token-6",
          continuation: {
            priorLeaseId: "aie-lease-task-dispatch-receiver-5",
            sourceNodeId: "aie-node-web-default",
            targetNodeId: "aie-node-headless-default",
            generation: 1,
            reason: "timeout-recovery",
            resumedFromCheckpointReference: "checkpoint://persisted-token-6",
            resumedFromContinuationToken: "persisted-token-6",
          },
        }).payload.action,
      }),
      status: "assigned",
      assignedNodeId: "aie-node-headless-default",
      resumability: "resumable",
      continuationSourceNodeId: "aie-node-web-default",
      continuationTargetNodeId: "aie-node-headless-default",
      continuationGeneration: 1,
      continuationReason: "timeout-recovery",
      resumedFromCheckpointReference: "checkpoint://persisted-token-6",
      resumedFromContinuationToken: "persisted-token-6",
      continuationToken: "persisted-token-6",
      priorLeaseId: "aie-lease-task-dispatch-receiver-5",
      lease: {
        leaseId: "aie-lease-task-dispatch-receiver-6",
        ownerNodeId: "aie-node-headless-default",
        epoch: 1,
        startedAt: "2026-04-21T04:12:00.000Z",
        lastProgressAt: "2026-04-21T04:12:00.000Z",
        status: "active",
        continuationToken: "persisted-token-6",
      },
    });

    const result = await handleDispatchRequest({
      request: createRequest({
        taskId: "task-dispatch-receiver-6",
        sessionId: "session-dispatch-receiver-6",
        continuationToken: "persisted-token-6",
        continuation: {
          priorLeaseId: "aie-lease-task-dispatch-receiver-5",
          sourceNodeId: "aie-node-wrong-source",
          targetNodeId: "aie-node-headless-default",
          generation: 1,
          reason: "timeout-recovery",
          resumedFromCheckpointReference: "checkpoint://persisted-token-6",
          resumedFromContinuationToken: "persisted-token-6",
        },
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

    assert.equal(result.status, "rejected");
    assert.equal(result.ack.payload.accepted, false);
    assert.match(result.reason ?? "", /continuation source node/i);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});