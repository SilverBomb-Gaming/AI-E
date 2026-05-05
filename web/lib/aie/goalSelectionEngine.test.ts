import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";
import type { ControlledExecutionDiff } from "./controlledPatchExecutor";
import {
  runAutonomousGoalSelectionFlow,
  selectNextAutonomousGoal,
} from "./goalSelectionEngine";
import type { OutcomeSummary } from "./outcomeLearning";
import type { PostPlaytestExecutionResult } from "./postPlaytestExecutor";

function createOutcome(
  inferredResult: "pass" | "fail" | "partial",
  feature: string,
  sessionKey = `${feature}-${inferredResult}`,
): AutoRecordOutcomeResult {
  return {
    status: "recorded",
    projectPath: "proj",
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
      reason: inferredResult === "fail"
        ? ["runtime errors detected: 1"]
        : inferredResult === "partial"
          ? ["detected gameplay events alongside runtime errors"]
          : ["runtime pass detected"],
    } as AutoRecordOutcomeResult["evaluation"],
    recorded: {
      record: { sessionKey },
      duplicate: false,
    } as AutoRecordOutcomeResult["recorded"],
    summary: {
      totalOutcomes: 1,
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

function createLearningSummary(overrides: Partial<OutcomeSummary> = {}): OutcomeSummary {
  return {
    projectPath: "proj",
    logPath: "proj/.aie/outcomes.jsonl",
    totalOutcomes: 3,
    passCount: 1,
    failCount: 1,
    partialCount: 1,
    rollbackCount: 0,
    rollbackFrequency: 0,
    runtimeAutoCount: 3,
    manualCount: 0,
    latestRuntimeAutoPattern: "Feature goal-feature-runtime-health failed because observation runtime failure persisted.",
    latestSuccessfulPatterns: ["Feature goal-feature-enemy-feedback worked with approach runtime signal extraction"],
    latestFailurePatterns: ["Feature goal-feature-runtime-health failed because observation runtime failure persisted."],
    ...overrides,
  };
}

function createUpdate(filePath: string): ControlledExecutionDiff {
  return {
    file_path: filePath,
    change_type: "update",
    after_snapshot: "after\n",
    summary_of_change: "Apply the smallest safe reviewed fix.",
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

test("blocks without allowed systems", () => {
  const result = selectNextAutonomousGoal({
    learning_summary: createLearningSummary(),
  });

  assert.equal(result.status, "selection_blocked");
  assert.equal(result.proposed_goal, null);
  assert.match(result.rejection_reasons[0] ?? "", /explicit allowed system list/i);
});

test("blocks without evidence", () => {
  const result = selectNextAutonomousGoal({
    allowed_systems: ["runtime", "session", "enemy"],
  });

  assert.equal(result.status, "selection_blocked");
  assert.equal(result.proposed_goal, null);
  assert.match(result.rejection_reasons[0] ?? "", /requires recent learning, feature evidence, or project state/i);
});

test("proposes a bounded goal from unresolved failures and project state", () => {
  const result = selectNextAutonomousGoal({
    allowed_systems: ["runtime", "session", "enemy"],
    learning_summary: createLearningSummary(),
    project_state_summary: [
      "EnemyAIDemo validation confidence is still blocked by runtime-health failures and session-marker follow-up work.",
    ],
    feature_evidence: [
      { feature: "goal-feature-runtime-health", latest_outcome: createOutcome("fail", "goal-feature-runtime-health") },
      { feature: "goal-feature-session-marker", latest_outcome: createOutcome("partial", "goal-feature-session-marker"), known_outcome_state: "unstable" },
      { feature: "goal-feature-enemy-feedback", latest_outcome: createOutcome("pass", "goal-feature-enemy-feedback") },
    ],
    partially_completed_features: ["goal-feature-session-marker"],
  });

  assert.equal(result.status, "goal_proposed");
  assert.equal(result.proposed_goal?.goal_id, "goal-selection-goal-feature-runtime-health");
  assert.ok((result.proposed_goal?.goal_statement ?? "").includes("runtime-health"));
  assert.deepEqual(result.proposed_goal?.allowed_feature_pool, [
    "goal-feature-runtime-health",
    "goal-feature-session-marker",
  ]);
  assert.equal(result.candidate_goals[0]?.goal_id, "goal-selection-goal-feature-runtime-health");
  assert.ok((result.candidate_goals[0]?.source_evidence ?? []).some((entry) => /unresolved failing evidence/i.test(entry)));
  assert.equal(result.confidence, "high");
});

test("prefers unresolved failures over passing features", () => {
  const result = selectNextAutonomousGoal({
    allowed_systems: ["runtime", "session", "enemy"],
    learning_summary: createLearningSummary(),
    feature_evidence: [
      { feature: "goal-feature-runtime-health", latest_outcome: createOutcome("fail", "goal-feature-runtime-health") },
      { feature: "goal-feature-enemy-feedback", latest_outcome: createOutcome("pass", "goal-feature-enemy-feedback") },
    ],
    project_state_summary: ["Runtime-health is still unresolved in EnemyAIDemo."],
  });

  assert.equal(result.status, "goal_proposed");
  assert.equal(result.proposed_goal?.allowed_feature_pool[0], "goal-feature-runtime-health");
  assert.ok(result.rejection_reasons.some((entry) => /already has passing evidence/i.test(entry)));
});

test("rejects already completed goals", () => {
  const result = selectNextAutonomousGoal({
    allowed_systems: ["runtime", "session", "enemy"],
    learning_summary: createLearningSummary(),
    project_state_summary: ["Runtime-health and session-marker still need supervised attention."],
    feature_evidence: [
      { feature: "goal-feature-runtime-health", latest_outcome: createOutcome("fail", "goal-feature-runtime-health") },
      { feature: "goal-feature-session-marker", latest_outcome: createOutcome("partial", "goal-feature-session-marker"), known_outcome_state: "unstable" },
    ],
    partially_completed_features: ["goal-feature-session-marker"],
    completed_goal_ids: ["goal-selection-goal-feature-runtime-health"],
  });

  assert.equal(result.status, "goal_proposed");
  assert.equal(result.proposed_goal?.goal_id, "goal-selection-goal-feature-session-marker");
  assert.ok(result.rejection_reasons.some((entry) => /already completed/i.test(entry)));
});

test("returns no_goal_available when no bounded evidence remains", () => {
  const result = selectNextAutonomousGoal({
    allowed_systems: ["runtime", "session", "enemy"],
    learning_summary: createLearningSummary({
      failCount: 0,
      partialCount: 0,
      latestFailurePatterns: [],
    }),
    project_state_summary: ["All reviewed runtime systems are stable."],
    feature_evidence: [
      { feature: "goal-feature-runtime-health", latest_outcome: createOutcome("pass", "goal-feature-runtime-health") },
      { feature: "goal-feature-enemy-feedback", latest_outcome: createOutcome("pass", "goal-feature-enemy-feedback") },
    ],
  });

  assert.equal(result.status, "no_goal_available");
  assert.equal(result.proposed_goal, null);
  assert.equal(result.candidate_goals.length, 0);
});

test("requires operator review when unstable goals tie", () => {
  const result = selectNextAutonomousGoal({
    allowed_systems: ["runtime", "session", "enemy"],
    learning_summary: createLearningSummary({
      failCount: 0,
      latestFailurePatterns: [],
    }),
    project_state_summary: ["Runtime and session systems both remain inconclusive."],
    feature_evidence: [
      { feature: "goal-feature-runtime-health", latest_outcome: createOutcome("partial", "goal-feature-runtime-health"), known_outcome_state: "unstable" },
      { feature: "goal-feature-session-marker", latest_outcome: createOutcome("partial", "goal-feature-session-marker"), known_outcome_state: "unstable" },
    ],
  });

  assert.equal(result.status, "operator_review_required");
  assert.equal(result.proposed_goal, null);
  assert.equal(result.candidate_goals.length, 2);
  assert.equal(result.confidence, "low");
});

test("never expands the proposed feature pool beyond the hard bound", () => {
  const result = selectNextAutonomousGoal({
    allowed_systems: ["runtime", "session", "enemy"],
    learning_summary: createLearningSummary(),
    project_state_summary: ["Runtime-health, session-marker, and enemy-feedback are all present in project state."],
    feature_evidence: [
      { feature: "goal-feature-runtime-health", latest_outcome: createOutcome("fail", "goal-feature-runtime-health") },
      { feature: "goal-feature-session-marker", latest_outcome: createOutcome("partial", "goal-feature-session-marker"), known_outcome_state: "unstable" },
      { feature: "goal-feature-enemy-feedback", latest_outcome: createOutcome("partial", "goal-feature-enemy-feedback"), known_outcome_state: "unstable" },
    ],
  });

  assert.equal(result.status, "goal_proposed");
  assert.ok((result.proposed_goal?.allowed_feature_pool.length ?? 0) <= 2);
});

test("proposed goals hand off into goal-driven autonomy only after operator approval", async () => {
  const checkpointDirectory = await mkdtemp(path.join(tmpdir(), "aie-goal-selection-flow-"));

  try {
    const blocked = await runAutonomousGoalSelectionFlow({
      allowed_systems: ["runtime", "session", "enemy"],
      learning_summary: createLearningSummary(),
      project_state_summary: [
        "EnemyAIDemo validation confidence is still blocked by runtime-health failures and session-marker follow-up work.",
      ],
      feature_evidence: [
        { feature: "goal-feature-runtime-health", latest_outcome: createOutcome("fail", "goal-feature-runtime-health") },
        { feature: "goal-feature-session-marker", latest_outcome: createOutcome("partial", "goal-feature-session-marker"), known_outcome_state: "unstable" },
      ],
      partially_completed_features: ["goal-feature-session-marker"],
      operator_approval: false,
      checkpoint_directory: checkpointDirectory,
      max_cycles: 2,
      max_features_per_cycle: 2,
      max_iterations_per_feature: 2,
      probe_bridge: async () => ({ bridge_status: "bridge_ready" }),
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
    });

    assert.equal(blocked.status, "operator_review_required");
    assert.equal(blocked.goal_selection.status, "goal_proposed");
    assert.equal(blocked.execution_result, null);

    const executed = await runAutonomousGoalSelectionFlow({
      allowed_systems: ["runtime", "session", "enemy"],
      learning_summary: createLearningSummary(),
      project_state_summary: [
        "EnemyAIDemo validation confidence is still blocked by runtime-health failures and session-marker follow-up work.",
      ],
      feature_evidence: [
        { feature: "goal-feature-runtime-health", latest_outcome: createOutcome("fail", "goal-feature-runtime-health") },
        { feature: "goal-feature-session-marker", latest_outcome: createOutcome("partial", "goal-feature-session-marker"), known_outcome_state: "unstable" },
      ],
      partially_completed_features: ["goal-feature-session-marker"],
      operator_approval: true,
      checkpoint_directory: checkpointDirectory,
      max_cycles: 2,
      max_features_per_cycle: 2,
      max_iterations_per_feature: 2,
      probe_bridge: async () => ({ bridge_status: "bridge_ready" }),
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
    });

    assert.equal(executed.status, "goal_completed");
    assert.equal(executed.goal_selection.status, "goal_proposed");
    assert.equal(executed.execution_result?.status, "goal_completed");
    assert.equal(executed.execution_result?.selected_features.length, 2);
    assert.ok(executed.execution_result?.selected_features.includes("goal-feature-runtime-health"));
    assert.ok(executed.execution_result?.selected_features.includes("goal-feature-session-marker"));
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
});