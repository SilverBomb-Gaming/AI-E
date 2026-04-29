import assert from "node:assert/strict";
import test from "node:test";

import {
  createAutonomousSessionRecord,
  createAutonomousSessionRegistry,
} from "./autonomousSessionRegistry";
import {
  evaluateSessionResourceAllocation,
  summarizeSessionResourceUsage,
} from "./sessionResourceAllocator";

function createSession(input: {
  session_id: string;
  session_type: "feature" | "bugfix" | "refactor" | "experiment";
  status?: "pending" | "running" | "paused" | "blocked" | "completed" | "failed";
  logical_cpu_units?: number;
  active_chain_ids?: string[];
  assigned_agent_ids?: Array<"planner-agent" | "executor-agent" | "validator-agent" | "reporter-agent">;
  max_chain_budget?: number;
}) {
  return createAutonomousSessionRecord({
    session_id: input.session_id,
    runtime_id: "runtime-test",
    session_type: input.session_type,
    status: input.status ?? "running",
    allocated_resources: {
      logical_cpu_units: input.logical_cpu_units ?? 1,
      tick_budget: 4,
      chain_slots: input.max_chain_budget ?? Math.max(1, input.active_chain_ids?.length ?? 1),
      agent_assignments_allowed: input.assigned_agent_ids?.length ?? 1,
    },
    active_chain_ids: input.active_chain_ids ?? [],
    assigned_agent_ids: input.assigned_agent_ids ?? [],
    max_tick_budget: 4,
    max_chain_budget: input.max_chain_budget ?? 2,
  });
}

test("resource allocation grants bounded parallel sessions within cpu and chain limits", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({
        session_id: "feature-a",
        session_type: "feature",
        logical_cpu_units: 2,
        active_chain_ids: ["chain-a"],
        assigned_agent_ids: ["planner-agent"],
      }),
      createSession({
        session_id: "bugfix-b",
        session_type: "bugfix",
        logical_cpu_units: 2,
        active_chain_ids: ["chain-b"],
        assigned_agent_ids: ["validator-agent"],
      }),
    ],
  });

  const result = evaluateSessionResourceAllocation({
    registry,
    session_id: "bugfix-b",
    config: {
      max_logical_cpu_units: 6,
      max_concurrent_chains: 4,
      max_chains_per_session: 2,
    },
  });

  assert.equal(result.status, "allocation_granted");
  assert.equal(result.usage.total_logical_cpu_units, 4);
  assert.equal(result.usage.total_active_chains, 2);
});

test("resource allocation blocks sessions that exceed the global chain limit", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({
        session_id: "feature-a",
        session_type: "feature",
        active_chain_ids: ["chain-a", "chain-b"],
        assigned_agent_ids: ["planner-agent"],
        max_chain_budget: 2,
      }),
      createSession({
        session_id: "bugfix-b",
        session_type: "bugfix",
        active_chain_ids: ["chain-c"],
        assigned_agent_ids: ["validator-agent"],
        max_chain_budget: 2,
      }),
    ],
  });

  const result = evaluateSessionResourceAllocation({
    registry,
    session_id: "bugfix-b",
    config: {
      max_logical_cpu_units: 8,
      max_concurrent_chains: 2,
      max_chains_per_session: 2,
    },
  });

  assert.equal(result.status, "allocation_blocked");
  assert.match(result.reason, /global chain limit/i);
});

test("resource allocation blocks double agent assignment unless explicitly allowed", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({
        session_id: "feature-a",
        session_type: "feature",
        assigned_agent_ids: ["planner-agent"],
      }),
      createSession({
        session_id: "refactor-b",
        session_type: "refactor",
        assigned_agent_ids: ["planner-agent"],
      }),
    ],
  });

  const blocked = evaluateSessionResourceAllocation({
    registry,
    session_id: "refactor-b",
    config: { allow_agent_double_assignment: false },
  });
  const granted = evaluateSessionResourceAllocation({
    registry,
    session_id: "refactor-b",
    config: { allow_agent_double_assignment: true },
  });

  assert.equal(blocked.status, "allocation_blocked");
  assert.equal(granted.status, "allocation_granted");
});

test("resource usage summary only counts active bounded sessions", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({ session_id: "feature-a", session_type: "feature", logical_cpu_units: 2, active_chain_ids: ["chain-a"] }),
      createSession({ session_id: "paused-b", session_type: "bugfix", status: "paused", logical_cpu_units: 4, active_chain_ids: ["chain-b"] }),
    ],
  });

  const usage = summarizeSessionResourceUsage(registry);

  assert.equal(usage.total_logical_cpu_units, 2);
  assert.equal(usage.total_active_chains, 1);
});