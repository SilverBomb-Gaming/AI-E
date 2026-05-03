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
import { generateExecutionInsights } from "./executionInsight";
import type { ExecutionOutcomeRecord } from "./executionOutcome";
import { buildPassiveLearningAudit, recordPassiveLearningAudit, renderPassiveLearningAudit } from "./passiveLearningAudit";
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
    outcome_id: "OUT-0000003201",
    created_at: "2026-05-03T15:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer25-step4",
    task_id: "node-task-layer25-step4",
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

function createAuditFixture() {
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const recommendedAlternative = annotated.annotations?.find((annotation) => annotation.type === "plan_adjustment")?.alternative_plan;

  assert.ok(recommendedAlternative?.plan_id);

  const aligned = buildDecisionRecord(selectOperatorPlan(annotated, recommendedAlternative.plan_id), "2026-05-03T15:05:00.000Z");
  const mismatch = buildDecisionRecord(selectOperatorPlan(annotated, annotated.plan_id), "2026-05-03T15:06:00.000Z");
  const signals = computeLearningSignals([aligned, mismatch], "2026-05-03T15:10:00.000Z");
  const simulations = simulateRankingAdjustments(signals, annotated.plan_rankings ?? []);

  return {
    annotated,
    signals,
    simulations,
    sourceDecisionRecordCount: 2,
  };
}

test("buildPassiveLearningAudit preserves signal and simulation snapshots with stable checksum", () => {
  const fixture = createAuditFixture();
  const beforeSignals = JSON.stringify(fixture.signals);
  const beforeSimulations = JSON.stringify(fixture.simulations);

  const first = buildPassiveLearningAudit({
    signals: fixture.signals,
    simulations: fixture.simulations,
    source_decision_record_count: fixture.sourceDecisionRecordCount,
    createdAt: "2026-05-03T15:15:00.000Z",
  });
  const second = buildPassiveLearningAudit({
    signals: fixture.signals,
    simulations: fixture.simulations,
    source_decision_record_count: fixture.sourceDecisionRecordCount,
    createdAt: "2026-05-03T15:15:00.000Z",
  });

  assert.equal(JSON.stringify(fixture.signals), beforeSignals);
  assert.equal(JSON.stringify(fixture.simulations), beforeSimulations);
  assert.deepEqual(first.signal_snapshot, fixture.signals);
  assert.deepEqual(first.simulation_snapshot, fixture.simulations);
  assert.equal(first.checksum, second.checksum);
  assert.equal(first.frozen, true);
  assert.equal(first.applied, false);
});

test("recordPassiveLearningAudit is append-only and does not change planning or execution behavior", async () => {
  const fixture = createAuditFixture();
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-learning-audit-"));
  const selectedPlan = selectOperatorPlan(fixture.annotated, fixture.annotated.plan_id);

  try {
    const before = translatePlanToNodeTask(selectedPlan);
    const audit = buildPassiveLearningAudit({
      signals: fixture.signals,
      simulations: fixture.simulations,
      source_decision_record_count: fixture.sourceDecisionRecordCount,
      createdAt: "2026-05-03T15:16:00.000Z",
    });
    const first = await recordPassiveLearningAudit(audit, { outputDirectory: tempRoot });
    const second = await recordPassiveLearningAudit(audit, { outputDirectory: tempRoot });
    const after = translatePlanToNodeTask(selectedPlan);

    assert.equal(first.status, "recorded");
    assert.equal(first.append_only, true);
    assert.equal(first.frozen, true);
    assert.equal(first.applied, false);
    assert.equal(first.execution_triggered, false);
    assert.equal(first.autonomy_triggered, false);
    assert.deepEqual(after, before);
    assert.equal(after.execution_triggered, false);

    const payload = await readFile(first.output_path, "utf-8");
    assert.equal(payload.trim().split(/\r?\n/).length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("renderPassiveLearningAudit shows frozen audit metadata and snapshot summaries", () => {
  const fixture = createAuditFixture();
  const audit = buildPassiveLearningAudit({
    signals: fixture.signals,
    simulations: fixture.simulations,
    source_decision_record_count: fixture.sourceDecisionRecordCount,
    createdAt: "2026-05-03T15:17:00.000Z",
  });

  const rendered = renderPassiveLearningAudit(audit);

  assert.match(rendered, /Passive learning audit:/);
  assert.match(rendered, /Created at: 2026-05-03T15:17:00.000Z/);
  assert.match(rendered, /Source decision record count: 2/);
  assert.match(rendered, /Checksum:/);
  assert.match(rendered, /Frozen: true/);
  assert.match(rendered, /Applied: false/);
  assert.match(rendered, /Signal snapshot:/);
  assert.match(rendered, /Simulation snapshot:/);
  assert.match(rendered, /Frozen audit only\./);
});