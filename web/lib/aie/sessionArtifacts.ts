import type {
  ConversationalRefinementResult,
} from "./conversationalIntentRefinement";
import type {
  ExecutionStep,
  GitCommitPlan,
  OperatorPlan,
  PlanRiskLevel,
  ValidationStep,
} from "./operatorLightPlanner";

export type SessionArtifactType =
  | "conversational_refinement"
  | "operator_plan"
  | "combined_intake_packet";

export type SessionArtifactStatus =
  | "planned"
  | "awaiting_clarification"
  | "approved"
  | "executing"
  | "validated"
  | "blocked"
  | "archived";

export type CombinedIntakePacket = {
  source_request: string;
  interpreted_intent: string;
  planner_ready_request: string | null;
  risk_level: PlanRiskLevel;
  clarity_score: number;
  confidence_score: number;
  missing_information: string[];
  follow_up_questions: string[];
  repo_targets: string[];
  execution_steps: ExecutionStep[];
  validation_steps: ValidationStep[];
  git_commit_plan: GitCommitPlan | null;
  playtest_required: boolean;
  next_operator_decision: string;
  refinement_result: ConversationalRefinementResult;
  operator_plan: OperatorPlan;
};

export type SessionArtifact = {
  artifact_id: string;
  artifact_type: SessionArtifactType;
  created_at: string;
  source_request: string;
  interpreted_intent: string | null;
  planner_ready_request: string | null;
  risk_level: PlanRiskLevel;
  clarity_score: number | null;
  confidence_score: number | null;
  missing_information: string[];
  follow_up_questions: string[];
  repo_targets: string[];
  execution_steps: ExecutionStep[];
  validation_steps: ValidationStep[];
  git_commit_plan: GitCommitPlan | null;
  playtest_required: boolean;
  next_operator_decision: string | null;
  status: SessionArtifactStatus;
  refinement_result?: ConversationalRefinementResult;
  operator_plan?: OperatorPlan;
  combined_intake_packet?: CombinedIntakePacket;
};

export type CreateSessionArtifactInput = {
  artifactType: SessionArtifactType;
  sourceRequest: string;
  refinement?: ConversationalRefinementResult;
  plan?: OperatorPlan;
  combinedPacket?: CombinedIntakePacket;
  createdAt?: string;
  artifactId?: string;
  status?: SessionArtifactStatus | string;
};

const SESSION_ARTIFACT_STATUSES = new Set<SessionArtifactStatus>([
  "planned",
  "awaiting_clarification",
  "approved",
  "executing",
  "validated",
  "blocked",
  "archived",
]);

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "artifact";
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function cloneExecutionSteps(steps: ExecutionStep[]): ExecutionStep[] {
  return steps.map((step) => ({ ...step }));
}

function cloneValidationSteps(steps: ValidationStep[]): ValidationStep[] {
  return steps.map((step) => ({ ...step }));
}

function cloneGitCommitPlan(plan: GitCommitPlan | null): GitCommitPlan | null {
  if (!plan) {
    return null;
  }

  return {
    ...plan,
    stage_only: [...plan.stage_only],
    github_procedure: [...plan.github_procedure],
  };
}

function assertValidStatus(status: SessionArtifactStatus | string): SessionArtifactStatus {
  if (SESSION_ARTIFACT_STATUSES.has(status as SessionArtifactStatus)) {
    return status as SessionArtifactStatus;
  }

  throw new Error(`Unsupported session artifact status: ${status}`);
}

function deriveDefaultStatus(params: {
  artifactType: SessionArtifactType;
  refinement?: ConversationalRefinementResult;
  plan?: OperatorPlan;
  combinedPacket?: CombinedIntakePacket;
}): SessionArtifactStatus {
  const riskLevel = params.combinedPacket?.risk_level ?? params.plan?.risk_level ?? params.refinement?.risk_level;
  const hasFollowUp = (params.combinedPacket?.follow_up_questions.length ?? params.refinement?.follow_up_questions.length ?? 0) > 0;

  if (riskLevel === "blocked" || riskLevel === "high") {
    return "blocked";
  }

  if (params.artifactType === "conversational_refinement" && hasFollowUp) {
    return "awaiting_clarification";
  }

  return "planned";
}

function buildArtifactId(artifactType: SessionArtifactType, createdAt: string, sourceRequest: string): string {
  return `${artifactType}-${sanitizeTimestamp(createdAt)}-${slugify(sourceRequest)}`;
}

function maxRiskLevel(left: PlanRiskLevel, right: PlanRiskLevel): PlanRiskLevel {
  const order: PlanRiskLevel[] = ["low", "medium", "high", "blocked"];
  return order[Math.max(order.indexOf(left), order.indexOf(right))] ?? right;
}

export function createCombinedIntakePacket(
  refinement: ConversationalRefinementResult,
  plan: OperatorPlan,
): CombinedIntakePacket {
  return {
    source_request: refinement.original_request,
    interpreted_intent: refinement.interpreted_intent,
    planner_ready_request: refinement.planner_ready_request,
    risk_level: maxRiskLevel(refinement.risk_level, plan.risk_level),
    clarity_score: refinement.clarity_score,
    confidence_score: refinement.confidence_score,
    missing_information: uniqueStrings([
      ...refinement.missing_information,
      ...plan.missing_information,
    ]),
    follow_up_questions: [...refinement.follow_up_questions],
    repo_targets: [...plan.repo_targets],
    execution_steps: cloneExecutionSteps(plan.execution_steps),
    validation_steps: cloneValidationSteps(plan.validation_steps),
    git_commit_plan: cloneGitCommitPlan(plan.git_commit_plan),
    playtest_required: plan.playtest_required,
    next_operator_decision: plan.next_operator_decision,
    refinement_result: refinement,
    operator_plan: plan,
  };
}

export function createSessionArtifact(input: CreateSessionArtifactInput): SessionArtifact {
  const sourceRequest = normalizeText(input.sourceRequest);
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();

  if (!sourceRequest) {
    throw new Error("Session artifacts require a source request.");
  }

  if (input.artifactType === "conversational_refinement" && !input.refinement) {
    throw new Error("Conversational refinement artifacts require a refinement result.");
  }

  if (input.artifactType === "operator_plan" && !input.plan) {
    throw new Error("Operator plan artifacts require an operator plan.");
  }

  if (input.artifactType === "combined_intake_packet" && !input.combinedPacket) {
    throw new Error("Combined intake packet artifacts require a combined packet.");
  }

  const defaultStatus = deriveDefaultStatus({
    artifactType: input.artifactType,
    refinement: input.refinement,
    plan: input.plan,
    combinedPacket: input.combinedPacket,
  });
  const status = assertValidStatus(input.status ?? defaultStatus);
  const artifactId = normalizeText(input.artifactId) || buildArtifactId(input.artifactType, createdAt, sourceRequest);

  if (input.artifactType === "conversational_refinement") {
    const refinement = input.refinement as ConversationalRefinementResult;
    return {
      artifact_id: artifactId,
      artifact_type: input.artifactType,
      created_at: createdAt,
      source_request: sourceRequest,
      interpreted_intent: refinement.interpreted_intent,
      planner_ready_request: refinement.planner_ready_request,
      risk_level: refinement.risk_level,
      clarity_score: refinement.clarity_score,
      confidence_score: refinement.confidence_score,
      missing_information: [...refinement.missing_information],
      follow_up_questions: [...refinement.follow_up_questions],
      repo_targets: [],
      execution_steps: [],
      validation_steps: [],
      git_commit_plan: null,
      playtest_required: false,
      next_operator_decision: null,
      status,
      refinement_result: refinement,
    };
  }

  if (input.artifactType === "operator_plan") {
    const plan = input.plan as OperatorPlan;
    return {
      artifact_id: artifactId,
      artifact_type: input.artifactType,
      created_at: createdAt,
      source_request: sourceRequest,
      interpreted_intent: input.refinement?.interpreted_intent ?? null,
      planner_ready_request: input.refinement?.planner_ready_request ?? sourceRequest,
      risk_level: plan.risk_level,
      clarity_score: input.refinement?.clarity_score ?? null,
      confidence_score: input.refinement?.confidence_score ?? null,
      missing_information: [...plan.missing_information],
      follow_up_questions: [...(input.refinement?.follow_up_questions ?? [])],
      repo_targets: [...plan.repo_targets],
      execution_steps: cloneExecutionSteps(plan.execution_steps),
      validation_steps: cloneValidationSteps(plan.validation_steps),
      git_commit_plan: cloneGitCommitPlan(plan.git_commit_plan),
      playtest_required: plan.playtest_required,
      next_operator_decision: plan.next_operator_decision,
      status,
      refinement_result: input.refinement,
      operator_plan: plan,
    };
  }

  const combinedPacket = input.combinedPacket as CombinedIntakePacket;
  return {
    artifact_id: artifactId,
    artifact_type: input.artifactType,
    created_at: createdAt,
    source_request: sourceRequest,
    interpreted_intent: combinedPacket.interpreted_intent,
    planner_ready_request: combinedPacket.planner_ready_request,
    risk_level: combinedPacket.risk_level,
    clarity_score: combinedPacket.clarity_score,
    confidence_score: combinedPacket.confidence_score,
    missing_information: [...combinedPacket.missing_information],
    follow_up_questions: [...combinedPacket.follow_up_questions],
    repo_targets: [...combinedPacket.repo_targets],
    execution_steps: cloneExecutionSteps(combinedPacket.execution_steps),
    validation_steps: cloneValidationSteps(combinedPacket.validation_steps),
    git_commit_plan: cloneGitCommitPlan(combinedPacket.git_commit_plan),
    playtest_required: combinedPacket.playtest_required,
    next_operator_decision: combinedPacket.next_operator_decision,
    status,
    refinement_result: combinedPacket.refinement_result,
    operator_plan: combinedPacket.operator_plan,
    combined_intake_packet: combinedPacket,
  };
}

export function updateSessionArtifactStatus(
  artifact: SessionArtifact,
  status: SessionArtifactStatus | string,
): SessionArtifact {
  return {
    ...artifact,
    status: assertValidStatus(status),
  };
}

export function summarizeSessionArtifact(artifact: SessionArtifact): string {
  const lines = [
    `Artifact ${artifact.artifact_id}`,
    `Type: ${artifact.artifact_type}`,
    `Status: ${artifact.status}`,
    `Created: ${artifact.created_at}`,
    `Source request: ${artifact.source_request}`,
    artifact.interpreted_intent ? `Interpreted intent: ${artifact.interpreted_intent}` : "",
    artifact.planner_ready_request ? `Planner-ready request: ${artifact.planner_ready_request}` : "",
    `Risk: ${artifact.risk_level}`,
    artifact.clarity_score !== null ? `Clarity: ${artifact.clarity_score}` : "",
    artifact.confidence_score !== null ? `Confidence: ${artifact.confidence_score}` : "",
    artifact.missing_information.length > 0
      ? `Missing information: ${artifact.missing_information.join("; ")}`
      : "Missing information: none.",
    artifact.follow_up_questions.length > 0
      ? `Follow-up questions: ${artifact.follow_up_questions.join(" | ")}`
      : "Follow-up questions: none.",
    artifact.repo_targets.length > 0
      ? `Repo targets: ${artifact.repo_targets.join(", ")}`
      : "Repo targets: none.",
    artifact.execution_steps.length > 0
      ? `Execution steps: ${artifact.execution_steps.length}`
      : "Execution steps: none.",
    artifact.validation_steps.length > 0
      ? `Validation steps: ${artifact.validation_steps.length}`
      : "Validation steps: none.",
    artifact.playtest_required ? "Playtest required: yes." : "Playtest required: no.",
    artifact.next_operator_decision ? `Next operator decision: ${artifact.next_operator_decision}` : "",
  ];

  return lines.filter(Boolean).join("\n");
}