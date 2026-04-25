import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomousWorkSession, type AutonomousWorkSession } from "./autonomousWorkSession";
import {
  evaluateLoopState,
  runNextCycle,
  startRuntimeLoop,
  stopRuntimeLoop,
  summarizeLoop,
  type LoopControlConfig,
  type RuntimeLoopState,
} from "./runtimeLoopController";

function createLoopSession(
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

function startLoop(session: AutonomousWorkSession, config?: Partial<LoopControlConfig>): RuntimeLoopState {
  return startRuntimeLoop(session, {
    max_cycles: 6,
    continuous_operation: true,
    ...config,
  });
}

test("runs multiple cycles safely", () => {
  const session = createLoopSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ]);

  const loop = startLoop(session);

  assert.equal(loop.status, "loop_completed");
  assert.equal(loop.executed_cycles, 2);
  assert.equal(loop.cycle_results.length, 2);
  assert.equal(loop.session.status, "session_completed");
});

test("stops at approval boundary", () => {
  const session = createLoopSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    {
      title: "Prepare the approval-gated runtime lane change",
      requiredGate: "commit_approval",
      commitAllowed: true,
    },
  ], "Prepare the runtime lane update safely.");

  const loop = startLoop(session);

  assert.equal(loop.status, "loop_paused");
  assert.equal(loop.executed_cycles, 2);
  assert.equal(loop.latest_runtime_result?.status, "runtime_paused");
  assert.match(loop.reason, /approval/i);
});

test("stops at validation failure", () => {
  const session = createLoopSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
  ], "Inspect the runtime lane state.");
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

  const loop = startLoop(failedSession);

  assert.equal(loop.status, "loop_paused");
  assert.equal(loop.executed_cycles, 0);
  assert.equal(loop.latest_runtime_result, null);
  assert.match(loop.reason, /validation/i);
});

test("stops at completion", () => {
  const session = createLoopSession([
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ]);

  const loop = startLoop(session);

  assert.equal(loop.status, "loop_completed");
  assert.equal(loop.executed_cycles, 1);
  assert.equal(loop.session.goal_state.status, "completed");
});

test("respects max_cycles", () => {
  const session = createLoopSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    { title: "Refine the runtime lane metrics", requiredGate: "controlled_validation" },
    { title: "Review the runtime lane telemetry", requiredGate: "controlled_validation" },
    { title: "Stabilize the runtime lane follow-up", requiredGate: "controlled_validation" },
  ], "Improve the runtime lane operations.");

  const loop = startLoop(session, { max_cycles: 2 });

  assert.equal(loop.status, "loop_running");
  assert.equal(loop.executed_cycles, 2);
  assert.equal(loop.can_run_next_cycle, true);
  assert.match(loop.reason, /max cycle limit/i);
});

test("deterministic behavior", () => {
  const session = createLoopSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ]);

  const first = startLoop(session);
  const second = startLoop(session);

  assert.equal(first.status, second.status);
  assert.equal(first.reason, second.reason);
  assert.deepEqual(first.cycle_results, second.cycle_results);
  assert.deepEqual(first.result, second.result);
});

test("integrates with session runtime", () => {
  const session = createLoopSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ]);

  const loop = startLoop(session, { max_cycles: 1 });
  const next = runNextCycle(loop);
  const evaluated = evaluateLoopState(next);

  assert.equal(loop.latest_runtime_result?.status, "runtime_running");
  assert.equal(next.status, "loop_completed");
  assert.equal(evaluated.status, "loop_completed");
});

test("summary readable", () => {
  const session = createLoopSession([
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ]);

  const loop = startLoop(session);
  const summary = summarizeLoop(loop);

  assert.match(summary, /Loop status:/);
  assert.match(summary, /Executed cycles:/);
  assert.match(summary, /Latest runtime status:/);
});

test("no infinite loops", () => {
  const session = createLoopSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    { title: "Refine the runtime lane metrics", requiredGate: "controlled_validation" },
    { title: "Review the runtime lane telemetry", requiredGate: "controlled_validation" },
    { title: "Stabilize the runtime lane follow-up", requiredGate: "controlled_validation" },
    { title: "Keep the runtime lane moving", requiredGate: "controlled_validation" },
  ], "Improve the runtime lane operations.");

  const loop = startLoop(session, { max_cycles: 3 });

  assert.equal(loop.executed_cycles, 3);
  assert.equal(loop.cycle_results.length, 3);
});

test("no side effects", () => {
  const session = createLoopSession([
    { title: "Inspect the runtime lane state", requiredGate: "controlled_validation" },
    { title: "Complete the OpenClaw runtime lane stabilization", requiredGate: "controlled_validation" },
  ]);
  const initialLoop = startLoop(session, { max_cycles: 1 });
  const originalSessionStatus = session.status;
  const originalSessionCycles = session.cycle_history.length;
  const originalLoopCycles = initialLoop.executed_cycles;

  const stopped = stopRuntimeLoop(initialLoop);
  const next = runNextCycle(initialLoop);

  assert.equal(session.status, originalSessionStatus);
  assert.equal(session.cycle_history.length, originalSessionCycles);
  assert.equal(initialLoop.executed_cycles, originalLoopCycles);
  assert.equal(stopped.status, "loop_paused");
  assert.equal(next.status, "loop_completed");
});