import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceWorkSession,
  completeWorkSession,
  createAutonomousWorkSession,
  evaluateWorkSessionReadiness,
  pauseWorkSession,
  resumeWorkSession,
  summarizeWorkSession,
} from "./autonomousWorkSession";
import { createChainCheckpoint } from "./autonomousChainRecovery";

test("creates session from operator goal", () => {
  const session = createAutonomousWorkSession({
    operatorGoal: "Stabilize the OpenClaw supervised autonomy lane.",
    createdAt: "2026-04-25T10:00:00.000Z",
  });

  assert.equal(session.status, "session_planned");
  assert.equal(session.operator_goal, "Stabilize the OpenClaw supervised autonomy lane.");
  assert.equal(session.checkpoints.length, 1);
  assert.equal(session.active_chain.interpreted_goal, session.operator_goal);
});

test("requires explicit session approval", () => {
  const session = createAutonomousWorkSession({
    operatorGoal: "Stabilize the OpenClaw supervised autonomy lane.",
    createdAt: "2026-04-25T10:00:00.000Z",
  });

  const readiness = evaluateWorkSessionReadiness(session, "2026-04-25T10:05:00.000Z");

  assert.equal(readiness.status, "awaiting_session_approval");
  assert.equal(readiness.can_advance, false);
  assert.equal(readiness.blockers[0]?.code, "session_approval_required");
});

test("starts with orchestration memory", () => {
  const session = createAutonomousWorkSession({
    operatorGoal: "Stabilize the OpenClaw supervised autonomy lane.",
    createdAt: "2026-04-25T10:00:00.000Z",
  });

  assert.equal(session.orchestration_memory.goal, session.operator_goal);
  assert.equal(session.goal_state.status, "active");
  assert.equal(session.orchestration_memory.completed_steps.length, 0);
});

test("advances through a safe cycle", () => {
  const session = createAutonomousWorkSession({
    operatorGoal: "Stabilize the OpenClaw supervised autonomy lane.",
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
  });

  const advanced = advanceWorkSession(session, {
    occurredAt: "2026-04-25T10:10:00.000Z",
    summary: "Completed one bounded validation cycle.",
    completedSteps: [{
      title: "Validate the current autonomy lane health",
      rationale: "Confirms the bounded OpenClaw autonomy lane remains healthy.",
    }],
    validationStatus: "validation_passed",
    validationRecommendation: "keep_changes",
  });

  assert.equal(advanced.status, "session_running");
  assert.equal(advanced.cycle_history.length, 1);
  assert.equal(advanced.current_cycle?.status, "cycle_completed");
  assert.equal(advanced.orchestration_memory.completed_steps.length, 1);
});

test("pauses on approval requirement", () => {
  const session = createAutonomousWorkSession({
    operatorGoal: "Stabilize the OpenClaw supervised autonomy lane.",
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
  });

  const paused = advanceWorkSession(session, {
    occurredAt: "2026-04-25T10:10:00.000Z",
    summary: "Prepared an approval-gated continuation.",
    proposedSteps: [{
      title: "Prepare the approval-ready continuation packet",
      rationale: "The next bounded step needs explicit review.",
    }],
    requiresApproval: true,
    validationStatus: "validation_passed",
    validationRecommendation: "keep_changes",
  });

  assert.equal(paused.status, "session_paused");
  assert.match(paused.session_report.pause_reason ?? "", /approval/i);
});

test("pauses on failed validation", () => {
  const session = createAutonomousWorkSession({
    operatorGoal: "Stabilize the OpenClaw supervised autonomy lane.",
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
  });

  const paused = advanceWorkSession(session, {
    occurredAt: "2026-04-25T10:10:00.000Z",
    summary: "Validation failed and recommends review.",
    validationStatus: "validation_failed",
    validationRecommendation: "review_required",
  });

  assert.equal(paused.status, "session_paused");
  assert.match(paused.session_report.pause_reason ?? "", /validation/i);
});

test("resumes from checkpoint", () => {
  const session = createAutonomousWorkSession({
    operatorGoal: "Stabilize the OpenClaw supervised autonomy lane.",
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
  });

  const paused = pauseWorkSession(session, "Pause for supervised review.", "2026-04-25T10:15:00.000Z");
  const resumed = resumeWorkSession(paused, "2026-04-25T10:20:00.000Z");

  assert.equal(resumed.status, "session_running");
  assert.equal(resumed.current_cycle?.status, "cycle_running");
  assert.equal(resumed.current_cycle?.resumed_from_checkpoint_id, session.checkpoints[0]?.checkpoint_id ?? null);
});

test("completes when goal is done", () => {
  const session = createAutonomousWorkSession({
    operatorGoal: "Stabilize the OpenClaw supervised autonomy lane.",
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
  });

  const completed = advanceWorkSession(session, {
    occurredAt: "2026-04-25T10:10:00.000Z",
    summary: "Goal completed with a final bounded verification pass.",
    completedSteps: [{
      title: "Complete the OpenClaw autonomy lane stabilization",
      rationale: "Final bounded verification confirms the goal is complete.",
      marksGoalComplete: true,
    }],
    marksGoalComplete: true,
    validationStatus: "validation_passed",
    validationRecommendation: "keep_changes",
  });

  assert.equal(completed.status, "session_completed");
  assert.equal(completed.goal_state.status, "completed");
});

test("prevents infinite cycles", () => {
  let session = createAutonomousWorkSession({
    operatorGoal: "Stabilize the OpenClaw supervised autonomy lane.",
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
    maxCycles: 2,
  });

  session = advanceWorkSession(session, {
    occurredAt: "2026-04-25T10:10:00.000Z",
    summary: "First safe cycle.",
    validationStatus: "validation_passed",
    validationRecommendation: "keep_changes",
  });
  session = advanceWorkSession(session, {
    occurredAt: "2026-04-25T10:20:00.000Z",
    summary: "Second safe cycle.",
    validationStatus: "validation_passed",
    validationRecommendation: "keep_changes",
  });
  const blocked = advanceWorkSession(session, {
    occurredAt: "2026-04-25T10:30:00.000Z",
    summary: "Third cycle should exceed the bounded limit.",
    validationStatus: "validation_passed",
    validationRecommendation: "keep_changes",
  });

  assert.equal(blocked.status, "session_blocked");
  assert.match(blocked.session_report.pause_reason ?? "", /cycle limit/i);
});

test("produces readable session report", () => {
  const session = createAutonomousWorkSession({
    operatorGoal: "Stabilize the OpenClaw supervised autonomy lane.",
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
  });
  const checkpoint = createChainCheckpoint(session.active_chain);
  const paused = advanceWorkSession(session, {
    occurredAt: "2026-04-25T10:10:00.000Z",
    summary: "Prepared an approval-gated continuation.",
    proposedSteps: [{
      title: "Prepare the approval-ready continuation packet",
      rationale: "The next bounded step needs explicit review.",
    }],
    checkpoint,
    requiresApproval: true,
    validationStatus: "validation_passed",
    validationRecommendation: "keep_changes",
  });
  const completed = completeWorkSession(paused, "2026-04-25T10:20:00.000Z");
  const summary = summarizeWorkSession(completed);

  assert.match(summary, /Session:/);
  assert.match(summary, /Status:/);
  assert.match(summary, /Goal summary:/);
  assert.match(summary, /Report:/);
});