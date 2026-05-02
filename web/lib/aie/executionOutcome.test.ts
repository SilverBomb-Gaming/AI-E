import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  recordExecutionOutcome,
  serializeExecutionOutcomeRecord,
  validateExecutionOutcomeRecord,
  type ExecutionOutcomeRecord,
} from "./executionOutcome";

function createExecutionOutcomeRecord(overrides: Partial<ExecutionOutcomeRecord> = {}): ExecutionOutcomeRecord {
  return {
    outcome_id: "OUT-0000000001",
    created_at: "2026-05-02T18:00:00.000Z",
    source_layer: "node",
    workflow_id: "workflow-live-step4",
    task_id: "node-task-live-step4",
    plan_id: "live-step4",
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
    result_summary: "[OK] AI-E runtime validation completed successfully.",
    rollback_required: false,
    rollback_executed: false,
    recovery_status: "not_required",
    ...overrides,
  };
}

test("execution outcome validation accepts a machine-readable record", () => {
  const validation = validateExecutionOutcomeRecord(createExecutionOutcomeRecord());

  assert.equal(validation.ok, true);
  assert.equal(validation.record?.task_id, "node-task-live-step4");
  assert.equal(validation.record?.success, true);
});

test("execution outcome serialization is stable and machine-readable", () => {
  const first = serializeExecutionOutcomeRecord(createExecutionOutcomeRecord());
  const second = serializeExecutionOutcomeRecord(createExecutionOutcomeRecord());

  assert.equal(first, second);
  const parsed = JSON.parse(first) as Record<string, unknown>;
  assert.equal(parsed.status, "completed");
  assert.equal(parsed.rollback_required, false);
});

test("execution outcome recorder is append-only and does not trigger tasks or approvals", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-execution-outcomes-"));

  try {
    const first = await recordExecutionOutcome(createExecutionOutcomeRecord(), { outputDirectory: tempRoot });
    const second = await recordExecutionOutcome(createExecutionOutcomeRecord({
      outcome_id: "OUT-0000000002",
      status: "failed",
      success: false,
      error_summary: "Validation task failed.",
      result_summary: "Validation task failed.",
    }), { outputDirectory: tempRoot });

    assert.equal(first.status, "recorded");
    assert.equal(first.append_only, true);
    assert.equal(first.execution_triggered, false);
    assert.equal(first.approval_triggered, false);
    assert.equal(second.autonomy_triggered, false);

    const written = await readFile(first.output_path, "utf-8");
    const lines = written.trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
    assert.equal((JSON.parse(lines[0]) as Record<string, unknown>).outcome_id, "OUT-0000000001");
    assert.equal((JSON.parse(lines[1]) as Record<string, unknown>).outcome_id, "OUT-0000000002");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});