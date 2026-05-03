import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  attachInsightsToPlan,
  selectOperatorPlan,
  type CoreNodePipelineDraftPlan,
} from "./nodeBoundary";
import { buildDecisionRecord } from "./decisionTrace";
import type { ExecutionOutcomeRecord } from "./executionOutcome";
import { generateExecutionInsights } from "./executionInsight";
import { setLearningEnabled } from "./learningConfig";
import { attemptApplyLearningRecommendation } from "./learningApplicationGate";
import { getLearningApplicationState, resetLearningApplicationState, revertLearningApplication } from "./learningApplicationState";
import { recordLearningRecommendationDecision } from "./learningRecommendationDecision";
import { generateLearningRecommendations, type LearningRecommendation } from "./learningRecommendationReview";
import { buildPassiveLearningAudit } from "./passiveLearningAudit";
import { computeLearningSignals } from "./passiveLearningSignals";
import { simulateRankingAdjustments } from "./passiveLearningSimulation";
import { getLearningStabilityGuardStatus } from "./learningStabilityGuard";

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
    outcome_id: "OUT-0000003701",
    created_at: "2026-05-03T20:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer27-step3",
    task_id: "node-task-layer27-step3",
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
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T20:05:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, alternative.plan_id), "2026-05-03T20:06:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T20:07:00.000Z"),
  ];
  const signals = computeLearningSignals(records, "2026-05-03T20:10:00.000Z");
  const audit = buildPassiveLearningAudit({
    signals,
    simulations: simulateRankingAdjustments(signals, annotated.plan_rankings ?? []),
    source_decision_record_count: records.length,
    createdAt: "2026-05-03T20:15:00.000Z",
  });
  const recommendation = {
    ...generateLearningRecommendations(audit)[0],
    confidence,
    recommendation_kind: "ranking_adjustment_candidate" as const,
  };

  assert.ok(recommendation);
  return recommendation;
}

test("multiple applications are capped by the cumulative stability limit", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-stability-cap-"));

  try {
    setLearningEnabled(true);
    const firstRecommendation = createRecommendation(0.68);
    const firstDecision = await recordLearningRecommendationDecision(firstRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T20:20:00.000Z",
    }, { outputDirectory: tempRoot });
    const firstResult = attemptApplyLearningRecommendation(firstRecommendation, firstDecision.record);

    assert.equal(firstResult.applied, true);
    assert.equal(getLearningStabilityGuardStatus().drift_detected, false);

    const secondRecommendation = createRecommendation(0.1);
    const secondDecision = await recordLearningRecommendationDecision(secondRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T20:21:00.000Z",
    }, { outputDirectory: tempRoot });
    const secondResult = attemptApplyLearningRecommendation(secondRecommendation, secondDecision.record);

    assert.equal(secondResult.applied, false);
    assert.equal(secondResult.blocked_reason, "learning drift detected");
    assert.equal(getLearningStabilityGuardStatus().drift_detected, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("drift detection blocks further applications once triggered", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-stability-block-"));

  try {
    setLearningEnabled(true);
    const firstRecommendation = createRecommendation(0.8);
    const firstDecision = await recordLearningRecommendationDecision(firstRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T20:22:00.000Z",
    }, { outputDirectory: tempRoot });
    const firstResult = attemptApplyLearningRecommendation(firstRecommendation, firstDecision.record);

    assert.equal(firstResult.applied, false);
    assert.equal(firstResult.blocked_reason, "learning drift detected");
    assert.equal(getLearningStabilityGuardStatus().drift_detected, true);

    const secondRecommendation = createRecommendation(0.2);
    const secondDecision = await recordLearningRecommendationDecision(secondRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T20:23:00.000Z",
    }, { outputDirectory: tempRoot });
    const secondResult = attemptApplyLearningRecommendation(secondRecommendation, secondDecision.record);

    assert.equal(secondResult.applied, false);
    assert.equal(secondResult.blocked_reason, "learning drift detected");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("revert resets drift and restores bounded application behavior", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-stability-revert-"));

  try {
    setLearningEnabled(true);
    const recommendation = createRecommendation(0.68);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T20:24:00.000Z",
    }, { outputDirectory: tempRoot });
    const appliedResult = attemptApplyLearningRecommendation(recommendation, decision.record);

    assert.equal(appliedResult.applied, true);
    assert.equal(getLearningApplicationState().parameter_value, 0.68);

    const reversion = revertLearningApplication();

    assert.equal(reversion.reverted, true);
    assert.equal(getLearningApplicationState().parameter_value, 0);
    assert.equal(getLearningStabilityGuardStatus().cumulative_adjustment_magnitude, 0);
    assert.equal(getLearningStabilityGuardStatus().drift_detected, false);

    const secondRecommendation = createRecommendation(0.62);
    const secondDecision = await recordLearningRecommendationDecision(secondRecommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T20:25:00.000Z",
    }, { outputDirectory: tempRoot });
    const secondResult = attemptApplyLearningRecommendation(secondRecommendation, secondDecision.record);

    assert.equal(secondResult.applied, true);
    assert.equal(getLearningStabilityGuardStatus().drift_detected, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});