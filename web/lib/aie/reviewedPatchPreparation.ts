import type { ArtifactExecutionNextAction } from "./artifactExecutionConsumer";
import type {
  ExecutionDryRunBlocker,
  ExecutionDryRunReport,
} from "./executionDryRunRunner";

export type ReviewedPatchPreparationStatus =
  | "patch_plan_ready"
  | "patch_plan_blocked"
  | "patch_plan_needs_review"
  | "patch_plan_invalid_dry_run"
  | "high_risk_blocked";

export type ReviewedPatchPreparationInput = {
  report: ExecutionDryRunReport;
  createdAt?: string;
};

export type ReviewedPatchPreparationBlocker = {
  code:
    | "dry_run_not_ready"
    | "missing_operator_review"
    | "missing_simulated_steps"
    | "mutation_not_allowed_violation"
    | "missing_validation_plan"
    | "missing_git_commit_plan"
    | "missing_proposed_file_targets"
    | "high_risk"
    | "invalid_dry_run_report";
  message: string;
  recommended_next_action: ArtifactExecutionNextAction | "review_dry_run_report";
};

export type ReviewedPatchFileTarget = {
  group_id: string;
  target: string;
  reason: string;
  intended_change: string;
  review_required: true;
  mutation_allowed: false;
  expected_validation: string;
};

export type ReviewedPatchValidationRequirement = {
  title: string;
  details: string;
  required: boolean;
};

export type ReviewedPatchPlan = {
  patch_plan_id: string;
  source_dry_run_id: string;
  source_handoff_id: string;
  source_artifact_id: string;
  created_at: string;
  interpreted_goal: string;
  risk_level: ExecutionDryRunReport["risk_level"];
  proposed_file_targets: string[];
  planned_change_groups: ReviewedPatchFileTarget[];
  validation_requirements: ReviewedPatchValidationRequirement[];
  git_commit_plan: ExecutionDryRunReport["git_commit_plan"];
  playtest_required: boolean;
  required_operator_review: true;
  allowed_patch_actions: string[];
  disallowed_patch_actions: string[];
  completion_report_requirements: string[];
  next_operator_action: ArtifactExecutionNextAction | "review_dry_run_report";
};

export type ReviewedPatchPreparationResult = {
  status: ReviewedPatchPreparationStatus;
  ready_for_patch_plan: boolean;
  patch_plan: ReviewedPatchPlan | null;
  blockers: ReviewedPatchPreparationBlocker[];
  recommended_next_operator_action: ArtifactExecutionNextAction | "review_dry_run_report";
  explanation: string;
};

const ALLOWED_PATCH_ACTIONS = [
  "inspect target files",
  "propose file-level changes",
  "draft patch instructions",
  "identify tests to run",
  "summarize expected diff",
];

const DISALLOWED_PATCH_ACTIONS = [
  "write files",
  "apply patches",
  "commit changes",
  "push branches",
  "deploy",
  "run destructive commands",
  "access secrets",
  "auto-approve implementation",
  "bypass validation",
];

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "patch-plan";
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildPatchPlanId(dryRunId: string, createdAt: string): string {
  return `patch-plan-${sanitizeTimestamp(createdAt)}-${slugify(dryRunId)}`;
}

function mapDryRunBlockers(blockers: ExecutionDryRunBlocker[]): ReviewedPatchPreparationBlocker[] {
  return blockers.map((blocker) => ({
    code: blocker.code === "invalid_handoff_packet" ? "invalid_dry_run_report" : "dry_run_not_ready",
    message: blocker.message,
    recommended_next_action: blocker.recommended_next_action === "review_handoff_packet"
      ? "review_dry_run_report"
      : blocker.recommended_next_action,
  }));
}

export function validateDryRunForPatchPreparation(
  report: ExecutionDryRunReport,
): ReviewedPatchPreparationBlocker[] {
  const blockers: ReviewedPatchPreparationBlocker[] = [];

  if (report.status !== "dry_run_ready") {
    blockers.push({
      code: report.status === "dry_run_invalid_packet" ? "invalid_dry_run_report" : "dry_run_not_ready",
      message: `Dry-run status is ${report.status}; only dry_run_ready reports may produce a reviewed patch plan.`,
      recommended_next_action: report.next_operator_action === "review_handoff_packet"
        ? "review_dry_run_report"
        : report.next_operator_action,
    });
  }

  if (report.required_operator_review !== true) {
    blockers.push({
      code: "missing_operator_review",
      message: "Reviewed patch preparation requires explicit operator review.",
      recommended_next_action: "execution_ready_review",
    });
  }

  if (!Array.isArray(report.simulated_steps) || report.simulated_steps.length === 0) {
    blockers.push({
      code: "missing_simulated_steps",
      message: "Reviewed patch preparation requires simulated dry-run steps.",
      recommended_next_action: "review_dry_run_report",
    });
  }

  if ((report.simulated_steps ?? []).some((step) => step.mutation_allowed !== false)) {
    blockers.push({
      code: "mutation_not_allowed_violation",
      message: "All simulated steps must remain mutation-free for reviewed patch preparation.",
      recommended_next_action: "review_dry_run_report",
    });
  }

  if (!Array.isArray(report.validation_plan) || report.validation_plan.length === 0) {
    blockers.push({
      code: "missing_validation_plan",
      message: "Reviewed patch preparation requires a validation plan.",
      recommended_next_action: "add_validation_plan",
    });
  }

  if (!report.git_commit_plan) {
    blockers.push({
      code: "missing_git_commit_plan",
      message: "Reviewed patch preparation requires git commit guidance.",
      recommended_next_action: "add_git_commit_plan",
    });
  }

  if (!Array.isArray(report.proposed_file_targets) || report.proposed_file_targets.length === 0) {
    blockers.push({
      code: "missing_proposed_file_targets",
      message: "Reviewed patch preparation requires proposed file targets.",
      recommended_next_action: "review_dry_run_report",
    });
  }

  if (report.risk_level === "high" || report.risk_level === "blocked") {
    blockers.push({
      code: "high_risk",
      message: `Reviewed patch preparation is blocked while risk level is ${report.risk_level}.`,
      recommended_next_action: "reduce_risk",
    });
  }

  if (report.blockers.length > 0) {
    blockers.push(...mapDryRunBlockers(report.blockers));
  }

  return blockers.filter((blocker, index, all) => all.findIndex((entry) => entry.code === blocker.code && entry.message === blocker.message) === index);
}

function buildPlannedChangeGroups(report: ExecutionDryRunReport): ReviewedPatchFileTarget[] {
  return report.proposed_file_targets.map((target, index) => ({
    group_id: `change-group-${index + 1}`,
    target,
    reason: `Dry-run identified ${target} as part of the reviewed scope for ${report.interpreted_goal}.`,
    intended_change: `Draft file-level patch instructions for ${target} without applying any repo mutation.`,
    review_required: true,
    mutation_allowed: false,
    expected_validation: report.validation_plan[0]?.title ?? "Run the reviewed validation plan before any future patch application.",
  }));
}

function buildValidationRequirements(report: ExecutionDryRunReport): ReviewedPatchValidationRequirement[] {
  return report.validation_plan.map((step) => ({
    title: step.title,
    details: step.details,
    required: step.required,
  }));
}

export function prepareReviewedPatchPlan(
  input: ReviewedPatchPreparationInput,
): ReviewedPatchPreparationResult {
  const report = input.report;
  const blockers = validateDryRunForPatchPreparation(report);

  let status: ReviewedPatchPreparationStatus = "patch_plan_ready";
  let recommendedNextOperatorAction: ArtifactExecutionNextAction | "review_dry_run_report" = report.next_operator_action === "review_handoff_packet"
    ? "review_dry_run_report"
    : report.next_operator_action;

  if (blockers.some((blocker) => blocker.code === "high_risk")) {
    status = "high_risk_blocked";
    recommendedNextOperatorAction = "reduce_risk";
  } else if (blockers.some((blocker) => blocker.code === "missing_operator_review")) {
    status = "patch_plan_needs_review";
    recommendedNextOperatorAction = "execution_ready_review";
  } else if (blockers.some((blocker) => blocker.code === "invalid_dry_run_report")) {
    status = "patch_plan_invalid_dry_run";
    recommendedNextOperatorAction = "review_dry_run_report";
  } else if (blockers.length > 0) {
    status = "patch_plan_blocked";
    recommendedNextOperatorAction = blockers[0]?.recommended_next_action
      ?? (report.next_operator_action === "review_handoff_packet"
        ? "review_dry_run_report"
        : report.next_operator_action);
  }

  if (blockers.length > 0) {
    return {
      status,
      ready_for_patch_plan: false,
      patch_plan: null,
      blockers,
      recommended_next_operator_action: recommendedNextOperatorAction,
      explanation: `Reviewed patch preparation is blocked because ${blockers.map((blocker) => blocker.message).join(" ")}`,
    };
  }

  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const patchPlan: ReviewedPatchPlan = {
    patch_plan_id: buildPatchPlanId(report.dry_run_id, createdAt),
    source_dry_run_id: report.dry_run_id,
    source_handoff_id: report.source_handoff_id,
    source_artifact_id: report.source_artifact_id,
    created_at: createdAt,
    interpreted_goal: report.interpreted_goal,
    risk_level: report.risk_level,
    proposed_file_targets: [...report.proposed_file_targets],
    planned_change_groups: buildPlannedChangeGroups(report),
    validation_requirements: buildValidationRequirements(report),
    git_commit_plan: {
      ...report.git_commit_plan,
      stage_only: [...report.git_commit_plan.stage_only],
      github_procedure: [...report.git_commit_plan.github_procedure],
    },
    playtest_required: report.playtest_required,
    required_operator_review: true,
    allowed_patch_actions: [...ALLOWED_PATCH_ACTIONS],
    disallowed_patch_actions: [...DISALLOWED_PATCH_ACTIONS],
    completion_report_requirements: [
      "Summarize the proposed file-level changes without applying them.",
      "List the expected diff shape for each planned change group.",
      "Identify the tests and validation checks that should run after a future reviewed patch application.",
      "Confirm that all work remains inside the approved file target list.",
      "Explicitly note whether playtesting remains required.",
    ],
    next_operator_action: report.next_operator_action === "review_handoff_packet"
      ? "review_dry_run_report"
      : report.next_operator_action,
  };

  return {
    status: "patch_plan_ready",
    ready_for_patch_plan: true,
    patch_plan: patchPlan,
    blockers: [],
    recommended_next_operator_action: report.next_operator_action === "review_handoff_packet"
      ? "review_dry_run_report"
      : report.next_operator_action,
    explanation: `Reviewed patch plan ${patchPlan.patch_plan_id} is ready for operator review before any future patch application gate.`,
  };
}

export function summarizeReviewedPatchPreparation(result: ReviewedPatchPreparationResult): string {
  const lines = [
    `Patch preparation status: ${result.status}`,
    `Ready for patch plan: ${result.ready_for_patch_plan ? "yes" : "no"}`,
    `Recommended next operator action: ${result.recommended_next_operator_action}`,
    `Explanation: ${result.explanation}`,
    result.patch_plan ? `Patch plan: ${result.patch_plan.patch_plan_id}` : "Patch plan: none.",
    result.blockers.length > 0
      ? `Blockers: ${result.blockers.map((blocker) => blocker.message).join(" | ")}`
      : "Blockers: none.",
  ];

  return lines.join("\n");
}