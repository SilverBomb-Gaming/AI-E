import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";
import type { ControlledExecutionDiff } from "./controlledPatchExecutor";
import {
  runGoalDrivenAutonomy,
  type GoalDrivenAutonomyControllerInput,
} from "./goalDrivenAutonomyController";
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

function createGoalDrivenInput(
  checkpointDirectory: string,
  overrides: Partial<GoalDrivenAutonomyControllerInput> = {},
): GoalDrivenAutonomyControllerInput {
  return {
    goal_id: "goal-validation-confidence",
    goal_statement: "Improve EnemyAIDemo validation confidence by proving two runtime-safe feature checks.",
    success_criteria: [
      "Complete goal feature runtime health validation safely.",
      "Complete goal feature session marker validation safely.",
    ],
    allowed_feature_pool: [
      "goal-feature-runtime-health",
      "goal-feature-session-marker",
      "goal-feature-enemy-feedback",
    ],
    max_cycles: 2,
    max_features_per_cycle: 2,
    max_iterations_per_feature: 2,
    operator_approval: true,
    checkpoint_directory: checkpointDirectory,
    probe_bridge: async () => ({ bridge_status: "bridge_ready" }),
    feature_evidence: [
      { feature: "goal-feature-runtime-health", latest_outcome: createOutcome("fail", "goal-feature-runtime-health", "runtime-health-fail") },
      { feature: "goal-feature-session-marker", latest_outcome: createOutcome("fail", "goal-feature-session-marker", "session-marker-fail") },
      { feature: "goal-feature-enemy-feedback", latest_outcome: createOutcome("fail", "goal-feature-enemy-feedback", "enemy-feedback-fail") },
    ],
    create_feature_loop: async ({ feature }) => ({
      initial_learning: createOutcome("fail", feature, `${feature}-initial-fail`),
      create_iteration: async () => ({
        file_changes: [createUpdate(`orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/${feature}.cs`)],
        allowed_roots: ["orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts"],
        rerun_validation: async () => ({
          completed: true,
          succeeded: true,
          reason: "clean",
        }),
        followup_learning: async () => createOutcome("pass", feature, `${feature}-followup-pass`),
      }),
      execute_fix: async (input) => createExecutionResult("executed", {
        modified_files: input.file_changes.map((change) => change.file_path),
      }),
    }),
    ...overrides,
  };
}

test("blocks without operator approval", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-goal-driven-approval-"));

  try {
    const result = await runGoalDrivenAutonomy(createGoalDrivenInput(checkpointDirectory, {
      operator_approval: false,
    }));

    assert.equal(result.status, "operator_review_required");
    assert.equal(result.cycles_completed, 0);
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("blocks without explicit goal", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-goal-driven-no-goal-"));

  try {
    const result = await runGoalDrivenAutonomy(createGoalDrivenInput(checkpointDirectory, {
      goal_id: "",
      goal_statement: "",
    }));

    assert.equal(result.status, "goal_blocked");
    assert.match(result.stop_reason, /requires an explicit operator goal/i);
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("blocks without allowed feature pool", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-goal-driven-no-pool-"));

  try {
    const result = await runGoalDrivenAutonomy(createGoalDrivenInput(checkpointDirectory, {
      allowed_feature_pool: [],
    }));

    assert.equal(result.status, "goal_blocked");
    assert.match(result.stop_reason, /requires an explicit allowed feature pool/i);
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("selects features relevant to goal", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-goal-driven-selection-"));

  try {
    const result = await runGoalDrivenAutonomy(createGoalDrivenInput(checkpointDirectory));

    assert.deepEqual(result.selected_features, [
      "goal-feature-runtime-health",
      "goal-feature-session-marker",
    ]);
    assert.ok(result.selected_features.every((feature) => createGoalDrivenInput(checkpointDirectory).allowed_feature_pool.includes(feature)));
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("records progress evidence", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-goal-driven-progress-"));

  try {
    const result = await runGoalDrivenAutonomy(createGoalDrivenInput(checkpointDirectory));

    assert.ok(result.progress_evidence.some((entry) => /selected "goal-feature-runtime-health"/i.test(entry)));
    assert.ok(result.progress_evidence.some((entry) => /success criterion met: "Complete goal feature runtime health validation safely\."/i.test(entry)));
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("marks goal_completed when success criteria met", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-goal-driven-complete-"));

  try {
    const result = await runGoalDrivenAutonomy(createGoalDrivenInput(checkpointDirectory));

    assert.equal(result.status, "goal_completed");
    assert.equal(result.cycles_completed, 2);
    assert.deepEqual(result.completed_features, [
      "goal-feature-runtime-health",
      "goal-feature-session-marker",
    ]);
    assert.deepEqual(result.unmet_success_criteria, []);
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("stops with budget_exhausted when incomplete", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-goal-driven-budget-"));

  try {
    const result = await runGoalDrivenAutonomy(createGoalDrivenInput(checkpointDirectory, {
      success_criteria: [
        "Complete goal feature runtime health validation safely.",
        "Complete goal feature session marker validation safely.",
        "Complete goal feature enemy feedback validation safely.",
      ],
    }));

    assert.equal(result.status, "budget_exhausted");
    assert.equal(result.cycles_completed, 2);
    assert.deepEqual(result.unmet_success_criteria, [
      "Complete goal feature enemy feedback validation safely.",
    ]);
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("writes checkpoint after each cycle", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-goal-driven-checkpoint-"));
  let cycleOneCheckpointVerified = false;

  try {
    const result = await runGoalDrivenAutonomy(createGoalDrivenInput(checkpointDirectory, {
      create_feature_loop: async (context) => {
        if (context.cycle_index === 1) {
          const checkpointPath = path.join(checkpointDirectory, `${context.goal.goal_id}.goal-driven-checkpoint.json`);
          const checkpointContent = await readFile(checkpointPath, "utf-8");
          const checkpoint = JSON.parse(checkpointContent) as {
            cycle: number;
            completed_features: string[];
          };

          cycleOneCheckpointVerified = checkpoint.cycle === 1
            && checkpoint.completed_features.includes("goal-feature-runtime-health");
        }

        return {
          initial_learning: createOutcome("fail", context.feature, `${context.feature}-initial-fail`),
          create_iteration: async () => ({
            file_changes: [createUpdate(`orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/${context.feature}.cs`)],
            allowed_roots: ["orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts"],
            rerun_validation: async () => ({ completed: true, succeeded: true, reason: "clean" }),
            followup_learning: async () => createOutcome("pass", context.feature, `${context.feature}-followup-pass`),
          }),
          execute_fix: async (input) => createExecutionResult("executed", {
            modified_files: input.file_changes.map((change) => change.file_path),
          }),
        };
      },
    }));

    assert.ok(cycleOneCheckpointVerified);
    assert.ok(result.checkpoint_path);

    const finalCheckpointContent = await readFile(result.checkpoint_path as string, "utf-8");
    const finalCheckpoint = JSON.parse(finalCheckpointContent) as {
      cycle: number;
      completed_features: string[];
    };

    assert.equal(finalCheckpoint.cycle, 2);
    assert.deepEqual(finalCheckpoint.completed_features, [
      "goal-feature-runtime-health",
      "goal-feature-session-marker",
    ]);
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});

test("never exceeds budgets", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-goal-driven-clamp-"));
  const observed: Array<{ cycle: number; maxFeatures: number; maxIterations: number; }> = [];

  try {
    const result = await runGoalDrivenAutonomy(createGoalDrivenInput(checkpointDirectory, {
      max_cycles: 99,
      max_features_per_cycle: 99,
      max_iterations_per_feature: 99,
      create_feature_loop: async (context) => {
        observed.push({
          cycle: context.cycle_index,
          maxFeatures: context.max_features_per_cycle,
          maxIterations: context.max_iterations_per_feature,
        });

        return {
          initial_learning: createOutcome("fail", context.feature, `${context.feature}-initial-fail`),
          create_iteration: async () => ({
            file_changes: [createUpdate(`orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/${context.feature}.cs`)],
            allowed_roots: ["orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts"],
            rerun_validation: async () => ({ completed: true, succeeded: true, reason: "clean" }),
            followup_learning: async () => createOutcome("pass", context.feature, `${context.feature}-followup-pass`),
          }),
          execute_fix: async (input) => createExecutionResult("executed", {
            modified_files: input.file_changes.map((change) => change.file_path),
          }),
        };
      },
    }));

    assert.equal(result.cycles_completed, 2);
    assert.ok(observed.every((entry) => entry.maxFeatures === 2));
    assert.ok(observed.every((entry) => entry.maxIterations === 2));
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});