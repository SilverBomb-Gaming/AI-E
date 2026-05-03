import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
import { setLearningEnabled } from "./learningConfig";
import { attemptApplyLearningRecommendation } from "./learningApplicationGate";
import { getLearningApplicationState, resetLearningApplicationState, revertLearningApplication } from "./learningApplicationState";
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
    outcome_id: "OUT-0000003501",
    created_at: "2026-05-03T18:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer26-step3",
    task_id: "node-task-layer26-step3",
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
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T18:05:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, alternative.plan_id), "2026-05-03T18:06:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T18:07:00.000Z"),
  ];
  const signals = computeLearningSignals(records, "2026-05-03T18:10:00.000Z");
  const audit = buildPassiveLearningAudit({
    signals,
    simulations: simulateRankingAdjustments(signals, annotated.plan_rankings ?? []),
    source_decision_record_count: records.length,
    createdAt: "2026-05-03T18:15:00.000Z",
  });
  const recommendation = generateLearningRecommendations(audit)[0];

  assert.ok(recommendation);
  return recommendation;
}

test("approved recommendation is still blocked by the disabled gate", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-app-gate-approved-"));
  const recommendation = createRecommendation();

  try {
    setLearningEnabled(false);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T18:20:00.000Z",
    }, { outputDirectory: tempRoot });
    const result = attemptApplyLearningRecommendation(recommendation, decision.record);

    assert.equal(result.enabled, false);
    assert.equal(result.gate_enabled, false);
    assert.equal(result.attempted_application, true);
    assert.equal(result.applied, false);
    assert.equal(result.blocked_reason, "learning disabled globally");
    assert.match(result.decision_id, new RegExp(`^${recommendation.recommendation_id}-approved_for_future_application-`));
    assert.equal(result.operator_decision, "approved_for_future_application");
    assert.equal(result.execution_triggered, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("rejected recommendation remains blocked by the disabled gate", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-app-gate-rejected-"));
  const recommendation = createRecommendation();

  try {
    setLearningEnabled(false);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "rejected",
      decided_at: "2026-05-03T18:21:00.000Z",
    }, { outputDirectory: tempRoot });
    const result = attemptApplyLearningRecommendation(recommendation, decision.record);

    assert.equal(result.enabled, false);
    assert.equal(result.gate_enabled, false);
    assert.equal(result.attempted_application, true);
    assert.equal(result.applied, false);
    assert.equal(result.blocked_reason, "learning disabled globally");
    assert.match(result.decision_id, new RegExp(`^${recommendation.recommendation_id}-rejected-`));
    assert.equal(result.operator_decision, "rejected");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("enabling the flag still does not apply learning", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-app-gate-enabled-"));
  const recommendation = createRecommendation();

  try {
    setLearningEnabled(true);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T18:21:30.000Z",
    }, { outputDirectory: tempRoot });
    const result = attemptApplyLearningRecommendation(recommendation, decision.record);

    assert.equal(result.enabled, true);
    assert.equal(result.gate_enabled, true);
    assert.equal(result.applied, true);
    assert.equal(result.scope, "ranking_weight_adjustment");
    assert.equal(result.reversible, true);
    assert.equal(result.blocked_reason, undefined);
    assert.equal(getLearningApplicationState().parameter_value, recommendation.confidence);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("application remains blocked when the recommendation decision is rejected", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-app-gate-not-approved-"));
  const recommendation = createRecommendation();

  try {
    setLearningEnabled(true);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "rejected",
      decided_at: "2026-05-03T18:21:45.000Z",
    }, { outputDirectory: tempRoot });
    const result = attemptApplyLearningRecommendation(recommendation, decision.record);

    assert.equal(result.applied, false);
    assert.equal(result.blocked_reason, "learning recommendation not approved");
    assert.equal(getLearningApplicationState().parameter_value, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("application remains blocked when the requested scope is not allowed", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-app-gate-scope-"));
  const recommendation = createRecommendation();

  try {
    setLearningEnabled(true);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T18:21:50.000Z",
    }, { outputDirectory: tempRoot });
    const result = attemptApplyLearningRecommendation(recommendation, decision.record, {
      scope: "risk_weight_adjustment" as never,
    });

    assert.equal(result.applied, false);
    assert.equal(result.blocked_reason, "learning scope not allowed");
    assert.equal(getLearningApplicationState().parameter_value, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("disabled learning application gate does not change rankings", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-app-gate-rankings-"));
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const recommendation = createRecommendation();
  const rankingsBefore = JSON.stringify(annotated.plan_rankings ?? []);

  try {
    setLearningEnabled(false);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T18:22:00.000Z",
    }, { outputDirectory: tempRoot });

    attemptApplyLearningRecommendation(recommendation, decision.record);

    assert.equal(JSON.stringify(annotated.plan_rankings ?? []), rankingsBefore);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("disabled learning application gate does not change execution behavior", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-app-gate-behavior-"));
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const selectedPlan = selectOperatorPlan(annotated, annotated.plan_id);
  const recommendation = createRecommendation();
  const taskBefore = translatePlanToNodeTask(selectedPlan);

  try {
    setLearningEnabled(false);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T18:23:00.000Z",
    }, { outputDirectory: tempRoot });

    const result = attemptApplyLearningRecommendation(recommendation, decision.record);
    const taskAfter = translatePlanToNodeTask(selectedPlan);

    assert.deepEqual(taskAfter, taskBefore);
    assert.equal(taskAfter.execution_triggered, false);
    assert.equal(result.autonomy_triggered, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("applied scoped learning is reversible and does not cascade into execution behavior", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-app-gate-revert-"));
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const selectedPlan = selectOperatorPlan(annotated, annotated.plan_id);
  const recommendation = createRecommendation();
  const taskBefore = translatePlanToNodeTask(selectedPlan);

  try {
    setLearningEnabled(true);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T18:24:00.000Z",
    }, { outputDirectory: tempRoot });
    const result = attemptApplyLearningRecommendation(recommendation, decision.record, {
      appliedAt: "2026-05-03T18:25:00.000Z",
    });
    const revertResult = revertLearningApplication();
    const taskAfter = translatePlanToNodeTask(selectedPlan);

    assert.equal(result.applied, true);
    assert.equal(result.scope, "ranking_weight_adjustment");
    assert.equal(result.reversible, true);
    assert.equal(revertResult.reverted, true);
    assert.equal(revertResult.scope, "ranking_weight_adjustment");
    assert.equal(getLearningApplicationState().parameter_value, 0);
    assert.deepEqual(taskAfter, taskBefore);
    assert.equal(taskAfter.execution_triggered, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});