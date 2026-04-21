import { validateDispatchAuthToken } from "./dispatchAuth";
import {
  createTaskDispatchAck,
  createTaskDispatchError,
  createTaskDispatchResult,
  summarizeDispatchPayload,
  validateDispatchEnvelopePayload,
  type TaskDispatchErrorPayload,
  type TaskDispatchRequestPayload,
} from "./dispatchMessages";
import { createDispatchEnvelope, deserializeDispatchEnvelope, type DispatchEnvelope } from "./dispatchProtocol";
import type { ExecutionNodeDescriptor } from "./executionNode";
import { getExecutionNode, validateExecutionNodeDispatch } from "./executionNodeRegistry";
import {
  getTask,
  updateTaskDispatchMetadata,
  updateTaskStatus,
} from "./taskQueueStore";
import { summarizeTaskEnvelope, type TaskEnvelope } from "./taskEnvelope";
import type { AutonomousSession } from "./autonomousSession";
import type { ClaimedQueuedTask, QueueExecutionSummary } from "./queueOrchestrator";

type ReceiveExecutionContext = {
  runtimeMode?: "web" | "headless" | "local";
  cwd?: string;
  allowedRoots?: string[];
  maxSteps?: number;
};

export type DispatchReceiverDependencies = {
  getTask?: typeof getTask;
  getExecutionNode?: typeof getExecutionNode;
  updateTaskStatus?: typeof updateTaskStatus;
  updateTaskDispatchMetadata?: typeof updateTaskDispatchMetadata;
  validateExecutionNodeDispatch?: typeof validateExecutionNodeDispatch;
  executeClaimedTask: (
    claimed: ClaimedQueuedTask,
    context: ReceiveExecutionContext,
  ) => Promise<QueueExecutionSummary>;
};

export type DispatchReceiverResult = {
  status: "accepted" | "rejected" | "failed";
  request: DispatchEnvelope<TaskDispatchRequestPayload>;
  ack: DispatchEnvelope;
  result?: DispatchEnvelope;
  error?: DispatchEnvelope;
  task?: TaskEnvelope | null;
  session?: AutonomousSession | null;
  authSummary: string;
  reason?: string;
};

type HandleDispatchRequestParams = {
  request?: DispatchEnvelope<TaskDispatchRequestPayload>;
  rawRequest?: string;
  executionContext?: ReceiveExecutionContext;
  dependencies: DispatchReceiverDependencies;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildStructuredDispatchError(error: string, retryable = false): TaskDispatchErrorPayload {
  return createTaskDispatchError({
    error: normalizeText(error) || "The dispatch request failed.",
    retryable,
  });
}

function mapSummaryStatusToResultStatus(status: QueueExecutionSummary["status"]): "completed" | "failed" | "blocked" {
  if (status === "completed") {
    return "completed";
  }

  if (status === "blocked") {
    return "blocked";
  }

  return "failed";
}

function createAckEnvelope(
  request: DispatchEnvelope<TaskDispatchRequestPayload>,
  accepted: boolean,
  reason?: string,
): DispatchEnvelope {
  return createDispatchEnvelope({
    messageType: "task-dispatch-ack",
    sourceNodeId: request.targetNodeId,
    targetNodeId: request.sourceNodeId,
    taskId: request.taskId,
    sessionId: request.sessionId,
    payload: createTaskDispatchAck({
      accepted,
      reason,
    }),
  });
}

function createErrorEnvelope(
  request: DispatchEnvelope<TaskDispatchRequestPayload>,
  error: string,
  retryable = false,
): DispatchEnvelope {
  return createDispatchEnvelope({
    messageType: "task-dispatch-error",
    sourceNodeId: request.targetNodeId,
    targetNodeId: request.sourceNodeId,
    taskId: request.taskId,
    sessionId: request.sessionId,
    payload: buildStructuredDispatchError(error, retryable),
  });
}

async function rejectDispatchRequest(params: {
  request: DispatchEnvelope<TaskDispatchRequestPayload>;
  reason: string;
  authSummary: string;
  existingTask?: TaskEnvelope | null;
  dependencies: DispatchReceiverDependencies;
}): Promise<DispatchReceiverResult> {
  const ack = createAckEnvelope(params.request, false, params.reason);
  const error = createErrorEnvelope(params.request, params.reason);
  const dispatchStatusSummary = [
    summarizeDispatchPayload(params.request.messageType, params.request.payload, params.request.protocolVersion),
    summarizeDispatchPayload(ack.messageType, ack.payload, ack.protocolVersion),
    summarizeDispatchPayload(error.messageType, error.payload, error.protocolVersion),
  ].join(" || ");

  let task = params.existingTask ?? null;
  if (task) {
    task = await (params.dependencies.updateTaskStatus ?? updateTaskStatus)(task.taskId, "rejected", {
      assignedNodeId: task.assignedNodeId ?? params.request.targetNodeId,
      statusReason: params.reason,
      failureReason: params.reason,
      dispatchAckMessageId: ack.messageId,
      dispatchTargetNodeId: params.request.targetNodeId,
      dispatchProtocolVersion: params.request.protocolVersion,
      dispatchStatusSummary,
      dispatchAuthSummary: params.authSummary,
      dispatchTransportStatus: "rejected",
      dispatchReceivedAt: ack.createdAt,
      dispatchCompletedAt: error.createdAt,
      remoteDispatchPlanned: true,
    });
  }

  return {
    status: "rejected",
    request: params.request,
    ack,
    error,
    task,
    session: null,
    authSummary: params.authSummary,
    reason: params.reason,
  };
}

export async function handleDispatchRequest(params: HandleDispatchRequestParams): Promise<DispatchReceiverResult> {
  const request = params.request ?? (() => {
    const parsed = deserializeDispatchEnvelope(params.rawRequest ?? "");
    if (!parsed || parsed.messageType !== "task-dispatch-request" || !validateDispatchEnvelopePayload(parsed)) {
      return null;
    }

    return parsed as DispatchEnvelope<TaskDispatchRequestPayload>;
  })();

  if (!request) {
    throw new Error("The controlled dispatch receiver could not deserialize a valid request envelope.");
  }

  const authValidation = validateDispatchAuthToken({
    authToken: request.payload.authToken,
    envelope: request,
  });
  const authSummary = request.payload.dispatchAuthSummary || authValidation.summary;
  const loadTask = params.dependencies.getTask ?? getTask;
  const existingTask = await loadTask(request.taskId);

  if (!authValidation.valid) {
    return rejectDispatchRequest({
      request,
      reason: authValidation.reason || "The dispatch request failed authentication.",
      authSummary,
      existingTask,
      dependencies: params.dependencies,
    });
  }

  const validateNode = params.dependencies.validateExecutionNodeDispatch ?? validateExecutionNodeDispatch;
  const nodeValidation = validateNode(request.targetNodeId, {
    requestedCapabilities: request.payload.requestedCapabilities,
    action: request.payload.action,
    taskId: request.taskId,
  });
  if (!nodeValidation.accepted || !nodeValidation.node) {
    return rejectDispatchRequest({
      request,
      reason: nodeValidation.reason || `Execution node ${request.targetNodeId} rejected the dispatch request.`,
      authSummary,
      existingTask,
      dependencies: params.dependencies,
    });
  }

  if (!existingTask) {
    return rejectDispatchRequest({
      request,
      reason: `Task ${request.taskId} was not found in the controlled queue store.`,
      authSummary,
      dependencies: params.dependencies,
    });
  }

  if (!existingTask.lease || existingTask.lease.status !== "active") {
    return rejectDispatchRequest({
      request,
      reason: `Task ${request.taskId} does not have an active execution lease.`,
      authSummary,
      existingTask,
      dependencies: params.dependencies,
    });
  }

  if (
    request.payload.lease.leaseId !== existingTask.lease.leaseId
    || request.payload.lease.epoch !== existingTask.lease.epoch
    || request.payload.lease.ownerNodeId !== existingTask.lease.ownerNodeId
  ) {
    return rejectDispatchRequest({
      request,
      reason: `Task ${request.taskId} lease ownership did not match the persisted active lease.`,
      authSummary,
      existingTask,
      dependencies: params.dependencies,
    });
  }

  if (request.payload.lease.ownerNodeId !== request.targetNodeId) {
    return rejectDispatchRequest({
      request,
      reason: `Task ${request.taskId} lease owner ${request.payload.lease.ownerNodeId} does not match dispatch target ${request.targetNodeId}.`,
      authSummary,
      existingTask,
      dependencies: params.dependencies,
    });
  }

  const persistedIsContinuation = existingTask.continuationGeneration > 0;
  const requestIsContinuation = Boolean(request.payload.continuation?.isContinuation);
  if (persistedIsContinuation !== requestIsContinuation) {
    return rejectDispatchRequest({
      request,
      reason: `Task ${request.taskId} continuation lineage did not match the persisted task state.`,
      authSummary,
      existingTask,
      dependencies: params.dependencies,
    });
  }

  if (request.payload.continuation?.isContinuation) {
    const continuation = request.payload.continuation;
    if (continuation.generation !== existingTask.continuationGeneration) {
      return rejectDispatchRequest({
        request,
        reason: `Task ${request.taskId} continuation generation did not match the persisted task state.`,
        authSummary,
        existingTask,
        dependencies: params.dependencies,
      });
    }

    if (existingTask.priorLeaseId && continuation.priorLeaseId && existingTask.priorLeaseId !== continuation.priorLeaseId) {
      return rejectDispatchRequest({
        request,
        reason: `Task ${request.taskId} continuation prior lease did not match the persisted task state.`,
        authSummary,
        existingTask,
        dependencies: params.dependencies,
      });
    }

    if (existingTask.continuationSourceNodeId && continuation.sourceNodeId && existingTask.continuationSourceNodeId !== continuation.sourceNodeId) {
      return rejectDispatchRequest({
        request,
        reason: `Task ${request.taskId} continuation source node did not match the persisted task state.`,
        authSummary,
        existingTask,
        dependencies: params.dependencies,
      });
    }

    if (existingTask.continuationTargetNodeId && continuation.targetNodeId && existingTask.continuationTargetNodeId !== continuation.targetNodeId) {
      return rejectDispatchRequest({
        request,
        reason: `Task ${request.taskId} continuation target node did not match the persisted task state.`,
        authSummary,
        existingTask,
        dependencies: params.dependencies,
      });
    }

    if (existingTask.resumedFromCheckpointReference && continuation.resumedFromCheckpointReference && existingTask.resumedFromCheckpointReference !== continuation.resumedFromCheckpointReference) {
      return rejectDispatchRequest({
        request,
        reason: `Task ${request.taskId} resumed checkpoint did not match the persisted continuation state.`,
        authSummary,
        existingTask,
        dependencies: params.dependencies,
      });
    }

    if (existingTask.resumedFromContinuationToken && continuation.resumedFromContinuationToken && existingTask.resumedFromContinuationToken !== continuation.resumedFromContinuationToken) {
      return rejectDispatchRequest({
        request,
        reason: `Task ${request.taskId} resumed continuation token did not match the persisted continuation state.`,
        authSummary,
        existingTask,
        dependencies: params.dependencies,
      });
    }
  }

  if (
    existingTask.continuationToken
    && request.payload.lease.continuationToken
    && existingTask.continuationToken !== request.payload.lease.continuationToken
  ) {
    return rejectDispatchRequest({
      request,
      reason: `Task ${request.taskId} continuation token did not match the persisted lease state.`,
      authSummary,
      existingTask,
      dependencies: params.dependencies,
    });
  }

  if (
    existingTask.checkpointReference
    && request.payload.lease.checkpointReference
    && existingTask.checkpointReference !== request.payload.lease.checkpointReference
  ) {
    return rejectDispatchRequest({
      request,
      reason: `Task ${request.taskId} checkpoint reference did not match the persisted lease state.`,
      authSummary,
      existingTask,
      dependencies: params.dependencies,
    });
  }

  if (existingTask.assignedNodeId && existingTask.assignedNodeId !== request.targetNodeId) {
    return rejectDispatchRequest({
      request,
      reason: `Task ${request.taskId} is assigned to ${existingTask.assignedNodeId}, not ${request.targetNodeId}.`,
      authSummary,
      existingTask,
      dependencies: params.dependencies,
    });
  }

  const ack = createAckEnvelope(
    request,
    true,
    `Controlled receive boundary accepted dispatch for ${request.taskId} on ${nodeValidation.node.id}.`,
  );
  const receivedTask = await (params.dependencies.updateTaskDispatchMetadata ?? updateTaskDispatchMetadata)(existingTask.taskId, {
    assignedNodeId: nodeValidation.node.id,
    dispatchAckMessageId: ack.messageId,
    dispatchTargetNodeId: request.targetNodeId,
    dispatchProtocolVersion: request.protocolVersion,
    dispatchStatusSummary: [
      summarizeDispatchPayload(request.messageType, request.payload, request.protocolVersion),
      summarizeDispatchPayload(ack.messageType, ack.payload, ack.protocolVersion),
    ].join(" || "),
    dispatchAuthSummary: authSummary,
    dispatchTransportStatus: "accepted",
    dispatchReceivedAt: ack.createdAt,
    remoteDispatchPlanned: true,
  });

  const claimed: ClaimedQueuedTask = {
    task: receivedTask ?? {
      ...existingTask,
      assignedNodeId: nodeValidation.node.id,
      dispatchAckMessageId: ack.messageId,
      dispatchTransportStatus: "accepted",
      dispatchAuthSummary: authSummary,
      dispatchReceivedAt: ack.createdAt,
      remoteDispatchPlanned: true,
    },
    node: nodeValidation.node,
  };

  try {
    const executionSummary = await params.dependencies.executeClaimedTask(claimed, {
      runtimeMode: nodeValidation.node.mode === "local-node" ? "local" : nodeValidation.node.mode,
      cwd: params.executionContext?.cwd ?? nodeValidation.node.cwd,
      allowedRoots: params.executionContext?.allowedRoots ?? nodeValidation.node.allowedRoots,
      maxSteps: params.executionContext?.maxSteps,
    });
    const result = createDispatchEnvelope({
      messageType: "task-dispatch-result",
      sourceNodeId: request.targetNodeId,
      targetNodeId: request.sourceNodeId,
      taskId: request.taskId,
      sessionId: request.sessionId,
      payload: createTaskDispatchResult({
        status: mapSummaryStatusToResultStatus(executionSummary.status),
        executionResult: executionSummary.session?.latestExecutionResult,
        linkedSessionId: executionSummary.session?.sessionId,
        linkedTaskId: executionSummary.task?.taskId ?? request.taskId,
        summary: executionSummary.queueStateSummary || summarizeTaskEnvelope(executionSummary.task ?? claimed.task),
      }),
    });
    const dispatchStatusSummary = [
      summarizeDispatchPayload(request.messageType, request.payload, request.protocolVersion),
      summarizeDispatchPayload(ack.messageType, ack.payload, ack.protocolVersion),
      summarizeDispatchPayload(result.messageType, result.payload, result.protocolVersion),
    ].join(" || ");
    const finalizedTask = executionSummary.task
      ? await (params.dependencies.updateTaskDispatchMetadata ?? updateTaskDispatchMetadata)(executionSummary.task.taskId, {
          assignedNodeId: executionSummary.task.assignedNodeId ?? nodeValidation.node.id,
          dispatchAckMessageId: ack.messageId,
          dispatchResultMessageId: result.messageId,
          dispatchTargetNodeId: request.targetNodeId,
          dispatchProtocolVersion: request.protocolVersion,
          dispatchStatusSummary,
          dispatchAuthSummary: authSummary,
          dispatchTransportStatus: executionSummary.status === "completed" ? "completed" : "delivered",
          dispatchReceivedAt: ack.createdAt,
          dispatchCompletedAt: result.createdAt,
          remoteDispatchPlanned: true,
        })
      : null;

    return {
      status: "accepted",
      request,
      ack,
      result,
      task: finalizedTask ?? executionSummary.task,
      session: executionSummary.session,
      authSummary,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The controlled dispatch receiver failed during execution.";
    const errorEnvelope = createErrorEnvelope(request, reason, false);
    const dispatchStatusSummary = [
      summarizeDispatchPayload(request.messageType, request.payload, request.protocolVersion),
      summarizeDispatchPayload(ack.messageType, ack.payload, ack.protocolVersion),
      summarizeDispatchPayload(errorEnvelope.messageType, errorEnvelope.payload, errorEnvelope.protocolVersion),
    ].join(" || ");
    const failedTask = await (params.dependencies.updateTaskStatus ?? updateTaskStatus)(existingTask.taskId, "failed", {
      assignedNodeId: nodeValidation.node.id,
      statusReason: reason,
      dispatchAckMessageId: ack.messageId,
      dispatchTargetNodeId: request.targetNodeId,
      dispatchProtocolVersion: request.protocolVersion,
      dispatchStatusSummary,
      dispatchAuthSummary: authSummary,
      dispatchTransportStatus: "failed",
      dispatchReceivedAt: ack.createdAt,
      dispatchCompletedAt: errorEnvelope.createdAt,
      remoteDispatchPlanned: true,
    });

    return {
      status: "failed",
      request,
      ack,
      error: errorEnvelope,
      task: failedTask,
      session: null,
      authSummary,
      reason,
    };
  }
}