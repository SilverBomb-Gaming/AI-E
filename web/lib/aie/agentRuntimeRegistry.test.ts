import assert from "node:assert/strict";
import test from "node:test";

import {
  assignGoalToAgentRuntime,
  clearAgentGoalAssignment,
  createAgentRuntimeRegistry,
  EXECUTOR_AGENT_ID,
  markAgentBlocked,
  markAgentIdle,
  pauseAgentRuntime,
  PLANNER_AGENT_ID,
  REPORTER_AGENT_ID,
  registerAgentRuntime,
  resumeAgentRuntime,
  summarizeAgentRuntimeRegistry,
  VALIDATOR_AGENT_ID,
} from "./agentRuntimeRegistry";

test("registry creates bounded planner, executor, validator, and reporter nodes by default", () => {
  const registry = createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
  });

  assert.equal(registry.max_agents, 4);
  assert.equal(registry.recursion_guard_enabled, true);
  assert.equal(registry.agents.length, 4);
  assert.equal(registry.agents[0]?.can_spawn_agents, false);
  assert.equal(registry.agents[1]?.safety_scope, "bounded_execution_only");
  assert.equal(registry.agents[2]?.role, "validator");
  assert.equal(registry.agents[3]?.role, "reporter");
});

test("registry can register a missing known agent runtime", () => {
  const registry = createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
    include_default_agents: false,
  });

  const registered = registerAgentRuntime(registry, {
    agent_id: PLANNER_AGENT_ID,
    timestamp: "2026-04-27T10:00:01.000Z",
  });

  assert.equal(registered.agents.length, 1);
  assert.equal(registered.agents[0]?.role, "planner");
});

test("registry enforces bounded goal assignment and pause or resume transitions", () => {
  const registry = createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
  });

  const assigned = assignGoalToAgentRuntime(registry, {
    agent_id: EXECUTOR_AGENT_ID,
    goal_id: "goal-runtime-proof",
    timestamp: "2026-04-27T10:00:02.000Z",
  });

  assert.equal(assigned.agents.find((agent) => agent.agent_id === EXECUTOR_AGENT_ID)?.status, "assigned");
  assert.equal(assigned.agents.find((agent) => agent.agent_id === EXECUTOR_AGENT_ID)?.current_goal_id, "goal-runtime-proof");
  assert.deepEqual(assigned.agents.find((agent) => agent.agent_id === EXECUTOR_AGENT_ID)?.assigned_goal_ids, ["goal-runtime-proof"]);

  const paused = pauseAgentRuntime(assigned, {
    agent_id: EXECUTOR_AGENT_ID,
    timestamp: "2026-04-27T10:00:03.000Z",
  });
  assert.equal(paused.agents.find((agent) => agent.agent_id === EXECUTOR_AGENT_ID)?.status, "paused");

  const resumed = resumeAgentRuntime(paused, {
    agent_id: EXECUTOR_AGENT_ID,
    timestamp: "2026-04-27T10:00:04.000Z",
  });
  assert.equal(resumed.agents.find((agent) => agent.agent_id === EXECUTOR_AGENT_ID)?.status, "assigned");

  const cleared = clearAgentGoalAssignment(resumed, {
    agent_id: EXECUTOR_AGENT_ID,
    timestamp: "2026-04-27T10:00:05.000Z",
  });
  assert.equal(cleared.agents.find((agent) => agent.agent_id === EXECUTOR_AGENT_ID)?.status, "idle");
  assert.equal(cleared.agents.find((agent) => agent.agent_id === EXECUTOR_AGENT_ID)?.current_goal_id, null);
  assert.deepEqual(cleared.agents.find((agent) => agent.agent_id === EXECUTOR_AGENT_ID)?.assigned_goal_ids, []);
});

test("registry rejects unbounded agent expansion", () => {
  const registry = createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
    include_default_agents: false,
  });

  assert.throws(() => registerAgentRuntime(registry, {
    agent_id: "rogue-agent" as typeof PLANNER_AGENT_ID,
    timestamp: "2026-04-27T10:00:01.000Z",
  }), /unknown agent runtime id/i);
});

test("registry protects against duplicate registration", () => {
  const registry = createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
    include_default_agents: false,
  });

  const registered = registerAgentRuntime(registry, {
    agent_id: VALIDATOR_AGENT_ID,
    timestamp: "2026-04-27T10:00:01.000Z",
  });

  assert.throws(() => registerAgentRuntime(registered, {
    agent_id: VALIDATOR_AGENT_ID,
    timestamp: "2026-04-27T10:00:02.000Z",
  }), /already registered/i);
});

test("paused agents cannot execute bounded goal assignments", () => {
  const registry = pauseAgentRuntime(createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
  }), {
    agent_id: EXECUTOR_AGENT_ID,
    timestamp: "2026-04-27T10:00:01.000Z",
  });

  assert.throws(() => assignGoalToAgentRuntime(registry, {
    agent_id: EXECUTOR_AGENT_ID,
    goal_id: "goal-runtime-proof",
    timestamp: "2026-04-27T10:00:02.000Z",
  }), /paused/i);
});

test("blocked agents cannot receive new work", () => {
  const registry = markAgentBlocked(createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
  }), {
    agent_id: EXECUTOR_AGENT_ID,
    timestamp: "2026-04-27T10:00:01.000Z",
  });

  assert.throws(() => assignGoalToAgentRuntime(registry, {
    agent_id: EXECUTOR_AGENT_ID,
    goal_id: "goal-runtime-proof",
    timestamp: "2026-04-27T10:00:02.000Z",
  }), /blocked/i);
});

test("assigned goals remain bounded to one active goal per agent", () => {
  const registry = assignGoalToAgentRuntime(createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
  }), {
    agent_id: EXECUTOR_AGENT_ID,
    goal_id: "goal-runtime-proof",
    timestamp: "2026-04-27T10:00:01.000Z",
  });

  assert.throws(() => assignGoalToAgentRuntime(registry, {
    agent_id: EXECUTOR_AGENT_ID,
    goal_id: "goal-follow-up",
    timestamp: "2026-04-27T10:00:02.000Z",
  }), /already owns a bounded goal assignment/i);
});

test("registry remains operator-safe and disallows recursive agent spawning", () => {
  const registry = createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
  });

  for (const agent of registry.agents) {
    assert.equal(agent.can_spawn_agents, false);
  }

  const reporterIdle = markAgentIdle(registry, {
    agent_id: REPORTER_AGENT_ID,
    timestamp: "2026-04-27T10:00:01.000Z",
  });
  assert.equal(reporterIdle.agents.find((agent) => agent.agent_id === REPORTER_AGENT_ID)?.status, "idle");
});

test("registry summary stays explicit about the recursion guard", () => {
  const registry = createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
  });

  assert.match(summarizeAgentRuntimeRegistry(registry), /Recursion guard enabled: yes/i);
});