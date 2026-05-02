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
  buildExecutionReadinessReview,
  renderExecutionReadinessReview,
} from "./executionReadinessReview";

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
    outcome_id: "OUT-0000003001",
    created_at: "2026-05-02T23:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer23-step1",
    task_id: "node-task-layer23-step1",
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

function createAnnotatedPlan() {
  return attachInsightsToPlan(
    createNodeTaskPlan(),
    generateExecutionInsights([createExecutionOutcomeRecord()]),
  );
}

test("blocks readiness when alternatives exist but no selection is recorded", () => {
  const plan = createAnnotatedPlan();

  const review = buildExecutionReadinessReview(plan, {
    require_acknowledgement: true,
    require_decision_record: true,
  });

  assert.equal(review.readiness_status, "blocked_missing_selection");
  assert.equal(review.selected_plan_id, null);
  assert.match(review.required_operator_actions.join("\n"), /Select the original plan or one suggested alternative/);
});

test("blocks readiness when acknowledgement is required and missing", () => {
  const plan = selectOperatorPlan(createAnnotatedPlan(), createAnnotatedPlan().plan_id);

  const review = buildExecutionReadinessReview(plan, {
    require_acknowledgement: true,
    require_decision_record: false,
  });

  assert.equal(review.readiness_status, "blocked_missing_acknowledgement");
  assert.equal(review.acknowledgement_status, "missing");
});

test("blocks readiness when a decision record is required and missing", () => {
  const annotated = createAnnotatedPlan();
  const selected = selectOperatorPlan(annotated, annotated.plan_id);
  const acknowledged = acknowledgePlanInsights(selected, "2026-05-02T23:05:00.000Z");

  const review = buildExecutionReadinessReview(acknowledged, {
    require_acknowledgement: true,
    require_decision_record: true,
  });

  assert.equal(review.readiness_status, "blocked_missing_decision_record");
  assert.equal(review.decision_record_status, "missing");
});

test("blocks readiness when execution confirmation is required and missing", () => {
  const annotated = createAnnotatedPlan();
  const selected = selectOperatorPlan(annotated, annotated.plan_id);
  const acknowledged = acknowledgePlanInsights(selected, "2026-05-02T23:05:00.000Z");
  const decisionRecord = buildDecisionRecord(acknowledged, "2026-05-02T23:06:00.000Z");

  const review = buildExecutionReadinessReview(acknowledged, {
    decisionRecord,
    require_acknowledgement: true,
    require_decision_record: true,
    require_confirmation: true,
  });

  assert.equal(review.readiness_status, "blocked_missing_confirmation");
  assert.equal(review.confirmation_status, "missing");
  assert.match(review.required_operator_actions.join("\n"), /Confirm execution submission\? \(yes\/no\)/);
});

test("readiness is ready only when selection, acknowledgement, decision record, and confirmation exist", () => {
  const annotated = createAnnotatedPlan();
  const alternative = annotated.annotations?.find((annotation) => annotation.type === "plan_adjustment")?.alternative_plan;
  assert.ok(alternative?.plan_id);
  const selected = selectOperatorPlan(annotated, alternative.plan_id);
  const acknowledged = acknowledgePlanInsights(selected, "2026-05-02T23:05:00.000Z");
  const decisionRecord = buildDecisionRecord(acknowledged, "2026-05-02T23:06:00.000Z");
  const confirmed = confirmExecutionSubmission(acknowledged, "2026-05-02T23:07:00.000Z");

  const review = buildExecutionReadinessReview(confirmed, {
    decisionRecord,
    require_acknowledgement: true,
    require_decision_record: true,
    require_confirmation: true,
  });

  assert.equal(review.readiness_status, "ready_for_operator_submission");
  assert.equal(review.selected_plan_id, alternative.plan_id);
  assert.equal(review.acknowledgement_status, "acknowledged");
  assert.equal(review.decision_record_status, "recorded");
  assert.equal(review.confirmation_status, "confirmed");
  assert.equal(review.highest_severity === "high" || review.highest_severity === "critical", true);
  assert.deepEqual(review.required_operator_actions, []);
});

test("confirmExecutionSubmission records timestamp without mutating the source plan", () => {
  const annotated = createAnnotatedPlan();
  const selected = selectOperatorPlan(annotated, annotated.plan_id);
  const acknowledged = acknowledgePlanInsights(selected, "2026-05-02T23:05:00.000Z");

  const confirmed = confirmExecutionSubmission(acknowledged, "2026-05-02T23:07:00.000Z");

  assert.equal(acknowledged.execution_confirmation?.confirmed, undefined);
  assert.equal(confirmed.execution_confirmation.confirmed, true);
  assert.equal(confirmed.execution_confirmation.confirmed_at, "2026-05-02T23:07:00.000Z");
  assert.equal("submitted_to_node" in (confirmed as Record<string, unknown>), false);
  assert.equal("execution_triggered" in (confirmed as Record<string, unknown>), false);
});

test("render output includes required missing actions and remains read-only", () => {
  const review = buildExecutionReadinessReview(createAnnotatedPlan(), {
    require_acknowledgement: true,
    require_decision_record: true,
    require_confirmation: true,
  });

  const rendered = renderExecutionReadinessReview(review);

  assert.match(rendered, /Execution readiness review:/);
  assert.match(rendered, /blocked_missing_selection/);
  assert.match(rendered, /Required operator actions:/);
  assert.match(rendered, /Select the original plan or one suggested alternative/);
  assert.match(rendered, /Read-only review only/);
});

test("review output contains no execution or submission trigger flags", () => {
  const review = buildExecutionReadinessReview(createAnnotatedPlan(), {
    require_acknowledgement: true,
    require_decision_record: true,
    require_confirmation: true,
  }) as Record<string, unknown>;

  assert.equal("execution_triggered" in review, false);
  assert.equal("submitted_to_node" in review, false);
  assert.equal("node_intake_triggered" in review, false);
  assert.equal("approval_triggered" in review, false);
});