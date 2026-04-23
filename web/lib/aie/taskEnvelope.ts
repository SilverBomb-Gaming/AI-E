import { getExecutionNodeCapabilitiesForAction, type ExecutionNodeCapability } from "./executionNode";
import type { ExecutionNodeMode } from "./executionNode";
import type { ExecutionActionPreview } from "./types";

export type TaskEnvelopeStatus =
  | "pending"
  | "assigned"
  | "running"
  | "blocked"
  | "queued"
  | "dispatching"
  | "awaiting-ack"
  | "executing"
  | "completed"
  | "failed"
  | "retrying"
  | "rejected";

export type TaskDispatchTransportStatus = "pending" | "accepted" | "rejected" | "delivered" | "failed" | "completed";

export type TaskLeaseStatus = "active" | "superseded" | "expired" | "completed" | "cancelled";

export type TaskResumability = "resumable" | "restart-required";

export type TaskContinuationReason =
  | "stale-node"
  | "offline-node"
  | "timeout-recovery"
  | "lease-supersession"
  | "manual-retry"
  | "receiver-recovery"
  | "other";

export type TaskExecutionLease = {
  leaseId: string;
  ownerNodeId: string;
  epoch: number;
  startedAt: string;
  lastProgressAt: string;
  status: TaskLeaseStatus;
  continuationToken?: string;
  checkpointReference?: string;
  progressMarker?: string;
  invalidatedAt?: string;
  invalidationReason?: string;
  supersededByLeaseId?: string;
};

export type TaskEnvelopeTransitionMetadata = {
  assignedNodeId?: string;
  selectedNodeId?: string;
  selectedNodeReason?: string;
  statusReason?: string;
  failureReason?: string;
  resumability?: TaskResumability;
  continuationSourceNodeId?: string;
  continuationTargetNodeId?: string;
  continuationGeneration?: number;
  continuationReason?: TaskContinuationReason | string;
  resumedFromCheckpointReference?: string;
  resumedFromContinuationToken?: string;
  continuationToken?: string;
  checkpointReference?: string;
  resumeAttemptCount?: number;
  lastProgressMarker?: string;
  recoveryPending?: boolean;
  lease?: TaskExecutionLease | null;
  priorLeaseId?: string;
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
  dispatchRetryCount?: number;
  dispatchLastAttemptAt?: string;
  dispatchTimeoutMs?: number;
  remoteDispatchPlanned?: boolean;
  dispatchReceivedAt?: string;
  dispatchCompletedAt?: string;
};

export type TaskEnvelope = {
  taskId: string;
  sessionId: string;
  stepIndex: number;
  generatedTask: boolean;
  priority: number;
  dependsOnTaskIds: string[];
  featureId?: string;
  featureTitle?: string;
  featureDescription?: string;
  action: ExecutionActionPreview;
  requestedCapabilities: ExecutionNodeCapability[];
  resumability: TaskResumability;
  continuationSourceNodeId?: string;
  continuationTargetNodeId?: string;
  continuationGeneration: number;
  continuationReason?: TaskContinuationReason | string;
  resumedFromCheckpointReference?: string;
  resumedFromContinuationToken?: string;
  continuationToken?: string;
  checkpointReference?: string;
  resumeAttemptCount: number;
  lastProgressMarker?: string;
  recoveryPending: boolean;
  lease?: TaskExecutionLease;
  priorLeaseId?: string;
  preferredNodeId?: string;
  assignedNodeId?: string;
  selectedNodeId?: string;
  selectedNodeReason?: string;
  status: TaskEnvelopeStatus;
  statusReason?: string;
  failureReason?: string;
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
  dispatchRetryCount?: number;
  dispatchLastAttemptAt?: string;
  dispatchTimeoutMs?: number;
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

export type TaskDispatchHardeningState = {
  state: "unverified" | "passed" | "retryable-rejection" | "terminal-rejection";
  category:
    | "none"
    | "trust-boundary"
    | "dispatch-protocol"
    | "authentication"
    | "lease"
    | "continuation"
    | "checkpoint"
    | "other";
  reason?: string;
};

export type TaskRecoveryStrategy = "none" | "resume-continuation" | "restart-safe-boundary" | "fail-non-retryable";

export type TaskRecoveryPlanningState = {
  strategy: TaskRecoveryStrategy;
  reasonCategory:
    | "none"
    | "timeout"
    | "stale-node"
    | "offline-node"
    | "trust-boundary"
    | "dispatch-protocol"
    | "authentication"
    | "checkpoint"
    | "continuation"
    | "lease"
    | "other";
  safeStopPoint?: string;
  reason?: string;
};

export type TaskContinuationChainState = {
  state: "fresh" | "continuing" | "restart-pending" | "safe-stop" | "terminal";
  depth: number;
  active: boolean;
  safeStopPoint?: string;
  latestReason?: string;
};

type CreateTaskEnvelopeParams = {
  taskId?: string;
  sessionId: string;
  stepIndex: number;
  generatedTask?: boolean;
  priority?: number;
  dependsOnTaskIds?: string[];
  featureId?: string;
  featureTitle?: string;
  featureDescription?: string;
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

function createLeaseId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `aie-lease-${globalThis.crypto.randomUUID()}`;
  }

  return `aie-lease-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTaskPriority(value: unknown): number {
  if (!Number.isFinite(Number(value))) {
    return 0;
  }

  return Math.max(0, Math.floor(Number(value)));
}

function normalizeTaskDependencyIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    const taskId = normalizeText(item);
    if (!taskId || seen.has(taskId)) {
      continue;
    }

    seen.add(taskId);
    normalized.push(taskId);
  }

  return normalized;
}

export function createTaskExecutionLease(params: {
  ownerNodeId: string;
  previousLease?: TaskExecutionLease;
  epoch?: number;
  at?: string;
  continuationToken?: string;
  checkpointReference?: string;
  progressMarker?: string;
}): TaskExecutionLease {
  const timestamp = normalizeText(params.at) || createTimestamp();
  const epoch = Number.isInteger(Number(params.epoch))
    ? Math.max(1, Number(params.epoch))
    : Math.max(1, (params.previousLease?.epoch ?? 0) + 1);

  return {
    leaseId: createLeaseId(),
    ownerNodeId: normalizeText(params.ownerNodeId),
    epoch,
    startedAt: timestamp,
    lastProgressAt: timestamp,
    status: "active",
    continuationToken: normalizeText(params.continuationToken) || undefined,
    checkpointReference: normalizeText(params.checkpointReference) || undefined,
    progressMarker: normalizeText(params.progressMarker) || undefined,
  };
}

export function invalidateTaskExecutionLease(
  lease: TaskExecutionLease | undefined,
  params: {
    status?: Extract<TaskLeaseStatus, "superseded" | "expired" | "completed" | "cancelled">;
    at?: string;
    reason?: string;
    supersededByLeaseId?: string;
    progressMarker?: string;
    continuationToken?: string;
    checkpointReference?: string;
  } = {},
): TaskExecutionLease | undefined {
  if (!lease) {
    return undefined;
  }

  const timestamp = normalizeText(params.at) || createTimestamp();
  const status = params.status ?? "superseded";

  return {
    ...lease,
    status,
    lastProgressAt: timestamp,
    continuationToken: normalizeText(params.continuationToken) || lease.continuationToken,
    checkpointReference: normalizeText(params.checkpointReference) || lease.checkpointReference,
    progressMarker: normalizeText(params.progressMarker) || lease.progressMarker,
    invalidatedAt: status === "completed" ? lease.invalidatedAt : timestamp,
    invalidationReason: status === "completed" ? lease.invalidationReason : normalizeText(params.reason) || lease.invalidationReason,
    supersededByLeaseId: normalizeText(params.supersededByLeaseId) || lease.supersededByLeaseId,
  };
}

function normalizeTaskEnvelopeStatus(value: unknown): TaskEnvelopeStatus | undefined {
  if (
    value === "pending" ||
    value === "assigned" ||
    value === "running" ||
    value === "queued" ||
    value === "dispatching" ||
    value === "awaiting-ack" ||
    value === "executing" ||
    value === "completed" ||
    value === "failed" ||
    value === "blocked" ||
    value === "retrying" ||
    value === "rejected"
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

function normalizeLeaseStatus(value: unknown): TaskLeaseStatus | undefined {
  if (
    value === "active" ||
    value === "superseded" ||
    value === "expired" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return undefined;
}

function normalizeResumability(value: unknown): TaskResumability | undefined {
  if (value === "resumable" || value === "restart-required") {
    return value;
  }

  return undefined;
}

function normalizeContinuationReason(value: unknown): TaskContinuationReason | string | undefined {
  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "stale-node"
    || normalized === "offline-node"
    || normalized === "timeout-recovery"
    || normalized === "lease-supersession"
    || normalized === "manual-retry"
    || normalized === "receiver-recovery"
    || normalized === "other"
  ) {
    return normalized;
  }

  return normalized;
}

function hasExplicitMetadataValue(metadata: TaskEnvelopeTransitionMetadata | undefined, key: keyof TaskEnvelopeTransitionMetadata): boolean {
  return Boolean(metadata && Object.prototype.hasOwnProperty.call(metadata, key));
}

function categorizeRecoveryReason(reason: string | undefined): TaskRecoveryPlanningState["reasonCategory"] {
  const normalizedReason = normalizeText(reason).toLowerCase();
  if (!normalizedReason) {
    return "none";
  }

  if (normalizedReason.includes("timeout") || normalizedReason.includes("timed out")) {
    return "timeout";
  }

  if (normalizedReason.includes("stale")) {
    return "stale-node";
  }

  if (
    normalizedReason.includes("offline")
    || normalizedReason.includes("unavailable")
    || normalizedReason.includes("not registered")
  ) {
    return "offline-node";
  }

  if (normalizedReason.includes("trust boundary")) {
    return "trust-boundary";
  }

  if (normalizedReason.includes("dispatch protocol")) {
    return "dispatch-protocol";
  }

  if (normalizedReason.includes("auth")) {
    return "authentication";
  }

  if (normalizedReason.includes("checkpoint")) {
    return "checkpoint";
  }

  if (normalizedReason.includes("continuation")) {
    return "continuation";
  }

  if (normalizedReason.includes("lease")) {
    return "lease";
  }

  return "other";
}

function normalizeTaskExecutionLease(value: unknown): TaskExecutionLease | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const leaseId = normalizeText(typeof source.leaseId === "string" ? source.leaseId : "");
  const ownerNodeId = normalizeText(typeof source.ownerNodeId === "string" ? source.ownerNodeId : "");
  const startedAt = normalizeText(typeof source.startedAt === "string" ? source.startedAt : "");
  const lastProgressAt = normalizeText(typeof source.lastProgressAt === "string" ? source.lastProgressAt : "");
  const status = normalizeLeaseStatus(source.status);
  const epoch = Number(source.epoch ?? Number.NaN);

  if (!leaseId || !ownerNodeId || !startedAt || !lastProgressAt || !status || !Number.isInteger(epoch) || epoch < 1) {
    return undefined;
  }

  return {
    leaseId,
    ownerNodeId,
    epoch,
    startedAt,
    lastProgressAt,
    status,
    continuationToken: normalizeText(typeof source.continuationToken === "string" ? source.continuationToken : "") || undefined,
    checkpointReference: normalizeText(typeof source.checkpointReference === "string" ? source.checkpointReference : "") || undefined,
    progressMarker: normalizeText(typeof source.progressMarker === "string" ? source.progressMarker : "") || undefined,
    invalidatedAt: normalizeText(typeof source.invalidatedAt === "string" ? source.invalidatedAt : "") || undefined,
    invalidationReason: normalizeText(typeof source.invalidationReason === "string" ? source.invalidationReason : "") || undefined,
    supersededByLeaseId: normalizeText(typeof source.supersededByLeaseId === "string" ? source.supersededByLeaseId : "") || undefined,
  };
}

function assertTaskTransitionAllowed(envelope: TaskEnvelope, nextStatus: TaskEnvelopeStatus): void {
  const allowedTransitions: Record<TaskEnvelopeStatus, TaskEnvelopeStatus[]> = {
    pending: ["queued", "assigned", "blocked", "rejected"],
    assigned: ["pending", "dispatching", "running", "blocked", "failed", "completed", "rejected"],
    running: ["executing", "completed", "failed", "blocked", "retrying", "rejected"],
    queued: ["assigned", "dispatching", "blocked", "failed", "rejected"],
    dispatching: ["awaiting-ack", "retrying", "failed", "rejected", "executing"],
    "awaiting-ack": ["executing", "retrying", "failed", "rejected", "completed"],
    executing: ["completed", "failed", "retrying", "rejected"],
    completed: [],
    failed: [],
    blocked: [],
    retrying: ["dispatching", "awaiting-ack", "failed", "rejected"],
    rejected: [],
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
  const selectedNodeId = normalizeText(metadata?.selectedNodeId) || normalizeText(metadata?.assignedNodeId) || envelope.selectedNodeId || envelope.assignedNodeId;
  const assignedNodeId = selectedNodeId || envelope.assignedNodeId;
  const selectedNodeReason = normalizeText(metadata?.selectedNodeReason) || envelope.selectedNodeReason;
  const statusReason = normalizeText(metadata?.statusReason) || undefined;
  const failureReason = normalizeText(metadata?.failureReason) || envelope.failureReason;
  const resumability = metadata?.resumability ?? envelope.resumability;
  const continuationSourceNodeId = hasExplicitMetadataValue(metadata, "continuationSourceNodeId")
    ? normalizeText(metadata?.continuationSourceNodeId) || undefined
    : envelope.continuationSourceNodeId;
  const continuationTargetNodeId = hasExplicitMetadataValue(metadata, "continuationTargetNodeId")
    ? normalizeText(metadata?.continuationTargetNodeId) || undefined
    : envelope.continuationTargetNodeId;
  const continuationGeneration = Number.isInteger(Number(metadata?.continuationGeneration))
    ? Math.max(0, Number(metadata?.continuationGeneration))
    : envelope.continuationGeneration;
  const continuationReason = normalizeContinuationReason(metadata?.continuationReason) ?? envelope.continuationReason;
  const resumedFromCheckpointReference = hasExplicitMetadataValue(metadata, "resumedFromCheckpointReference")
    ? normalizeText(metadata?.resumedFromCheckpointReference) || undefined
    : envelope.resumedFromCheckpointReference;
  const resumedFromContinuationToken = hasExplicitMetadataValue(metadata, "resumedFromContinuationToken")
    ? normalizeText(metadata?.resumedFromContinuationToken) || undefined
    : envelope.resumedFromContinuationToken;
  const continuationToken = hasExplicitMetadataValue(metadata, "continuationToken")
    ? normalizeText(metadata?.continuationToken) || undefined
    : envelope.continuationToken;
  const checkpointReference = hasExplicitMetadataValue(metadata, "checkpointReference")
    ? normalizeText(metadata?.checkpointReference) || undefined
    : envelope.checkpointReference;
  const resumeAttemptCount = Number.isInteger(Number(metadata?.resumeAttemptCount))
    ? Math.max(0, Number(metadata?.resumeAttemptCount))
    : envelope.resumeAttemptCount;
  const lastProgressMarker = normalizeText(metadata?.lastProgressMarker) || envelope.lastProgressMarker;
  const recoveryPending = typeof metadata?.recoveryPending === "boolean"
    ? metadata.recoveryPending
    : envelope.recoveryPending;
  const priorLeaseId = normalizeText(metadata?.priorLeaseId) || envelope.priorLeaseId;
  const requestedLease = metadata?.lease === null
    ? null
    : normalizeTaskExecutionLease(metadata?.lease);
  if (
    requestedLease?.status === "active"
    && envelope.lease?.status === "active"
    && envelope.lease.leaseId !== requestedLease.leaseId
  ) {
    if (priorLeaseId !== envelope.lease.leaseId || requestedLease.epoch <= envelope.lease.epoch) {
      throw new Error(`Task ${envelope.taskId} cannot create a second active lease without superseding ${envelope.lease.leaseId}.`);
    }
  }
  const lease = requestedLease === null
    ? undefined
    : requestedLease
      ?? (() => {
        if (!envelope.lease) {
          return undefined;
        }

        if (envelope.lease.status !== "active") {
          return envelope.lease;
        }

        if (status === "completed") {
          return invalidateTaskExecutionLease(envelope.lease, {
            status: "completed",
            at: timestamp,
            progressMarker: lastProgressMarker,
            continuationToken,
            checkpointReference,
          });
        }

        if (status === "failed" || status === "blocked" || status === "rejected") {
          return invalidateTaskExecutionLease(envelope.lease, {
            status: "cancelled",
            at: timestamp,
            reason: failureReason || statusReason,
            progressMarker: lastProgressMarker,
            continuationToken,
            checkpointReference,
          });
        }

        if (status === "retrying") {
          return invalidateTaskExecutionLease(envelope.lease, {
            status: "superseded",
            at: timestamp,
            reason: failureReason || statusReason,
            progressMarker: lastProgressMarker,
            continuationToken,
            checkpointReference,
          });
        }

        return {
          ...envelope.lease,
          lastProgressAt: timestamp,
          continuationToken,
          checkpointReference,
          progressMarker: lastProgressMarker || envelope.lease.progressMarker,
        };
      })();
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
  const dispatchRetryCount = Number.isInteger(Number(metadata?.dispatchRetryCount))
    ? Math.max(0, Number(metadata?.dispatchRetryCount))
    : envelope.dispatchRetryCount;
  const dispatchLastAttemptAt = normalizeText(metadata?.dispatchLastAttemptAt) || envelope.dispatchLastAttemptAt;
  const dispatchTimeoutMs = Number.isFinite(Number(metadata?.dispatchTimeoutMs))
    ? Math.max(0, Number(metadata?.dispatchTimeoutMs))
    : envelope.dispatchTimeoutMs;
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
    resumability,
    continuationSourceNodeId: continuationSourceNodeId || undefined,
    continuationTargetNodeId: continuationTargetNodeId || undefined,
    continuationGeneration,
    continuationReason: continuationReason || undefined,
    resumedFromCheckpointReference: resumedFromCheckpointReference || undefined,
    resumedFromContinuationToken: resumedFromContinuationToken || undefined,
    continuationToken: continuationToken || undefined,
    checkpointReference: checkpointReference || undefined,
    resumeAttemptCount,
    lastProgressMarker: lastProgressMarker || undefined,
    recoveryPending,
    lease,
    priorLeaseId: priorLeaseId || undefined,
    assignedNodeId: assignedNodeId || undefined,
    selectedNodeId: selectedNodeId || undefined,
    selectedNodeReason: selectedNodeReason || undefined,
    status,
    statusReason,
    failureReason: failureReason || undefined,
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
    dispatchRetryCount,
    dispatchLastAttemptAt: dispatchLastAttemptAt || undefined,
    dispatchTimeoutMs,
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
    generatedTask: params.generatedTask !== false,
    priority: normalizeTaskPriority(params.priority),
    dependsOnTaskIds: normalizeTaskDependencyIds(params.dependsOnTaskIds),
    featureId: normalizeText(params.featureId) || undefined,
    featureTitle: normalizeText(params.featureTitle) || undefined,
    featureDescription: normalizeText(params.featureDescription) || undefined,
    action: params.action,
    requestedCapabilities: params.requestedCapabilities?.length
      ? [...params.requestedCapabilities]
      : getExecutionNodeCapabilitiesForAction(params.action),
    resumability: "restart-required",
    continuationSourceNodeId: undefined,
    continuationTargetNodeId: undefined,
    continuationGeneration: 0,
    continuationReason: undefined,
    resumedFromCheckpointReference: undefined,
    resumedFromContinuationToken: undefined,
    continuationToken: undefined,
    checkpointReference: undefined,
    resumeAttemptCount: 0,
    lastProgressMarker: undefined,
    recoveryPending: false,
    lease: undefined,
    priorLeaseId: undefined,
    preferredNodeId: normalizeText(params.preferredNodeId) || undefined,
    assignedNodeId: undefined,
    selectedNodeId: undefined,
    selectedNodeReason: undefined,
    status: params.status ?? "queued",
    statusReason: undefined,
    failureReason: undefined,
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
    dispatchRetryCount: undefined,
    dispatchLastAttemptAt: undefined,
    dispatchTimeoutMs: undefined,
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
    selectedNodeReason?: string;
    claimToken: string;
    runnerMode: ExecutionNodeMode;
    statusReason?: string;
  },
): TaskEnvelope {
  if (envelope.status !== "pending" && envelope.status !== "queued" && envelope.status !== "retrying") {
    throw new Error(`Task ${envelope.taskId} is already ${envelope.status} and cannot be claimed again.`);
  }

  return applyTaskTransition(envelope, "dispatching", {
    assignedNodeId: params.assignedNodeId,
    selectedNodeId: params.assignedNodeId,
    selectedNodeReason: params.selectedNodeReason,
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
  if (envelope.status !== "assigned" && envelope.status !== "dispatching" && envelope.status !== "retrying") {
    throw new Error(`Task ${envelope.taskId} cannot be released while ${envelope.status}.`);
  }

  const timestamp = createTimestamp();
  return {
    ...envelope,
    assignedNodeId: undefined,
    status: "queued",
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
  if (envelope.status !== "assigned" && envelope.status !== "dispatching" && envelope.status !== "awaiting-ack" && envelope.status !== "running" && envelope.status !== "executing") {
    throw new Error(`Task ${envelope.taskId} cannot start running from ${envelope.status}.`);
  }

  const nextStatus = envelope.status === "assigned"
    ? "running"
    : envelope.status === "running"
      ? "running"
      : "executing";

  return applyTaskTransition(envelope, nextStatus, metadata);
}

export function markTaskCompleted(envelope: TaskEnvelope, metadata?: TaskEnvelopeTransitionMetadata): TaskEnvelope {
  if (envelope.status !== "assigned" && envelope.status !== "dispatching" && envelope.status !== "awaiting-ack" && envelope.status !== "running" && envelope.status !== "executing" && envelope.status !== "completed") {
    throw new Error(`Task ${envelope.taskId} cannot complete from ${envelope.status}.`);
  }

  return applyTaskTransition(envelope, "completed", metadata);
}

export function markTaskFailed(envelope: TaskEnvelope, metadata?: TaskEnvelopeTransitionMetadata): TaskEnvelope {
  if (envelope.status !== "assigned" && envelope.status !== "dispatching" && envelope.status !== "awaiting-ack" && envelope.status !== "running" && envelope.status !== "executing" && envelope.status !== "retrying" && envelope.status !== "failed") {
    throw new Error(`Task ${envelope.taskId} cannot fail from ${envelope.status}.`);
  }

  return applyTaskTransition(envelope, "failed", metadata);
}

export function markTaskBlocked(envelope: TaskEnvelope, metadata?: TaskEnvelopeTransitionMetadata): TaskEnvelope {
  if (envelope.status !== "pending" && envelope.status !== "queued" && envelope.status !== "assigned" && envelope.status !== "dispatching" && envelope.status !== "awaiting-ack" && envelope.status !== "running" && envelope.status !== "executing" && envelope.status !== "blocked") {
    throw new Error(`Task ${envelope.taskId} cannot be blocked from ${envelope.status}.`);
  }

  return applyTaskTransition(envelope, "blocked", metadata);
}

export function markTaskRejected(envelope: TaskEnvelope, metadata?: TaskEnvelopeTransitionMetadata): TaskEnvelope {
  if (envelope.status === "completed" || envelope.status === "failed" || envelope.status === "blocked" || envelope.status === "rejected") {
    throw new Error(`Task ${envelope.taskId} cannot be rejected from ${envelope.status}.`);
  }

  return applyTaskTransition(envelope, "rejected", metadata);
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
    generatedTask: typeof source.generatedTask === "boolean" ? source.generatedTask : true,
    priority: normalizeTaskPriority(source.priority),
    dependsOnTaskIds: normalizeTaskDependencyIds(source.dependsOnTaskIds),
    featureId: normalizeText(typeof source.featureId === "string" ? source.featureId : "") || undefined,
    featureTitle: normalizeText(typeof source.featureTitle === "string" ? source.featureTitle : "") || undefined,
    featureDescription: normalizeText(typeof source.featureDescription === "string" ? source.featureDescription : "") || undefined,
    action: action as ExecutionActionPreview,
    requestedCapabilities,
    resumability: normalizeResumability(source.resumability) ?? "restart-required",
    continuationSourceNodeId: normalizeText(typeof source.continuationSourceNodeId === "string" ? source.continuationSourceNodeId : "") || undefined,
    continuationTargetNodeId: normalizeText(typeof source.continuationTargetNodeId === "string" ? source.continuationTargetNodeId : "") || undefined,
    continuationGeneration: Number.isInteger(Number(source.continuationGeneration)) ? Math.max(0, Number(source.continuationGeneration)) : 0,
    continuationReason: normalizeContinuationReason(source.continuationReason),
    resumedFromCheckpointReference: normalizeText(typeof source.resumedFromCheckpointReference === "string" ? source.resumedFromCheckpointReference : "") || undefined,
    resumedFromContinuationToken: normalizeText(typeof source.resumedFromContinuationToken === "string" ? source.resumedFromContinuationToken : "") || undefined,
    continuationToken: normalizeText(typeof source.continuationToken === "string" ? source.continuationToken : "") || undefined,
    checkpointReference: normalizeText(typeof source.checkpointReference === "string" ? source.checkpointReference : "") || undefined,
    resumeAttemptCount: Number.isInteger(Number(source.resumeAttemptCount)) ? Math.max(0, Number(source.resumeAttemptCount)) : 0,
    lastProgressMarker: normalizeText(typeof source.lastProgressMarker === "string" ? source.lastProgressMarker : "") || undefined,
    recoveryPending: typeof source.recoveryPending === "boolean" ? source.recoveryPending : false,
    lease: normalizeTaskExecutionLease(source.lease),
    priorLeaseId: normalizeText(typeof source.priorLeaseId === "string" ? source.priorLeaseId : "") || undefined,
    preferredNodeId: normalizeText(typeof source.preferredNodeId === "string" ? source.preferredNodeId : "") || undefined,
    assignedNodeId: normalizeText(typeof source.assignedNodeId === "string" ? source.assignedNodeId : "") || undefined,
    selectedNodeId: normalizeText(typeof source.selectedNodeId === "string" ? source.selectedNodeId : "") || undefined,
    selectedNodeReason: normalizeText(typeof source.selectedNodeReason === "string" ? source.selectedNodeReason : "") || undefined,
    status,
    statusReason: normalizeText(typeof source.statusReason === "string" ? source.statusReason : "") || undefined,
    failureReason: normalizeText(typeof source.failureReason === "string" ? source.failureReason : "") || undefined,
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
    dispatchRetryCount: Number.isInteger(Number(source.dispatchRetryCount)) ? Math.max(0, Number(source.dispatchRetryCount)) : undefined,
    dispatchLastAttemptAt: normalizeText(typeof source.dispatchLastAttemptAt === "string" ? source.dispatchLastAttemptAt : "") || undefined,
    dispatchTimeoutMs: Number.isFinite(Number(source.dispatchTimeoutMs)) ? Math.max(0, Number(source.dispatchTimeoutMs)) : undefined,
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
  const hardening = deriveTaskDispatchHardeningState(envelope);
  const recoveryPlanning = deriveTaskRecoveryPlanningState(envelope);
  const continuationChain = deriveTaskContinuationChainState(envelope);
  return [
    `task=${envelope.taskId}`,
    `status=${envelope.status}`,
    `step=${envelope.stepIndex}`,
    `generated=${String(envelope.generatedTask)}`,
    `priority=${envelope.priority}`,
    envelope.dependsOnTaskIds.length ? `dependsOn=${envelope.dependsOnTaskIds.join(",")}` : "dependsOn=none",
    `resumability=${envelope.resumability}`,
    envelope.continuationGeneration > 0 ? `continuationGen=${envelope.continuationGeneration}` : "continuationGen=0",
    envelope.continuationSourceNodeId ? `continuationSource=${envelope.continuationSourceNodeId}` : "",
    envelope.continuationTargetNodeId ? `continuationTarget=${envelope.continuationTargetNodeId}` : "",
    envelope.continuationReason ? `continuationReason=${envelope.continuationReason}` : "",
    envelope.resumedFromCheckpointReference ? `resumedCheckpoint=${envelope.resumedFromCheckpointReference}` : "",
    envelope.resumedFromContinuationToken ? "resumedToken=present" : "",
    envelope.selectedNodeId ? `selectedNode=${envelope.selectedNodeId}` : envelope.assignedNodeId ? `node=${envelope.assignedNodeId}` : "node=unassigned",
    envelope.lease ? `lease=${envelope.lease.leaseId}` : "lease=none",
    envelope.lease ? `leaseStatus=${envelope.lease.status}` : "",
    envelope.lease ? `leaseOwner=${envelope.lease.ownerNodeId}` : "",
    envelope.lease ? `leaseEpoch=${envelope.lease.epoch}` : "",
    envelope.lastProgressMarker ? `progress=${envelope.lastProgressMarker}` : "",
    envelope.continuationToken ? "continuation=present" : "continuation=none",
    envelope.checkpointReference ? `checkpoint=${envelope.checkpointReference}` : "",
    envelope.recoveryPending ? "recovery=pending" : "",
    recoveryPlanning.strategy !== "none" ? `recoveryPlan=${recoveryPlanning.strategy}` : "",
    recoveryPlanning.reasonCategory !== "none" ? `recoveryReason=${recoveryPlanning.reasonCategory}` : "",
    recoveryPlanning.safeStopPoint ? `safeStop=${recoveryPlanning.safeStopPoint}` : "",
    `chain=${continuationChain.state}`,
    `chainDepth=${continuationChain.depth}`,
    envelope.selectedNodeReason ? `selection=${envelope.selectedNodeReason}` : "",
    envelope.dispatchTargetNodeId ? `dispatchTarget=${envelope.dispatchTargetNodeId}` : "",
    envelope.dispatchMessageId ? `dispatch=${envelope.dispatchMessageId}` : "",
    envelope.dispatchAckMessageId ? `ack=${envelope.dispatchAckMessageId}` : "",
    envelope.dispatchResultMessageId ? `result=${envelope.dispatchResultMessageId}` : "",
    envelope.requestedCapabilities.length ? `caps=${envelope.requestedCapabilities.join(",")}` : "caps=none",
    envelope.dispatchTransportStatus ? `transport=${envelope.dispatchTransportStatus}` : "",
    hardening.category !== "none" ? `hardening=${hardening.state}:${hardening.category}` : "",
    typeof envelope.dispatchRetryCount === "number" ? `retries=${envelope.dispatchRetryCount}` : "",
    envelope.failureReason ? `failure=${envelope.failureReason}` : "",
    envelope.dispatchAuthSummary ? `auth=${envelope.dispatchAuthSummary}` : "",
    envelope.dispatchStatusSummary ? `dispatchStatus=${envelope.dispatchStatusSummary}` : "",
    envelope.statusReason ? `reason=${envelope.statusReason}` : "",
  ].filter(Boolean).join(" | ");
}

export function deriveTaskDispatchHardeningState(envelope: TaskEnvelope): TaskDispatchHardeningState {
  const reason = normalizeText(envelope.failureReason || envelope.statusReason || envelope.dispatchStatusSummary);
  const normalizedReason = reason.toLowerCase();
  const category: TaskDispatchHardeningState["category"] = normalizedReason.includes("trust boundary")
    ? "trust-boundary"
    : normalizedReason.includes("dispatch protocol")
      ? "dispatch-protocol"
      : normalizedReason.includes("auth")
        ? "authentication"
        : normalizedReason.includes("checkpoint")
          ? "checkpoint"
          : normalizedReason.includes("continuation")
            ? "continuation"
            : normalizedReason.includes("lease")
              ? "lease"
              : reason
                ? "other"
                : "none";

  if (envelope.dispatchTransportStatus === "accepted" || envelope.dispatchTransportStatus === "delivered" || envelope.dispatchTransportStatus === "completed") {
    return {
      state: "passed",
      category: category === "none" ? "none" : category,
      reason: reason || undefined,
    };
  }

  if (envelope.dispatchTransportStatus === "rejected") {
    return {
      state: envelope.status === "retrying" || envelope.recoveryPending ? "retryable-rejection" : "terminal-rejection",
      category,
      reason: reason || undefined,
    };
  }

  if (envelope.status === "rejected" || envelope.status === "failed" || envelope.status === "blocked") {
    return {
      state: "terminal-rejection",
      category,
      reason: reason || undefined,
    };
  }

  return {
    state: "unverified",
    category,
    reason: reason || undefined,
  };
}

export function deriveTaskRecoveryPlanningState(envelope: TaskEnvelope): TaskRecoveryPlanningState {
  const reason = normalizeText(envelope.failureReason || envelope.statusReason || envelope.continuationReason);
  const reasonCategory = categorizeRecoveryReason(reason);
  const safeStopPoint = normalizeText(envelope.lastProgressMarker)
    || (Number.isInteger(Number(envelope.stepIndex)) ? `step-${envelope.stepIndex}` : "")
    || undefined;

  if (envelope.status === "failed" || envelope.status === "rejected" || envelope.status === "blocked") {
    return {
      strategy: "fail-non-retryable",
      reasonCategory,
      safeStopPoint,
      reason: reason || undefined,
    };
  }

  if (!envelope.recoveryPending && envelope.status !== "retrying") {
    return {
      strategy: "none",
      reasonCategory,
      safeStopPoint,
      reason: reason || undefined,
    };
  }

  if (
    envelope.resumability === "resumable"
    && Boolean(normalizeText(envelope.continuationToken) || normalizeText(envelope.checkpointReference) || envelope.continuationGeneration > 0)
  ) {
    return {
      strategy: "resume-continuation",
      reasonCategory,
      safeStopPoint,
      reason: reason || undefined,
    };
  }

  if (envelope.recoveryPending || envelope.status === "retrying") {
    return {
      strategy: "restart-safe-boundary",
      reasonCategory,
      safeStopPoint,
      reason: reason || undefined,
    };
  }

  return {
    strategy: "none",
    reasonCategory,
    safeStopPoint,
    reason: reason || undefined,
  };
}

export function deriveTaskContinuationChainState(envelope: TaskEnvelope): TaskContinuationChainState {
  const recoveryPlanning = deriveTaskRecoveryPlanningState(envelope);
  const safeStopPoint = recoveryPlanning.safeStopPoint;
  const latestReason = recoveryPlanning.reason;

  if (isTerminalTaskStatus(envelope.status)) {
    return {
      state: "terminal",
      depth: Math.max(0, envelope.continuationGeneration),
      active: false,
      safeStopPoint,
      latestReason,
    };
  }

  if (recoveryPlanning.strategy === "restart-safe-boundary") {
    return {
      state: "restart-pending",
      depth: Math.max(0, envelope.continuationGeneration),
      active: envelope.status === "retrying" || envelope.status === "dispatching" || envelope.status === "awaiting-ack" || envelope.status === "executing" || envelope.status === "running",
      safeStopPoint,
      latestReason,
    };
  }

  if (envelope.continuationGeneration > 0) {
    return {
      state: envelope.recoveryPending ? "safe-stop" : "continuing",
      depth: Math.max(0, envelope.continuationGeneration),
      active: envelope.status !== "queued" && envelope.status !== "pending",
      safeStopPoint,
      latestReason,
    };
  }

  return {
    state: envelope.recoveryPending ? "safe-stop" : "fresh",
    depth: 0,
    active: envelope.status !== "queued" && envelope.status !== "pending",
    safeStopPoint,
    latestReason,
  };
}

function isTerminalTaskStatus(status: TaskEnvelopeStatus): boolean {
  return status === "completed" || status === "failed" || status === "blocked" || status === "rejected";
}