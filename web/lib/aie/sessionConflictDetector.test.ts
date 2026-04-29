import assert from "node:assert/strict";
import test from "node:test";

import {
  createAutonomousSessionRecord,
  createAutonomousSessionRegistry,
} from "./autonomousSessionRegistry";
import {
  applySessionConflictBlocks,
  detectSessionConflicts,
} from "./sessionConflictDetector";

function createSession(input: {
  session_id: string;
  session_type: "feature" | "bugfix" | "refactor" | "experiment";
  priority?: "critical" | "high" | "medium" | "low";
  coordination_group_id?: string;
  active_chain_ids?: string[];
}) {
  return createAutonomousSessionRecord({
    session_id: input.session_id,
    runtime_id: "runtime-test",
    session_type: input.session_type,
    priority: input.priority ?? "medium",
    status: "running",
    coordination_group_id: input.coordination_group_id,
    active_chain_ids: input.active_chain_ids ?? [],
    max_tick_budget: 4,
    max_chain_budget: 2,
  });
}

test("shared file conflicts block the lower-priority session", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({ session_id: "feature-a", session_type: "feature", priority: "high" }),
      createSession({ session_id: "bugfix-b", session_type: "bugfix", priority: "medium" }),
    ],
  });

  const conflicts = detectSessionConflicts({
    registry,
    session_file_targets: {
      "feature-a": ["web/lib/aie/runtimeStateStore.ts"],
      "bugfix-b": ["web/lib/aie/runtimeStateStore.ts"],
    },
  });

  assert.equal(conflicts.conflicts.length, 1);
  assert.equal(conflicts.conflicts[0]?.resolution, "block_one_session");
  assert.deepEqual(conflicts.blocked_session_ids, ["bugfix-b"]);
});

test("shared goals queue one session and chain overlap requests operator review", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({ session_id: "feature-a", session_type: "feature", active_chain_ids: ["chain-1"] }),
      createSession({ session_id: "refactor-b", session_type: "refactor", active_chain_ids: ["chain-1"] }),
    ],
  });

  const conflicts = detectSessionConflicts({
    registry,
    session_goal_targets: {
      "feature-a": ["goal-openclaw-runtime"],
      "refactor-b": ["goal-openclaw-runtime"],
    },
  });

  assert.equal(conflicts.conflicts.some((conflict) => conflict.kind === "shared_goal" && conflict.resolution === "queue_work"), true);
  assert.equal(conflicts.conflicts.some((conflict) => conflict.kind === "overlapping_chain" && conflict.resolution === "request_operator_review"), true);
});

test("incompatible scopes inside the same coordination group can merge safely", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({ session_id: "feature-a", session_type: "feature", coordination_group_id: "group-1" }),
      createSession({ session_id: "experiment-b", session_type: "experiment", coordination_group_id: "group-1" }),
    ],
  });

  const conflicts = detectSessionConflicts({
    registry,
    incompatible_scope_pairs: [["feature-a", "experiment-b"]],
  });

  assert.equal(conflicts.conflicts[0]?.resolution, "merge_scopes_if_safe");
  assert.deepEqual(conflicts.blocked_session_ids, []);
});

test("conflict blocks are applied back onto the registry", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({ session_id: "feature-a", session_type: "feature", priority: "high" }),
      createSession({ session_id: "bugfix-b", session_type: "bugfix", priority: "low" }),
    ],
  });

  const conflicts = detectSessionConflicts({
    registry,
    session_file_targets: {
      "feature-a": ["web/app/operator/OperatorDashboardClient.tsx"],
      "bugfix-b": ["web/app/operator/OperatorDashboardClient.tsx"],
    },
  });
  const updated = applySessionConflictBlocks(registry, conflicts);

  assert.equal(updated.sessions.find((session) => session.session_id === "bugfix-b")?.status, "blocked");
});