import assert from "node:assert/strict";
import test from "node:test";

import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";
import type { ControlledExecutionDiff } from "./controlledPatchExecutor";
import {
  runPostPlaytestLoop,
  type PostPlaytestLoopIterationInput,
} from "./postPlaytestLoopController";
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
  feature = "enemy-health",
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

function createIteration(filePath: string, followup: () => Promise<AutoRecordOutcomeResult | null>): PostPlaytestLoopIterationInput {
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

test("success after 1 iteration", async () => {
  let executeCalls = 0;

  const result = await runPostPlaytestLoop({
    operator_approval: true,
    max_iterations: 2,
    initial_learning: createOutcome("fail", "enemy-health", "initial-fail"),
    create_iteration: async () => createIteration(
      "orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/AIEPlaytestSessionMarker.cs",
      async () => createOutcome("pass", "enemy-health", "followup-pass"),
    ),
    execute_fix: async (input) => {
      executeCalls += 1;
      return createExecutionResult("executed", {
        modified_files: input.file_changes.map((change) => change.file_path),
      });
    },
  });

  assert.equal(result.status, "loop_stopped_success");
  assert.equal(result.iterations_completed, 1);
  assert.equal(result.rollback_events.length, 0);
  assert.equal(result.selected_strategies[0], "iteration 1: minimal_code_patch (Minimal code patch)");
  assert.equal(executeCalls, 1);
});

test("retry then success after 2 iterations", async () => {
  let iterationCalls = 0;

  const result = await runPostPlaytestLoop({
    operator_approval: true,
    max_iterations: 2,
    initial_learning: createOutcome("fail", "enemy-health", "initial-fail-two-step"),
    create_iteration: async ({ iteration }) => {
      iterationCalls += 1;
      return createIteration(
        `orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/AIEPlaytestSessionMarker.${iteration}.cs`,
        async () => iteration === 1
          ? createOutcome("fail", "enemy-health", "followup-fail")
          : createOutcome("pass", "enemy-health", "followup-pass-final"),
      );
    },
    execute_fix: async (input) => createExecutionResult("executed", {
      modified_files: input.file_changes.map((change) => change.file_path),
    }),
  });

  assert.equal(result.status, "loop_completed");
  assert.equal(result.iterations_completed, 2);
  assert.equal(iterationCalls, 2);
  assert.deepEqual(result.selected_strategies, [
    "iteration 1: minimal_code_patch (Minimal code patch)",
    "iteration 2: test_or_marker_adjustment (Test or marker adjustment)",
  ]);
  assert.equal(result.executed_actions.length, 2);
});

test("retry limit reached", async () => {
  let iterationCalls = 0;

  const result = await runPostPlaytestLoop({
    operator_approval: true,
    max_iterations: 2,
    initial_learning: createOutcome("fail", "enemy-health", "initial-fail-retry-limit"),
    create_iteration: async ({ iteration }) => {
      iterationCalls += 1;
      return createIteration(
        `orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/AIEPlaytestSessionMarker.limit-${iteration}.cs`,
        async () => createOutcome("fail", "enemy-health", `followup-fail-${iteration}`),
      );
    },
    execute_fix: async (input) => createExecutionResult("executed", {
      modified_files: input.file_changes.map((change) => change.file_path),
    }),
  });

  assert.equal(result.status, "retry_limit_reached");
  assert.equal(result.iterations_completed, 2);
  assert.equal(iterationCalls, 2);
  assert.match(result.stop_reason, /retry budget/i);
});

test("rollback event stops loop", async () => {
  const result = await runPostPlaytestLoop({
    operator_approval: true,
    max_iterations: 2,
    initial_learning: createOutcome("fail", "enemy-health", "initial-fail-rollback"),
    create_iteration: async () => createIteration(
      "orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/AIEPlaytestSessionMarker.rollback.cs",
      async () => createOutcome("pass", "enemy-health", "unused-pass"),
    ),
    execute_fix: async (input) => createExecutionResult("rolled_back", {
      reason: "Reviewed Unity validation rerun failed after the guarded fix.",
      modified_files: input.file_changes.map((change) => change.file_path),
      followup_learning_required: false,
    }),
  });

  assert.equal(result.status, "loop_stopped_failure");
  assert.equal(result.iterations_completed, 1);
  assert.equal(result.rollback_events.length, 1);
});

test("no infinite loop possible", async () => {
  let executeCalls = 0;

  const result = await runPostPlaytestLoop({
    operator_approval: true,
    max_iterations: 99,
    initial_learning: createOutcome("fail", "enemy-health", "initial-fail-no-loop"),
    create_iteration: async ({ iteration }) => createIteration(
      `orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/AIEPlaytestSessionMarker.no-loop-${iteration}.cs`,
      async () => createOutcome("fail", "enemy-health", `followup-no-loop-${iteration}`),
    ),
    execute_fix: async (input) => {
      executeCalls += 1;
      return createExecutionResult("executed", {
        modified_files: input.file_changes.map((change) => change.file_path),
      });
    },
  });

  assert.equal(result.status, "retry_limit_reached");
  assert.equal(result.max_iterations, 2);
  assert.equal(executeCalls, 2);
});

test("operator approval required", async () => {
  let executeCalls = 0;

  const result = await runPostPlaytestLoop({
    operator_approval: false,
    max_iterations: 2,
    initial_learning: createOutcome("fail", "enemy-health", "initial-fail-no-approval"),
    create_iteration: async () => createIteration(
      "orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/AIEPlaytestSessionMarker.blocked.cs",
      async () => createOutcome("pass", "enemy-health", "blocked-pass"),
    ),
    execute_fix: async () => {
      executeCalls += 1;
      return createExecutionResult("executed");
    },
  });

  assert.equal(result.status, "loop_blocked");
  assert.equal(result.iterations_completed, 0);
  assert.equal(executeCalls, 0);
});

test("loop controller records selected strategies per iteration", async () => {
  const result = await runPostPlaytestLoop({
    operator_approval: true,
    max_iterations: 2,
    initial_learning: createOutcome("fail", "enemy-health", "initial-fail-strategy-recording"),
    create_iteration: async ({ iteration, strategy_selection }) => createIteration(
      `orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/AIEPlaytestSessionMarker.strategy-${iteration}.cs`,
      async () => iteration === 1
        ? createOutcome("fail", "enemy-health", "followup-fail-strategy-recording")
        : createOutcome("pass", "enemy-health", "followup-pass-strategy-recording"),
    ),
    execute_fix: async (input) => createExecutionResult("executed", {
      modified_files: input.file_changes.map((change) => change.file_path),
    }),
  });

  assert.equal(result.selected_strategies.length, 2);
  assert.match(result.selected_strategies[0] ?? "", /minimal_code_patch/);
  assert.match(result.selected_strategies[1] ?? "", /test_or_marker_adjustment/);
});

test("no repeated failed strategy within same bounded loop", async () => {
  const seenStrategies: string[] = [];

  const result = await runPostPlaytestLoop({
    operator_approval: true,
    max_iterations: 2,
    initial_learning: createOutcome("fail", "enemy-health", "initial-fail-no-repeat-strategy"),
    create_iteration: async ({ iteration, strategy_selection }) => {
      seenStrategies.push(strategy_selection.selected_strategy_id ?? "none");

      return createIteration(
        `orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts/AIEPlaytestSessionMarker.no-repeat-${iteration}.cs`,
        async () => iteration === 1
          ? createOutcome("fail", "enemy-health", "followup-fail-no-repeat")
          : createOutcome("pass", "enemy-health", "followup-pass-no-repeat"),
      );
    },
    execute_fix: async (input) => createExecutionResult("executed", {
      modified_files: input.file_changes.map((change) => change.file_path),
    }),
  });

  assert.deepEqual(seenStrategies, ["minimal_code_patch", "test_or_marker_adjustment"]);
  assert.equal(result.status, "loop_completed");
});