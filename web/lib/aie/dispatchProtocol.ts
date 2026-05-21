// =====================
// AI-E GOVERNED DISPATCH CONTRACTS (EXEC-0051-A) — RUNTIME INVOCATION
// =====================

/**
 * RUNTIME INVOCATION CONTRACT (see sandboxedRuntimeDispatch.ts for full contract)
 * Defines runtime invocation boundaries, timeout, stdout/stderr capture, and lifecycle transitions.
 */
export interface GovernedRuntimeDispatchContract {
  dispatchId: string;
  runtime: string;
  operationRequest: string;
  approval: unknown;
  mutationScope: unknown;
  invocationBoundary: RuntimeInvocationBoundary;
  lifecycle: DispatchLifecycleRecord[];
}

export interface RuntimeInvocationBoundary {
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  allowShell: false;
  allowNetwork: false;
  allowProductionMutation: false;
}

export interface RuntimeDispatchResult {
  dispatchId: string;
  startedAt: string;
  completedAt: string;
  outcome: string;
  stdout: string;
  stderr: string[];
  error?: string;
}

export interface DispatchLifecycleRecord {
  state: 'awaiting_approval' | 'dispatching' | 'executing' | 'completed' | 'failed';
  timestamp: string;
  message?: string;
}

// =====================
// END AI-E GOVERNED DISPATCH CONTRACTS (EXEC-0051-A)
// =====================
export type DispatchMessageType =
  | "task-dispatch-request"
  | "task-dispatch-ack"
  | "task-dispatch-result"
  | "task-dispatch-error";

export type DispatchProtocolVersion = "1";

export type DispatchEnvelope<TPayload = unknown> = {
  protocolVersion: DispatchProtocolVersion;
  messageType: DispatchMessageType;
  messageId: string;
  createdAt: string;
  sourceNodeId: string;
  targetNodeId: string;
  taskId: string;
  sessionId: string;
  payload: TPayload;
};

type CreateDispatchEnvelopeParams<TPayload> = {
  protocolVersion?: DispatchProtocolVersion;
  messageType: DispatchMessageType;
  messageId?: string;
  createdAt?: string;
  sourceNodeId: string;
  targetNodeId: string;
  taskId: string;
  sessionId: string;
  payload: TPayload;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function createTimestamp(): string {
  return new Date().toISOString();
}

function createMessageId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `aie-dispatch-${globalThis.crypto.randomUUID()}`;
  }

  return `aie-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isDispatchMessageType(value: unknown): value is DispatchMessageType {
  return (
    value === "task-dispatch-request" ||
    value === "task-dispatch-ack" ||
    value === "task-dispatch-result" ||
    value === "task-dispatch-error"
  );
}

function isDispatchProtocolVersion(value: unknown): value is DispatchProtocolVersion {
  return value === "1";
}

function isJsonSafe(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    return false;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonSafe(item));
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((item) => item === undefined || isJsonSafe(item));
  }

  return false;
}

export function createDispatchEnvelope<TPayload>(params: CreateDispatchEnvelopeParams<TPayload>): DispatchEnvelope<TPayload> {
  const envelope: DispatchEnvelope<TPayload> = {
    protocolVersion: params.protocolVersion ?? "1",
    messageType: params.messageType,
    messageId: normalizeText(params.messageId) || createMessageId(),
    createdAt: normalizeText(params.createdAt) || createTimestamp(),
    sourceNodeId: normalizeText(params.sourceNodeId),
    targetNodeId: normalizeText(params.targetNodeId),
    taskId: normalizeText(params.taskId),
    sessionId: normalizeText(params.sessionId),
    payload: params.payload,
  };

  if (!isDispatchEnvelope(envelope)) {
    throw new Error("The dispatch envelope is malformed or not serializable.");
  }

  return envelope;
}

export function summarizeDispatchEnvelope(envelope: DispatchEnvelope): string {
  return [
    `dispatch=${envelope.messageId}`,
    `type=${envelope.messageType}`,
    `version=${envelope.protocolVersion}`,
    `source=${envelope.sourceNodeId}`,
    `target=${envelope.targetNodeId}`,
    `task=${envelope.taskId}`,
    `session=${envelope.sessionId}`,
  ].join(" | ");
}

export function isDispatchEnvelope(value: unknown): value is DispatchEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }

  const source = value as Record<string, unknown>;
  return Boolean(
    isDispatchProtocolVersion(source.protocolVersion) &&
      isDispatchMessageType(source.messageType) &&
      normalizeText(source.messageId) &&
      normalizeText(source.createdAt) &&
      normalizeText(source.sourceNodeId) &&
      normalizeText(source.targetNodeId) &&
      normalizeText(source.taskId) &&
      normalizeText(source.sessionId) &&
      Object.prototype.hasOwnProperty.call(source, "payload") &&
      isJsonSafe(source.payload),
  );
}

export function serializeDispatchEnvelope<TPayload>(envelope: DispatchEnvelope<TPayload>): string {
  if (!isDispatchEnvelope(envelope)) {
    throw new Error("The dispatch envelope cannot be serialized because it is malformed.");
  }

  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function deserializeDispatchEnvelope(raw: string): DispatchEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isDispatchEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
