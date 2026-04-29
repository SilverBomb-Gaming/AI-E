import assert from "node:assert/strict";
import test from "node:test";

import {
  createAutonomousSessionRecord,
  createAutonomousSessionRegistry,
} from "./autonomousSessionRegistry";
import {
  createSessionCoordinatorState,
  evaluateSessionCoordination,
  summarizeSessionCoordination,
} from "./sessionCoordinator";

function createSession(input: {
  session_id: string;
  session_type: "feature" | "bugfix" | "refactor" | "experiment";
  status: "pending" | "running" | "paused" | "blocked" | "completed" | "failed";
  coordination_group_id?: string;
}) {
  return createAutonomousSessionRecord({
    session_id: input.session_id,
    runtime_id: "runtime-test",
    session_type: input.session_type,
    status: input.status,
    coordination_group_id: input.coordination_group_id,
    max_tick_budget: 4,
    max_chain_budget: 2,
  });
}

test("completed source sessions unlock dependent sessions", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({ session_id: "feature-a", session_type: "feature", status: "completed", coordination_group_id: "group-1" }),
      createSession({ session_id: "bugfix-b", session_type: "bugfix", status: "pending", coordination_group_id: "group-1" }),
    ],
  });
  const coordinator = createSessionCoordinatorState({
    groups: [{ coordination_group_id: "group-1", session_ids: ["feature-a", "bugfix-b"], status: "active", shared_goal: "OpenClaw runtime hardening" }],
    dependencies: [{ source_session_id: "feature-a", target_session_id: "bugfix-b", relationship: "unlocks", status: "pending", reason: "Bugfix starts after feature stabilization." }],
  });

  const evaluation = evaluateSessionCoordination({ registry, coordinator });

  assert.deepEqual(evaluation.ready_session_ids, ["bugfix-b"]);
  assert.equal(evaluation.dependencies[0]?.status, "ready");
});

test("blocked source sessions keep dependents blocked", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({ session_id: "feature-a", session_type: "feature", status: "blocked" }),
      createSession({ session_id: "experiment-b", session_type: "experiment", status: "pending" }),
    ],
  });
  const coordinator = createSessionCoordinatorState({
    dependencies: [{ source_session_id: "feature-a", target_session_id: "experiment-b", relationship: "triggers", status: "pending", reason: "Experiment waits on the feature baseline." }],
  });

  const evaluation = evaluateSessionCoordination({ registry, coordinator });

  assert.deepEqual(evaluation.blocked_session_ids, ["experiment-b"]);
  assert.equal(evaluation.dependencies[0]?.status, "blocked");
});

test("coordination group completes when all sessions complete", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({ session_id: "feature-a", session_type: "feature", status: "completed", coordination_group_id: "group-1" }),
      createSession({ session_id: "refactor-b", session_type: "refactor", status: "completed", coordination_group_id: "group-1" }),
    ],
  });
  const coordinator = createSessionCoordinatorState({
    groups: [{ coordination_group_id: "group-1", session_ids: ["feature-a", "refactor-b"], status: "active", shared_goal: "OpenClaw cleanup" }],
  });

  const evaluation = evaluateSessionCoordination({ registry, coordinator });

  assert.equal(evaluation.groups[0]?.status, "completed");
  assert.match(summarizeSessionCoordination(evaluation), /Coordination groups:/);
});