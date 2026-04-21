import { saveAutonomousSession } from "./autonomousSessionStore";
import {
  createAutonomousSession,
  markAwaitingApproval,
  type AutonomousSession,
} from "./autonomousSession";
import {
  createRuntimeExecutionNodeDescriptor,
  summarizeExecutionNodeCapabilities,
  type ExecutionNodeDescriptor,
} from "./executionNode";
import { listAvailableExecutionNodes, registerExecutionNode } from "./executionNodeRegistry";
import { createDispatchAuthToken, summarizeDispatchAuthContext } from "./dispatchAuth";
import { createDispatchEnvelope, type DispatchProtocolVersion } from "./dispatchProtocol";
import { createTaskDispatchRequest, summarizeDispatchPayload } from "./dispatchMessages";
import {
  DispatchTransportTimeoutError,
  createLocalControlledDispatchTransport,
  sendDispatchRequestWithTimeout,
  type DispatchTransport,
  waitForDispatchRetryDelay,
} from "./dispatchTransport";
import { resolveRepoRoot } from "./repoContext";
import { runAutonomousSession } from "./runAutonomousSession";
import {
  claimTask,
  finalizeTask,
  getRunnableTasks,
  getTask,
  updateTaskDispatchMetadata,
  updateTaskStatus,
} from "./taskQueueStore";
import {
  summarizeTaskEnvelope,
  type TaskDispatchTransportStatus,
  type TaskEnvelope,
} from "./taskEnvelope";

type QueueOrchestratorDependencies = {
  getRunnableTasks: typeof getRunnableTasks;
  getTask: typeof getTask;
  claimTask: typeof claimTask;
  finalizeTask: typeof finalizeTask;
  updateTaskStatus: typeof updateTaskStatus;
  updateTaskDispatchMetadata: typeof updateTaskDispatchMetadata;
  saveAutonomousSession: typeof saveAutonomousSession;
  runAutonomousSession: typeof runAutonomousSession;
};

type QueueExecutionContext = {
  runtimeMode?: "web" | "headless" | "local";
  cwd?: string;
  allowedRoots?: string[];
  maxSteps?: number;
  dispatchTransport?: DispatchTransport;
  maxDispatchRetries?: number;
  dispatchRetryDelayMs?: number;
  dispatchTimeoutMs?: number;
};

type ExecutionNodeSelection = {
  node: ExecutionNodeDescriptor;
  reason: string;
};

export type ClaimedQueuedTask = {
  task: TaskEnvelope;
  node: ExecutionNodeDescriptor;
};

export type QueueExecutionSummary = {
  task: TaskEnvelope | null;
  session: AutonomousSession | null;
  nodeId?: string;
  selectedNodeId?: string;
  selectedNodeReason?: string;
  runnerMode?: TaskEnvelope["runnerMode"];
  claimToken?: string;
  dispatchMessageId?: string;
  dispatchAckMessageId?: string;
  dispatchResultMessageId?: string;
  dispatchTargetNodeId?: string;
  dispatchProtocolVersion?: DispatchProtocolVersion;
  dispatchStatusSummary?: string;
  dispatchAuthSummary?: string;
  dispatchTransportStatus?: TaskDispatchTransportStatus;
  dispatchRetryCount?: number;
  dispatchLastAttemptAt?: string;
  dispatchTimeoutMs?: number;
  failureReason?: string;
  retryCount?: number;
  status: "claimed" | "completed" | "failed" | "blocked" | "rejected" | "retrying" | "no-runnable-task";
  queueStateSummary?: string;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function createClaimToken(): string {
  if (globalThis.crypto?.randomUUID) {
    return `aie-claim-${globalThis.crypto.randomUUID()}`;
  }

  return `aie-claim-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveDependencies(
  dependencies?: Partial<QueueOrchestratorDependencies>,
): QueueOrchestratorDependencies {
  return {
    getRunnableTasks: dependencies?.getRunnableTasks ?? getRunnableTasks,
    getTask: dependencies?.getTask ?? getTask,
    claimTask: dependencies?.claimTask ?? claimTask,
    finalizeTask: dependencies?.finalizeTask ?? finalizeTask,
    updateTaskStatus: dependencies?.updateTaskStatus ?? updateTaskStatus,
    updateTaskDispatchMetadata: dependencies?.updateTaskDispatchMetadata ?? updateTaskDispatchMetadata,
    saveAutonomousSession: dependencies?.saveAutonomousSession ?? saveAutonomousSession,
    runAutonomousSession: dependencies?.runAutonomousSession ?? runAutonomousSession,
  };
}

function buildQueuedSession(task: TaskEnvelope, node: ExecutionNodeDescriptor, maxSteps?: number): AutonomousSession {
  const goal = normalizeText(task.action.expectedOutcome) || normalizeText(task.action.description) || `Execute queued task ${task.taskId}.`;
  const pendingSession = createAutonomousSession({
    goal,
    maxSteps: maxSteps ?? 1,
    sessionId: `${task.sessionId}--queue-${task.taskId}`,
  });
  const awaitingApproval = markAwaitingApproval(
    pendingSession,
    task.action,
    `Controlled queue orchestration claimed ${task.taskId} for single-run execution on ${node.id}.`,
  );

  return {
    ...awaitingApproval,
    executionNodeId: node.id,
    executionNodeMode: node.mode,
    nodeCapabilitySummary: summarizeExecutionNodeCapabilities(node.capabilities),
    selectedNodeId: task.selectedNodeId ?? task.assignedNodeId ?? node.id,
    selectedNodeReason: task.selectedNodeReason,
    taskId: task.taskId,
    taskStatus: task.status,
    assignedNodeId: task.assignedNodeId,
    queueStateSummary: summarizeTaskEnvelope(task),
    dispatchMessageId: task.dispatchMessageId,
    dispatchAckMessageId: task.dispatchAckMessageId,
    dispatchResultMessageId: task.dispatchResultMessageId,
    dispatchTargetNodeId: task.dispatchTargetNodeId,
    dispatchProtocolVersion: task.dispatchProtocolVersion,
    dispatchStatusSummary: task.dispatchStatusSummary,
    dispatchAuthSummary: task.dispatchAuthSummary,
    dispatchTransportStatus: task.dispatchTransportStatus,
    failureReason: task.failureReason,
    remoteDispatchPlanned: task.remoteDispatchPlanned,
  };
}

function normalizeDispatchRetryLimit(value: unknown): number {
  const numericValue = Number(value ?? 2);
  if (!Number.isFinite(numericValue)) {
    return 2;
  }

  return Math.max(0, Math.min(3, Math.floor(numericValue)));
}

function normalizeDispatchDelay(value: unknown): number {
  const numericValue = Number(value ?? 25);
  if (!Number.isFinite(numericValue)) {
    return 25;
  }

  return Math.max(0, Math.floor(numericValue));
}

function normalizeDispatchTimeout(value: unknown): number {
  const numericValue = Number(value ?? 250);
  if (!Number.isFinite(numericValue)) {
    return 250;
  }

  return Math.max(1, Math.floor(numericValue));
}

function shouldRetryDispatchFailure(reason: string | undefined, status: "rejected" | "failed" | "timeout"): boolean {
  const normalizedReason = normalizeText(reason).toLowerCase();

  if (!normalizedReason) {
    return status !== "rejected";
  }

  if (normalizedReason.includes("auth")) {
    return false;
  }

  if (normalizedReason.includes("capab")) {
    return false;
  }

  if (normalizedReason.includes("timeout")) {
    return true;
  }

  if (normalizedReason.includes("busy") || normalizedReason.includes("inactive") || normalizedReason.includes("not registered") || normalizedReason.includes("unavailable")) {
    return true;
  }

  return status === "failed" || status === "timeout";
}

function selectExecutionNodeForTask(
  task: TaskEnvelope,
  context: {
    runtimeMode?: "web" | "headless" | "local";
    cwd?: string;
    preferredNodeId?: string;
    excludedNodeIds?: Set<string>;
  },
): ExecutionNodeSelection | null {
  const availableNodes = listAvailableExecutionNodes({
    requestedCapabilities: task.requestedCapabilities,
  }).filter((node) => !context.excludedNodeIds?.has(node.id));

  if (!availableNodes.length) {
    return null;
  }

  const preferredNodeId = normalizeText(context.preferredNodeId || task.preferredNodeId);
  const preferred = preferredNodeId ? availableNodes.find((node) => node.id === preferredNodeId) : null;
  if (preferred) {
    return {
      node: preferred,
      reason: `Preferred capable node ${preferred.id} was available.`,
    };
  }

  const normalizedCwd = normalizeText(context.cwd);
  const localCwdMatch = normalizedCwd
    ? availableNodes.find((node) => node.mode === "local-node" && normalizeText(node.cwd) === normalizedCwd)
    : null;
  if (localCwdMatch) {
    return {
      node: localCwdMatch,
      reason: `Selected local node ${localCwdMatch.id} because its cwd matched the active workspace.`,
    };
  }

  const normalizedRuntimeMode = context.runtimeMode === "local" ? "local-node" : normalizeText(context.runtimeMode);
  const matchingMode = normalizedRuntimeMode
    ? availableNodes.find((node) => node.mode === normalizedRuntimeMode)
    : null;
  if (matchingMode) {
    return {
      node: matchingMode,
      reason: `Selected capable node ${matchingMode.id} because it matched runtime mode ${normalizedRuntimeMode}.`,
    };
  }

  const localFallback = availableNodes.find((node) => node.mode === "local-node");
  if (localFallback) {
    return {
      node: localFallback,
      reason: `Fell back to capable local node ${localFallback.id}.`,
    };
  }

  return {
    node: availableNodes[0] as ExecutionNodeDescriptor,
    reason: `Selected first deterministic capable node ${(availableNodes[0] as ExecutionNodeDescriptor).id}.`,
  };
}

function summarizeQueueExecution(
  task: TaskEnvelope | null,
  session: AutonomousSession | null,
  status: QueueExecutionSummary["status"],
): QueueExecutionSummary {
  return {
    task,
    session,
    nodeId: task?.assignedNodeId,
    selectedNodeId: task?.selectedNodeId ?? task?.assignedNodeId,
    selectedNodeReason: task?.selectedNodeReason,
    runnerMode: task?.runnerMode,
    claimToken: task?.claimToken,
    dispatchMessageId: task?.dispatchMessageId,
    dispatchAckMessageId: task?.dispatchAckMessageId,
    dispatchResultMessageId: task?.dispatchResultMessageId,
    dispatchTargetNodeId: task?.dispatchTargetNodeId,
    dispatchProtocolVersion: task?.dispatchProtocolVersion,
    dispatchStatusSummary: task?.dispatchStatusSummary,
    dispatchAuthSummary: task?.dispatchAuthSummary,
    dispatchTransportStatus: task?.dispatchTransportStatus,
    dispatchRetryCount: task?.dispatchRetryCount,
    dispatchLastAttemptAt: task?.dispatchLastAttemptAt,
    dispatchTimeoutMs: task?.dispatchTimeoutMs,
    failureReason: task?.failureReason,
    retryCount: task?.dispatchRetryCount,
    status,
    queueStateSummary: task ? summarizeTaskEnvelope(task) : undefined,
  };
}

function isTerminalTaskStatus(status: TaskEnvelope["status"] | null | undefined): boolean {
  return status === "completed" || status === "failed" || status === "blocked" || status === "rejected";
}

function summarizeTerminalTask(task: TaskEnvelope, session: AutonomousSession | null): QueueExecutionSummary {
  return summarizeQueueExecution(
    task,
    session,
    task.status === "completed"
      ? "completed"
      : task.status === "failed"
        ? "failed"
        : task.status === "rejected"
          ? "rejected"
          : "blocked",
  );
}

export async function claimNextRunnableTask(
  context: QueueExecutionContext & { taskId?: string },
  dependencies?: Partial<QueueOrchestratorDependencies>,
): Promise<ClaimedQueuedTask | null> {
  const resolved = resolveDependencies(dependencies);
  const cwd = context.cwd ?? process.cwd();
  const runtimeNode = registerExecutionNode(createRuntimeExecutionNodeDescriptor({
    runtimeMode: context.runtimeMode,
    cwd,
    allowedRoots: context.allowedRoots,
  }));

  const candidates = context.taskId
    ? [await resolved.getTask(context.taskId)].filter((task): task is TaskEnvelope => Boolean(task && (task.status === "pending" || task.status === "queued" || task.status === "retrying") && task.action.scope === "safe"))
    : await resolved.getRunnableTasks();

  for (const candidate of candidates) {
    const selectedNode = selectExecutionNodeForTask(candidate, {
      runtimeMode: context.runtimeMode,
      preferredNodeId: candidate.preferredNodeId || runtimeNode.id,
      cwd,
    });
    if (!selectedNode) {
      await resolved.updateTaskStatus(candidate.taskId, "rejected", {
        statusReason: "No active non-busy capable execution node was available.",
        failureReason: "No active non-busy capable execution node was available.",
      });
      continue;
    }

    const claimToken = createClaimToken();
    const claimed = await resolved.claimTask(
      candidate.taskId,
      claimToken,
      selectedNode.node.mode,
      selectedNode.node.id,
      selectedNode.reason,
    );
    if (claimed) {
      return {
        task: claimed,
        node: selectedNode.node,
      };
    }
  }

  return null;
}

export async function finalizeQueuedTask(
  taskId: string,
  status: "completed" | "failed" | "blocked",
  extra?: Parameters<typeof finalizeTask>[2],
  dependencies?: Partial<QueueOrchestratorDependencies>,
): Promise<TaskEnvelope | null> {
  const resolved = resolveDependencies(dependencies);
  return resolved.finalizeTask(taskId, status, extra);
}

export async function executeQueuedTask(
  claimed: ClaimedQueuedTask,
  context: QueueExecutionContext,
  dependencies?: Partial<QueueOrchestratorDependencies>,
): Promise<QueueExecutionSummary> {
  const resolved = resolveDependencies(dependencies);
  const cwd = context.cwd ?? claimed.node.cwd ?? process.cwd();
  const runtimeNode = registerExecutionNode(createRuntimeExecutionNodeDescriptor({
    runtimeMode: context.runtimeMode,
    cwd,
    allowedRoots: context.allowedRoots,
  }));
  const transport = context.dispatchTransport ?? createLocalControlledDispatchTransport();
  const maxDispatchRetries = normalizeDispatchRetryLimit(context.maxDispatchRetries);
  const dispatchRetryDelayMs = normalizeDispatchDelay(context.dispatchRetryDelayMs);
  const dispatchTimeoutMs = normalizeDispatchTimeout(context.dispatchTimeoutMs);
  const excludedNodeIds = new Set<string>();
  let retryCount = Math.max(0, claimed.task.dispatchRetryCount ?? 0);
  let latestTask: TaskEnvelope = claimed.task;
  let latestSession: AutonomousSession | null = null;

  for (let attemptIndex = 0; attemptIndex <= maxDispatchRetries; attemptIndex += 1) {
    const currentTask = await resolved.getTask(claimed.task.taskId) ?? latestTask;

    if (isTerminalTaskStatus(currentTask.status)) {
      return summarizeTerminalTask(currentTask, latestSession);
    }

    const selectedNode = selectExecutionNodeForTask(currentTask, {
      runtimeMode: context.runtimeMode,
      preferredNodeId: currentTask.selectedNodeId ?? currentTask.preferredNodeId ?? claimed.node.id,
      cwd,
      excludedNodeIds,
    });

    if (!selectedNode) {
      const rejectedTask = await resolved.updateTaskStatus(currentTask.taskId, "rejected", {
        assignedNodeId: currentTask.assignedNodeId,
        selectedNodeId: currentTask.selectedNodeId,
        selectedNodeReason: currentTask.selectedNodeReason,
        statusReason: "No active non-busy capable execution node was available.",
        failureReason: "No active non-busy capable execution node was available.",
        dispatchRetryCount: retryCount,
        dispatchTimeoutMs,
      });
      return summarizeQueueExecution(rejectedTask ?? currentTask, latestSession, "rejected");
    }

    const authToken = createDispatchAuthToken({
      sourceNodeId: runtimeNode.id,
      targetNodeId: selectedNode.node.id,
      taskId: currentTask.taskId,
      sessionId: currentTask.sessionId,
    });
    const dispatchAuthSummary = summarizeDispatchAuthContext({
      sourceNodeId: runtimeNode.id,
      targetNodeId: selectedNode.node.id,
      valid: true,
      expiresAt: authToken.expiresAt,
    });
    const request = createDispatchEnvelope({
      messageType: "task-dispatch-request",
      sourceNodeId: runtimeNode.id,
      targetNodeId: selectedNode.node.id,
      taskId: currentTask.taskId,
      sessionId: currentTask.sessionId,
      payload: createTaskDispatchRequest({
        action: currentTask.action,
        requestedCapabilities: currentTask.requestedCapabilities,
        assignedNodeId: selectedNode.node.id,
        authToken,
        approvalState: {
          requiresApproval: currentTask.action.requiresApproval,
          approved: true,
        },
        queueStateSummary: summarizeTaskEnvelope(currentTask),
        dispatchStatusSummary: "Dispatch requested through the controlled transport boundary.",
        dispatchAuthSummary,
        remoteDispatchPlanned: true,
      }),
    });
    const requestSummary = summarizeDispatchPayload(request.messageType, request.payload, request.protocolVersion);
    retryCount = attemptIndex + 1;
    latestTask = await resolved.updateTaskStatus(currentTask.taskId, "awaiting-ack", {
      assignedNodeId: selectedNode.node.id,
      selectedNodeId: selectedNode.node.id,
      selectedNodeReason: selectedNode.reason,
      statusReason: `Dispatch attempt ${retryCount} is awaiting acknowledgment from ${selectedNode.node.id}.`,
      failureReason: undefined,
      dispatchMessageId: request.messageId,
      dispatchTargetNodeId: selectedNode.node.id,
      dispatchProtocolVersion: request.protocolVersion,
      dispatchStatusSummary: requestSummary,
      dispatchAuthSummary,
      dispatchTransportStatus: "pending",
      dispatchRetryCount: retryCount,
      dispatchLastAttemptAt: request.createdAt,
      dispatchTimeoutMs,
      remoteDispatchPlanned: true,
    }) ?? currentTask;

    try {
      const transportResult = await sendDispatchRequestWithTimeout({
        transport,
        timeoutMs: dispatchTimeoutMs,
        request,
        context: {
          runtimeMode: selectedNode.node.mode === "local-node" ? "local" : selectedNode.node.mode,
          cwd,
          allowedRoots: context.allowedRoots ?? selectedNode.node.allowedRoots,
          maxSteps: context.maxSteps,
        },
        dependencies: {
          getTask: resolved.getTask,
          updateTaskStatus: resolved.updateTaskStatus,
          updateTaskDispatchMetadata: resolved.updateTaskDispatchMetadata,
          executeClaimedTask: (receivedClaimed, receiveContext) =>
            executeClaimedTaskWithSharedRunner(receivedClaimed, receiveContext, resolved),
        },
      });
      latestTask = transportResult.task ?? await resolved.getTask(currentTask.taskId) ?? latestTask;
      latestSession = transportResult.session ?? latestSession;

      if (isTerminalTaskStatus(latestTask.status)) {
        return summarizeTerminalTask(latestTask, latestSession);
      }

      if (transportResult.status === "rejected") {
        const reason = transportResult.reason || latestTask.failureReason || "The controlled receiver rejected the dispatch request.";
        const retryable = shouldRetryDispatchFailure(reason, "rejected") && attemptIndex < maxDispatchRetries;
        if (retryable) {
          const persistedLatestTask = await resolved.getTask(currentTask.taskId);
          if (persistedLatestTask && isTerminalTaskStatus(persistedLatestTask.status)) {
            return summarizeTerminalTask(persistedLatestTask, latestSession);
          }
          excludedNodeIds.add(selectedNode.node.id);
          latestTask = await resolved.updateTaskStatus(currentTask.taskId, "retrying", {
            assignedNodeId: selectedNode.node.id,
            selectedNodeId: selectedNode.node.id,
            selectedNodeReason: selectedNode.reason,
            statusReason: `Retrying after rejected dispatch attempt ${retryCount}.`,
            failureReason: reason,
            dispatchMessageId: latestTask.dispatchMessageId ?? request.messageId,
            dispatchAckMessageId: latestTask.dispatchAckMessageId,
            dispatchTargetNodeId: latestTask.dispatchTargetNodeId ?? selectedNode.node.id,
            dispatchProtocolVersion: latestTask.dispatchProtocolVersion ?? request.protocolVersion,
            dispatchStatusSummary: latestTask.dispatchStatusSummary,
            dispatchAuthSummary: latestTask.dispatchAuthSummary ?? dispatchAuthSummary,
            dispatchTransportStatus: "rejected",
            dispatchRetryCount: retryCount,
            dispatchLastAttemptAt: latestTask.dispatchLastAttemptAt ?? request.createdAt,
            dispatchTimeoutMs,
            remoteDispatchPlanned: true,
          }) ?? latestTask;
          await waitForDispatchRetryDelay(dispatchRetryDelayMs);
          continue;
        }

        const persistedLatestTask = await resolved.getTask(currentTask.taskId);
        if (persistedLatestTask && isTerminalTaskStatus(persistedLatestTask.status)) {
          return summarizeTerminalTask(persistedLatestTask, latestSession);
        }
        latestTask = await resolved.updateTaskStatus(currentTask.taskId, "rejected", {
          assignedNodeId: selectedNode.node.id,
          selectedNodeId: selectedNode.node.id,
          selectedNodeReason: selectedNode.reason,
          statusReason: reason,
          failureReason: reason,
          dispatchMessageId: latestTask.dispatchMessageId ?? request.messageId,
          dispatchAckMessageId: latestTask.dispatchAckMessageId,
          dispatchTargetNodeId: latestTask.dispatchTargetNodeId ?? selectedNode.node.id,
          dispatchProtocolVersion: latestTask.dispatchProtocolVersion ?? request.protocolVersion,
          dispatchStatusSummary: latestTask.dispatchStatusSummary,
          dispatchAuthSummary: latestTask.dispatchAuthSummary ?? dispatchAuthSummary,
          dispatchTransportStatus: "rejected",
          dispatchRetryCount: retryCount,
          dispatchLastAttemptAt: latestTask.dispatchLastAttemptAt ?? request.createdAt,
          dispatchTimeoutMs,
          remoteDispatchPlanned: true,
        }) ?? latestTask;
        return summarizeQueueExecution(latestTask, latestSession, "rejected");
      }

      if (transportResult.status === "failed") {
        const reason = transportResult.reason || latestTask.failureReason || "The controlled dispatch transport failed.";
        const retryable = shouldRetryDispatchFailure(reason, "failed") && attemptIndex < maxDispatchRetries;
        if (retryable) {
          const persistedLatestTask = await resolved.getTask(currentTask.taskId);
          if (persistedLatestTask && isTerminalTaskStatus(persistedLatestTask.status)) {
            return summarizeTerminalTask(persistedLatestTask, latestSession);
          }
          latestTask = await resolved.updateTaskStatus(currentTask.taskId, "retrying", {
            assignedNodeId: selectedNode.node.id,
            selectedNodeId: selectedNode.node.id,
            selectedNodeReason: selectedNode.reason,
            statusReason: `Retrying after failed dispatch attempt ${retryCount}.`,
            failureReason: reason,
            dispatchMessageId: latestTask.dispatchMessageId ?? request.messageId,
            dispatchAckMessageId: latestTask.dispatchAckMessageId,
            dispatchResultMessageId: latestTask.dispatchResultMessageId,
            dispatchTargetNodeId: latestTask.dispatchTargetNodeId ?? selectedNode.node.id,
            dispatchProtocolVersion: latestTask.dispatchProtocolVersion ?? request.protocolVersion,
            dispatchStatusSummary: latestTask.dispatchStatusSummary,
            dispatchAuthSummary: latestTask.dispatchAuthSummary ?? dispatchAuthSummary,
            dispatchTransportStatus: "failed",
            dispatchRetryCount: retryCount,
            dispatchLastAttemptAt: latestTask.dispatchLastAttemptAt ?? request.createdAt,
            dispatchTimeoutMs,
            remoteDispatchPlanned: true,
          }) ?? latestTask;
          await waitForDispatchRetryDelay(dispatchRetryDelayMs);
          continue;
        }

        const persistedLatestTask = await resolved.getTask(currentTask.taskId);
        if (persistedLatestTask && isTerminalTaskStatus(persistedLatestTask.status)) {
          return summarizeTerminalTask(persistedLatestTask, latestSession);
        }
        latestTask = await resolved.updateTaskStatus(currentTask.taskId, "failed", {
          assignedNodeId: selectedNode.node.id,
          selectedNodeId: selectedNode.node.id,
          selectedNodeReason: selectedNode.reason,
          statusReason: reason,
          failureReason: reason,
          dispatchMessageId: latestTask.dispatchMessageId ?? request.messageId,
          dispatchAckMessageId: latestTask.dispatchAckMessageId,
          dispatchResultMessageId: latestTask.dispatchResultMessageId,
          dispatchTargetNodeId: latestTask.dispatchTargetNodeId ?? selectedNode.node.id,
          dispatchProtocolVersion: latestTask.dispatchProtocolVersion ?? request.protocolVersion,
          dispatchStatusSummary: latestTask.dispatchStatusSummary,
          dispatchAuthSummary: latestTask.dispatchAuthSummary ?? dispatchAuthSummary,
          dispatchTransportStatus: "failed",
          dispatchRetryCount: retryCount,
          dispatchLastAttemptAt: latestTask.dispatchLastAttemptAt ?? request.createdAt,
          dispatchTimeoutMs,
          remoteDispatchPlanned: true,
        }) ?? latestTask;
        return summarizeQueueExecution(latestTask, latestSession, "failed");
      }

      return summarizeQueueExecution(latestTask, latestSession, latestTask.status === "completed" ? "completed" : latestTask.status === "failed" ? "failed" : latestTask.status === "rejected" ? "rejected" : "claimed");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Controlled queued dispatch failed unexpectedly.";
      const timedOut = error instanceof DispatchTransportTimeoutError;
      const retryable = shouldRetryDispatchFailure(reason, timedOut ? "timeout" : "failed") && attemptIndex < maxDispatchRetries;
      if (retryable) {
        const persistedLatestTask = await resolved.getTask(currentTask.taskId);
        if (persistedLatestTask && isTerminalTaskStatus(persistedLatestTask.status)) {
          return summarizeTerminalTask(persistedLatestTask, latestSession);
        }
        latestTask = await resolved.updateTaskStatus(currentTask.taskId, "retrying", {
          assignedNodeId: selectedNode.node.id,
          selectedNodeId: selectedNode.node.id,
          selectedNodeReason: selectedNode.reason,
          statusReason: `Retrying after ${timedOut ? "timeout" : "failed"} dispatch attempt ${retryCount}.`,
          failureReason: reason,
          dispatchMessageId: request.messageId,
          dispatchTargetNodeId: selectedNode.node.id,
          dispatchProtocolVersion: request.protocolVersion,
          dispatchStatusSummary: requestSummary,
          dispatchAuthSummary,
          dispatchTransportStatus: "failed",
          dispatchRetryCount: retryCount,
          dispatchLastAttemptAt: request.createdAt,
          dispatchTimeoutMs,
          remoteDispatchPlanned: true,
        }) ?? latestTask;
        await waitForDispatchRetryDelay(dispatchRetryDelayMs);
        continue;
      }

      const persistedLatestTask = await resolved.getTask(currentTask.taskId);
      if (persistedLatestTask && isTerminalTaskStatus(persistedLatestTask.status)) {
        return summarizeTerminalTask(persistedLatestTask, latestSession);
      }
      latestTask = await resolved.updateTaskStatus(currentTask.taskId, "failed", {
        assignedNodeId: selectedNode.node.id,
        selectedNodeId: selectedNode.node.id,
        selectedNodeReason: selectedNode.reason,
        statusReason: reason,
        failureReason: reason,
        dispatchMessageId: request.messageId,
        dispatchTargetNodeId: selectedNode.node.id,
        dispatchProtocolVersion: request.protocolVersion,
        dispatchStatusSummary: requestSummary,
        dispatchAuthSummary,
        dispatchTransportStatus: "failed",
        dispatchRetryCount: retryCount,
        dispatchLastAttemptAt: request.createdAt,
        dispatchTimeoutMs,
        remoteDispatchPlanned: true,
      }) ?? latestTask;
      return summarizeQueueExecution(latestTask, latestSession, "failed");
    }
  }

  return summarizeQueueExecution(latestTask, latestSession, latestTask.status === "rejected" ? "rejected" : latestTask.status === "failed" ? "failed" : latestTask.status === "completed" ? "completed" : "claimed");
}

export async function executeClaimedTaskWithSharedRunner(
  claimed: ClaimedQueuedTask,
  context: QueueExecutionContext,
  dependencies?: Partial<QueueOrchestratorDependencies>,
): Promise<QueueExecutionSummary> {
  const resolved = resolveDependencies(dependencies);
  const cwd = context.cwd ?? claimed.node.cwd ?? process.cwd();
  const allowedRoots = context.allowedRoots ?? claimed.node.allowedRoots;
  const seededSession = buildQueuedSession(claimed.task, claimed.node, context.maxSteps);
  await resolved.saveAutonomousSession(seededSession);

  try {
    const repoRoot = await resolveRepoRoot(cwd);
    const session = await resolved.runAutonomousSession({
      goal: seededSession.goal,
      maxSteps: seededSession.maxSteps,
      approved: true,
      existingSession: seededSession,
      queuedTask: claimed.task,
      executionContext: {
        runtimeMode: claimed.node.mode === "local-node" ? "local" : claimed.node.mode,
        cwd,
        repoRoot,
        allowedRoots,
        allowedDirectories: allowedRoots,
      },
    });
    const finalizedTask = await resolved.getTask(claimed.task.taskId);
    const effectiveTask = finalizedTask ?? claimed.task;
    const effectiveStatus = effectiveTask.status === "completed" || effectiveTask.status === "failed" || effectiveTask.status === "blocked"
      ? effectiveTask.status
      : session.taskStatus === "completed" || session.taskStatus === "failed" || session.taskStatus === "blocked"
        ? session.taskStatus
        : session.status === "failed"
          ? "failed"
          : session.status === "blocked"
            ? "blocked"
            : session.status === "completed"
              ? "completed"
              : "claimed";
    const persistedTask = effectiveStatus === "claimed"
      ? finalizedTask
      : await resolved.updateTaskStatus(effectiveTask.taskId, effectiveStatus, {
          assignedNodeId: effectiveTask.assignedNodeId,
          dispatchMessageId: effectiveTask.dispatchMessageId,
          dispatchAckMessageId: effectiveTask.dispatchAckMessageId,
          dispatchResultMessageId: effectiveTask.dispatchResultMessageId,
          dispatchTargetNodeId: effectiveTask.dispatchTargetNodeId,
          dispatchProtocolVersion: effectiveTask.dispatchProtocolVersion,
          dispatchStatusSummary: effectiveTask.dispatchStatusSummary,
          dispatchAuthSummary: effectiveTask.dispatchAuthSummary,
          dispatchTransportStatus: effectiveTask.dispatchTransportStatus,
          remoteDispatchPlanned: claimed.task.remoteDispatchPlanned ?? effectiveTask.remoteDispatchPlanned,
          dispatchReceivedAt: effectiveTask.dispatchReceivedAt,
          dispatchCompletedAt: effectiveTask.dispatchCompletedAt,
        });
    const summarizedTask = persistedTask ?? effectiveTask;

    return {
      task: persistedTask ?? finalizedTask,
      session,
      nodeId: claimed.node.id,
      runnerMode: summarizedTask.runnerMode,
      claimToken: summarizedTask.claimToken,
      dispatchMessageId: summarizedTask.dispatchMessageId,
      dispatchAckMessageId: summarizedTask.dispatchAckMessageId,
      dispatchResultMessageId: summarizedTask.dispatchResultMessageId,
      dispatchTargetNodeId: summarizedTask.dispatchTargetNodeId,
      dispatchProtocolVersion: summarizedTask.dispatchProtocolVersion,
      dispatchStatusSummary: summarizedTask.dispatchStatusSummary,
      dispatchAuthSummary: summarizedTask.dispatchAuthSummary,
      dispatchTransportStatus: summarizedTask.dispatchTransportStatus,
      status: effectiveStatus,
      queueStateSummary: summarizeTaskEnvelope(summarizedTask),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Queued task execution failed unexpectedly.";
    const finalizedTask = await resolved.finalizeTask(claimed.task.taskId, "failed", {
      assignedNodeId: claimed.task.assignedNodeId,
      statusReason: reason,
    });

    return {
      task: finalizedTask,
      session: seededSession,
      nodeId: claimed.node.id,
      runnerMode: finalizedTask?.runnerMode ?? claimed.task.runnerMode,
      claimToken: finalizedTask?.claimToken ?? claimed.task.claimToken,
      dispatchMessageId: finalizedTask?.dispatchMessageId ?? claimed.task.dispatchMessageId,
      dispatchAckMessageId: finalizedTask?.dispatchAckMessageId ?? claimed.task.dispatchAckMessageId,
      dispatchResultMessageId: finalizedTask?.dispatchResultMessageId ?? claimed.task.dispatchResultMessageId,
      dispatchTargetNodeId: finalizedTask?.dispatchTargetNodeId ?? claimed.task.dispatchTargetNodeId,
      dispatchProtocolVersion: finalizedTask?.dispatchProtocolVersion ?? claimed.task.dispatchProtocolVersion,
      dispatchStatusSummary: finalizedTask?.dispatchStatusSummary ?? claimed.task.dispatchStatusSummary,
      dispatchAuthSummary: finalizedTask?.dispatchAuthSummary ?? claimed.task.dispatchAuthSummary,
      dispatchTransportStatus: finalizedTask?.dispatchTransportStatus ?? claimed.task.dispatchTransportStatus,
      status: "failed",
      queueStateSummary: finalizedTask ? summarizeTaskEnvelope(finalizedTask) : undefined,
    };
  }
}

export async function runSingleQueuedTask(
  context: QueueExecutionContext & { taskId?: string },
  dependencies?: Partial<QueueOrchestratorDependencies>,
): Promise<QueueExecutionSummary> {
  const claimed = await claimNextRunnableTask(context, dependencies);
  if (!claimed) {
    return {
      task: null,
      session: null,
      status: "no-runnable-task",
    };
  }

  return executeQueuedTask(claimed, context, dependencies);
}