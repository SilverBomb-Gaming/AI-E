import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomousWorkSession, type AutonomousWorkSession } from "./autonomousWorkSession";
import {
  createBackgroundSessionQueue,
  enqueueBackgroundSession,
} from "./backgroundSessionQueue";
import {
  buildRecoveryReport,
} from "./failureRecoveryIntelligence";
import {
  createGoalQueue,
  createGoalRecord,
  scheduleNextGoal,
  type GoalRecord,
} from "./multiGoalOrchestrator";
import {
  buildOperatorDashboardState,
  extractActionableItems,
  groupGoalsByStatus,
  summarizeOperatorDashboardState,
} from "./operatorDashboardState";
import { buildRuntimeResult } from "./sessionRuntime";

function createGoal(input: Partial<GoalRecord> & { id: string; description: string }): GoalRecord {
  return createGoalRecord({
    id: input.id,
    description: input.description,
    priority: input.priority ?? "medium",
    status: input.status ?? "pending",
    created_at: input.created_at ?? "2026-04-26T10:00:00.000Z",
    last_updated_at: input.last_updated_at ?? input.created_at ?? "2026-04-26T10:00:00.000Z",
    depends_on_goal_ids: input.depends_on_goal_ids ?? [],
    blocks_goal_ids: input.blocks_goal_ids ?? [],
    conflicts_with_goal_ids: input.conflicts_with_goal_ids ?? [],
    related_goal_ids: input.related_goal_ids ?? [],
  });
}

function createSession(
  goal: string,
  overrides: Partial<Parameters<typeof createAutonomousWorkSession>[0]> = {},
): AutonomousWorkSession {
  return createAutonomousWorkSession({
    operatorGoal: goal,
    createdAt: "2026-04-26T10:00:00.000Z",
    sessionApproval: true,
    sessionApprovalGrantedAt: "2026-04-26T10:00:00.000Z",
    sessionApprovalExpiresAt: "2026-04-26T14:00:00.000Z",
    chainInput: {
      maxSteps: 1,
      requestedSteps: [{
        title: goal,
        plannerReadyRequest: goal,
        requiredGate: "controlled_validation",
        validationRequired: true,
        commitAllowed: false,
        pushAllowed: false,
        stopOnFailure: true,
      }],
    },
    ...overrides,
  });
}

test("single active goal", () => {
  const goalQueue = createGoalQueue([
    createGoal({ id: "fix-kbm", description: "Fix KBM input", priority: "high", status: "active" }),
    createGoal({ id: "grenade-test", description: "Test grenade feature", priority: "medium", status: "pending" }),
  ]);
  const goalSchedule = scheduleNextGoal(goalQueue);

  const state = buildOperatorDashboardState({ goal_queue: goalQueue, goal_schedule: goalSchedule });

  assert.equal(state.active_goal?.goal_id, "fix-kbm");
  assert.equal(state.queued_goals.length, 1);
});

test("multiple queued goals", () => {
  const goalQueue = createGoalQueue([
    createGoal({ id: "goal-a", description: "Goal A", priority: "high", status: "pending" }),
    createGoal({ id: "goal-b", description: "Goal B", priority: "medium", status: "pending" }),
    createGoal({ id: "goal-c", description: "Goal C", priority: "low", status: "pending" }),
  ]);

  const state = buildOperatorDashboardState({ goal_queue: goalQueue });

  assert.equal(state.queued_goals.length, 2);
  assert.equal(state.active_goal?.goal_id, "goal-a");
  assert.deepEqual(groupGoalsByStatus(state).queued.map((goal) => goal.goal_id), ["goal-b", "goal-c"]);
});

test("dependency-blocked goals appear correctly", () => {
  const goalQueue = createGoalQueue([
    createGoal({ id: "fix-kbm", description: "Fix KBM input", priority: "high", status: "pending" }),
    createGoal({ id: "grenade-test", description: "Test grenade feature", priority: "high", status: "pending", depends_on_goal_ids: ["fix-kbm"] }),
  ]);

  const state = buildOperatorDashboardState({ goal_queue: goalQueue });

  assert.equal(state.dependency_blockers.length, 1);
  assert.equal(state.blocked_goals[0]?.goal_id, "grenade-test");
  assert.match(state.blocked_goals[0]?.explanation ?? "", /depends/i);
});

test("conflict-blocked goals appear correctly", () => {
  const goalQueue = createGoalQueue([
    createGoal({ id: "runtime-fix", description: "Runtime fix", priority: "medium", status: "active" }),
    createGoal({ id: "conflicting-edit", description: "Conflicting edit", priority: "high", status: "pending", conflicts_with_goal_ids: ["runtime-fix"] }),
  ]);

  const state = buildOperatorDashboardState({ goal_queue: goalQueue });

  assert.equal(state.conflict_blockers.length, 1);
  assert.equal(state.blocked_goals[0]?.goal_id, "conflicting-edit");
  assert.equal(state.blocked_goals[0]?.blocker_type, "conflict");
});

test("recovery recommendations surface correctly", () => {
  const recoveryReport = buildRecoveryReport({
    created_at: "2026-04-26T10:05:00.000Z",
    source: "controlled_validation",
    status: "validation_failed",
    failures: [{ code: "missing_file", message: "Expected output file is missing.", file_path: "web/output.txt" }],
    validation_status: "validation_failed",
    validation_recommendation: "review_required",
  });

  const state = buildOperatorDashboardState({ recovery_reports: [recoveryReport] });

  assert.equal(state.recovery_recommendations.length, 1);
  assert.equal(state.recent_failures[0]?.category, "missing_file");
  assert.equal(extractActionableItems(state)[0]?.kind, "recovery");
});

test("approvals required are listed", () => {
  const session = createSession("Approve commit gate", { sessionApproval: false });
  const runtimeResult = buildRuntimeResult(session);

  const state = buildOperatorDashboardState({ runtime_result: runtimeResult });

  assert.equal(state.approvals_required.length, 1);
  assert.deepEqual(state.approvals_required[0]?.approvals_needed, ["session"]);
});

test("validation issues are included", () => {
  const session = createSession("Validate grenade lane");
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

  const state = buildOperatorDashboardState({ runtime_result: buildRuntimeResult(failedSession) });

  assert.equal(state.validation_issues.length, 1);
  assert.match(state.validation_issues[0]?.summary ?? "", /validation_failed/);
});

test("empty system produces clean empty state", () => {
  const state = buildOperatorDashboardState({});

  assert.equal(state.active_goal, null);
  assert.deepEqual(state.queued_goals, []);
  assert.deepEqual(state.blocked_goals, []);
  assert.equal(state.runtime_status.status, "runtime_idle");
});

test("deterministic output", () => {
  let queue = createBackgroundSessionQueue({
    max_sessions_per_run: 2,
    max_cycles_per_session: 2,
    skip_blocked_sessions: false,
    stop_on_first_failure: false,
    operator_away_mode: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  queue = enqueueBackgroundSession(queue, createSession("Fix KBM input"), { priority: "high" });
  queue = enqueueBackgroundSession(queue, createSession("Test grenade feature"), { priority: "medium", dependency_goal_ids: [queue.sessions[0]?.session_id ?? ""] });

  const first = buildOperatorDashboardState({ background_queue: queue });
  const second = buildOperatorDashboardState({ background_queue: queue });

  assert.deepEqual(first, second);
});

test("readable summary", () => {
  const goalQueue = createGoalQueue([
    createGoal({ id: "fix-kbm", description: "Fix KBM input", priority: "high", status: "pending" }),
    createGoal({ id: "grenade-test", description: "Test grenade feature", priority: "medium", status: "pending", depends_on_goal_ids: ["fix-kbm"] }),
  ]);
  const state = buildOperatorDashboardState({ goal_queue: goalQueue });
  const summary = summarizeOperatorDashboardState(state);

  assert.match(summary, /Active goal:/);
  assert.match(summary, /Blocked goals:/);
  assert.match(summary, /Operator action items:/);
});