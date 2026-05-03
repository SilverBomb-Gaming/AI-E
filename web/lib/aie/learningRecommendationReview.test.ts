import assert from "node:assert/strict";
import test from "node:test";

import {
  attachInsightsToPlan,
  selectOperatorPlan,
  type CoreNodePipelineDraftPlan,
} from "./nodeBoundary";
import { buildDecisionRecord } from "./decisionTrace";
import type { ExecutionOutcomeRecord } from "./executionOutcome";
import { generateExecutionInsights } from "./executionInsight";
import { buildPassiveLearningAudit } from "./passiveLearningAudit";
import { generateLearningRecommendations, renderLearningRecommendations } from "./learningRecommendationReview";
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
    outcome_id: "OUT-0000003301",
    created_at: "2026-05-03T16:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer26-step1",
    task_id: "node-task-layer26-step1",
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

function createFrozenAudit(sourceDecisionRecordCount = 3) {
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const alternative = annotated.annotations?.find((annotation) => annotation.type === "plan_adjustment")?.alternative_plan;

  assert.ok(alternative?.plan_id);

  const records = [
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T16:05:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T16:06:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, alternative.plan_id), "2026-05-03T16:07:00.000Z"),
  ].slice(0, sourceDecisionRecordCount);
  const signals = computeLearningSignals(records, "2026-05-03T16:10:00.000Z");
  const simulations = simulateRankingAdjustments(signals, annotated.plan_rankings ?? []);

  return buildPassiveLearningAudit({
    signals,
    simulations,
    source_decision_record_count: sourceDecisionRecordCount,
    createdAt: "2026-05-03T16:15:00.000Z",
  });
}

test("frozen audit produces review-only recommendations and does not mutate the audit", () => {
  const audit = createFrozenAudit();
  const before = JSON.stringify(audit);

  const recommendations = generateLearningRecommendations(audit);

  assert.equal(JSON.stringify(audit), before);
  assert.ok(recommendations.length >= 1);
  for (const recommendation of recommendations) {
    assert.equal(recommendation.source_audit_id, audit.audit_id);
    assert.equal(recommendation.applied, false);
    assert.equal(recommendation.requires_operator_review, true);
    assert.ok(recommendation.confidence >= 0);
    assert.ok(recommendation.rationale.length > 0);
  }
});

test("non-frozen audit is rejected", () => {
  const audit = { ...createFrozenAudit(), frozen: false as false };
  assert.throws(() => generateLearningRecommendations(audit as never), /frozen passive learning audit/);
});

test("applied audit is rejected", () => {
  const audit = { ...createFrozenAudit(), applied: true as true };
  assert.throws(() => generateLearningRecommendations(audit as never), /unapplied passive learning audit/);
});

test("low accuracy produces ranking adjustment candidate and rollback penalty review", () => {
  const audit = createFrozenAudit(3);
  const recommendations = generateLearningRecommendations(audit);

  assert.ok(recommendations.some((recommendation) => recommendation.recommendation_kind === "ranking_adjustment_candidate"));
  assert.ok(recommendations.some((recommendation) => recommendation.recommendation_kind === "rollback_penalty_review"));
});

test("low source count produces insufficient data warning", () => {
  const audit = createFrozenAudit(1);
  const recommendations = generateLearningRecommendations(audit);

  assert.ok(recommendations.some((recommendation) => recommendation.recommendation_kind === "insufficient_data_warning"));
});

test("renderLearningRecommendations shows review-only guidance", () => {
  const recommendations = generateLearningRecommendations(createFrozenAudit());
  const rendered = renderLearningRecommendations(recommendations);

  assert.match(rendered, /Learning recommendations are review-only\./);
  assert.match(rendered, /Applied: false/);
  assert.match(rendered, /Requires operator review: true/);
});