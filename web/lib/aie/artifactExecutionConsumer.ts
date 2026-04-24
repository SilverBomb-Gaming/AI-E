import type { PlanRiskLevel } from "./operatorLightPlanner";
import type { SessionArtifact } from "./sessionArtifacts";

export type ArtifactExecutionStatus =
  | "ready"
  | "blocked"
  | "needs_approval"
  | "needs_clarification"
  | "needs_validation_plan"
  | "high_risk_blocked";

export type ArtifactExecutionNextAction =
  | "approve_artifact"
  | "provide_clarification"
  | "add_validation_plan"
  | "add_git_commit_plan"
  | "reduce_risk"
  | "confirm_playtest_scope"
  | "execution_ready_review"
  | "hold_execution";

export type ArtifactExecutionBlocker = {
  code:
    | "status_not_approved"
    | "high_risk"
    | "missing_information"
    | "missing_validation_steps"
    | "missing_git_commit_plan"
    | "clarification_required"
    | "missing_playtest_flag";
  message: string;
  blocking: boolean;
  recommended_next_action: ArtifactExecutionNextAction;
};

export type ArtifactExecutionReadinessInput = SessionArtifact;

export type ArtifactExecutionDecision = {
  artifact_id: string;
  artifact_type: SessionArtifact["artifact_type"];
  status: ArtifactExecutionStatus;
  ready_for_execution: boolean;
  blockers: ArtifactExecutionBlocker[];
  recommended_next_action: ArtifactExecutionNextAction;
  explanation: string;
  source_request: string;
  risk_level: PlanRiskLevel;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasBlockingMissingInformation(items: string[]): boolean {
  const patterns = [
    /not specified/i,
    /not provided/i,
    /too broad/i,
    /approval boundaries/i,
    /not defined/i,
    /clearer target/i,
    /exact bug/i,
    /first safe bounded task/i,
    /empty/i,
  ];

  return items.some((item) => patterns.some((pattern) => pattern.test(item)));
}

function requiresClarification(nextOperatorDecision: string | null, missingInformation: string[]): boolean {
  const normalizedDecision = normalizeText(nextOperatorDecision).toLowerCase();
  if (!normalizedDecision) {
    return false;
  }

  const decisionRequestsClarification = [
    /provide the missing/i,
    /clarif/i,
    /approval boundary/i,
    /specify/i,
    /before planning/i,
    /answer the remaining open question/i,
  ].some((pattern) => pattern.test(normalizedDecision));

  return decisionRequestsClarification || (hasBlockingMissingInformation(missingInformation) && decisionRequestsClarification);
}

export function listArtifactExecutionBlockers(
  artifact: ArtifactExecutionReadinessInput,
): ArtifactExecutionBlocker[] {
  const blockers: ArtifactExecutionBlocker[] = [];

  if (artifact.status !== "approved") {
    blockers.push({
      code: "status_not_approved",
      message: `Artifact status is ${artifact.status}; only approved artifacts may be execution-ready.`,
      blocking: true,
      recommended_next_action: "approve_artifact",
    });
  }

  if (artifact.risk_level === "high" || artifact.risk_level === "blocked") {
    blockers.push({
      code: "high_risk",
      message: `Artifact risk level is ${artifact.risk_level}, which is not eligible for execution readiness.`,
      blocking: true,
      recommended_next_action: "reduce_risk",
    });
  }

  if (
    artifact.missing_information.length > 0 &&
    hasBlockingMissingInformation(artifact.missing_information) &&
    requiresClarification(artifact.next_operator_decision, artifact.missing_information)
  ) {
    blockers.push({
      code: "missing_information",
      message: `Artifact still has blocking missing information: ${artifact.missing_information.join("; ")}`,
      blocking: true,
      recommended_next_action: "provide_clarification",
    });
  }

  if (artifact.validation_steps.length === 0) {
    blockers.push({
      code: "missing_validation_steps",
      message: "Artifact does not include validation steps.",
      blocking: true,
      recommended_next_action: "add_validation_plan",
    });
  }

  if (!artifact.git_commit_plan) {
    blockers.push({
      code: "missing_git_commit_plan",
      message: "Artifact does not include git commit guidance for reviewed execution.",
      blocking: true,
      recommended_next_action: "add_git_commit_plan",
    });
  }

  if (requiresClarification(artifact.next_operator_decision, artifact.missing_information)) {
    blockers.push({
      code: "clarification_required",
      message: `Artifact still requires clarification before execution: ${normalizeText(artifact.next_operator_decision) || "clarification is still required."}`,
      blocking: true,
      recommended_next_action: "provide_clarification",
    });
  }

  if (typeof artifact.playtest_required !== "boolean") {
    blockers.push({
      code: "missing_playtest_flag",
      message: "Artifact does not explicitly state whether playtesting is required.",
      blocking: true,
      recommended_next_action: "confirm_playtest_scope",
    });
  }

  return blockers;
}

export function evaluateArtifactForExecution(
  artifact: ArtifactExecutionReadinessInput,
): ArtifactExecutionDecision {
  const blockers = listArtifactExecutionBlockers(artifact);

  let status: ArtifactExecutionStatus = "ready";
  let recommendedNextAction: ArtifactExecutionNextAction = "execution_ready_review";

  if (blockers.some((blocker) => blocker.code === "high_risk")) {
    status = "high_risk_blocked";
    recommendedNextAction = "reduce_risk";
  } else if (blockers.some((blocker) => blocker.code === "status_not_approved")) {
    status = "needs_approval";
    recommendedNextAction = "approve_artifact";
  } else if (blockers.some((blocker) => blocker.code === "clarification_required" || blocker.code === "missing_information")) {
    status = "needs_clarification";
    recommendedNextAction = "provide_clarification";
  } else if (blockers.some((blocker) => blocker.code === "missing_validation_steps" || blocker.code === "missing_git_commit_plan" || blocker.code === "missing_playtest_flag")) {
    status = "needs_validation_plan";
    recommendedNextAction = blockers.find((blocker) => blocker.blocking)?.recommended_next_action ?? "add_validation_plan";
  } else if (blockers.length > 0) {
    status = "blocked";
    recommendedNextAction = blockers[0]?.recommended_next_action ?? "hold_execution";
  }

  const readyForExecution = blockers.length === 0;
  const explanation = readyForExecution
    ? `Artifact ${artifact.artifact_id} is approved, has executable planning metadata, and is ready for a future execution chain review.`
    : `Artifact ${artifact.artifact_id} is not execution-ready because ${blockers.map((blocker) => blocker.message).join(" ")}`;

  return {
    artifact_id: artifact.artifact_id,
    artifact_type: artifact.artifact_type,
    status,
    ready_for_execution: readyForExecution,
    blockers,
    recommended_next_action: recommendedNextAction,
    explanation,
    source_request: artifact.source_request,
    risk_level: artifact.risk_level,
  };
}

export function summarizeExecutionDecision(decision: ArtifactExecutionDecision): string {
  const lines = [
    `Artifact ${decision.artifact_id}`,
    `Execution status: ${decision.status}`,
    `Ready for execution: ${decision.ready_for_execution ? "yes" : "no"}`,
    `Risk: ${decision.risk_level}`,
    `Recommended next action: ${decision.recommended_next_action}`,
    `Explanation: ${decision.explanation}`,
    decision.blockers.length > 0
      ? `Blockers: ${decision.blockers.map((blocker) => blocker.message).join(" | ")}`
      : "Blockers: none.",
  ];

  return lines.join("\n");
}