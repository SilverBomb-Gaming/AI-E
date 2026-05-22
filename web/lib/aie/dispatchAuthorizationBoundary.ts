// AI-E DISPATCH AUTHORIZATION BOUNDARY (EXEC-0051-B)
// This module defines the explicit authorization, idempotency, replay, and duplicate prevention boundary for governed sandbox dispatch.
// No real execution, no API route, no backend wiring.

import type { GovernedExecutionApproval } from "./sandboxedRuntimeDispatch";

export type DispatchAuthorizationToken = {
  token: string;
  sandboxId: string;
  operationRequest: string;
  issuedBy: string;
  issuedAt: string;
  expiresAt: string;
  approvalId: string;
  idempotencyKey: string;
};

export type DispatchAuthorizationResult = {
  authorized: boolean;
  reason?: string;
  token: DispatchAuthorizationToken;
  checkedAt: string;
};

export type DispatchReplayGuard = {
  replayed: boolean;
  reason?: string;
  idempotencyKey: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type DispatchIdempotencyKey = string & { readonly __idempotency: unique symbol };

export type DispatchAuthorizationReceipt = {
  authorizationToken: DispatchAuthorizationToken;
  result: DispatchAuthorizationResult;
  replayGuard: DispatchReplayGuard;
  duplicatePrevention: DispatchDuplicatePreventionResult;
  checkedAt: string;
};

export type DispatchApprovalExpiry = {
  expired: boolean;
  expiresAt: string;
  checkedAt: string;
  reason?: string;
};

export type DispatchDuplicatePreventionResult = {
  duplicate: boolean;
  idempotencyKey: string;
  firstDispatchAt: string;
  lastDispatchAt: string;
  reason?: string;
};

// Utility: Generate idempotency key from sandbox, operation, and approval
export function createDispatchIdempotencyKey(params: {
  sandboxId: string;
  operationRequest: string;
  approvalId: string;
}): DispatchIdempotencyKey {
  return `${params.sandboxId}::${params.operationRequest}::${params.approvalId}` as DispatchIdempotencyKey;
}

// Utility: Check if approval is expired
export function checkDispatchApprovalExpiry(params: {
  expiresAt: string;
  now?: string;
}): DispatchApprovalExpiry {
  const now = params.now ? new Date(params.now) : new Date();
  const expires = new Date(params.expiresAt);
  return {
    expired: now > expires,
    expiresAt: params.expiresAt,
    checkedAt: now.toISOString(),
    reason: now > expires ? "approval-expired" : undefined,
  };
}

// Utility: Check for replay/duplicate using a simple in-memory map (for test/demo only)
export const dispatchReplayMap = new Map<string, { firstSeenAt: string; lastSeenAt: string }>();

export function checkDispatchReplayGuard(idempotencyKey: string, now?: string): DispatchReplayGuard & { firstSeen: boolean } {
  const ts = now || new Date().toISOString();
  const entry = dispatchReplayMap.get(idempotencyKey);
  if (entry) {
    dispatchReplayMap.set(idempotencyKey, { firstSeenAt: entry.firstSeenAt, lastSeenAt: ts });
    return {
      replayed: true,
      reason: "replay-or-duplicate-dispatch",
      idempotencyKey,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: ts,
      firstSeen: false,
    };
  }
  dispatchReplayMap.set(idempotencyKey, { firstSeenAt: ts, lastSeenAt: ts });
  return {
    replayed: false,
    idempotencyKey,
    firstSeenAt: ts,
    lastSeenAt: ts,
    firstSeen: true,
  };
}

// Utility: Check for duplicate dispatch (idempotent return)
export function checkDispatchDuplicatePrevention(idempotencyKey: string, now?: string, firstSeen?: boolean): DispatchDuplicatePreventionResult {
  const ts = now || new Date().toISOString();
  const entry = dispatchReplayMap.get(idempotencyKey);
  if (entry && firstSeen === false) {
    return {
      duplicate: true,
      idempotencyKey,
      firstDispatchAt: entry.firstSeenAt,
      lastDispatchAt: entry.lastSeenAt,
      reason: "duplicate-dispatch-idempotent-return",
    };
  }
  // Do NOT set the map here; only checkDispatchReplayGuard should set it.
  return {
    duplicate: false,
    idempotencyKey,
    firstDispatchAt: ts,
    lastDispatchAt: ts,
  };
}

// Main: Authorize dispatch (no real execution)
export function authorizeDispatch(params: {
  approval: GovernedExecutionApproval;
  sandboxId: string;
  operationRequest: string;
  expiresAt: string;
  now?: string;
}): DispatchAuthorizationReceipt {
  const now = params.now || new Date().toISOString();
  const approvalId = `${params.approval.authorityToken}:${params.approval.proposalId}`;
  const idempotencyKey = createDispatchIdempotencyKey({
    sandboxId: params.sandboxId,
    operationRequest: params.operationRequest,
    approvalId,
  });
  const expiry = checkDispatchApprovalExpiry({ expiresAt: params.expiresAt, now });
  const replayGuard = checkDispatchReplayGuard(idempotencyKey, now);
  // Only check duplicate prevention if not already replayed, and pass firstSeen flag
  const duplicatePrevention = replayGuard.replayed
    ? {
        duplicate: true,
        idempotencyKey,
        firstDispatchAt: replayGuard.firstSeenAt,
        lastDispatchAt: replayGuard.lastSeenAt,
        reason: "duplicate-dispatch-idempotent-return",
      }
    : checkDispatchDuplicatePrevention(idempotencyKey, now, replayGuard.firstSeen);
  const token: DispatchAuthorizationToken = {
    token: approvalId,
    sandboxId: params.sandboxId,
    operationRequest: params.operationRequest,
    issuedBy: params.approval.approvedBy,
    issuedAt: params.approval.approvedAt,
    expiresAt: params.expiresAt,
    approvalId,
    idempotencyKey,
  };
  const authorized = !expiry.expired && !replayGuard.replayed && !duplicatePrevention.duplicate;
  return {
    authorizationToken: token,
    result: {
      authorized,
      reason: !authorized ? expiry.reason || replayGuard.reason || duplicatePrevention.reason : undefined,
      token,
      checkedAt: now,
    },
    replayGuard,
    duplicatePrevention,
    checkedAt: now,
  };
}
