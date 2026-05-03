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
import { buildLearningApplicationAttemptRecord, recordLearningApplicationAttempt, renderLearningApplicationAttempt } from "./learningApplicationAudit";
import { attemptApplyLearningRecommendation } from "./learningApplicationGate";
import { recordLearningRecommendationDecision } from "./learningRecommendationDecision";
import { generateLearningRecommendations, type LearningRecommendation } from "./learningRecommendationReview";
import { buildPassiveLearningAudit } from "./passiveLearningAudit";
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
    outcome_id: "OUT-0000003601",
    created_at: "2026-05-03T19:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer26-step4",
    task_id: "node-task-layer26-step4",
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
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T19:05:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, alternative.plan_id), "2026-05-03T19:06:00.000Z"),
    buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T19:07:00.000Z"),
  ];
  const signals = computeLearningSignals(records, "2026-05-03T19:10:00.000Z");
  const audit = buildPassiveLearningAudit({
    signals,
    simulations: simulateRankingAdjustments(signals, annotated.plan_rankings ?? []),
    source_decision_record_count: records.length,
    createdAt: "2026-05-03T19:15:00.000Z",
  });
  const recommendation = generateLearningRecommendations(audit)[0];

  assert.ok(recommendation);
  return recommendation;
}

async function createBlockedAttemptResult(operatorDecision: "approved_for_future_application" | "rejected") {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `aie-learning-app-audit-${operatorDecision}-`));
  const decisionOutputDirectory = path.join(tempRoot, "decisions");
  const recommendation = createRecommendation();

  const decision = await recordLearningRecommendationDecision(recommendation, {
    operator_decision: operatorDecision,
    decided_at: operatorDecision === "approved_for_future_application"
      ? "2026-05-03T19:20:00.000Z"
      : "2026-05-03T19:21:00.000Z",
  }, { outputDirectory: decisionOutputDirectory });
  const result = attemptApplyLearningRecommendation(recommendation, decision.record);

  return { tempRoot, result };
}

test("blocked application result creates attempt record", async () => {
  const { tempRoot, result } = await createBlockedAttemptResult("approved_for_future_application");

  try {
    const record = buildLearningApplicationAttemptRecord(result, { createdAt: "2026-05-03T19:30:00.000Z" });

    assert.match(record.attempt_id, /^learning-application-attempt-/);
    assert.equal(record.attempted_application, true);
    assert.equal(record.blocked_reason, "learning application disabled");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("record includes recommendation id decision id and source audit id", async () => {
  const { tempRoot, result } = await createBlockedAttemptResult("approved_for_future_application");

  try {
    const record = buildLearningApplicationAttemptRecord(result, { createdAt: "2026-05-03T19:31:00.000Z" });

    assert.equal(record.recommendation_id, result.recommendation_id);
    assert.equal(record.decision_id, result.decision_id);
    assert.equal(record.source_audit_id, result.source_audit_id);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("record keeps gate disabled applied false and blocked reason", async () => {
  const { tempRoot, result } = await createBlockedAttemptResult("rejected");

  try {
    const record = buildLearningApplicationAttemptRecord(result, { createdAt: "2026-05-03T19:32:00.000Z" });

    assert.equal(record.gate_enabled, false);
    assert.equal(record.applied, false);
    assert.equal(record.blocked_reason, "learning application disabled");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("building and recording does not mutate the blocked result", async () => {
  const { tempRoot, result } = await createBlockedAttemptResult("approved_for_future_application");
  const before = JSON.stringify(result);

  try {
    const record = buildLearningApplicationAttemptRecord(result, { createdAt: "2026-05-03T19:33:00.000Z" });
    await recordLearningApplicationAttempt(record, { outputDirectory: tempRoot });

    assert.equal(JSON.stringify(result), before);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("recording is append only", async () => {
  const { tempRoot, result } = await createBlockedAttemptResult("approved_for_future_application");

  try {
    const first = buildLearningApplicationAttemptRecord(result, { createdAt: "2026-05-03T19:34:00.000Z" });
    const second = buildLearningApplicationAttemptRecord(result, { createdAt: "2026-05-03T19:35:00.000Z" });
    const writeResult = await recordLearningApplicationAttempt(first, { outputDirectory: tempRoot });
    await recordLearningApplicationAttempt(second, { outputDirectory: tempRoot });
    const payload = await readFile(writeResult.output_path, "utf-8");

    assert.equal(payload.trim().split(/\r?\n/).length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("rendering says application was blocked", async () => {
  const { tempRoot, result } = await createBlockedAttemptResult("rejected");

  try {
    const record = buildLearningApplicationAttemptRecord(result, { createdAt: "2026-05-03T19:36:00.000Z" });
    const rendered = renderLearningApplicationAttempt(record);

    assert.match(rendered, /Learning application attempt:/);
    assert.match(rendered, /Gate enabled: false/);
    assert.match(rendered, /Applied: false/);
    assert.match(rendered, /Blocked reason: learning application disabled/);
    assert.match(rendered, /Application was blocked\./);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});