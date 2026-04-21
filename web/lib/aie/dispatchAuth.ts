import { createHash } from "node:crypto";

import type { DispatchEnvelope, DispatchProtocolVersion } from "./dispatchProtocol";

export type DispatchAuthToken = {
  scheme: "lab-sha256";
  scope: "local-lab";
  sourceNodeId: string;
  targetNodeId: string;
  taskId: string;
  sessionId: string;
  protocolVersion: DispatchProtocolVersion;
  issuedAt: string;
  expiresAt: string;
  token: string;
};

export type DispatchAuthValidationResult = {
  valid: boolean;
  reason?: string;
  summary: string;
};

type CreateDispatchAuthTokenParams = {
  sourceNodeId: string;
  targetNodeId: string;
  taskId: string;
  sessionId: string;
  protocolVersion?: DispatchProtocolVersion;
  issuedAt?: string;
  ttlSeconds?: number;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function createTimestamp(): string {
  return new Date().toISOString();
}

function getDispatchSharedSecret(): string {
  return normalizeText(process.env.AIE_DISPATCH_SHARED_SECRET) || "ai-e-local-lab-dispatch-secret-v1";
}

function buildDispatchAuthSeed(params: {
  sourceNodeId: string;
  targetNodeId: string;
  taskId: string;
  sessionId: string;
  protocolVersion: DispatchProtocolVersion;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    params.protocolVersion,
    params.sourceNodeId,
    params.targetNodeId,
    params.taskId,
    params.sessionId,
    params.issuedAt,
    params.expiresAt,
    "local-lab",
    getDispatchSharedSecret(),
  ].join("|");
}

function createDigest(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

export function validateDispatchAuthTokenShape(value: unknown): value is DispatchAuthToken {
  if (!value || typeof value !== "object") {
    return false;
  }

  const source = value as Record<string, unknown>;
  return Boolean(
    source.scheme === "lab-sha256" &&
      source.scope === "local-lab" &&
      normalizeText(source.sourceNodeId) &&
      normalizeText(source.targetNodeId) &&
      normalizeText(source.taskId) &&
      normalizeText(source.sessionId) &&
      source.protocolVersion === "1" &&
      normalizeText(source.issuedAt) &&
      normalizeText(source.expiresAt) &&
      normalizeText(source.token),
  );
}

export function summarizeDispatchAuthContext(params: {
  sourceNodeId: string;
  targetNodeId: string;
  valid?: boolean;
  reason?: string;
  expiresAt?: string;
}): string {
  return [
    `auth=${normalizeText(params.sourceNodeId) || "unknown"}->${normalizeText(params.targetNodeId) || "unknown"}`,
    "scope=local-lab",
    typeof params.valid === "boolean" ? `valid=${String(params.valid)}` : "",
    normalizeText(params.expiresAt) ? `expires=${normalizeText(params.expiresAt)}` : "",
    normalizeText(params.reason) ? `reason=${normalizeText(params.reason)}` : "",
  ].filter(Boolean).join(" | ");
}

export function createDispatchAuthToken(params: CreateDispatchAuthTokenParams): DispatchAuthToken {
  const issuedAt = normalizeText(params.issuedAt) || createTimestamp();
  const ttlSeconds = Math.max(30, Math.floor(params.ttlSeconds ?? 300));
  const expiresAt = new Date(Date.parse(issuedAt) + ttlSeconds * 1000).toISOString();
  const protocolVersion = params.protocolVersion ?? "1";

  return {
    scheme: "lab-sha256",
    scope: "local-lab",
    sourceNodeId: normalizeText(params.sourceNodeId),
    targetNodeId: normalizeText(params.targetNodeId),
    taskId: normalizeText(params.taskId),
    sessionId: normalizeText(params.sessionId),
    protocolVersion,
    issuedAt,
    expiresAt,
    token: createDigest(buildDispatchAuthSeed({
      sourceNodeId: normalizeText(params.sourceNodeId),
      targetNodeId: normalizeText(params.targetNodeId),
      taskId: normalizeText(params.taskId),
      sessionId: normalizeText(params.sessionId),
      protocolVersion,
      issuedAt,
      expiresAt,
    })),
  };
}

export function validateDispatchAuthToken(params: {
  authToken: DispatchAuthToken;
  envelope: Pick<DispatchEnvelope, "protocolVersion" | "sourceNodeId" | "targetNodeId" | "taskId" | "sessionId">;
  now?: string;
}): DispatchAuthValidationResult {
  if (!validateDispatchAuthTokenShape(params.authToken)) {
    return {
      valid: false,
      reason: "The dispatch auth token is malformed.",
      summary: summarizeDispatchAuthContext({
        sourceNodeId: "unknown",
        targetNodeId: "unknown",
        valid: false,
        reason: "malformed",
      }),
    };
  }

  const authToken = params.authToken;
  if (
    authToken.sourceNodeId !== params.envelope.sourceNodeId ||
    authToken.targetNodeId !== params.envelope.targetNodeId ||
    authToken.taskId !== params.envelope.taskId ||
    authToken.sessionId !== params.envelope.sessionId ||
    authToken.protocolVersion !== params.envelope.protocolVersion
  ) {
    return {
      valid: false,
      reason: "The dispatch auth token does not match the envelope identity.",
      summary: summarizeDispatchAuthContext({
        sourceNodeId: authToken.sourceNodeId,
        targetNodeId: authToken.targetNodeId,
        valid: false,
        reason: "envelope-mismatch",
        expiresAt: authToken.expiresAt,
      }),
    };
  }

  const now = Date.parse(normalizeText(params.now) || createTimestamp());
  if (!Number.isFinite(now) || now > Date.parse(authToken.expiresAt)) {
    return {
      valid: false,
      reason: "The dispatch auth token has expired.",
      summary: summarizeDispatchAuthContext({
        sourceNodeId: authToken.sourceNodeId,
        targetNodeId: authToken.targetNodeId,
        valid: false,
        reason: "expired",
        expiresAt: authToken.expiresAt,
      }),
    };
  }

  const expectedToken = createDigest(buildDispatchAuthSeed(authToken));
  const valid = expectedToken === authToken.token;

  return {
    valid,
    reason: valid ? undefined : "The dispatch auth token digest does not match the lab shared secret.",
    summary: summarizeDispatchAuthContext({
      sourceNodeId: authToken.sourceNodeId,
      targetNodeId: authToken.targetNodeId,
      valid,
      reason: valid ? undefined : "digest-mismatch",
      expiresAt: authToken.expiresAt,
    }),
  };
}