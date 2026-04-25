import type { AutonomousTaskChain } from "./autonomousTaskChain";

export type FreshnessStatus = "fresh" | "stale" | "expired" | "requires_reapproval" | "requires_revalidation";

export type StalenessReason =
  | "approval-expired"
  | "approval-missing"
  | "context-stale"
  | "validation-stale"
  | "chain-updated-since-approval"
  | "freshness-window-elapsed";

export type ApprovalType = "chain" | "step" | "commit" | "push";

export type ApprovalState = {
  approval_type: ApprovalType;
  granted_at: string | null;
  expires_at: string | null;
  requires_reapproval: boolean;
};

export type ApprovalFreshnessResult = {
  status: FreshnessStatus;
  reasons: StalenessReason[];
  approval_state: ApprovalState;
  explanation: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function parseTimestamp(value: string | null | undefined): number | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function isApprovalExpired(approvalState: ApprovalState, now: string): boolean {
  const expiresAt = parseTimestamp(approvalState.expires_at);
  const nowMs = parseTimestamp(now);
  if (expiresAt === null || nowMs === null) {
    return false;
  }

  return nowMs > expiresAt;
}

export function evaluateApprovalFreshness(input: {
  approvalState: ApprovalState;
  now?: string;
}): ApprovalFreshnessResult {
  const now = normalizeText(input.now) || new Date().toISOString();
  const reasons: StalenessReason[] = [];
  const approvalState = input.approvalState;

  if (!normalizeText(approvalState.granted_at)) {
    reasons.push("approval-missing");
  }

  if (approvalState.requires_reapproval === true) {
    reasons.push("approval-missing");
  }

  if (isApprovalExpired(approvalState, now)) {
    reasons.push("approval-expired");
  }

  const status: FreshnessStatus = reasons.includes("approval-expired")
    ? "expired"
    : reasons.includes("approval-missing")
      ? "requires_reapproval"
      : "fresh";

  return {
    status,
    reasons: unique(reasons),
    approval_state: approvalState,
    explanation: status === "fresh"
      ? `Approval ${approvalState.approval_type} is still fresh within its validity window.`
      : `Approval ${approvalState.approval_type} is not fresh because ${unique(reasons).join(", ")}.`,
  };
}

export function evaluateContextStaleness(input: {
  chain: AutonomousTaskChain;
  contextSnapshot: {
    chain_updated_at: string;
    validation_completed_at: string | null;
    stale_after_ms: number;
  };
  now?: string;
}): { status: FreshnessStatus; reasons: StalenessReason[]; explanation: string } {
  const now = parseTimestamp(input.now || new Date().toISOString());
  const chainUpdatedAt = parseTimestamp(input.contextSnapshot.chain_updated_at);
  const validationCompletedAt = parseTimestamp(input.contextSnapshot.validation_completed_at);
  const reasons: StalenessReason[] = [];

  if (now !== null && chainUpdatedAt !== null && now - chainUpdatedAt > input.contextSnapshot.stale_after_ms) {
    reasons.push("context-stale");
    reasons.push("freshness-window-elapsed");
  }

  if (now !== null && validationCompletedAt !== null && now - validationCompletedAt > input.contextSnapshot.stale_after_ms) {
    reasons.push("validation-stale");
  }

  if (chainUpdatedAt !== null && parseTimestamp(input.chain.created_at) !== null && chainUpdatedAt < parseTimestamp(input.chain.created_at)!) {
    reasons.push("chain-updated-since-approval");
  }

  const status: FreshnessStatus = reasons.length > 0 ? "requires_revalidation" : "fresh";
  return {
    status,
    reasons: unique(reasons),
    explanation: status === "fresh"
      ? "Chain context remains fresh enough for supervised continuation."
      : `Chain context requires revalidation because ${unique(reasons).join(", ")}.`,
  };
}

export function requireReapprovalIfNeeded(input: {
  chain: AutonomousTaskChain;
  approvalStates: ApprovalState[];
  now?: string;
}): { status: FreshnessStatus; reasons: StalenessReason[]; approvals_requiring_reapproval: ApprovalType[]; explanation: string } {
  const freshnessResults = input.approvalStates.map((approvalState) => evaluateApprovalFreshness({
    approvalState,
    now: input.now,
  }));
  const requiring = freshnessResults
    .filter((result) => result.status === "expired" || result.status === "requires_reapproval")
    .map((result) => result.approval_state.approval_type);
  const reasons = unique(freshnessResults.flatMap((result) => result.reasons));

  return {
    status: requiring.length > 0 ? "requires_reapproval" : "fresh",
    reasons,
    approvals_requiring_reapproval: unique(requiring),
    explanation: requiring.length > 0
      ? `Chain ${input.chain.chain_id} requires renewed approval for: ${unique(requiring).join(", ")}.`
      : `Chain ${input.chain.chain_id} does not require renewed approval at this time.`,
  };
}