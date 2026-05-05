import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  runLongRunningAutonomySession,
  type LongRunningAutonomyControllerInput,
} from "./longRunningAutonomyController";
import {
  selectPostPlaytestFeature,
  type PostPlaytestFeatureEvidenceSnapshot,
  type PostPlaytestFeatureSelectorResult,
} from "./postPlaytestFeatureSelector";
import type { PostPlaytestFeatureChainFeatureInput } from "./postPlaytestFeatureChainController";

export type GoalDrivenAutonomyGoalInput = {
  goal_id: string;
  goal_statement: string;
  success_criteria: string[];
  allowed_feature_pool: string[];
  max_cycles: number;
  max_features_per_cycle: number;
  max_iterations_per_feature: number;
  operator_approval: boolean;
};

export type GoalDrivenAutonomyControllerStatus =
  | "goal_progress_made"
  | "goal_completed"
  | "goal_blocked"
  | "budget_exhausted"
  | "operator_review_required"
  | "safety_stop";

export type GoalDrivenAutonomyControllerResult = {
  status: GoalDrivenAutonomyControllerStatus;
  goal_id: string;
  cycles_completed: number;
  selected_features: string[];
  completed_features: string[];
  progress_evidence: string[];
  unmet_success_criteria: string[];
  checkpoint_path?: string;
  stop_reason: string;
  confidence: "low" | "medium" | "high";
};

export type GoalDrivenAutonomyCheckpoint = {
  goal_id: string;
  goal_statement: string;
  cycle: number;
  selected_features: string[];
  completed_features: string[];
  progress_evidence: string[];
  unmet_success_criteria: string[];
  stop_reason: string;
  created_at: string;
};

export type GoalDrivenAutonomyFeatureContext = {
  goal: GoalDrivenAutonomyGoalInput;
  feature: string;
  cycle_index: number;
  max_cycles: number;
  max_features_per_cycle: number;
  max_iterations_per_feature: number;
  selected_features: string[];
  completed_features: string[];
  selection: PostPlaytestFeatureSelectorResult;
};

export type GoalDrivenAutonomyControllerInput = GoalDrivenAutonomyGoalInput & {
  checkpoint_directory: string;
  feature_evidence?: PostPlaytestFeatureEvidenceSnapshot[];
  probe_bridge?: LongRunningAutonomyControllerInput["probe_bridge"];
  create_feature_loop: (
    context: GoalDrivenAutonomyFeatureContext,
  ) => Promise<PostPlaytestFeatureChainFeatureInput | null> | PostPlaytestFeatureChainFeatureInput | null;
};

const HARD_MAX_CYCLES = 2;
const HARD_MAX_FEATURES_PER_CYCLE = 2;
const HARD_MAX_ITERATIONS_PER_FEATURE = 2;

function clampBoundedCount(value: number, hardMax: number): number {
  if (!Number.isFinite(value)) {
    return hardMax;
  }

  return Math.max(1, Math.min(hardMax, Math.trunc(value)));
}

function uniqueOrdered(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function mergeConfidence(
  current: "low" | "medium" | "high",
  next: "low" | "medium" | "high",
): "low" | "medium" | "high" {
  if (current === "low" || next === "low") {
    return "low";
  }

  if (current === "medium" || next === "medium") {
    return "medium";
  }

  return "high";
}

function createResult(
  goalId: string,
  status: GoalDrivenAutonomyControllerStatus,
  stopReason: string,
  overrides: Partial<GoalDrivenAutonomyControllerResult> = {},
): GoalDrivenAutonomyControllerResult {
  return {
    status,
    goal_id: goalId,
    cycles_completed: overrides.cycles_completed ?? 0,
    selected_features: overrides.selected_features ?? [],
    completed_features: overrides.completed_features ?? [],
    progress_evidence: overrides.progress_evidence ?? [],
    unmet_success_criteria: overrides.unmet_success_criteria ?? [],
    checkpoint_path: overrides.checkpoint_path,
    stop_reason: stopReason,
    confidence: overrides.confidence ?? "medium",
  };
}

function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function filterGenericGoalTokens(tokens: string[]): string[] {
  const genericTokens = new Set([
    "goal",
    "feature",
    "complete",
    "completed",
    "safely",
    "safe",
    "validation",
    "prove",
    "proving",
    "proof",
    "check",
    "checks",
    "improve",
    "confidence",
  ]);

  return tokens.filter((token) => !genericTokens.has(token));
}

function buildFeaturePhrase(feature: string): string {
  return normalizeWords(feature).join(" ");
}

function scoreFeatureAgainstGoal(feature: string, goal: GoalDrivenAutonomyGoalInput): {
  score: number;
  reason: string;
} {
  const featureTokens = normalizeWords(feature);
  const goalTokens = new Set(normalizeWords(goal.goal_statement));
  const criterionTokens = goal.success_criteria.map((criterion) => normalizeWords(criterion));
  const overlaps = featureTokens.filter((token) => goalTokens.has(token));
  const criterionOverlapCount = criterionTokens.reduce((best, tokens) => {
    const overlapCount = featureTokens.filter((token) => tokens.includes(token)).length;
    return Math.max(best, overlapCount);
  }, 0);

  let score = overlaps.length * 4 + criterionOverlapCount * 6;
  if (goalTokens.has("runtime") && featureTokens.includes("runtime")) {
    score += 12;
  }
  if (goalTokens.has("session") && featureTokens.includes("session")) {
    score += 8;
  }
  if (goalTokens.has("marker") && featureTokens.includes("marker")) {
    score += 8;
  }
  if (goalTokens.has("enemy") && featureTokens.includes("enemy")) {
    score += 8;
  }
  if (goalTokens.has("feedback") && featureTokens.includes("feedback")) {
    score += 8;
  }
  if ((goalTokens.has("validation") || goalTokens.has("confidence"))
    && (featureTokens.includes("runtime") || featureTokens.includes("health") || featureTokens.includes("session"))) {
    score += 3;
  }

  if (score <= 0) {
    return {
      score: 0,
      reason: `${feature} stays available in the explicit pool, but its name does not strongly match the current goal or success criteria.`,
    };
  }

  const matchedTerms = uniqueOrdered(overlaps.concat(
    criterionTokens.flatMap((tokens) => featureTokens.filter((token) => tokens.includes(token))),
  ));
  return {
    score,
    reason: matchedTerms.length > 0
      ? `${feature} aligns to the goal through matched terms: ${matchedTerms.join(", ")}.`
      : `${feature} aligns to the goal through runtime-focused heuristics.`,
  };
}

function rankFeaturesForGoal(
  goal: GoalDrivenAutonomyGoalInput,
  allowedFeaturePool: string[],
  completedFeatures: string[],
  attemptedFeatures: string[],
  featureEvidence: PostPlaytestFeatureEvidenceSnapshot[],
): PostPlaytestFeatureSelectorResult {
  const baseSelection = selectPostPlaytestFeature({
    feature_pool: allowedFeaturePool,
    completed_features: completedFeatures,
    attempted_features: attemptedFeatures,
    feature_evidence: featureEvidence,
  });

  if (baseSelection.status !== "feature_selected" || baseSelection.candidate_scores.length === 0) {
    return baseSelection;
  }

  const goalRanked = baseSelection.candidate_scores
    .map((candidate) => {
      const goalScore = scoreFeatureAgainstGoal(candidate.feature, goal);
      return {
        ...candidate,
        score: candidate.score + goalScore.score * 1000,
        reason: `${goalScore.reason} ${candidate.reason}`.trim(),
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.feature.localeCompare(right.feature);
    });

  const selected = goalRanked[0] ?? null;
  if (!selected) {
    return {
      ...baseSelection,
      status: "selection_blocked",
      selected_feature: null,
      selected_reason: "The goal-aware selector could not determine a safe next feature from the allowed pool.",
      candidate_scores: goalRanked,
      confidence: "low",
    };
  }

  return {
    status: "feature_selected",
    selected_feature: selected.feature,
    selected_reason: selected.reason,
    candidate_scores: goalRanked,
    rejected_features: baseSelection.rejected_features,
    confidence: baseSelection.confidence,
  };
}

function evaluateGoalProgress(
  successCriteria: string[],
  completedFeatures: string[],
): {
  progressEvidence: string[];
  unmetSuccessCriteria: string[];
} {
  const progressEvidence: string[] = [];
  const unmetSuccessCriteria: string[] = [];
  const featurePhrases = completedFeatures.map((feature) => ({
    feature,
    phrase: buildFeaturePhrase(feature),
    tokens: filterGenericGoalTokens(normalizeWords(feature)),
  }));

  for (const criterion of successCriteria) {
    const normalizedCriterion = buildFeaturePhrase(criterion);
    const criterionTokens = filterGenericGoalTokens(normalizeWords(criterion));
    const matchedFeature = featurePhrases.find(({ phrase, tokens }) => normalizedCriterion.includes(phrase)
      || (tokens.length > 0
        && tokens.filter((token) => criterionTokens.includes(token)).length >= Math.min(2, tokens.length)));

    if (matchedFeature) {
      progressEvidence.push(`Success criterion met: "${criterion}" via completed feature "${matchedFeature.feature}".`);
      continue;
    }

    unmetSuccessCriteria.push(criterion);
  }

  return {
    progressEvidence,
    unmetSuccessCriteria,
  };
}

function buildCheckpointPath(directory: string, goalId: string): string {
  return path.join(directory, `${goalId}.goal-driven-checkpoint.json`);
}

async function writeGoalCheckpoint(
  checkpointDirectory: string,
  checkpoint: GoalDrivenAutonomyCheckpoint,
): Promise<string> {
  const checkpointPath = buildCheckpointPath(checkpointDirectory, checkpoint.goal_id);
  await mkdir(path.dirname(checkpointPath), { recursive: true });
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf-8");
  return checkpointPath;
}

export async function runGoalDrivenAutonomy(
  input: GoalDrivenAutonomyControllerInput,
): Promise<GoalDrivenAutonomyControllerResult> {
  const goalId = input.goal_id.trim();
  const goalStatement = input.goal_statement.trim();
  const successCriteria = uniqueOrdered(input.success_criteria);
  const allowedFeaturePool = uniqueOrdered(input.allowed_feature_pool);
  const maxCycles = clampBoundedCount(input.max_cycles, HARD_MAX_CYCLES);
  const maxFeaturesPerCycle = clampBoundedCount(input.max_features_per_cycle, HARD_MAX_FEATURES_PER_CYCLE);
  const maxIterationsPerFeature = clampBoundedCount(
    input.max_iterations_per_feature,
    HARD_MAX_ITERATIONS_PER_FEATURE,
  );
  const featureEvidence = input.feature_evidence ?? [];
  const selectedFeatures: string[] = [];
  const completedFeatures: string[] = [];
  const progressEvidence: string[] = [];
  let checkpointPath: string | undefined;
  let confidence: "low" | "medium" | "high" = "high";
  let cyclesCompleted = 0;

  if (!input.operator_approval) {
    return createResult(
      goalId || "unknown-goal",
      "operator_review_required",
      "The bounded goal-driven autonomy proof requires explicit operator approval before the first goal-aware cycle can begin.",
      {
        unmet_success_criteria: successCriteria,
        confidence: "high",
      },
    );
  }

  if (!goalId || !goalStatement) {
    return createResult(
      goalId || "unknown-goal",
      "goal_blocked",
      "The bounded goal-driven autonomy proof requires an explicit operator goal id and goal statement.",
      {
        unmet_success_criteria: successCriteria,
        confidence: "high",
      },
    );
  }

  if (allowedFeaturePool.length === 0) {
    return createResult(
      goalId,
      "goal_blocked",
      "The bounded goal-driven autonomy proof requires an explicit allowed feature pool and cannot invent new features outside that pool.",
      {
        unmet_success_criteria: successCriteria,
        confidence: "high",
      },
    );
  }

  for (let cycleIndex = 0; cycleIndex < maxCycles; cycleIndex += 1) {
    const ranking = rankFeaturesForGoal(
      {
        ...input,
        goal_id: goalId,
        goal_statement: goalStatement,
        success_criteria: successCriteria,
        allowed_feature_pool: allowedFeaturePool,
        max_cycles: maxCycles,
        max_features_per_cycle: maxFeaturesPerCycle,
        max_iterations_per_feature: maxIterationsPerFeature,
      },
      allowedFeaturePool,
      completedFeatures,
      selectedFeatures,
      featureEvidence,
    );
    confidence = mergeConfidence(confidence, ranking.confidence);

    if (ranking.status === "operator_review_required") {
      return createResult(goalId, "operator_review_required", ranking.selected_reason, {
        cycles_completed: cyclesCompleted,
        selected_features: selectedFeatures,
        completed_features: completedFeatures,
        progress_evidence: uniqueOrdered(progressEvidence),
        unmet_success_criteria: successCriteria,
        checkpoint_path: checkpointPath,
        confidence,
      });
    }

    if (ranking.status === "selection_blocked") {
      return createResult(goalId, "goal_blocked", ranking.selected_reason, {
        cycles_completed: cyclesCompleted,
        selected_features: selectedFeatures,
        completed_features: completedFeatures,
        progress_evidence: uniqueOrdered(progressEvidence),
        unmet_success_criteria: successCriteria,
        checkpoint_path: checkpointPath,
        confidence,
      });
    }

    if (ranking.status === "no_feature_available" || !ranking.selected_feature) {
      const progress = evaluateGoalProgress(successCriteria, completedFeatures);
      return createResult(
        goalId,
        completedFeatures.length > 0 ? "budget_exhausted" : "goal_blocked",
        ranking.selected_reason,
        {
          cycles_completed: cyclesCompleted,
          selected_features: selectedFeatures,
          completed_features: completedFeatures,
          progress_evidence: uniqueOrdered(progressEvidence.concat(progress.progressEvidence)),
          unmet_success_criteria: progress.unmetSuccessCriteria,
          checkpoint_path: checkpointPath,
          confidence,
        },
      );
    }

    const selectedFeature = ranking.selected_feature;
    selectedFeatures.push(selectedFeature);
    progressEvidence.push(`Cycle ${cycleIndex + 1}: selected "${selectedFeature}" for goal "${goalStatement}". ${ranking.selected_reason}`);

    const featureLoop = await input.create_feature_loop({
      goal: {
        ...input,
        goal_id: goalId,
        goal_statement: goalStatement,
        success_criteria: successCriteria,
        allowed_feature_pool: allowedFeaturePool,
        max_cycles: maxCycles,
        max_features_per_cycle: maxFeaturesPerCycle,
        max_iterations_per_feature: maxIterationsPerFeature,
      },
      feature: selectedFeature,
      cycle_index: cycleIndex,
      max_cycles: maxCycles,
      max_features_per_cycle: maxFeaturesPerCycle,
      max_iterations_per_feature: maxIterationsPerFeature,
      selected_features: selectedFeatures.slice(),
      completed_features: completedFeatures.slice(),
      selection: ranking,
    });

    if (!featureLoop) {
      return createResult(goalId, "goal_blocked", `The goal-aware controller could not materialize a reviewed feature loop for ${selectedFeature}.`, {
        cycles_completed: cyclesCompleted,
        selected_features: selectedFeatures,
        completed_features: completedFeatures,
        progress_evidence: uniqueOrdered(progressEvidence),
        unmet_success_criteria: successCriteria,
        checkpoint_path: checkpointPath,
        confidence: mergeConfidence(confidence, "low"),
      });
    }

    const cycleResult = await runLongRunningAutonomySession({
      session_id: `${goalId}-cycle-${cycleIndex + 1}`,
      operator_approval: true,
      max_cycles: 1,
      max_features_per_cycle: maxFeaturesPerCycle,
      max_iterations_per_feature: maxIterationsPerFeature,
      feature_pool: [selectedFeature],
      checkpoint_directory: input.checkpoint_directory,
      probe_bridge: input.probe_bridge,
      create_cycle: async () => ({
        feature_pool: [selectedFeature],
        feature_evidence: featureEvidence.filter((entry) => entry.feature === selectedFeature),
        create_feature_loop: async () => featureLoop,
      }),
    });
    confidence = mergeConfidence(confidence, cycleResult.confidence);
    cyclesCompleted += cycleResult.cycles_completed;

    if (cycleResult.status === "operator_review_required") {
      return createResult(goalId, "operator_review_required", cycleResult.stop_reason, {
        cycles_completed: cyclesCompleted,
        selected_features: selectedFeatures,
        completed_features: completedFeatures,
        progress_evidence: uniqueOrdered(progressEvidence),
        unmet_success_criteria: successCriteria,
        checkpoint_path: checkpointPath,
        confidence,
      });
    }

    if (cycleResult.status === "safety_stop") {
      return createResult(goalId, "safety_stop", cycleResult.stop_reason, {
        cycles_completed: cyclesCompleted,
        selected_features: selectedFeatures,
        completed_features: completedFeatures,
        progress_evidence: uniqueOrdered(progressEvidence),
        unmet_success_criteria: successCriteria,
        checkpoint_path: checkpointPath,
        confidence,
      });
    }

    if (cycleResult.status === "session_blocked") {
      return createResult(goalId, "goal_blocked", cycleResult.stop_reason, {
        cycles_completed: cyclesCompleted,
        selected_features: selectedFeatures,
        completed_features: completedFeatures,
        progress_evidence: uniqueOrdered(progressEvidence),
        unmet_success_criteria: successCriteria,
        checkpoint_path: checkpointPath,
        confidence,
      });
    }

    const newlyCompleted = cycleResult.features_completed.filter((feature) => !completedFeatures.includes(feature));
    completedFeatures.push(...newlyCompleted);

    const progress = evaluateGoalProgress(successCriteria, completedFeatures);
    progressEvidence.push(...progress.progressEvidence);
    if (newlyCompleted.length === 0) {
      progressEvidence.push(`Cycle ${cycleIndex + 1}: no goal-relevant feature completed for goal "${goalStatement}".`);
    }

    checkpointPath = await writeGoalCheckpoint(input.checkpoint_directory, {
      goal_id: goalId,
      goal_statement: goalStatement,
      cycle: cycleIndex + 1,
      selected_features: uniqueOrdered(selectedFeatures),
      completed_features: uniqueOrdered(completedFeatures),
      progress_evidence: uniqueOrdered(progressEvidence),
      unmet_success_criteria: progress.unmetSuccessCriteria,
      stop_reason: cycleResult.stop_reason,
      created_at: new Date().toISOString(),
    });

    if (progress.unmetSuccessCriteria.length === 0) {
      return createResult(goalId, "goal_completed", `The bounded goal-driven autonomy proof completed all success criteria after cycle ${cycleIndex + 1}.`, {
        cycles_completed: cyclesCompleted,
        selected_features: uniqueOrdered(selectedFeatures),
        completed_features: uniqueOrdered(completedFeatures),
        progress_evidence: uniqueOrdered(progressEvidence),
        unmet_success_criteria: [],
        checkpoint_path: checkpointPath,
        confidence,
      });
    }
  }

  const finalProgress = evaluateGoalProgress(successCriteria, completedFeatures);
  return createResult(goalId, completedFeatures.length > 0 ? "budget_exhausted" : "goal_blocked", `The bounded goal-driven autonomy proof reached its hard cycle budget of ${maxCycles} before all success criteria were met.`, {
    cycles_completed: cyclesCompleted,
    selected_features: uniqueOrdered(selectedFeatures),
    completed_features: uniqueOrdered(completedFeatures),
    progress_evidence: uniqueOrdered(progressEvidence.concat(finalProgress.progressEvidence)),
    unmet_success_criteria: finalProgress.unmetSuccessCriteria,
    checkpoint_path: checkpointPath,
    confidence,
  });
}