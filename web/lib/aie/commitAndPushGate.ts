import type { CommitGateResult } from "./commitGate";

export type ApprovalStatus =
  | "commit_awaiting_approval"
  | "commit_approved"
  | "commit_blocked"
  | "push_awaiting_approval"
  | "push_approved"
  | "push_blocked";

export type ApprovalBlocker = {
  code:
    | "missing_commit_gate_result"
    | "commit_not_ready"
    | "commit_gate_blocked"
    | "commit_gate_needs_review"
    | "commit_approval_required"
    | "commit_not_approved"
    | "push_approval_required";
  message: string;
  recommended_action: "approve" | "review" | "block";
};

export type ApprovalLog = {
  log_id: string;
  created_at: string;
  stage: "commit" | "push";
  approval_requested: boolean;
  approval_received: boolean;
  status: ApprovalStatus;
  outcome: "approved" | "awaiting_approval" | "blocked";
  explanation: string;
};

export type CommitApprovalInput = {
  commitGateResult: CommitGateResult | null;
  approval: boolean;
  createdAt?: string;
};

export type CommitApprovalResult = {
  status: "commit_awaiting_approval" | "commit_approved" | "commit_blocked";
  blockers: ApprovalBlocker[];
  approval_log: ApprovalLog;
  explanation: string;
};

export type PushApprovalInput = {
  commitApprovalResult: CommitApprovalResult | null;
  approval: boolean;
  createdAt?: string;
};

export type PushApprovalResult = {
  status: "push_awaiting_approval" | "push_approved" | "push_blocked";
  blockers: ApprovalBlocker[];
  approval_log: ApprovalLog;
  explanation: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildApprovalLogId(stage: "commit" | "push", createdAt: string): string {
  return `${stage}-approval-log-${sanitizeTimestamp(createdAt)}`;
}

export function buildApprovalLog(input: {
  stage: "commit" | "push";
  approval: boolean;
  createdAt?: string;
  status: ApprovalStatus;
  explanation: string;
}): ApprovalLog {
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  return {
    log_id: buildApprovalLogId(input.stage, createdAt),
    created_at: createdAt,
    stage: input.stage,
    approval_requested: true,
    approval_received: input.approval,
    status: input.status,
    outcome: input.status.endsWith("approved")
      ? "approved"
      : input.status.endsWith("awaiting_approval")
        ? "awaiting_approval"
        : "blocked",
    explanation: input.explanation,
  };
}

export function evaluateCommitApproval(input: CommitApprovalInput): CommitApprovalResult {
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const blockers: ApprovalBlocker[] = [];

  if (!input.commitGateResult) {
    blockers.push({
      code: "missing_commit_gate_result",
      message: "Commit approval requires a commit gate result before approval can be evaluated.",
      recommended_action: "review",
    });
  }

  if (input.commitGateResult?.status === "commit_blocked") {
    blockers.push({
      code: "commit_gate_blocked",
      message: "Commit approval remains blocked because the commit gate did not allow this change set to proceed.",
      recommended_action: "block",
    });
  }

  if (input.commitGateResult?.status === "commit_needs_review") {
    blockers.push({
      code: "commit_gate_needs_review",
      message: "Commit approval remains blocked until the commit gate review requirements are resolved.",
      recommended_action: "review",
    });
  }

  if (input.commitGateResult && input.commitGateResult.status !== "commit_ready") {
    blockers.push({
      code: "commit_not_ready",
      message: `Commit approval requires a commit_ready result, but received ${input.commitGateResult.status}.`,
      recommended_action: "review",
    });
  }

  let status: CommitApprovalResult["status"];
  let explanation: string;

  if (blockers.length > 0) {
    status = "commit_blocked";
    explanation = `Commit approval is blocked because ${blockers.map((blocker) => blocker.message).join(" ")}`;
  } else if (input.approval !== true) {
    blockers.push({
      code: "commit_approval_required",
      message: "Commit approval requires an explicit true approval flag from the operator.",
      recommended_action: "approve",
    });
    status = "commit_awaiting_approval";
    explanation = "Commit is ready but remains awaiting explicit operator approval.";
  } else {
    status = "commit_approved";
    explanation = "Commit approval received explicitly after the change set passed the commit gate.";
  }

  return {
    status,
    blockers,
    approval_log: buildApprovalLog({
      stage: "commit",
      approval: input.approval,
      createdAt,
      status,
      explanation,
    }),
    explanation,
  };
}

export function evaluatePushApproval(input: PushApprovalInput): PushApprovalResult {
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const blockers: ApprovalBlocker[] = [];

  if (!input.commitApprovalResult) {
    blockers.push({
      code: "missing_commit_gate_result",
      message: "Push approval requires a prior commit approval result.",
      recommended_action: "review",
    });
  }

  if (input.commitApprovalResult && input.commitApprovalResult.status !== "commit_approved") {
    blockers.push({
      code: "commit_not_approved",
      message: `Push approval requires commit_approved, but received ${input.commitApprovalResult.status}.`,
      recommended_action: "review",
    });
  }

  let status: PushApprovalResult["status"];
  let explanation: string;

  if (blockers.length > 0) {
    status = "push_blocked";
    explanation = `Push approval is blocked because ${blockers.map((blocker) => blocker.message).join(" ")}`;
  } else if (input.approval !== true) {
    blockers.push({
      code: "push_approval_required",
      message: "Push approval requires a separate explicit true approval flag from the operator.",
      recommended_action: "approve",
    });
    status = "push_awaiting_approval";
    explanation = "Push is eligible but remains awaiting explicit operator approval.";
  } else {
    status = "push_approved";
    explanation = "Push approval received explicitly after commit approval was granted.";
  }

  return {
    status,
    blockers,
    approval_log: buildApprovalLog({
      stage: "push",
      approval: input.approval,
      createdAt,
      status,
      explanation,
    }),
    explanation,
  };
}

export function summarizeApproval(result: CommitApprovalResult | PushApprovalResult): string {
  return [
    `Approval status: ${result.status}`,
    `Stage: ${result.approval_log.stage}`,
    `Outcome: ${result.approval_log.outcome}`,
    `Explanation: ${result.explanation}`,
  ].join("\n");
}