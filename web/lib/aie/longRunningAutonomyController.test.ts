import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";
import type { ControlledExecutionDiff } from "./controlledPatchExecutor";
import {
  runLongRunningAutonomySession,
  type LongRunningAutonomyControllerInput,
} from "./longRunningAutonomyController";
import type { PostPlaytestFeatureChainControllerInput } from "./postPlaytestFeatureChainController";
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

function createCycleFeatureLoop(
  feature: string,
  followupResult: "pass" | "fail",
): NonNullable<PostPlaytestFeatureChainControllerInput["create_feature_loop"]> extends (...args: infer _A) => infer _R
  ? Awaited<ReturnType<NonNullable<PostPlaytestFeatureChainControllerInput["create_feature_loop"]>>>
  : never {
  return {
    initial_learning: createOutcome("fail", feature, `${feature}-initial-fail`),
    create_iteration: async () => createIteration(
      `orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/${feature}.cs`,
      async () => createOutcome(followupResult, feature, `${feature}-followup-${followupResult}`),
    ),
    execute_fix: async (input) => createExecutionResult("executed", {
      modified_files: input.file_changes.map((change) => change.file_path),
    }),
  } as Awaited<ReturnType<NonNullable<PostPlaytestFeatureChainControllerInput["create_feature_loop"]>>>;
}

function createSessionInput(
  checkpointDirectory: string,
  overrides: Partial<LongRunningAutonomyControllerInput> = {},
): LongRunningAutonomyControllerInput {
  return {
    session_id: "long-running-proof-session",
    operator_approval: true,
    max_cycles: 2,
    max_features_per_cycle: 2,
    max_iterations_per_feature: 2,
    feature_pool: ["feature-a", "feature-b", "feature-c", "feature-d"],
    checkpoint_directory: checkpointDirectory,
    probe_bridge: async () => ({ bridge_status: "bridge_ready" }),
    create_cycle: async ({ cycle_index }) => {
      const cycleFeatureMap = cycle_index === 0
        ? ["feature-a", "feature-b"]
        : ["feature-c", "feature-d"];

      return {
        feature_pool: cycleFeatureMap,
        feature_evidence: cycleFeatureMap.map((feature) => ({
          feature,
          latest_outcome: createOutcome("fail", feature, `${feature}-cycle-${cycle_index + 1}-fail`),
        })),
        create_feature_loop: async ({ feature }) => createCycleFeatureLoop(feature, "pass"),
      };
    },
    ...overrides,
  };
}

test("runs two cycles then stops at the hard session budget", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-long-running-session-"));

  try {
    const result = await runLongRunningAutonomySession(createSessionInput(checkpointDirectory));

    assert.equal(result.status, "budget_exhausted");
    assert.equal(result.cycles_completed, 2);
    assert.equal(result.max_cycles, 2);
    assert.deepEqual(result.features_completed, ["feature-a", "feature-b", "feature-c", "feature-d"]);
    assert.deepEqual(result.decisions_made, ["cycle_1:chain_completed", "cycle_2:chain_completed"]);
    assert.match(result.stop_reason, /hard cycle budget of 2/i);
    assert.equal(result.confidence, "high");
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("writes checkpoint after each cycle", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-long-running-checkpoint-"));

  try {
    const result = await runLongRunningAutonomySession(createSessionInput(checkpointDirectory));
    assert.ok(result.checkpoint_path);

    const checkpointContent = await readFile(result.checkpoint_path as string, "utf-8");
    const checkpoint = JSON.parse(checkpointContent) as {
      cycle: number;
      features_completed: string[];
      status: string;
    };

    assert.equal(checkpoint.cycle, 2);
    assert.equal(checkpoint.status, "chain_completed");
    assert.deepEqual(checkpoint.features_completed, ["feature-a", "feature-b", "feature-c", "feature-d"]);
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("stops on bridge unavailable", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-long-running-bridge-stop-"));

  try {
    const result = await runLongRunningAutonomySession(createSessionInput(checkpointDirectory, {
      probe_bridge: async ({ cycle_index }) => cycle_index === 0
        ? { bridge_status: "bridge_ready" }
        : { bridge_status: "bridge_unavailable", reason: "The reviewed Unity bridge is unavailable for cycle 2." },
    }));

    assert.equal(result.status, "safety_stop");
    assert.equal(result.cycles_completed, 1);
    assert.ok(result.checkpoint_path);
    assert.match(result.stop_reason, /bridge is unavailable/i);
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("stops on no feature available", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-long-running-no-feature-"));

  try {
    const result = await runLongRunningAutonomySession(createSessionInput(checkpointDirectory, {
      create_cycle: async ({ cycle_index }) => ({
        feature_pool: cycle_index === 0 ? ["feature-a"] : [],
        feature_evidence: cycle_index === 0
          ? [{ feature: "feature-a", latest_outcome: createOutcome("fail", "feature-a", "feature-a-cycle-1-fail") }]
          : [],
        create_feature_loop: async ({ feature }) => createCycleFeatureLoop(feature, "pass"),
      }),
    }));

    assert.equal(result.status, "session_completed");
    assert.equal(result.cycles_completed, 1);
    assert.deepEqual(result.features_completed, ["feature-a"]);
    assert.match(result.stop_reason, /no reviewed feature remained available|explicit pool/i);
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("blocks without operator approval", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-long-running-approval-"));
  let createCycleCalls = 0;

  try {
    const result = await runLongRunningAutonomySession(createSessionInput(checkpointDirectory, {
      operator_approval: false,
      create_cycle: async (context) => {
        createCycleCalls += 1;
        return createSessionInput(checkpointDirectory).create_cycle(context);
      },
    }));

    assert.equal(result.status, "operator_review_required");
    assert.equal(result.cycles_completed, 0);
    assert.equal(createCycleCalls, 0);
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("never exceeds max_cycles or nested budgets", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-long-running-clamp-"));
  const observed: Array<{ cycle: number; maxFeatures: number; maxIterations: number; }> = [];

  try {
    const result = await runLongRunningAutonomySession(createSessionInput(checkpointDirectory, {
      max_cycles: 99,
      max_features_per_cycle: 99,
      max_iterations_per_feature: 99,
      create_cycle: async ({ cycle_index }) => ({
        feature_pool: ["feature-a", "feature-b", "feature-c"],
        feature_evidence: [
          { feature: "feature-a", latest_outcome: createOutcome("fail", "feature-a", `feature-a-${cycle_index}`) },
          { feature: "feature-b", latest_outcome: createOutcome("fail", "feature-b", `feature-b-${cycle_index}`) },
          { feature: "feature-c", latest_outcome: createOutcome("fail", "feature-c", `feature-c-${cycle_index}`) },
        ],
        create_feature_loop: async (context) => {
          observed.push({
            cycle: cycle_index,
            maxFeatures: context.max_features,
            maxIterations: context.max_iterations_per_feature,
          });
          return createCycleFeatureLoop(context.feature, "pass");
        },
      }),
    }));

    assert.equal(result.status, "budget_exhausted");
    assert.equal(result.max_cycles, 2);
    assert.equal(result.cycles_completed, 2);
    assert.ok(observed.every((entry) => entry.maxFeatures === 2));
    assert.ok(observed.every((entry) => entry.maxIterations === 2));
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});