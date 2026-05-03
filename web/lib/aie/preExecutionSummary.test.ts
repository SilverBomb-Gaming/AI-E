import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgePlanInsights,
  attachInsightsToPlan,
  confirmExecutionSubmission,
  selectOperatorPlan,
  type CoreNodePipelineDraftPlan,
} from "./nodeBoundary";
import { buildDecisionRecord } from "./decisionTrace";
import { generateExecutionInsights } from "./executionInsight";
import type { ExecutionOutcomeRecord } from "./executionOutcome";
import {
  buildPreExecutionSummary,
  renderPreExecutionSummary,
} from "./preExecutionSummary";
import { buildExecutionReadinessReview } from "./executionReadinessReview";

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
    outcome_id: "OUT-0000003002",
    created_at: "2026-05-02T23:10:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer23-step3",
    task_id: "node-task-layer23-step3",
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

function createConfirmedPlan() {
  const annotated = attachInsightsToPlan(
    createNodeTaskPlan(),
    generateExecutionInsights([createExecutionOutcomeRecord()]),
  );
  const alternative = annotated.annotations?.find((annotation) => annotation.type === "plan_adjustment")?.alternative_plan;
  assert.ok(alternative?.plan_id);
  const selected = selectOperatorPlan(annotated, alternative.plan_id);
  const acknowledged = acknowledgePlanInsights(selected, "2026-05-02T23:11:00.000Z");
  const decisionRecord = buildDecisionRecord(acknowledged, "2026-05-02T23:12:00.000Z");
  const confirmed = confirmExecutionSubmission(acknowledged, "2026-05-02T23:13:00.000Z");
  const readinessReview = buildExecutionReadinessReview(confirmed, {
    decisionRecord,
    require_acknowledgement: true,
    require_decision_record: true,
    require_confirmation: true,
  });

  return { confirmed, readinessReview };
}

test("summary includes the full final operator review fields", () => {
  const { confirmed, readinessReview } = createConfirmedPlan();

  const summary = buildPreExecutionSummary(confirmed, readinessReview);

  assert.equal(summary.selected_plan_summary, readinessReview.selected_plan_summary);
  assert.ok(Array.isArray(summary.alternative_summary));
  assert.ok(summary.alternative_summary.length >= 1);
  assert.ok(Array.isArray(summary.insight_summary));
  assert.ok(summary.insight_summary.length >= 1);
  assert.equal(typeof summary.severity_summary.low, "number");
  assert.equal(typeof summary.severity_summary.medium, "number");
  assert.equal(typeof summary.severity_summary.high, "number");
  assert.equal(typeof summary.severity_summary.critical, "number");
  assert.equal(summary.acknowledgement_status, "acknowledged");
  assert.equal(summary.decision_record_status, "recorded");
  assert.equal(summary.confirmation_status, "confirmed");
  assert.equal(summary.readiness_status, "ready_for_operator_submission");
});

test("summary matches the readiness state without adding execution behavior", () => {
  const { confirmed, readinessReview } = createConfirmedPlan();

  const summary = buildPreExecutionSummary(confirmed, readinessReview) as Record<string, unknown>;

  assert.equal(summary.readiness_status, readinessReview.readiness_status);
  assert.equal(summary.confirmation_status, readinessReview.confirmation_status);
  assert.equal(summary.acknowledgement_status, readinessReview.acknowledgement_status);
  assert.equal(summary.decision_record_status, readinessReview.decision_record_status);
  assert.equal("execution_triggered" in summary, false);
  assert.equal("submitted_to_node" in summary, false);
  assert.equal("node_intake_triggered" in summary, false);
});

test("rendered summary shows the final review context and remains read-only", () => {
  const { confirmed, readinessReview } = createConfirmedPlan();

  const rendered = renderPreExecutionSummary(buildPreExecutionSummary(confirmed, readinessReview));

  assert.match(rendered, /Pre-execution summary review:/);
  assert.match(rendered, /Selected plan:/);
  assert.match(rendered, /Readiness status: ready_for_operator_submission/);
  assert.match(rendered, /Confirmation status: confirmed/);
  assert.match(rendered, /Alternatives considered:/);
  assert.match(rendered, /Insight summary:/);
  assert.match(rendered, /Read-only review only/);
});