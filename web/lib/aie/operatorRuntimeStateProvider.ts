import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";
import {
  applyOperatorActionToProviderState,
  type OperatorRuntimeActionResult,
} from "./operatorRuntimeActionHandler";
import type {
  OperatorDashboardApprovalRequirement,
  OperatorDashboardFailure,
  OperatorDashboardRecoveryRecommendation,
  OperatorDashboardValidationIssue,
} from "./operatorDashboardState";
import type { OperatorRuntimeStateProviderResult, OperatorStateSource } from "./operatorRuntimeStateContract";
import {
  evaluateBootResume,
  type RuntimeBootResumeResult,
  type RuntimeStateRecord,
  type RuntimeStateStore,
} from "./runtimeStateStore";

export type OperatorRuntimeStateProviderDependencies = {
  runtime_state_store?: RuntimeStateStore | null;
  runtime_id?: string | null;
  now?: string;
};

type LiveRuntimeInspection = {
  mode: "live" | "missing" | "corrupt";
  boot_resume: RuntimeBootResumeResult | null;
  warnings: string[];
};

function createLoadedAt(now?: string): string {
  return now ?? new Date().toISOString();
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function buildDemoWarnings(): string[] {
  return [
    "This dashboard is using seeded demo state. It demonstrates AI-E reasoning and controls but is not connected to live runtime state yet.",
  ];
}

function buildUnavailableWarnings(reason: string): string[] {
  return [
    "No runtime state is available.",
    reason,
  ];
}

function buildLiveWarnings(record: RuntimeStateRecord, bootResume: RuntimeBootResumeResult): string[] {
  const warnings = [
    "This dashboard is connected to live AI-E runtime state.",
    "Live runtime mode currently exposes persisted runtime service state first; detailed queued goal and session slices are only shown when they can be reconstructed safely.",
  ];

  if (!record.last_trigger_result) {
    warnings.push("No persisted queue trigger result was available in the latest runtime snapshot.");
  }

  if (bootResume.status === "resume_requires_review") {
    warnings.push("The persisted runtime state requires operator review before a safe resume.");
  }

  if (bootResume.status === "resume_blocked") {
    warnings.push("The persisted runtime state is blocked and should not be resumed automatically.");
  }

  return unique(warnings);
}

function inspectLiveRuntimeState(
  dependencies: OperatorRuntimeStateProviderDependencies = {},
): LiveRuntimeInspection {
  const runtimeStateStore = dependencies.runtime_state_store;
  const runtimeId = normalizeText(dependencies.runtime_id);
  const now = createLoadedAt(dependencies.now);

  if (!runtimeStateStore || !runtimeId) {
    return {
      mode: "missing",
      boot_resume: null,
      warnings: ["No live runtime state store and runtime id were provided to the operator runtime state provider."],
    };
  }

  const bootResume = evaluateBootResume(runtimeStateStore, runtimeId, now);
  if (bootResume.status === "state_corrupt") {
    return {
      mode: "corrupt",
      boot_resume: bootResume,
      warnings: [bootResume.reason],
    };
  }

  if (bootResume.status === "no_prior_state") {
    return {
      mode: "missing",
      boot_resume: bootResume,
      warnings: [bootResume.reason],
    };
  }

  return {
    mode: "live",
    boot_resume: bootResume,
    warnings: [],
  };
}

function buildLiveApprovals(bootResume: RuntimeBootResumeResult): OperatorDashboardApprovalRequirement[] {
  const approvalsNeeded = unique(
    (bootResume.validation.blockers ?? []).flatMap((blocker) =>
      /approval/i.test(blocker.code) || /approval/i.test(blocker.message) ? ["session"] : []),
  );

  if (approvalsNeeded.length === 0) {
    return [];
  }

  return [{
    goal_id: null,
    approvals_needed: approvalsNeeded,
    reason: bootResume.reason,
    recommended_action: "Refresh the required approvals before another live runtime run is attempted.",
  }];
}

function buildLiveValidationIssues(bootResume: RuntimeBootResumeResult): OperatorDashboardValidationIssue[] {
  if (bootResume.status !== "resume_requires_review") {
    return [];
  }

  return [{
    goal_id: null,
    source: "runtime_state_store",
    status: "resume_requires_review",
    recommendation: "review_required",
    summary: bootResume.reason,
  }];
}

function buildLiveRecoveryRecommendation(
  bootResume: RuntimeBootResumeResult,
  loadedAt: string,
): {
  recent_failures: OperatorDashboardFailure[];
  recovery_recommendations: OperatorDashboardRecoveryRecommendation[];
} {
  if (bootResume.status === "resume_ready") {
    return {
      recent_failures: [],
      recovery_recommendations: [],
    };
  }

  const category = bootResume.status === "resume_blocked"
    ? buildLiveApprovals(bootResume).length > 0
      ? "stale_approval"
      : "dependency_blocked"
    : "stale_context";
  const severity = bootResume.status === "resume_blocked" ? "high" : "medium";
  const recommendation = bootResume.status === "resume_blocked"
    ? buildLiveApprovals(bootResume).length > 0
      ? "retry_after_refresh"
      : "block_until_fixed"
    : "request_operator_review";
  const reportId = `operator-runtime-provider-${loadedAt.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000"}-${bootResume.runtime_id}`;

  return {
    recent_failures: [{
      report_id: reportId,
      created_at: loadedAt,
      source: "runtime_state_store",
      category,
      severity,
      recommendation,
      reason: bootResume.reason,
    }],
    recovery_recommendations: [{
      report_id: reportId,
      source: "runtime_state_store",
      category,
      severity,
      recommendation,
      retry_safe: false,
      operator_review_required: true,
      reason: bootResume.reason,
    }],
  };
}

function buildLiveOperatorDashboardState(
  record: RuntimeStateRecord,
  bootResume: RuntimeBootResumeResult,
  loadedAt: string,
): OperatorDashboardState {
  const approvalsRequired = buildLiveApprovals(bootResume);
  const validationIssues = buildLiveValidationIssues(bootResume);
  const recoverySignals = buildLiveRecoveryRecommendation(bootResume, loadedAt);

  return {
    active_goal: null,
    queued_goals: [],
    blocked_goals: [],
    completed_goals: [],
    paused_goals: [],
    dependency_blockers: record.blockers.map((blocker, index) => ({
      goal_id: `runtime-blocker-${index + 1}`,
      blocker_ids: [blocker.code],
      explanation: blocker.message,
    })),
    conflict_blockers: [],
    recent_failures: recoverySignals.recent_failures,
    recovery_recommendations: recoverySignals.recovery_recommendations,
    approvals_required: approvalsRequired,
    validation_issues: validationIssues,
    runtime_status: {
      status: record.last_status,
      explanation: `Last persisted runtime status ${record.last_status} with stop reason ${record.stop_reason}.`,
    },
    session_status: {
      status: bootResume.status,
      explanation: bootResume.reason,
    },
    queue_status: {
      status: record.last_trigger_result?.status ?? "queue_idle",
      explanation: record.last_trigger_result?.reason ?? "No persisted queue trigger result is available for the current runtime snapshot.",
    },
    scheduler_status: {
      status: record.last_trigger_result?.status ?? bootResume.status,
      explanation: record.last_trigger_result?.reason ?? bootResume.reason,
    },
    last_updated_at: record.persisted_at,
  };
}

export function resolveOperatorStateSource(
  dependencies: OperatorRuntimeStateProviderDependencies = {},
): OperatorStateSource {
  const inspection = inspectLiveRuntimeState(dependencies);
  switch (inspection.mode) {
    case "live":
      return "live_runtime";
    case "corrupt":
      return "unavailable";
    case "missing":
    default:
      return "demo_seed";
  }
}

export function loadDemoOperatorDashboardState(
  loadedAt = createLoadedAt(),
): OperatorRuntimeStateProviderResult {
  return {
    source: "demo_seed",
    dashboard_state: createOperatorDashboardDemoState(),
    warnings: buildDemoWarnings(),
    loaded_at: loadedAt,
  };
}

export function loadLiveOperatorDashboardState(
  dependencies: OperatorRuntimeStateProviderDependencies = {},
): OperatorRuntimeStateProviderResult {
  const loadedAt = createLoadedAt(dependencies.now);
  const inspection = inspectLiveRuntimeState(dependencies);
  if (inspection.mode !== "live" || !inspection.boot_resume?.record) {
    const unavailableReason = inspection.boot_resume?.reason ?? inspection.warnings.join(" ") ?? "No live runtime state is available.";
    return {
      source: "unavailable",
      dashboard_state: null,
      warnings: buildUnavailableWarnings(unavailableReason || "No live runtime state is available."),
      loaded_at: loadedAt,
    };
  }

  return {
    source: "live_runtime",
    dashboard_state: buildLiveOperatorDashboardState(inspection.boot_resume.record, inspection.boot_resume, loadedAt),
    warnings: buildLiveWarnings(inspection.boot_resume.record, inspection.boot_resume),
    loaded_at: loadedAt,
  };
}

export async function loadOperatorDashboardState(
  dependencies: OperatorRuntimeStateProviderDependencies = {},
): Promise<OperatorRuntimeStateProviderResult> {
  const loadedAt = createLoadedAt(dependencies.now);
  const inspection = inspectLiveRuntimeState(dependencies);

  if (inspection.mode === "live") {
    return loadLiveOperatorDashboardState({
      ...dependencies,
      now: loadedAt,
    });
  }

  if (inspection.mode === "corrupt") {
    const unavailableReason = inspection.boot_resume?.reason ?? inspection.warnings.join(" ") ?? "No runtime state is available.";
    return {
      source: "unavailable",
      dashboard_state: null,
      warnings: buildUnavailableWarnings(unavailableReason || "No runtime state is available."),
      loaded_at: loadedAt,
    };
  }

  const demoResult = loadDemoOperatorDashboardState(loadedAt);
  return {
    ...demoResult,
    warnings: unique([...inspection.warnings, ...demoResult.warnings]),
  };
}

export function summarizeOperatorStateProviderResult(result: OperatorRuntimeStateProviderResult): string {
  return [
    `Operator state source: ${result.source}`,
    `Loaded at: ${result.loaded_at}`,
    `Dashboard available: ${result.dashboard_state ? "yes" : "no"}`,
    `Runtime status: ${result.dashboard_state?.runtime_status.status ?? "none"}`,
    `Queue status: ${result.dashboard_state?.queue_status.status ?? "none"}`,
    `Warnings: ${result.warnings.length > 0 ? result.warnings.join(" | ") : "none"}`,
  ].join("\n");
}

export { applyOperatorActionToProviderState };