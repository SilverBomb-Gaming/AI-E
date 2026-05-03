import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  attachInsightsToPlan,
  selectOperatorPlan,
  translatePlanToNodeTask,
  type CoreNodePipelineDraftPlan,
} from "./nodeBoundary";
import { buildDecisionRecord, type DecisionRecord } from "./decisionTrace";
import { generateExecutionInsights } from "./executionInsight";
import type { ExecutionOutcomeRecord } from "./executionOutcome";
import { computeLearningSignals, recordLearningSignals } from "./passiveLearningSignals";

function createNodeTaskPlan(overrides: Partial<CoreNodePipelineDraftPlan> = {}): CoreNodePipelineDraftPlan {
  return {
    plan_id: "system-plan-001",
    planning_stage: "planning",
    execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
    planning_suggestions: [
      "Keep the verified bounded Unity lane unchanged.",
      "Prepare operator-visible review artifacts before any execution decision.",
    ],
    validation_insights: [
      "Validation gates remain mandatory before execution.",
      "Manual approval remains required before core execution.",
    ],
    dependency_reasoning: [
      "The verified EnemyAIDemo lane remains the only supported mutation surface.",
    ],
    validation_gates: [
      "review approval",
      "operator approval",
      "final authorization",
    ],
    execution_authority: "system_only",
    node_id: "core-planner",
    target_node_id: "node-worker-1",
    command: "python validate_runtime.py",
    risk_level: "high",
    working_directory: "E:/AI projects 2025/AI-E",
    target_node_role: "validator",
    target_node_name: "Validator Node 01",
    requester_label: "AI-E Core",
    chat_id: "core-draft",
    request_source: "core-draft-export",
    routing_reason: "core draft routed to validator",
    ...overrides,
  };
}

function createExecutionOutcomeRecord(overrides: Partial<ExecutionOutcomeRecord> = {}): ExecutionOutcomeRecord {
  return {
    outcome_id: "OUT-0000003001",
    created_at: "2026-05-03T12:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer25-step1",
    task_id: "node-task-layer25-step1",
    plan_id: "system-plan-001",
    node_id: "core-planner",
    target_node_id: "node-worker-1",
    command: "python validate_runtime.py",
    status: "failed",
    success: false,
    risk_level: "high",
    approval_path: ["operator_confirm_submit", "node_intake_review", "node_worker_execution"],
    execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
    evidence_labels: [
      "NODE RESULT CAPTURED",
      "EXECUTION OUTCOME RECORDED",
      "LEARNING SUBSTRATE APPEND ONLY",
      "NO AUTONOMY TRIGGERED",
    ],
    result_summary: "integration regression failure",
    error_summary: "integration regression failure",
    rollback_required: true,
    rollback_executed: true,
    recovery_status: "executed",
    ...overrides,
  };
}

function createAlignedAndMismatchedRecords(): { alignedRecord: DecisionRecord; mismatchRecord: DecisionRecord } {
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const recommendedAlternative = annotated.annotations?.find((annotation) => annotation.type === "plan_adjustment")?.alternative_plan;

  assert.ok(recommendedAlternative?.plan_id);

  return {
    alignedRecord: buildDecisionRecord(selectOperatorPlan(annotated, recommendedAlternative.plan_id), "2026-05-03T12:05:00.000Z"),
    mismatchRecord: buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T12:06:00.000Z"),
  };
}

test("computeLearningSignals computes passive accuracy error margin and misalignment patterns correctly", () => {
  const { alignedRecord, mismatchRecord } = createAlignedAndMismatchedRecords();

  const signals = computeLearningSignals([alignedRecord, mismatchRecord], "2026-05-03T12:10:00.000Z");

  assert.equal(signals.generated_at, "2026-05-03T12:10:00.000Z");
  assert.equal(signals.total_records, 2);
  assert.equal(signals.recommendation_accuracy, 0.5);
  assert.equal(signals.average_error_margin, Math.round((((alignedRecord.ranking_score_gap + mismatchRecord.ranking_score_gap) / 2) * 1000)) / 1000);
  assert.equal(signals.misalignment_patterns.length, 1);
  assert.equal(signals.misalignment_patterns[0]?.recommended_plan_id, mismatchRecord.recommended_plan_id);
  assert.equal(signals.misalignment_patterns[0]?.selected_plan_id, mismatchRecord.selected_plan_id);
  assert.equal(signals.misalignment_patterns[0]?.occurrence_count, 1);
  assert.equal(signals.execution_triggered, false);
  assert.equal(signals.autonomy_triggered, false);
});

test("recordLearningSignals stores passive signals append-only without changing execution behavior", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-signals-"));

  try {
    const { mismatchRecord } = createAlignedAndMismatchedRecords();
    const sourcePlan = selectOperatorPlan(
      attachInsightsToPlan(createNodeTaskPlan(), generateExecutionInsights([createExecutionOutcomeRecord()])),
      createNodeTaskPlan().plan_id,
    );
    const before = translatePlanToNodeTask(sourcePlan);
    const signals = computeLearningSignals([mismatchRecord], "2026-05-03T12:12:00.000Z");

    const written = await recordLearningSignals(signals, { outputDirectory: tempRoot });
    const after = translatePlanToNodeTask(sourcePlan);

    assert.equal(written.status, "recorded");
    assert.equal(written.append_only, true);
    assert.equal(written.data_only, true);
    assert.equal(written.execution_triggered, false);
    assert.equal(written.autonomy_triggered, false);
    assert.deepEqual(after, before);
    assert.equal(after.execution_triggered, false);

    const payload = await readFile(written.output_path, "utf-8");
    const lines = payload.trim().split(/\r?\n/);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]) as { recommendation_accuracy?: number; misalignment_patterns?: Array<{ selected_plan_id?: string }> };
    assert.equal(parsed.recommendation_accuracy, signals.recommendation_accuracy);
    assert.equal(parsed.misalignment_patterns?.[0]?.selected_plan_id, mismatchRecord.selected_plan_id);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});