import type { ControlledExecutionResult } from "./controlledPatchExecutor";
import { summarizeValidation, type ControlledValidationResult } from "./controlledExecutionValidation";
import type { ReviewedPatchApplicationPacket } from "./reviewedPatchApplicationExecutor";

export type CommitGateStatus = "commit_ready" | "commit_blocked" | "commit_needs_review";

export type CommitBlocker = {
  code:
    | "missing_validation_result"
    | "missing_application_packet"
    | "missing_required_review_flags"
    | "missing_validation_signals"
    | "validation_failed"
    | "validation_blocked"
    | "rollback_recommended"
    | "unexpected_file_change"
    | "critical_failure"
    | "high_risk"
    | "medium_risk_review"
    | "playtest_required"
    | "validation_review_required";
  message: string;
  severity: "critical" | "review";
  recommended_action: "commit" | "review" | "rollback";
};

export type CompletionReport = {
  report_id: string;
  created_at: string;
  original_request: string;
  interpreted_goal: string;
  files_changed: string[];
  diff_summary: string[];
  validation_result: ControlledValidationResult["status"] | "missing_validation_result";
  validation_summary: string;
  risk_level: ReviewedPatchApplicationPacket["risk_level"] | "unknown";
  rollback_available: boolean;
  recommended_action: "commit" | "review" | "rollback";
  explanation: string;
};

export type CommitGateInput = {
  validationResult: ControlledValidationResult | null;
  executionResult: ControlledExecutionResult | null;
  applicationPacket: ReviewedPatchApplicationPacket | null;
  originalRequest?: string;
  createdAt?: string;
};

export type CommitGateResult = {
  status: CommitGateStatus;
  blockers: CommitBlocker[];
  recommended_action: "commit" | "review" | "rollback";
  explanation: string;
  completion_report: CompletionReport;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function normalizePath(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildReportId(validationId: string | undefined, applicationPacketId: string | undefined, createdAt: string): string {
  const suffix = validationId ?? applicationPacketId ?? "no-validation";
  return `completion-report-${createdAt.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000"}-${suffix}`;
}

function buildFilesChanged(input: CommitGateInput): string[] {
  const changedFiles = input.executionResult?.changed_files ?? [];
  const previewFiles = input.executionResult?.preview_diff.map((diff) => diff.file_path) ?? [];
  const validationFiles = input.validationResult?.report.checked_files ?? [];
  return unique([...changedFiles, ...previewFiles, ...validationFiles].map((filePath) => normalizePath(filePath)).filter(Boolean));
}

function buildDiffSummary(input: CommitGateInput): string[] {
  const previewDiff = input.executionResult?.preview_diff ?? [];
  return previewDiff.map((diff) => {
    const filePath = normalizePath(diff.file_path);
    const summary = normalizeText(diff.summary_of_change) || `Reviewed ${diff.change_type} for ${filePath}.`;
    return `${diff.change_type.toUpperCase()} ${filePath}: ${summary}`;
  });
}

function buildValidationSummary(validationResult: ControlledValidationResult | null): string {
  if (!validationResult) {
    return "Controlled validation result is missing.";
  }

  return summarizeValidation(validationResult);
}

function decideCommitGate(input: CommitGateInput): {
  status: CommitGateStatus;
  blockers: CommitBlocker[];
  recommendedAction: "commit" | "review" | "rollback";
  explanation: string;
} {
  const blockers: CommitBlocker[] = [];
  const validationResult = input.validationResult;
  const applicationPacket = input.applicationPacket;

  if (!validationResult) {
    blockers.push({
      code: "missing_validation_result",
      message: "Commit gate requires a controlled validation result before commit eligibility can be decided.",
      severity: "critical",
      recommended_action: "review",
    });
  }

  if (!applicationPacket) {
    blockers.push({
      code: "missing_application_packet",
      message: "Commit gate requires the reviewed application packet that authorized the execution.",
      severity: "critical",
      recommended_action: "review",
    });
  }

  if (applicationPacket && (applicationPacket.required_operator_review !== true || applicationPacket.human_approval_required !== true)) {
    blockers.push({
      code: "missing_required_review_flags",
      message: "Commit gate requires explicit operator review and human approval flags in the reviewed application packet.",
      severity: "critical",
      recommended_action: "review",
    });
  }

  if (validationResult && (!Array.isArray(validationResult.checks) || validationResult.checks.length === 0)) {
    blockers.push({
      code: "missing_validation_signals",
      message: "Commit gate requires concrete validation checks before commit eligibility can be decided.",
      severity: "critical",
      recommended_action: "review",
    });
  }

  if (validationResult?.status === "validation_failed") {
    blockers.push({
      code: "validation_failed",
      message: "Controlled validation failed, so these changes are not eligible for commit.",
      severity: "critical",
      recommended_action: "rollback",
    });
  }

  if (validationResult?.status === "validation_blocked") {
    blockers.push({
      code: "validation_blocked",
      message: "Controlled validation did not complete successfully, so commit eligibility remains blocked.",
      severity: "critical",
      recommended_action: "review",
    });
  }

  if (validationResult?.recommendation === "rollback") {
    blockers.push({
      code: "rollback_recommended",
      message: "Controlled validation recommended rollback, so commit eligibility is blocked.",
      severity: "critical",
      recommended_action: "rollback",
    });
  }

  if (validationResult?.failures.some((failure) => failure.code === "unexpected_changed_file" || failure.code === "forbidden_target")) {
    blockers.push({
      code: "unexpected_file_change",
      message: "Controlled validation detected unexpected file changes outside the approved diff.",
      severity: "critical",
      recommended_action: "rollback",
    });
  }

  if (validationResult && validationResult.failures.length > 0) {
    blockers.push({
      code: "critical_failure",
      message: `Controlled validation reported ${validationResult.failures.length} failure(s), so commit eligibility remains blocked.`,
      severity: "critical",
      recommended_action: validationResult.recommendation === "rollback" ? "rollback" : "review",
    });
  }

  if (applicationPacket?.risk_level === "high" || applicationPacket?.risk_level === "blocked") {
    blockers.push({
      code: "high_risk",
      message: `Commit gate blocks high-risk execution packets while risk level is ${applicationPacket.risk_level}.`,
      severity: "critical",
      recommended_action: "review",
    });
  }

  if (applicationPacket?.risk_level === "medium") {
    blockers.push({
      code: "medium_risk_review",
      message: "Commit gate requires review before commit when the reviewed application packet remains medium risk.",
      severity: "review",
      recommended_action: "review",
    });
  }

  if (applicationPacket?.playtest_required === true) {
    blockers.push({
      code: "playtest_required",
      message: "Commit gate requires operator review because the reviewed application packet still requires playtesting.",
      severity: "review",
      recommended_action: "review",
    });
  }

  if (validationResult?.status === "validation_needs_review" || validationResult?.checks.some((check) => check.status === "review_required")) {
    blockers.push({
      code: "validation_review_required",
      message: "Controlled validation completed without file mismatches, but still requires follow-up review before commit.",
      severity: "review",
      recommended_action: "review",
    });
  }

  const criticalBlockers = blockers.filter((blocker) => blocker.severity === "critical");
  if (criticalBlockers.length > 0) {
    const recommendedAction = criticalBlockers.some((blocker) => blocker.recommended_action === "rollback")
      ? "rollback"
      : "review";
    return {
      status: "commit_blocked",
      blockers,
      recommendedAction,
      explanation: `Commit gate blocked this change set because ${criticalBlockers.map((blocker) => blocker.message).join(" ")}`,
    };
  }

  if (blockers.length > 0) {
    return {
      status: "commit_needs_review",
      blockers,
      recommendedAction: "review",
      explanation: `Commit gate requires review before commit because ${blockers.map((blocker) => blocker.message).join(" ")}`,
    };
  }

  return {
    status: "commit_ready",
    blockers: [],
    recommendedAction: "commit",
    explanation: "Commit gate marked this change set as commit-ready because validation passed, no critical failures were detected, no unexpected file changes were found, and the reviewed packet remains low risk.",
  };
}

export function buildCompletionReport(input: CommitGateInput): CompletionReport {
  const createdAt = normalizeText(input.createdAt) || input.validationResult?.created_at || input.applicationPacket?.created_at || new Date().toISOString();
  const decision = decideCommitGate(input);
  return {
    report_id: buildReportId(input.validationResult?.validation_id, input.applicationPacket?.application_packet_id, createdAt),
    created_at: createdAt,
    original_request: normalizeText(input.originalRequest) || input.applicationPacket?.interpreted_goal || "unknown request",
    interpreted_goal: input.applicationPacket?.interpreted_goal ?? (normalizeText(input.originalRequest) || "unknown interpreted goal"),
    files_changed: buildFilesChanged(input),
    diff_summary: buildDiffSummary(input),
    validation_result: input.validationResult?.status ?? "missing_validation_result",
    validation_summary: buildValidationSummary(input.validationResult),
    risk_level: input.applicationPacket?.risk_level ?? "unknown",
    rollback_available: Boolean(input.executionResult?.rollback_point && input.executionResult.rollback_point.entries.length > 0),
    recommended_action: decision.recommendedAction,
    explanation: decision.explanation,
  };
}

export function evaluateCommitEligibility(input: CommitGateInput): CommitGateResult {
  const decision = decideCommitGate(input);
  return {
    status: decision.status,
    blockers: decision.blockers,
    recommended_action: decision.recommendedAction,
    explanation: decision.explanation,
    completion_report: buildCompletionReport(input),
  };
}

export function summarizeCommitGate(result: CommitGateResult): string {
  return [
    `Commit gate status: ${result.status}`,
    `Recommended action: ${result.recommended_action}`,
    `Files changed: ${result.completion_report.files_changed.length}`,
    `Validation result: ${result.completion_report.validation_result}`,
    `Explanation: ${result.explanation}`,
  ].join("\n");
}