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
  createAutonomousDeliveryPackage,
  createAutonomousReviewPackage,
  createAutonomousWorkItem,
  createAutonomousWorkItemPolicyFeedback,
} from "./autonomousWorkPlanning";
import {
  createAutonomousSessionRecord,
  createAutonomousSessionRegistry,
} from "./autonomousSessionRegistry";
import {
  buildOperatorDashboardState,
  extractActionableItems,
  groupGoalsByStatus,
  summarizeOperatorDashboardState,
} from "./operatorDashboardState";
import { createMultiSessionSchedulerState } from "./multiSessionScheduler";
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

test("autonomous planning ranks bounded work deterministically and flags high-risk approval", () => {
  const state = buildOperatorDashboardState({
    autonomous_work_items: [
      createAutonomousWorkItem({
        work_item_id: "work-high-risk",
        title: "Refactor runtime mutation bridge",
        summary: "Touches high risk runtime mutation code.",
        source: "planner-analysis",
        proposed_by_agent_id: "planner-agent",
        priority: "high",
        risk_level: "high",
        estimated_tick_cost: 5,
        required_agent_roles: ["planner", "validator"],
        required_approval_level: "operator_approval",
        dependency_ids: [],
        expected_outputs: ["mutation-plan.md"],
        safety_scope: "bounded_multi_agent_runtime",
        status: "proposed",
        created_at: "2026-04-29T12:00:00.000Z",
        updated_at: "2026-04-29T12:00:00.000Z",
      }),
      createAutonomousWorkItem({
        work_item_id: "work-safe-followup",
        title: "Package overnight proof results",
        summary: "Creates a bounded review artifact from existing proof data.",
        source: "review-queue",
        proposed_by_agent_id: "reporter-agent",
        priority: "medium",
        risk_level: "low",
        estimated_tick_cost: 2,
        required_agent_roles: ["reporter"],
        required_approval_level: "none",
        dependency_ids: ["work-high-risk"],
        expected_outputs: ["review-packet.json"],
        safety_scope: "bounded_runtime_only",
        status: "approved_for_planning",
        created_at: "2026-04-29T12:01:00.000Z",
        updated_at: "2026-04-29T12:01:00.000Z",
      }),
    ],
    planning_policy_feedback: createAutonomousWorkItemPolicyFeedback({ approvals_recorded: 3 }),
    planning_budget: 3,
  });

  assert.equal(state.proposed_work_items?.length, 2);
  assert.equal(state.planning_recommendations?.[0]?.work_item_id, "work-safe-followup");
  assert.equal(state.planning_recommendations?.some((item) => item.work_item_id === "work-high-risk" && item.requires_operator_review), true);
  assert.equal(extractActionableItems(state).some((item) => item.kind === "planning" && /operator approval/i.test(item.recommended_action)), true);
});

test("review packages surface concise decision-ready action items", () => {
  const state = buildOperatorDashboardState({
    review_packages: [
      createAutonomousReviewPackage({
        package_id: "package-1",
        work_item_id: "work-safe-followup",
        chain_id: "execution-chain-safe-followup",
        status: "pending",
        summary: "The bounded review packet is ready for operator decision.",
        files_changed: ["web/lib/aie/operatorDashboardState.ts"],
        tests_run: ["npm run test:trace:safe"],
        proof_results: ["proof:overnight-autonomy:safe -> proof_passed"],
        risks: ["No code execution changes"],
        recommended_decision: "open_pr",
        rollback_notes: "No rollback required; package contains summary artifacts only.",
        operator_actions: ["approve", "reject", "defer", "request_changes", "open_pr", "archive"],
      }),
    ],
  });

  assert.equal(state.review_packages?.length, 1);
  const actionableItems = extractActionableItems(state);
  assert.equal(actionableItems.some((item) => item.kind === "review_package" && item.goal_id === "work-safe-followup"), true);
});

test("delivery packages surface concise delivery-ready action items", () => {
  const state = buildOperatorDashboardState({
    delivery_packages: [
      createAutonomousDeliveryPackage({
        delivery_package_id: "delivery-proof-summary",
        review_package_id: "review-proof-summary",
        work_item_id: "work-proof-summary",
        chain_id: "chain-proof-summary",
        branch_name: "autonomy/work-proof-summary",
        commit_plan: ["Stage reviewed changes", "Run validation"],
        files_changed: ["web/lib/aie/operatorControlSurface.ts"],
        validation_results: ["npm run test:trace:safe"],
        proof_results: ["proof:autonomous-planning:safe -> proof_passed"],
        risk_summary: "Operator approval still required before commit.",
        rollback_plan: "Revert the reviewed change set.",
        release_notes: "Delivery-ready package with validation evidence.",
        recommended_pr_title: "AI-E: deliver work-proof-summary",
        recommended_pr_body: "Summary: Delivery-ready package with validation evidence.",
        operator_decision: null,
        status: "awaiting_operator_approval",
        created_at: "2026-04-29T12:00:00.000Z",
        updated_at: "2026-04-29T12:00:00.000Z",
      }),
    ],
  });

  const actionableItems = extractActionableItems(state);
  const summary = summarizeOperatorDashboardState(state);

  assert.equal(actionableItems.some((item) => item.kind === "delivery_package" && item.goal_id === "work-proof-summary"), true);
  assert.match(summary, /Delivery packages: 1/);
});

test("autonomous sessions surface parallel orchestration state", () => {
  const registry = createAutonomousSessionRegistry({
    runtime_id: "runtime-openclaw",
    created_at: "2026-04-29T12:00:00.000Z",
    updated_at: "2026-04-29T12:00:00.000Z",
    global_tick_budget: 6,
    sessions: [
      createAutonomousSessionRecord({
        session_id: "session-feature-a",
        runtime_id: "runtime-openclaw",
        session_type: "feature",
        priority: "high",
        status: "running",
        active_chain_ids: ["chain-a"],
        assigned_agent_ids: ["planner-agent"],
        queued_work_item_ids: ["goal-openclaw-ui"],
        start_time: "2026-04-29T12:00:00.000Z",
      }),
      createAutonomousSessionRecord({
        session_id: "session-bugfix-b",
        runtime_id: "runtime-openclaw",
        session_type: "bugfix",
        priority: "medium",
        status: "pending",
        active_chain_ids: ["chain-b"],
        assigned_agent_ids: ["validator-agent"],
        queued_work_item_ids: ["goal-openclaw-ui"],
        coordination_group_id: "group-1",
        start_time: "2026-04-29T12:01:00.000Z",
      }),
    ],
  });

  const state = buildOperatorDashboardState({
    autonomous_session_registry: registry,
    autonomous_session_scheduler: createMultiSessionSchedulerState({
      global_tick_budget: 6,
      per_session_ticks: { "session-feature-a": 1 },
    }),
    session_file_targets: {
      "session-feature-a": ["web/app/operator/OperatorDashboardClient.tsx"],
      "session-bugfix-b": ["web/app/operator/OperatorDashboardClient.tsx"],
    },
    session_goal_targets: {
      "session-feature-a": ["goal-openclaw-ui"],
      "session-bugfix-b": ["goal-openclaw-ui"],
    },
    session_coordinator: {
      groups: [{ coordination_group_id: "group-1", session_ids: ["session-feature-a", "session-bugfix-b"], status: "active", shared_goal: "OpenClaw UI" }],
      dependencies: [{ source_session_id: "session-feature-a", target_session_id: "session-bugfix-b", relationship: "unlocks", status: "pending", reason: "Bugfix waits for feature stabilization." }],
    },
    generated_at: "2026-04-29T12:05:00.000Z",
  });

  assert.equal(state.autonomous_sessions?.sessions.length, 2);
  assert.equal(state.autonomous_sessions?.selected_session_id, "session-bugfix-b");
  assert.equal(state.autonomous_sessions?.conflicts.some((conflict) => conflict.kind === "shared_file"), true);
  assert.equal(extractActionableItems(state).some((item) => item.kind === "conflict"), true);
  assert.match(summarizeOperatorDashboardState(state), /Autonomous sessions: 2/);
});