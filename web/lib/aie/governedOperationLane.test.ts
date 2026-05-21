import assert from "node:assert/strict";
import test from "node:test";

import {
  addGovernedLaneDependency,
  addGovernedLaneOperation,
  createGovernedLaneId,
  createGovernedOperationLane,
  createGovernedOperationQueue,
  createGovernedQueueId,
  createGovernedRuntimeAssignment,
  GOVERNED_OPERATION_LANE_VERSION,
  registerGovernedOperationLane,
  resolveGovernedLaneDependencies,
  snapshotGovernedOperationQueue,
  transitionGovernedLaneState,
} from "./governedOperationLane";

const FIXED_TIME = "2026-05-20T20:00:00.000Z";
const now = () => FIXED_TIME;

// Sandboxes — one per runtime lane to enforce lane isolation
const SANDBOX_OPENCLAW = "sandbox-openclaw-lane";
const SANDBOX_CLAUDECODE = "sandbox-claudecode-lane";
const SANDBOX_CODEX = "sandbox-codex-lane";

function makeOpenClawAssignment() {
  return createGovernedRuntimeAssignment({
    runtimeId: "runtime-20260520200000-openclaw",
    runtimeType: "openclaw",
    runtimeCapabilities: ["command_validation", "file_inspection"],
    sandboxId: SANDBOX_OPENCLAW,
    approvalRequired: true,
    now,
  });
}

function makeClaudeCodeAssignment() {
  return createGovernedRuntimeAssignment({
    runtimeId: "runtime-20260520200000-claude-code",
    runtimeType: "claude_code",
    runtimeCapabilities: ["command_validation", "patch_preview", "approval_review"],
    sandboxId: SANDBOX_CLAUDECODE,
    approvalRequired: true,
    now,
  });
}

function makeCodexAssignment() {
  return createGovernedRuntimeAssignment({
    runtimeId: "runtime-20260520200000-codex",
    runtimeType: "codex",
    runtimeCapabilities: ["command_validation"],
    sandboxId: SANDBOX_CODEX,
    approvalRequired: true,
    now,
  });
}

// --- createGovernedLaneId / createGovernedQueueId ---

test("createGovernedLaneId produces lane-<timestamp>-<label> format", () => {
  const id = createGovernedLaneId({ label: "openclaw", now });
  assert.equal(id, "lane-20260520200000-openclaw");
});

test("createGovernedQueueId produces queue-<timestamp>-<label> format", () => {
  const id = createGovernedQueueId({ label: "main", now });
  assert.equal(id, "queue-20260520200000-main");
});

// --- createGovernedRuntimeAssignment ---

test("createGovernedRuntimeAssignment sets all safety constraints as metadata-only", () => {
  const assignment = makeOpenClawAssignment();

  assert.equal(assignment.runtimeType, "openclaw");
  assert.equal(assignment.sandboxId, SANDBOX_OPENCLAW);
  assert.equal(assignment.executionAllowed, false);
  assert.equal(assignment.dryRunOnly, true);
  assert.equal(assignment.approvalRequired, true);
  assert.equal(assignment.safetyBoundary.runtimeInvocationEnabled, false);
  assert.equal(assignment.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(assignment.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(assignment.safetyBoundary.autonomousExecutionEnabled, false);
  assert.equal(assignment.safetyBoundary.metadataOnly, true);
});

test("createGovernedRuntimeAssignment rejects empty sandboxId", () => {
  assert.throws(
    () => createGovernedRuntimeAssignment({ runtimeType: "openclaw", sandboxId: "   ", now }),
    /sandbox id is required/i,
  );
});

test("createGovernedRuntimeAssignment with approvalRequired: false sets it correctly", () => {
  const assignment = createGovernedRuntimeAssignment({
    runtimeType: "human",
    sandboxId: "sandbox-human-review",
    approvalRequired: false,
    now,
  });
  assert.equal(assignment.approvalRequired, false);
  assert.equal(assignment.executionAllowed, false);
});

// --- createGovernedOperationLane ---

test("createGovernedOperationLane starts in 'planned' state with correct defaults", () => {
  const lane = createGovernedOperationLane({
    laneId: "lane-20260520200000-openclaw",
    runtimeAssignment: makeOpenClawAssignment(),
    now,
  });

  assert.equal(lane.laneId, "lane-20260520200000-openclaw");
  assert.equal(lane.laneState, "planned");
  assert.equal(lane.approvalState, "pending");
  assert.equal(lane.verificationState, "pending");
  assert.equal(lane.executionAllowed, false);
  assert.equal(lane.dryRun, true);
  assert.equal(lane.operations.length, 0);
  assert.equal(lane.dependencies.length, 0);
  assert.equal(lane.stateHistory.length, 0);
  assert.equal(lane.safetyBoundary.laneIsolationEnforced, true);
  assert.equal(lane.safetyBoundary.crossLaneExecutionEnabled, false);
  assert.equal(lane.safetyBoundary.automaticContinuationEnabled, false);
  assert.equal(lane.safetyBoundary.runtimeInvocationEnabled, false);
  assert.equal(lane.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(lane.safetyBoundary.networkExecutionEnabled, false);
});

test("createGovernedOperationLane sets approvalState to not_required when approvalRequired: false", () => {
  const assignment = createGovernedRuntimeAssignment({
    runtimeType: "human",
    sandboxId: "sandbox-human-review",
    approvalRequired: false,
    now,
  });
  const lane = createGovernedOperationLane({ runtimeAssignment: assignment, now });
  assert.equal(lane.approvalState, "not_required");
});

test("createGovernedOperationLane rejects invalid lane id", () => {
  assert.throws(
    () => createGovernedOperationLane({
      laneId: "INVALID!!!",
      runtimeAssignment: makeOpenClawAssignment(),
      now,
    }),
    /lane id/i,
  );
});

// --- transitionGovernedLaneState ---

test("planned → validating is a valid transition", () => {
  const lane = createGovernedOperationLane({ runtimeAssignment: makeOpenClawAssignment(), now });
  const updated = transitionGovernedLaneState(lane, "validating", { reason: "validation started", now });

  assert.equal(updated.laneState, "validating");
  assert.equal(updated.stateHistory.length, 1);
  assert.equal(updated.stateHistory[0].fromState, "planned");
  assert.equal(updated.stateHistory[0].toState, "validating");
  assert.equal(updated.stateHistory[0].reason, "validation started");
  assert.equal(updated.executionAllowed, false);
  assert.equal(updated.dryRun, true);
});

test("validating → approval_pending → ready transitions work with correct approval state", () => {
  let lane = createGovernedOperationLane({ runtimeAssignment: makeClaudeCodeAssignment(), now });

  lane = transitionGovernedLaneState(lane, "validating", { reason: "started", now });
  assert.equal(lane.approvalState, "pending");

  lane = transitionGovernedLaneState(lane, "approval_pending", { reason: "validation complete", now });
  assert.equal(lane.approvalState, "pending");

  lane = transitionGovernedLaneState(lane, "ready", {
    reason: "human approved",
    authorizedBy: "operator",
    now,
  });
  assert.equal(lane.laneState, "ready");
  assert.equal(lane.approvalState, "approved");
  assert.equal(lane.stateHistory.length, 3);
  assert.equal(lane.stateHistory[2].authorizedBy, "operator");
  assert.equal(lane.executionAllowed, false);
});

test("denial sets approvalState to rejected", () => {
  let lane = createGovernedOperationLane({ runtimeAssignment: makeCodexAssignment(), now });
  lane = transitionGovernedLaneState(lane, "validating", { reason: "started", now });
  lane = transitionGovernedLaneState(lane, "blocked", { reason: "command policy denial", now });
  lane = transitionGovernedLaneState(lane, "denied", { reason: "irrecoverable policy violation", now });

  assert.equal(lane.laneState, "denied");
  assert.equal(lane.approvalState, "rejected");
  assert.equal(lane.verificationState, "blocked");
  assert.equal(lane.executionAllowed, false);
});

test("verified → completed sets verificationState to passed", () => {
  let lane = createGovernedOperationLane({ runtimeAssignment: makeOpenClawAssignment(), now });
  lane = transitionGovernedLaneState(lane, "validating", { reason: "started", now });
  lane = transitionGovernedLaneState(lane, "approval_pending", { reason: "done", now });
  lane = transitionGovernedLaneState(lane, "ready", { reason: "approved", now });
  lane = transitionGovernedLaneState(lane, "verified", { reason: "checks passed", now });

  assert.equal(lane.verificationState, "passed");

  lane = transitionGovernedLaneState(lane, "completed", { reason: "all done", now });
  assert.equal(lane.laneState, "completed");
  assert.equal(lane.verificationState, "passed");
  assert.equal(lane.executionAllowed, false);
});

test("invalid transition throws with clear error message", () => {
  const lane = createGovernedOperationLane({ runtimeAssignment: makeOpenClawAssignment(), now });

  assert.throws(
    () => transitionGovernedLaneState(lane, "completed", { reason: "skip ahead", now }),
    /invalid lane state transition.*planned.*completed/i,
  );
});

test("terminal state 'denied' rejects further transitions", () => {
  let lane = createGovernedOperationLane({ runtimeAssignment: makeOpenClawAssignment(), now });
  lane = transitionGovernedLaneState(lane, "denied", { reason: "initial denial", now });

  assert.throws(
    () => transitionGovernedLaneState(lane, "validating", { reason: "retry", now }),
    /terminal state/i,
  );
});

test("terminal state 'completed' rejects further transitions", () => {
  let lane = createGovernedOperationLane({ runtimeAssignment: makeOpenClawAssignment(), now });
  lane = transitionGovernedLaneState(lane, "validating", { reason: "go", now });
  lane = transitionGovernedLaneState(lane, "approval_pending", { reason: "ok", now });
  lane = transitionGovernedLaneState(lane, "ready", { reason: "approved", now });
  lane = transitionGovernedLaneState(lane, "verified", { reason: "verified", now });
  lane = transitionGovernedLaneState(lane, "completed", { reason: "done", now });

  assert.throws(
    () => transitionGovernedLaneState(lane, "planned", { reason: "restart", now }),
    /terminal state/i,
  );
});

test("blocked lane can re-enter validating (recovery path)", () => {
  let lane = createGovernedOperationLane({ runtimeAssignment: makeCodexAssignment(), now });
  lane = transitionGovernedLaneState(lane, "validating", { reason: "started", now });
  lane = transitionGovernedLaneState(lane, "blocked", { reason: "policy issue", now });

  assert.equal(lane.verificationState, "blocked");

  lane = transitionGovernedLaneState(lane, "validating", { reason: "retrying after fix", now });
  assert.equal(lane.laneState, "validating");
  assert.equal(lane.stateHistory.length, 3);
});

// --- addGovernedLaneOperation ---

test("addGovernedLaneOperation adds operation with correct sandboxId", () => {
  let lane = createGovernedOperationLane({
    laneId: "lane-20260520200000-openclaw",
    runtimeAssignment: makeOpenClawAssignment(),
    now,
  });

  lane = addGovernedLaneOperation(lane, {
    operationId: "op-20260520200000-build",
    executionState: "validation_pending",
    now,
  });

  assert.equal(lane.operations.length, 1);
  assert.equal(lane.operations[0].operationId, "op-20260520200000-build");
  assert.equal(lane.operations[0].sandboxId, SANDBOX_OPENCLAW);
  assert.equal(lane.operations[0].executionState, "validation_pending");
});

test("addGovernedLaneOperation enforces lane isolation — rejects mismatched sandboxId in validationResult", async () => {
  const { validateGovernedRuntimeOperation } = await import("./governedRuntimeValidation");

  // Build a validation result for a DIFFERENT sandbox
  const otherResult = await validateGovernedRuntimeOperation({
    repositoryRoot: "E:/test-ai-e",
    sandboxId: SANDBOX_CLAUDECODE,  // different sandbox
    proposedCommands: [{ command: "npm.cmd run build" }],
    now,
  });

  const lane = createGovernedOperationLane({
    laneId: "lane-20260520200000-openclaw",
    runtimeAssignment: makeOpenClawAssignment(),
    now,
  });

  assert.throws(
    () => addGovernedLaneOperation(lane, {
      operationId: "op-20260520200000-cross",
      validationResult: otherResult,
      now,
    }),
    /lane isolation violation/i,
  );
});

test("addGovernedLaneOperation rejects invalid operation id", () => {
  const lane = createGovernedOperationLane({ runtimeAssignment: makeOpenClawAssignment(), now });

  assert.throws(
    () => addGovernedLaneOperation(lane, { operationId: "BAD_ID!!!", now }),
    /op-<id>/i,
  );
});

// --- addGovernedLaneDependency ---

test("addGovernedLaneDependency records an unresolved cross-lane dependency", () => {
  let lane = createGovernedOperationLane({
    laneId: "lane-20260520200000-codex",
    runtimeAssignment: makeCodexAssignment(),
    now,
  });

  lane = addGovernedLaneDependency(lane, {
    dependencyId: "dep-20260520200000-001",
    dependsOnLaneId: "lane-20260520200000-openclaw",
    dependencyKind: "requires_completion",
    now,
  });

  assert.equal(lane.dependencies.length, 1);
  assert.equal(lane.dependencies[0].dependsOnLaneId, "lane-20260520200000-openclaw");
  assert.equal(lane.dependencies[0].resolved, false);
  assert.equal(lane.dependencies[0].dependencyKind, "requires_completion");
});

test("addGovernedLaneDependency rejects self-dependency", () => {
  const lane = createGovernedOperationLane({
    laneId: "lane-20260520200000-openclaw",
    runtimeAssignment: makeOpenClawAssignment(),
    now,
  });

  assert.throws(
    () => addGovernedLaneDependency(lane, {
      dependsOnLaneId: "lane-20260520200000-openclaw",
      now,
    }),
    /cannot declare a dependency on itself/i,
  );
});

// --- createGovernedOperationQueue ---

test("createGovernedOperationQueue produces an empty governed queue with safety boundary", () => {
  const queue = createGovernedOperationQueue({
    queueId: "queue-20260520200000-main",
    now,
  });

  assert.equal(queue.manifestVersion, GOVERNED_OPERATION_LANE_VERSION);
  assert.equal(queue.manifestVersion, "EXEC-0045");
  assert.equal(queue.queueId, "queue-20260520200000-main");
  assert.equal(queue.lanes.length, 0);
  assert.equal(queue.safetyBoundary.governanceOnly, true);
  assert.equal(queue.safetyBoundary.executionAllowed, false);
  assert.equal(queue.safetyBoundary.dryRunEnforced, true);
  assert.equal(queue.safetyBoundary.laneIsolationEnforced, true);
  assert.equal(queue.safetyBoundary.autonomousExecutionEnabled, false);
  assert.equal(queue.safetyBoundary.recursiveOrchestrationEnabled, false);
  assert.equal(queue.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(queue.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(queue.safetyBoundary.humanAuthorityRequired, true);
});

// --- registerGovernedOperationLane ---

test("registerGovernedOperationLane adds lane to queue", () => {
  let queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-main", now });
  const lane = createGovernedOperationLane({
    laneId: "lane-20260520200000-openclaw",
    runtimeAssignment: makeOpenClawAssignment(),
    now,
  });

  queue = registerGovernedOperationLane(queue, lane, { now });

  assert.equal(queue.lanes.length, 1);
  assert.equal(queue.lanes[0].laneId, "lane-20260520200000-openclaw");
});

test("registerGovernedOperationLane rejects duplicate lane id", () => {
  let queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-main", now });
  const lane = createGovernedOperationLane({
    laneId: "lane-20260520200000-openclaw",
    runtimeAssignment: makeOpenClawAssignment(),
    now,
  });

  queue = registerGovernedOperationLane(queue, lane, { now });

  assert.throws(
    () => registerGovernedOperationLane(queue, lane, { now }),
    /already registered/i,
  );
});

// --- Multi-lane concurrent governance scenario ---
//
// Lane A: OpenClaw — validation pending
// Lane B: Claude Code — approved, ready (waiting for execution — which never happens here)
// Lane C: Codex — blocked by command policy denial

test("three runtime lanes coexist simultaneously with independent states", () => {
  let queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-main", now });

  // Lane A: OpenClaw — validating
  let laneA = createGovernedOperationLane({
    laneId: "lane-20260520200000-openclaw",
    runtimeAssignment: makeOpenClawAssignment(),
    now,
  });
  laneA = transitionGovernedLaneState(laneA, "validating", { reason: "validation started", now });

  // Lane B: Claude Code — approved and ready
  let laneB = createGovernedOperationLane({
    laneId: "lane-20260520200000-claude-code",
    runtimeAssignment: makeClaudeCodeAssignment(),
    now,
  });
  laneB = transitionGovernedLaneState(laneB, "validating", { reason: "started", now });
  laneB = transitionGovernedLaneState(laneB, "approval_pending", { reason: "validation done", now });
  laneB = transitionGovernedLaneState(laneB, "ready", { reason: "operator approved", authorizedBy: "operator", now });

  // Lane C: Codex — blocked by command policy
  let laneC = createGovernedOperationLane({
    laneId: "lane-20260520200000-codex",
    runtimeAssignment: makeCodexAssignment(),
    now,
  });
  laneC = transitionGovernedLaneState(laneC, "validating", { reason: "started", now });
  laneC = transitionGovernedLaneState(laneC, "blocked", { reason: "command policy denied rm -rf", now });

  // Register all three lanes
  queue = registerGovernedOperationLane(queue, laneA, { now });
  queue = registerGovernedOperationLane(queue, laneB, { now });
  queue = registerGovernedOperationLane(queue, laneC, { now });

  assert.equal(queue.lanes.length, 3);

  // Verify each lane has independent state
  const a = queue.lanes[0];
  const b = queue.lanes[1];
  const c = queue.lanes[2];

  assert.equal(a.laneState, "validating");
  assert.equal(a.approvalState, "pending");
  assert.equal(a.executionAllowed, false);

  assert.equal(b.laneState, "ready");
  assert.equal(b.approvalState, "approved");
  assert.equal(b.executionAllowed, false);  // approved but execution still blocked

  assert.equal(c.laneState, "blocked");
  assert.equal(c.approvalState, "pending");
  assert.equal(c.verificationState, "blocked");
  assert.equal(c.executionAllowed, false);
});

test("approvals are lane-scoped — approving Lane B does not affect Lanes A or C", () => {
  let queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-main", now });

  let laneA = createGovernedOperationLane({ runtimeAssignment: makeOpenClawAssignment(), now });
  laneA = transitionGovernedLaneState(laneA, "validating", { reason: "started", now });

  let laneB = createGovernedOperationLane({ runtimeAssignment: makeClaudeCodeAssignment(), now });
  laneB = transitionGovernedLaneState(laneB, "validating", { reason: "started", now });
  laneB = transitionGovernedLaneState(laneB, "approval_pending", { reason: "done", now });
  laneB = transitionGovernedLaneState(laneB, "ready", { reason: "approved", now });

  let laneC = createGovernedOperationLane({ runtimeAssignment: makeCodexAssignment(), now });
  laneC = transitionGovernedLaneState(laneC, "blocked", { reason: "policy violation", now });

  queue = registerGovernedOperationLane(queue, laneA, { now });
  queue = registerGovernedOperationLane(queue, laneB, { now });
  queue = registerGovernedOperationLane(queue, laneC, { now });

  // Only Lane B has approved state — the others are unaffected
  assert.equal(queue.lanes[0].approvalState, "pending");   // Lane A
  assert.equal(queue.lanes[1].approvalState, "approved");  // Lane B
  assert.equal(queue.lanes[2].approvalState, "pending");   // Lane C (pending, not rejected)
  assert.ok(queue.lanes.every((l) => l.executionAllowed === false));
  assert.ok(queue.lanes.every((l) => l.dryRun === true));
});

test("denied lane is isolated — state cannot propagate to other lanes", () => {
  let queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-main", now });

  let laneA = createGovernedOperationLane({ runtimeAssignment: makeOpenClawAssignment(), now });
  laneA = transitionGovernedLaneState(laneA, "denied", { reason: "command policy violation", now });

  const laneB = createGovernedOperationLane({ runtimeAssignment: makeClaudeCodeAssignment(), now });

  queue = registerGovernedOperationLane(queue, laneA, { now });
  queue = registerGovernedOperationLane(queue, laneB, { now });

  // Lane B is unaffected by Lane A's denial
  assert.equal(queue.lanes[0].laneState, "denied");
  assert.equal(queue.lanes[1].laneState, "planned");
  assert.equal(queue.lanes[1].approvalState, "pending");
  assert.equal(queue.lanes[1].executionAllowed, false);
});

// --- snapshotGovernedOperationQueue ---

test("snapshotGovernedOperationQueue reflects correct counts for all lane states", () => {
  let queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-main", now });

  let laneA = createGovernedOperationLane({ runtimeAssignment: makeOpenClawAssignment(), now });
  laneA = transitionGovernedLaneState(laneA, "validating", { reason: "started", now });

  let laneB = createGovernedOperationLane({ runtimeAssignment: makeClaudeCodeAssignment(), now });
  laneB = transitionGovernedLaneState(laneB, "validating", { reason: "started", now });
  laneB = transitionGovernedLaneState(laneB, "approval_pending", { reason: "done", now });
  laneB = transitionGovernedLaneState(laneB, "ready", { reason: "approved", now });

  let laneC = createGovernedOperationLane({ runtimeAssignment: makeCodexAssignment(), now });
  laneC = transitionGovernedLaneState(laneC, "blocked", { reason: "policy issue", now });

  queue = registerGovernedOperationLane(queue, laneA, { now });
  queue = registerGovernedOperationLane(queue, laneB, { now });
  queue = registerGovernedOperationLane(queue, laneC, { now });

  const snapshot = snapshotGovernedOperationQueue(queue, { now });

  assert.equal(snapshot.snapshotVersion, "EXEC-0045");
  assert.equal(snapshot.totalLanes, 3);
  assert.equal(snapshot.allLanesExecutionAllowed, false);
  assert.equal(snapshot.allLanesDryRun, true);
  assert.equal(snapshot.blockedCount, 1);
  assert.equal(snapshot.deniedCount, 0);
  assert.equal(snapshot.verifiedCount, 0);
  assert.equal(snapshot.completedCount, 0);

  // Lane B is approved so pendingApprovalCount is 2 (A and C still pending)
  assert.equal(snapshot.pendingApprovalCount, 2);

  const readyCount = snapshot.laneStateCounts.find((c) => c.state === "ready");
  assert.equal(readyCount?.count, 1);

  const validatingCount = snapshot.laneStateCounts.find((c) => c.state === "validating");
  assert.equal(validatingCount?.count, 1);
});

// --- resolveGovernedLaneDependencies ---

test("resolveGovernedLaneDependencies marks completed-lane dependency as resolved", () => {
  let queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-main", now });

  let laneA = createGovernedOperationLane({
    laneId: "lane-20260520200000-openclaw",
    runtimeAssignment: makeOpenClawAssignment(),
    now,
  });
  laneA = transitionGovernedLaneState(laneA, "validating", { reason: "go", now });
  laneA = transitionGovernedLaneState(laneA, "approval_pending", { reason: "ok", now });
  laneA = transitionGovernedLaneState(laneA, "ready", { reason: "approved", now });
  laneA = transitionGovernedLaneState(laneA, "verified", { reason: "verified", now });
  laneA = transitionGovernedLaneState(laneA, "completed", { reason: "done", now });

  let laneB = createGovernedOperationLane({
    laneId: "lane-20260520200000-codex",
    runtimeAssignment: makeCodexAssignment(),
    now,
  });
  laneB = addGovernedLaneDependency(laneB, {
    dependencyId: "dep-20260520200000-001",
    dependsOnLaneId: "lane-20260520200000-openclaw",
    dependencyKind: "requires_completion",
    now,
  });

  queue = registerGovernedOperationLane(queue, laneA, { now });
  queue = registerGovernedOperationLane(queue, laneB, { now });

  const result = resolveGovernedLaneDependencies(queue, "lane-20260520200000-codex", { now });

  assert.equal(result.laneId, "lane-20260520200000-codex");
  assert.equal(result.resolved.length, 1);
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.resolved[0].dependencyId, "dep-20260520200000-001");
  assert.equal(result.resolved[0].resolved, true);
  assert.ok(result.resolved[0].resolvedAt !== undefined);
});

test("resolveGovernedLaneDependencies keeps dependency unresolved when depended-upon lane not complete", () => {
  let queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-main", now });

  const laneA = createGovernedOperationLane({
    laneId: "lane-20260520200000-openclaw",
    runtimeAssignment: makeOpenClawAssignment(),
    now,
  });

  let laneB = createGovernedOperationLane({
    laneId: "lane-20260520200000-codex",
    runtimeAssignment: makeCodexAssignment(),
    now,
  });
  laneB = addGovernedLaneDependency(laneB, {
    dependencyId: "dep-20260520200000-001",
    dependsOnLaneId: "lane-20260520200000-openclaw",
    dependencyKind: "requires_completion",
    now,
  });

  queue = registerGovernedOperationLane(queue, laneA, { now });
  queue = registerGovernedOperationLane(queue, laneB, { now });

  const result = resolveGovernedLaneDependencies(queue, "lane-20260520200000-codex", { now });

  assert.equal(result.resolved.length, 0);
  assert.equal(result.unresolved.length, 1);
});

test("resolveGovernedLaneDependencies marks requires_approval dependency resolved when depended-upon is approved", () => {
  let queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-main", now });

  let laneA = createGovernedOperationLane({
    laneId: "lane-20260520200000-openclaw",
    runtimeAssignment: makeOpenClawAssignment(),
    now,
  });
  laneA = transitionGovernedLaneState(laneA, "validating", { reason: "go", now });
  laneA = transitionGovernedLaneState(laneA, "approval_pending", { reason: "ok", now });
  laneA = transitionGovernedLaneState(laneA, "ready", { reason: "approved", now });

  let laneB = createGovernedOperationLane({
    laneId: "lane-20260520200000-codex",
    runtimeAssignment: makeCodexAssignment(),
    now,
  });
  laneB = addGovernedLaneDependency(laneB, {
    dependencyId: "dep-20260520200000-001",
    dependsOnLaneId: "lane-20260520200000-openclaw",
    dependencyKind: "requires_approval",
    now,
  });

  queue = registerGovernedOperationLane(queue, laneA, { now });
  queue = registerGovernedOperationLane(queue, laneB, { now });

  const result = resolveGovernedLaneDependencies(queue, "lane-20260520200000-codex", { now });

  assert.equal(result.resolved.length, 1);
  assert.equal(result.unresolved.length, 0);
});

test("resolveGovernedLaneDependencies throws when lane not found in queue", () => {
  const queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-main", now });

  assert.throws(
    () => resolveGovernedLaneDependencies(queue, "lane-20260520200000-missing", { now }),
    /not registered/i,
  );
});

// --- Safety invariants across all constructs ---

test("executionAllowed and dryRun remain false/true across all transitions", () => {
  let lane = createGovernedOperationLane({ runtimeAssignment: makeClaudeCodeAssignment(), now });
  const states: Array<[string, boolean, boolean]> = [];

  const record = (label: string) =>
    states.push([label, lane.executionAllowed, lane.dryRun]);

  record("planned");
  lane = transitionGovernedLaneState(lane, "validating", { reason: "go", now });
  record("validating");
  lane = transitionGovernedLaneState(lane, "approval_pending", { reason: "ok", now });
  record("approval_pending");
  lane = transitionGovernedLaneState(lane, "ready", { reason: "approved", now });
  record("ready");
  lane = transitionGovernedLaneState(lane, "verified", { reason: "verified", now });
  record("verified");
  lane = transitionGovernedLaneState(lane, "completed", { reason: "done", now });
  record("completed");

  for (const [label, execAllowed, dryRun] of states) {
    assert.equal(execAllowed, false, `executionAllowed must be false at state '${label}'`);
    assert.equal(dryRun, true, `dryRun must be true at state '${label}'`);
  }
});
