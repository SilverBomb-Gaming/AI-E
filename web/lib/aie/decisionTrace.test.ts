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
import {
  buildDecisionRecord,
  queryDecisionRecords,
  recordDecisionTrace,
  renderDecisionReplay,
  serializeDecisionRecord,
  validateDecisionRecord,
} from "./decisionTrace";
import { generateExecutionInsights } from "./executionInsight";
import type { ExecutionOutcomeRecord } from "./executionOutcome";

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
    outcome_id: "OUT-0000002001",
    created_at: "2026-05-02T22:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-layer22-step3",
    task_id: "node-task-layer22-step3",
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

function createSelectedPlan() {
  const insights = generateExecutionInsights([createExecutionOutcomeRecord()]);
  const annotated = attachInsightsToPlan(createNodeTaskPlan(), insights);
  const alternative = annotated.annotations?.find((annotation) => annotation.type === "plan_adjustment")?.alternative_plan;

  assert.ok(alternative?.plan_id);

  return selectOperatorPlan(annotated, alternative.plan_id);
}

test("decision record validation accepts an explicit plan selection record", () => {
  const selected = createSelectedPlan();
  const record = buildDecisionRecord(selected, "2026-05-02T22:05:00.000Z");
  const validation = validateDecisionRecord(record);

  assert.equal(validation.ok, true);
  assert.equal(validation.record?.selected_plan_id, selected.selected_plan_id);
  assert.ok((validation.record?.available_plan_ids.length ?? 0) >= 2);
  assert.ok((validation.record?.insight_summary.length ?? 0) >= 1);
  assert.ok(((validation.record?.severity_summary.high ?? 0) + (validation.record?.severity_summary.critical ?? 0)) >= 1);
});

test("decision record serialization is stable and machine-readable", () => {
  const record = buildDecisionRecord(createSelectedPlan(), "2026-05-02T22:05:00.000Z");
  const first = serializeDecisionRecord(record);
  const second = serializeDecisionRecord(record);

  assert.equal(first, second);
  const parsed = JSON.parse(first) as Record<string, unknown>;
  assert.equal(parsed.selected_plan_id, record.selected_plan_id);
});

test("decision trace recorder is append-only and does not trigger execution or approvals", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-decision-records-"));

  try {
    const selected = createSelectedPlan();
    const first = await recordDecisionTrace(buildDecisionRecord(selected, "2026-05-02T22:05:00.000Z"), { outputDirectory: tempRoot });
    const second = await recordDecisionTrace(buildDecisionRecord(selected, "2026-05-02T22:06:00.000Z"), { outputDirectory: tempRoot });

    assert.equal(first.status, "recorded");
    assert.equal(first.append_only, true);
    assert.equal(first.execution_triggered, false);
    assert.equal(first.approval_triggered, false);
    assert.equal(second.autonomy_triggered, false);

    const written = await readFile(first.output_path, "utf-8");
    const lines = written.trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
    assert.equal((JSON.parse(lines[0]) as Record<string, unknown>).timestamp, "2026-05-02T22:05:00.000Z");
    assert.equal((JSON.parse(lines[1]) as Record<string, unknown>).timestamp, "2026-05-02T22:06:00.000Z");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("recording a decision does not change translation behavior", () => {
  const selected = createSelectedPlan();
  const before = translatePlanToNodeTask(selected);

  buildDecisionRecord(selected, "2026-05-02T22:05:00.000Z");

  const after = translatePlanToNodeTask(selected);
  assert.deepEqual(after, before);
  assert.equal(after.execution_triggered, false);
});

test("building a decision record does not mutate the selected plan", () => {
  const selected = createSelectedPlan();
  const before = JSON.stringify(selected);

  const record = buildDecisionRecord(selected, "2026-05-02T22:05:00.000Z");

  assert.equal(JSON.stringify(selected), before);
  assert.equal(record.operator_acknowledgement.acknowledged, false);
  assert.equal(record.selected_plan_id, selected.selected_plan_id);
});

test("queryDecisionRecords returns matching records without affecting stored decision state", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-decision-query-"));

  try {
    const selected = createSelectedPlan();
    const firstRecord = buildDecisionRecord(selected, "2026-05-02T22:05:00.000Z");
    const secondRecord = buildDecisionRecord(selected, "2026-05-02T22:06:00.000Z");

    await recordDecisionTrace(firstRecord, { outputDirectory: tempRoot });
    await recordDecisionTrace(secondRecord, { outputDirectory: tempRoot });

    const queried = await queryDecisionRecords({
      outputDirectory: tempRoot,
      selected_plan_id: selected.selected_plan_id,
      acknowledged: false,
      minimum_severity: "high",
      limit: 1,
    });

    assert.equal(queried.length, 1);
    assert.equal(queried[0]?.selected_plan_id, selected.selected_plan_id);
    assert.ok((queried[0]?.decision_context?.available_plans.length ?? 0) >= 2);

    const written = await readFile(path.join(tempRoot, "2026-05-02.jsonl"), "utf-8");
    assert.equal(written.trim().split(/\r?\n/).length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("renderDecisionReplay shows the stored decision context in read-only form", () => {
  const record = buildDecisionRecord(createSelectedPlan(), "2026-05-02T22:05:00.000Z");
  const before = JSON.stringify(record);

  const replay = renderDecisionReplay(record);

  assert.equal(JSON.stringify(record), before);
  assert.match(replay, /Decision replay:/);
  assert.match(replay, /Original plan:/);
  assert.match(replay, /Available alternatives:/);
  assert.match(replay, /Insights at decision time:/);
  assert.match(replay, /Selected plan:/);
  assert.match(replay, /Acknowledged: no/);
  assert.match(replay, /Read-only replay only/);
});