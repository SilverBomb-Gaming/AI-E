import type {
  ArtifactExecutionBlocker,
  ArtifactExecutionDecision,
  ArtifactExecutionNextAction,
} from "./artifactExecutionConsumer";
import type { SessionArtifact } from "./sessionArtifacts";

export type ReviewedExecutionBridgeStatus =
  | "handoff_ready"
  | "blocked"
  | "needs_review"
  | "needs_approval"
  | "high_risk_blocked";

export type ReviewedExecutionBridgeInput = {
  artifact: SessionArtifact;
  decision: ArtifactExecutionDecision;
  createdAt?: string;
};

export type ReviewedExecutionBridgeBlocker = {
  code: string;
  message: string;
  recommended_next_action: ArtifactExecutionNextAction;
};

export type ReviewedExecutionHandoffPacket = {
  handoff_id: string;
  source_artifact_id: string;
  created_at: string;
  interpreted_goal: string;
  source_request: string;
  repo_targets: string[];
  execution_steps: SessionArtifact["execution_steps"];
  validation_steps: SessionArtifact["validation_steps"];
  git_commit_plan: NonNullable<SessionArtifact["git_commit_plan"]>;
  risk_level: SessionArtifact["risk_level"];
  playtest_required: boolean;
  required_operator_review: true;
  allowed_actions: string[];
  disallowed_actions: string[];
  commit_guidance: string[];
  completion_report_requirements: string[];
};

export type ReviewedExecutionBridgeResult = {
  status: ReviewedExecutionBridgeStatus;
  ready_for_handoff: boolean;
  handoff_packet: ReviewedExecutionHandoffPacket | null;
  blockers: ReviewedExecutionBridgeBlocker[];
  recommended_next_operator_action: ArtifactExecutionNextAction;
  explanation: string;
};

const ALLOWED_ACTIONS = [
  "inspect files",
  "propose changes",
  "prepare patch",
  "run tests",
  "summarize results",
];

const DISALLOWED_ACTIONS = [
  "auto-approve execution",
  "push without review",
  "modify unrelated files",
  "run destructive commands",
  "deploy",
  "spend money",
  "access secrets",
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
    .slice(0, 36) || "handoff";
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function cloneExecutionSteps(steps: SessionArtifact["execution_steps"]): SessionArtifact["execution_steps"] {
  return steps.map((step) => ({ ...step }));
}

function cloneValidationSteps(steps: SessionArtifact["validation_steps"]): SessionArtifact["validation_steps"] {
  return steps.map((step) => ({ ...step }));
}

function cloneGitCommitPlan(plan: NonNullable<SessionArtifact["git_commit_plan"]>): NonNullable<SessionArtifact["git_commit_plan"]> {
  return {
    ...plan,
    stage_only: [...plan.stage_only],
    github_procedure: [...plan.github_procedure],
  };
}

function mapDecisionBlockers(blockers: ArtifactExecutionBlocker[]): ReviewedExecutionBridgeBlocker[] {
  return blockers.map((blocker) => ({
    code: blocker.code,
    message: blocker.message,
    recommended_next_action: blocker.recommended_next_action,
  }));
}

function buildHandoffId(sourceArtifactId: string, createdAt: string): string {
  return `reviewed-handoff-${sanitizeTimestamp(createdAt)}-${slugify(sourceArtifactId)}`;
}

function deriveInterpretedGoal(artifact: SessionArtifact): string {
  return normalizeText(artifact.interpreted_intent)
    || normalizeText(artifact.planner_ready_request)
    || normalizeText(artifact.source_request)
    || "Reviewed execution handoff";
}

function listBridgeBlockers(
  artifact: SessionArtifact,
  decision: ArtifactExecutionDecision,
): ReviewedExecutionBridgeBlocker[] {
  const blockers = mapDecisionBlockers(decision.blockers);

  if (decision.status !== "ready") {
    blockers.push({
      code: "decision_not_ready",
      message: `Execution decision status is ${decision.status}; only ready decisions may produce a reviewed handoff packet.`,
      recommended_next_action: decision.recommended_next_action,
    });
  }

  if (!decision.ready_for_execution) {
    blockers.push({
      code: "decision_not_execution_ready",
      message: "Execution decision is not marked ready_for_execution.",
      recommended_next_action: decision.recommended_next_action,
    });
  }

  if (artifact.status !== "approved") {
    blockers.push({
      code: "artifact_not_approved",
      message: `Artifact status is ${artifact.status}; the reviewed bridge only accepts approved artifacts.`,
      recommended_next_action: "approve_artifact",
    });
  }

  if (artifact.risk_level === "high" || artifact.risk_level === "blocked") {
    blockers.push({
      code: "artifact_high_risk",
      message: `Artifact risk level is ${artifact.risk_level}; reviewed handoff stays blocked until risk is reduced.`,
      recommended_next_action: "reduce_risk",
    });
  }

  if (artifact.validation_steps.length === 0) {
    blockers.push({
      code: "artifact_missing_validation_steps",
      message: "Artifact does not include validation steps for the reviewed handoff.",
      recommended_next_action: "add_validation_plan",
    });
  }

  if (!artifact.git_commit_plan) {
    blockers.push({
      code: "artifact_missing_git_commit_plan",
      message: "Artifact does not include git commit guidance for the reviewed handoff.",
      recommended_next_action: "add_git_commit_plan",
    });
  }

  if (typeof artifact.playtest_required !== "boolean") {
    blockers.push({
      code: "artifact_missing_playtest_flag",
      message: "Artifact does not explicitly state whether playtesting is required.",
      recommended_next_action: "confirm_playtest_scope",
    });
  }

  return blockers.filter((blocker, index, all) => all.findIndex((entry) => entry.code === blocker.code) === index);
}

export function buildExecutionHandoffPacket(
  artifact: SessionArtifact,
  decision: ArtifactExecutionDecision,
): ReviewedExecutionHandoffPacket {
  const createdAt = new Date().toISOString();

  if (decision.status !== "ready" || !decision.ready_for_execution || artifact.status !== "approved" || !artifact.git_commit_plan) {
    throw new Error("Reviewed execution handoff packets require an approved artifact with a ready execution decision.");
  }

  return {
    handoff_id: buildHandoffId(artifact.artifact_id, createdAt),
    source_artifact_id: artifact.artifact_id,
    created_at: createdAt,
    interpreted_goal: deriveInterpretedGoal(artifact),
    source_request: artifact.source_request,
    repo_targets: [...artifact.repo_targets],
    execution_steps: cloneExecutionSteps(artifact.execution_steps),
    validation_steps: cloneValidationSteps(artifact.validation_steps),
    git_commit_plan: cloneGitCommitPlan(artifact.git_commit_plan),
    risk_level: artifact.risk_level,
    playtest_required: artifact.playtest_required,
    required_operator_review: true,
    allowed_actions: [...ALLOWED_ACTIONS],
    disallowed_actions: [...DISALLOWED_ACTIONS],
    commit_guidance: [...artifact.git_commit_plan.github_procedure],
    completion_report_requirements: [
      "Summarize the inspected files and proposed patch scope.",
      "Report test commands run and their results.",
      "Call out validation coverage and any remaining blockers.",
      "List changed files tied to the approved artifact only.",
      "Return playtest findings or explicitly note when playtesting remains pending.",
    ],
  };
}

export function createReviewedExecutionHandoff(
  input: ReviewedExecutionBridgeInput,
): ReviewedExecutionBridgeResult {
  const blockers = listBridgeBlockers(input.artifact, input.decision);

  let status: ReviewedExecutionBridgeStatus = "handoff_ready";
  let recommendedNextOperatorAction: ArtifactExecutionNextAction = "execution_ready_review";

  if (blockers.some((blocker) => blocker.code === "artifact_high_risk" || blocker.code === "high_risk")) {
    status = "high_risk_blocked";
    recommendedNextOperatorAction = "reduce_risk";
  } else if (blockers.some((blocker) => blocker.code === "artifact_not_approved" || blocker.code === "status_not_approved")) {
    status = "needs_approval";
    recommendedNextOperatorAction = "approve_artifact";
  } else if (blockers.some((blocker) => blocker.code === "decision_not_ready" || blocker.code === "decision_not_execution_ready")) {
    status = "needs_review";
    recommendedNextOperatorAction = input.decision.recommended_next_action;
  } else if (blockers.length > 0) {
    status = "blocked";
    recommendedNextOperatorAction = blockers[0]?.recommended_next_action ?? input.decision.recommended_next_action;
  }

  if (blockers.length > 0) {
    return {
      status,
      ready_for_handoff: false,
      handoff_packet: null,
      blockers,
      recommended_next_operator_action: recommendedNextOperatorAction,
      explanation: `Reviewed execution handoff is blocked because ${blockers.map((blocker) => blocker.message).join(" ")}`,
    };
  }

  const handoffPacket = buildExecutionHandoffPacket(input.artifact, input.decision);
  return {
    status: "handoff_ready",
    ready_for_handoff: true,
    handoff_packet: handoffPacket,
    blockers: [],
    recommended_next_operator_action: "execution_ready_review",
    explanation: `Reviewed execution handoff ${handoffPacket.handoff_id} is ready for a future dry-run execution chain review.`,
  };
}

export function summarizeReviewedExecutionBridge(result: ReviewedExecutionBridgeResult): string {
  const lines = [
    `Bridge status: ${result.status}`,
    `Ready for handoff: ${result.ready_for_handoff ? "yes" : "no"}`,
    `Recommended next operator action: ${result.recommended_next_operator_action}`,
    `Explanation: ${result.explanation}`,
    result.handoff_packet ? `Handoff packet: ${result.handoff_packet.handoff_id}` : "Handoff packet: none.",
    result.blockers.length > 0
      ? `Blockers: ${result.blockers.map((blocker) => blocker.message).join(" | ")}`
      : "Blockers: none.",
  ];

  return lines.join("\n");
}