export type FailureCategory =
  | "validation_failure"
  | "test_failure"
  | "execution_error"
  | "stale_context"
  | "stale_approval"
  | "dependency_blocked"
  | "conflict_blocked"
  | "unsafe_mutation"
  | "missing_file"
  | "unexpected_file_change"
  | "rollback_recommended"
  | "unknown";

export type FailureSeverity = "low" | "medium" | "high" | "critical";

export type RecoveryRecommendation =
  | "retry_once"
  | "retry_after_refresh"
  | "rollback"
  | "request_operator_review"
  | "block_until_fixed"
  | "mark_dependency_blocked"
  | "mark_conflict_blocked"
  | "no_action_needed";

export type RecoveryConfidence = "low" | "medium" | "high";

export type FailureEventBlocker = {
  code: string;
  message: string;
  recommended_action?: string;
  severity?: string;
  approvals_needed?: string[];
};

export type FailureEventFailure = {
  code: string;
  message: string;
  file_path?: string;
  expected?: string;
  actual?: string;
};

export type FailureEvent = {
  event_id?: string;
  created_at?: string;
  source: string;
  status?: string;
  message?: string;
  explanation?: string;
  failure_code?: string;
  blockers?: FailureEventBlocker[];
  failures?: FailureEventFailure[];
  validation_status?: string | null;
  validation_recommendation?: string | null;
  rollback_recommended?: boolean;
  details?: Record<string, string | number | boolean | null | undefined>;
};

export type FailureClassification = {
  category: FailureCategory;
  severity: FailureSeverity;
  confidence: RecoveryConfidence;
  retryable: boolean;
  likely_causes: string[];
  reason: string;
};

export type RecoveryDecision = {
  category: FailureCategory;
  severity: FailureSeverity;
  confidence: RecoveryConfidence;
  recommendation: RecoveryRecommendation;
  retry_safe: boolean;
  operator_review_required: boolean;
  likely_causes: string[];
  reason: string;
  blocker_codes: string[];
  failure_codes: string[];
  validation_status: string | null;
  validation_recommendation: string | null;
  blockers: FailureEventBlocker[];
  failures: FailureEventFailure[];
};

export type RecoveryReport = {
  report_id: string;
  created_at: string;
  source: string;
  status: string;
  decision: RecoveryDecision;
  summary: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => normalizeText(value).length > 0))];
}

function normalizeBlockers(event: FailureEvent): FailureEventBlocker[] {
  return (event.blockers ?? []).map((blocker) => ({
    ...blocker,
    code: normalizeText(blocker.code),
    message: normalizeText(blocker.message),
    recommended_action: normalizeText(blocker.recommended_action),
    severity: normalizeText(blocker.severity),
    approvals_needed: blocker.approvals_needed ? [...blocker.approvals_needed] : undefined,
  }));
}

function normalizeFailures(event: FailureEvent): FailureEventFailure[] {
  return (event.failures ?? []).map((failure) => ({
    ...failure,
    code: normalizeText(failure.code),
    message: normalizeText(failure.message),
    file_path: normalizeText(failure.file_path),
    expected: failure.expected,
    actual: failure.actual,
  }));
}

function buildCombinedText(event: FailureEvent, blockers: FailureEventBlocker[], failures: FailureEventFailure[]): string {
  const detailText = Object.entries(event.details ?? {})
    .map(([key, value]) => `${key} ${String(value ?? "")}`)
    .join(" ");

  return [
    normalizeText(event.status),
    normalizeText(event.message),
    normalizeText(event.explanation),
    normalizeText(event.failure_code),
    normalizeText(event.validation_status),
    normalizeText(event.validation_recommendation),
    detailText,
    ...blockers.flatMap((blocker) => [blocker.code, blocker.message, blocker.recommended_action ?? "", blocker.severity ?? ""]),
    ...failures.flatMap((failure) => [failure.code, failure.message, failure.file_path ?? "", failure.expected ?? "", failure.actual ?? ""]),
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildLikelyCauses(category: FailureCategory, event: FailureEvent, blockers: FailureEventBlocker[], failures: FailureEventFailure[]): string[] {
  const firstFailurePath = failures.find((failure) => failure.file_path)?.file_path;

  switch (category) {
    case "validation_failure":
      return [
        "The latest validation snapshot failed or blocked the runtime boundary.",
        "A reviewed change likely needs inspection before further execution.",
      ];
    case "test_failure":
      return [
        "A deterministic test or check reported a real behavior mismatch.",
        "Retrying the same step would likely reproduce the same failure.",
      ];
    case "execution_error":
      return [
        "The bounded execution step failed before AI-E could confirm a stable result.",
        "The failure shape looks transient enough for one bounded retry.",
      ];
    case "stale_context":
      return [
        "The persisted context or validation evidence is no longer fresh enough to trust.",
        "Recovery should refresh state before another bounded run.",
      ];
    case "stale_approval":
      return [
        "Required approval state is missing or stale for the current runtime boundary.",
        "A refreshed approval is required before another run is safe.",
      ];
    case "dependency_blocked":
      return [
        "A prerequisite goal or task is not complete yet.",
        "Scheduling should keep this work blocked until the dependency clears.",
      ];
    case "conflict_blocked":
      return [
        "Another active goal conflicts with this work item.",
        "The safer move is to leave the conflict blocked instead of retrying.",
      ];
    case "unsafe_mutation":
      return [
        "The requested or observed change crossed a bounded safety constraint.",
        "Further mutation should stay blocked until the target is fixed or reviewed.",
      ];
    case "missing_file":
      return [
        firstFailurePath
          ? `Expected file '${firstFailurePath}' was missing at validation time.`
          : "An expected file or target output was missing.",
        "This suggests the task did not complete the reviewed change correctly.",
      ];
    case "unexpected_file_change":
      return [
        "Observed file state diverged from the reviewed preview or expected output.",
        "The runtime should avoid more mutation until the unexpected change is reviewed.",
      ];
    case "rollback_recommended":
      return [
        "The latest validation explicitly recommends rollback.",
        "Keeping the current state is riskier than reviewing a rollback path.",
      ];
    case "unknown":
    default:
      return [
        blockers.length > 0 || failures.length > 0
          ? "The failure contains partial signals but not enough deterministic evidence for a narrower class."
          : "The failure did not match any known deterministic recovery pattern.",
        "Operator review is safer than blind retry or rollback.",
      ];
  }
}

function isTransientExecutionFailure(combinedText: string): boolean {
  return /(?:timed out|timeout|temporar(?:y|ily)|econnreset|econnrefused|eai_again|etimedout|resource busy|ebusy|enotempty|try again)/i.test(combinedText);
}

function classifyCategory(event: FailureEvent, blockers: FailureEventBlocker[], failures: FailureEventFailure[], combinedText: string): FailureCategory {
  const blockerCodes = blockers.map((blocker) => blocker.code.toLowerCase());
  const failureCodes = failures.map((failure) => failure.code.toLowerCase());
  const validationStatus = normalizeText(event.validation_status).toLowerCase();
  const validationRecommendation = normalizeText(event.validation_recommendation).toLowerCase();

  if (event.rollback_recommended === true || validationRecommendation === "rollback" || blockerCodes.includes("rollback_recommended")) {
    return "rollback_recommended";
  }

  if (blockerCodes.includes("dependency_blocked") || /dependency[-_ ]blocked|blocked by incomplete dependencies|prerequisite/i.test(combinedText)) {
    return "dependency_blocked";
  }

  if (blockerCodes.includes("conflict_blocked") || /conflict[-_ ]blocked|conflicts with active/i.test(combinedText)) {
    return "conflict_blocked";
  }

  if (blockerCodes.includes("context_stale") || /stale context|context is stale|refresh session context/i.test(combinedText)) {
    return "stale_context";
  }

  if (
    blockerCodes.includes("session_approval_stale")
    || blockerCodes.includes("session_approval_required")
    || blockerCodes.includes("session_reapproval_required")
    || blockerCodes.includes("chain_approval_required")
    || /approval is stale|approval required|renew session approval|requires approval/i.test(combinedText)
  ) {
    return "stale_approval";
  }

  if (failureCodes.includes("missing_file") || /enoent|missing file|not found|no such file|does not exist|expected file/i.test(combinedText)) {
    return "missing_file";
  }

  if (
    failureCodes.includes("unexpected_changed_file")
    || failureCodes.includes("unexpected_existing_deleted_file")
    || /unexpected file change|does not match the approved preview|diverge|tampered/i.test(combinedText)
  ) {
    return "unexpected_file_change";
  }

  if (
    failureCodes.includes("forbidden_target")
    || /unsafe mutation|forbidden target|outside the safe|outside the allowed root|permission denied|access denied|bounded safety/i.test(combinedText)
  ) {
    return "unsafe_mutation";
  }

  if (/tests? failed|pytest failed|vitest failed|failing test|assert(?:ion)? failed|expected .* to|build failed|compilation failed|type error|syntax error|eslint/i.test(combinedText)) {
    return "test_failure";
  }

  if (
    validationStatus === "validation_failed"
    || validationStatus === "validation_blocked"
    || blockerCodes.includes("validation_failed")
    || /validation failed|validation blocked|reviewed validation/i.test(combinedText)
  ) {
    return "validation_failure";
  }

  if (/execution error|runtime failed|could not identify a safe bounded cycle|failed before it could run/i.test(combinedText) || isTransientExecutionFailure(combinedText)) {
    return "execution_error";
  }

  return "unknown";
}

function deriveSeverity(category: FailureCategory, combinedText: string): FailureSeverity {
  switch (category) {
    case "execution_error":
      return isTransientExecutionFailure(combinedText) ? "low" : "medium";
    case "stale_context":
    case "stale_approval":
    case "dependency_blocked":
    case "conflict_blocked":
    case "test_failure":
      return "medium";
    case "validation_failure":
    case "missing_file":
    case "rollback_recommended":
      return "high";
    case "unsafe_mutation":
    case "unexpected_file_change":
      return "critical";
    case "unknown":
    default:
      return "high";
  }
}

function deriveConfidence(category: FailureCategory, blockers: FailureEventBlocker[], failures: FailureEventFailure[]): RecoveryConfidence {
  if (category === "unknown") {
    return "low";
  }

  if (blockers.length > 0 || failures.length > 0) {
    return "high";
  }

  return "medium";
}

function deriveClassificationReason(category: FailureCategory, event: FailureEvent, blockers: FailureEventBlocker[], failures: FailureEventFailure[]): string {
  const blockerCodes = unique(blockers.map((blocker) => blocker.code));
  const failureCodes = unique(failures.map((failure) => failure.code));
  const signalParts = [
    blockerCodes.length > 0 ? `blocker codes: ${blockerCodes.join(", ")}` : "",
    failureCodes.length > 0 ? `failure codes: ${failureCodes.join(", ")}` : "",
    normalizeText(event.validation_status) ? `validation status: ${normalizeText(event.validation_status)}` : "",
    normalizeText(event.validation_recommendation) ? `validation recommendation: ${normalizeText(event.validation_recommendation)}` : "",
  ].filter(Boolean);

  const prefix = signalParts.length > 0
    ? `Matched ${signalParts.join("; ")}.`
    : "Matched the event message and explanation only.";

  switch (category) {
    case "validation_failure":
      return `${prefix} The safest interpretation is a validation failure that needs review.`;
    case "test_failure":
      return `${prefix} The event looks like a real test or logic failure, not a transient runtime issue.`;
    case "execution_error":
      return `${prefix} The event looks like an execution-layer failure with bounded retry potential.`;
    case "stale_context":
      return `${prefix} The event indicates stale context rather than a logic defect.`;
    case "stale_approval":
      return `${prefix} The event indicates stale or missing approval state.`;
    case "dependency_blocked":
      return `${prefix} The event indicates a prerequisite is still blocking this work.`;
    case "conflict_blocked":
      return `${prefix} The event indicates a scheduling conflict with other active work.`;
    case "unsafe_mutation":
      return `${prefix} The event crossed a bounded mutation or safety constraint.`;
    case "missing_file":
      return `${prefix} The event indicates an expected file or output is missing.`;
    case "unexpected_file_change":
      return `${prefix} The event indicates observed file state diverged from the reviewed expectation.`;
    case "rollback_recommended":
      return `${prefix} The event explicitly recommends rollback as the safer path.`;
    case "unknown":
    default:
      return `${prefix} The event remains too ambiguous for a narrower recovery class.`;
  }
}

function deriveRecommendation(category: FailureCategory, severity: FailureSeverity, combinedText: string): RecoveryRecommendation {
  if (category === "execution_error" && severity === "low" && isTransientExecutionFailure(combinedText)) {
    return "retry_once";
  }

  switch (category) {
    case "stale_context":
    case "stale_approval":
      return "retry_after_refresh";
    case "rollback_recommended":
      return "rollback";
    case "dependency_blocked":
      return "mark_dependency_blocked";
    case "conflict_blocked":
      return "mark_conflict_blocked";
    case "unsafe_mutation":
      return "block_until_fixed";
    case "validation_failure":
    case "test_failure":
    case "missing_file":
    case "unexpected_file_change":
    case "unknown":
      return "request_operator_review";
    case "execution_error":
    default:
      return "request_operator_review";
  }
}

function deriveOperatorReviewRequirement(recommendation: RecoveryRecommendation): boolean {
  return recommendation === "request_operator_review"
    || recommendation === "rollback"
    || recommendation === "retry_after_refresh";
}

export function classifyFailure(event: FailureEvent): FailureClassification {
  const blockers = normalizeBlockers(event);
  const failures = normalizeFailures(event);
  const combinedText = buildCombinedText(event, blockers, failures);
  const category = classifyCategory(event, blockers, failures, combinedText);
  const severity = deriveSeverity(category, combinedText);
  const confidence = deriveConfidence(category, blockers, failures);
  const retryable = category === "execution_error" && severity === "low" && isTransientExecutionFailure(combinedText);
  const likelyCauses = buildLikelyCauses(category, event, blockers, failures);

  return {
    category,
    severity,
    confidence,
    retryable,
    likely_causes: likelyCauses,
    reason: deriveClassificationReason(category, event, blockers, failures),
  };
}

export function evaluateRecoveryDecision(event: FailureEvent): RecoveryDecision {
  const blockers = normalizeBlockers(event);
  const failures = normalizeFailures(event);
  const combinedText = buildCombinedText(event, blockers, failures);
  const classification = classifyFailure(event);
  const recommendation = deriveRecommendation(classification.category, classification.severity, combinedText);
  const operatorReviewRequired = deriveOperatorReviewRequirement(recommendation);
  const retrySafe = recommendation === "retry_once";

  return {
    category: classification.category,
    severity: classification.severity,
    confidence: classification.confidence,
    recommendation,
    retry_safe: retrySafe,
    operator_review_required: operatorReviewRequired,
    likely_causes: classification.likely_causes,
    reason: classification.reason,
    blocker_codes: unique(blockers.map((blocker) => blocker.code)),
    failure_codes: unique(failures.map((failure) => failure.code)),
    validation_status: normalizeText(event.validation_status) || null,
    validation_recommendation: normalizeText(event.validation_recommendation) || null,
    blockers,
    failures,
  };
}

export function buildRecoveryReport(event: FailureEvent): RecoveryReport {
  const createdAt = normalizeText(event.created_at) || new Date().toISOString();
  const decision = evaluateRecoveryDecision(event);
  const status = normalizeText(event.status) || "unknown_status";
  const report: RecoveryReport = {
    report_id: `failure-recovery-${sanitizeTimestamp(createdAt)}-${normalizeText(event.source) || "unknown-source"}`,
    created_at: createdAt,
    source: normalizeText(event.source) || "unknown",
    status,
    decision,
    summary: "",
  };

  return {
    ...report,
    summary: summarizeRecoveryReport(report),
  };
}

export function summarizeRecoveryReport(report: RecoveryReport): string {
  return [
    `Failure category: ${report.decision.category}`,
    `Severity: ${report.decision.severity}`,
    `Recommendation: ${report.decision.recommendation}`,
    `Retry safe: ${report.decision.retry_safe}`,
    `Operator review required: ${report.decision.operator_review_required}`,
    `Reason: ${report.decision.reason}`,
    `Likely causes: ${report.decision.likely_causes.join(" | ")}`,
  ].join("\n");
}

export function isRetrySafe(decision: RecoveryDecision): boolean {
  return decision.retry_safe === true && decision.recommendation === "retry_once";
}

export function requiresOperatorReview(decision: RecoveryDecision): boolean {
  return decision.operator_review_required === true;
}