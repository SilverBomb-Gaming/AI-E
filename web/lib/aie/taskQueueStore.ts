import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  claimTaskEnvelope,
  markTaskAssigned,
  markTaskBlocked,
  markTaskCompleted,
  markTaskFailed,
  markTaskRejected,
  markTaskRunning,
  normalizeTaskEnvelope,
  releaseTaskEnvelope,
  updateTaskEnvelopeStatus,
  type TaskEnvelope,
  type TaskEnvelopeStatus,
  type TaskEnvelopeTransitionMetadata,
} from "./taskEnvelope";
import type { ExecutionNodeMode } from "./executionNode";

function getTaskQueueStoreDirectory(): string {
  const configuredDirectory = process.env.AIE_TASK_QUEUE_DIR?.trim();
  if (configuredDirectory) {
    return configuredDirectory;
  }

  return path.resolve(process.cwd(), "..", "runner_artifacts", "autonomous_tasks");
}

async function ensureTaskQueueStoreDirectory(): Promise<string> {
  const directory = getTaskQueueStoreDirectory();
  await mkdir(directory, { recursive: true });
  return directory;
}

function getTaskFilePath(taskId: string): string {
  return path.join(getTaskQueueStoreDirectory(), `${taskId}.json`);
}

async function writeTask(task: TaskEnvelope): Promise<TaskEnvelope> {
  const normalized = normalizeTaskEnvelope(task);
  if (!normalized) {
    throw new Error("The task envelope is not serializable.");
  }

  await ensureTaskQueueStoreDirectory();
  await writeFile(getTaskFilePath(normalized.taskId), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export async function enqueueTask(task: TaskEnvelope): Promise<TaskEnvelope> {
  return writeTask(task);
}

export async function getTask(taskId: string): Promise<TaskEnvelope | null> {
  try {
    const raw = await readFile(getTaskFilePath(taskId), "utf8");
    return normalizeTaskEnvelope(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listTasks(): Promise<TaskEnvelope[]> {
  const directory = await ensureTaskQueueStoreDirectory();
  const entries = await readdir(directory, { withFileTypes: true });
  const tasks = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        try {
          const raw = await readFile(path.join(directory, entry.name), "utf8");
          return normalizeTaskEnvelope(JSON.parse(raw));
        } catch {
          return null;
        }
      }),
  );

  return tasks
    .filter((task): task is TaskEnvelope => task !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function listTasksByStatus(status: TaskEnvelopeStatus): Promise<TaskEnvelope[]> {
  const tasks = await listTasks();
  return tasks.filter((task) => task.status === status);
}

export async function getRunnableTasks(options?: { includeApprovalBlocked?: boolean }): Promise<TaskEnvelope[]> {
  const tasks = await listTasks();
  return tasks
    .filter((task) => task.status === "pending" || task.status === "queued" || task.status === "retrying")
    .filter((task) => options?.includeApprovalBlocked === true || task.action.scope === "safe")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.taskId.localeCompare(right.taskId));
}

export async function claimTask(
  taskId: string,
  claimToken: string,
  runnerMode: ExecutionNodeMode,
  nodeId: string,
  statusReason = "Claimed for controlled queue execution.",
): Promise<TaskEnvelope | null> {
  const existingTask = await getTask(taskId);
  if (!existingTask || (existingTask.status !== "pending" && existingTask.status !== "queued" && existingTask.status !== "retrying")) {
    return null;
  }

  return writeTask(claimTaskEnvelope(existingTask, {
    assignedNodeId: nodeId,
    selectedNodeReason: statusReason,
    claimToken,
    runnerMode,
    statusReason,
  }));
}

export async function releaseClaimedTask(taskId: string, statusReason?: string): Promise<TaskEnvelope | null> {
  const existingTask = await getTask(taskId);
  if (!existingTask || existingTask.status !== "assigned") {
    return null;
  }

  return writeTask(releaseTaskEnvelope(existingTask, statusReason));
}

export async function finalizeTask(
  taskId: string,
  status: Extract<TaskEnvelopeStatus, "completed" | "failed" | "blocked" | "rejected">,
  extra?: TaskEnvelopeTransitionMetadata,
): Promise<TaskEnvelope | null> {
  const existingTask = await getTask(taskId);
  if (!existingTask) {
    return null;
  }

  switch (status) {
    case "completed":
      return writeTask(markTaskCompleted(existingTask, extra));
    case "failed":
      return writeTask(markTaskFailed(existingTask, extra));
    case "rejected":
      return writeTask(markTaskRejected(existingTask, extra));
    case "blocked":
      return writeTask(markTaskBlocked(existingTask, extra));
  }
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskEnvelopeStatus,
  extra?: TaskEnvelopeTransitionMetadata,
): Promise<TaskEnvelope | null> {
  const existingTask = await getTask(taskId);
  if (!existingTask) {
    return null;
  }

  if (status === "running" || status === "executing") {
    return writeTask(markTaskRunning(existingTask, extra));
  }

  if (status === "completed" || status === "failed" || status === "blocked" || status === "rejected") {
    return finalizeTask(taskId, status, extra);
  }

  return writeTask(updateTaskEnvelopeStatus(existingTask, status, extra));
}

export async function updateTaskDispatchMetadata(
  taskId: string,
  metadata: TaskEnvelopeTransitionMetadata,
): Promise<TaskEnvelope | null> {
  const existingTask = await getTask(taskId);
  if (!existingTask) {
    return null;
  }

  return writeTask(updateTaskEnvelopeStatus(existingTask, existingTask.status, metadata));
}

export async function assignTaskToNode(taskId: string, nodeId: string): Promise<TaskEnvelope | null> {
  const existingTask = await getTask(taskId);
  if (!existingTask || (existingTask.status !== "pending" && existingTask.status !== "queued" && existingTask.status !== "retrying")) {
    return null;
  }

  return writeTask(markTaskAssigned(existingTask, nodeId, {
    selectedNodeId: nodeId,
  }));
}

export async function removeTask(taskId: string): Promise<void> {
  await rm(getTaskFilePath(taskId), { force: true });
}

export { getTaskQueueStoreDirectory };