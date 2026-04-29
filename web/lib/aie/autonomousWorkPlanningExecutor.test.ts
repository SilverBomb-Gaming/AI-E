import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomousWorkItem } from "./autonomousWorkPlanning";
import { projectApprovedWorkItemsToExecution } from "./autonomousWorkPlanningExecutor";
import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";

test("approved work schedules once into the existing goal queue", () => {
  const initialState = createOperatorDashboardDemoState();
  initialState.proposed_work_items = [
    createAutonomousWorkItem({
      work_item_id: "fresh-approved-item",
      title: "Fresh approved work item",
      summary: "Should project exactly once into the existing queue.",
      source: "test",
      proposed_by_agent_id: "planner-agent",
      priority: "medium",
      risk_level: "low",
      estimated_tick_cost: 1,
      required_agent_roles: ["planner"],
      required_approval_level: "none",
      dependency_ids: ["goal-queued-prereq"],
      expected_outputs: ["fresh-approved-item.md"],
      safety_scope: "bounded_runtime_only",
      status: "approved_for_planning",
      created_at: "2026-04-29T13:00:00.000Z",
      updated_at: "2026-04-29T13:00:00.000Z",
    }),
  ];
  initialState.queued_goals = initialState.queued_goals.filter((goal) => goal.goal_id !== "fresh-approved-item");

  const first = projectApprovedWorkItemsToExecution({
    state: initialState,
    timestamp: "2026-04-29T13:00:00.000Z",
    max_new_work_items: 1,
    max_chain_count: 4,
    existing_chain_count: 0,
  });

  assert.deepEqual(first.scheduled_work_item_ids, ["fresh-approved-item"]);
  assert.equal(first.state.queued_goals.some((goal) => goal.goal_id === "fresh-approved-item"), true);

  const second = projectApprovedWorkItemsToExecution({
    state: first.state,
    timestamp: "2026-04-29T13:00:01.000Z",
    max_new_work_items: 1,
    max_chain_count: 4,
    existing_chain_count: 0,
  });

  assert.deepEqual(second.scheduled_work_item_ids, []);
});

test("rejected, deferred, and blocked work do not schedule", () => {
  const initialState = createOperatorDashboardDemoState();
  initialState.proposed_work_items = [
    createAutonomousWorkItem({
      work_item_id: "rejected-item",
      title: "Rejected item",
      summary: "Should not schedule.",
      source: "test",
      proposed_by_agent_id: "planner-agent",
      priority: "medium",
      risk_level: "low",
      estimated_tick_cost: 1,
      required_agent_roles: ["planner"],
      required_approval_level: "none",
      dependency_ids: [],
      expected_outputs: [],
      safety_scope: "bounded_runtime_only",
      status: "rejected",
      created_at: "2026-04-29T13:10:00.000Z",
      updated_at: "2026-04-29T13:10:00.000Z",
    }),
    createAutonomousWorkItem({
      work_item_id: "deferred-item",
      title: "Deferred item",
      summary: "Should not schedule.",
      source: "test",
      proposed_by_agent_id: "planner-agent",
      priority: "medium",
      risk_level: "low",
      estimated_tick_cost: 1,
      required_agent_roles: ["planner"],
      required_approval_level: "none",
      dependency_ids: [],
      expected_outputs: [],
      safety_scope: "bounded_runtime_only",
      status: "needs_review",
      created_at: "2026-04-29T13:11:00.000Z",
      updated_at: "2026-04-29T13:11:00.000Z",
    }),
    createAutonomousWorkItem({
      work_item_id: "blocked-item",
      title: "Blocked item",
      summary: "Should not schedule.",
      source: "test",
      proposed_by_agent_id: "planner-agent",
      priority: "medium",
      risk_level: "low",
      estimated_tick_cost: 1,
      required_agent_roles: ["planner"],
      required_approval_level: "none",
      dependency_ids: [],
      expected_outputs: [],
      safety_scope: "bounded_runtime_only",
      status: "blocked",
      created_at: "2026-04-29T13:12:00.000Z",
      updated_at: "2026-04-29T13:12:00.000Z",
    }),
  ];

  const result = projectApprovedWorkItemsToExecution({
    state: initialState,
    timestamp: "2026-04-29T13:12:30.000Z",
  });

  assert.deepEqual(result.scheduled_work_item_ids, []);
});

test("high-risk work requires cleared approval before scheduling", () => {
  const initialState = createOperatorDashboardDemoState();
  initialState.proposed_work_items = [
    createAutonomousWorkItem({
      work_item_id: "high-risk-approved-for-planning",
      title: "High risk runtime rewrite",
      summary: "Should stay unscheduled until approval clears.",
      source: "test",
      proposed_by_agent_id: "planner-agent",
      priority: "high",
      risk_level: "high",
      estimated_tick_cost: 2,
      required_agent_roles: ["planner", "validator"],
      required_approval_level: "operator_approval",
      dependency_ids: ["goal-queued-prereq"],
      expected_outputs: ["runtime-plan.md"],
      safety_scope: "bounded_multi_agent_runtime",
      status: "approved_for_planning",
      created_at: "2026-04-29T13:20:00.000Z",
      updated_at: "2026-04-29T13:20:00.000Z",
    }),
  ];
  initialState.approvals_required = [{
    goal_id: "high-risk-approved-for-planning",
    approvals_needed: ["session"],
    reason: "High risk work still requires explicit approval.",
    recommended_action: "Approve before scheduling.",
  }];

  const blocked = projectApprovedWorkItemsToExecution({
    state: initialState,
    timestamp: "2026-04-29T13:20:10.000Z",
  });

  assert.deepEqual(blocked.scheduled_work_item_ids, []);

  const clearedState = {
    ...initialState,
    approvals_required: [],
  };
  const scheduled = projectApprovedWorkItemsToExecution({
    state: clearedState,
    timestamp: "2026-04-29T13:20:11.000Z",
  });

  assert.deepEqual(scheduled.scheduled_work_item_ids, ["high-risk-approved-for-planning"]);
  assert.deepEqual(scheduled.state.queued_goals.find((goal) => goal.goal_id === "high-risk-approved-for-planning")?.depends_on_goal_ids, ["goal-queued-prereq"]);
});