import assert from "node:assert/strict";
import test from "node:test";

import {
  assignGoalToAgentRuntime,
  clearAgentGoalAssignment,
  createAgentRuntimeRegistry,
  pauseAgentRuntime,
  registerAgentRuntime,
  resumeAgentRuntime,
  summarizeAgentRuntimeRegistry,
} from "./agentRuntimeRegistry";
import { EXECUTOR_AGENT_ID, PLANNER_AGENT_ID } from "./orchestrationSession";

test("registry creates bounded planner and executor nodes by default", () => {
  const registry = createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
  });

  assert.equal(registry.max_agents, 2);
  assert.equal(registry.recursion_guard_enabled, true);
  assert.equal(registry.agents.length, 2);
  assert.equal(registry.agents[0]?.can_spawn_agents, false);
  assert.equal(registry.agents[1]?.safety_scope, "bounded_execution_only");
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
  assert.equal(registered.agents[0]?.agent_role, "planner");
});

test("registry enforces bounded goal assignment and pause or resume transitions", () => {
  const registry = createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
  });

  const assigned = assignGoalToAgentRuntime(registry, {
    agent_id: EXECUTOR_AGENT_ID,
    goal_id: "goal-runtime-proof",
    goal_label: "Advance live runtime proof",
    timestamp: "2026-04-27T10:00:02.000Z",
  });

  assert.equal(assigned.agents.find((agent) => agent.agent_id === EXECUTOR_AGENT_ID)?.status, "assigned");
  assert.equal(assigned.agents.find((agent) => agent.agent_id === EXECUTOR_AGENT_ID)?.assigned_goal_id, "goal-runtime-proof");

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
  assert.equal(cleared.agents.find((agent) => agent.agent_id === EXECUTOR_AGENT_ID)?.assigned_goal_id, null);
});

test("registry rejects unbounded agent expansion", () => {
  const registry = createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
  });

  assert.throws(() => registerAgentRuntime(registry, {
    agent_id: "rogue-agent" as typeof PLANNER_AGENT_ID,
    timestamp: "2026-04-27T10:00:01.000Z",
  }), /unknown agent runtime id/i);
});

test("registry summary stays explicit about the recursion guard", () => {
  const registry = createAgentRuntimeRegistry({
    runtime_id: "runtime-1",
    now: "2026-04-27T10:00:00.000Z",
  });

  assert.match(summarizeAgentRuntimeRegistry(registry), /Recursion guard enabled: yes/i);
});