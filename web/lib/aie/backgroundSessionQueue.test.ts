import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomousWorkSession, type AutonomousWorkSession } from "./autonomousWorkSession";
import {
  buildQueueRunReport,
  createBackgroundSessionQueue,
  enqueueBackgroundSession,
  evaluateQueuedSession,
  runBackgroundSessionQueue,
  summarizeBackgroundQueue,
} from "./backgroundSessionQueue";

function createSession(
  goal: string,
  requestedSteps: Array<{
    title: string;
    requiredGate: "controlled_validation" | "commit_approval" | "push_approval";
    commitAllowed?: boolean;
    pushAllowed?: boolean;
  }>,
): AutonomousWorkSession {
  return createAutonomousWorkSession({
    operatorGoal: goal,
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
    sessionApprovalGrantedAt: "2026-04-25T10:00:00.000Z",
    sessionApprovalExpiresAt: "2026-04-25T14:00:00.000Z",
    maxCycles: 8,
    chainInput: {
      maxSteps: requestedSteps.length,
      requestedSteps: requestedSteps.map((step) => ({
        title: step.title,
        plannerReadyRequest: step.title,
        requiredGate: step.requiredGate,
        validationRequired: true,
        commitAllowed: step.commitAllowed ?? false,
        pushAllowed: step.pushAllowed ?? false,
        stopOnFailure: true,
      })),
    },
  });
}

function createQueue() {
  return createBackgroundSessionQueue({
    max_sessions_per_run: 2,
    max_cycles_per_session: 2,
    skip_blocked_sessions: false,
    stop_on_first_failure: false,
    operator_away_mode: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
}

test("creates queue", () => {
  const queue = createQueue();

  assert.match(queue.queue_id, /^background-session-queue-/);
  assert.equal(queue.sessions.length, 0);
  assert.equal(queue.policy.max_sessions_per_run, 2);
});

test("enqueues sessions deterministically", () => {
  const queue = createQueue();
  const first = createSession("BABYLON grenade polish", [
    { title: "Complete BABYLON grenade polish", requiredGate: "controlled_validation" },
  ]);
  const second = createSession("AI-E docs cleanup", [
    { title: "Complete AI-E docs cleanup", requiredGate: "controlled_validation" },
  ]);

  const withFirst = enqueueBackgroundSession(queue, first);
  const withSecond = enqueueBackgroundSession(withFirst, second);

  assert.equal(withSecond.sessions[0].order, 1);
  assert.equal(withSecond.sessions[1].order, 2);
  assert.equal(withSecond.sessions[0].operator_goal, "BABYLON grenade polish");
  assert.equal(withSecond.sessions[1].operator_goal, "AI-E docs cleanup");
});

test("processes eligible sessions", () => {
  const queue = enqueueBackgroundSession(
    enqueueBackgroundSession(createQueue(), createSession("BABYLON grenade polish", [
      { title: "Complete BABYLON grenade polish", requiredGate: "controlled_validation" },
    ])),
    createSession("Enemy AI follow-up", [
      { title: "Complete Enemy AI follow-up", requiredGate: "controlled_validation" },
    ]),
  );

  const result = runBackgroundSessionQueue(queue);

  assert.equal(result.status, "queue_completed");
  assert.equal(result.sessions_run, 2);
  assert.equal(result.sessions_completed, 2);
});

test("uses multi-goal priority ordering before queue execution", () => {
  let queue = createBackgroundSessionQueue({
    max_sessions_per_run: 1,
    max_cycles_per_session: 2,
    skip_blocked_sessions: false,
    stop_on_first_failure: false,
    operator_away_mode: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  queue = enqueueBackgroundSession(queue, createSession("Low priority cleanup", [
    { title: "Complete low priority cleanup", requiredGate: "controlled_validation" },
  ]), { priority: "low" });
  queue = enqueueBackgroundSession(queue, createSession("High priority blocker", [
    { title: "Complete high priority blocker", requiredGate: "controlled_validation" },
  ]), { priority: "high" });

  const result = runBackgroundSessionQueue(queue);

  assert.equal(result.goal_schedule.status, "goal_selected");
  assert.equal(result.goal_schedule.selected_goal?.description, "High priority blocker");
  assert.equal(result.run_results[0]?.session.operator_goal, "High priority blocker");
});

test("background queue respects dependency-aware ordering", () => {
  let queue = createBackgroundSessionQueue({
    max_sessions_per_run: 1,
    max_cycles_per_session: 2,
    skip_blocked_sessions: false,
    stop_on_first_failure: false,
    operator_away_mode: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  queue = enqueueBackgroundSession(queue, createSession("Playtest grenade feature", [
    { title: "Playtest grenade feature", requiredGate: "controlled_validation" },
  ]), { priority: "high", dependency_goal_ids: ["autonomous-work-session-20260425100000-fix-kbm-input"] });
  queue = enqueueBackgroundSession(queue, createSession("Fix KBM input", [
    { title: "Fix KBM input", requiredGate: "controlled_validation" },
  ]), { priority: "medium" });

  const result = runBackgroundSessionQueue(queue);

  assert.equal(result.goal_schedule.selected_goal?.description, "Fix KBM input");
  assert.equal(result.goal_schedule.dependency_blockers.length, 1);
  assert.equal(result.run_results[0]?.session.operator_goal, "Fix KBM input");
});

test("respects max_sessions_per_run", () => {
  let queue = createBackgroundSessionQueue({
    max_sessions_per_run: 1,
    max_cycles_per_session: 2,
    skip_blocked_sessions: false,
    stop_on_first_failure: false,
    operator_away_mode: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  queue = enqueueBackgroundSession(queue, createSession("BABYLON grenade polish", [
    { title: "Complete BABYLON grenade polish", requiredGate: "controlled_validation" },
  ]));
  queue = enqueueBackgroundSession(queue, createSession("AI-E docs cleanup", [
    { title: "Complete AI-E docs cleanup", requiredGate: "controlled_validation" },
  ]));

  const result = runBackgroundSessionQueue(queue);

  assert.equal(result.status, "queue_running");
  assert.equal(result.sessions_run, 1);
  assert.equal(result.queue.sessions[1].status, "queued");
});

test("skips blocked sessions when configured", () => {
  let queue = createBackgroundSessionQueue({
    max_sessions_per_run: 2,
    max_cycles_per_session: 2,
    skip_blocked_sessions: true,
    stop_on_first_failure: false,
    operator_away_mode: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  const blockedSession = createSession("BABYLON grenade polish", [
    { title: "Inspect BABYLON grenade polish", requiredGate: "controlled_validation" },
  ]);
  const staleBlocked = {
    ...blockedSession,
    latest_persistence_record: {
      ...blockedSession.latest_persistence_record,
      context_snapshot: {
        ...blockedSession.latest_persistence_record.context_snapshot,
        chain_updated_at: "2026-04-24T10:00:00.000Z",
        validation_completed_at: "2026-04-24T10:00:00.000Z",
        stale_after_ms: 60_000,
      },
    },
  };
  queue = enqueueBackgroundSession(queue, staleBlocked);
  queue = enqueueBackgroundSession(queue, createSession("AI-E docs cleanup", [
    { title: "Complete AI-E docs cleanup", requiredGate: "controlled_validation" },
  ]));

  const result = runBackgroundSessionQueue(queue);

  assert.equal(result.status, "queue_completed");
  assert.equal(result.sessions_skipped, 1);
  assert.equal(result.queue.sessions[0].status, "skipped");
  assert.equal(result.queue.sessions[1].status, "completed");
});

test("stops on first failure when configured", () => {
  let queue = createBackgroundSessionQueue({
    max_sessions_per_run: 2,
    max_cycles_per_session: 2,
    skip_blocked_sessions: false,
    stop_on_first_failure: true,
    operator_away_mode: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  const pausedSession = createSession("BABYLON grenade polish", [
    { title: "Inspect BABYLON grenade polish", requiredGate: "controlled_validation" },
  ]);
  const missingApproval = {
    ...pausedSession,
    approval_state: {
      ...pausedSession.approval_state,
      session_approval_granted: false,
      session_approved_at: null,
    },
  };
  queue = enqueueBackgroundSession(queue, missingApproval);
  queue = enqueueBackgroundSession(queue, createSession("AI-E docs cleanup", [
    { title: "Complete AI-E docs cleanup", requiredGate: "controlled_validation" },
  ]));

  const result = runBackgroundSessionQueue(queue);

  assert.equal(result.status, "queue_paused");
  assert.equal(result.sessions_run, 0);
  assert.equal(result.queue.sessions[1].status, "queued");
});

test("calls scheduler result shape", () => {
  const queue = enqueueBackgroundSession(createQueue(), createSession("BABYLON grenade polish", [
    { title: "Complete BABYLON grenade polish", requiredGate: "controlled_validation" },
  ]));

  const evaluated = evaluateQueuedSession(queue, queue.sessions[0]);
  const result = runBackgroundSessionQueue(queue);

  assert.equal(evaluated.status, "eligible");
  assert.match(result.run_results[0].report.report_id, /^background-run-report-/);
});

test("produces readable queue report", () => {
  const queue = enqueueBackgroundSession(createQueue(), createSession("BABYLON grenade polish", [
    { title: "Complete BABYLON grenade polish", requiredGate: "controlled_validation" },
  ]));

  const result = runBackgroundSessionQueue(queue);
  const report = buildQueueRunReport(result);
  const summary = summarizeBackgroundQueue(result);

  assert.match(report.report_id, /^background-queue-report-/);
  assert.match(summary, /Background queue status:/);
  assert.match(summary, /Goal orchestration status:/);
  assert.match(summary, /Dependency blockers:/);
  assert.match(summary, /Sessions completed:/);
});

test("deterministic output", () => {
  const queue = enqueueBackgroundSession(
    enqueueBackgroundSession(createQueue(), createSession("BABYLON grenade polish", [
      { title: "Complete BABYLON grenade polish", requiredGate: "controlled_validation" },
    ])),
    createSession("AI-E docs cleanup", [
      { title: "Complete AI-E docs cleanup", requiredGate: "controlled_validation" },
    ]),
  );

  const first = runBackgroundSessionQueue(queue);
  const second = runBackgroundSessionQueue(queue);

  assert.equal(first.status, second.status);
  assert.deepEqual(first.report, second.report);
  assert.deepEqual(first.queue.sessions.map((session) => session.status), second.queue.sessions.map((session) => session.status));
});

test("no side effects", () => {
  const originalSession = createSession("BABYLON grenade polish", [
    { title: "Complete BABYLON grenade polish", requiredGate: "controlled_validation" },
  ]);
  const queue = enqueueBackgroundSession(createQueue(), originalSession);
  const originalQueueCount = queue.sessions.length;
  const originalSessionCycles = originalSession.cycle_history.length;

  const result = runBackgroundSessionQueue(queue);

  assert.equal(queue.sessions.length, originalQueueCount);
  assert.equal(originalSession.cycle_history.length, originalSessionCycles);
  assert.notEqual(result.queue, queue);
});