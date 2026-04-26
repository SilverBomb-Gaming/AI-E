import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomousWorkSession } from "./autonomousWorkSession";
import { buildRuntimeResult } from "./sessionRuntime";
import {
  buildRecoveryReport,
  classifyFailure,
  evaluateRecoveryDecision,
  isRetrySafe,
  requiresOperatorReview,
  summarizeRecoveryReport,
} from "./failureRecoveryIntelligence";

test("classifies validation failure", () => {
  const classification = classifyFailure({
    source: "controlled_validation",
    status: "validation_failed",
    created_at: "2026-04-26T10:00:00.000Z",
    validation_status: "validation_failed",
    message: "Controlled execution validation failed.",
    failures: [{ code: "content_mismatch", message: "File content differed from preview." }],
  });

  assert.equal(classification.category, "validation_failure");
});

test("classifies test failure", () => {
  const classification = classifyFailure({
    source: "session_runtime",
    status: "runtime_paused",
    created_at: "2026-04-26T10:00:00.000Z",
    message: "Pytest failed: expected READY banner.",
  });

  assert.equal(classification.category, "test_failure");
});

test("classifies stale approval", () => {
  const classification = classifyFailure({
    source: "background_runtime",
    status: "run_blocked",
    created_at: "2026-04-26T10:00:00.000Z",
    blockers: [{ code: "session_approval_stale", message: "Session approval is stale and must be renewed." }],
  });

  assert.equal(classification.category, "stale_approval");
});

test("classifies dependency blocker", () => {
  const classification = classifyFailure({
    source: "background_queue",
    status: "run_skipped",
    created_at: "2026-04-26T10:00:00.000Z",
    blockers: [{ code: "dependency_blocked", message: "Blocked by incomplete dependencies." }],
  });

  assert.equal(classification.category, "dependency_blocked");
});

test("classifies conflict blocker", () => {
  const classification = classifyFailure({
    source: "background_queue",
    status: "run_skipped",
    created_at: "2026-04-26T10:00:00.000Z",
    blockers: [{ code: "conflict_blocked", message: "Conflicts with active goal." }],
  });

  assert.equal(classification.category, "conflict_blocked");
});

test("classifies rollback recommendation", () => {
  const classification = classifyFailure({
    source: "work_session",
    status: "session_paused",
    created_at: "2026-04-26T10:00:00.000Z",
    validation_recommendation: "rollback",
    blockers: [{ code: "rollback_recommended", message: "Latest validation recommends rollback." }],
  });

  assert.equal(classification.category, "rollback_recommended");
});

test("classifies unknown failure as review-required", () => {
  const decision = evaluateRecoveryDecision({
    source: "runtime_loop",
    status: "loop_paused",
    created_at: "2026-04-26T10:00:00.000Z",
    message: "Unexpected issue occurred during bounded run.",
  });

  assert.equal(decision.category, "unknown");
  assert.equal(decision.recommendation, "request_operator_review");
  assert.equal(requiresOperatorReview(decision), true);
});

test("recommends retry only for low-risk retryable failures", () => {
  const decision = evaluateRecoveryDecision({
    source: "runtime_loop",
    status: "runtime_paused",
    created_at: "2026-04-26T10:00:00.000Z",
    message: "Process timed out with ETIMEDOUT.",
  });

  assert.equal(decision.category, "execution_error");
  assert.equal(decision.recommendation, "retry_once");
  assert.equal(isRetrySafe(decision), true);
});

test("recommends rollback for rollback-required failure", () => {
  const decision = evaluateRecoveryDecision({
    source: "controlled_validation",
    status: "validation_failed",
    created_at: "2026-04-26T10:00:00.000Z",
    validation_status: "validation_failed",
    validation_recommendation: "rollback",
    failures: [{ code: "content_mismatch", message: "Actual file content diverged from preview." }],
  });

  assert.equal(decision.recommendation, "rollback");
});

test("preserves original blocker details", () => {
  const decision = evaluateRecoveryDecision({
    source: "background_runtime",
    status: "run_blocked",
    created_at: "2026-04-26T10:00:00.000Z",
    blockers: [{ code: "context_stale", message: "Context snapshot is stale.", severity: "block" }],
  });

  assert.equal(decision.blockers.length, 1);
  assert.equal(decision.blockers[0]?.code, "context_stale");
});

test("produces readable recovery summary", () => {
  const report = buildRecoveryReport({
    source: "controlled_validation",
    status: "validation_failed",
    created_at: "2026-04-26T10:00:00.000Z",
    validation_status: "validation_failed",
    failures: [{ code: "missing_file", message: "Expected output file is missing.", file_path: "web/output.txt" }],
  });
  const summary = summarizeRecoveryReport(report);

  assert.match(summary, /Failure category:/);
  assert.match(summary, /Recommendation:/);
});

test("integrates with runtime blocked result shape", () => {
  const session = createAutonomousWorkSession({
    operatorGoal: "Validate runtime recovery reporting.",
    createdAt: "2026-04-26T10:00:00.000Z",
    sessionApproval: true,
    chainInput: {
      maxSteps: 1,
      requestedSteps: [{
        title: "Validate runtime recovery reporting",
        plannerReadyRequest: "Validate runtime recovery reporting",
        requiredGate: "controlled_validation",
        validationRequired: true,
        commitAllowed: false,
        pushAllowed: false,
        stopOnFailure: true,
      }],
    },
  });
  const blockedSession = {
    ...session,
    latest_persistence_record: {
      ...session.latest_persistence_record,
      validation_snapshot: {
        ...session.latest_persistence_record.validation_snapshot,
        status: "validation_failed" as const,
        recommendation: "review_required" as const,
      },
    },
  };

  const result = buildRuntimeResult(blockedSession);

  assert.equal(result.status, "runtime_paused");
  assert.equal(result.recovery_report?.decision.category, "validation_failure");
});