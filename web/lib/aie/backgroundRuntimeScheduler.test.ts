import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomousWorkSession, type AutonomousWorkSession } from "./autonomousWorkSession";
import {
  buildBackgroundRunReport,
  createBackgroundRuntimeScheduler,
  evaluateBackgroundRunEligibility,
  runBackgroundRuntimeCycle,
  summarizeBackgroundRun,
} from "./backgroundRuntimeScheduler";

function createScheduler(overrides?: Partial<Parameters<typeof createBackgroundRuntimeScheduler>[0]>) {
  return createBackgroundRuntimeScheduler({
    max_cycles_per_run: 2,
    allow_when_approvals_pending: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
    stop_on_validation_failure: true,
    stop_on_rollback_recommendation: true,
    operator_away_mode: true,
    ...overrides,
  });
}

function createSession(
  requestedSteps: Array<{
    title: string;
    requiredGate: "controlled_validation" | "commit_approval" | "push_approval";
    commitAllowed?: boolean;
    pushAllowed?: boolean;
  }>,
  operatorGoal = "Complete the OpenClaw runtime lane stabilization.",
): AutonomousWorkSession {
  return createAutonomousWorkSession({
    operatorGoal,
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

test("eligible session starts background run", () => {
  const scheduler = createScheduler();
  const session = createSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ]);

  const eligibility = evaluateBackgroundRunEligibility(session, scheduler);
  const result = runBackgroundRuntimeCycle(session, scheduler);

  assert.equal(eligibility.status, "run_eligible");
  assert.equal(result.status, "run_completed");
  assert.equal(result.cycles_completed, 2);
});

test("scheduler respects max_cycles_per_run", () => {
  const scheduler = createScheduler({ max_cycles_per_run: 1 });
  const session = createSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    { title: "Refine the runtime lane metrics", requiredGate: "controlled_validation" },
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ], "Improve the runtime lane operations.");

  const result = runBackgroundRuntimeCycle(session, scheduler);

  assert.equal(result.status, "run_started");
  assert.equal(result.cycles_attempted, 1);
  assert.match(result.stop_reason, /max cycle limit/i);
});

test("pending approval pauses run", () => {
  const scheduler = createScheduler();
  const session = {
    ...createSession([
      { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    ]),
    approval_state: {
      ...createSession([
        { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
      ]).approval_state,
      session_approval_granted: false,
      session_approved_at: null,
      requires_session_reapproval: false,
    },
  };

  const result = runBackgroundRuntimeCycle(session, scheduler);

  assert.equal(result.status, "run_paused");
  assert.equal(result.cycles_attempted, 0);
  assert.match(result.stop_reason, /approval/i);
});

test("stale approval blocks run", () => {
  const scheduler = createScheduler();
  const session = {
    ...createSession([
      { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    ]),
    approval_state: {
      ...createSession([
        { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
      ]).approval_state,
      requires_session_reapproval: true,
      session_approval_expires_at: "2026-04-25T09:00:00.000Z",
    },
  };

  const result = runBackgroundRuntimeCycle(session, scheduler);

  assert.equal(result.status, "run_blocked");
  assert.equal(result.cycles_attempted, 0);
  assert.match(result.stop_reason, /stale/i);
});

test("stale context blocks run", () => {
  const scheduler = createScheduler();
  const session = createSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
  ]);
  const staleSession = {
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
  };

  const result = runBackgroundRuntimeCycle(staleSession, scheduler);

  assert.equal(result.status, "run_blocked");
  assert.match(result.stop_reason, /context/i);
});

test("validation failure pauses run", () => {
  const scheduler = createScheduler();
  const session = createSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
  ]);
  const failedSession = {
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

  const result = runBackgroundRuntimeCycle(failedSession, scheduler);

  assert.equal(result.status, "run_paused");
  assert.equal(result.cycles_attempted, 0);
  assert.match(result.stop_reason, /validation/i);
});

test("completed session returns run_completed", () => {
  const scheduler = createScheduler();
  const session = createSession([
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ]);
  const completed = runBackgroundRuntimeCycle(session, scheduler);
  const final = runBackgroundRuntimeCycle(completed.session, scheduler);

  assert.equal(final.status, "run_completed");
  assert.equal(final.cycles_attempted, 0);
});

test("run report is readable", () => {
  const scheduler = createScheduler();
  const session = createSession([
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ]);

  const result = runBackgroundRuntimeCycle(session, scheduler);
  const report = buildBackgroundRunReport({
    status: result.status,
    scheduler: result.scheduler,
    request: result.request,
    session: result.session,
    loop_state: result.loop_state,
    blockers: result.blockers,
    approvals_needed: result.approvals_needed,
    cycles_attempted: result.cycles_attempted,
    cycles_completed: result.cycles_completed,
    stop_reason: result.stop_reason,
    safe_to_continue_later: result.safe_to_continue_later,
    next_operator_action: result.next_operator_action,
    validation_summary: result.validation_summary,
  });
  const summary = summarizeBackgroundRun(result);

  assert.match(report.report_id, /^background-run-report-/);
  assert.match(summary, /Background run status:/);
  assert.match(summary, /Validation summary:/);
});

test("deterministic behavior", () => {
  const scheduler = createScheduler();
  const session = createSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ]);

  const first = runBackgroundRuntimeCycle(session, scheduler);
  const second = runBackgroundRuntimeCycle(session, scheduler);

  assert.equal(first.status, second.status);
  assert.deepEqual(first.report, second.report);
  assert.deepEqual(first.loop_state, second.loop_state);
});

test("does not bypass runtime loop controller", () => {
  const scheduler = createScheduler({ max_cycles_per_run: 1 });
  const session = createSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ]);

  const result = runBackgroundRuntimeCycle(session, scheduler);

  assert.equal(result.loop_state?.config.max_cycles, 1);
  assert.equal(result.loop_state?.executed_cycles, 1);
  assert.equal(result.loop_state?.cycle_results.length, 1);
});

test("operator_away_mode still respects safety gates", () => {
  const scheduler = createScheduler({ operator_away_mode: true });
  const session = {
    ...createSession([
      { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    ]),
    latest_persistence_record: {
      ...createSession([
        { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
      ]).latest_persistence_record,
      validation_snapshot: {
        ...createSession([
          { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
        ]).latest_persistence_record.validation_snapshot,
        recommendation: "rollback" as const,
      },
    },
  };

  const result = runBackgroundRuntimeCycle(session, scheduler);

  assert.equal(result.status, "run_paused");
  assert.match(result.stop_reason, /rollback/i);
});

test("no side effects beyond returned state", () => {
  const scheduler = createScheduler({ max_cycles_per_run: 1 });
  const session = createSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ]);
  const originalStatus = session.status;
  const originalCycles = session.cycle_history.length;

  const result = runBackgroundRuntimeCycle(session, scheduler);

  assert.equal(session.status, originalStatus);
  assert.equal(session.cycle_history.length, originalCycles);
  assert.notEqual(result.session, session);
});