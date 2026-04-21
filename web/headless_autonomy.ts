import { loadAutonomousSession } from "./lib/aie/autonomousSessionStore";
import { runSingleQueuedTask, type QueueExecutionSummary } from "./lib/aie/queueOrchestrator";
import { createRuntimeExecutionNodeDescriptor } from "./lib/aie/executionNode";
import { registerExecutionNode } from "./lib/aie/executionNodeRegistry";
import { resolveRepoRoot } from "./lib/aie/repoContext";
import { runAutonomousSession } from "./lib/aie/runAutonomousSession";
import type { AutonomousSession } from "./lib/aie/autonomousSession";
import type { TaskEnvelope } from "./lib/aie/taskEnvelope";
import { getTask, listTasks } from "./lib/aie/taskQueueStore";
import type { runAnalysis } from "./lib/aie/run-analysis";
import type { saveAutonomousSession } from "./lib/aie/autonomousSessionStore";
import type { executeAction } from "./lib/aie/executionRuntime";

type HeadlessAutonomyOptions = {
  goal: string;
  maxSteps?: number;
  sessionId?: string;
  approved?: boolean;
  allowedRoots?: string[];
  cwd?: string;
  verbose?: boolean;
  json?: boolean;
  listTasks?: boolean;
  runNextTask?: boolean;
  runTask?: boolean;
  taskId?: string;
};

type HeadlessAutonomyDependencies = {
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

export function parseArgs(argv: string[]): HeadlessAutonomyOptions {
  const options: HeadlessAutonomyOptions = {
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
      case "--listTasks":
        options.listTasks = true;
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

export function formatHeadlessSessionSummary(session: AutonomousSession): string {
  const lastStep = session.steps.at(-1);

  return JSON.stringify(
    {
      ok: session.status !== "failed" && session.status !== "blocked",
      sessionId: session.sessionId,
      status: session.status,
      steps: session.steps.length,
      adapter: session.executionAdapterId ?? null,
      adapterContextSummary: session.adapterContextSummary ?? null,
      executionNodeId: session.executionNodeId ?? null,
      executionNodeMode: session.executionNodeMode ?? null,
      nodeCapabilitySummary: session.nodeCapabilitySummary ?? null,
      taskId: session.taskId ?? null,
      taskStatus: session.taskStatus ?? null,
      assignedNodeId: session.assignedNodeId ?? null,
      queueStateSummary: session.queueStateSummary ?? null,
      dispatchMessageId: session.dispatchMessageId ?? null,
      dispatchTargetNodeId: session.dispatchTargetNodeId ?? null,
      dispatchProtocolVersion: session.dispatchProtocolVersion ?? null,
      dispatchStatusSummary: session.dispatchStatusSummary ?? null,
      remoteDispatchPlanned: session.remoteDispatchPlanned ?? null,
      planningHintSummary: session.planningHintSummary ?? null,
      lastActionFamily: lastStep?.actionFamily ?? null,
      completionStatus: session.latestCompletion?.status ?? null,
      completedReason: session.completedReason ?? session.stateReason ?? null,
      pendingAction: session.pendingAction?.description ?? null,
    },
    null,
    2,
  );
}

export function formatHeadlessStepSummaries(session: AutonomousSession): string {
  if (!session.steps.length) {
    return "No autonomous steps were recorded.";
  }

  return session.steps.map((step) => {
    const summaryParts = [
      `Step ${step.index}`,
      `lane=${step.actionFamily ?? "unknown"}`,
      `adapter=${step.executionAdapterId ?? "unknown"}`,
      `node=${step.executionNodeId ?? "unknown"}`,
      `task=${step.taskId ?? "unknown"}`,
      `taskStatus=${step.taskStatus ?? "unknown"}`,
      `goal=${step.goalStatus ?? "unknown"}`,
      `decision=${step.nextDecision ?? "unknown"}`,
      `runtime=${step.executionResult?.status ?? "unknown"}`,
    ];
    const detailParts = [
      step.proposedAction ? `action=${step.proposedAction}` : "",
      step.adapterContextSummary ? `adapterContext=${step.adapterContextSummary}` : "",
      step.nodeCapabilitySummary ? `nodeCaps=${step.nodeCapabilitySummary}` : "",
      step.assignedNodeId ? `assignedNode=${step.assignedNodeId}` : "",
      step.queueStateSummary ? `queue=${step.queueStateSummary}` : "",
      step.dispatchStatusSummary ? `dispatch=${step.dispatchStatusSummary}` : "",
      step.planningHintSummary ? `planning=${step.planningHintSummary}` : "",
      step.diagnosis ? `diagnosis=${step.diagnosis}` : "",
    ].filter(Boolean);
    return [summaryParts.join(" | "), detailParts.join(" | ")].filter(Boolean).join("\n");
  }).join("\n\n");
}

export function formatHeadlessSessionReport(session: AutonomousSession, options?: { json?: boolean; verbose?: boolean }): string {
  if (options?.json) {
    return JSON.stringify(
      {
        sessionId: session.sessionId,
        status: session.status,
        goal: session.goal,
        adapter: session.executionAdapterId ?? null,
        adapterContextSummary: session.adapterContextSummary ?? null,
        executionNodeId: session.executionNodeId ?? null,
        executionNodeMode: session.executionNodeMode ?? null,
        nodeCapabilitySummary: session.nodeCapabilitySummary ?? null,
        taskId: session.taskId ?? null,
        taskStatus: session.taskStatus ?? null,
        assignedNodeId: session.assignedNodeId ?? null,
        queueStateSummary: session.queueStateSummary ?? null,
        dispatchMessageId: session.dispatchMessageId ?? null,
        dispatchTargetNodeId: session.dispatchTargetNodeId ?? null,
        dispatchProtocolVersion: session.dispatchProtocolVersion ?? null,
        dispatchStatusSummary: session.dispatchStatusSummary ?? null,
        remoteDispatchPlanned: session.remoteDispatchPlanned ?? null,
        planningHintSummary: session.planningHintSummary ?? null,
        completion: session.latestCompletion ?? null,
        completedReason: session.completedReason ?? session.stateReason ?? null,
        steps: options.verbose ? session.steps : session.steps.map((step) => ({
          index: step.index,
          actionFamily: step.actionFamily ?? null,
          executionAdapterId: step.executionAdapterId ?? null,
          executionNodeId: step.executionNodeId ?? null,
          executionNodeMode: step.executionNodeMode ?? null,
          nodeCapabilitySummary: step.nodeCapabilitySummary ?? null,
          taskId: step.taskId ?? null,
          taskStatus: step.taskStatus ?? null,
          assignedNodeId: step.assignedNodeId ?? null,
          queueStateSummary: step.queueStateSummary ?? null,
          dispatchMessageId: step.dispatchMessageId ?? null,
          dispatchTargetNodeId: step.dispatchTargetNodeId ?? null,
          dispatchProtocolVersion: step.dispatchProtocolVersion ?? null,
          dispatchStatusSummary: step.dispatchStatusSummary ?? null,
          remoteDispatchPlanned: step.remoteDispatchPlanned ?? null,
          goalStatus: step.goalStatus ?? null,
          nextDecision: step.nextDecision ?? null,
          runtimeStatus: step.executionResult?.status ?? null,
        })),
      },
      null,
      2,
    );
  }

  const lines = [
    `Session ID: ${session.sessionId}`,
    `Status: ${session.status}`,
    `Goal: ${session.goal}`,
    `Latest adapter: ${session.executionAdapterId ?? "unknown"}`,
    `Execution node: ${session.executionNodeId ?? "unknown"} (${session.executionNodeMode ?? "unknown"})`,
    `Node capabilities: ${session.nodeCapabilitySummary ?? "No node capabilities recorded."}`,
    `Latest task: ${session.taskId ?? "No task recorded."}`,
    `Task status: ${session.taskStatus ?? "No task status recorded."}`,
    `Assigned node: ${session.assignedNodeId ?? "No node assignment recorded."}`,
    `Queue summary: ${session.queueStateSummary ?? "No queue summary recorded."}`,
    `Dispatch summary: ${session.dispatchStatusSummary ?? "No dispatch summary recorded."}`,
    `Adapter context: ${session.adapterContextSummary ?? "No adapter context recorded."}`,
    `Planning hints: ${session.planningHintSummary ?? "No planning hints recorded."}`,
    `Completion: ${session.latestCompletion ? `${session.latestCompletion.status} (${session.latestCompletion.confidence})` : "No completion state recorded."}`,
    `Reason: ${session.completedReason ?? session.stateReason ?? "No stop reason recorded."}`,
  ];

  if (options?.verbose) {
    lines.push("", "Step summary:", formatHeadlessStepSummaries(session));
  }

  return lines.join("\n");
}

export function formatHeadlessTaskReport(task: TaskEnvelope, options?: { json?: boolean }): string {
  if (options?.json) {
    return JSON.stringify(task, null, 2);
  }

  return [
    `Task ID: ${task.taskId}`,
    `Session ID: ${task.sessionId}`,
    `Step: ${task.stepIndex}`,
    `Status: ${task.status}`,
    `Assigned node: ${task.assignedNodeId ?? "unassigned"}`,
    `Runner mode: ${task.runnerMode ?? "unknown"}`,
    `Claim token: ${task.claimToken ?? "none"}`,
    `Dispatch message: ${task.dispatchMessageId ?? "none"}`,
    `Dispatch target: ${task.dispatchTargetNodeId ?? "none"}`,
    `Dispatch protocol: ${task.dispatchProtocolVersion ?? "none"}`,
    `Dispatch summary: ${task.dispatchStatusSummary ?? "No dispatch summary recorded."}`,
    `Capabilities: ${task.requestedCapabilities.join(",") || "none"}`,
    `Reason: ${task.statusReason ?? "No status reason recorded."}`,
    `Claimed: ${task.claimedAt ?? "not claimed"}`,
    `Started: ${task.startedAt ?? "not started"}`,
    `Completed: ${task.completedAt ?? "not completed"}`,
    `Failed: ${task.failedAt ?? "not failed"}`,
    `Blocked: ${task.blockedAt ?? "not blocked"}`,
  ].join("\n");
}

export function formatHeadlessQueueRunReport(summary: QueueExecutionSummary, options?: { json?: boolean }): string {
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
    `Assigned node: ${summary.nodeId ?? summary.task?.assignedNodeId ?? "unknown"}`,
    `Runner mode: ${summary.runnerMode ?? summary.task?.runnerMode ?? "unknown"}`,
    `Claim token: ${summary.claimToken ?? summary.task?.claimToken ?? "unknown"}`,
    `Dispatch message: ${summary.dispatchMessageId ?? summary.task?.dispatchMessageId ?? "unknown"}`,
    `Dispatch target: ${summary.dispatchTargetNodeId ?? summary.task?.dispatchTargetNodeId ?? "unknown"}`,
    `Dispatch protocol: ${summary.dispatchProtocolVersion ?? summary.task?.dispatchProtocolVersion ?? "unknown"}`,
    `Dispatch summary: ${summary.dispatchStatusSummary ?? summary.task?.dispatchStatusSummary ?? "No dispatch summary recorded."}`,
    `Queue summary: ${summary.queueStateSummary ?? "No queue summary recorded."}`,
    `Session status: ${summary.session?.status ?? "no session"}`,
    `Reason: ${summary.task?.statusReason ?? summary.session?.completedReason ?? summary.session?.stateReason ?? "No status reason recorded."}`,
  ].join("\n");
}

export async function formatHeadlessTaskList(options?: { json?: boolean }): Promise<string> {
  const tasks = await listTasks();

  if (options?.json) {
    return JSON.stringify({ tasks }, null, 2);
  }

  if (!tasks.length) {
    return "No persisted autonomous tasks found.";
  }

  return tasks
    .slice(0, 20)
    .map((task) => `${task.taskId} | ${task.status} | ${task.assignedNodeId ?? "unassigned"} | ${task.sessionId}`)
    .join("\n");
}

export async function runHeadlessAutonomy(
  options: HeadlessAutonomyOptions,
  dependencies?: Partial<HeadlessAutonomyDependencies>,
): Promise<AutonomousSession> {
  const existingSession = options.sessionId ? await loadAutonomousSession(options.sessionId) : null;
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await resolveRepoRoot(cwd);
  registerExecutionNode(createRuntimeExecutionNodeDescriptor({
    runtimeMode: "headless",
    cwd,
    allowedRoots: options.allowedRoots,
  }));

  return runAutonomousSession({
    goal: options.goal || existingSession?.goal || "Confirm the bounded autonomous path reaches a healthy result.",
    maxSteps: options.maxSteps,
    approved: options.approved,
    existingSession: existingSession ?? undefined,
    executionContext: {
      cwd,
      repoRoot,
      allowedRoots: options.allowedRoots,
      runtimeMode: "headless",
    },
    dependencies,
  });
}

export async function runHeadlessQueuedTask(
  options: HeadlessAutonomyOptions,
  dependencies?: Partial<HeadlessAutonomyDependencies>,
): Promise<QueueExecutionSummary> {
  return (dependencies?.runSingleQueuedTask ?? runSingleQueuedTask)({
    taskId: options.runTask ? options.taskId : undefined,
    runtimeMode: "headless",
    cwd: options.cwd ?? process.cwd(),
    allowedRoots: options.allowedRoots,
    maxSteps: options.maxSteps ?? 1,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.listTasks) {
    process.stdout.write(`${await formatHeadlessTaskList({ json: options.json })}\n`);
    return;
  }

  if (options.taskId) {
    if (options.runTask) {
      const summary = await runHeadlessQueuedTask(options);
      process.stdout.write(`${formatHeadlessQueueRunReport(summary, { json: options.json })}\n`);
      return;
    }

    const task = await getTask(options.taskId);
    if (!task) {
      console.error("Autonomous task not found.");
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`${formatHeadlessTaskReport(task, { json: options.json })}\n`);
    return;
  }

  if (options.runNextTask) {
    const summary = await runHeadlessQueuedTask(options);
    process.stdout.write(`${formatHeadlessQueueRunReport(summary, { json: options.json })}\n`);
    return;
  }

  if (!options.goal && !options.sessionId) {
    console.error("A goal or existing sessionId is required.");
    process.exitCode = 1;
    return;
  }

  const session = await runHeadlessAutonomy(options);
  process.stdout.write(`${formatHeadlessSessionReport(session, { json: options.json, verbose: options.verbose })}\n`);
}

if (process.argv[1]?.endsWith("headless_autonomy.ts")) {
  void main();
}