import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";
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
  feature_queue: string[];
  max_features: number;
  max_iterations_per_feature: number;
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
  const boundedQueue = input.feature_queue.slice(0, maxFeatures);
  const featuresAttempted: string[] = [];
  const featuresCompleted: string[] = [];
  const loopResults: PostPlaytestFeatureChainLoopResult[] = [];
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

  if (boundedQueue.length === 0) {
    return createResult(
      "chain_stopped_success",
      "The bounded cross-feature chain stopped safely because no reviewed feature targets were provided in the queue.",
      {
        max_features: maxFeatures,
        confidence: "high",
      },
    );
  }

  for (const [featureIndex, feature] of boundedQueue.entries()) {
    const nextFeature = boundedQueue[featureIndex + 1] ?? null;
    const previousLoop = loopResults[featureIndex - 1]?.result ?? null;
    const featureLoopInput = await input.create_feature_loop({
      feature,
      feature_index: featureIndex,
      max_features: maxFeatures,
      max_iterations_per_feature: maxIterationsPerFeature,
      features_attempted: featuresAttempted.slice(),
      features_completed: featuresCompleted.slice(),
      loop_results: loopResults.slice(),
      previous_feature: featureIndex > 0 ? boundedQueue[featureIndex - 1] ?? null : null,
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
      result: loopResult,
    });
    confidence = mergeConfidence(confidence, loopResult.confidence);

    if (isLoopCompletedSuccessfully(loopResult)) {
      featuresCompleted.push(feature);

      if (!nextFeature) {
        return createResult(
          featuresCompleted.length >= maxFeatures ? "chain_completed" : "chain_stopped_success",
          `The bounded cross-feature chain stopped after completing ${feature} because the reviewed feature queue was exhausted.`,
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