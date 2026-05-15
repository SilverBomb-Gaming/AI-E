import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";

export type PostPlaytestFeatureKnownOutcomeState =
  | "unseen"
  | "failing"
  | "passing"
  | "blocked"
  | "unstable";

export type PostPlaytestFeatureSelectorStatus =
  | "feature_selected"
  | "no_feature_available"
  | "operator_review_required"
  | "selection_blocked";

export type PostPlaytestFeatureCandidateScore = {
  feature: string;
  score: number;
  reason: string;
  known_outcome_state: PostPlaytestFeatureKnownOutcomeState;
};

export type PostPlaytestRejectedFeature = {
  feature: string;
  reason: string;
};

export type PostPlaytestFeatureEvidenceSnapshot = {
  feature: string;
  latest_outcome: AutoRecordOutcomeResult | null;
  known_outcome_state?: PostPlaytestFeatureKnownOutcomeState;
};

export type PostPlaytestFeatureSelectorInput = {
  feature_pool: string[];
  completed_features?: string[];
  attempted_features?: string[];
  feature_evidence?: PostPlaytestFeatureEvidenceSnapshot[];
};

export type PostPlaytestFeatureSelectorResult = {
  status: PostPlaytestFeatureSelectorStatus;
  selected_feature: string | null;
  selected_reason: string;
  candidate_scores: PostPlaytestFeatureCandidateScore[];
  rejected_features: PostPlaytestRejectedFeature[];
  confidence: "low" | "medium" | "high";
};

function normalizeFeatureName(feature: string): string {
  return feature.trim();
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

function getOutcomeStateScore(state: PostPlaytestFeatureKnownOutcomeState): number {
  switch (state) {
    case "failing":
      return 300;
    case "unstable":
      return 200;
    case "unseen":
      return 100;
    case "passing":
      return 10;
    case "blocked":
      return -1;
    default:
      return -1;
  }
}

function getOutcomeStateReason(
  feature: string,
  state: PostPlaytestFeatureKnownOutcomeState,
): string {
  switch (state) {
    case "failing":
      return `${feature} has recorded failing evidence, so it is the highest-priority bounded retry target.`;
    case "unstable":
      return `${feature} has ambiguous or unstable evidence, so it should be reviewed before low-priority passing targets.`;
    case "unseen":
      return `${feature} has not been validated yet, so it is preferred after failing or unstable targets.`;
    case "passing":
      return `${feature} already has passing evidence, so it stays behind failing, unstable, and unseen targets.`;
    case "blocked":
      return `${feature} is blocked by prior learning evidence and cannot be auto-selected.`;
    default:
      return `${feature} has no usable evidence.`;
  }
}

export function selectPostPlaytestFeature(
  input: PostPlaytestFeatureSelectorInput,
): PostPlaytestFeatureSelectorResult {
  const normalizedPool = input.feature_pool
    .map(normalizeFeatureName)
    .filter(Boolean);
  const completedFeatures = new Set((input.completed_features ?? []).map(normalizeFeatureName));
  const evidenceMap = new Map(
    (input.feature_evidence ?? []).map((entry) => [normalizeFeatureName(entry.feature), entry]),
  );
  const attemptedFeatures = new Set((input.attempted_features ?? []).map(normalizeFeatureName));
  const rejectedFeatures: PostPlaytestRejectedFeature[] = [];

  if (normalizedPool.length === 0) {
    return {
      status: "selection_blocked",
      selected_feature: null,
      selected_reason: "The bounded feature selector requires an explicit operator-provided feature pool.",
      candidate_scores: [],
      rejected_features: [],
      confidence: "high",
    };
  }

  const candidateScores: PostPlaytestFeatureCandidateScore[] = [];
  for (const feature of normalizedPool) {
    if (completedFeatures.has(feature)) {
      rejectedFeatures.push({
        feature,
        reason: `${feature} was already completed in this bounded chain and cannot be reselected.`,
      });
      continue;
    }

    const evidence = evidenceMap.get(feature);
    const outcome = evidence?.latest_outcome ?? null;
    const knownOutcomeState = resolveKnownOutcomeState(outcome, evidence?.known_outcome_state);

    if (knownOutcomeState === "blocked") {
      rejectedFeatures.push({
        feature,
        reason: `${feature} is blocked by prior learning evidence and requires manual intervention.`,
      });
      continue;
    }

    candidateScores.push({
      feature,
      score: getOutcomeStateScore(knownOutcomeState),
      reason: getOutcomeStateReason(feature, knownOutcomeState),
      known_outcome_state: knownOutcomeState,
    });
  }

  if (candidateScores.length === 0) {
    return {
      status: "no_feature_available",
      selected_feature: null,
      selected_reason: rejectedFeatures.length > 0
        ? "No selectable feature remained in the explicit pool after removing completed or blocked targets."
        : "No reviewed feature remained available in the explicit pool.",
      candidate_scores: [],
      rejected_features: rejectedFeatures,
      confidence: "high",
    };
  }

  const unstableCandidates = candidateScores.filter((candidate) => candidate.known_outcome_state === "unstable");
  if (unstableCandidates.length > 1) {
    return {
      status: "operator_review_required",
      selected_feature: null,
      selected_reason: "Multiple features have conflicting unstable evidence, so operator review is required before the next bounded selection.",
      candidate_scores: candidateScores,
      rejected_features: rejectedFeatures,
      confidence: "low",
    };
  }

  candidateScores.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const leftAttempted = attemptedFeatures.has(left.feature) ? 1 : 0;
    const rightAttempted = attemptedFeatures.has(right.feature) ? 1 : 0;
    if (leftAttempted !== rightAttempted) {
      return leftAttempted - rightAttempted;
    }

    return left.feature.localeCompare(right.feature);
  });

  const selected = candidateScores[0] ?? null;
  if (!selected) {
    return {
      status: "selection_blocked",
      selected_feature: null,
      selected_reason: "The bounded feature selector could not determine a safe next target from the explicit pool.",
      candidate_scores: candidateScores,
      rejected_features: rejectedFeatures,
      confidence: "low",
    };
  }

  return {
    status: "feature_selected",
    selected_feature: selected.feature,
    selected_reason: selected.reason,
    candidate_scores: candidateScores,
    rejected_features: rejectedFeatures,
    confidence: selected.known_outcome_state === "failing"
      ? "high"
      : selected.known_outcome_state === "unseen"
        ? "medium"
        : "low",
  };
}

export function renderPostPlaytestFeatureSelectionReport(
  result: PostPlaytestFeatureSelectorResult,
): string {
  const lines = [
    "FEATURE SELECTION REPORT",
    "",
    `Status: ${result.status}`,
    `Selected Feature: ${result.selected_feature ?? "none"}`,
    `Reason: ${result.selected_reason}`,
    `Confidence: ${result.confidence}`,
    "",
    "Ranked Candidates:",
    ...(result.candidate_scores.length > 0
      ? result.candidate_scores.map((candidate, index) => `${index + 1}. ${candidate.feature} | score=${candidate.score} | state=${candidate.known_outcome_state} | ${candidate.reason}`)
      : ["1. None available."]),
    "",
    "Rejected Features:",
    ...(result.rejected_features.length > 0
      ? result.rejected_features.map((entry, index) => `${index + 1}. ${entry.feature} | ${entry.reason}`)
      : ["1. None."]),
  ];

  return lines.join("\n");
}