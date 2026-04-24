import type { ArtifactExecutionNextAction } from "./artifactExecutionConsumer";
import type { ReviewedExecutionHandoffPacket } from "./reviewedExecutionBridge";

export type ExecutionDryRunStatus =
  | "dry_run_ready"
  | "dry_run_blocked"
  | "dry_run_needs_review"
  | "dry_run_invalid_packet";

export type ExecutionDryRunInput = {
  handoffPacket: ReviewedExecutionHandoffPacket;
  createdAt?: string;
};

export type ExecutionDryRunBlocker = {
  code:
    | "missing_operator_review"
    | "missing_allowed_actions"
    | "missing_validation_plan"
    | "missing_git_commit_plan"
    | "missing_playtest_flag"
    | "disallowed_action_required"
    | "invalid_handoff_packet";
  message: string;
  recommended_next_action: ArtifactExecutionNextAction | "review_handoff_packet";
};

export type ExecutionDryRunRecommendation = {
  title: string;
  details: string;
};

export type ExecutionDryRunStep = {
  step_id: string;
  title: string;
  intended_action: string;
  allowed_action_category: string;
  expected_output: string;
  mutation_allowed: false;
  requires_review: true;
};

export type ExecutionDryRunReport = {
  dry_run_id: string;
  source_handoff_id: string;
  source_artifact_id: string;
  created_at: string;
  status: ExecutionDryRunStatus;
  interpreted_goal: string;
  simulated_steps: ExecutionDryRunStep[];
  proposed_file_targets: string[];
  validation_plan: ReviewedExecutionHandoffPacket["validation_steps"];
  git_commit_plan: ReviewedExecutionHandoffPacket["git_commit_plan"];
  playtest_required: boolean;
  risk_level: ReviewedExecutionHandoffPacket["risk_level"];
  blockers: ExecutionDryRunBlocker[];
  recommendations: ExecutionDryRunRecommendation[];
  required_operator_review: true;
  next_operator_action: ArtifactExecutionNextAction | "review_handoff_packet";
};

const ALLOWED_DRY_RUN_CATEGORIES = [
  "inspect files",
  "propose changes",
  "prepare patch",
  "run tests",
  "summarize results",
];

const DISALLOWED_PATTERNS = [
  /auto-approve/i,
  /push/i,
  /destructive/i,
  /deploy/i,
  /spend money/i,
  /access secrets/i,
  /bypass validation/i,
  /modify unrelated files/i,
  /delete/i,
  /wipe/i,
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
    .slice(0, 36) || "dry-run";
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildDryRunId(handoffId: string, createdAt: string): string {
  return `dry-run-${sanitizeTimestamp(createdAt)}-${slugify(handoffId)}`;
}

function inferAllowedActionCategory(step: ReviewedExecutionHandoffPacket["execution_steps"][number]): string {
  const text = `${step.title} ${step.details}`.toLowerCase();

  if (/test|validation|playtest/.test(text)) {
    return "run tests";
  }

  if (/inspect|anchor|surface|review current/.test(text)) {
    return "inspect files";
  }

  if (/patch|prepare/.test(text)) {
    return "prepare patch";
  }

  if (/summarize|handoff|decision point|return operator-ready/.test(text)) {
    return "summarize results";
  }

  return "propose changes";
}

function stepRequiresDisallowedAction(step: ReviewedExecutionHandoffPacket["execution_steps"][number]): boolean {
  const text = `${step.title} ${step.details}`;
  return DISALLOWED_PATTERNS.some((pattern) => pattern.test(text));
}

function buildExpectedOutput(step: ReviewedExecutionHandoffPacket["execution_steps"][number], category: string): string {
  if (category === "inspect files") {
    return "A bounded inspection summary of the relevant repo surfaces and constraints.";
  }

  if (category === "run tests") {
    return "A dry-run validation plan describing which tests would run and what evidence they should produce.";
  }

  if (category === "prepare patch") {
    return "A reviewed patch preparation outline without applying any repo changes.";
  }

  if (category === "summarize results") {
    return "A reviewed execution summary with blockers, validation expectations, and next approval points.";
  }

  return `A reviewed proposal for: ${step.details}`;
}

export function validateDryRunPacket(packet: ReviewedExecutionHandoffPacket): ExecutionDryRunBlocker[] {
  const blockers: ExecutionDryRunBlocker[] = [];

  if (packet.required_operator_review !== true) {
    blockers.push({
      code: "missing_operator_review",
      message: "Dry-run packets require explicit operator review before simulation can proceed.",
      recommended_next_action: "execution_ready_review",
    });
  }

  if (!Array.isArray(packet.allowed_actions) || packet.allowed_actions.length === 0) {
    blockers.push({
      code: "missing_allowed_actions",
      message: "Dry-run packets must declare allowed actions.",
      recommended_next_action: "review_handoff_packet",
    });
  }

  if (!Array.isArray(packet.validation_steps) || packet.validation_steps.length === 0) {
    blockers.push({
      code: "missing_validation_plan",
      message: "Dry-run packets must include a validation plan.",
      recommended_next_action: "add_validation_plan",
    });
  }

  if (!packet.git_commit_plan) {
    blockers.push({
      code: "missing_git_commit_plan",
      message: "Dry-run packets must include git commit guidance.",
      recommended_next_action: "add_git_commit_plan",
    });
  }

  if (typeof packet.playtest_required !== "boolean") {
    blockers.push({
      code: "missing_playtest_flag",
      message: "Dry-run packets must explicitly state whether playtesting is required.",
      recommended_next_action: "confirm_playtest_scope",
    });
  }

  if (!Array.isArray(packet.execution_steps) || packet.execution_steps.length === 0) {
    blockers.push({
      code: "invalid_handoff_packet",
      message: "Dry-run packets must include execution steps to simulate.",
      recommended_next_action: "review_handoff_packet",
    });
  }

  for (const step of packet.execution_steps ?? []) {
    if (stepRequiresDisallowedAction(step)) {
      blockers.push({
        code: "disallowed_action_required",
        message: `Execution step requires a disallowed action during dry-run simulation: ${step.title}`,
        recommended_next_action: "execution_ready_review",
      });
      break;
    }
  }

  return blockers;
}

export function runExecutionDryRun(input: ExecutionDryRunInput): ExecutionDryRunReport {
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const packet = input.handoffPacket;
  const blockers = validateDryRunPacket(packet);

  let status: ExecutionDryRunStatus = "dry_run_ready";
  let nextOperatorAction: ArtifactExecutionNextAction | "review_handoff_packet" = "execution_ready_review";

  if (blockers.some((blocker) => blocker.code === "invalid_handoff_packet")) {
    status = "dry_run_invalid_packet";
    nextOperatorAction = "review_handoff_packet";
  } else if (blockers.some((blocker) => blocker.code === "missing_operator_review")) {
    status = "dry_run_needs_review";
    nextOperatorAction = "execution_ready_review";
  } else if (blockers.length > 0) {
    status = "dry_run_blocked";
    nextOperatorAction = blockers[0]?.recommended_next_action ?? "review_handoff_packet";
  }

  const simulatedSteps: ExecutionDryRunStep[] = status === "dry_run_ready"
    ? packet.execution_steps.map((step, index) => {
        const category = inferAllowedActionCategory(step);
        return {
          step_id: `dry-run-step-${index + 1}`,
          title: step.title,
          intended_action: step.details,
          allowed_action_category: category,
          expected_output: buildExpectedOutput(step, category),
          mutation_allowed: false,
          requires_review: true,
        };
      })
    : [];

  const recommendations: ExecutionDryRunRecommendation[] = blockers.length === 0
    ? [
        {
          title: "Review the simulated chain before patch preparation",
          details: "Use the dry-run report to confirm scope, validation, and reporting requirements before any reviewed patch-preparation layer consumes the handoff.",
        },
      ]
    : blockers.map((blocker) => ({
        title: `Resolve ${blocker.code}`,
        details: blocker.message,
      }));

  return {
    dry_run_id: buildDryRunId(packet.handoff_id, createdAt),
    source_handoff_id: packet.handoff_id,
    source_artifact_id: packet.source_artifact_id,
    created_at: createdAt,
    status,
    interpreted_goal: packet.interpreted_goal,
    simulated_steps: simulatedSteps,
    proposed_file_targets: [...packet.repo_targets],
    validation_plan: packet.validation_steps.map((step) => ({ ...step })),
    git_commit_plan: {
      ...packet.git_commit_plan,
      stage_only: [...packet.git_commit_plan.stage_only],
      github_procedure: [...packet.git_commit_plan.github_procedure],
    },
    playtest_required: packet.playtest_required,
    risk_level: packet.risk_level,
    blockers,
    recommendations,
    required_operator_review: true,
    next_operator_action: nextOperatorAction,
  };
}

export function summarizeDryRunReport(report: ExecutionDryRunReport): string {
  const lines = [
    `Dry-run status: ${report.status}`,
    `Dry-run id: ${report.dry_run_id}`,
    `Source handoff: ${report.source_handoff_id}`,
    `Interpreted goal: ${report.interpreted_goal}`,
    `Simulated steps: ${report.simulated_steps.length}`,
    `Next operator action: ${report.next_operator_action}`,
    report.blockers.length > 0
      ? `Blockers: ${report.blockers.map((blocker) => blocker.message).join(" | ")}`
      : "Blockers: none.",
  ];

  return lines.join("\n");
}