import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomousWorkSession } from "./autonomousWorkSession";
import {
  createBackgroundSessionQueue,
  enqueueBackgroundSession,
  runBackgroundSessionQueue,
} from "./backgroundSessionQueue";
import {
  appendBackgroundRunRecord,
  buildOperatorAwayDigest,
  createBackgroundRunHistory,
  summarizeOperatorAwayDigest,
} from "./backgroundRunHistory";

function createSession(goal: string, stepTitle = goal) {
  return createAutonomousWorkSession({
    operatorGoal: goal,
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
    sessionApprovalGrantedAt: "2026-04-25T10:00:00.000Z",
    sessionApprovalExpiresAt: "2026-04-25T14:00:00.000Z",
    maxCycles: 8,
    chainInput: {
      maxSteps: 1,
      requestedSteps: [{
        title: stepTitle,
        plannerReadyRequest: stepTitle,
        requiredGate: "controlled_validation",
        validationRequired: true,
        commitAllowed: false,
        pushAllowed: false,
        stopOnFailure: true,
      }],
    },
  });
}

function createQueueResult(options?: {
  skipBlockedSessions?: boolean;
  stopOnFirstFailure?: boolean;
  firstSessionMutator?: (session: ReturnType<typeof createSession>) => ReturnType<typeof createSession>;
  secondSessionMutator?: (session: ReturnType<typeof createSession>) => ReturnType<typeof createSession>;
  thirdSessionMutator?: (session: ReturnType<typeof createSession>) => ReturnType<typeof createSession>;
}) {
  let queue = createBackgroundSessionQueue({
    max_sessions_per_run: 3,
    max_cycles_per_session: 2,
    skip_blocked_sessions: options?.skipBlockedSessions === true,
    stop_on_first_failure: options?.stopOnFirstFailure === true,
    operator_away_mode: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });

  const first = options?.firstSessionMutator?.(createSession("BABYLON grenade polish", "Complete BABYLON grenade polish"))
    ?? createSession("BABYLON grenade polish", "Complete BABYLON grenade polish");
  const second = options?.secondSessionMutator?.(createSession("AI-E docs cleanup", "Complete AI-E docs cleanup"))
    ?? createSession("AI-E docs cleanup", "Complete AI-E docs cleanup");
  const third = options?.thirdSessionMutator?.(createSession("Enemy AI follow-up", "Complete Enemy AI follow-up"))
    ?? createSession("Enemy AI follow-up", "Complete Enemy AI follow-up");

  queue = enqueueBackgroundSession(queue, first);
  queue = enqueueBackgroundSession(queue, second);
  queue = enqueueBackgroundSession(queue, third);

  return runBackgroundSessionQueue(queue);
}

test("creates empty history", () => {
  const history = createBackgroundRunHistory();

  assert.equal(history.records.length, 0);
  assert.equal(history.history_id, "background-run-history");
});

test("appends queue run record", () => {
  const history = createBackgroundRunHistory();
  const queueResult = createQueueResult();

  const updated = appendBackgroundRunRecord(history, queueResult);

  assert.equal(updated.records.length, 1);
  assert.equal(updated.records[0].queue_report_id, queueResult.report.report_id);
});

test("digest_empty for no records", () => {
  const digest = buildOperatorAwayDigest(createBackgroundRunHistory());

  assert.equal(digest.overall_status, "digest_empty");
  assert.equal(digest.total_runs, 0);
});

test("digest_ready for completed runs", () => {
  const history = appendBackgroundRunRecord(createBackgroundRunHistory(), createQueueResult());

  const digest = buildOperatorAwayDigest(history);

  assert.equal(digest.overall_status, "digest_ready");
  assert.equal(digest.total_sessions_completed, 3);
});

test("digest_needs_attention when approvals are needed", () => {
  const queueResult = createQueueResult({
    stopOnFirstFailure: true,
    firstSessionMutator: (session) => ({
      ...session,
      approval_state: {
        ...session.approval_state,
        session_approval_granted: false,
        session_approved_at: null,
      },
    }),
  });
  const history = appendBackgroundRunRecord(createBackgroundRunHistory(), queueResult);

  const digest = buildOperatorAwayDigest(history);

  assert.equal(digest.overall_status, "digest_needs_attention");
  assert.deepEqual(digest.approvals_needed, ["session"]);
});

test("digest_needs_attention when blockers exist", () => {
  const queueResult = createQueueResult({
    skipBlockedSessions: true,
    firstSessionMutator: (session) => ({
      ...session,
      latest_persistence_record: {
        ...session.latest_persistence_record,
        context_snapshot: {
          ...session.latest_persistence_record.context_snapshot,
          chain_updated_at: "2026-04-24T10:00:00.000Z",
          validation_completed_at: "2026-04-24T10:00:00.000Z",
          stale_after_ms: 60_000,
        },
      },
    }),
  });
  const history = appendBackgroundRunRecord(createBackgroundRunHistory(), queueResult);

  const digest = buildOperatorAwayDigest(history);

  assert.equal(digest.overall_status, "digest_needs_attention");
  assert.ok(digest.blocked_work_summary.items.some((item) => item.includes("BABYLON grenade polish")));
});

test("summarizes completed paused skipped blocked sessions", () => {
  const firstResult = createQueueResult({
    stopOnFirstFailure: true,
    firstSessionMutator: (session) => ({
      ...session,
      approval_state: {
        ...session.approval_state,
        session_approval_granted: false,
        session_approved_at: null,
      },
    }),
  });
  const secondResult = createQueueResult({
    skipBlockedSessions: true,
    firstSessionMutator: (session) => ({
      ...session,
      latest_persistence_record: {
        ...session.latest_persistence_record,
        context_snapshot: {
          ...session.latest_persistence_record.context_snapshot,
          chain_updated_at: "2026-04-24T10:00:00.000Z",
          validation_completed_at: "2026-04-24T10:00:00.000Z",
          stale_after_ms: 60_000,
        },
      },
    }),
  });
  const history = appendBackgroundRunRecord(
    appendBackgroundRunRecord(createBackgroundRunHistory(), firstResult),
    secondResult,
  );

  const digest = buildOperatorAwayDigest(history);

  assert.ok(digest.completed_work_summary.items.length >= 2);
  assert.ok(digest.paused_work_summary.items.some((item) => item.includes("BABYLON grenade polish")));
  assert.ok(digest.blocked_work_summary.items.some((item) => item.includes("BABYLON grenade polish")));
});

test("deterministic output", () => {
  const queueResult = createQueueResult();
  const history = appendBackgroundRunRecord(createBackgroundRunHistory(), queueResult);

  const first = buildOperatorAwayDigest(history);
  const second = buildOperatorAwayDigest(history);

  assert.deepEqual(first, second);
});

test("integrates with backgroundSessionQueue result shape", () => {
  const queueResult = createQueueResult();
  const history = appendBackgroundRunRecord(createBackgroundRunHistory(), queueResult);

  assert.equal(history.records[0].sessions_completed, queueResult.sessions_completed);
  assert.equal(history.records[0].queue_status, queueResult.status);
});

test("readable summary", () => {
  const history = appendBackgroundRunRecord(createBackgroundRunHistory(), createQueueResult());
  const digest = buildOperatorAwayDigest(history);
  const summary = summarizeOperatorAwayDigest(digest);

  assert.match(summary, /Operator-away digest status:/);
  assert.match(summary, /Total sessions completed:/);
  assert.match(summary, /Recommended actions:/);
});