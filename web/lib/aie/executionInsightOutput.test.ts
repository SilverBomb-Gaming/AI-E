import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionOutcomeRecord } from "./executionOutcome";
import { generateExecutionInsights } from "./executionInsight";
import { renderExecutionInsights } from "./executionInsightOutput";

function createExecutionOutcomeRecord(overrides: Partial<ExecutionOutcomeRecord> = {}): ExecutionOutcomeRecord {
  return {
    outcome_id: "OUT-0000000001",
    created_at: "2026-05-02T18:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer20-step4",
    task_id: "node-task-layer20-step4",
    plan_id: "layer20-step4",
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
      risk_level: "medium",
      success: true,
      status: "completed",
    }),
    createExecutionOutcomeRecord({
      outcome_id: "OUT-0000000003",
      created_at: "2026-05-02T18:10:00.000Z",
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
  ];
}

test("execution insights render into readable operator-facing categories", () => {
  const insights = generateExecutionInsights(createInsightFixture());
  const rendered = renderExecutionInsights(insights);

  assert.match(rendered.console_output, /AI-E Execution Insights/);
  assert.match(rendered.console_output, /Node Reliability Summary/);
  assert.match(rendered.console_output, /Failure Pattern Summary/);
  assert.match(rendered.console_output, /Rollback Frequency Summary/);
  assert.match(rendered.console_output, /Risk-Level Insights/);
  assert.match(rendered.console_output, /\[(LOW|MEDIUM|HIGH|CRITICAL)\]/);
  assert.match(rendered.console_output, /Confidence:/);
  assert.match(rendered.console_output, /Readable Summary/);
});

test("execution insight rendering stays display-only and does not mutate insights", () => {
  const insights = generateExecutionInsights(createInsightFixture());
  const before = JSON.stringify(insights);

  const rendered = renderExecutionInsights(insights);

  assert.equal(JSON.stringify(insights), before);
  assert.equal(rendered.display_only, true);
  assert.equal(rendered.execution_triggered, false);
  assert.equal(rendered.approval_triggered, false);
  assert.equal(rendered.autonomy_triggered, false);
  assert.doesNotMatch(rendered.console_output, /trigger execution|approve automatically|retry automatically/i);
});

test("execution insight rendering handles empty inputs without side effects", () => {
  const rendered = renderExecutionInsights([]);

  assert.match(rendered.console_output, /No execution insights available/);
  assert.equal(rendered.summary, "No execution insights available.");
  assert.equal(rendered.execution_triggered, false);
});