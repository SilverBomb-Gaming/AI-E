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
import { buildPassiveLearningAudit } from "./passiveLearningAudit";
import { recordLearningRecommendationDecision, renderLearningRecommendationDecision } from "./learningRecommendationDecision";
import { generateLearningRecommendations, type LearningRecommendation } from "./learningRecommendationReview";
import { computeLearningSignals } from "./passiveLearningSignals";
import { simulateRankingAdjustments } from "./passiveLearningSimulation";

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
    outcome_id: "OUT-0000003401",
    created_at: "2026-05-03T17:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer26-step2",
    task_id: "node-task-layer26-step2",
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

function createRecommendation(): LearningRecommendation {
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const alternative = annotated.annotations?.find((annotation) => annotation.type === "plan_adjustment")?.alternative_plan;

  assert.ok(alternative?.plan_id);

  const records = [
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T17:05:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, alternative.plan_id), "2026-05-03T17:06:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T17:07:00.000Z"),
  ];
  const signals = computeLearningSignals(records, "2026-05-03T17:10:00.000Z");
  const audit = buildPassiveLearningAudit({
    signals,
    simulations: simulateRankingAdjustments(signals, annotated.plan_rankings ?? []),
    source_decision_record_count: records.length,
    createdAt: "2026-05-03T17:15:00.000Z",
  });
  const recommendation = generateLearningRecommendations(audit)[0];

  assert.ok(recommendation);
  return recommendation;
}

test("approved recommendation creates record", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-rec-decision-approved-"));
  const recommendation = createRecommendation();
  const before = JSON.stringify(recommendation);

  try {
    const result = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T17:20:00.000Z",
      rationale: "Operator wants to revisit this in a future design pass.",
    }, { outputDirectory: tempRoot });

    assert.equal(JSON.stringify(recommendation), before);
    assert.equal(result.record.operator_decision, "approved_for_future_application");
    assert.equal(result.record.applied, false);
    assert.equal(result.append_only, true);
    assert.equal(result.execution_triggered, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("rejected recommendation creates record", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-rec-decision-rejected-"));

  try {
    const result = await recordLearningRecommendationDecision(createRecommendation(), {
      operator_decision: "rejected",
      decided_at: "2026-05-03T17:21:00.000Z",
    }, { outputDirectory: tempRoot });

    assert.equal(result.record.operator_decision, "rejected");
    assert.equal(result.record.applied, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("applied recommendation is rejected", async () => {
  const recommendation = { ...createRecommendation(), applied: true as true };
  await assert.rejects(
    () => recordLearningRecommendationDecision(recommendation as never, { operator_decision: "rejected" }),
    /unapplied recommendation/,
  );
});

test("recommendation not requiring review is rejected", async () => {
  const recommendation = { ...createRecommendation(), requires_operator_review: false as false };
  await assert.rejects(
    () => recordLearningRecommendationDecision(recommendation as never, { operator_decision: "rejected" }),
    /marked for operator review/,
  );
});

test("recording is append-only and does not change planning or execution behavior", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-rec-decision-append-"));
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const selectedPlan = selectOperatorPlan(annotated, annotated.plan_id);
  const recommendation = createRecommendation();

  try {
    const before = translatePlanToNodeTask(selectedPlan);
    const first = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T17:22:00.000Z",
    }, { outputDirectory: tempRoot });
    await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "rejected",
      decided_at: "2026-05-03T17:23:00.000Z",
    }, { outputDirectory: tempRoot });
    const after = translatePlanToNodeTask(selectedPlan);
    const payload = await readFile(first.output_path, "utf-8");

    assert.equal(payload.trim().split(/\r?\n/).length, 2);
    assert.deepEqual(after, before);
    assert.equal(after.execution_triggered, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("renderLearningRecommendationDecision shows record-only status", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-rec-decision-render-"));

  try {
    const result = await recordLearningRecommendationDecision(createRecommendation(), {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T17:24:00.000Z",
      rationale: "Store approval for future review only.",
    }, { outputDirectory: tempRoot });
    const rendered = renderLearningRecommendationDecision(result.record);

    assert.match(rendered, /Learning recommendation decision:/);
    assert.match(rendered, /Operator decision: approved_for_future_application/);
    assert.match(rendered, /Applied: false/);
    assert.match(rendered, /Record only\./);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});