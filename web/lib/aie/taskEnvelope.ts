import { getExecutionNodeCapabilitiesForAction, type ExecutionNodeCapability } from "./executionNode";
import type { ExecutionActionPreview } from "./types";

export type TaskEnvelopeStatus = "pending" | "assigned" | "running" | "completed" | "failed" | "blocked";

export type TaskEnvelopeTransitionMetadata = {
  assignedNodeId?: string;
  statusReason?: string;
};

export type TaskEnvelope = {
  taskId: string;
  sessionId: string;
  stepIndex: number;
  action: ExecutionActionPreview;
  requestedCapabilities: ExecutionNodeCapability[];
  preferredNodeId?: string;
  assignedNodeId?: string;
  status: TaskEnvelopeStatus;
  statusReason?: string;
  createdAt: string;
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};

type CreateTaskEnvelopeParams = {
  taskId?: string;
  sessionId: string;
  stepIndex: number;
  action: ExecutionActionPreview;
  requestedCapabilities?: ExecutionNodeCapability[];
  preferredNodeId?: string;
  status?: TaskEnvelopeStatus;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function createTimestamp(): string {
  return new Date().toISOString();
}

function createTaskId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `aie-task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTaskEnvelopeStatus(value: unknown): TaskEnvelopeStatus | undefined {
  if (
    value === "pending" ||
    value === "assigned" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "blocked"
  ) {
    return value;
  }

  return undefined;
}

function applyTaskTransition(
  envelope: TaskEnvelope,
  status: TaskEnvelopeStatus,
  metadata?: TaskEnvelopeTransitionMetadata,
): TaskEnvelope {
  const timestamp = createTimestamp();
  const assignedNodeId = normalizeText(metadata?.assignedNodeId) || envelope.assignedNodeId;
  const statusReason = normalizeText(metadata?.statusReason) || undefined;

  return {
    ...envelope,
    assignedNodeId: assignedNodeId || undefined,
    status,
    statusReason,
    assignedAt: status === "assigned" && !envelope.assignedAt ? timestamp : envelope.assignedAt,
    startedAt: status === "running" && !envelope.startedAt ? timestamp : envelope.startedAt,
    completedAt:
      (status === "completed" || status === "failed" || status === "blocked") && !envelope.completedAt
        ? timestamp
        : envelope.completedAt,
    updatedAt: timestamp,
  };
}

export function createTaskEnvelope(params: CreateTaskEnvelopeParams): TaskEnvelope {
  const timestamp = createTimestamp();

  return {
    taskId: normalizeText(params.taskId) || createTaskId(),
    sessionId: normalizeText(params.sessionId),
    stepIndex: Math.max(1, Math.floor(params.stepIndex)),
    action: params.action,
    requestedCapabilities: params.requestedCapabilities?.length
      ? [...params.requestedCapabilities]
      : getExecutionNodeCapabilitiesForAction(params.action),
    preferredNodeId: normalizeText(params.preferredNodeId) || undefined,
    assignedNodeId: undefined,
    status: params.status ?? "pending",
    statusReason: undefined,
    createdAt: timestamp,
    assignedAt: undefined,
    startedAt: undefined,
    completedAt: undefined,
    updatedAt: timestamp,
  };
}

export function assignTaskEnvelope(
  envelope: TaskEnvelope,
  assignedNodeId: string,
  status: TaskEnvelopeStatus = "assigned",
): TaskEnvelope {
  return applyTaskTransition(envelope, status, {
    assignedNodeId,
  });
}

export function markTaskAssigned(
  envelope: TaskEnvelope,
  assignedNodeId: string,
  metadata?: Omit<TaskEnvelopeTransitionMetadata, "assignedNodeId">,
): TaskEnvelope {
  return applyTaskTransition(envelope, "assigned", {
    ...metadata,
    assignedNodeId,
  });
}

export function markTaskRunning(envelope: TaskEnvelope, metadata?: TaskEnvelopeTransitionMetadata): TaskEnvelope {
  return applyTaskTransition(envelope, "running", metadata);
}

export function markTaskCompleted(envelope: TaskEnvelope, metadata?: TaskEnvelopeTransitionMetadata): TaskEnvelope {
  return applyTaskTransition(envelope, "completed", metadata);
}

export function markTaskFailed(envelope: TaskEnvelope, metadata?: TaskEnvelopeTransitionMetadata): TaskEnvelope {
  return applyTaskTransition(envelope, "failed", metadata);
}

export function markTaskBlocked(envelope: TaskEnvelope, metadata?: TaskEnvelopeTransitionMetadata): TaskEnvelope {
  return applyTaskTransition(envelope, "blocked", metadata);
}

export function updateTaskEnvelopeStatus(
  envelope: TaskEnvelope,
  status: TaskEnvelopeStatus,
  metadata?: TaskEnvelopeTransitionMetadata,
): TaskEnvelope {
  return applyTaskTransition(envelope, status, metadata);
}

export function normalizeTaskEnvelope(value: unknown): TaskEnvelope | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const taskId = normalizeText(typeof source.taskId === "string" ? source.taskId : "");
  const sessionId = normalizeText(typeof source.sessionId === "string" ? source.sessionId : "");
  const stepIndex = Number(source.stepIndex ?? 0);
  const status = normalizeTaskEnvelopeStatus(source.status);

  if (!taskId || !sessionId || !Number.isInteger(stepIndex) || stepIndex <= 0 || !status) {
    return null;
  }

  const action = source.action;
  if (!action || typeof action !== "object") {
    return null;
  }

  const requestedCapabilities = Array.isArray(source.requestedCapabilities)
    ? source.requestedCapabilities.filter((item): item is ExecutionNodeCapability =>
        item === "inspection" ||
        item === "validation-check" ||
        item === "file-write" ||
        item === "test-run" ||
        item === "repo-scan",
      )
    : [];

  const createdAt = normalizeText(typeof source.createdAt === "string" ? source.createdAt : "");
  const updatedAt = normalizeText(typeof source.updatedAt === "string" ? source.updatedAt : "");
  if (!createdAt || !updatedAt) {
    return null;
  }

  return {
    taskId,
    sessionId,
    stepIndex,
    action: action as ExecutionActionPreview,
    requestedCapabilities,
    preferredNodeId: normalizeText(typeof source.preferredNodeId === "string" ? source.preferredNodeId : "") || undefined,
    assignedNodeId: normalizeText(typeof source.assignedNodeId === "string" ? source.assignedNodeId : "") || undefined,
    status,
    statusReason: normalizeText(typeof source.statusReason === "string" ? source.statusReason : "") || undefined,
    createdAt,
    assignedAt: normalizeText(typeof source.assignedAt === "string" ? source.assignedAt : "") || undefined,
    startedAt: normalizeText(typeof source.startedAt === "string" ? source.startedAt : "") || undefined,
    completedAt: normalizeText(typeof source.completedAt === "string" ? source.completedAt : "") || undefined,
    updatedAt,
  };
}

export function summarizeTaskEnvelope(envelope: TaskEnvelope): string {
  return [
    `task=${envelope.taskId}`,
    `status=${envelope.status}`,
    `step=${envelope.stepIndex}`,
    envelope.assignedNodeId ? `node=${envelope.assignedNodeId}` : "node=unassigned",
    envelope.requestedCapabilities.length ? `caps=${envelope.requestedCapabilities.join(",")}` : "caps=none",
    envelope.statusReason ? `reason=${envelope.statusReason}` : "",
  ].join(" | ");
}