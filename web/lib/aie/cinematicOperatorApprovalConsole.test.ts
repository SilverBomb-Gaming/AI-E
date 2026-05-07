import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureCinematicProductionMemoryInitialized,
  planCinematicGenerationJobs,
  planCinematicSequence,
  readCinematicProductionMemory,
} from "./cinematicProductionMemory";
import {
  approveCinematicOperatorConsoleJobs,
  archiveCinematicOperatorFailedPlan,
  deferCinematicOperatorExecution,
  readCinematicOperatorApprovalConsole,
  recordCinematicOperatorBudgetDecision,
  recordCinematicOperatorContinuityReview,
  rejectCinematicOperatorConsoleJobs,
  requestCinematicOperatorRetryPlan,
} from "./cinematicOperatorApprovalConsole";

test("operator approval console governs queued cinematic jobs with append-only audit integrity", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-operator-console-"));

  try {
    await ensureCinematicProductionMemoryInitialized(tempRoot);
    const sequence = await planCinematicSequence({
      root: tempRoot,
      sequenceId: "sequence-operator-console-001",
      title: "Operator Console Sequence",
    });
    const planned = await planCinematicGenerationJobs({
      root: tempRoot,
      sequenceId: sequence.sequence.sequence_id,
      routingMode: "premium-cinematic-provider",
    });
    const jobIds = planned.jobs.map((entry) => entry.job_id);

    const initialConsole = await readCinematicOperatorApprovalConsole({
      root: tempRoot,
      sequenceId: sequence.sequence.sequence_id,
    });
    const approval = await approveCinematicOperatorConsoleJobs({
      root: tempRoot,
      operatorId: "operator-fred",
      jobIds,
    });
    const rejected = await rejectCinematicOperatorConsoleJobs({
      root: tempRoot,
      operatorId: "operator-fred",
      jobIds: [jobIds[0]!],
      reason: "Need a different composition before execution review.",
    });
    const retryRequested = await requestCinematicOperatorRetryPlan({
      root: tempRoot,
      operatorId: "operator-fred",
      jobIds: [jobIds[1]!],
      reason: "Retry with a tighter escalation insert.",
    });
    const deferred = await deferCinematicOperatorExecution({
      root: tempRoot,
      operatorId: "operator-fred",
      jobIds: [jobIds[2]!],
      reason: "Wait for the next budget review.",
      deferredUntil: "2026-05-08T12:00:00.000Z",
    });
    const archived = await archiveCinematicOperatorFailedPlan({
      root: tempRoot,
      operatorId: "operator-fred",
      jobIds: [jobIds[3]!],
      reason: "Archiving the failed insert plan until the environment pass is refreshed.",
    });
    const budgetDecision = await recordCinematicOperatorBudgetDecision({
      root: tempRoot,
      operatorId: "operator-fred",
      sequenceId: sequence.sequence.sequence_id,
      provider: "Sora",
      requestedBudgetCap: 320,
      approvedOverride: false,
      reason: "No premium override until the gameplay cut reads better.",
    });
    const continuityNote = await recordCinematicOperatorContinuityReview({
      root: tempRoot,
      operatorId: "operator-fred",
      sequenceId: sequence.sequence.sequence_id,
      shotId: sequence.sequence.shots[0]?.shot_id,
      detail: "Keep the reveal shot aligned with the existing wave-countdown geography.",
    });
    const finalConsole = await readCinematicOperatorApprovalConsole({
      root: tempRoot,
      sequenceId: sequence.sequence.sequence_id,
      approvalTokenId: approval.token?.token_id ?? undefined,
    });
    const record = await readCinematicProductionMemory({ root: tempRoot });

    assert.ok(initialConsole.queue.length > 0);
    assert.ok(initialConsole.review_views.continuity_graph.some((entry) => /->/i.test(entry)));
    assert.equal(approval.persisted, true);
    assert.ok(approval.token);
    assert.equal(rejected.jobs[0]?.manual_approval_status, "rejected");
    assert.equal(retryRequested.jobs[0]?.manual_approval_status, "retry-requested");
    assert.equal(deferred.jobs[0]?.manual_approval_status, "deferred");
    assert.equal(archived.jobs[0]?.manual_approval_status, "archived");
    assert.equal(budgetDecision.persisted, true);
    assert.equal(continuityNote.persisted, true);
    assert.ok(finalConsole.queue.some((entry) => entry.manual_approval_status === "approved"));
    assert.ok(finalConsole.queue.some((entry) => entry.manual_approval_status === "rejected"));
    assert.ok(finalConsole.queue.some((entry) => entry.manual_approval_status === "deferred"));
    assert.ok(finalConsole.deferred_plan_preview.some((entry) => /Wait for the next budget review/i.test(entry)));
    assert.ok(finalConsole.audit_trail_preview.some((entry) => /approve-job/i.test(entry)));
    assert.equal(finalConsole.readiness?.approval_token_valid, true);
    assert.equal(finalConsole.readiness?.ready_for_real_execution, false);
    assert.ok(finalConsole.readiness?.checks.some((entry) => entry.check === "budget-available" && /Sandbox-only mode/i.test(entry.detail)));
    assert.equal(record.execution_approval_tokens.length, 1);
    assert.ok(record.budget_governance_decisions.length >= 1);
    assert.ok(record.continuity_review_notes.length >= 1);
    assert.ok(record.deferred_execution_plans.length >= 1);
    assert.ok(record.approval_audit_trail.length >= 6);
    assert.deepEqual(
      [...record.approval_audit_trail].map((entry) => entry.append_only_index),
      [...record.approval_audit_trail].map((_, index) => index + 1),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});