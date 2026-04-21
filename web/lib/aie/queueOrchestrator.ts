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
import { createDispatchEnvelope, type DispatchProtocolVersion } from "./dispatchProtocol";
import { createTaskDispatchRequest, summarizeDispatchPayload } from "./dispatchMessages";
import { simulateLocalDispatchRoundTrip } from "./dispatchTransport";
import { resolveRepoRoot } from "./repoContext";
import { runAutonomousSession } from "./runAutonomousSession";
import {
  claimTask,
  finalizeTask,
  getRunnableTasks,
  getTask,
  updateTaskStatus,
} from "./taskQueueStore";
import { summarizeTaskEnvelope, type TaskEnvelope } from "./taskEnvelope";

type QueueOrchestratorDependencies = {
  getRunnableTasks: typeof getRunnableTasks;
  getTask: typeof getTask;
  claimTask: typeof claimTask;
  finalizeTask: typeof finalizeTask;
  updateTaskStatus: typeof updateTaskStatus;
  saveAutonomousSession: typeof saveAutonomousSession;
  runAutonomousSession: typeof runAutonomousSession;
};

type QueueExecutionContext = {
  runtimeMode?: "web" | "headless" | "local";
  cwd?: string;
  allowedRoots?: string[];
  maxSteps?: number;
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
  dispatchTargetNodeId?: string;
  dispatchProtocolVersion?: DispatchProtocolVersion;
  dispatchStatusSummary?: string;
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
    dispatchTargetNodeId: task.dispatchTargetNodeId,
    dispatchProtocolVersion: task.dispatchProtocolVersion,
    dispatchStatusSummary: task.dispatchStatusSummary,
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
      const request = createDispatchEnvelope({
        messageType: "task-dispatch-request",
        sourceNodeId: runtimeNode.id,
        targetNodeId: selectedNode.id,
        taskId: claimed.taskId,
        sessionId: claimed.sessionId,
        payload: createTaskDispatchRequest({
          action: claimed.action,
          requestedCapabilities: claimed.requestedCapabilities,
          assignedNodeId: selectedNode.id,
          approvalState: {
            requiresApproval: claimed.action.requiresApproval,
            approved: true,
          },
          queueStateSummary: summarizeTaskEnvelope(claimed),
          dispatchStatusSummary: "Dispatch requested for local simulated handoff.",
          remoteDispatchPlanned: true,
        }),
      });
      const roundTrip = simulateLocalDispatchRoundTrip({
        request,
        accepted: true,
        ackReason: "Local dispatch handshake accepted through the simulated transport boundary.",
      });
      const dispatchStatusSummary = [
        summarizeDispatchPayload(roundTrip.request.messageType, roundTrip.request.payload, roundTrip.request.protocolVersion),
        summarizeDispatchPayload(roundTrip.ack.messageType, roundTrip.ack.payload, roundTrip.ack.protocolVersion),
      ].join(" || ");
      const claimedWithDispatch = await resolved.updateTaskStatus(claimed.taskId, "assigned", {
        assignedNodeId: selectedNode.id,
        claimToken: claimed.claimToken,
        runnerMode: claimed.runnerMode,
        dispatchMessageId: request.messageId,
        dispatchTargetNodeId: selectedNode.id,
        dispatchProtocolVersion: request.protocolVersion,
        dispatchStatusSummary,
        remoteDispatchPlanned: true,
      });

      return {
        task: claimedWithDispatch ?? {
          ...claimed,
          dispatchMessageId: request.messageId,
          dispatchTargetNodeId: selectedNode.id,
          dispatchProtocolVersion: request.protocolVersion,
          dispatchStatusSummary,
          remoteDispatchPlanned: true,
        },
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
    const request = claimed.task.dispatchMessageId
      ? createDispatchEnvelope({
          protocolVersion: claimed.task.dispatchProtocolVersion ?? "1",
          messageType: "task-dispatch-request",
          messageId: claimed.task.dispatchMessageId,
          sourceNodeId: claimed.task.assignedNodeId ?? claimed.node.id,
          targetNodeId: claimed.task.dispatchTargetNodeId ?? claimed.node.id,
          taskId: claimed.task.taskId,
          sessionId: claimed.task.sessionId,
          payload: createTaskDispatchRequest({
            action: claimed.task.action,
            requestedCapabilities: claimed.task.requestedCapabilities,
            assignedNodeId: claimed.task.dispatchTargetNodeId ?? claimed.node.id,
            approvalState: {
              requiresApproval: claimed.task.action.requiresApproval,
              approved: true,
            },
            queueStateSummary: summarizeTaskEnvelope(claimed.task),
            dispatchStatusSummary: claimed.task.dispatchStatusSummary,
            remoteDispatchPlanned: claimed.task.remoteDispatchPlanned,
          }),
        })
      : undefined;
    const roundTrip = request
      ? simulateLocalDispatchRoundTrip({
          request,
          accepted: true,
          resultPayload: {
            status: effectiveStatus === "claimed" ? "blocked" : effectiveStatus,
            executionResult: session.latestExecutionResult,
            linkedSessionId: session.sessionId,
            linkedTaskId: effectiveTask.taskId,
            summary: `Local simulated dispatch returned ${effectiveStatus} through the shared runner.`,
          },
        })
      : undefined;
    const dispatchStatusSummary = roundTrip
      ? [
          summarizeDispatchPayload(roundTrip.request.messageType, roundTrip.request.payload, roundTrip.request.protocolVersion),
          summarizeDispatchPayload(roundTrip.ack.messageType, roundTrip.ack.payload, roundTrip.ack.protocolVersion),
          roundTrip.result
            ? summarizeDispatchPayload(roundTrip.result.messageType, roundTrip.result.payload, roundTrip.result.protocolVersion)
            : "",
        ].filter(Boolean).join(" || ")
      : effectiveTask.dispatchStatusSummary;
    const persistedTask = effectiveStatus === "claimed"
      ? finalizedTask
      : await resolved.updateTaskStatus(effectiveTask.taskId, effectiveStatus, {
          assignedNodeId: effectiveTask.assignedNodeId,
          dispatchMessageId: request?.messageId ?? effectiveTask.dispatchMessageId,
          dispatchTargetNodeId: claimed.task.dispatchTargetNodeId ?? effectiveTask.dispatchTargetNodeId,
          dispatchProtocolVersion: request?.protocolVersion ?? effectiveTask.dispatchProtocolVersion,
          dispatchStatusSummary,
          remoteDispatchPlanned: claimed.task.remoteDispatchPlanned ?? effectiveTask.remoteDispatchPlanned,
        });
    const summarizedTask = persistedTask ?? effectiveTask;

    return {
      task: persistedTask ?? finalizedTask,
      session,
      nodeId: claimed.node.id,
      runnerMode: summarizedTask.runnerMode,
      claimToken: summarizedTask.claimToken,
      dispatchMessageId: summarizedTask.dispatchMessageId,
      dispatchTargetNodeId: summarizedTask.dispatchTargetNodeId,
      dispatchProtocolVersion: summarizedTask.dispatchProtocolVersion,
      dispatchStatusSummary: summarizedTask.dispatchStatusSummary,
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
      dispatchTargetNodeId: finalizedTask?.dispatchTargetNodeId ?? claimed.task.dispatchTargetNodeId,
      dispatchProtocolVersion: finalizedTask?.dispatchProtocolVersion ?? claimed.task.dispatchProtocolVersion,
      dispatchStatusSummary: finalizedTask?.dispatchStatusSummary ?? claimed.task.dispatchStatusSummary,
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