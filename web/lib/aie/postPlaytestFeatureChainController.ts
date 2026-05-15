import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";
import {
  selectPostPlaytestFeature,
  type PostPlaytestFeatureCandidateScore,
  type PostPlaytestFeatureEvidenceSnapshot,
  type PostPlaytestFeatureSelectorResult,
} from "./postPlaytestFeatureSelector";
import {
  runPostPlaytestLoop,
  type PostPlaytestLoopControllerInput,
  type PostPlaytestLoopControllerResult,
} from "./postPlaytestLoopController";

export type PostPlaytestFeatureChainControllerStatus =
  | "chain_completed"
  | "chain_stopped_success"
  | "chain_blocked"
  | "chain_retry_limit_reached"
  | "operator_review_required";

export type PostPlaytestFeatureChainLoopResult = {
  feature: string;
  selection: PostPlaytestFeatureSelectorResult;
  result: PostPlaytestLoopControllerResult;
};

export type PostPlaytestFeatureChainFeatureContext = {
  feature: string;
  feature_index: number;
  max_features: number;
  max_iterations_per_feature: number;
  features_attempted: string[];
  features_completed: string[];
  loop_results: PostPlaytestFeatureChainLoopResult[];
  selection: PostPlaytestFeatureSelectorResult;
  candidate_scores: PostPlaytestFeatureCandidateScore[];
  previous_feature: string | null;
  previous_feature_learning_summary: string[];
};

export type PostPlaytestFeatureChainFeatureInput = {
  initial_learning: AutoRecordOutcomeResult | null;
  create_iteration: PostPlaytestLoopControllerInput["create_iteration"];
  execute_fix?: PostPlaytestLoopControllerInput["execute_fix"];
};

export type PostPlaytestFeatureChainControllerInput = {
  operator_approval: boolean;
  feature_pool: string[];
  max_features: number;
  max_iterations_per_feature: number;
  feature_evidence?: PostPlaytestFeatureEvidenceSnapshot[];
  create_feature_loop: (
    context: PostPlaytestFeatureChainFeatureContext,
  ) => Promise<PostPlaytestFeatureChainFeatureInput | null> | PostPlaytestFeatureChainFeatureInput | null;
};

export type PostPlaytestFeatureChainControllerResult = {
  status: PostPlaytestFeatureChainControllerStatus;
  features_attempted: string[];
  features_completed: string[];
  current_feature: string | null;
  next_feature: string | null;
  max_features: number;
  loop_results: PostPlaytestFeatureChainLoopResult[];
  stop_reason: string;
  confidence: "low" | "medium" | "high";
};

const HARD_MAX_FEATURES = 2;
const HARD_MAX_ITERATIONS_PER_FEATURE = 2;

function clampBoundedCount(value: number, hardMax: number): number {
  if (!Number.isFinite(value)) {
    return hardMax;
  }

  return Math.max(1, Math.min(hardMax, Math.trunc(value)));
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
  status: PostPlaytestFeatureChainControllerStatus,
  stopReason: string,
  overrides: Partial<PostPlaytestFeatureChainControllerResult> = {},
): PostPlaytestFeatureChainControllerResult {
  return {
    status,
    features_attempted: overrides.features_attempted ?? [],
    features_completed: overrides.features_completed ?? [],
    current_feature: overrides.current_feature ?? null,
    next_feature: overrides.next_feature ?? null,
    max_features: overrides.max_features ?? HARD_MAX_FEATURES,
    loop_results: overrides.loop_results ?? [],
    stop_reason: stopReason,
    confidence: overrides.confidence ?? "medium",
  };
}

function isLoopCompletedSuccessfully(result: PostPlaytestLoopControllerResult): boolean {
  return result.status === "loop_completed" || result.status === "loop_stopped_success";
}

function isOperatorReviewStop(result: PostPlaytestLoopControllerResult): boolean {
  return /operator approval|operator review/i.test(result.stop_reason);
}

export async function runPostPlaytestFeatureChain(
  input: PostPlaytestFeatureChainControllerInput,
): Promise<PostPlaytestFeatureChainControllerResult> {
  const maxFeatures = clampBoundedCount(input.max_features, HARD_MAX_FEATURES);
  const maxIterationsPerFeature = clampBoundedCount(
    input.max_iterations_per_feature,
    HARD_MAX_ITERATIONS_PER_FEATURE,
  );
  const boundedPool = input.feature_pool.slice();
  const featuresAttempted: string[] = [];
  const featuresCompleted: string[] = [];
  const loopResults: PostPlaytestFeatureChainLoopResult[] = [];
  const featureEvidence = new Map<string, AutoRecordOutcomeResult | null>(
    (input.feature_evidence ?? []).map((entry) => [entry.feature, entry.latest_outcome]),
  );
  let confidence: "low" | "medium" | "high" = "high";

  if (!input.operator_approval) {
    return createResult(
      "operator_review_required",
      "The bounded cross-feature chain requires explicit operator approval before the first feature loop can begin.",
      {
        max_features: maxFeatures,
        confidence: "high",
      },
    );
  }

  if (boundedPool.length === 0) {
    return createResult(
      "chain_blocked",
      "The bounded cross-feature chain stopped safely because no reviewed feature targets were provided in the explicit pool.",
      {
        max_features: maxFeatures,
        confidence: "high",
      },
    );
  }

  for (let featureIndex = 0; featureIndex < maxFeatures; featureIndex += 1) {
    const selection = selectPostPlaytestFeature({
      feature_pool: boundedPool,
      completed_features: featuresCompleted,
      attempted_features: featuresAttempted,
      feature_evidence: Array.from(featureEvidence.entries()).map(([feature, latest_outcome]) => ({
        feature,
        latest_outcome,
      })),
    });
    confidence = mergeConfidence(confidence, selection.confidence);

    if (selection.status === "operator_review_required") {
      return createResult(
        "operator_review_required",
        selection.selected_reason,
        {
          features_attempted: featuresAttempted,
          features_completed: featuresCompleted,
          current_feature: null,
          next_feature: null,
          max_features: maxFeatures,
          loop_results: loopResults,
          confidence,
        },
      );
    }

    if (selection.status === "selection_blocked") {
      return createResult(
        "chain_blocked",
        selection.selected_reason,
        {
          features_attempted: featuresAttempted,
          features_completed: featuresCompleted,
          current_feature: null,
          next_feature: null,
          max_features: maxFeatures,
          loop_results: loopResults,
          confidence,
        },
      );
    }

    if (selection.status === "no_feature_available") {
      return createResult(
        featuresCompleted.length >= maxFeatures ? "chain_completed" : "chain_stopped_success",
        selection.selected_reason,
        {
          features_attempted: featuresAttempted,
          features_completed: featuresCompleted,
          current_feature: null,
          next_feature: null,
          max_features: maxFeatures,
          loop_results: loopResults,
          confidence,
        },
      );
    }

    const feature = selection.selected_feature;
    if (!feature) {
      return createResult(
        "chain_blocked",
        "The bounded cross-feature chain could not resolve a selected feature from the explicit pool.",
        {
          features_attempted: featuresAttempted,
          features_completed: featuresCompleted,
          current_feature: null,
          next_feature: null,
          max_features: maxFeatures,
          loop_results: loopResults,
          confidence,
        },
      );
    }

    const pendingFeatures = boundedPool.filter(
      (candidate) => candidate !== feature && !featuresCompleted.includes(candidate),
    );
    const nextSelection = selectPostPlaytestFeature({
      feature_pool: pendingFeatures,
      completed_features: featuresCompleted,
      attempted_features: featuresAttempted.concat(feature),
      feature_evidence: Array.from(featureEvidence.entries()).map(([entryFeature, latest_outcome]) => ({
        feature: entryFeature,
        latest_outcome,
      })),
    });
    const nextFeature = nextSelection.status === "feature_selected" ? nextSelection.selected_feature : null;
    const previousLoop = loopResults[featureIndex - 1]?.result ?? null;
    const featureLoopInput = await input.create_feature_loop({
      feature,
      feature_index: featureIndex,
      max_features: maxFeatures,
      max_iterations_per_feature: maxIterationsPerFeature,
      features_attempted: featuresAttempted.slice(),
      features_completed: featuresCompleted.slice(),
      loop_results: loopResults.slice(),
      selection,
      candidate_scores: selection.candidate_scores,
      previous_feature: featureIndex > 0 ? loopResults[featureIndex - 1]?.feature ?? null : null,
      previous_feature_learning_summary: previousLoop?.learning_results.slice() ?? [],
    });

    if (!featureLoopInput) {
      return createResult(
        "chain_blocked",
        `The bounded cross-feature chain could not materialize a reviewed loop package for feature ${feature}.`,
        {
          features_attempted: featuresAttempted,
          features_completed: featuresCompleted,
          current_feature: feature,
          next_feature: nextFeature,
          max_features: maxFeatures,
          loop_results: loopResults,
          confidence,
        },
      );
    }

    featuresAttempted.push(feature);

    const loopResult = await runPostPlaytestLoop({
      operator_approval: true,
      max_iterations: maxIterationsPerFeature,
      initial_learning: featureLoopInput.initial_learning,
      create_iteration: featureLoopInput.create_iteration,
      execute_fix: featureLoopInput.execute_fix,
    });
    loopResults.push({
      feature,
      selection,
      result: loopResult,
    });
    confidence = mergeConfidence(confidence, loopResult.confidence);

    const finalLearningEntry = loopResult.learning_results[loopResult.learning_results.length - 1] ?? "";
    if (/recorded fail for /i.test(finalLearningEntry)) {
      featureEvidence.set(feature, {
        ...featureEvidence.get(feature),
      } as AutoRecordOutcomeResult);
    }

    if (isLoopCompletedSuccessfully(loopResult)) {
      featuresCompleted.push(feature);
      const lastLearningEntry = loopResult.learning_results[loopResult.learning_results.length - 1] ?? "";
      if (/recorded pass for /i.test(lastLearningEntry)) {
        featureEvidence.set(feature, {
          status: "recorded",
          projectPath: "proj",
          feature,
          evaluation: {
            projectPath: "proj",
            logPath: "",
            session: {
              mode: "marker-session",
              startMarker: "",
              endMarker: "",
              startedAt: null,
              endedAt: null,
              sourceLogPath: "",
              lines: [],
            },
            evaluatedLineCount: 0,
            signals: [],
            parsedResult: {
              inferredResult: "pass",
              errors: [],
              warnings: [],
              gameplayEvents: [],
            },
            reason: ["runtime pass detected"],
          },
          recorded: {
            record: {
              id: `${feature}-chain-pass`,
              timestamp: new Date().toISOString(),
              projectPath: "proj",
              feature,
              action: "post-playtest feature chain",
              result: "pass",
              userObservation: "runtime pass detected",
              consoleSignals: [],
              filesChanged: [],
              rollbackUsed: false,
              evaluationSource: "runtime-auto",
              sessionKey: `${feature}-chain-pass`,
            },
            logPath: "",
            duplicate: false,
          },
          summary: {
            totalOutcomes: 1,
            passCount: 1,
            failCount: 0,
            partialCount: 0,
            rollbackCount: 0,
            rollbackFrequency: 0,
            runtimeAutoCount: 1,
            manualCount: 0,
            latestRuntimeAutoPattern: `${feature}-chain-pass`,
            latestSuccessfulPatterns: [`${feature}-chain-pass`],
            latestFailurePatterns: [],
            projectPath: "proj",
            logPath: "log",
          },
        });
      }

      if (!nextFeature) {
        return createResult(
          featuresCompleted.length >= maxFeatures ? "chain_completed" : "chain_stopped_success",
          `The bounded cross-feature chain stopped after completing ${feature} because no further reviewed feature remained available in the explicit pool.`,
          {
            features_attempted: featuresAttempted,
            features_completed: featuresCompleted,
            current_feature: null,
            next_feature: null,
            max_features: maxFeatures,
            loop_results: loopResults,
            confidence,
          },
        );
      }

      continue;
    }

    if (loopResult.status === "retry_limit_reached") {
      return createResult(
        "chain_retry_limit_reached",
        `The bounded cross-feature chain stopped on feature ${feature} because its reviewed loop reached the retry budget: ${loopResult.stop_reason}`,
        {
          features_attempted: featuresAttempted,
          features_completed: featuresCompleted,
          current_feature: feature,
          next_feature: nextFeature,
          max_features: maxFeatures,
          loop_results: loopResults,
          confidence,
        },
      );
    }

    if (isOperatorReviewStop(loopResult)) {
      return createResult(
        "operator_review_required",
        `The bounded cross-feature chain stopped on feature ${feature} because reviewed operator input is required: ${loopResult.stop_reason}`,
        {
          features_attempted: featuresAttempted,
          features_completed: featuresCompleted,
          current_feature: feature,
          next_feature: nextFeature,
          max_features: maxFeatures,
          loop_results: loopResults,
          confidence,
        },
      );
    }

    return createResult(
      "chain_blocked",
      `The bounded cross-feature chain stopped on feature ${feature}: ${loopResult.stop_reason}`,
      {
        features_attempted: featuresAttempted,
        features_completed: featuresCompleted,
        current_feature: feature,
        next_feature: nextFeature,
        max_features: maxFeatures,
        loop_results: loopResults,
        confidence,
      },
    );
  }

  return createResult(
    "chain_completed",
    `The bounded cross-feature chain reached its hard feature budget of ${maxFeatures}.`,
    {
      features_attempted: featuresAttempted,
      features_completed: featuresCompleted,
      current_feature: null,
      next_feature: null,
      max_features: maxFeatures,
      loop_results: loopResults,
      confidence,
    },
  );
}