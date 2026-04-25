import type { ArtifactExecutionNextAction } from "./artifactExecutionConsumer";
import type { ReviewedPatchApplicationDecision } from "./reviewedPatchApplicationGate";

export type ReviewedPatchDraftStatus =
  | "draft_ready"
  | "draft_blocked"
  | "draft_needs_review"
  | "invalid_application_decision"
  | "high_risk_blocked";

export type ReviewedPatchDraftInput = {
  decision: ReviewedPatchApplicationDecision | null;
  createdAt?: string;
};

export type ReviewedPatchDraftBlocker = {
  code:
    | "decision_not_eligible"
    | "missing_operator_review"
    | "missing_source_patch_plan"
    | "missing_planned_change_groups"
    | "missing_validation_requirements"
    | "missing_git_commit_plan"
    | "high_risk"
    | "invalid_application_decision";
  message: string;
  recommended_next_action: ArtifactExecutionNextAction | "review_patch_application_decision";
};

export type ReviewedPatchChangeDescription = {
  change_id: string;
  target: string;
  reason: string;
  intended_change: string;
  expected_impact: string;
  review_required: true;
  mutation_allowed: false;
};

export type ReviewedPatchDraft = {
  draft_id: string;
  source_decision_id: string;
  source_patch_plan_id: string;
  source_dry_run_id: string;
  source_handoff_id: string;
  source_artifact_id: string;
  created_at: string;
  interpreted_goal: string;
  risk_level: ReviewedPatchApplicationDecision["risk_level"];
  change_descriptions: ReviewedPatchChangeDescription[];
  affected_targets: string[];
  expected_diff_summary: string;
  validation_requirements: ReviewedPatchApplicationDecision["validation_requirements"];
  git_commit_plan: ReviewedPatchApplicationDecision["git_commit_plan"];
  playtest_required: boolean;
  required_operator_review: true;
  draft_scope_summary: string;
  allowed_draft_actions: string[];
  disallowed_draft_actions: string[];
  completion_report_requirements: string[];
  next_operator_action: ArtifactExecutionNextAction | "review_patch_application_decision";
};

export type ReviewedPatchDraftResult = {
  status: ReviewedPatchDraftStatus;
  draft: ReviewedPatchDraft | null;
  blockers: ReviewedPatchDraftBlocker[];
  recommended_next_operator_action: ArtifactExecutionNextAction | "review_patch_application_decision";
  explanation: string;
};

const ALLOWED_DRAFT_ACTIONS = [
  "describe changes",
  "outline file-level modifications",
  "summarize expected diffs",
  "propose validation steps",
  "prepare commit intent",
];

const DISALLOWED_DRAFT_ACTIONS = [
  "write files",
  "apply patches",
  "commit changes",
  "push branches",
  "deploy",
  "run destructive commands",
  "access secrets",
  "auto-approve implementation",
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
    .slice(0, 36) || "patch-draft";
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildDraftId(sourceDecisionId: string, createdAt: string): string {
  return `patch-draft-${sanitizeTimestamp(createdAt)}-${slugify(sourceDecisionId)}`;
}

export function validateApplicationDecisionForDraft(
  decision: ReviewedPatchApplicationDecision | null,
): ReviewedPatchDraftBlocker[] {
  if (!decision) {
    return [{
      code: "invalid_application_decision",
      message: "Reviewed patch draft generation requires an application decision.",
      recommended_next_action: "review_patch_application_decision",
    }];
  }

  const blockers: ReviewedPatchDraftBlocker[] = [];

  if (decision.status !== "application_eligible" || !decision.eligible_for_application) {
    blockers.push({
      code: "decision_not_eligible",
      message: `Application decision status is ${decision.status}; only application_eligible decisions may produce a reviewed patch draft.`,
      recommended_next_action: decision.recommended_next_operator_action,
    });
  }

  if (decision.required_operator_review !== true) {
    blockers.push({
      code: "missing_operator_review",
      message: "Reviewed patch draft generation requires explicit operator review.",
      recommended_next_action: "execution_ready_review",
    });
  }

  if (!decision.source_patch_plan) {
    blockers.push({
      code: "missing_source_patch_plan",
      message: "Reviewed patch draft generation requires the source patch plan.",
      recommended_next_action: "review_patch_application_decision",
    });
  }

  if (decision.risk_level === "high" || decision.risk_level === "blocked") {
    blockers.push({
      code: "high_risk",
      message: `Reviewed patch draft generation is blocked while risk level is ${decision.risk_level}.`,
      recommended_next_action: "reduce_risk",
    });
  }

  if (!Array.isArray(decision.source_patch_plan?.planned_change_groups) || decision.source_patch_plan.planned_change_groups.length === 0) {
    blockers.push({
      code: "missing_planned_change_groups",
      message: "Reviewed patch draft generation requires planned change groups.",
      recommended_next_action: "review_patch_application_decision",
    });
  }

  if (!Array.isArray(decision.validation_requirements) || decision.validation_requirements.length === 0) {
    blockers.push({
      code: "missing_validation_requirements",
      message: "Reviewed patch draft generation requires validation requirements.",
      recommended_next_action: "add_validation_plan",
    });
  }

  if (!decision.git_commit_plan) {
    blockers.push({
      code: "missing_git_commit_plan",
      message: "Reviewed patch draft generation requires git commit guidance.",
      recommended_next_action: "add_git_commit_plan",
    });
  }

  return blockers;
}

function buildChangeDescriptions(decision: ReviewedPatchApplicationDecision): ReviewedPatchChangeDescription[] {
  return decision.source_patch_plan.planned_change_groups.map((group, index) => ({
    change_id: `draft-change-${index + 1}`,
    target: group.target,
    reason: group.reason,
    intended_change: group.intended_change,
    expected_impact: `Expected impact on ${group.target}: scoped behavior or contract changes tied to ${decision.interpreted_goal}.`,
    review_required: true,
    mutation_allowed: false,
  }));
}

function buildExpectedDiffSummary(decision: ReviewedPatchApplicationDecision): string {
  const targets = decision.source_patch_plan.proposed_file_targets.join(", ");
  return `Likely changes are limited to: ${targets}. Expected behavior impact: ${decision.interpreted_goal}. Systems touched remain inside the reviewed patch plan scope and its validation requirements.`;
}

export function generateReviewedPatchDraft(
  input: ReviewedPatchDraftInput,
): ReviewedPatchDraftResult {
  const blockers = validateApplicationDecisionForDraft(input.decision);

  let status: ReviewedPatchDraftStatus = "draft_ready";
  let recommendedNextOperatorAction: ArtifactExecutionNextAction | "review_patch_application_decision" = input.decision?.recommended_next_operator_action ?? "review_patch_application_decision";

  if (blockers.some((blocker) => blocker.code === "high_risk")) {
    status = "high_risk_blocked";
    recommendedNextOperatorAction = "reduce_risk";
  } else if (blockers.some((blocker) => blocker.code === "missing_operator_review")) {
    status = "draft_needs_review";
    recommendedNextOperatorAction = "execution_ready_review";
  } else if (blockers.some((blocker) => blocker.code === "invalid_application_decision")) {
    status = "invalid_application_decision";
    recommendedNextOperatorAction = "review_patch_application_decision";
  } else if (blockers.length > 0) {
    status = "draft_blocked";
    recommendedNextOperatorAction = blockers[0]?.recommended_next_action ?? recommendedNextOperatorAction;
  }

  if (blockers.length > 0 || !input.decision) {
    return {
      status,
      draft: null,
      blockers,
      recommended_next_operator_action: recommendedNextOperatorAction,
      explanation: `Reviewed patch draft generation is blocked because ${blockers.map((blocker) => blocker.message).join(" ")}`,
    };
  }

  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const draft: ReviewedPatchDraft = {
    draft_id: buildDraftId(input.decision.decision_id, createdAt),
    source_decision_id: input.decision.decision_id,
    source_patch_plan_id: input.decision.source_patch_plan_id,
    source_dry_run_id: input.decision.source_dry_run_id,
    source_handoff_id: input.decision.source_handoff_id,
    source_artifact_id: input.decision.source_artifact_id,
    created_at: createdAt,
    interpreted_goal: input.decision.interpreted_goal,
    risk_level: input.decision.risk_level,
    change_descriptions: buildChangeDescriptions(input.decision),
    affected_targets: [...input.decision.source_patch_plan.proposed_file_targets],
    expected_diff_summary: buildExpectedDiffSummary(input.decision),
    validation_requirements: input.decision.validation_requirements.map((item) => ({ ...item })),
    git_commit_plan: {
      ...input.decision.git_commit_plan,
      stage_only: [...input.decision.git_commit_plan.stage_only],
      github_procedure: [...input.decision.git_commit_plan.github_procedure],
    },
    playtest_required: input.decision.source_patch_plan.playtest_required,
    required_operator_review: true,
    draft_scope_summary: `Review-only draft for ${input.decision.source_patch_plan.proposed_file_targets.length} target area(s): ${input.decision.source_patch_plan.proposed_file_targets.join(", ")}.`,
    allowed_draft_actions: [...ALLOWED_DRAFT_ACTIONS],
    disallowed_draft_actions: [...DISALLOWED_DRAFT_ACTIONS],
    completion_report_requirements: [
      "Summarize the intended file-level changes without writing files.",
      "Describe the expected diff shape for each reviewed change description.",
      "List the validation and playtest requirements that must remain in scope.",
      "Confirm the draft stays inside the reviewed patch plan targets.",
      "State the commit intent without creating any commit or patch.",
    ],
    next_operator_action: input.decision.recommended_next_operator_action,
  };

  return {
    status: "draft_ready",
    draft,
    blockers: [],
    recommended_next_operator_action: input.decision.recommended_next_operator_action,
    explanation: `Reviewed patch draft ${draft.draft_id} is ready for human review before any future controlled patch execution step.`,
  };
}

export function summarizeReviewedPatchDraft(result: ReviewedPatchDraftResult): string {
  const lines = [
    `Patch draft status: ${result.status}`,
    `Recommended next operator action: ${result.recommended_next_operator_action}`,
    `Explanation: ${result.explanation}`,
    result.draft ? `Draft: ${result.draft.draft_id}` : "Draft: none.",
    result.blockers.length > 0
      ? `Blockers: ${result.blockers.map((blocker) => blocker.message).join(" | ")}`
      : "Blockers: none.",
  ];

  return lines.join("\n");
}