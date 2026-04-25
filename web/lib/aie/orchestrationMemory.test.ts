import assert from "node:assert/strict";
import test from "node:test";

import { completeTaskChain, createAutonomousTaskChain } from "./autonomousTaskChain";
import { createChainCheckpoint } from "./autonomousChainRecovery";
import { createChainPersistenceRecord } from "./chainPersistence";
import { decideAutonomousOrchestration } from "./autonomousOrchestrator";
import {
  createOrchestrationMemory,
  detectDuplicateStep,
  evaluateGoalCompletion,
  summarizeGoalState,
  updateOrchestrationMemory,
} from "./orchestrationMemory";

function buildCompletedChain() {
  const planned = createAutonomousTaskChain({
    originalRequest: "Carry OpenClaw orchestration safely across multiple cycles",
    interpretedGoal: "Track a persistent orchestration goal without repeating prior work",
    maxSteps: 2,
    chainApproval: true,
    requestedSteps: [
      { title: "Persist approved chain context" },
      { title: "Validate supervised continuation state" },
    ],
    createdAt: "2026-04-25T23:30:00.000Z",
  }).chain;
  planned.steps = planned.steps.map((step) => ({ ...step, status: "completed" }));
  planned.current_step_index = planned.steps.length - 1;
  return completeTaskChain(planned).chain;
}

test("tracks goal across steps", () => {
  let memory = createOrchestrationMemory(
    "Track a persistent orchestration goal without repeating prior work",
    "2026-04-25T23:30:00.000Z",
  );

  memory = updateOrchestrationMemory(memory, {
    kind: "proposed",
    title: "Review follow-up opportunities after persistent orchestration state",
    rationale: "Carry the same goal into the next supervised cycle.",
    occurred_at: "2026-04-25T23:31:00.000Z",
    cycle_id: "cycle-1",
  });
  memory = updateOrchestrationMemory(memory, {
    kind: "completed",
    title: "Track persistent orchestration goal state",
    rationale: "Completed the first persistent-goal slice and preserved the same goal.",
    occurred_at: "2026-04-25T23:35:00.000Z",
    cycle_id: "cycle-2",
  });

  assert.equal(memory.goal, "Track a persistent orchestration goal without repeating prior work");
  assert.deepEqual(memory.cycle_ids, ["cycle-1", "cycle-2"]);
  assert.equal(memory.completed_steps.length, 1);
  assert.equal(memory.proposed_steps.length, 1);
  assert.equal(memory.goal_state.status, "nearing_completion");
});

test("prevents duplicate suggestions", () => {
  let memory = createOrchestrationMemory("Avoid repeated orchestration suggestions", "2026-04-25T23:30:00.000Z");
  memory = updateOrchestrationMemory(memory, {
    kind: "proposed",
    title: "Review follow-up opportunities after persistent orchestration state",
    occurred_at: "2026-04-25T23:31:00.000Z",
    cycle_id: "cycle-1",
  });

  const duplicate = detectDuplicateStep(memory, {
    title: "Review follow-up opportunities after persistent orchestration state",
  });
  const updated = updateOrchestrationMemory(memory, {
    kind: "proposed",
    title: "Review follow-up opportunities after persistent orchestration state",
    occurred_at: "2026-04-25T23:32:00.000Z",
    cycle_id: "cycle-2",
  });

  assert.equal(duplicate.is_duplicate, true);
  assert.equal(updated.proposed_steps.length, 1);
  assert.equal(updated.goal_state.duplicate_step_count, 1);
});

test("detects completion state", () => {
  let memory = createOrchestrationMemory("Complete persistent orchestration memory", "2026-04-25T23:30:00.000Z");
  memory = updateOrchestrationMemory(memory, {
    kind: "completed",
    title: "Complete persistent orchestration memory",
    rationale: "Finalized the persistent orchestration memory milestone.",
    occurred_at: "2026-04-25T23:40:00.000Z",
    cycle_id: "cycle-3",
    marks_goal_complete: true,
  });

  const goalState = evaluateGoalCompletion(memory);
  assert.equal(goalState.status, "completed");
  assert.match(goalState.completion_reason ?? "", /completed/i);
});

test("handles partial completion", () => {
  let memory = createOrchestrationMemory("Track persistent orchestration goal status", "2026-04-25T23:30:00.000Z");
  memory = updateOrchestrationMemory(memory, {
    kind: "completed",
    title: "Track persistent orchestration goal status",
    rationale: "Implemented the first half of the goal tracking behavior.",
    occurred_at: "2026-04-25T23:36:00.000Z",
    cycle_id: "cycle-1",
  });

  assert.equal(memory.goal_state.status, "nearing_completion");
  assert.ok(memory.goal_state.progress_percent > 0);
  assert.equal(memory.goal_state.completed_at, null);
});

test("deterministic behavior", () => {
  const first = updateOrchestrationMemory(
    createOrchestrationMemory("Track the same goal deterministically", "2026-04-25T23:30:00.000Z"),
    {
      kind: "proposed",
      title: "Prepare the next bounded orchestration memory step",
      rationale: "Same input should always produce the same memory output.",
      occurred_at: "2026-04-25T23:31:00.000Z",
      cycle_id: "cycle-1",
    },
  );
  const second = updateOrchestrationMemory(
    createOrchestrationMemory("Track the same goal deterministically", "2026-04-25T23:30:00.000Z"),
    {
      kind: "proposed",
      title: "Prepare the next bounded orchestration memory step",
      rationale: "Same input should always produce the same memory output.",
      occurred_at: "2026-04-25T23:31:00.000Z",
      cycle_id: "cycle-1",
    },
  );

  assert.deepEqual(second, first);
});

test("integrates with orchestrator", () => {
  const chain = buildCompletedChain();
  const checkpoint = createChainCheckpoint(chain);
  const record = createChainPersistenceRecord({
    chain,
    checkpoint,
    approvalState: [{
      approval_type: "chain",
      granted_at: "2026-04-25T23:33:00.000Z",
      expires_at: "2026-04-26T01:33:00.000Z",
      requires_reapproval: false,
    }],
    updatedAt: "2026-04-25T23:34:00.000Z",
  });
  let memory = createOrchestrationMemory(chain.interpreted_goal, "2026-04-25T23:30:00.000Z");
  memory = updateOrchestrationMemory(memory, {
    kind: "proposed",
    title: `Review follow-up opportunities after ${chain.steps.at(-1)?.title}`,
    rationale: "This proposal already happened in a previous orchestration cycle.",
    occurred_at: "2026-04-25T23:35:00.000Z",
    cycle_id: "cycle-1",
  });

  const decision = decideAutonomousOrchestration({
    chain,
    persistenceRecord: record,
    memory,
    maxProposedSteps: 2,
    confidence: 0.9,
    minimumConfidence: 0.7,
    supervisorApproval: true,
    now: "2026-04-25T23:40:00.000Z",
  });

  assert.equal(decision.plan.goal_status, "active");
  assert.equal(decision.plan.proposed_steps.some((step) => /review follow-up opportunities/i.test(step.title)), false);
  assert.match(decision.plan.goal_summary, /Goal status:/i);
});

test("summary readable", () => {
  let memory = createOrchestrationMemory("Track persistent orchestration memory", "2026-04-25T23:30:00.000Z");
  memory = updateOrchestrationMemory(memory, {
    kind: "completed",
    title: "Track persistent orchestration memory",
    rationale: "Completed the core memory slice.",
    occurred_at: "2026-04-25T23:35:00.000Z",
    cycle_id: "cycle-1",
  });

  const summary = summarizeGoalState(memory);
  assert.match(summary, /Goal:/i);
  assert.match(summary, /Goal status:/i);
  assert.match(summary, /Completed steps:/i);
});