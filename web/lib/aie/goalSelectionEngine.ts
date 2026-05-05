import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";
import {
  runGoalDrivenAutonomy,
  type GoalDrivenAutonomyControllerInput,
  type GoalDrivenAutonomyControllerResult,
  type GoalDrivenAutonomyControllerStatus,
} from "./goalDrivenAutonomyController";
import type { OutcomeSummary } from "./outcomeLearning";
import type {
  PostPlaytestFeatureEvidenceSnapshot,
  PostPlaytestFeatureKnownOutcomeState,
} from "./postPlaytestFeatureSelector";

export type AutonomousGoalSelectionStatus =
  | "goal_proposed"
  | "no_goal_available"
  | "operator_review_required"
  | "selection_blocked";

export type AutonomousGoalProposal = {
  goal_id: string;
  goal_statement: string;
  success_criteria: string[];
  allowed_feature_pool: string[];
};

export type AutonomousGoalCandidate = {
  goal_id: string;
  score: number;
  reason: string;
  source_evidence: string[];
};

export type GoalSelectionEngineResult = {
  status: AutonomousGoalSelectionStatus;
  proposed_goal: AutonomousGoalProposal | null;
  candidate_goals: AutonomousGoalCandidate[];
  rejection_reasons: string[];
  confidence: "low" | "medium" | "high";
};

export type AutonomousGoalSelectionFlowStatus =
  | AutonomousGoalSelectionStatus
  | Exclude<GoalDrivenAutonomyControllerStatus, "operator_review_required">;

export type AutonomousGoalSelectionFlowInput = GoalSelectionEngineInput & {
  operator_approval: boolean;
  checkpoint_directory: string;
  max_cycles: number;
  max_features_per_cycle: number;
  max_iterations_per_feature: number;
  probe_bridge?: GoalDrivenAutonomyControllerInput["probe_bridge"];
  create_feature_loop: GoalDrivenAutonomyControllerInput["create_feature_loop"];
};

export type AutonomousGoalSelectionFlowResult = {
  status: AutonomousGoalSelectionFlowStatus;
  goal_selection: GoalSelectionEngineResult;
  execution_result: GoalDrivenAutonomyControllerResult | null;
  confidence: "low" | "medium" | "high";
};

export type GoalSelectionEngineInput = {
  learning_summary?: OutcomeSummary | null;
  feature_evidence?: PostPlaytestFeatureEvidenceSnapshot[];
  partially_completed_features?: string[];
  completed_goal_ids?: string[];
  allowed_systems?: string[];
  project_state_summary?: string[];
  max_candidate_goals?: number;
  max_features_per_goal?: number;
};

type RankedGoalCandidate = AutonomousGoalCandidate & {
  feature: string;
  known_outcome_state: PostPlaytestFeatureKnownOutcomeState;
};

const HARD_MAX_CANDIDATE_GOALS = 3;
const HARD_MAX_FEATURES_PER_GOAL = 2;

function clampBoundedCount(value: number | undefined, hardMax: number): number {
  if (!Number.isFinite(value)) {
    return hardMax;
  }

  return Math.max(1, Math.min(hardMax, Math.trunc(value!)));
}

function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function uniqueOrdered(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function filterGenericTokens(tokens: string[]): string[] {
  const genericTokens = new Set([
    "goal",
    "feature",
    "features",
    "complete",
    "completed",
    "project",
    "state",
    "system",
    "systems",
    "validation",
    "bounded",
    "safe",
    "safely",
    "proof",
    "prove",
    "follow",
    "followup",
    "next",
    "work",
    "recent",
    "learning",
    "issue",
    "issues",
  ]);

  return tokens.filter((token) => !genericTokens.has(token));
}

function buildFeaturePhrase(feature: string): string {
  return filterGenericTokens(normalizeWords(feature)).join(" ");
}

function featureMatchesText(feature: string, text: string): boolean {
  const featureTokens = filterGenericTokens(normalizeWords(feature));
  const textTokens = new Set(filterGenericTokens(normalizeWords(text)));
  if (featureTokens.length === 0 || textTokens.size === 0) {
    return false;
  }

  return featureTokens.some((token) => textTokens.has(token));
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unnamed-goal";
}

function resolveKnownOutcomeState(
  outcome: AutoRecordOutcomeResult | null | undefined,
  knownOutcomeState?: PostPlaytestFeatureKnownOutcomeState,
): PostPlaytestFeatureKnownOutcomeState {
  if (knownOutcomeState) {
    return knownOutcomeState;
  }

  if (!outcome) {
    return "unseen";
  }

  if (outcome.status === "blocked") {
    return "blocked";
  }

  if (outcome.status === "duplicate") {
    return "unstable";
  }

  switch (outcome.evaluation.parsedResult.inferredResult) {
    case "fail":
      return "failing";
    case "pass":
      return "passing";
    default:
      return "unstable";
  }
}

function featureBelongsToAllowedSystems(feature: string, allowedSystems: string[]): boolean {
  const featureTokens = new Set(filterGenericTokens(normalizeWords(feature)));
  if (featureTokens.size === 0 || allowedSystems.length === 0) {
    return false;
  }

  return allowedSystems.some((system) => {
    const systemTokens = filterGenericTokens(normalizeWords(system));
    return systemTokens.some((token) => featureTokens.has(token));
  });
}

function buildGoalId(feature: string): string {
  return `goal-selection-${slugify(feature)}`;
}

function createResult(
  status: AutonomousGoalSelectionStatus,
  overrides: Partial<GoalSelectionEngineResult> = {},
): GoalSelectionEngineResult {
  return {
    status,
    proposed_goal: overrides.proposed_goal ?? null,
    candidate_goals: overrides.candidate_goals ?? [],
    rejection_reasons: overrides.rejection_reasons ?? [],
    confidence: overrides.confidence ?? "medium",
  };
}

function collectRankedCandidates(input: GoalSelectionEngineInput): {
  rankedCandidates: RankedGoalCandidate[];
  rejectionReasons: string[];
} {
  const allowedSystems = uniqueOrdered(input.allowed_systems ?? []);
  const projectStateSummary = uniqueOrdered(input.project_state_summary ?? []);
  const partiallyCompleted = new Set(uniqueOrdered(input.partially_completed_features ?? []));
  const completedGoalIds = new Set(uniqueOrdered(input.completed_goal_ids ?? []));
  const evidenceEntries = input.feature_evidence ?? [];
  const evidenceMap = new Map(evidenceEntries.map((entry) => [entry.feature.trim(), entry]));
  const candidateFeatures = uniqueOrdered([
    ...evidenceEntries.map((entry) => entry.feature),
    ...partiallyCompleted,
  ]);
  const rejectionReasons: string[] = [];
  const rankedCandidates: RankedGoalCandidate[] = [];

  for (const feature of candidateFeatures) {
    const trimmedFeature = feature.trim();
    if (!trimmedFeature) {
      continue;
    }

    const goalId = buildGoalId(trimmedFeature);
    if (completedGoalIds.has(goalId)) {
      rejectionReasons.push(`${goalId} was already completed and cannot be reproposed.`);
      continue;
    }

    if (!featureBelongsToAllowedSystems(trimmedFeature, allowedSystems)) {
      rejectionReasons.push(`${trimmedFeature} falls outside the explicitly allowed systems.`);
      continue;
    }

    const evidence = evidenceMap.get(trimmedFeature);
    const knownOutcomeState = resolveKnownOutcomeState(evidence?.latest_outcome, evidence?.known_outcome_state);
    if (knownOutcomeState === "blocked") {
      rejectionReasons.push(`${trimmedFeature} is blocked by prior learning evidence and cannot become an autonomous goal.`);
      continue;
    }

    let score = 0;
    const sourceEvidence: string[] = [];

    switch (knownOutcomeState) {
      case "failing":
        score += 400;
        sourceEvidence.push(`${trimmedFeature} has unresolved failing evidence.`);
        break;
      case "unstable":
        score += 260;
        sourceEvidence.push(`${trimmedFeature} has unstable or partial evidence that still needs supervised validation.`);
        break;
      case "unseen":
        break;
      case "passing":
        rejectionReasons.push(`${trimmedFeature} already has passing evidence and does not justify a new autonomous goal.`);
        continue;
      default:
        break;
    }

    if (partiallyCompleted.has(trimmedFeature)) {
      score += 220;
      sourceEvidence.push(`${trimmedFeature} is partially completed and remains inside the approved work graph.`);
    }

    if (input.learning_summary?.latestFailurePatterns.some((pattern) => featureMatchesText(trimmedFeature, pattern))) {
      score += 90;
      sourceEvidence.push(`Recent learning recorded a failure pattern tied to ${trimmedFeature}.`);
    }

    if (projectStateSummary.some((summary) => featureMatchesText(trimmedFeature, summary))) {
      score += 60;
      sourceEvidence.push(`Project state still calls out ${trimmedFeature} as unresolved.`);
    }

    if (score <= 0 || sourceEvidence.length === 0) {
      rejectionReasons.push(`${trimmedFeature} had no bounded supporting evidence and cannot be proposed.`);
      continue;
    }

    const reason = knownOutcomeState === "failing"
      ? `${trimmedFeature} is the strongest bounded next goal because it combines unresolved failures with current project evidence.`
      : `${trimmedFeature} remains a bounded supervised goal candidate because its evidence is incomplete or unstable.`;

    rankedCandidates.push({
      feature: trimmedFeature,
      goal_id: goalId,
      score,
      reason,
      source_evidence: uniqueOrdered(sourceEvidence),
      known_outcome_state: knownOutcomeState,
    });
  }

  rankedCandidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.goal_id.localeCompare(right.goal_id);
  });

  return {
    rankedCandidates,
    rejectionReasons: uniqueOrdered(rejectionReasons),
  };
}

function buildGoalStatement(features: string[], projectStateSummary: string[]): string {
  const quotedFeatures = features.map((feature) => `"${feature}"`);
  if (projectStateSummary.length > 0) {
    const lead = projectStateSummary[0]?.trim();
    if (lead) {
      return `Address the next bounded project goal from current state: ${lead} Focus on ${quotedFeatures.join(" and ")}.`;
    }
  }

  if (features.length === 1) {
    return `Resolve the next bounded project goal around ${quotedFeatures[0]}.`;
  }

  return `Resolve the next bounded project goal across ${quotedFeatures.join(" and ")}.`;
}

function buildSuccessCriteria(features: string[]): string[] {
  return features.map((feature) => `Complete bounded supervised follow-up for ${feature}.`);
}

function buildConfidence(topCandidates: RankedGoalCandidate[]): "low" | "medium" | "high" {
  const primary = topCandidates[0];
  if (!primary) {
    return "low";
  }

  if (primary.known_outcome_state === "failing") {
    return "high";
  }

  if (primary.known_outcome_state === "unstable") {
    return "medium";
  }

  return "low";
}

export function selectNextAutonomousGoal(
  input: GoalSelectionEngineInput,
): GoalSelectionEngineResult {
  const allowedSystems = uniqueOrdered(input.allowed_systems ?? []);
  const projectStateSummary = uniqueOrdered(input.project_state_summary ?? []);
  const hasEvidence = (input.feature_evidence?.length ?? 0) > 0
    || (input.partially_completed_features?.length ?? 0) > 0
    || Boolean(input.learning_summary)
    || projectStateSummary.length > 0;

  if (allowedSystems.length === 0) {
    return createResult("selection_blocked", {
      rejection_reasons: ["Autonomous goal selection requires an explicit allowed system list."],
      confidence: "high",
    });
  }

  if (!hasEvidence) {
    return createResult("selection_blocked", {
      rejection_reasons: ["Autonomous goal selection requires recent learning, feature evidence, or project state before proposing a bounded goal."],
      confidence: "high",
    });
  }

  const maxCandidateGoals = clampBoundedCount(input.max_candidate_goals, HARD_MAX_CANDIDATE_GOALS);
  const maxFeaturesPerGoal = clampBoundedCount(input.max_features_per_goal, HARD_MAX_FEATURES_PER_GOAL);
  const { rankedCandidates, rejectionReasons } = collectRankedCandidates(input);

  if (rankedCandidates.length === 0) {
    return createResult("no_goal_available", {
      rejection_reasons: rejectionReasons.length > 0
        ? rejectionReasons
        : ["No bounded goal had enough supporting evidence to be proposed."],
      confidence: "high",
    });
  }

  const candidateGoals = rankedCandidates.slice(0, maxCandidateGoals).map(({ feature: _feature, known_outcome_state: _state, ...candidate }) => candidate);
  const first = rankedCandidates[0];
  const second = rankedCandidates[1];
  const ambiguousTopSelection = first
    && second
    && first.score === second.score
    && first.known_outcome_state !== "failing"
    && second.known_outcome_state !== "failing";

  if (ambiguousTopSelection) {
    return createResult("operator_review_required", {
      candidate_goals: candidateGoals,
      rejection_reasons: rejectionReasons.concat("Multiple bounded goals have equally weak top evidence, so operator review is required before selecting one."),
      confidence: "low",
    });
  }

  const proposedFeatures = rankedCandidates
    .slice(0, maxFeaturesPerGoal)
    .map((candidate) => candidate.feature);
  const proposedGoal: AutonomousGoalProposal = {
    goal_id: first.goal_id,
    goal_statement: buildGoalStatement(proposedFeatures, projectStateSummary),
    success_criteria: buildSuccessCriteria(proposedFeatures),
    allowed_feature_pool: proposedFeatures,
  };

  return createResult("goal_proposed", {
    proposed_goal: proposedGoal,
    candidate_goals: candidateGoals,
    rejection_reasons: rejectionReasons,
    confidence: buildConfidence(rankedCandidates),
  });
}

export async function runAutonomousGoalSelectionFlow(
  input: AutonomousGoalSelectionFlowInput,
): Promise<AutonomousGoalSelectionFlowResult> {
  const goalSelection = selectNextAutonomousGoal(input);

  if (goalSelection.status !== "goal_proposed" || !goalSelection.proposed_goal) {
    return {
      status: goalSelection.status,
      goal_selection: goalSelection,
      execution_result: null,
      confidence: goalSelection.confidence,
    };
  }

  if (!input.operator_approval) {
    return {
      status: "operator_review_required",
      goal_selection: goalSelection,
      execution_result: null,
      confidence: goalSelection.confidence,
    };
  }

  const executionResult = await runGoalDrivenAutonomy({
    ...goalSelection.proposed_goal,
    operator_approval: true,
    checkpoint_directory: input.checkpoint_directory,
    max_cycles: input.max_cycles,
    max_features_per_cycle: input.max_features_per_cycle,
    max_iterations_per_feature: input.max_iterations_per_feature,
    probe_bridge: input.probe_bridge,
    feature_evidence: input.feature_evidence,
    create_feature_loop: input.create_feature_loop,
  });

  return {
    status: executionResult.status,
    goal_selection: goalSelection,
    execution_result: executionResult,
    confidence: executionResult.confidence,
  };
}