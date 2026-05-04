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
import { enqueueLearningApplication, queryLearningApplicationQueue } from "./learningApplicationQueue";
import { suggestQueueExecutionOrder } from "./learningQueueOrdering";
import { resetLearningApplicationState } from "./learningApplicationState";
import { setLearningEnabled } from "./learningConfig";
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
    outcome_id: "OUT-0000004101",
    created_at: "2026-05-03T23:40:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer28-step4",
    task_id: "node-task-layer28-step4",
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

function createRecommendation(confidence: number): LearningRecommendation {
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const alternative = annotated.annotations?.find((annotation) => annotation.type === "plan_adjustment")?.alternative_plan;

  assert.ok(alternative?.plan_id);

  const records = [
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T23:41:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, alternative.plan_id), "2026-05-03T23:42:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T23:43:00.000Z"),
  ];
  const signals = computeLearningSignals(records, "2026-05-03T23:44:00.000Z");
  const audit = buildPassiveLearningAudit({
    signals,
    simulations: simulateRankingAdjustments(signals, annotated.plan_rankings ?? []),
    source_decision_record_count: records.length,
    createdAt: "2026-05-03T23:45:00.000Z",
  });
  const recommendation = {
    ...generateLearningRecommendations(audit)[0],
    confidence,
    recommendation_kind: "ranking_adjustment_candidate" as const,
  };

  assert.ok(recommendation);
  return recommendation;
}

test("suggestions are generated for queued items in bounded order", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-ordering-"));

  try {
    const lowAdjustment = createRecommendation(0.2);
    const mediumAdjustment = createRecommendation(0.45);
    const highAdjustment = createRecommendation(0.7);

    const lowDecision = await recordLearningRecommendationDecision(lowAdjustment, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T23:46:00.000Z",
    }, { outputDirectory: tempRoot });
    const mediumDecision = await recordLearningRecommendationDecision(mediumAdjustment, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T23:47:00.000Z",
    }, { outputDirectory: tempRoot });
    const highDecision = await recordLearningRecommendationDecision(highAdjustment, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T23:48:00.000Z",
    }, { outputDirectory: tempRoot });

    const lowQueued = await enqueueLearningApplication(lowAdjustment, lowDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-03T23:49:00.000Z",
    });
    const mediumQueued = await enqueueLearningApplication(mediumAdjustment, mediumDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-03T23:50:00.000Z",
    });
    const highQueued = await enqueueLearningApplication(highAdjustment, highDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-03T23:51:00.000Z",
    });

    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const suggestion = suggestQueueExecutionOrder(items);

    assert.deepEqual(suggestion.suggested_order, [
      lowQueued.record.queue_id,
      mediumQueued.record.queue_id,
      highQueued.record.queue_id,
    ]);
    assert.deepEqual(suggestion.based_on, ["risk", "confidence", "drift"]);
    assert.match(suggestion.reasoning, /lower-risk, smaller adjustment items first/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("suggestion does not mutate queue items", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-ordering-immutable-"));

  try {
    const recommendation = createRecommendation(0.35);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T23:52:00.000Z",
    }, { outputDirectory: tempRoot });
    await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-03T23:53:00.000Z",
    });

    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const before = JSON.stringify(items);

    suggestQueueExecutionOrder(items);

    assert.equal(JSON.stringify(items), before);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("suggestion does not trigger execution or autonomy", async () => {
  const suggestion = suggestQueueExecutionOrder([]);

  assert.equal(suggestion.execution_triggered, false);
  assert.equal(suggestion.autonomy_triggered, false);
  assert.deepEqual(suggestion.suggested_order, []);
});