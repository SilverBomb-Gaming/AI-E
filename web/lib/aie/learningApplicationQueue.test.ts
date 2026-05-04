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
import { getLearningApplicationState, resetLearningApplicationState } from "./learningApplicationState";
import {
  enqueueLearningApplication,
  queryLearningApplicationQueue,
  renderLearningApplicationQueue,
} from "./learningApplicationQueue";
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
    outcome_id: "OUT-0000003901",
    created_at: "2026-05-03T22:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer28-step1",
    task_id: "node-task-layer28-step1",
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
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T22:05:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, alternative.plan_id), "2026-05-03T22:06:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T22:07:00.000Z"),
  ];
  const signals = computeLearningSignals(records, "2026-05-03T22:10:00.000Z");
  const audit = buildPassiveLearningAudit({
    signals,
    simulations: simulateRankingAdjustments(signals, annotated.plan_rankings ?? []),
    source_decision_record_count: records.length,
    createdAt: "2026-05-03T22:15:00.000Z",
  });
  const recommendation = generateLearningRecommendations(audit)[0];

  assert.ok(recommendation);
  return recommendation;
}

test("approved recommendation can be queued", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-queue-approved-"));
  const recommendation = createRecommendation();

  try {
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T22:20:00.000Z",
    }, { outputDirectory: tempRoot });
    const queued = await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-03T22:21:00.000Z",
    });

    assert.equal(queued.record.status, "queued");
    assert.equal(queued.record.scope, "ranking_weight_adjustment");
    assert.equal(queued.record.applied, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("rejected recommendation cannot be queued", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-queue-rejected-"));
  const recommendation = createRecommendation();

  try {
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "rejected",
      decided_at: "2026-05-03T22:22:00.000Z",
    }, { outputDirectory: tempRoot });
    const queued = await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-03T22:23:00.000Z",
    });

    assert.equal(queued.record.status, "blocked");
    assert.equal(queued.record.blocked_reason, "learning recommendation not approved");
    assert.equal(queued.record.applied, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("unsupported scope is blocked", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-queue-scope-"));
  const recommendation = createRecommendation();

  try {
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T22:24:00.000Z",
    }, { outputDirectory: tempRoot });
    const queued = await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-03T22:25:00.000Z",
      scope: "risk_weight_adjustment" as never,
    });

    assert.equal(queued.record.status, "blocked");
    assert.equal(queued.record.blocked_reason, "learning scope not allowed");
    assert.equal(queued.record.applied, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("queue does not apply learning", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-queue-no-apply-"));
  const recommendation = createRecommendation();

  try {
    setLearningEnabled(true);
    const decision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T22:26:00.000Z",
    }, { outputDirectory: tempRoot });
    await enqueueLearningApplication(recommendation, decision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-03T22:27:00.000Z",
    });

    assert.equal(getLearningApplicationState().parameter_value, 0);
    assert.equal(getLearningApplicationState().has_active_application, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("queue records are append-only and readable", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-queue-query-"));
  const recommendation = createRecommendation();

  try {
    const approvedDecision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-03T22:28:00.000Z",
    }, { outputDirectory: tempRoot });
    await enqueueLearningApplication(recommendation, approvedDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-03T22:29:00.000Z",
    });

    const rejectedDecision = await recordLearningRecommendationDecision(recommendation, {
      operator_decision: "rejected",
      decided_at: "2026-05-03T22:30:00.000Z",
    }, { outputDirectory: tempRoot });
    await enqueueLearningApplication(recommendation, rejectedDecision.record, {
      outputDirectory: tempRoot,
      createdAt: "2026-05-03T22:31:00.000Z",
    });

    const items = await queryLearningApplicationQueue({ outputDirectory: tempRoot });
    const queuedOnly = await queryLearningApplicationQueue({ outputDirectory: tempRoot, status: "queued" });
    const rendered = renderLearningApplicationQueue(items);

    assert.equal(items.length, 2);
    assert.equal(queuedOnly.length, 1);
    assert.match(rendered, /Learning application queue is non-executing/);
    assert.match(rendered, /queued:/);
    assert.match(rendered, /blocked:/);
    assert.match(rendered, /Queued items remain unapplied until an explicit learning application gate call/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});