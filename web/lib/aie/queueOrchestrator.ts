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
import { chooseExecutionNodeForAction, registerExecutionNode } from "./executionNodeRegistry";
import { createDispatchAuthToken, summarizeDispatchAuthContext } from "./dispatchAuth";
import { createDispatchEnvelope, type DispatchProtocolVersion } from "./dispatchProtocol";
import { createTaskDispatchRequest, summarizeDispatchPayload } from "./dispatchMessages";
import {
  createLocalControlledDispatchTransport,
  type DispatchTransport,
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
};

export type ClaimedQueuedTask = {
  task: TaskEnvelope;
  node: ExecutionNodeDescriptor;
};

export type QueueExecutionSummary = {
  task: TaskEnvelope | null;
  session: AutonomousSession | null;
  nodeId?: string;
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
  status: "claimed" | "completed" | "failed" | "blocked" | "no-runnable-task";
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
    remoteDispatchPlanned: task.remoteDispatchPlanned,
  };
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
    ? [await resolved.getTask(context.taskId)].filter((task): task is TaskEnvelope => Boolean(task && task.status === "pending" && task.action.scope === "safe"))
    : await resolved.getRunnableTasks();

  for (const candidate of candidates) {
    const selectedNode = chooseExecutionNodeForAction(candidate.action, {
      runtimeMode: context.runtimeMode,
      preferredNodeId: candidate.preferredNodeId || runtimeNode.id,
      cwd,
    });
    if (!selectedNode) {
      continue;
    }

    const claimToken = createClaimToken();
    const claimed = await resolved.claimTask(
      candidate.taskId,
      claimToken,
      selectedNode.mode,
      selectedNode.id,
      "Claimed for controlled queue execution through the shared runner.",
    );
    if (claimed) {
      return {
        task: claimed,
        node: selectedNode,
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
  const authToken = createDispatchAuthToken({
    sourceNodeId: runtimeNode.id,
    targetNodeId: claimed.node.id,
    taskId: claimed.task.taskId,
    sessionId: claimed.task.sessionId,
  });
  const dispatchAuthSummary = summarizeDispatchAuthContext({
    sourceNodeId: runtimeNode.id,
    targetNodeId: claimed.node.id,
    valid: true,
    expiresAt: authToken.expiresAt,
  });
  const request = createDispatchEnvelope({
    messageType: "task-dispatch-request",
    sourceNodeId: runtimeNode.id,
    targetNodeId: claimed.node.id,
    taskId: claimed.task.taskId,
    sessionId: claimed.task.sessionId,
    payload: createTaskDispatchRequest({
      action: claimed.task.action,
      requestedCapabilities: claimed.task.requestedCapabilities,
      assignedNodeId: claimed.node.id,
      authToken,
      approvalState: {
        requiresApproval: claimed.task.action.requiresApproval,
        approved: true,
      },
      queueStateSummary: summarizeTaskEnvelope(claimed.task),
      dispatchStatusSummary: "Dispatch requested through the controlled transport boundary.",
      dispatchAuthSummary,
      remoteDispatchPlanned: true,
    }),
  });
  const requestSummary = summarizeDispatchPayload(request.messageType, request.payload, request.protocolVersion);
  const pendingTask = await resolved.updateTaskDispatchMetadata(claimed.task.taskId, {
    assignedNodeId: claimed.node.id,
    dispatchMessageId: request.messageId,
    dispatchTargetNodeId: claimed.node.id,
    dispatchProtocolVersion: request.protocolVersion,
    dispatchStatusSummary: requestSummary,
    dispatchAuthSummary,
    dispatchTransportStatus: "pending",
    remoteDispatchPlanned: true,
  });
  const transport = context.dispatchTransport ?? createLocalControlledDispatchTransport();

  try {
    const transportResult = await transport.sendDispatchRequest({
      request,
      context: {
        runtimeMode: claimed.node.mode === "local-node" ? "local" : claimed.node.mode,
        cwd,
        allowedRoots: context.allowedRoots ?? claimed.node.allowedRoots,
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
    const effectiveTask = transportResult.task ?? await resolved.getTask(claimed.task.taskId) ?? pendingTask ?? claimed.task;

    return {
      task: effectiveTask,
      session: transportResult.session ?? null,
      nodeId: claimed.node.id,
      runnerMode: effectiveTask.runnerMode,
      claimToken: effectiveTask.claimToken,
      dispatchMessageId: effectiveTask.dispatchMessageId,
      dispatchAckMessageId: effectiveTask.dispatchAckMessageId,
      dispatchResultMessageId: effectiveTask.dispatchResultMessageId,
      dispatchTargetNodeId: effectiveTask.dispatchTargetNodeId,
      dispatchProtocolVersion: effectiveTask.dispatchProtocolVersion,
      dispatchStatusSummary: effectiveTask.dispatchStatusSummary,
      dispatchAuthSummary: effectiveTask.dispatchAuthSummary,
      dispatchTransportStatus: effectiveTask.dispatchTransportStatus,
      status: effectiveTask.status === "completed" || effectiveTask.status === "failed" || effectiveTask.status === "blocked"
        ? effectiveTask.status
        : transportResult.status === "rejected"
          ? "blocked"
          : transportResult.status === "failed"
            ? "failed"
            : "claimed",
      queueStateSummary: summarizeTaskEnvelope(effectiveTask),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Controlled queued dispatch failed unexpectedly.";
    const failedTask = await resolved.updateTaskStatus(claimed.task.taskId, "failed", {
      assignedNodeId: claimed.node.id,
      statusReason: reason,
      dispatchMessageId: request.messageId,
      dispatchTargetNodeId: claimed.node.id,
      dispatchProtocolVersion: request.protocolVersion,
      dispatchStatusSummary: requestSummary,
      dispatchAuthSummary,
      dispatchTransportStatus: "failed",
      remoteDispatchPlanned: true,
    });

    return {
      task: failedTask,
      session: null,
      nodeId: claimed.node.id,
      runnerMode: failedTask?.runnerMode ?? claimed.task.runnerMode,
      claimToken: failedTask?.claimToken ?? claimed.task.claimToken,
      dispatchMessageId: failedTask?.dispatchMessageId ?? request.messageId,
      dispatchAckMessageId: failedTask?.dispatchAckMessageId,
      dispatchResultMessageId: failedTask?.dispatchResultMessageId,
      dispatchTargetNodeId: failedTask?.dispatchTargetNodeId ?? claimed.node.id,
      dispatchProtocolVersion: failedTask?.dispatchProtocolVersion ?? request.protocolVersion,
      dispatchStatusSummary: failedTask?.dispatchStatusSummary ?? requestSummary,
      dispatchAuthSummary: failedTask?.dispatchAuthSummary ?? dispatchAuthSummary,
      dispatchTransportStatus: failedTask?.dispatchTransportStatus ?? "failed",
      status: "failed",
      queueStateSummary: failedTask ? summarizeTaskEnvelope(failedTask) : undefined,
    };
  }
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