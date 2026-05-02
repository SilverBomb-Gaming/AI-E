import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionOutcomeRecord } from "./executionOutcome";
import {
  analyzeExecutionOutcomes,
  generateExecutionInsights,
  summarizeExecutionInsights,
} from "./executionInsight";

function createExecutionOutcomeRecord(overrides: Partial<ExecutionOutcomeRecord> = {}): ExecutionOutcomeRecord {
  return {
    outcome_id: "OUT-0000000001",
    created_at: "2026-05-02T18:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer20-step3",
    task_id: "node-task-layer20-step3",
    plan_id: "layer20-step3",
    node_id: "validator-node-01",
    target_node_id: "validator-node-01",
    command: "python validate_runtime.py",
    status: "completed",
    success: true,
    risk_level: "low",
    approval_path: ["operator_confirm_submit", "node_intake_review", "node_worker_execution"],
    execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control",
    evidence_labels: [
      "NODE RESULT CAPTURED",
      "EXECUTION OUTCOME RECORDED",
      "LEARNING SUBSTRATE APPEND ONLY",
      "NO AUTONOMY TRIGGERED",
    ],
    result_summary: "[OK] bounded validation complete",
    rollback_required: false,
    rollback_executed: false,
    recovery_status: "not_required",
    ...overrides,
  };
}

function createInsightFixture(): ExecutionOutcomeRecord[] {
  return [
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000000001",
      created_at: "2026-05-02T18:00:00.000Z",
      node_id: "validator-node-01",
      target_node_id: "validator-node-01",
      command: "python validate_runtime.py",
      risk_level: "low",
      success: true,
      status: "completed",
    }),
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000000002",
      created_at: "2026-05-02T18:05:00.000Z",
      node_id: "validator-node-01",
      target_node_id: "validator-node-01",
      command: "python validate_runtime.py",
      risk_level: "low",
      success: true,
      status: "completed",
    }),
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000000003",
      created_at: "2026-05-02T18:10:00.000Z",
      node_id: "validator-node-01",
      target_node_id: "validator-node-01",
      command: "python validate_runtime.py",
      risk_level: "medium",
      success: true,
      status: "completed",
    }),
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000000004",
      created_at: "2026-05-02T18:15:00.000Z",
      node_id: "validator-node-02",
      target_node_id: "validator-node-02",
      command: "pytest tests/test_node_draft_integration.py",
      risk_level: "high",
      success: false,
      status: "failed",
      rollback_required: true,
      rollback_executed: true,
      error_summary: "integration regression failure",
      result_summary: "integration regression failure",
      recovery_status: "executed",
    }),
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000000005",
      created_at: "2026-05-02T18:20:00.000Z",
      node_id: "validator-node-02",
      target_node_id: "validator-node-02",
      command: "pytest tests/test_node_draft_integration.py",
      risk_level: "high",
      success: false,
      status: "blocked",
      rollback_required: true,
      rollback_executed: false,
      error_summary: "operator blocked run",
      result_summary: "operator blocked run",
      recovery_status: "planned",
    }),
  ];
}

test("execution insights are generated from computed outcome analytics", () => {
  const outcomes = createInsightFixture();
  const analytics = analyzeExecutionOutcomes(outcomes);
  const insights = generateExecutionInsights(outcomes);

  assert.equal(analytics.total_outcomes, 5);
  assert.deepEqual(analytics.node_performance[0], {
    node_id: "validator-node-01",
    total: 3,
    success_count: 3,
    failure_count: 0,
    success_rate: 1,
  });
  assert.deepEqual(analytics.command_performance.find((entry) => entry.command_pattern === "pytest"), {
    command_pattern: "pytest",
    total: 2,
    success_count: 0,
    failure_count: 2,
    success_rate: 0,
    failure_rate: 1,
  });
  assert.deepEqual(analytics.risk_correlation.find((entry) => entry.risk_level === "high"), {
    risk_level: "high",
    total: 2,
    success_count: 0,
    failure_count: 2,
    success_rate: 0,
    failure_rate: 1,
    rollback_required_rate: 1,
  });
  assert.equal(insights.length, 4);
  assert.match(insights[0]?.description ?? "", /Node validator-node-01 handled 3 tasks with a 100% success rate/i);
});

test("execution insights reflect command, rollback, and risk metrics consistently", () => {
  const outcomes = createInsightFixture();
  const insights = generateExecutionInsights(outcomes);

  const patternInsight = insights.find((entry) => entry.category === "pattern");
  const rollbackInsight = insights.find((entry) => entry.insight_id.includes("rollback-frequency-high"));
  const riskInsight = insights.find((entry) => entry.insight_id.includes("risk-correlation-high-low"));

  assert.ok(patternInsight);
  assert.equal(patternInsight?.supporting_metrics.failure_rate, 1);
  assert.equal(patternInsight?.supporting_metrics.comparison_failure_rate, 0);
  assert.equal(patternInsight?.supporting_metrics.failure_rate_delta, 1);
  assert.match(patternInsight?.description ?? "", /pytest fail 100 percentage points more often than python:validate_runtime.py/i);

  assert.ok(rollbackInsight);
  assert.equal(rollbackInsight?.supporting_metrics.rollback_required_rate, 1);
  assert.match(rollbackInsight?.description ?? "", /Rollback was required in 100% of high-risk tasks/i);

  assert.ok(riskInsight);
  assert.equal(riskInsight?.supporting_metrics.highest_failure_rate, 1);
  assert.equal(riskInsight?.supporting_metrics.lowest_failure_rate, 0);
  assert.equal(riskInsight?.supporting_metrics.failure_rate_delta, 1);
});

test("execution insight confidence values stay bounded and summaries remain read-only", () => {
  const outcomes = createInsightFixture();
  const before = JSON.parse(JSON.stringify(outcomes)) as ExecutionOutcomeRecord[];

  const insights = generateExecutionInsights(outcomes);
  const summary = summarizeExecutionInsights(insights);

  assert.equal(JSON.stringify(outcomes), JSON.stringify(before));
  assert.ok(insights.every((entry) => entry.confidence >= 0 && entry.confidence <= 1));
  assert.match(summary, /PERFORMANCE:/);
  assert.match(summary, /PATTERN:/);
  assert.doesNotMatch(summary, /execute|approval triggered|retry/i);
});

test("execution insight generation on empty data stays inert", () => {
  const insights = generateExecutionInsights([]);
  const summary = summarizeExecutionInsights(insights);

  assert.deepEqual(insights, []);
  assert.equal(summary, "No execution insights available.");
});