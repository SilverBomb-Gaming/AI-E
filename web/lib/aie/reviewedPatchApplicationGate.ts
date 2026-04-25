import type { ArtifactExecutionNextAction } from "./artifactExecutionConsumer";
import type {
  ReviewedPatchPlan,
  ReviewedPatchPreparationResult,
} from "./reviewedPatchPreparation";

export type ReviewedPatchApplicationStatus =
  | "application_eligible"
  | "application_blocked"
  | "needs_operator_review"
  | "invalid_patch_plan"
  | "high_risk_blocked";

export type ReviewedPatchApplicationGateInput = {
  preparationResult: ReviewedPatchPreparationResult;
  createdAt?: string;
};

export type ReviewedPatchApplicationBlocker = {
  code:
    | "patch_plan_not_ready"
    | "missing_operator_review"
    | "missing_planned_change_groups"
    | "planned_change_group_review_violation"
    | "planned_change_group_mutation_violation"
    | "missing_validation_requirements"
    | "missing_git_commit_plan"
    | "missing_action_lists"
    | "missing_required_disallowed_actions"
    | "high_risk"
    | "invalid_patch_plan";
  message: string;
  recommended_next_action: ArtifactExecutionNextAction | "review_patch_plan";
};

export type ReviewedPatchApplicationDecision = {
  decision_id: string;
  source_patch_plan_id: string;
  source_dry_run_id: string;
  source_handoff_id: string;
  source_artifact_id: string;
  created_at: string;
  status: ReviewedPatchApplicationStatus;
  eligible_for_application: boolean;
  interpreted_goal: string;
  risk_level: ReviewedPatchPlan["risk_level"];
  blockers: ReviewedPatchApplicationBlocker[];
  required_operator_review: true;
  validation_requirements: ReviewedPatchPlan["validation_requirements"];
  git_commit_plan: ReviewedPatchPlan["git_commit_plan"];
  allowed_next_actions: string[];
  disallowed_next_actions: string[];
  recommended_next_operator_action: ArtifactExecutionNextAction | "review_patch_plan";
};

export type ReviewedPatchApplicationGateResult = {
  status: ReviewedPatchApplicationStatus;
  decision: ReviewedPatchApplicationDecision | null;
  blockers: ReviewedPatchApplicationBlocker[];
  recommended_next_operator_action: ArtifactExecutionNextAction | "review_patch_plan";
  explanation: string;
};

const ALLOWED_NEXT_ACTIONS = [
  "operator reviews patch plan",
  "operator approves patch application scope",
  "prepare reviewed patch draft",
  "run validation checklist",
];

const DISALLOWED_NEXT_ACTIONS = [
  "write files automatically",
  "apply patches automatically",
  "commit automatically",
  "push automatically",
  "deploy",
  "bypass validation",
  "access secrets",
  "auto-approve implementation",
];

const REQUIRED_DISALLOWED_PATCH_ACTIONS = [
  "write files",
  "apply patches",
  "commit changes",
  "push branches",
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
    .slice(0, 36) || "application-decision";
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildDecisionId(sourcePatchPlanId: string, createdAt: string): string {
  return `patch-application-${sanitizeTimestamp(createdAt)}-${slugify(sourcePatchPlanId)}`;
}

export function listPatchApplicationBlockers(
  patchPlan: ReviewedPatchPlan | null,
): ReviewedPatchApplicationBlocker[] {
  const blockers: ReviewedPatchApplicationBlocker[] = [];

  if (!patchPlan) {
    return [{
      code: "invalid_patch_plan",
      message: "Patch application gate requires a reviewed patch plan.",
      recommended_next_action: "review_patch_plan",
    }];
  }

  if (patchPlan.required_operator_review !== true) {
    blockers.push({
      code: "missing_operator_review",
      message: "Patch application eligibility requires explicit operator review.",
      recommended_next_action: "execution_ready_review",
    });
  }

  if (patchPlan.risk_level === "high" || patchPlan.risk_level === "blocked") {
    blockers.push({
      code: "high_risk",
      message: `Patch application eligibility is blocked while risk level is ${patchPlan.risk_level}.`,
      recommended_next_action: "reduce_risk",
    });
  }

  if (!Array.isArray(patchPlan.planned_change_groups) || patchPlan.planned_change_groups.length === 0) {
    blockers.push({
      code: "missing_planned_change_groups",
      message: "Patch application eligibility requires planned change groups.",
      recommended_next_action: "review_patch_plan",
    });
  }

  if ((patchPlan.planned_change_groups ?? []).some((group) => group.review_required !== true)) {
    blockers.push({
      code: "planned_change_group_review_violation",
      message: "Every planned change group must remain review-required.",
      recommended_next_action: "review_patch_plan",
    });
  }

  if ((patchPlan.planned_change_groups ?? []).some((group) => group.mutation_allowed !== false)) {
    blockers.push({
      code: "planned_change_group_mutation_violation",
      message: "Every planned change group must remain mutation-free at the application gate stage.",
      recommended_next_action: "review_patch_plan",
    });
  }

  if (!Array.isArray(patchPlan.validation_requirements) || patchPlan.validation_requirements.length === 0) {
    blockers.push({
      code: "missing_validation_requirements",
      message: "Patch application eligibility requires validation requirements.",
      recommended_next_action: "add_validation_plan",
    });
  }

  if (!patchPlan.git_commit_plan) {
    blockers.push({
      code: "missing_git_commit_plan",
      message: "Patch application eligibility requires git commit guidance.",
      recommended_next_action: "add_git_commit_plan",
    });
  }

  if (!Array.isArray(patchPlan.allowed_patch_actions) || !Array.isArray(patchPlan.disallowed_patch_actions) || patchPlan.allowed_patch_actions.length === 0 || patchPlan.disallowed_patch_actions.length === 0) {
    blockers.push({
      code: "missing_action_lists",
      message: "Patch application eligibility requires both allowed and disallowed patch action lists.",
      recommended_next_action: "review_patch_plan",
    });
  }

  const missingRequiredDisallowedActions = REQUIRED_DISALLOWED_PATCH_ACTIONS.filter(
    (action) => !(patchPlan.disallowed_patch_actions ?? []).includes(action),
  );

  if (missingRequiredDisallowedActions.length > 0) {
    blockers.push({
      code: "missing_required_disallowed_actions",
      message: `Patch application eligibility requires these disallowed patch actions to remain explicit: ${missingRequiredDisallowedActions.join(", ")}.`,
      recommended_next_action: "review_patch_plan",
    });
  }

  return blockers;
}

export function evaluatePatchPlanForApplication(
  input: ReviewedPatchApplicationGateInput,
): ReviewedPatchApplicationGateResult {
  const patchPlan = input.preparationResult.patch_plan;
  const blockers = listPatchApplicationBlockers(patchPlan);

  if (input.preparationResult.status !== "patch_plan_ready") {
    blockers.unshift({
      code: input.preparationResult.status === "patch_plan_invalid_dry_run" ? "invalid_patch_plan" : "patch_plan_not_ready",
      message: `Patch preparation status is ${input.preparationResult.status}; only patch_plan_ready results may be application-eligible.`,
      recommended_next_action: input.preparationResult.recommended_next_operator_action,
    });
  }

  let status: ReviewedPatchApplicationStatus = "application_eligible";
  let recommendedNextOperatorAction: ArtifactExecutionNextAction | "review_patch_plan" = input.preparationResult.recommended_next_operator_action;

  if (blockers.some((blocker) => blocker.code === "high_risk")) {
    status = "high_risk_blocked";
    recommendedNextOperatorAction = "reduce_risk";
  } else if (blockers.some((blocker) => blocker.code === "missing_operator_review")) {
    status = "needs_operator_review";
    recommendedNextOperatorAction = "execution_ready_review";
  } else if (blockers.some((blocker) => blocker.code === "invalid_patch_plan")) {
    status = "invalid_patch_plan";
    recommendedNextOperatorAction = "review_patch_plan";
  } else if (blockers.length > 0) {
    status = "application_blocked";
    recommendedNextOperatorAction = blockers[0]?.recommended_next_action ?? input.preparationResult.recommended_next_operator_action;
  }

  if (blockers.length > 0 || !patchPlan) {
    return {
      status,
      decision: null,
      blockers,
      recommended_next_operator_action: recommendedNextOperatorAction,
      explanation: `Reviewed patch application is blocked because ${blockers.map((blocker) => blocker.message).join(" ")}`,
    };
  }

  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const decision: ReviewedPatchApplicationDecision = {
    decision_id: buildDecisionId(patchPlan.patch_plan_id, createdAt),
    source_patch_plan_id: patchPlan.patch_plan_id,
    source_dry_run_id: patchPlan.source_dry_run_id,
    source_handoff_id: patchPlan.source_handoff_id,
    source_artifact_id: patchPlan.source_artifact_id,
    created_at: createdAt,
    status: "application_eligible",
    eligible_for_application: true,
    interpreted_goal: patchPlan.interpreted_goal,
    risk_level: patchPlan.risk_level,
    blockers: [],
    required_operator_review: true,
    validation_requirements: patchPlan.validation_requirements.map((item) => ({ ...item })),
    git_commit_plan: {
      ...patchPlan.git_commit_plan,
      stage_only: [...patchPlan.git_commit_plan.stage_only],
      github_procedure: [...patchPlan.git_commit_plan.github_procedure],
    },
    allowed_next_actions: [...ALLOWED_NEXT_ACTIONS],
    disallowed_next_actions: [...DISALLOWED_NEXT_ACTIONS],
    recommended_next_operator_action: "execution_ready_review",
  };

  return {
    status: "application_eligible",
    decision,
    blockers: [],
    recommended_next_operator_action: "execution_ready_review",
    explanation: `Reviewed patch plan ${patchPlan.patch_plan_id} is eligible for future patch draft and application review.`,
  };
}

export function summarizePatchApplicationGate(result: ReviewedPatchApplicationGateResult): string {
  const lines = [
    `Patch application status: ${result.status}`,
    `Recommended next operator action: ${result.recommended_next_operator_action}`,
    `Explanation: ${result.explanation}`,
    result.decision ? `Decision: ${result.decision.decision_id}` : "Decision: none.",
    result.blockers.length > 0
      ? `Blockers: ${result.blockers.map((blocker) => blocker.message).join(" | ")}`
      : "Blockers: none.",
  ];

  return lines.join("\n");
}