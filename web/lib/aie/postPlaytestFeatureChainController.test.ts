import assert from "node:assert/strict";
import test from "node:test";

import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";
import type { ControlledExecutionDiff } from "./controlledPatchExecutor";
import {
  runPostPlaytestFeatureChain,
  type PostPlaytestFeatureChainFeatureInput,
} from "./postPlaytestFeatureChainController";
import type { PostPlaytestLoopIterationInput } from "./postPlaytestLoopController";
import type { PostPlaytestExecutionResult } from "./postPlaytestExecutor";

function createUpdate(filePath: string): ControlledExecutionDiff {
  return {
    file_path: filePath,
    change_type: "update",
    after_snapshot: "after\n",
    summary_of_change: "Apply the smallest safe reviewed fix.",
  };
}

function createOutcome(
  inferredResult: "pass" | "fail" | "partial",
  feature: string,
  sessionKey = `${feature}-${inferredResult}`,
): AutoRecordOutcomeResult {
  return {
    status: "recorded",
    projectPath: "E:/AI projects 2025/AI-E/orchestrator_lane/Tools/EnemyAIDemoStandalone",
    feature,
    evaluation: {
      session: {
        mode: "marker-session",
        startMarker: `[AIE Playtest Session] START id=${sessionKey}`,
        endMarker: `[AIE Playtest Session] END id=${sessionKey}`,
        startedAt: null,
        endedAt: null,
        sourceLogPath: `tmp/${sessionKey}.log`,
        lines: [],
      },
      logPath: `tmp/${sessionKey}.log`,
      evaluatedLineCount: 3,
      signals: [],
      parsedResult: {
        inferredResult,
        errors: inferredResult === "fail" ? ["simulated failure"] : [],
        warnings: [],
        gameplayEvents: inferredResult === "pass" ? ["Enemy defeated"] : [],
      },
      reason: inferredResult === "fail" ? ["runtime errors detected: 1"] : ["runtime pass detected"],
    } as AutoRecordOutcomeResult["evaluation"],
    recorded: {
      record: {
        sessionKey,
      },
      duplicate: false,
    } as AutoRecordOutcomeResult["recorded"],
    summary: {
      totalOutcomes: inferredResult === "fail" ? 1 : 2,
      passCount: inferredResult === "pass" ? 1 : 0,
      failCount: inferredResult === "fail" ? 1 : 0,
      partialCount: inferredResult === "partial" ? 1 : 0,
      rollbackCount: 0,
      rollbackFrequency: 0,
      runtimeAutoCount: 1,
      manualCount: 0,
      latestRuntimeAutoPattern: sessionKey,
      latestSuccessfulPatterns: inferredResult === "pass" ? [sessionKey] : [],
      latestFailurePatterns: inferredResult === "fail" ? [sessionKey] : [],
      projectPath: "proj",
      logPath: "log",
    } as AutoRecordOutcomeResult["summary"],
  };
}

function createExecutionResult(
  status: PostPlaytestExecutionResult["status"],
  overrides: Partial<PostPlaytestExecutionResult> = {},
): PostPlaytestExecutionResult {
  return {
    status,
    reason: status === "executed"
      ? "The guarded post-playtest fix applied successfully, completed one reviewed Unity validation rerun, and is ready for follow-up learning."
      : "The guarded post-playtest step stopped.",
    modified_files: [],
    rollback_available: status === "rolled_back",
    retry_count: 1,
    max_retry_count: 1,
    validation_rerun_requested: status === "executed" || status === "rolled_back",
    validation_rerun_completed: status === "executed" || status === "rolled_back",
    followup_learning_required: status === "executed",
    confidence: "high",
    ...overrides,
  };
}

function createIteration(
  filePath: string,
  followup: () => Promise<AutoRecordOutcomeResult | null>,
): PostPlaytestLoopIterationInput {
  return {
    file_changes: [createUpdate(filePath)],
    allowed_roots: ["orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts"],
    rerun_validation: async () => ({
      completed: true,
      succeeded: true,
      reason: "clean",
    }),
    followup_learning: followup,
  };
}

function createFeatureLoop(
  feature: string,
  followupResult: "pass" | "fail",
): PostPlaytestFeatureChainFeatureInput {
  return {
    initial_learning: createOutcome("fail", feature, `${feature}-initial-fail`),
    create_iteration: async () => createIteration(
      `orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/${feature}.cs`,
      async () => createOutcome(followupResult, feature, `${feature}-followup-${followupResult}`),
    ),
    execute_fix: async (input) => createExecutionResult("executed", {
      modified_files: input.file_changes.map((change) => change.file_path),
    }),
  };
}

test("completes feature A then feature B", async () => {
  const result = await runPostPlaytestFeatureChain({
    operator_approval: true,
    feature_queue: ["feature-a", "feature-b"],
    max_features: 2,
    max_iterations_per_feature: 2,
    create_feature_loop: async ({ feature }) => createFeatureLoop(feature, "pass"),
  });

  assert.equal(result.status, "chain_completed");
  assert.deepEqual(result.features_attempted, ["feature-a", "feature-b"]);
  assert.deepEqual(result.features_completed, ["feature-a", "feature-b"]);
  assert.equal(result.current_feature, null);
  assert.equal(result.next_feature, null);
  assert.equal(result.loop_results.length, 2);
});

test("stops when queue exhausted", async () => {
  const result = await runPostPlaytestFeatureChain({
    operator_approval: true,
    feature_queue: ["feature-a"],
    max_features: 2,
    max_iterations_per_feature: 2,
    create_feature_loop: async ({ feature }) => createFeatureLoop(feature, "pass"),
  });

  assert.equal(result.status, "chain_stopped_success");
  assert.deepEqual(result.features_attempted, ["feature-a"]);
  assert.deepEqual(result.features_completed, ["feature-a"]);
  assert.match(result.stop_reason, /queue was exhausted/i);
});

test("stops when feature A fails", async () => {
  const result = await runPostPlaytestFeatureChain({
    operator_approval: true,
    feature_queue: ["feature-a", "feature-b"],
    max_features: 2,
    max_iterations_per_feature: 2,
    create_feature_loop: async ({ feature }) => createFeatureLoop(feature, "fail"),
  });

  assert.equal(result.status, "chain_retry_limit_reached");
  assert.deepEqual(result.features_attempted, ["feature-a"]);
  assert.deepEqual(result.features_completed, []);
  assert.equal(result.current_feature, "feature-a");
  assert.equal(result.next_feature, "feature-b");
});

test("blocks without operator approval", async () => {
  let calls = 0;

  const result = await runPostPlaytestFeatureChain({
    operator_approval: false,
    feature_queue: ["feature-a", "feature-b"],
    max_features: 2,
    max_iterations_per_feature: 2,
    create_feature_loop: async () => {
      calls += 1;
      return createFeatureLoop("feature-a", "pass");
    },
  });

  assert.equal(result.status, "operator_review_required");
  assert.equal(calls, 0);
});

test("never exceeds max_features", async () => {
  const result = await runPostPlaytestFeatureChain({
    operator_approval: true,
    feature_queue: ["feature-a", "feature-b", "feature-c"],
    max_features: 99,
    max_iterations_per_feature: 2,
    create_feature_loop: async ({ feature }) => createFeatureLoop(feature, "pass"),
  });

  assert.equal(result.max_features, 2);
  assert.deepEqual(result.features_attempted, ["feature-a", "feature-b"]);
  assert.deepEqual(result.features_completed, ["feature-a", "feature-b"]);
});

test("preserves feature order", async () => {
  const orderSeen: string[] = [];

  const result = await runPostPlaytestFeatureChain({
    operator_approval: true,
    feature_queue: ["feature-a", "feature-b"],
    max_features: 2,
    max_iterations_per_feature: 2,
    create_feature_loop: async ({ feature }) => {
      orderSeen.push(feature);
      return createFeatureLoop(feature, "pass");
    },
  });

  assert.equal(result.status, "chain_completed");
  assert.deepEqual(orderSeen, ["feature-a", "feature-b"]);
});

test("records feature-local loop summaries", async () => {
  const result = await runPostPlaytestFeatureChain({
    operator_approval: true,
    feature_queue: ["feature-a", "feature-b"],
    max_features: 2,
    max_iterations_per_feature: 2,
    create_feature_loop: async ({ feature, previous_feature_learning_summary }) => {
      if (feature === "feature-b") {
        assert.ok(previous_feature_learning_summary.some((entry) => /feature-a/i.test(entry)));
      }

      return createFeatureLoop(feature, "pass");
    },
  });

  assert.equal(result.loop_results.length, 2);
  assert.equal(result.loop_results[0]?.feature, "feature-a");
  assert.ok(result.loop_results[0]?.result.learning_results.some((entry) => /feature-a/i.test(entry)));
  assert.equal(result.loop_results[1]?.feature, "feature-b");
  assert.ok(result.loop_results[1]?.result.learning_results.some((entry) => /feature-b/i.test(entry)));
});