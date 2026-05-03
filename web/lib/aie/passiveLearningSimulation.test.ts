import assert from "node:assert/strict";
import test from "node:test";

import {
  attachInsightsToPlan,
  selectOperatorPlan,
  translatePlanToNodeTask,
  type CoreNodePipelineDraftPlan,
} from "./nodeBoundary";
import { buildDecisionRecord } from "./decisionTrace";
import { generateExecutionInsights } from "./executionInsight";
import type { ExecutionOutcomeRecord } from "./executionOutcome";
import { rankPlans, type NodePlanRanking } from "./planRanking";
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
    outcome_id: "OUT-0000003101",
    created_at: "2026-05-03T13:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer25-step2",
    task_id: "node-task-layer25-step2",
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

function createAlternativeRankings(): NodePlanRanking[] {
  return rankPlans([
    {
      plan_id: "plan-a",
      label: "Alternative A",
      source: "alternative",
      command: "python diagnostics_smoke.py",
      steps: [
        "run python validate_runtime.py in test mode first",
        "ensure the recovery plan is ready and reviewed",
      ],
    },
    {
      plan_id: "plan-b",
      label: "Alternative B",
      source: "alternative",
      command: "python validate_runtime.py",
      steps: [
        "review the current bounded plan",
      ],
    },
  ], generateExecutionInsights([createExecutionOutcomeRecord()]), "high");
}

test("simulateRankingAdjustments computes shadow adjusted scores without mutating current rankings", () => {
  const rankings = createAlternativeRankings();
  const before = JSON.stringify(rankings);
  const signals = computeLearningSignals([
    {
      decision_id: "decision-1",
      timestamp: "2026-05-03T13:05:00.000Z",
      selected_plan_id: "plan-b",
      recommended_plan_id: "plan-a",
      ranking_score_gap: 0.2,
      operator_choice_alignment: false,
      available_plan_ids: ["system-plan-001", "plan-a", "plan-b"],
      insight_summary: [],
      severity_summary: { low: 0, medium: 0, high: 1, critical: 0 },
      operator_acknowledgement: { acknowledged: false },
    },
    {
      decision_id: "decision-2",
      timestamp: "2026-05-03T13:06:00.000Z",
      selected_plan_id: "plan-a",
      recommended_plan_id: "plan-a",
      ranking_score_gap: 0,
      operator_choice_alignment: true,
      available_plan_ids: ["system-plan-001", "plan-a", "plan-b"],
      insight_summary: [],
      severity_summary: { low: 0, medium: 0, high: 1, critical: 0 },
      operator_acknowledgement: { acknowledged: false },
    },
  ], "2026-05-03T13:10:00.000Z");

  const simulation = simulateRankingAdjustments(signals, rankings);

  assert.equal(JSON.stringify(rankings), before);
  assert.equal(simulation.length, rankings.length);
  assert.equal(simulation[0]?.plan_id, rankings[0]?.plan_id);
  assert.equal(simulation[0]?.current_score, rankings[0]?.score);
  assert.equal(simulation[0]?.delta, -0.025);
  assert.equal(simulation[0]?.simulated_adjusted_score, 0.267);
  assert.equal(simulation[1]?.delta, 0.025);
  assert.equal(simulation[1]?.simulated_adjusted_score, 0.101);
});

test("simulateRankingAdjustments remains simulation-only and does not change plan translation behavior", () => {
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const recommendedAlternative = annotated.annotations?.find((annotation) => annotation.type === "plan_adjustment")?.alternative_plan;

  assert.ok(recommendedAlternative?.plan_id);

  const selectedPlan = selectOperatorPlan(annotated, recommendedAlternative.plan_id);
  const decisionRecord = buildDecisionRecord(selectedPlan, "2026-05-03T13:08:00.000Z");
  const signals = computeLearningSignals([decisionRecord], "2026-05-03T13:12:00.000Z");
  const before = translatePlanToNodeTask(selectedPlan);

  const simulation = simulateRankingAdjustments(signals, annotated.plan_rankings ?? []);

  const after = translatePlanToNodeTask(selectedPlan);
  assert.equal(simulation.length, annotated.plan_rankings?.length ?? 0);
  assert.deepEqual(after, before);
  assert.equal(after.execution_triggered, false);
});