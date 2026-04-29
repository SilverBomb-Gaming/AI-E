import assert from "node:assert/strict";

import { createOperatorDashboardDemoState } from "../lib/aie/operatorDashboardDemoState";
import { applyOperatorControlAction } from "../lib/aie/operatorControlSurface";

function assertInitialState() {
  const state = createOperatorDashboardDemoState();

  assert.ok(state.autonomous_sessions, "The operator dashboard must expose an autonomous session slice.");
  assert.equal(state.autonomous_sessions.sessions.length >= 2, true, "The seeded proof must include multiple autonomous sessions.");
  assert.equal(state.autonomous_sessions.conflicts.some((conflict) => conflict.kind === "shared_file"), true, "The seeded proof must expose a deterministic shared-file conflict.");
  assert.equal(state.autonomous_sessions.coordination_dependencies.length > 0, true, "The seeded proof must expose at least one session dependency.");
  assert.match(state.autonomous_sessions.scheduler_status.explanation, /selected|runnable/i, "The seeded proof must expose scheduler guidance.");

  return state;
}

function assertPauseResumeFlow(initialState: ReturnType<typeof createOperatorDashboardDemoState>) {
  const paused = applyOperatorControlAction(initialState, {
    type: "pause_autonomous_session",
    session_id: "demo-session-feature-ui",
  });
  assert.equal(paused.changed, true, "The proof must be able to pause a running autonomous session.");
  assert.equal(paused.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-feature-ui")?.status, "paused");

  const resumed = applyOperatorControlAction(paused.state, {
    type: "resume_autonomous_session",
    session_id: "demo-session-feature-ui",
  });
  assert.equal(resumed.changed, true, "The proof must be able to resume a paused autonomous session.");
  assert.equal(resumed.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-feature-ui")?.status, "pending");

  return resumed.state;
}

function assertPriorityAndMergeFlow(initialState: ReturnType<typeof createOperatorDashboardDemoState>) {
  const reprioritized = applyOperatorControlAction(initialState, {
    type: "reprioritize_autonomous_session",
    session_id: "demo-session-bugfix-delivery",
    session_priority: "critical",
  });
  assert.equal(reprioritized.changed, true, "The proof must be able to reprioritize a session.");
  assert.equal(reprioritized.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-bugfix-delivery")?.priority, "critical");

  const merged = applyOperatorControlAction(reprioritized.state, {
    type: "merge_autonomous_sessions",
    session_id: "demo-session-bugfix-delivery",
    target_session_id: "demo-session-feature-ui",
  });
  assert.equal(merged.changed, true, "The proof must be able to merge two bounded autonomous sessions.");
  assert.equal(merged.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-bugfix-delivery")?.status, "completed");
  assert.equal(merged.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-feature-ui")?.queued_work_item_count, 2);

  return merged.state;
}

function assertTerminationFlow(initialState: ReturnType<typeof createOperatorDashboardDemoState>) {
  const terminated = applyOperatorControlAction(initialState, {
    type: "terminate_autonomous_session",
    session_id: "demo-session-feature-ui",
  });
  assert.equal(terminated.changed, true, "The proof must be able to terminate a bounded autonomous session.");
  assert.equal(terminated.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-feature-ui")?.status, "failed");
  assert.equal(terminated.state.autonomous_sessions?.runnable_session_ids.includes("demo-session-feature-ui"), false);

  return terminated.state;
}

function main() {
  const initial = assertInitialState();
  const resumedState = assertPauseResumeFlow(initial);
  const mergedState = assertPriorityAndMergeFlow(createOperatorDashboardDemoState());
  const terminatedState = assertTerminationFlow(createOperatorDashboardDemoState());

  process.stdout.write(JSON.stringify({
    status: "proof_passed",
    proof_summary: {
      initial_scheduler: initial.autonomous_sessions?.scheduler_status.explanation ?? "unavailable",
      initial_resources: initial.autonomous_sessions?.resource_status.explanation ?? "unavailable",
      pause_resume: resumedState.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-feature-ui")?.status ?? "unknown",
      merge_result: mergedState.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-bugfix-delivery")?.status ?? "unknown",
      termination_result: terminatedState.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-feature-ui")?.status ?? "unknown",
      bounded_scope: "This proof validates deterministic multi-session dashboard state, operator controls, conflict visibility, and coordination flow without attempting commit, push, or unbounded live runtime mutation.",
    },
  }, null, 2));
}

main();