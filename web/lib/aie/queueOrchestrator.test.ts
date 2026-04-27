import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createExecutionNodeDescriptor } from "./executionNode";
import { DispatchTransportTimeoutError } from "./dispatchTransport";
import { resetExecutionNodeRegistry } from "./executionNodeRegistry";
import { listAvailableExecutionNodes, registerExecutionNode } from "./executionNodeRegistry";
import {
  claimNextRunnableTask,
  executeQueuedTask,
  runSingleQueuedTask,
} from "./queueOrchestrator";
import { runAutonomousSession } from "./runAutonomousSession";
import { createTaskEnvelope, updateTaskEnvelopeStatus, type TaskEnvelope, type TaskEnvelopeStatus, type TaskEnvelopeTransitionMetadata } from "./taskEnvelope";
import { enqueueTask, getTask, updateTaskDispatchMetadata, updateTaskStatus } from "./taskQueueStore";
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
    assert.equal(claimed?.task.status, "dispatching");
    assert.equal(claimed?.task.runnerMode, "local-node");
    assert.equal(typeof claimed?.task.claimToken, "string");
    assert.equal(claimed?.task.selectedNodeId, claimed?.node.id);
    assert.equal(claimed?.task.remoteDispatchPlanned, undefined);
    assert.equal(claimed?.task.dispatchProtocolVersion, undefined);
    assert.equal(claimed?.task.dispatchStatusSummary, undefined);
    assert.equal(fetched?.taskId, "task-safe-oldest");
    assert.equal(fetched?.status, "dispatching");
    assert.equal(fetched?.dispatchProtocolVersion, undefined);
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
      {
        runtimeMode: "local",
        cwd: process.cwd(),
        maxSteps: 1,
        dispatchTransport: {
          async sendDispatchRequest({ request, dependencies }) {
            const task = await dependencies.updateTaskStatus(request.taskId, "completed", {
              assignedNodeId: request.targetNodeId,
              selectedNodeId: request.targetNodeId,
              selectedNodeReason: "Preferred capable local node selected.",
              dispatchMessageId: request.messageId,
              dispatchAckMessageId: `${request.messageId}-ack`,
              dispatchResultMessageId: `${request.messageId}-result`,
              dispatchTargetNodeId: request.targetNodeId,
              dispatchProtocolVersion: request.protocolVersion,
              dispatchStatusSummary: "dispatch=1 | type=result | status=completed",
              dispatchAuthSummary: "auth=aie-node-local-default->aie-node-local-default | scope=local-lab | valid=true",
              dispatchTransportStatus: "completed",
              dispatchRetryCount: 1,
              dispatchLastAttemptAt: request.createdAt,
              dispatchReceivedAt: request.createdAt,
              dispatchCompletedAt: request.createdAt,
              remoteDispatchPlanned: true,
              statusReason: "The queued validation completed successfully.",
            });

            return {
              status: "delivered",
              request,
              rawRequest: JSON.stringify(request),
              rawAck: "ack",
              rawResult: "result",
              task,
              session: {
                sessionId: `queue-task-${request.taskId}`,
                goal: "Validate run-success.",
                status: "completed",
                createdAt: request.createdAt,
                updatedAt: request.createdAt,
                currentStepIndex: 2,
                maxSteps: 1,
                lastStepIndex: 1,
                taskId: request.taskId,
                taskStatus: "completed",
                selectedNodeId: request.targetNodeId,
                selectedNodeReason: "Preferred capable local node selected.",
                dispatchProtocolVersion: request.protocolVersion,
                steps: [],
              },
            };
          },
          async receiveDispatchRequest() {
            throw new Error("Not implemented in this test transport.");
          },
          async sendDispatchAck() {
            return "ack";
          },
          async sendDispatchResult() {
            return "result";
          },
          async sendDispatchError() {
            return "error";
          },
        },
      },
    );

    const persisted = await getTask("task-run-success");

    assert.equal(summary.status, "completed");
    assert.equal(summary.task?.taskId, "task-run-success");
    assert.equal(summary.task?.status, "completed");
    assert.equal(summary.session?.taskId, "task-run-success");
    assert.equal(summary.session?.taskStatus, "completed");
    assert.equal(summary.task?.dispatchProtocolVersion, "1");
    assert.equal(summary.session?.dispatchProtocolVersion, "1");
    assert.equal(summary.selectedNodeId, summary.task?.selectedNodeId);
    assert.equal(summary.dispatchRetryCount, 1);
    assert.equal(summary.task?.lease?.ownerNodeId, summary.selectedNodeId);
    assert.equal(summary.task?.lease?.status, "completed");
    assert.equal(typeof summary.task?.dispatchAckMessageId, "string");
    assert.equal(typeof summary.task?.dispatchResultMessageId, "string");
    assert.match(summary.task?.dispatchAuthSummary ?? "", /scope=local-lab/i);
    assert.equal(summary.task?.dispatchTransportStatus, "completed");
    assert.match(summary.dispatchStatusSummary ?? "", /type=result/i);
    assert.equal(typeof summary.claimToken, "string");
    assert.match(summary.session?.sessionId ?? "", /queue-task-task-run-success/i);
    assert.equal(persisted?.status, "completed");
    assert.match(persisted?.dispatchStatusSummary ?? "", /type=result/i);
    assert.equal(typeof persisted?.dispatchAckMessageId, "string");
    assert.equal(typeof persisted?.dispatchResultMessageId, "string");
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
    let isolatedTask: TaskEnvelope | null = claimed?.task ?? null;
    const readIsolatedTask = async (taskId: string) => {
      if (!isolatedTask || isolatedTask.taskId !== taskId) {
        return null;
      }

      return isolatedTask;
    };
    const writeIsolatedTask = async (
      taskId: string,
      status: TaskEnvelopeStatus,
      metadata?: TaskEnvelopeTransitionMetadata,
    ) => {
      if (!isolatedTask || isolatedTask.taskId !== taskId) {
        return null;
      }

      isolatedTask = updateTaskEnvelopeStatus(isolatedTask, status, metadata);
      return isolatedTask;
    };
    const writeIsolatedDispatchMetadata = async (
      taskId: string,
      metadata: TaskEnvelopeTransitionMetadata,
    ) => {
      if (!isolatedTask || isolatedTask.taskId !== taskId) {
        return null;
      }

      isolatedTask = updateTaskEnvelopeStatus(isolatedTask, isolatedTask.status, metadata);
      return isolatedTask;
    };
    const summary = claimed
      ? await executeQueuedTask(
          claimed,
          { runtimeMode: "headless", cwd: process.cwd(), maxSteps: 1 },
          {
            getTask: readIsolatedTask,
            updateTaskStatus: writeIsolatedTask,
            finalizeTask: writeIsolatedTask,
            updateTaskDispatchMetadata: writeIsolatedDispatchMetadata,
            saveAutonomousSession: async () => {},
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
                updateTaskStatus: writeIsolatedTask,
              },
            }),
          },
        )
      : null;

    const persisted = await readIsolatedTask("task-run-failure");

    assert.equal(claimed?.task.taskId, "task-run-failure");
    assert.equal(duplicate, null);
    assert.equal(summary?.status, "failed");
    assert.equal(summary?.task?.status, "failed");
    assert.equal(persisted?.status, "failed");
    assert.equal(typeof persisted?.dispatchAckMessageId, "string");
    assert.equal(typeof persisted?.dispatchResultMessageId, "string");
    assert.equal(persisted?.dispatchTransportStatus, "delivered");
    assert.equal(typeof persisted?.failedAt, "string");
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("queueOrchestrator reselects another active node when the initial target becomes unavailable", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-session-store-4");
  const taskDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-task-store-4");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });

  try {
    await enqueueTask(createTaskEnvelope({
      taskId: "task-run-rejected",
      sessionId: "queue-session-rejected",
      stepIndex: 1,
      action: makeSafeAction("run-rejected"),
    }));
    const claimed = await claimNextRunnableTask({ runtimeMode: "headless", cwd: process.cwd() });
    assert.ok(claimed);
    registerExecutionNode(createExecutionNodeDescriptor({
      ...claimed.node,
      active: false,
      trustState: "trusted",
    }));

    const summary = claimed
      ? await executeQueuedTask(claimed, { runtimeMode: "web", cwd: process.cwd(), maxSteps: 1 })
      : null;
    const persisted = await getTask("task-run-rejected");

    assert.equal(summary?.status, "completed");
    assert.equal(summary?.task?.status, "completed");
    assert.equal(summary?.task?.selectedNodeId, summary?.selectedNodeId);
    assert.notEqual(summary?.task?.selectedNodeId, claimed.node.id);
    assert.equal(typeof summary?.task?.dispatchAckMessageId, "string");
    assert.equal(persisted?.dispatchTransportStatus, "completed");
    assert.equal(persisted?.status, "completed");
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("queueOrchestrator excludes stale nodes from future dispatch without duplicating execution", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-session-store-5");
  const taskDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-task-store-5");
  const registryDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-node-store-5");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  process.env.AIE_EXECUTION_NODE_REGISTRY_DIR = registryDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });
  await mkdir(registryDirectory, { recursive: true });

  try {
    const staleCandidate = registerExecutionNode(createExecutionNodeDescriptor({
      id: "aie-node-headless-stale-candidate",
      mode: "headless",
      label: "AI-E Headless Stale Candidate",
      capabilities: ["validation-check", "repo-scan"],
      active: true,
      trustState: "trusted",
      lastHeartbeatAt: new Date().toISOString(),
      cwd: process.cwd(),
      allowedRoots: [process.cwd()],
    }));
    const healthyCandidate = registerExecutionNode(createExecutionNodeDescriptor({
      id: "aie-node-headless-healthy-candidate",
      mode: "headless",
      label: "AI-E Headless Healthy Candidate",
      capabilities: ["validation-check", "repo-scan"],
      active: true,
      trustState: "trusted",
      lastHeartbeatAt: new Date().toISOString(),
      cwd: process.cwd(),
      allowedRoots: [process.cwd()],
    }));

    assert.deepEqual(
      listAvailableExecutionNodes({ requestedCapabilities: ["validation-check", "repo-scan"] }).map((node) => node.id),
      [healthyCandidate.id, staleCandidate.id],
    );

    registerExecutionNode(createExecutionNodeDescriptor({
      ...staleCandidate,
      active: true,
      status: "active",
      trustState: "trusted",
      lastHeartbeatAt: "2026-04-20T00:00:00.000Z",
    }));

    assert.deepEqual(
      listAvailableExecutionNodes({ requestedCapabilities: ["validation-check", "repo-scan"] }).map((node) => node.id),
      [healthyCandidate.id],
    );

    await enqueueTask(createTaskEnvelope({
      taskId: "task-run-stale-exclusion",
      sessionId: "queue-session-stale-exclusion",
      stepIndex: 1,
      action: makeSafeAction("run-stale-exclusion"),
      preferredNodeId: healthyCandidate.id,
    }));

    const dispatchedNodeIds: string[] = [];
    const summary = await runSingleQueuedTask(
      {
        runtimeMode: "headless",
        cwd: process.cwd(),
        maxSteps: 1,
        dispatchTransport: {
          async sendDispatchRequest({ request, dependencies }) {
            dispatchedNodeIds.push(request.targetNodeId);

            const task = await dependencies.updateTaskStatus(request.taskId, "completed", {
              assignedNodeId: request.targetNodeId,
              selectedNodeId: request.targetNodeId,
              selectedNodeReason: "Selected first deterministic capable node after stale-node exclusion.",
              dispatchMessageId: request.messageId,
              dispatchAckMessageId: `${request.messageId}-ack`,
              dispatchResultMessageId: `${request.messageId}-result`,
              dispatchTargetNodeId: request.targetNodeId,
              dispatchProtocolVersion: request.protocolVersion,
              dispatchStatusSummary: "dispatch=1 | type=result | status=completed",
              dispatchAuthSummary: "auth=aie-node-local-default->aie-node-headless-healthy-candidate | scope=local-lab | valid=true",
              dispatchTransportStatus: "completed",
              dispatchLastAttemptAt: request.createdAt,
              dispatchReceivedAt: request.createdAt,
              dispatchCompletedAt: request.createdAt,
              remoteDispatchPlanned: true,
              statusReason: "Healthy node completed the queued validation after stale-node exclusion.",
            });

            return {
              status: "delivered",
              request,
              rawRequest: JSON.stringify(request),
              rawAck: "ack",
              rawResult: "result",
              task,
              session: null,
            };
          },
          async receiveDispatchRequest() {
            throw new Error("Not implemented in this test transport.");
          },
          async sendDispatchAck() {
            return "ack";
          },
          async sendDispatchResult() {
            return "result";
          },
          async sendDispatchError() {
            return "error";
          },
        },
      },
    );

    assert.equal(summary.status, "completed");
    assert.equal(summary.task?.status, "completed");
    assert.equal(summary.selectedNodeId, healthyCandidate.id);
    assert.deepEqual(dispatchedNodeIds, [healthyCandidate.id]);
    assert.equal(summary.dispatchRetryCount, 1);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    delete process.env.AIE_EXECUTION_NODE_REGISTRY_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
    await rm(registryDirectory, { recursive: true, force: true });
  }
});

test("queueOrchestrator invalidates an active resumable lease and leaves deterministic recovery pending after timeout", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-session-store-6");
  const taskDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-task-store-6");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });

  try {
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-run-timeout-recovery",
        sessionId: "queue-session-timeout-recovery",
        stepIndex: 1,
        action: makeSafeAction("run-timeout-recovery"),
      }),
      resumability: "resumable",
      continuationToken: "continue-timeout-recovery",
      checkpointReference: "checkpoint://timeout-recovery",
      lastProgressMarker: "before-dispatch",
    });

    const claimed = await claimNextRunnableTask({ runtimeMode: "web", cwd: process.cwd() });
    assert.ok(claimed);

    const summary = await executeQueuedTask(claimed, {
      runtimeMode: "web",
      cwd: process.cwd(),
      maxSteps: 1,
      maxDispatchRetries: 1,
      dispatchTimeoutMs: 10,
      dispatchTransport: {
        async sendDispatchRequest() {
          throw new DispatchTransportTimeoutError(10);
        },
        async receiveDispatchRequest() {
          throw new Error("Not implemented in this test transport.");
        },
        async sendDispatchAck() {
          return "ack";
        },
        async sendDispatchResult() {
          return "result";
        },
        async sendDispatchError() {
          return "error";
        },
      },
    });

    const persisted = await getTask("task-run-timeout-recovery");

    assert.equal(summary.status, "retrying");
    assert.equal(summary.task?.status, "retrying");
    assert.equal(summary.task?.resumability, "resumable");
    assert.equal(summary.task?.resumeAttemptCount, 1);
    assert.equal(summary.task?.recoveryPending, true);
    assert.equal(summary.task?.lease?.status, "superseded");
    assert.equal(summary.task?.priorLeaseId, summary.task?.lease?.leaseId);
    assert.equal(summary.task?.continuationGeneration, 1);
    assert.equal(summary.task?.continuationSourceNodeId, claimed.task.selectedNodeId ?? claimed.node.id);
    assert.equal(summary.task?.continuationTargetNodeId, undefined);
    assert.equal(summary.task?.continuationReason, "timeout-recovery");
    assert.equal(summary.task?.resumedFromCheckpointReference, "checkpoint://timeout-recovery");
    assert.equal(summary.task?.resumedFromContinuationToken, "continue-timeout-recovery");
    assert.equal(summary.task?.continuationToken, "continue-timeout-recovery");
    assert.equal(persisted?.status, "retrying");
    assert.equal(persisted?.recoveryPending, true);
    assert.equal(persisted?.dispatchRetryCount, 1);
    assert.equal(persisted?.lease?.status, "superseded");
    assert.match(persisted?.statusReason ?? "", /recovery is pending/i);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("queueOrchestrator retries deterministically after a trusted-boundary dispatch rejection without duplicate execution", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-session-store-6b");
  const taskDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-task-store-6b");
  const registryDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-node-store-6b");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  process.env.AIE_EXECUTION_NODE_REGISTRY_DIR = registryDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });
  await mkdir(registryDirectory, { recursive: true });

  try {
    const firstNode = registerExecutionNode(createExecutionNodeDescriptor({
      id: "aie-node-headless-trust-retry-1-manual",
      mode: "headless",
      label: "AI-E Headless Trust Retry 1",
      capabilities: ["validation-check", "repo-scan"],
      active: true,
      trustState: "trusted",
      cwd: process.cwd(),
      allowedRoots: [process.cwd()],
    }));
    const secondNode = registerExecutionNode(createExecutionNodeDescriptor({
      id: "aie-node-headless-trust-retry-2-manual",
      mode: "headless",
      label: "AI-E Headless Trust Retry 2",
      capabilities: ["validation-check", "repo-scan"],
      active: true,
      trustState: "trusted",
      cwd: process.cwd(),
      allowedRoots: [process.cwd()],
    }));

    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-run-trust-retry",
        sessionId: "queue-session-trust-retry",
        stepIndex: 1,
        action: makeSafeAction("run-trust-retry"),
        
      }),
      resumability: "resumable",
      continuationToken: "continue-trust-retry",
      checkpointReference: "checkpoint://trust-retry",
    });

    const claimed = await claimNextRunnableTask({ runtimeMode: "headless", cwd: process.cwd() });
    assert.ok(claimed);

    const dispatchedNodeIds: string[] = [];
    let completionCount = 0;
    const summary = await executeQueuedTask(claimed, {
      runtimeMode: "headless",
      cwd: process.cwd(),
      maxSteps: 1,
      maxDispatchRetries: 1,
      dispatchTransport: {
        async sendDispatchRequest({ request, dependencies }) {
          dispatchedNodeIds.push(request.targetNodeId);

          if (dispatchedNodeIds.length === 1) {
            const task = await dependencies.updateTaskDispatchMetadata(request.taskId, {
              assignedNodeId: request.targetNodeId,
              selectedNodeId: request.targetNodeId,
              selectedNodeReason: "Any trusted node selected first.",
              dispatchMessageId: request.messageId,
              dispatchAckMessageId: `${request.messageId}-ack`,
              dispatchTargetNodeId: request.targetNodeId,
              dispatchProtocolVersion: request.protocolVersion,
              dispatchStatusSummary: "dispatch=1 | type=error | status=rejected | reason=trust-boundary",
              dispatchAuthSummary: `auth=aie-node-local-default->${request.targetNodeId} | scope=local-lab | valid=true`,
              dispatchTransportStatus: "rejected",
              dispatchRetryCount: 1,
              dispatchLastAttemptAt: request.createdAt,
              dispatchReceivedAt: request.createdAt,
              dispatchCompletedAt: request.createdAt,
              remoteDispatchPlanned: true,
              statusReason: "Execution node moved outside the allowed trust boundary.",
              failureReason: "Execution node moved outside the allowed trust boundary.",
            });

            return {
              status: "rejected",
              request,
              rawRequest: JSON.stringify(request),
              rawAck: "ack",
              rawError: "error",
              reason: "Execution node moved outside the allowed trust boundary.",
              task,
              session: null,
            };
          }

          completionCount += 1;
          const task = await dependencies.updateTaskStatus(request.taskId, "completed", {
            assignedNodeId: request.targetNodeId,
            selectedNodeId: request.targetNodeId,
            selectedNodeReason: "Selected deterministic fallback node after trust rejection.",
            dispatchMessageId: request.messageId,
            dispatchAckMessageId: `${request.messageId}-ack`,
            dispatchResultMessageId: `${request.messageId}-result`,
            dispatchTargetNodeId: request.targetNodeId,
            dispatchProtocolVersion: request.protocolVersion,
            dispatchStatusSummary: "dispatch=1 | type=result | status=completed",
            dispatchAuthSummary: `auth=aie-node-local-default->${request.targetNodeId} | scope=local-lab | valid=true`,
            dispatchTransportStatus: "completed",
            dispatchRetryCount: 2,
            dispatchLastAttemptAt: request.createdAt,
            dispatchReceivedAt: request.createdAt,
            dispatchCompletedAt: request.createdAt,
            remoteDispatchPlanned: true,
            statusReason: "Trusted fallback node completed the queued validation.",
          });

          return {
            status: "delivered",
            request,
            rawRequest: JSON.stringify(request),
            rawAck: "ack",
            rawResult: "result",
            task,
            session: null,
          };
        },
        async receiveDispatchRequest() {
          throw new Error("Not implemented in this test transport.");
        },
        async sendDispatchAck() {
          return "ack";
        },
        async sendDispatchResult() {
          return "result";
        },
        async sendDispatchError() {
          return "error";
        },
      },
    });

    const persisted = await getTask("task-run-trust-retry");

    assert.equal(summary.status, "completed");
    assert.equal(summary.task?.status, "completed");
    assert.equal(dispatchedNodeIds.length, 2);
    assert.notEqual(dispatchedNodeIds[0], dispatchedNodeIds[1]);
    assert.equal(summary.task?.selectedNodeId, dispatchedNodeIds[1]);
    assert.equal(summary.task?.resumeAttemptCount, 1);
    assert.equal(summary.task?.continuationGeneration, 1);
    assert.equal(completionCount, 1);
    assert.equal(persisted?.status, "completed");
    assert.equal(persisted?.selectedNodeId, dispatchedNodeIds[1]);
    assert.equal(persisted?.dispatchRetryCount, 2);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    delete process.env.AIE_EXECUTION_NODE_REGISTRY_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
    await rm(registryDirectory, { recursive: true, force: true });
  }
});

test("queueOrchestrator restarts from a safe boundary for restart-required timeout recovery", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-session-store-6c");
  const taskDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-task-store-6c");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });

  try {
    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-run-restart-boundary",
        sessionId: "queue-session-restart-boundary",
        stepIndex: 2,
        action: makeSafeAction("run-restart-boundary"),
      }),
      resumability: "restart-required",
      continuationToken: "continue-restart-boundary",
      checkpointReference: "checkpoint://restart-boundary",
      lastProgressMarker: "step-2/safe-stop",
    });

    const claimed = await claimNextRunnableTask({ runtimeMode: "web", cwd: process.cwd() });
    assert.ok(claimed);

    const summary = await executeQueuedTask(claimed, {
      runtimeMode: "web",
      cwd: process.cwd(),
      maxSteps: 1,
      maxDispatchRetries: 1,
      dispatchTimeoutMs: 10,
      dispatchTransport: {
        async sendDispatchRequest() {
          throw new DispatchTransportTimeoutError(10);
        },
        async receiveDispatchRequest() {
          throw new Error("Not implemented in this test transport.");
        },
        async sendDispatchAck() {
          return "ack";
        },
        async sendDispatchResult() {
          return "result";
        },
        async sendDispatchError() {
          return "error";
        },
      },
    });

    const persisted = await getTask("task-run-restart-boundary");

    assert.equal(summary.status, "retrying");
    assert.equal(summary.task?.status, "retrying");
    assert.equal(summary.task?.resumability, "restart-required");
    assert.equal(summary.task?.resumeAttemptCount, 1);
    assert.equal(summary.task?.recoveryPending, true);
    assert.equal(summary.task?.continuationGeneration, 0);
    assert.equal(summary.task?.continuationSourceNodeId, undefined);
    assert.equal(summary.task?.continuationTargetNodeId, undefined);
    assert.equal(summary.task?.resumedFromCheckpointReference, undefined);
    assert.equal(summary.task?.resumedFromContinuationToken, undefined);
    assert.equal(summary.task?.continuationToken, undefined);
    assert.equal(summary.task?.checkpointReference, undefined);
    assert.equal(summary.task?.lastProgressMarker, "step-2/safe-stop");
    assert.equal(persisted?.continuationGeneration, 0);
    assert.equal(persisted?.continuationToken, undefined);
    assert.equal(persisted?.checkpointReference, undefined);
    assert.match(persisted?.statusReason ?? "", /recovery is pending/i);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
  }
});

test("queueOrchestrator performs deterministic cross-node continuation with preserved task and session identity", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-session-store-7");
  const taskDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-task-store-7");
  const registryDirectory = path.resolve(process.cwd(), "temp-queue-orchestrator-node-store-7");
  resetExecutionNodeRegistry();
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
  process.env.AIE_EXECUTION_NODE_REGISTRY_DIR = registryDirectory;
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(taskDirectory, { recursive: true });
  await mkdir(registryDirectory, { recursive: true });

  try {
    const preferredNode = registerExecutionNode(createExecutionNodeDescriptor({
      id: "aie-node-headless-continuation-source",
      mode: "headless",
      label: "AI-E Headless Continuation Source",
      capabilities: ["validation-check", "repo-scan"],
      active: true,
      trustState: "trusted",
      cwd: process.cwd(),
      allowedRoots: [process.cwd()],
    }));
    const recoveryNode = registerExecutionNode(createExecutionNodeDescriptor({
      id: "aie-node-headless-continuation-target",
      mode: "headless",
      label: "AI-E Headless Continuation Target",
      capabilities: ["validation-check", "repo-scan"],
      active: true,
      trustState: "trusted",
      cwd: process.cwd(),
      allowedRoots: [process.cwd()],
    }));

    await enqueueTask({
      ...createTaskEnvelope({
        taskId: "task-run-cross-node-continuation",
        sessionId: "queue-session-cross-node-continuation",
        stepIndex: 1,
        action: makeSafeAction("run-cross-node-continuation"),
        preferredNodeId: preferredNode.id,
      }),
      resumability: "resumable",
      continuationToken: "continue-cross-node-continuation",
      checkpointReference: "checkpoint://cross-node-continuation",
    });

    const claimed = await claimNextRunnableTask({ runtimeMode: "headless", cwd: process.cwd() });
    assert.ok(claimed);
    assert.equal(claimed.task.sessionId, "queue-session-cross-node-continuation");
    assert.equal(claimed.task.selectedNodeId, preferredNode.id);

    const dispatchedNodeIds: string[] = [];
    const dispatchedContinuations: Array<Record<string, unknown> | undefined> = [];
    let attempt = 0;
    const summary = await executeQueuedTask(claimed, {
      runtimeMode: "headless",
      cwd: process.cwd(),
      maxSteps: 1,
      maxDispatchRetries: 1,
      dispatchTransport: {
        async sendDispatchRequest({ request, dependencies }) {
          attempt += 1;
          dispatchedNodeIds.push(request.targetNodeId);
          dispatchedContinuations.push(request.payload.continuation as Record<string, unknown> | undefined);

          if (attempt === 1) {
            throw new DispatchTransportTimeoutError(10);
          }

          const task = await dependencies.updateTaskStatus(request.taskId, "completed", {
            assignedNodeId: request.targetNodeId,
            selectedNodeId: request.targetNodeId,
            selectedNodeReason: "Selected deterministic capable node for resumed continuation.",
            dispatchMessageId: request.messageId,
            dispatchAckMessageId: `${request.messageId}-ack`,
            dispatchResultMessageId: `${request.messageId}-result`,
            dispatchTargetNodeId: request.targetNodeId,
            dispatchProtocolVersion: request.protocolVersion,
            dispatchStatusSummary: "dispatch=1 | type=result | status=completed",
            dispatchAuthSummary: "auth=aie-node-local-default->aie-node-headless-continuation-target | scope=local-lab | valid=true",
            dispatchTransportStatus: "completed",
            dispatchRetryCount: 2,
            dispatchLastAttemptAt: request.createdAt,
            dispatchReceivedAt: request.createdAt,
            dispatchCompletedAt: request.createdAt,
            remoteDispatchPlanned: true,
            statusReason: "Resumed continuation completed on the recovery node.",
          });

          return {
            status: "delivered",
            request,
            rawRequest: JSON.stringify(request),
            rawAck: "ack",
            rawResult: "result",
            task,
            session: {
              sessionId: request.sessionId,
              goal: "Validate run-cross-node-continuation.",
              status: "completed",
              createdAt: request.createdAt,
              updatedAt: request.createdAt,
              currentStepIndex: 2,
              maxSteps: 1,
              lastStepIndex: 1,
              taskId: request.taskId,
              taskStatus: "completed",
              selectedNodeId: request.targetNodeId,
              selectedNodeReason: "Selected deterministic capable node for resumed continuation.",
              dispatchProtocolVersion: request.protocolVersion,
              steps: [],
            },
          };
        },
        async receiveDispatchRequest() {
          throw new Error("Not implemented in this test transport.");
        },
        async sendDispatchAck() {
          return "ack";
        },
        async sendDispatchResult() {
          return "result";
        },
        async sendDispatchError() {
          return "error";
        },
      },
    });

    const persisted = await getTask("task-run-cross-node-continuation");

    assert.equal(summary.status, "completed");
    assert.equal(summary.task?.taskId, "task-run-cross-node-continuation");
    assert.equal(summary.task?.sessionId, "queue-session-cross-node-continuation");
    assert.equal(summary.session?.sessionId, "queue-session-cross-node-continuation");
    assert.equal(summary.task?.continuationGeneration, 1);
    assert.equal(summary.task?.continuationSourceNodeId, preferredNode.id);
    assert.equal(summary.task?.continuationTargetNodeId, recoveryNode.id);
    assert.equal(summary.task?.continuationReason, "timeout-recovery");
    assert.equal(summary.task?.priorLeaseId, summary.task?.lease?.supersededByLeaseId ?? summary.task?.priorLeaseId);
    assert.equal(summary.task?.resumedFromCheckpointReference, "checkpoint://cross-node-continuation");
    assert.equal(summary.task?.resumedFromContinuationToken, "continue-cross-node-continuation");
    assert.equal(summary.task?.lease?.ownerNodeId, recoveryNode.id);
    assert.equal(summary.task?.lease?.status, "completed");
    assert.deepEqual(dispatchedNodeIds, [preferredNode.id, recoveryNode.id]);
    assert.equal(dispatchedContinuations[0], undefined);
    assert.equal(dispatchedContinuations[1]?.generation, 1);
    assert.equal(dispatchedContinuations[1]?.sourceNodeId, preferredNode.id);
    assert.equal(dispatchedContinuations[1]?.targetNodeId, recoveryNode.id);
    assert.match(String(dispatchedContinuations[1]?.resumedFromCheckpointBinding ?? ""), /^aie-bind-v1:/);
    assert.match(String(dispatchedContinuations[1]?.resumedFromContinuationBinding ?? ""), /^aie-bind-v1:/);
    assert.equal(persisted?.taskId, "task-run-cross-node-continuation");
    assert.equal(persisted?.sessionId, "queue-session-cross-node-continuation");
    assert.equal(persisted?.continuationGeneration, 1);
    assert.equal(persisted?.continuationSourceNodeId, preferredNode.id);
    assert.equal(persisted?.continuationTargetNodeId, recoveryNode.id);
    assert.equal(persisted?.resumeAttemptCount, 1);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    delete process.env.AIE_TASK_QUEUE_DIR;
    delete process.env.AIE_EXECUTION_NODE_REGISTRY_DIR;
    resetExecutionNodeRegistry();
    await rm(sessionDirectory, { recursive: true, force: true });
    await rm(taskDirectory, { recursive: true, force: true });
    await rm(registryDirectory, { recursive: true, force: true });
  }
});
