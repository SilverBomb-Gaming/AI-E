import { getExecutionNodeCapabilitiesForAction, type ExecutionNodeCapability } from "./executionNode";
import type { ExecutionActionPreview } from "./types";

export type TaskEnvelopeStatus = "pending" | "assigned" | "running" | "completed" | "failed" | "blocked";

export type TaskEnvelope = {
  taskId: string;
  sessionId: string;
  stepIndex: number;
  action: ExecutionActionPreview;
  requestedCapabilities: ExecutionNodeCapability[];
  preferredNodeId?: string;
  assignedNodeId?: string;
  status: TaskEnvelopeStatus;
  createdAt: string;
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
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function assignTaskEnvelope(
  envelope: TaskEnvelope,
  assignedNodeId: string,
  status: TaskEnvelopeStatus = "assigned",
): TaskEnvelope {
  return {
    ...envelope,
    assignedNodeId: normalizeText(assignedNodeId) || envelope.assignedNodeId,
    status,
    updatedAt: createTimestamp(),
  };
}

export function updateTaskEnvelopeStatus(envelope: TaskEnvelope, status: TaskEnvelopeStatus): TaskEnvelope {
  return {
    ...envelope,
    status,
    updatedAt: createTimestamp(),
  };
}

export function summarizeTaskEnvelope(envelope: TaskEnvelope): string {
  return [
    `task=${envelope.taskId}`,
    `status=${envelope.status}`,
    `step=${envelope.stepIndex}`,
    envelope.assignedNodeId ? `node=${envelope.assignedNodeId}` : "node=unassigned",
    envelope.requestedCapabilities.length ? `caps=${envelope.requestedCapabilities.join(",")}` : "caps=none",
  ].join(" | ");
}