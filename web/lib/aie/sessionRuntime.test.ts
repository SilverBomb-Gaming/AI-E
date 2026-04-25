import assert from "node:assert/strict";
import test from "node:test";

import {
  createAutonomousWorkSession,
  pauseWorkSession,
  type AutonomousWorkSession,
} from "./autonomousWorkSession";
import {
  buildRuntimeResult,
  evaluateRuntimeState,
  runSessionCycle,
  summarizeRuntime,
} from "./sessionRuntime";

function createSafeSession(overrides?: Partial<Parameters<typeof createAutonomousWorkSession>[0]>): AutonomousWorkSession {
  return createAutonomousWorkSession({
    operatorGoal: "Stabilize the OpenClaw runtime lane.",
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
    maxCycles: 4,
    chainInput: {
      maxSteps: 2,
      requestedSteps: [
        {
          title: "Inspect the runtime lane state",
          plannerReadyRequest: "Inspect the runtime lane state",
          requiredGate: "controlled_validation",
          validationRequired: true,
          commitAllowed: false,
          pushAllowed: false,
          stopOnFailure: true,
        },
        {
          title: "Confirm the runtime lane remains stable",
          plannerReadyRequest: "Confirm the runtime lane remains stable",
          requiredGate: "controlled_validation",
          validationRequired: true,
          commitAllowed: false,
          pushAllowed: false,
          stopOnFailure: true,
        },
      ],
    },
    ...overrides,
  });
}

test("runs one safe cycle", () => {
  const session = createSafeSession();

  const result = runSessionCycle(session);

  assert.equal(result.status, "runtime_running");
  assert.equal(result.session.cycle_history.length, 1);
  assert.equal(result.session.active_chain.current_step_index, 1);
  assert.equal(result.session.orchestration_memory.completed_steps.length, 1);
});

test("pauses when approval required", () => {
  const session = createAutonomousWorkSession({
    operatorGoal: "Prepare an approval-gated runtime lane change.",
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
    chainInput: {
      maxSteps: 1,
      requestedSteps: [{
        title: "Prepare an approval-gated runtime lane change",
        plannerReadyRequest: "Prepare an approval-gated runtime lane change",
        requiredGate: "commit_approval",
        validationRequired: true,
        commitAllowed: true,
        pushAllowed: false,
        stopOnFailure: true,
      }],
    },
  });

  const result = runSessionCycle(session);

  assert.equal(result.status, "runtime_paused");
  assert.match(result.session.session_report.pause_reason ?? "", /approval/i);
});

test("pauses on validation failure", () => {
  const session = createSafeSession();
  const failed = {
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

  const result = runSessionCycle(failed);

  assert.equal(result.status, "runtime_paused");
  assert.match(result.state.reason, /validation/i);
});

test("resumes correctly after checkpoint", () => {
  const session = createSafeSession();
  const paused = pauseWorkSession(session, "Paused after a safe checkpoint.", "2026-04-25T10:15:00.000Z");

  const result = runSessionCycle(paused);

  assert.equal(result.status, "runtime_running");
  assert.equal(result.session.cycle_history.length, 1);
  assert.equal(result.session.current_cycle?.status, "cycle_completed");
});

test("completes when goal is reached", () => {
  const session = createAutonomousWorkSession({
    operatorGoal: "Complete the OpenClaw runtime lane stabilization.",
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
    chainInput: {
      maxSteps: 1,
      requestedSteps: [{
        title: "Complete the OpenClaw runtime lane stabilization",
        plannerReadyRequest: "Complete the OpenClaw runtime lane stabilization",
        requiredGate: "controlled_validation",
        validationRequired: true,
        commitAllowed: false,
        pushAllowed: false,
        stopOnFailure: true,
      }],
    },
  });

  const result = runSessionCycle(session);

  assert.equal(result.status, "runtime_completed");
  assert.equal(result.session.status, "session_completed");
  assert.equal(result.session.goal_state.status, "completed");
});

test("does not loop infinitely", () => {
  const session = createSafeSession();

  const result = runSessionCycle(session);

  assert.equal(result.session.cycle_history.length, 1);
  assert.equal(result.session.active_chain.current_step_index, 1);
});

test("deterministic behavior", () => {
  const session = createSafeSession();

  const first = runSessionCycle(session);
  const second = runSessionCycle(session);

  assert.equal(first.status, second.status);
  assert.equal(first.state.reason, second.state.reason);
  assert.equal(first.cycle?.summary, second.cycle?.summary);
  assert.deepEqual(first.session.cycle_history, second.session.cycle_history);
});

test("integrates with session manager", () => {
  const session = createSafeSession();

  const result = runSessionCycle(session);
  const runtimeState = evaluateRuntimeState(result.session);

  assert.equal(result.session.status, "session_running");
  assert.equal(runtimeState.status, "runtime_ready");
  assert.match(result.session.session_report.summary, /session_running/);
});

test("summary readable", () => {
  const session = createSafeSession();
  const result = buildRuntimeResult(runSessionCycle(session).session);
  const summary = summarizeRuntime(result);

  assert.match(summary, /Runtime status:/);
  assert.match(summary, /Runtime state:/);
  assert.match(summary, /Session summary:/);
});

test("no side effects", () => {
  const session = createSafeSession();
  const originalStatus = session.status;
  const originalCycleCount = session.cycle_history.length;

  const result = runSessionCycle(session);

  assert.equal(session.status, originalStatus);
  assert.equal(session.cycle_history.length, originalCycleCount);
  assert.notEqual(result.session, session);
});