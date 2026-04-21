import { loadAutonomousSession, listAutonomousSessions } from "./lib/aie/autonomousSessionStore";
import { runSingleQueuedTask, type QueueExecutionSummary } from "./lib/aie/queueOrchestrator";
import { createRuntimeExecutionNodeDescriptor } from "./lib/aie/executionNode";
import {
  getExecutionNodeEligibility,
  listExecutionNodes,
  registerExecutionNode,
} from "./lib/aie/executionNodeRegistry";
import { resolveRepoRoot } from "./lib/aie/repoContext";
import { runAutonomousSession } from "./lib/aie/runAutonomousSession";
import type { AutonomousSession } from "./lib/aie/autonomousSession";
import type { TaskEnvelope } from "./lib/aie/taskEnvelope";
import { getTask, listTasks } from "./lib/aie/taskQueueStore";
import type { runAnalysis } from "./lib/aie/run-analysis";
import type { saveAutonomousSession } from "./lib/aie/autonomousSessionStore";
import type { executeAction } from "./lib/aie/executionRuntime";

type LocalNodeOptions = {
  goal: string;
  maxSteps?: number;
  sessionId?: string;
  approved?: boolean;
  allowedRoots?: string[];
  cwd?: string;
  verbose?: boolean;
  json?: boolean;
  listSessions?: boolean;
  listTasks?: boolean;
  listNodes?: boolean;
  runNextTask?: boolean;
  runTask?: boolean;
  taskId?: string;
};

type LocalNodeDependencies = {
  runAnalysis: typeof runAnalysis;
  executeAction: typeof executeAction;
  saveAutonomousSession: typeof saveAutonomousSession;
  runSingleQueuedTask: typeof runSingleQueuedTask;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampMaxSteps(value: unknown): number | undefined {
  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return Math.max(1, Math.min(5, Math.floor(numericValue)));
}

export function parseLocalNodeArgs(argv: string[]): LocalNodeOptions {
  const options: LocalNodeOptions = {
    goal: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    switch (current) {
      case "--goal":
        options.goal = normalizeText(next);
        index += 1;
        break;
      case "--maxSteps":
        options.maxSteps = clampMaxSteps(next);
        index += 1;
        break;
      case "--sessionId":
        options.sessionId = normalizeText(next) || undefined;
        index += 1;
        break;
      case "--approved":
        options.approved = true;
        break;
      case "--allowedRoot":
        options.allowedRoots = [...(options.allowedRoots ?? []), normalizeText(next)].filter(Boolean);
        index += 1;
        break;
      case "--cwd":
        options.cwd = normalizeText(next) || undefined;
        index += 1;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--listSessions":
        options.listSessions = true;
        break;
      case "--listTasks":
        options.listTasks = true;
        break;
      case "--listNodes":
        options.listNodes = true;
        break;
      case "--runNextTask":
        options.runNextTask = true;
        break;
      case "--runTask":
        options.runTask = true;
        break;
      case "--taskId":
        options.taskId = normalizeText(next) || undefined;
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

export function formatLocalNodeSessionOutput(session: AutonomousSession, options?: { json?: boolean; verbose?: boolean }): string {
  if (options?.json) {
    return JSON.stringify(
      {
        sessionId: session.sessionId,
        status: session.status,
        goal: session.goal,
        latestAdapter: session.executionAdapterId ?? null,
        adapterContextSummary: session.adapterContextSummary ?? null,
        executionNodeId: session.executionNodeId ?? null,
        executionNodeMode: session.executionNodeMode ?? null,
        nodeCapabilitySummary: session.nodeCapabilitySummary ?? null,
        selectedNodeId: session.selectedNodeId ?? null,
        selectedNodeReason: session.selectedNodeReason ?? null,
        taskId: session.taskId ?? null,
        taskStatus: session.taskStatus ?? null,
        assignedNodeId: session.assignedNodeId ?? null,
        queueStateSummary: session.queueStateSummary ?? null,
        dispatchMessageId: session.dispatchMessageId ?? null,
        dispatchAckMessageId: session.dispatchAckMessageId ?? null,
        dispatchResultMessageId: session.dispatchResultMessageId ?? null,
        dispatchTargetNodeId: session.dispatchTargetNodeId ?? null,
        dispatchProtocolVersion: session.dispatchProtocolVersion ?? null,
        dispatchStatusSummary: session.dispatchStatusSummary ?? null,
        dispatchAuthSummary: session.dispatchAuthSummary ?? null,
        dispatchTransportStatus: session.dispatchTransportStatus ?? null,
        remoteDispatchPlanned: session.remoteDispatchPlanned ?? null,
        planningHintSummary: session.planningHintSummary ?? null,
        failureReason: session.failureReason ?? null,
        retryCount: session.latestRecoveryState?.retryCount ?? null,
        completion: session.latestCompletion ?? null,
        completedReason: session.completedReason ?? session.stateReason ?? null,
        steps: options.verbose ? session.steps : session.steps.map((step) => ({
          index: step.index,
          actionFamily: step.actionFamily ?? null,
          executionAdapterId: step.executionAdapterId ?? null,
          executionNodeId: step.executionNodeId ?? null,
          executionNodeMode: step.executionNodeMode ?? null,
          nodeCapabilitySummary: step.nodeCapabilitySummary ?? null,
          selectedNodeId: step.selectedNodeId ?? null,
          selectedNodeReason: step.selectedNodeReason ?? null,
          taskId: step.taskId ?? null,
          taskStatus: step.taskStatus ?? null,
          assignedNodeId: step.assignedNodeId ?? null,
          queueStateSummary: step.queueStateSummary ?? null,
          dispatchMessageId: step.dispatchMessageId ?? null,
          dispatchAckMessageId: step.dispatchAckMessageId ?? null,
          dispatchResultMessageId: step.dispatchResultMessageId ?? null,
          dispatchTargetNodeId: step.dispatchTargetNodeId ?? null,
          dispatchProtocolVersion: step.dispatchProtocolVersion ?? null,
          dispatchStatusSummary: step.dispatchStatusSummary ?? null,
          dispatchAuthSummary: step.dispatchAuthSummary ?? null,
          dispatchTransportStatus: step.dispatchTransportStatus ?? null,
          remoteDispatchPlanned: step.remoteDispatchPlanned ?? null,
          failureReason: step.failureReason ?? null,
          retryCount: step.retryCount ?? null,
          goalStatus: step.goalStatus ?? null,
          runtimeStatus: step.executionResult?.status ?? null,
        })),
      },
      null,
      2,
    );
  }

  const lines = [
    `Session ID: ${session.sessionId}`,
    `Goal: ${session.goal}`,
    `Status: ${session.status}`,
    `Latest adapter: ${session.executionAdapterId ?? "unknown"}`,
    `Execution node: ${session.executionNodeId ?? "unknown"} (${session.executionNodeMode ?? "unknown"})`,
    `Node capabilities: ${session.nodeCapabilitySummary ?? "No node capabilities recorded."}`,
    `Selected node: ${session.selectedNodeId ?? session.assignedNodeId ?? "No node selection recorded."}`,
    `Selection reason: ${session.selectedNodeReason ?? "No node selection reason recorded."}`,
    `Latest task: ${session.taskId ?? "No task recorded."}`,
    `Task status: ${session.taskStatus ?? "No task status recorded."}`,
    `Assigned node: ${session.assignedNodeId ?? "No node assignment recorded."}`,
    `Queue summary: ${session.queueStateSummary ?? "No queue summary recorded."}`,
    `Dispatch summary: ${session.dispatchStatusSummary ?? "No dispatch summary recorded."}`,
    `Dispatch transport: ${session.dispatchTransportStatus ?? "No dispatch transport status recorded."}`,
    `Dispatch auth: ${session.dispatchAuthSummary ?? "No dispatch auth summary recorded."}`,
    `Retry count: ${typeof session.latestRecoveryState?.retryCount === "number" ? session.latestRecoveryState.retryCount : "No retry count recorded."}`,
    `Failure reason: ${session.failureReason ?? "No failure reason recorded."}`,
    `Completion: ${session.latestCompletion ? `${session.latestCompletion.status} (${session.latestCompletion.confidence})` : "No completion state recorded."}`,
    `Reason: ${session.completedReason ?? session.stateReason ?? "No stop reason recorded."}`,
  ];

  if (options?.verbose && session.steps.length) {
    lines.push(
      "",
      ...session.steps.map((step) => [
        `Step ${step.index} | lane=${step.actionFamily ?? "unknown"} | adapter=${step.executionAdapterId ?? "unknown"} | runtime=${step.executionResult?.status ?? "unknown"}`,
        step.executionNodeId ? `Node: ${step.executionNodeId} (${step.executionNodeMode ?? "unknown"})` : "",
        step.nodeCapabilitySummary ? `Node capabilities: ${step.nodeCapabilitySummary}` : "",
        step.taskId ? `Task: ${step.taskId}` : "",
        step.taskStatus ? `Task status: ${step.taskStatus}` : "",
        step.assignedNodeId ? `Assigned node: ${step.assignedNodeId}` : "",
        step.queueStateSummary ? `Queue: ${step.queueStateSummary}` : "",
        step.dispatchStatusSummary ? `Dispatch: ${step.dispatchStatusSummary}` : "",
        step.dispatchTransportStatus ? `Dispatch transport: ${step.dispatchTransportStatus}` : "",
        step.dispatchAuthSummary ? `Dispatch auth: ${step.dispatchAuthSummary}` : "",
        step.proposedAction ? `Action: ${step.proposedAction}` : "",
        step.planningHintSummary ? `Planning: ${step.planningHintSummary}` : "",
        step.adapterContextSummary ? `Adapter context: ${step.adapterContextSummary}` : "",
        step.diagnosis ? `Diagnosis: ${step.diagnosis}` : "",
      ].filter(Boolean).join("\n")),
    );
  }

  return lines.join("\n");
}

export async function formatLocalNodeSessionList(options?: { json?: boolean }): Promise<string> {
  const sessions = await listAutonomousSessions();

  if (options?.json) {
    return JSON.stringify({
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        status: session.status,
        goal: session.goal,
        updatedAt: session.updatedAt,
      })),
    }, null, 2);
  }

  if (!sessions.length) {
    return "No persisted autonomous sessions found.";
  }

  return sessions
    .slice(0, 10)
    .map((session) => `${session.sessionId} | ${session.status} | ${session.goal}`)
    .join("\n");
}

export function formatLocalNodeTaskOutput(task: TaskEnvelope, options?: { json?: boolean }): string {
  if (options?.json) {
    return JSON.stringify(task, null, 2);
  }

  return [
    `Task ID: ${task.taskId}`,
    `Session ID: ${task.sessionId}`,
    `Step: ${task.stepIndex}`,
    `Status: ${task.status}`,
    `Selected node: ${task.selectedNodeId ?? task.assignedNodeId ?? "unassigned"}`,
    `Selection reason: ${task.selectedNodeReason ?? "none"}`,
    `Assigned node: ${task.assignedNodeId ?? "unassigned"}`,
    `Resumability: ${task.resumability}`,
    `Resume attempts: ${task.resumeAttemptCount}`,
    `Recovery pending: ${String(task.recoveryPending)}`,
    `Lease: ${task.lease?.leaseId ?? "none"}`,
    `Lease owner: ${task.lease?.ownerNodeId ?? "none"}`,
    `Lease epoch: ${typeof task.lease?.epoch === "number" ? task.lease.epoch : "none"}`,
    `Lease status: ${task.lease?.status ?? "none"}`,
    `Lease last progress: ${task.lease?.lastProgressAt ?? "none"}`,
    `Progress marker: ${task.lastProgressMarker ?? "none"}`,
    `Continuation token: ${task.continuationToken ? "present" : "none"}`,
    `Checkpoint reference: ${task.checkpointReference ?? "none"}`,
    `Runner mode: ${task.runnerMode ?? "unknown"}`,
    `Claim token: ${task.claimToken ?? "none"}`,
    `Dispatch message: ${task.dispatchMessageId ?? "none"}`,
    `Dispatch ack: ${task.dispatchAckMessageId ?? "none"}`,
    `Dispatch result: ${task.dispatchResultMessageId ?? "none"}`,
    `Dispatch target: ${task.dispatchTargetNodeId ?? "none"}`,
    `Dispatch protocol: ${task.dispatchProtocolVersion ?? "none"}`,
    `Dispatch transport: ${task.dispatchTransportStatus ?? "none"}`,
    `Dispatch retry count: ${typeof task.dispatchRetryCount === "number" ? task.dispatchRetryCount : "none"}`,
    `Dispatch last attempt: ${task.dispatchLastAttemptAt ?? "none"}`,
    `Dispatch timeout: ${typeof task.dispatchTimeoutMs === "number" ? task.dispatchTimeoutMs : "none"}`,
    `Dispatch auth: ${task.dispatchAuthSummary ?? "none"}`,
    `Dispatch summary: ${task.dispatchStatusSummary ?? "No dispatch summary recorded."}`,
    `Capabilities: ${task.requestedCapabilities.join(",") || "none"}`,
    `Reason: ${task.statusReason ?? "No status reason recorded."}`,
    `Failure reason: ${task.failureReason ?? "No failure reason recorded."}`,
    `Claimed: ${task.claimedAt ?? "not claimed"}`,
    `Dispatch received: ${task.dispatchReceivedAt ?? "not received"}`,
    `Dispatch completed: ${task.dispatchCompletedAt ?? "not completed"}`,
    `Started: ${task.startedAt ?? "not started"}`,
    `Completed: ${task.completedAt ?? "not completed"}`,
    `Failed: ${task.failedAt ?? "not failed"}`,
    `Blocked: ${task.blockedAt ?? "not blocked"}`,
    `Updated: ${task.updatedAt}`,
  ].join("\n");
}

export function formatLocalNodeQueueRunOutput(summary: QueueExecutionSummary, options?: { json?: boolean }): string {
  if (options?.json) {
    return JSON.stringify(summary, null, 2);
  }

  if (summary.status === "no-runnable-task") {
    return "No runnable safe queued task was available for controlled execution.";
  }

  return [
    `Queue run: ${summary.status}`,
    `Task ID: ${summary.task?.taskId ?? "unknown"}`,
    `Session ID: ${summary.session?.sessionId ?? summary.task?.sessionId ?? "unknown"}`,
    `Task status: ${summary.task?.status ?? "unknown"}`,
    `Selected node: ${summary.selectedNodeId ?? summary.task?.selectedNodeId ?? summary.task?.assignedNodeId ?? "unknown"}`,
    `Selection reason: ${summary.selectedNodeReason ?? summary.task?.selectedNodeReason ?? "unknown"}`,
    `Assigned node: ${summary.nodeId ?? summary.task?.assignedNodeId ?? "unknown"}`,
    `Resumability: ${summary.task?.resumability ?? "unknown"}`,
    `Resume attempts: ${summary.task?.resumeAttemptCount ?? "unknown"}`,
    `Recovery pending: ${typeof summary.task?.recoveryPending === "boolean" ? String(summary.task.recoveryPending) : "unknown"}`,
    `Lease: ${summary.task?.lease?.leaseId ?? "unknown"}`,
    `Lease owner: ${summary.task?.lease?.ownerNodeId ?? "unknown"}`,
    `Lease epoch: ${typeof summary.task?.lease?.epoch === "number" ? summary.task.lease.epoch : "unknown"}`,
    `Lease status: ${summary.task?.lease?.status ?? "unknown"}`,
    `Lease last progress: ${summary.task?.lease?.lastProgressAt ?? "unknown"}`,
    `Progress marker: ${summary.task?.lastProgressMarker ?? "unknown"}`,
    `Continuation token: ${summary.task?.continuationToken ? "present" : "none"}`,
    `Checkpoint reference: ${summary.task?.checkpointReference ?? "none"}`,
    `Runner mode: ${summary.runnerMode ?? summary.task?.runnerMode ?? "unknown"}`,
    `Claim token: ${summary.claimToken ?? summary.task?.claimToken ?? "unknown"}`,
    `Dispatch message: ${summary.dispatchMessageId ?? summary.task?.dispatchMessageId ?? "unknown"}`,
    `Dispatch ack: ${summary.dispatchAckMessageId ?? summary.task?.dispatchAckMessageId ?? "unknown"}`,
    `Dispatch result: ${summary.dispatchResultMessageId ?? summary.task?.dispatchResultMessageId ?? "unknown"}`,
    `Dispatch target: ${summary.dispatchTargetNodeId ?? summary.task?.dispatchTargetNodeId ?? "unknown"}`,
    `Dispatch protocol: ${summary.dispatchProtocolVersion ?? summary.task?.dispatchProtocolVersion ?? "unknown"}`,
    `Dispatch transport: ${summary.dispatchTransportStatus ?? summary.task?.dispatchTransportStatus ?? "unknown"}`,
    `Dispatch retry count: ${summary.dispatchRetryCount ?? summary.task?.dispatchRetryCount ?? "unknown"}`,
    `Dispatch last attempt: ${summary.dispatchLastAttemptAt ?? summary.task?.dispatchLastAttemptAt ?? "unknown"}`,
    `Dispatch timeout: ${summary.dispatchTimeoutMs ?? summary.task?.dispatchTimeoutMs ?? "unknown"}`,
    `Dispatch auth: ${summary.dispatchAuthSummary ?? summary.task?.dispatchAuthSummary ?? "unknown"}`,
    `Dispatch summary: ${summary.dispatchStatusSummary ?? summary.task?.dispatchStatusSummary ?? "No dispatch summary recorded."}`,
    `Queue summary: ${summary.queueStateSummary ?? "No queue summary recorded."}`,
    `Session status: ${summary.session?.status ?? "no session"}`,
    `Reason: ${summary.failureReason ?? summary.task?.failureReason ?? summary.task?.statusReason ?? summary.session?.completedReason ?? summary.session?.stateReason ?? "No status reason recorded."}`,
  ].join("\n");
}

export async function formatLocalNodeTaskList(options?: { json?: boolean }): Promise<string> {
  const tasks = await listTasks();

  if (options?.json) {
    return JSON.stringify({ tasks }, null, 2);
  }

  if (!tasks.length) {
    return "No persisted autonomous tasks found.";
  }

  return tasks
    .slice(0, 20)
    .map((task) => `${task.taskId} | ${task.status} | ${task.selectedNodeId ?? task.assignedNodeId ?? "unassigned"} | lease=${task.lease?.ownerNodeId ?? "none"}:${task.lease?.status ?? "none"} | resumability=${task.resumability} | recovery=${task.recoveryPending} | transport=${task.dispatchTransportStatus ?? "none"} | retries=${task.dispatchRetryCount ?? 0} | failure=${task.failureReason ?? "none"} | ${task.sessionId}`)
    .join("\n");
}

export function formatLocalNodeList(options?: { json?: boolean }): string {
  const nodes = listExecutionNodes();

  if (options?.json) {
    return JSON.stringify({
      nodes: nodes.map((node) => ({
        ...node,
        eligibility: getExecutionNodeEligibility(node),
      })),
    }, null, 2);
  }

  if (!nodes.length) {
    return "No registered execution nodes found.";
  }

  return nodes
    .map((node) => {
      const eligibility = getExecutionNodeEligibility(node);
      return `${node.id} | ${node.mode} | status=${node.status} | busy=${node.busy} | task=${node.activeTaskId ?? "none"} | heartbeat=${node.lastHeartbeatAt ?? "none"} | eligible=${eligibility.eligible} | ${eligibility.reason}`;
    })
    .join("\n");
}

export async function runLocalNode(
  options: LocalNodeOptions,
  dependencies?: Partial<LocalNodeDependencies>,
): Promise<AutonomousSession> {
  const existingSession = options.sessionId ? await loadAutonomousSession(options.sessionId) : null;
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await resolveRepoRoot(cwd);
  registerExecutionNode(createRuntimeExecutionNodeDescriptor({
    runtimeMode: "local",
    cwd,
    allowedRoots: options.allowedRoots,
  }));

  return runAutonomousSession({
    goal: options.goal || existingSession?.goal || "Confirm the local execution node can complete a bounded task.",
    maxSteps: options.maxSteps,
    approved: options.approved,
    existingSession: existingSession ?? undefined,
    executionContext: {
      cwd,
      repoRoot,
      allowedRoots: options.allowedRoots,
      allowedDirectories: options.allowedRoots,
      runtimeMode: "local",
    },
    dependencies,
  });
}

export async function runLocalNodeQueuedTask(
  options: LocalNodeOptions,
  dependencies?: Partial<LocalNodeDependencies>,
): Promise<QueueExecutionSummary> {
  return (dependencies?.runSingleQueuedTask ?? runSingleQueuedTask)({
    taskId: options.runTask ? options.taskId : undefined,
    runtimeMode: "local",
    cwd: options.cwd ?? process.cwd(),
    allowedRoots: options.allowedRoots,
    maxSteps: options.maxSteps ?? 1,
  });
}

async function main() {
  const options = parseLocalNodeArgs(process.argv.slice(2));

  if (options.listSessions) {
    process.stdout.write(`${await formatLocalNodeSessionList({ json: options.json })}\n`);
    return;
  }

  if (options.listTasks) {
    process.stdout.write(`${await formatLocalNodeTaskList({ json: options.json })}\n`);
    return;
  }

  if (options.listNodes) {
    process.stdout.write(`${formatLocalNodeList({ json: options.json })}\n`);
    return;
  }

  if (options.taskId) {
    if (options.runTask) {
      const summary = await runLocalNodeQueuedTask(options);
      process.stdout.write(`${formatLocalNodeQueueRunOutput(summary, { json: options.json })}\n`);
      return;
    }

    const task = await getTask(options.taskId);
    if (!task) {
      console.error("Autonomous task not found.");
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`${formatLocalNodeTaskOutput(task, { json: options.json })}\n`);
    return;
  }

  if (options.runNextTask) {
    const summary = await runLocalNodeQueuedTask(options);
    process.stdout.write(`${formatLocalNodeQueueRunOutput(summary, { json: options.json })}\n`);
    return;
  }

  if (!options.goal && !options.sessionId) {
    console.error("A goal or existing sessionId is required.");
    process.exitCode = 1;
    return;
  }

  const session = await runLocalNode(options);
  process.stdout.write(`${formatLocalNodeSessionOutput(session, { json: options.json, verbose: options.verbose })}\n`);
}

if (process.argv[1]?.endsWith("local_node.ts")) {
  void main();
}