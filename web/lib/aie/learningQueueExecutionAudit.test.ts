import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
import {
  buildLearningQueueExecutionRecord,
  recordLearningQueueExecution,
  renderLearningQueueExecution,
} from "./learningQueueExecutionAudit";
import {
  enqueueLearningApplication,
  executeQueuedLearningItem,
  type LearningApplicationQueueExecutionResult,
} from "./learningApplicationQueue";
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
    outcome_id: "OUT-0000004001",
    created_at: "2026-05-03T23:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer28-step3",
    task_id: "node-task-layer28-step3",
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
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T23:05:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, alternative.plan_id), "2026-05-03T23:06:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T23:07:00.000Z"),
  ];
  const signals = computeLearningSignals(records, "2026-05-03T23:10:00.000Z");
  const audit = buildPassiveLearningAudit({
    signals,
    simulations: simulateRankingAdjustments(signals, annotated.plan_rankings ?? []),
    source_decision_record_count: records.length,
    createdAt: "2026-05-03T23:15:00.000Z",
  });
  const recommendation = generateLearningRecommendations(audit)[0];

  assert.ok(recommendation);
  return recommendation;
}

async function createAppliedExecutionResult(): Promise<{ tempRoot: string; result: LearningApplicationQueueExecutionResult }> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-queue-execution-audit-applied-"));
  const recommendation = createRecommendation();

  setLearningEnabled(true);
  const decision = await recordLearningRecommendationDecision(recommendation, {
    operator_decision: "approved_for_future_application",
    decided_at: "2026-05-03T23:20:00.000Z",
  }, { outputDirectory: tempRoot });
  const queued = await enqueueLearningApplication(recommendation, decision.record, {
    outputDirectory: tempRoot,
    createdAt: "2026-05-03T23:21:00.000Z",
  });
  const result = await executeQueuedLearningItem(queued.record.queue_id, {
    outputDirectory: tempRoot,
    executedAt: "2026-05-03T23:22:00.000Z",
  });

  return { tempRoot, result };
}

async function createBlockedExecutionResult(): Promise<{ tempRoot: string; result: LearningApplicationQueueExecutionResult }> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-queue-execution-audit-blocked-"));
  const recommendation = createRecommendation();

  const decision = await recordLearningRecommendationDecision(recommendation, {
    operator_decision: "approved_for_future_application",
    decided_at: "2026-05-03T23:23:00.000Z",
  }, { outputDirectory: tempRoot });
  const queued = await enqueueLearningApplication(recommendation, decision.record, {
    outputDirectory: tempRoot,
    createdAt: "2026-05-03T23:24:00.000Z",
  });
  const result = await executeQueuedLearningItem(queued.record.queue_id, {
    outputDirectory: tempRoot,
    executedAt: "2026-05-03T23:25:00.000Z",
  });

  return { tempRoot, result };
}

test("applied queue execution produces audit record", async () => {
  const { tempRoot, result } = await createAppliedExecutionResult();

  try {
    const record = buildLearningQueueExecutionRecord(result);

    assert.equal(record.attempted_status, "applied");
    assert.equal(record.applied, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("blocked queue execution produces audit record", async () => {
  const { tempRoot, result } = await createBlockedExecutionResult();

  try {
    const record = buildLearningQueueExecutionRecord(result);

    assert.equal(record.attempted_status, "blocked");
    assert.equal(record.applied, false);
    assert.equal(record.blocked_reason, "learning disabled globally");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("record includes queue id recommendation id and decision id", async () => {
  const { tempRoot, result } = await createAppliedExecutionResult();

  try {
    const record = buildLearningQueueExecutionRecord(result);

    assert.equal(record.queue_id, result.queue_id);
    assert.equal(record.recommendation_id, result.recommendation_id);
    assert.equal(record.decision_id, result.decision_id);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("single_item_execution is true", async () => {
  const { tempRoot, result } = await createAppliedExecutionResult();

  try {
    const record = buildLearningQueueExecutionRecord(result);

    assert.equal(record.single_item_execution, true);
    assert.match(renderLearningQueueExecution(record), /Single item execution: true/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("append-only recording works", async () => {
  const { tempRoot, result } = await createAppliedExecutionResult();
  const auditOutputDirectory = path.join(tempRoot, "audits");

  try {
    const first = buildLearningQueueExecutionRecord(result, { createdAt: "2026-05-03T23:26:00.000Z" });
    const second = buildLearningQueueExecutionRecord(result, { createdAt: "2026-05-03T23:27:00.000Z" });
    const writeResult = await recordLearningQueueExecution(first, { outputDirectory: auditOutputDirectory });
    await recordLearningQueueExecution(second, { outputDirectory: auditOutputDirectory });
    const payload = await readFile(writeResult.output_path, "utf-8");

    assert.equal(payload.trim().split(/\r?\n/).length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("input result is not mutated", async () => {
  const { tempRoot, result } = await createBlockedExecutionResult();
  const before = JSON.stringify(result);

  try {
    const record = buildLearningQueueExecutionRecord(result);
    await recordLearningQueueExecution(record, { outputDirectory: tempRoot });

    assert.equal(JSON.stringify(result), before);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});