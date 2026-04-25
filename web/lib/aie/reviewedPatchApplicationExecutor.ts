import type { ArtifactExecutionNextAction } from "./artifactExecutionConsumer";
import type {
  ReviewedPatchDraft,
  ReviewedPatchDraftResult,
} from "./reviewedPatchDraftGenerator";

export type ReviewedPatchApplicationExecutorStatus =
  | "application_packet_ready"
  | "application_packet_blocked"
  | "application_packet_needs_review"
  | "invalid_patch_draft"
  | "high_risk_blocked";

export type ReviewedPatchApplicationExecutorInput = {
  draftResult: ReviewedPatchDraftResult | null;
  createdAt?: string;
};

export type ReviewedPatchApplicationExecutorBlocker = {
  code:
    | "draft_not_ready"
    | "missing_patch_draft"
    | "missing_operator_review"
    | "invalid_change_descriptions"
    | "missing_validation_requirements"
    | "missing_git_commit_plan"
    | "missing_disallowed_draft_actions"
    | "invalid_patch_draft"
    | "high_risk";
  message: string;
  recommended_next_action: ArtifactExecutionNextAction | "review_patch_draft";
};

export type ReviewedPatchApplicationPacket = {
  application_packet_id: string;
  source_draft_id: string;
  source_decision_id: string;
  source_patch_plan_id: string;
  source_dry_run_id: string;
  source_handoff_id: string;
  source_artifact_id: string;
  created_at: string;
  interpreted_goal: string;
  risk_level: ReviewedPatchDraft["risk_level"];
  application_instructions: string[];
  affected_targets: string[];
  validation_requirements: ReviewedPatchDraft["validation_requirements"];
  git_commit_plan: ReviewedPatchDraft["git_commit_plan"];
  playtest_required: boolean;
  required_operator_review: true;
  human_approval_required: true;
  allowed_executor_actions: string[];
  disallowed_executor_actions: string[];
  completion_report_requirements: string[];
  next_operator_action: ArtifactExecutionNextAction | "review_patch_draft";
};

export type ReviewedPatchApplicationExecutorResult = {
  status: ReviewedPatchApplicationExecutorStatus;
  application_packet: ReviewedPatchApplicationPacket | null;
  blockers: ReviewedPatchApplicationExecutorBlocker[];
  recommended_next_operator_action: ArtifactExecutionNextAction | "review_patch_draft";
  explanation: string;
};

const REQUIRED_DISALLOWED_DRAFT_ACTIONS = [
  "write files",
  "apply patches",
  "commit changes",
  "push branches",
  "auto-approve implementation",
];

const ALLOWED_EXECUTOR_ACTIONS = [
  "inspect target files",
  "prepare reviewed implementation notes",
  "generate patch proposal text",
  "list exact validation commands",
  "summarize expected changes",
];

const DISALLOWED_EXECUTOR_ACTIONS = [
  "write files automatically",
  "apply patches automatically",
  "commit automatically",
  "push automatically",
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
    .slice(0, 36) || "application-packet";
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildApplicationPacketId(sourceDraftId: string, createdAt: string): string {
  return `application-packet-${sanitizeTimestamp(createdAt)}-${slugify(sourceDraftId)}`;
}

function hasRequiredDisallowedDraftActions(disallowedDraftActions: string[]): boolean {
  return REQUIRED_DISALLOWED_DRAFT_ACTIONS.every((action) => disallowedDraftActions.includes(action));
}

function buildApplicationInstructions(draft: ReviewedPatchDraft): string[] {
  const changeLines = draft.change_descriptions.map(
    (change, index) => `Review change ${index + 1} for ${change.target}: ${change.intended_change}`,
  );

  const validationLines = draft.validation_requirements.map((requirement) => {
    const command = normalizeText(requirement.command);
    return command
      ? `Validation command: ${command}`
      : `Validation requirement: ${requirement.description}`;
  });

  return [
    `Stay within reviewed targets: ${draft.affected_targets.join(", ")}.`,
    ...changeLines,
    ...validationLines,
    `Commit intent remains review-only: ${draft.git_commit_plan.commit_message}.`,
  ];
}

export function validateDraftResultForApplicationPacket(
  draftResult: ReviewedPatchDraftResult | null,
): ReviewedPatchApplicationExecutorBlocker[] {
  if (!draftResult) {
    return [{
      code: "invalid_patch_draft",
      message: "Reviewed patch application executor requires a patch draft result.",
      recommended_next_action: "review_patch_draft",
    }];
  }

  const blockers: ReviewedPatchApplicationExecutorBlocker[] = [];
  const draft = draftResult.draft;

  if (draftResult.status !== "draft_ready") {
    blockers.push({
      code: "draft_not_ready",
      message: `Patch draft result status is ${draftResult.status}; only draft_ready results may produce an application packet.`,
      recommended_next_action: draftResult.recommended_next_operator_action,
    });
  }

  if (!draft) {
    blockers.push({
      code: "missing_patch_draft",
      message: "Reviewed patch application executor requires a reviewed patch draft.",
      recommended_next_action: "review_patch_draft",
    });
    return blockers;
  }

  if (draft.required_operator_review !== true) {
    blockers.push({
      code: "missing_operator_review",
      message: "Reviewed patch application executor requires explicit operator review.",
      recommended_next_action: "execution_ready_review",
    });
  }

  if (draft.risk_level === "high" || draft.risk_level === "blocked") {
    blockers.push({
      code: "high_risk",
      message: `Reviewed patch application executor is blocked while risk level is ${draft.risk_level}.`,
      recommended_next_action: "reduce_risk",
    });
  }

  if (
    !Array.isArray(draft.change_descriptions)
    || draft.change_descriptions.length === 0
    || draft.change_descriptions.some(
      (change) => change.review_required !== true || change.mutation_allowed !== false,
    )
  ) {
    blockers.push({
      code: "invalid_change_descriptions",
      message: "Reviewed patch application executor requires review-only, mutation-free change descriptions.",
      recommended_next_action: "review_patch_draft",
    });
  }

  if (!Array.isArray(draft.validation_requirements) || draft.validation_requirements.length === 0) {
    blockers.push({
      code: "missing_validation_requirements",
      message: "Reviewed patch application executor requires validation requirements.",
      recommended_next_action: "add_validation_plan",
    });
  }

  if (!draft.git_commit_plan) {
    blockers.push({
      code: "missing_git_commit_plan",
      message: "Reviewed patch application executor requires git commit guidance.",
      recommended_next_action: "add_git_commit_plan",
    });
  }

  if (
    !Array.isArray(draft.disallowed_draft_actions)
    || !hasRequiredDisallowedDraftActions(draft.disallowed_draft_actions)
  ) {
    blockers.push({
      code: "missing_disallowed_draft_actions",
      message: "Reviewed patch application executor requires explicit disallowed draft actions for write, apply, commit, push, and auto-approval steps.",
      recommended_next_action: "review_patch_draft",
    });
  }

  return blockers;
}

export function createReviewedPatchApplicationPacket(
  input: ReviewedPatchApplicationExecutorInput,
): ReviewedPatchApplicationExecutorResult {
  const blockers = validateDraftResultForApplicationPacket(input.draftResult);

  let status: ReviewedPatchApplicationExecutorStatus = "application_packet_ready";
  let recommendedNextOperatorAction: ArtifactExecutionNextAction | "review_patch_draft" = input.draftResult?.recommended_next_operator_action ?? "review_patch_draft";

  if (blockers.some((blocker) => blocker.code === "high_risk")) {
    status = "high_risk_blocked";
    recommendedNextOperatorAction = "reduce_risk";
  } else if (blockers.some((blocker) => blocker.code === "missing_operator_review")) {
    status = "application_packet_needs_review";
    recommendedNextOperatorAction = "execution_ready_review";
  } else if (blockers.some((blocker) => blocker.code === "invalid_patch_draft")) {
    status = "invalid_patch_draft";
    recommendedNextOperatorAction = "review_patch_draft";
  } else if (blockers.length > 0) {
    status = "application_packet_blocked";
    recommendedNextOperatorAction = blockers[0]?.recommended_next_action ?? recommendedNextOperatorAction;
  }

  if (blockers.length > 0 || !input.draftResult?.draft) {
    return {
      status,
      application_packet: null,
      blockers,
      recommended_next_operator_action: recommendedNextOperatorAction,
      explanation: `Reviewed patch application executor is blocked because ${blockers.map((blocker) => blocker.message).join(" ")}`,
    };
  }

  const draft = input.draftResult.draft;
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const applicationPacket: ReviewedPatchApplicationPacket = {
    application_packet_id: buildApplicationPacketId(draft.draft_id, createdAt),
    source_draft_id: draft.draft_id,
    source_decision_id: draft.source_decision_id,
    source_patch_plan_id: draft.source_patch_plan_id,
    source_dry_run_id: draft.source_dry_run_id,
    source_handoff_id: draft.source_handoff_id,
    source_artifact_id: draft.source_artifact_id,
    created_at: createdAt,
    interpreted_goal: draft.interpreted_goal,
    risk_level: draft.risk_level,
    application_instructions: buildApplicationInstructions(draft),
    affected_targets: [...draft.affected_targets],
    validation_requirements: draft.validation_requirements.map((requirement) => ({ ...requirement })),
    git_commit_plan: {
      ...draft.git_commit_plan,
      stage_only: [...draft.git_commit_plan.stage_only],
      github_procedure: [...draft.git_commit_plan.github_procedure],
    },
    playtest_required: draft.playtest_required,
    required_operator_review: true,
    human_approval_required: true,
    allowed_executor_actions: [...ALLOWED_EXECUTOR_ACTIONS],
    disallowed_executor_actions: [...DISALLOWED_EXECUTOR_ACTIONS],
    completion_report_requirements: [
      "Summarize the reviewed implementation notes without writing files.",
      "List the exact validation commands that must run before any future mutation step.",
      "Describe the expected changes for each affected target without applying them.",
      "Confirm human approval is still required before any file mutation.",
      "Restate the commit intent without creating a commit or patch.",
    ],
    next_operator_action: draft.next_operator_action,
  };

  return {
    status: "application_packet_ready",
    application_packet: applicationPacket,
    blockers: [],
    recommended_next_operator_action: draft.next_operator_action,
    explanation: `Reviewed patch application packet ${applicationPacket.application_packet_id} is ready for human review before any future controlled patch execution step.`,
  };
}

export function summarizeReviewedPatchApplicationExecutor(
  result: ReviewedPatchApplicationExecutorResult,
): string {
  const lines = [
    `Patch application executor status: ${result.status}`,
    `Recommended next operator action: ${result.recommended_next_operator_action}`,
    `Explanation: ${result.explanation}`,
    result.application_packet
      ? `Application packet: ${result.application_packet.application_packet_id}`
      : "Application packet: none.",
    result.blockers.length > 0
      ? `Blockers: ${result.blockers.map((blocker) => blocker.message).join(" | ")}`
      : "Blockers: none.",
  ];

  return lines.join("\n");
}