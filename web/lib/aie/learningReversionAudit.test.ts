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
import { buildDecisionRecord } from "./decisionTrace";
import type { ExecutionOutcomeRecord } from "./executionOutcome";
import { generateExecutionInsights } from "./executionInsight";
import { buildLearningReversionRecord, recordLearningReversion, renderLearningReversion } from "./learningReversionAudit";
import { setLearningEnabled } from "./learningConfig";
import { attemptApplyLearningRecommendation } from "./learningApplicationGate";
import { resetLearningApplicationState, revertLearningApplication } from "./learningApplicationState";
import { recordLearningRecommendationDecision } from "./learningRecommendationDecision";
import { generateLearningRecommendations, type LearningRecommendation } from "./learningRecommendationReview";
import { buildPassiveLearningAudit } from "./passiveLearningAudit";
import { computeLearningSignals } from "./passiveLearningSignals";
import { simulateRankingAdjustments } from "./passiveLearningSimulation";

test.afterEach(() => {
  setLearningEnabled(false);
  resetLearningApplicationState();
});

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
    validation_gates: ["review approval", "operator approval", "final authorization"],
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
    outcome_id: "OUT-0000003801",
    created_at: "2026-05-03T21:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer27-step4",
    task_id: "node-task-layer27-step4",
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

function createRecommendation(confidence = 0.68): LearningRecommendation {
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const alternative = annotated.annotations?.find((annotation) => annotation.type === "plan_adjustment")?.alternative_plan;

  assert.ok(alternative?.plan_id);

  const records = [
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T21:05:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, alternative.plan_id), "2026-05-03T21:06:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T21:07:00.000Z"),
  ];
  const signals = computeLearningSignals(records, "2026-05-03T21:10:00.000Z");
  const audit = buildPassiveLearningAudit({
    signals,
    simulations: simulateRankingAdjustments(signals, annotated.plan_rankings ?? []),
    source_decision_record_count: records.length,
    createdAt: "2026-05-03T21:15:00.000Z",
  });
  const recommendation = {
    ...generateLearningRecommendations(audit)[0],
    confidence,
    recommendation_kind: "ranking_adjustment_candidate" as const,
  };

  assert.ok(recommendation);
  return recommendation;
}

async function createReversionResult() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-reversion-audit-"));
  const decisionOutputDirectory = path.join(tempRoot, "decisions");
  const recommendation = createRecommendation();

  setLearningEnabled(true);
  const decision = await recordLearningRecommendationDecision(recommendation, {
    operator_decision: "approved_for_future_application",
    decided_at: "2026-05-03T21:20:00.000Z",
  }, { outputDirectory: decisionOutputDirectory });
  const appliedResult = attemptApplyLearningRecommendation(recommendation, decision.record, {
    appliedAt: "2026-05-03T21:21:00.000Z",
  });
  const reversionResult = revertLearningApplication();

  assert.equal(appliedResult.applied, true);
  assert.equal(reversionResult.reverted, true);

  return { tempRoot, reversionResult };
}

test("reversion record includes prior value and restored value", async () => {
  const { tempRoot, reversionResult } = await createReversionResult();

  try {
    const record = buildLearningReversionRecord(reversionResult, { createdAt: "2026-05-03T21:30:00.000Z" });

    assert.equal(record.previous_value, 0.68);
    assert.equal(record.restored_value, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("reversion record captures drift state before and after", async () => {
  const { tempRoot, reversionResult } = await createReversionResult();

  try {
    const record = buildLearningReversionRecord(reversionResult, { createdAt: "2026-05-03T21:31:00.000Z" });

    assert.equal(record.drift_state_before.cumulative_adjustment_magnitude, 0.68);
    assert.equal(record.drift_state_before.drift_detected, false);
    assert.equal(record.drift_state_after.cumulative_adjustment_magnitude, 0);
    assert.equal(record.drift_state_after.drift_detected, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("reversion record is marked reverted true", async () => {
  const { tempRoot, reversionResult } = await createReversionResult();

  try {
    const record = buildLearningReversionRecord(reversionResult, { createdAt: "2026-05-03T21:32:00.000Z" });

    assert.equal(record.reverted, true);
    assert.match(record.reversion_id, /^learning-reversion-/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("building and recording does not mutate the reversion result", async () => {
  const { tempRoot, reversionResult } = await createReversionResult();
  const before = JSON.stringify(reversionResult);

  try {
    const record = buildLearningReversionRecord(reversionResult, { createdAt: "2026-05-03T21:33:00.000Z" });
    await recordLearningReversion(record, { outputDirectory: tempRoot });

    assert.equal(JSON.stringify(reversionResult), before);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("recording is append only", async () => {
  const { tempRoot, reversionResult } = await createReversionResult();

  try {
    const first = buildLearningReversionRecord(reversionResult, { createdAt: "2026-05-03T21:34:00.000Z" });
    const second = buildLearningReversionRecord(reversionResult, { createdAt: "2026-05-03T21:35:00.000Z" });
    const writeResult = await recordLearningReversion(first, { outputDirectory: tempRoot });
    await recordLearningReversion(second, { outputDirectory: tempRoot });
    const payload = await readFile(writeResult.output_path, "utf-8");

    assert.equal(payload.trim().split(/\r?\n/).length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("reversion audit leaves execution behavior unchanged", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-reversion-behavior-"));
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const selectedPlan = selectOperatorPlan(annotated, annotated.plan_id);
  const taskBefore = translatePlanToNodeTask(selectedPlan);

  try {
    const { reversionResult } = await createReversionResult();
    const record = buildLearningReversionRecord(reversionResult, { createdAt: "2026-05-03T21:36:00.000Z" });
    const writeResult = await recordLearningReversion(record, { outputDirectory: tempRoot });
    const taskAfter = translatePlanToNodeTask(selectedPlan);
    const rendered = renderLearningReversion(writeResult.record);

    assert.deepEqual(taskAfter, taskBefore);
    assert.equal(taskAfter.execution_triggered, false);
    assert.equal(writeResult.execution_triggered, false);
    assert.equal(writeResult.autonomy_triggered, false);
    assert.match(rendered, /Learning reversion:/);
    assert.match(rendered, /Reverted: true/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});