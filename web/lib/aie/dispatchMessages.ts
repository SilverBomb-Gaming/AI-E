import type { DispatchEnvelope, DispatchMessageType, DispatchProtocolVersion } from "./dispatchProtocol";
import { validateDispatchAuthTokenShape, type DispatchAuthToken } from "./dispatchAuth";
import type { ExecutionNodeCapability } from "./executionNode";
import type { TaskResumability } from "./taskEnvelope";
import type { ExecutionActionPreview as ExecutionAction, ExecutionRuntimeResult } from "./types";

export type TaskDispatchApprovalState = {
  requiresApproval: boolean;
  approved?: boolean;
};

export type TaskDispatchLeasePayload = {
  leaseId: string;
  ownerNodeId: string;
  epoch: number;
  continuationToken?: string;
  checkpointReference?: string;
  resumability?: TaskResumability;
};

export type TaskDispatchRequestPayload = {
  action: ExecutionAction;
  requestedCapabilities: ExecutionNodeCapability[];
  assignedNodeId: string;
  lease: TaskDispatchLeasePayload;
  authToken: DispatchAuthToken;
  approvalState?: TaskDispatchApprovalState;
  executionContextSummary?: string;
  policySummary?: string;
  traceContextSummary?: string;
  queueStateSummary?: string;
  planningHintSummary?: string;
  dispatchStatusSummary?: string;
  dispatchAuthSummary?: string;
  remoteDispatchPlanned?: boolean;
};

export type TaskDispatchAckPayload = {
  accepted: boolean;
  reason?: string;
};

export type TaskDispatchResultPayload = {
  status: "completed" | "failed" | "blocked";
  executionResult?: ExecutionRuntimeResult;
  linkedSessionId?: string;
  linkedTaskId?: string;
  summary?: string;
};

export type TaskDispatchErrorPayload = {
  error: string;
  retryable: boolean;
};

export type DispatchEnvelopePayload =
  | TaskDispatchRequestPayload
  | TaskDispatchAckPayload
  | TaskDispatchResultPayload
  | TaskDispatchErrorPayload;

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isExecutionNodeCapability(value: unknown): value is ExecutionNodeCapability {
  return (
    value === "inspection" ||
    value === "validation-check" ||
    value === "file-write" ||
    value === "test-run" ||
    value === "repo-scan"
  );
}

function isExecutionRuntimeResult(value: unknown): value is ExecutionRuntimeResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const source = value as Record<string, unknown>;
  return source.status === "success" || source.status === "failed" || source.status === "blocked";
}

function isExecutionAction(value: unknown): value is ExecutionAction {
  if (!value || typeof value !== "object") {
    return false;
  }

  const source = value as Record<string, unknown>;
  return Boolean(
    normalizeText(source.id) &&
      normalizeText(source.description) &&
      normalizeText(source.expectedOutcome) &&
      source.requiresApproval === true &&
      typeof source.metadata === "object" &&
      (source.scope === "safe" || source.scope === "caution" || source.scope === "dangerous"),
  );
}

function isTaskResumability(value: unknown): value is TaskResumability {
  return value === "resumable" || value === "restart-required";
}

function isTaskDispatchLeasePayload(value: unknown): value is TaskDispatchLeasePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const source = value as Record<string, unknown>;
  return Boolean(
    normalizeText(source.leaseId)
      && normalizeText(source.ownerNodeId)
      && Number.isInteger(Number(source.epoch))
      && Number(source.epoch) >= 1
      && (!source.continuationToken || normalizeText(source.continuationToken))
      && (!source.checkpointReference || normalizeText(source.checkpointReference))
      && (!source.resumability || isTaskResumability(source.resumability)),
  );
}

export function createTaskDispatchRequest(payload: TaskDispatchRequestPayload): TaskDispatchRequestPayload {
  const normalized: TaskDispatchRequestPayload = {
    action: payload.action,
    requestedCapabilities: payload.requestedCapabilities.filter(isExecutionNodeCapability),
    assignedNodeId: normalizeText(payload.assignedNodeId),
    lease: {
      leaseId: normalizeText(payload.lease.leaseId),
      ownerNodeId: normalizeText(payload.lease.ownerNodeId),
      epoch: Math.max(1, Math.floor(Number(payload.lease.epoch ?? 1))),
      continuationToken: normalizeText(payload.lease.continuationToken) || undefined,
      checkpointReference: normalizeText(payload.lease.checkpointReference) || undefined,
      resumability: isTaskResumability(payload.lease.resumability) ? payload.lease.resumability : undefined,
    },
    authToken: payload.authToken,
    approvalState: payload.approvalState
      ? {
          requiresApproval: Boolean(payload.approvalState.requiresApproval),
          approved: typeof payload.approvalState.approved === "boolean" ? payload.approvalState.approved : undefined,
        }
      : undefined,
    executionContextSummary: normalizeText(payload.executionContextSummary) || undefined,
    policySummary: normalizeText(payload.policySummary) || undefined,
    traceContextSummary: normalizeText(payload.traceContextSummary) || undefined,
    queueStateSummary: normalizeText(payload.queueStateSummary) || undefined,
    planningHintSummary: normalizeText(payload.planningHintSummary) || undefined,
    dispatchStatusSummary: normalizeText(payload.dispatchStatusSummary) || undefined,
    dispatchAuthSummary: normalizeText(payload.dispatchAuthSummary) || undefined,
    remoteDispatchPlanned: typeof payload.remoteDispatchPlanned === "boolean" ? payload.remoteDispatchPlanned : undefined,
  };

  if (!validateDispatchPayloadShape("task-dispatch-request", normalized)) {
    throw new Error("The task dispatch request payload is malformed.");
  }

  return normalized;
}

export function createTaskDispatchAck(payload: TaskDispatchAckPayload): TaskDispatchAckPayload {
  const normalized = {
    accepted: Boolean(payload.accepted),
    reason: normalizeText(payload.reason) || undefined,
  };

  if (!validateDispatchPayloadShape("task-dispatch-ack", normalized)) {
    throw new Error("The task dispatch acknowledgment payload is malformed.");
  }

  return normalized;
}

export function createTaskDispatchResult(payload: TaskDispatchResultPayload): TaskDispatchResultPayload {
  const normalized = {
    status: payload.status,
    executionResult: payload.executionResult,
    linkedSessionId: normalizeText(payload.linkedSessionId) || undefined,
    linkedTaskId: normalizeText(payload.linkedTaskId) || undefined,
    summary: normalizeText(payload.summary) || undefined,
  };

  if (!validateDispatchPayloadShape("task-dispatch-result", normalized)) {
    throw new Error("The task dispatch result payload is malformed.");
  }

  return normalized;
}

export function createTaskDispatchError(payload: TaskDispatchErrorPayload): TaskDispatchErrorPayload {
  const normalized = {
    error: normalizeText(payload.error),
    retryable: Boolean(payload.retryable),
  };

  if (!validateDispatchPayloadShape("task-dispatch-error", normalized)) {
    throw new Error("The task dispatch error payload is malformed.");
  }

  return normalized;
}

export function validateDispatchPayloadShape(messageType: DispatchMessageType, payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const source = payload as Record<string, unknown>;
  switch (messageType) {
    case "task-dispatch-request":
      return Boolean(
        isExecutionAction(source.action) &&
          Array.isArray(source.requestedCapabilities) &&
          source.requestedCapabilities.every((item) => isExecutionNodeCapability(item)) &&
          normalizeText(source.assignedNodeId) &&
          isTaskDispatchLeasePayload(source.lease) &&
          validateDispatchAuthTokenShape(source.authToken),
      );
    case "task-dispatch-ack":
      return typeof source.accepted === "boolean" && (!source.reason || Boolean(normalizeText(source.reason)));
    case "task-dispatch-result":
      return Boolean(
        (source.status === "completed" || source.status === "failed" || source.status === "blocked") &&
          (!source.executionResult || isExecutionRuntimeResult(source.executionResult)) &&
          (!source.linkedSessionId || normalizeText(source.linkedSessionId)) &&
          (!source.linkedTaskId || normalizeText(source.linkedTaskId)),
      );
    case "task-dispatch-error":
      return Boolean(normalizeText(source.error) && typeof source.retryable === "boolean");
    default:
      return false;
  }
}

export function summarizeDispatchPayload(
  messageType: DispatchMessageType,
  payload: unknown,
  protocolVersion: DispatchProtocolVersion = "1",
): string {
  if (!validateDispatchPayloadShape(messageType, payload)) {
    return `dispatch=${protocolVersion} | type=${messageType} | payload=invalid`;
  }

  const source = payload as Record<string, unknown>;
  switch (messageType) {
    case "task-dispatch-request":
      return [
        `dispatch=${protocolVersion}`,
        "type=request",
        `node=${normalizeText(source.assignedNodeId)}`,
        `lease=${normalizeText((source.lease as Record<string, unknown> | undefined)?.leaseId) || "unknown"}`,
        `epoch=${normalizeText((source.lease as Record<string, unknown> | undefined)?.epoch) || "unknown"}`,
        `caps=${Array.isArray(source.requestedCapabilities) ? source.requestedCapabilities.join(",") : "none"}`,
        `approval=${source.approvalState && typeof source.approvalState === "object" ? String(Boolean((source.approvalState as Record<string, unknown>).requiresApproval)) : "unknown"}`,
        (source.lease as Record<string, unknown> | undefined)?.resumability ? `resumability=${normalizeText((source.lease as Record<string, unknown>).resumability)}` : "",
        source.dispatchAuthSummary && typeof source.dispatchAuthSummary === "string" ? `auth=${normalizeText(source.dispatchAuthSummary)}` : "",
      ].join(" | ");
    case "task-dispatch-ack":
      return [
        `dispatch=${protocolVersion}`,
        "type=ack",
        `accepted=${String(Boolean(source.accepted))}`,
        normalizeText(source.reason) ? `reason=${normalizeText(source.reason)}` : "",
      ].filter(Boolean).join(" | ");
    case "task-dispatch-result":
      return [
        `dispatch=${protocolVersion}`,
        "type=result",
        `status=${normalizeText(source.status)}`,
        normalizeText(source.linkedTaskId) ? `task=${normalizeText(source.linkedTaskId)}` : "",
        normalizeText(source.summary) ? `summary=${normalizeText(source.summary)}` : "",
      ].filter(Boolean).join(" | ");
    case "task-dispatch-error":
      return [
        `dispatch=${protocolVersion}`,
        "type=error",
        `retryable=${String(Boolean(source.retryable))}`,
        `error=${normalizeText(source.error)}`,
      ].join(" | ");
  }
}

export function validateDispatchEnvelopePayload(envelope: DispatchEnvelope): boolean {
  return validateDispatchPayloadShape(envelope.messageType, envelope.payload);
}
