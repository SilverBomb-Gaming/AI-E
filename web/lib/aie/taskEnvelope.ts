import { getExecutionNodeCapabilitiesForAction, type ExecutionNodeCapability } from "./executionNode";
import type { ExecutionNodeMode } from "./executionNode";
import type { ExecutionActionPreview } from "./types";

export type TaskEnvelopeStatus = "pending" | "assigned" | "running" | "completed" | "failed" | "blocked";

export type TaskDispatchTransportStatus = "pending" | "accepted" | "rejected" | "delivered" | "failed" | "completed";

export type TaskEnvelopeTransitionMetadata = {
  assignedNodeId?: string;
  statusReason?: string;
  claimToken?: string;
  runnerMode?: ExecutionNodeMode;
  dispatchMessageId?: string;
  dispatchAckMessageId?: string;
  dispatchResultMessageId?: string;
  dispatchTargetNodeId?: string;
  dispatchProtocolVersion?: "1";
  dispatchStatusSummary?: string;
  dispatchAuthSummary?: string;
  dispatchTransportStatus?: TaskDispatchTransportStatus;
  remoteDispatchPlanned?: boolean;
  dispatchReceivedAt?: string;
  dispatchCompletedAt?: string;
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
  claimToken?: string;
  runnerMode?: ExecutionNodeMode;
  dispatchMessageId?: string;
  dispatchAckMessageId?: string;
  dispatchResultMessageId?: string;
  dispatchTargetNodeId?: string;
  dispatchProtocolVersion?: "1";
  dispatchStatusSummary?: string;
  dispatchAuthSummary?: string;
  dispatchTransportStatus?: TaskDispatchTransportStatus;
  remoteDispatchPlanned?: boolean;
  createdAt: string;
  claimedAt?: string;
  assignedAt?: string;
  startedAt?: string;
  dispatchReceivedAt?: string;
  dispatchCompletedAt?: string;
  completedAt?: string;
  failedAt?: string;
  blockedAt?: string;
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

function normalizeExecutionNodeMode(value: unknown): ExecutionNodeMode | undefined {
  if (value === "web" || value === "headless" || value === "local-node") {
    return value;
  }

  return undefined;
}

function normalizeDispatchTransportStatus(value: unknown): TaskDispatchTransportStatus | undefined {
  if (
    value === "pending" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "delivered" ||
    value === "failed" ||
    value === "completed"
  ) {
    return value;
  }

  return undefined;
}

function assertTaskTransitionAllowed(envelope: TaskEnvelope, nextStatus: TaskEnvelopeStatus): void {
  const allowedTransitions: Record<TaskEnvelopeStatus, TaskEnvelopeStatus[]> = {
    pending: ["assigned", "blocked"],
    assigned: ["pending", "running", "blocked", "failed", "completed"],
    running: ["completed", "failed", "blocked"],
    completed: [],
    failed: [],
    blocked: [],
  };

  if (envelope.status === nextStatus) {
    return;
  }

  if (!allowedTransitions[envelope.status].includes(nextStatus)) {
    throw new Error(`Task ${envelope.taskId} cannot transition from ${envelope.status} to ${nextStatus}.`);
  }
}

function applyTaskTransition(
  envelope: TaskEnvelope,
  status: TaskEnvelopeStatus,
  metadata?: TaskEnvelopeTransitionMetadata,
): TaskEnvelope {
  assertTaskTransitionAllowed(envelope, status);
  const timestamp = createTimestamp();
  const assignedNodeId = normalizeText(metadata?.assignedNodeId) || envelope.assignedNodeId;
  const statusReason = normalizeText(metadata?.statusReason) || undefined;
  const claimToken = normalizeText(metadata?.claimToken) || envelope.claimToken;
  const runnerMode = metadata?.runnerMode ?? envelope.runnerMode;
  const dispatchMessageId = normalizeText(metadata?.dispatchMessageId) || envelope.dispatchMessageId;
  const dispatchAckMessageId = normalizeText(metadata?.dispatchAckMessageId) || envelope.dispatchAckMessageId;
  const dispatchResultMessageId = normalizeText(metadata?.dispatchResultMessageId) || envelope.dispatchResultMessageId;
  const dispatchTargetNodeId = normalizeText(metadata?.dispatchTargetNodeId) || envelope.dispatchTargetNodeId;
  const dispatchProtocolVersion = metadata?.dispatchProtocolVersion ?? envelope.dispatchProtocolVersion;
  const dispatchStatusSummary = normalizeText(metadata?.dispatchStatusSummary) || envelope.dispatchStatusSummary;
  const dispatchAuthSummary = normalizeText(metadata?.dispatchAuthSummary) || envelope.dispatchAuthSummary;
  const dispatchTransportStatus = metadata?.dispatchTransportStatus ?? envelope.dispatchTransportStatus;
  const remoteDispatchPlanned = typeof metadata?.remoteDispatchPlanned === "boolean"
    ? metadata.remoteDispatchPlanned
    : envelope.remoteDispatchPlanned;
  const dispatchReceivedAt = normalizeText(metadata?.dispatchReceivedAt) || envelope.dispatchReceivedAt;
  const dispatchCompletedAt = normalizeText(metadata?.dispatchCompletedAt) || envelope.dispatchCompletedAt;
  const claimedAt = status === "assigned" && !envelope.claimedAt ? timestamp : envelope.claimedAt;
  const completedAt = status === "completed" && !envelope.completedAt ? timestamp : envelope.completedAt;
  const failedAt = status === "failed" && !envelope.failedAt ? timestamp : envelope.failedAt;
  const blockedAt = status === "blocked" && !envelope.blockedAt ? timestamp : envelope.blockedAt;

  return {
    ...envelope,
    assignedNodeId: assignedNodeId || undefined,
    status,
    statusReason,
    claimToken: claimToken || undefined,
    runnerMode,
    dispatchMessageId: dispatchMessageId || undefined,
    dispatchAckMessageId: dispatchAckMessageId || undefined,
    dispatchResultMessageId: dispatchResultMessageId || undefined,
    dispatchTargetNodeId: dispatchTargetNodeId || undefined,
    dispatchProtocolVersion,
    dispatchStatusSummary: dispatchStatusSummary || undefined,
    dispatchAuthSummary: dispatchAuthSummary || undefined,
    dispatchTransportStatus,
    remoteDispatchPlanned,
    claimedAt,
    assignedAt: status === "assigned" && !envelope.assignedAt ? timestamp : envelope.assignedAt,
    startedAt: status === "running" && !envelope.startedAt ? timestamp : envelope.startedAt,
    dispatchReceivedAt: dispatchReceivedAt || undefined,
    dispatchCompletedAt: dispatchCompletedAt || undefined,
    completedAt,
    failedAt,
    blockedAt,
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
    claimToken: undefined,
    runnerMode: undefined,
    dispatchMessageId: undefined,
    dispatchAckMessageId: undefined,
    dispatchResultMessageId: undefined,
    dispatchTargetNodeId: undefined,
    dispatchProtocolVersion: undefined,
    dispatchStatusSummary: undefined,
    dispatchAuthSummary: undefined,
    dispatchTransportStatus: undefined,
    remoteDispatchPlanned: undefined,
    createdAt: timestamp,
    claimedAt: undefined,
    assignedAt: undefined,
    startedAt: undefined,
    dispatchReceivedAt: undefined,
    dispatchCompletedAt: undefined,
    completedAt: undefined,
    failedAt: undefined,
    blockedAt: undefined,
    updatedAt: timestamp,
  };
}

export function claimTaskEnvelope(
  envelope: TaskEnvelope,
  params: {
    assignedNodeId: string;
    claimToken: string;
    runnerMode: ExecutionNodeMode;
    statusReason?: string;
  },
): TaskEnvelope {
  if (envelope.status !== "pending") {
    throw new Error(`Task ${envelope.taskId} is already ${envelope.status} and cannot be claimed again.`);
  }

  return applyTaskTransition(envelope, "assigned", {
    assignedNodeId: params.assignedNodeId,
    claimToken: params.claimToken,
    runnerMode: params.runnerMode,
    statusReason: params.statusReason,
  });
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

export function releaseTaskEnvelope(envelope: TaskEnvelope, statusReason?: string): TaskEnvelope {
  if (envelope.status !== "assigned") {
    throw new Error(`Task ${envelope.taskId} cannot be released while ${envelope.status}.`);
  }

  const timestamp = createTimestamp();
  return {
    ...envelope,
    assignedNodeId: undefined,
    status: "pending",
    statusReason: normalizeText(statusReason) || undefined,
    claimToken: undefined,
    runnerMode: undefined,
    claimedAt: undefined,
    assignedAt: undefined,
    updatedAt: timestamp,
  };
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
  if (envelope.status !== "assigned" && envelope.status !== "running") {
    throw new Error(`Task ${envelope.taskId} cannot start running from ${envelope.status}.`);
  }

  return applyTaskTransition(envelope, "running", metadata);
}

export function markTaskCompleted(envelope: TaskEnvelope, metadata?: TaskEnvelopeTransitionMetadata): TaskEnvelope {
  if (envelope.status !== "assigned" && envelope.status !== "running" && envelope.status !== "completed") {
    throw new Error(`Task ${envelope.taskId} cannot complete from ${envelope.status}.`);
  }

  return applyTaskTransition(envelope, "completed", metadata);
}

export function markTaskFailed(envelope: TaskEnvelope, metadata?: TaskEnvelopeTransitionMetadata): TaskEnvelope {
  if (envelope.status !== "assigned" && envelope.status !== "running" && envelope.status !== "failed") {
    throw new Error(`Task ${envelope.taskId} cannot fail from ${envelope.status}.`);
  }

  return applyTaskTransition(envelope, "failed", metadata);
}

export function markTaskBlocked(envelope: TaskEnvelope, metadata?: TaskEnvelopeTransitionMetadata): TaskEnvelope {
  if (envelope.status !== "pending" && envelope.status !== "assigned" && envelope.status !== "running" && envelope.status !== "blocked") {
    throw new Error(`Task ${envelope.taskId} cannot be blocked from ${envelope.status}.`);
  }

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
    claimToken: normalizeText(typeof source.claimToken === "string" ? source.claimToken : "") || undefined,
    runnerMode: normalizeExecutionNodeMode(source.runnerMode),
    dispatchMessageId: normalizeText(typeof source.dispatchMessageId === "string" ? source.dispatchMessageId : "") || undefined,
    dispatchAckMessageId: normalizeText(typeof source.dispatchAckMessageId === "string" ? source.dispatchAckMessageId : "") || undefined,
    dispatchResultMessageId: normalizeText(typeof source.dispatchResultMessageId === "string" ? source.dispatchResultMessageId : "") || undefined,
    dispatchTargetNodeId: normalizeText(typeof source.dispatchTargetNodeId === "string" ? source.dispatchTargetNodeId : "") || undefined,
    dispatchProtocolVersion: source.dispatchProtocolVersion === "1" ? "1" : undefined,
    dispatchStatusSummary: normalizeText(typeof source.dispatchStatusSummary === "string" ? source.dispatchStatusSummary : "") || undefined,
    dispatchAuthSummary: normalizeText(typeof source.dispatchAuthSummary === "string" ? source.dispatchAuthSummary : "") || undefined,
    dispatchTransportStatus: normalizeDispatchTransportStatus(source.dispatchTransportStatus),
    remoteDispatchPlanned: typeof source.remoteDispatchPlanned === "boolean" ? source.remoteDispatchPlanned : undefined,
    createdAt,
    claimedAt: normalizeText(typeof source.claimedAt === "string" ? source.claimedAt : "") || undefined,
    assignedAt: normalizeText(typeof source.assignedAt === "string" ? source.assignedAt : "") || undefined,
    startedAt: normalizeText(typeof source.startedAt === "string" ? source.startedAt : "") || undefined,
    dispatchReceivedAt: normalizeText(typeof source.dispatchReceivedAt === "string" ? source.dispatchReceivedAt : "") || undefined,
    dispatchCompletedAt: normalizeText(typeof source.dispatchCompletedAt === "string" ? source.dispatchCompletedAt : "") || undefined,
    completedAt: normalizeText(typeof source.completedAt === "string" ? source.completedAt : "") || undefined,
    failedAt: normalizeText(typeof source.failedAt === "string" ? source.failedAt : "") || undefined,
    blockedAt: normalizeText(typeof source.blockedAt === "string" ? source.blockedAt : "") || undefined,
    updatedAt,
  };
}

export function summarizeTaskEnvelope(envelope: TaskEnvelope): string {
  return [
    `task=${envelope.taskId}`,
    `status=${envelope.status}`,
    `step=${envelope.stepIndex}`,
    envelope.assignedNodeId ? `node=${envelope.assignedNodeId}` : "node=unassigned",
    envelope.dispatchTargetNodeId ? `dispatchTarget=${envelope.dispatchTargetNodeId}` : "",
    envelope.dispatchMessageId ? `dispatch=${envelope.dispatchMessageId}` : "",
    envelope.dispatchAckMessageId ? `ack=${envelope.dispatchAckMessageId}` : "",
    envelope.dispatchResultMessageId ? `result=${envelope.dispatchResultMessageId}` : "",
    envelope.requestedCapabilities.length ? `caps=${envelope.requestedCapabilities.join(",")}` : "caps=none",
    envelope.dispatchTransportStatus ? `transport=${envelope.dispatchTransportStatus}` : "",
    envelope.dispatchAuthSummary ? `auth=${envelope.dispatchAuthSummary}` : "",
    envelope.dispatchStatusSummary ? `dispatchStatus=${envelope.dispatchStatusSummary}` : "",
    envelope.statusReason ? `reason=${envelope.statusReason}` : "",
  ].filter(Boolean).join(" | ");
}