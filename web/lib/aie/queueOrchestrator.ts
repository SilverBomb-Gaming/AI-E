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
import {
  clearExecutionNodeActivity,
  listAvailableExecutionNodes,
  registerExecutionNode,
  updateExecutionNodeActivity,
} from "./executionNodeRegistry";
import { createDispatchAuthToken, summarizeDispatchAuthContext } from "./dispatchAuth";
import { createDispatchEnvelope, type DispatchProtocolVersion } from "./dispatchProtocol";
import { createDispatchAuthenticityBinding, createTaskDispatchRequest, summarizeDispatchPayload } from "./dispatchMessages";
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
  createTaskExecutionLease,
  deriveTaskRecoveryPlanningState,
  invalidateTaskExecutionLease,
  summarizeTaskEnvelope,
  type TaskContinuationReason,
  type TaskDispatchTransportStatus,
  type TaskExecutionLease,
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

function isLeaseRecoveryExpiryReason(reason: string | undefined): boolean {
  const normalizedReason = normalizeText(reason).toLowerCase();
  return normalizedReason.includes("stale")
    || normalizedReason.includes("offline")
    || normalizedReason.includes("inactive")
    || normalizedReason.includes("unavailable")
    || normalizedReason.includes("not registered");
}

function createActiveLeaseForTask(task: TaskEnvelope, nodeId: string, at: string, progressMarker: string): TaskExecutionLease {
  return createTaskExecutionLease({
    ownerNodeId: nodeId,
    previousLease: task.lease,
    at,
    continuationToken: task.continuationToken,
    checkpointReference: task.checkpointReference,
    progressMarker,
  });
}

function invalidateLeaseForRecovery(task: TaskEnvelope, reason: string | undefined, progressMarker: string, at?: string): TaskExecutionLease | undefined {
  return invalidateTaskExecutionLease(task.lease, {
    status: isLeaseRecoveryExpiryReason(reason) ? "expired" : "superseded",
    at,
    reason,
    progressMarker,
    continuationToken: task.continuationToken,
    checkpointReference: task.checkpointReference,
  });
}

function normalizeContinuationReason(reason: string | undefined): TaskContinuationReason | string | undefined {
  const normalizedReason = normalizeText(reason).toLowerCase();
  if (!normalizedReason) {
    return undefined;
  }

  if (normalizedReason.includes("stale")) {
    return "stale-node";
  }

  if (normalizedReason.includes("offline") || normalizedReason.includes("not registered") || normalizedReason.includes("unavailable")) {
    return "offline-node";
  }

  if (normalizedReason.includes("timeout") || normalizedReason.includes("timed out")) {
    return "timeout-recovery";
  }

  if (normalizedReason.includes("supersed")) {
    return "lease-supersession";
  }

  return "receiver-recovery";
}

function createPendingContinuationMetadata(task: TaskEnvelope, sourceNodeId: string | undefined, reason: string | undefined) {
  const recoveryPlanning = deriveTaskRecoveryPlanningState({
    ...task,
    failureReason: normalizeText(reason) || task.failureReason,
    statusReason: normalizeText(reason) || task.statusReason,
    recoveryPending: true,
    status: "retrying",
  });

  if (recoveryPlanning.strategy === "restart-safe-boundary") {
    return {
      continuationSourceNodeId: undefined,
      continuationTargetNodeId: undefined,
      continuationGeneration: 0,
      continuationReason: normalizeContinuationReason(reason) ?? task.continuationReason ?? "other",
      resumedFromCheckpointReference: undefined,
      resumedFromContinuationToken: undefined,
      continuationToken: undefined,
      checkpointReference: undefined,
    };
  }

  return {
    continuationSourceNodeId: normalizeText(sourceNodeId) || task.continuationSourceNodeId,
    continuationTargetNodeId: undefined,
    continuationGeneration: Math.max(1, task.continuationGeneration + 1),
    continuationReason: normalizeContinuationReason(reason) ?? task.continuationReason ?? "other",
    resumedFromCheckpointReference: task.checkpointReference ?? task.resumedFromCheckpointReference,
    resumedFromContinuationToken: task.continuationToken ?? task.resumedFromContinuationToken,
    continuationToken: task.continuationToken,
    checkpointReference: task.checkpointReference,
  };
}

function createActiveContinuationMetadata(task: TaskEnvelope, targetNodeId: string) {
  if (task.continuationGeneration <= 0) {
    return undefined;
  }

  return {
    continuationSourceNodeId: task.continuationSourceNodeId ?? task.lease?.ownerNodeId ?? task.assignedNodeId,
    continuationTargetNodeId: targetNodeId,
    continuationGeneration: Math.max(1, task.continuationGeneration),
    continuationReason: task.continuationReason ?? "lease-supersession",
    resumedFromCheckpointReference: task.resumedFromCheckpointReference ?? task.checkpointReference,
    resumedFromContinuationToken: task.resumedFromContinuationToken ?? task.continuationToken,
  };
}

function createDispatchContinuationPayload(task: TaskEnvelope, targetNodeId: string) {
  const continuationMetadata = createActiveContinuationMetadata(task, targetNodeId);
  if (!continuationMetadata) {
    return undefined;
  }

  const leaseId = task.lease?.leaseId ?? task.priorLeaseId ?? "unknown-lease";
  const leaseEpoch = task.lease?.epoch ?? 1;
  const continuationGeneration = continuationMetadata.continuationGeneration;

  return {
    isContinuation: true,
    priorLeaseId: task.priorLeaseId ?? task.lease?.leaseId,
    sourceNodeId: continuationMetadata.continuationSourceNodeId,
    targetNodeId: continuationMetadata.continuationTargetNodeId,
    generation: continuationMetadata.continuationGeneration,
    reason: continuationMetadata.continuationReason,
    resumedFromCheckpointReference: continuationMetadata.resumedFromCheckpointReference,
    resumedFromCheckpointBinding: createDispatchAuthenticityBinding({
      kind: "continuation-resume-checkpoint",
      taskId: task.taskId,
      leaseId,
      leaseEpoch,
      continuationGeneration,
      value: continuationMetadata.resumedFromCheckpointReference,
    }),
    resumedFromContinuationToken: continuationMetadata.resumedFromContinuationToken,
    resumedFromContinuationBinding: createDispatchAuthenticityBinding({
      kind: "continuation-resume-token",
      taskId: task.taskId,
      leaseId,
      leaseEpoch,
      continuationGeneration,
      value: continuationMetadata.resumedFromContinuationToken,
    }),
  };
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
    sessionId: task.sessionId,
    sessionMode: "repo-coding",
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
  const numericValue = Number(value ?? 1_000);
  if (!Number.isFinite(numericValue)) {
    return 1_000;
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

  if (
    normalizedReason.includes("busy")
    || normalizedReason.includes("inactive")
    || normalizedReason.includes("stale")
    || normalizedReason.includes("offline")
    || normalizedReason.includes("not registered")
    || normalizedReason.includes("unavailable")
    || normalizedReason.includes("trust boundary")
    || normalizedReason.includes("dispatch protocol")
  ) {
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
    includeBusy: true,
    minimumTrustState: "trusted",
    requiredProtocolVersion: "1",
  }).filter(
    (node) =>
      !context.excludedNodeIds?.has(node.id)
      && (!node.busy || node.activeTaskId === task.taskId),
  );

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
      updateExecutionNodeActivity(selectedNode.node.id, {
        taskId: claimed.taskId,
        sessionId: claimed.sessionId,
        busy: true,
      });
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
  const clearNodeActivity = async (nodeId: string, task: TaskEnvelope): Promise<void> => {
    clearExecutionNodeActivity(nodeId, {
      taskId: task.taskId,
      sessionId: task.sessionId,
    });
  };

  for (let attemptIndex = 0; attemptIndex <= maxDispatchRetries; attemptIndex += 1) {
    const currentTask = await resolved.getTask(claimed.task.taskId) ?? latestTask;

    if (isTerminalTaskStatus(currentTask.status)) {
      await clearNodeActivity(claimed.node.id, currentTask);
      return summarizeTerminalTask(currentTask, latestSession);
    }

    const selectedNode = selectExecutionNodeForTask(currentTask, {
      runtimeMode: context.runtimeMode,
      preferredNodeId: currentTask.selectedNodeId ?? currentTask.preferredNodeId ?? claimed.node.id,
      cwd,
      excludedNodeIds,
    });

    if (!selectedNode) {
      await clearNodeActivity(claimed.node.id, currentTask);
      if (currentTask.lease?.status === "active" || currentTask.recoveryPending) {
        const recoveryReason = "Recovery is pending until a healthy execution node becomes available.";
        latestTask = await resolved.updateTaskStatus(currentTask.taskId, "retrying", {
          assignedNodeId: currentTask.assignedNodeId,
          selectedNodeId: currentTask.selectedNodeId,
          selectedNodeReason: currentTask.selectedNodeReason,
          statusReason: recoveryReason,
          failureReason: "No active non-busy capable execution node was available.",
          recoveryPending: true,
          priorLeaseId: currentTask.lease?.leaseId ?? currentTask.priorLeaseId,
          lease: invalidateLeaseForRecovery(
            currentTask,
            "No active non-busy capable execution node was available.",
            currentTask.lastProgressMarker ?? "recovery-pending",
          ),
          lastProgressMarker: currentTask.lastProgressMarker ?? "recovery-pending",
          dispatchRetryCount: retryCount,
          dispatchTimeoutMs,
        }) ?? currentTask;
        return summarizeQueueExecution(latestTask, latestSession, "retrying");
      }

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

    const nextRetryCount = attemptIndex + 1;
    const progressMarker = `dispatch-attempt-${nextRetryCount}-awaiting-ack`;
    const activeLease = createActiveLeaseForTask(currentTask, selectedNode.node.id, new Date().toISOString(), progressMarker);
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
        lease: {
          leaseId: activeLease.leaseId,
          ownerNodeId: activeLease.ownerNodeId,
          epoch: activeLease.epoch,
          continuationToken: activeLease.continuationToken,
          continuationTokenBinding: createDispatchAuthenticityBinding({
            kind: "lease-continuation",
            taskId: currentTask.taskId,
            leaseId: activeLease.leaseId,
            leaseEpoch: activeLease.epoch,
            continuationGeneration: currentTask.continuationGeneration,
            value: activeLease.continuationToken,
          }),
          checkpointReference: activeLease.checkpointReference,
          checkpointReferenceBinding: createDispatchAuthenticityBinding({
            kind: "lease-checkpoint",
            taskId: currentTask.taskId,
            leaseId: activeLease.leaseId,
            leaseEpoch: activeLease.epoch,
            continuationGeneration: currentTask.continuationGeneration,
            value: activeLease.checkpointReference,
          }),
          resumability: currentTask.resumability,
        },
        continuation: createDispatchContinuationPayload(currentTask, selectedNode.node.id),
        authToken,
        approvalState: {
          requiresApproval: currentTask.action.requiresApproval,
          approved: true,
        },
        queueStateSummary: summarizeTaskEnvelope(currentTask),
        planningHintSummary: (() => {
          const recoveryPlanning = deriveTaskRecoveryPlanningState(currentTask);
          return recoveryPlanning.strategy === "none"
            ? undefined
            : `Recovery plan: ${recoveryPlanning.strategy} | reason=${recoveryPlanning.reasonCategory} | safe-stop=${recoveryPlanning.safeStopPoint ?? "step-" + currentTask.stepIndex}`;
        })(),
        dispatchStatusSummary: "Dispatch requested through the controlled transport boundary.",
        dispatchAuthSummary,
        remoteDispatchPlanned: true,
      }),
    });
    const requestSummary = summarizeDispatchPayload(request.messageType, request.payload, request.protocolVersion);
    retryCount = nextRetryCount;
    const continuationMetadata = createActiveContinuationMetadata(currentTask, selectedNode.node.id);
    updateExecutionNodeActivity(selectedNode.node.id, {
      taskId: currentTask.taskId,
      sessionId: currentTask.sessionId,
      busy: true,
    });
    latestTask = await resolved.updateTaskStatus(currentTask.taskId, "awaiting-ack", {
      assignedNodeId: selectedNode.node.id,
      selectedNodeId: selectedNode.node.id,
      selectedNodeReason: selectedNode.reason,
      runnerMode: selectedNode.node.mode,
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
      resumability: currentTask.resumability,
      continuationSourceNodeId: continuationMetadata?.continuationSourceNodeId,
      continuationTargetNodeId: continuationMetadata?.continuationTargetNodeId,
      continuationGeneration: continuationMetadata?.continuationGeneration,
      continuationReason: continuationMetadata?.continuationReason,
      resumedFromCheckpointReference: continuationMetadata?.resumedFromCheckpointReference,
      resumedFromContinuationToken: continuationMetadata?.resumedFromContinuationToken,
      continuationToken: currentTask.continuationToken,
      checkpointReference: currentTask.checkpointReference,
      resumeAttemptCount: currentTask.resumeAttemptCount,
      lastProgressMarker: progressMarker,
      recoveryPending: false,
      priorLeaseId: currentTask.lease?.leaseId ?? currentTask.priorLeaseId,
      lease: {
        ...activeLease,
        startedAt: request.createdAt,
        lastProgressAt: request.createdAt,
      },
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
      latestTask = await resolved.getTask(currentTask.taskId) ?? transportResult.task ?? latestTask;
      latestSession = transportResult.session ?? latestSession;

      if (transportResult.status === "rejected") {
        const reason = transportResult.reason || latestTask.failureReason || "The controlled receiver rejected the dispatch request.";
        const retryable = shouldRetryDispatchFailure(reason, "rejected") && attemptIndex < maxDispatchRetries;
        if (retryable) {
          await clearNodeActivity(selectedNode.node.id, currentTask);
          const persistedLatestTask = await resolved.getTask(currentTask.taskId);
          if (persistedLatestTask && isTerminalTaskStatus(persistedLatestTask.status) && persistedLatestTask.status !== "rejected") {
            await clearNodeActivity(selectedNode.node.id, persistedLatestTask);
            return summarizeTerminalTask(persistedLatestTask, latestSession);
          }
          excludedNodeIds.add(selectedNode.node.id);
          const pendingContinuation = createPendingContinuationMetadata(latestTask, latestTask.lease?.ownerNodeId ?? selectedNode.node.id, reason);
          const recoveryProgressMarker = pendingContinuation.continuationGeneration === 0
            ? currentTask.lastProgressMarker ?? latestTask.lastProgressMarker ?? `recovery-pending-attempt-${retryCount}`
            : `recovery-pending-attempt-${retryCount}`;
          latestTask = await resolved.updateTaskStatus(currentTask.taskId, "retrying", {
            assignedNodeId: selectedNode.node.id,
            selectedNodeId: selectedNode.node.id,
            selectedNodeReason: selectedNode.reason,
            runnerMode: selectedNode.node.mode,
            statusReason: `Retrying after rejected dispatch attempt ${retryCount}.`,
            failureReason: reason,
            resumability: latestTask.resumability,
            ...pendingContinuation,
            continuationToken: pendingContinuation.continuationToken,
            checkpointReference: pendingContinuation.checkpointReference,
            resumeAttemptCount: latestTask.resumeAttemptCount + 1,
            lastProgressMarker: recoveryProgressMarker,
            recoveryPending: true,
            priorLeaseId: latestTask.lease?.leaseId ?? latestTask.priorLeaseId,
            lease: invalidateLeaseForRecovery(latestTask, reason, recoveryProgressMarker, request.createdAt),
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
          await clearNodeActivity(selectedNode.node.id, persistedLatestTask);
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
        await clearNodeActivity(selectedNode.node.id, latestTask);
        return summarizeQueueExecution(latestTask, latestSession, "rejected");
      }

      if (transportResult.status === "failed") {
        const reason = transportResult.reason || latestTask.failureReason || "The controlled dispatch transport failed.";
        const retryable = shouldRetryDispatchFailure(reason, "failed") && attemptIndex < maxDispatchRetries;
        if (retryable) {
          await clearNodeActivity(selectedNode.node.id, currentTask);
          const persistedLatestTask = await resolved.getTask(currentTask.taskId);
          if (persistedLatestTask && isTerminalTaskStatus(persistedLatestTask.status) && persistedLatestTask.status !== "failed") {
            await clearNodeActivity(selectedNode.node.id, persistedLatestTask);
            return summarizeTerminalTask(persistedLatestTask, latestSession);
          }
          excludedNodeIds.add(selectedNode.node.id);
          const pendingContinuation = createPendingContinuationMetadata(latestTask, latestTask.lease?.ownerNodeId ?? selectedNode.node.id, reason);
          const recoveryProgressMarker = pendingContinuation.continuationGeneration === 0
            ? currentTask.lastProgressMarker ?? latestTask.lastProgressMarker ?? `recovery-pending-attempt-${retryCount}`
            : `recovery-pending-attempt-${retryCount}`;
          latestTask = await resolved.updateTaskStatus(currentTask.taskId, "retrying", {
            assignedNodeId: selectedNode.node.id,
            selectedNodeId: selectedNode.node.id,
            selectedNodeReason: selectedNode.reason,
            runnerMode: selectedNode.node.mode,
            statusReason: `Retrying after failed dispatch attempt ${retryCount}.`,
            failureReason: reason,
            resumability: latestTask.resumability,
            ...pendingContinuation,
            continuationToken: pendingContinuation.continuationToken,
            checkpointReference: pendingContinuation.checkpointReference,
            resumeAttemptCount: latestTask.resumeAttemptCount + 1,
            lastProgressMarker: recoveryProgressMarker,
            recoveryPending: true,
            priorLeaseId: latestTask.lease?.leaseId ?? latestTask.priorLeaseId,
            lease: invalidateLeaseForRecovery(latestTask, reason, recoveryProgressMarker, request.createdAt),
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
          await clearNodeActivity(selectedNode.node.id, persistedLatestTask);
          return summarizeTerminalTask(persistedLatestTask, latestSession);
        }
        latestTask = await resolved.updateTaskStatus(currentTask.taskId, "failed", {
          assignedNodeId: selectedNode.node.id,
          selectedNodeId: selectedNode.node.id,
          selectedNodeReason: selectedNode.reason,
          runnerMode: selectedNode.node.mode,
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
        await clearNodeActivity(selectedNode.node.id, latestTask);
        return summarizeQueueExecution(latestTask, latestSession, "failed");
      }

      if (isTerminalTaskStatus(latestTask.status)) {
        await clearNodeActivity(selectedNode.node.id, latestTask);
        return summarizeTerminalTask(latestTask, latestSession);
      }

      await clearNodeActivity(selectedNode.node.id, latestTask);
      return summarizeQueueExecution(latestTask, latestSession, latestTask.status === "completed" ? "completed" : latestTask.status === "failed" ? "failed" : latestTask.status === "rejected" ? "rejected" : "claimed");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Controlled queued dispatch failed unexpectedly.";
      const timedOut = error instanceof DispatchTransportTimeoutError;
      const retryable = shouldRetryDispatchFailure(reason, timedOut ? "timeout" : "failed") && attemptIndex < maxDispatchRetries;
      if (retryable) {
        await clearNodeActivity(selectedNode.node.id, currentTask);
        const persistedLatestTask = await resolved.getTask(currentTask.taskId);
        if (persistedLatestTask && isTerminalTaskStatus(persistedLatestTask.status)) {
          await clearNodeActivity(selectedNode.node.id, persistedLatestTask);
          return summarizeTerminalTask(persistedLatestTask, latestSession);
        }
        excludedNodeIds.add(selectedNode.node.id);
        const pendingContinuation = createPendingContinuationMetadata(latestTask, latestTask.lease?.ownerNodeId ?? selectedNode.node.id, reason);
        const recoveryProgressMarker = pendingContinuation.continuationGeneration === 0
          ? currentTask.lastProgressMarker ?? latestTask.lastProgressMarker ?? `recovery-pending-attempt-${retryCount}`
          : `recovery-pending-attempt-${retryCount}`;
        latestTask = await resolved.updateTaskStatus(currentTask.taskId, "retrying", {
          assignedNodeId: selectedNode.node.id,
          selectedNodeId: selectedNode.node.id,
          selectedNodeReason: selectedNode.reason,
          runnerMode: selectedNode.node.mode,
          statusReason: `Retrying after ${timedOut ? "timeout" : "failed"} dispatch attempt ${retryCount}.`,
          failureReason: reason,
          resumability: latestTask.resumability,
          ...pendingContinuation,
          continuationToken: pendingContinuation.continuationToken,
          checkpointReference: pendingContinuation.checkpointReference,
          resumeAttemptCount: latestTask.resumeAttemptCount + 1,
          lastProgressMarker: recoveryProgressMarker,
          recoveryPending: true,
          priorLeaseId: latestTask.lease?.leaseId ?? latestTask.priorLeaseId,
          lease: invalidateLeaseForRecovery(latestTask, reason, recoveryProgressMarker, request.createdAt),
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
        await clearNodeActivity(selectedNode.node.id, persistedLatestTask);
        return summarizeTerminalTask(persistedLatestTask, latestSession);
      }
      latestTask = await resolved.updateTaskStatus(currentTask.taskId, "failed", {
        assignedNodeId: selectedNode.node.id,
        selectedNodeId: selectedNode.node.id,
        selectedNodeReason: selectedNode.reason,
        runnerMode: selectedNode.node.mode,
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
      await clearNodeActivity(selectedNode.node.id, latestTask);
      return summarizeQueueExecution(latestTask, latestSession, "failed");
    }
  }

  await clearNodeActivity(claimed.node.id, latestTask);
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
    updateExecutionNodeActivity(claimed.node.id, {
      taskId: claimed.task.taskId,
      sessionId: claimed.task.sessionId,
      busy: true,
    });
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
  } finally {
    clearExecutionNodeActivity(claimed.node.id, {
      taskId: claimed.task.taskId,
      sessionId: claimed.task.sessionId,
    });
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