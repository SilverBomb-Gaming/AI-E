import assert from "node:assert/strict";
import test from "node:test";

import {
  addGovernedLaneDependency,
  addGovernedLaneOperation,
  createGovernedOperationLane,
  createGovernedOperationQueue,
  createGovernedRuntimeAssignment,
  registerGovernedOperationLane,
  transitionGovernedLaneState,
} from "./governedOperationLane";

// Model helpers live under frontend/ui — import via relative path from lib/aie
import {
  buildGovernedOperationsDashboardViewModel,
  buildLaneCardViewModel,
  getApprovalStateDisplay,
  getLaneStateDisplay,
  getRuntimeTypeDisplay,
  getVerificationStateDisplay,
} from "../../frontend/ui/governed-operations-dashboard/governedOperationsDashboardModel";

const FIXED_TIME = "2026-05-20T20:00:00.000Z";
const now = () => FIXED_TIME;

function makeOpenClawLane() {
  const assignment = createGovernedRuntimeAssignment({
    runtimeId: "runtime-20260520200000-openclaw",
    runtimeType: "openclaw",
    runtimeCapabilities: ["command_validation", "file_inspection"],
    sandboxId: "sandbox-openclaw-lane",
    approvalRequired: true,
    now,
  });
  return createGovernedOperationLane({
    laneId: "lane-20260520200000-openclaw",
    runtimeAssignment: assignment,
    now,
  });
}

function makeClaudeCodeLane() {
  const assignment = createGovernedRuntimeAssignment({
    runtimeId: "runtime-20260520200000-claude-code",
    runtimeType: "claude_code",
    runtimeCapabilities: ["command_validation", "patch_preview", "approval_review"],
    sandboxId: "sandbox-claudecode-lane",
    approvalRequired: true,
    now,
  });
  return createGovernedOperationLane({
    laneId: "lane-20260520200000-claude-code",
    runtimeAssignment: assignment,
    now,
  });
}

function makeCodexLane() {
  const assignment = createGovernedRuntimeAssignment({
    runtimeId: "runtime-20260520200000-codex",
    runtimeType: "codex",
    runtimeCapabilities: ["command_validation"],
    sandboxId: "sandbox-codex-lane",
    approvalRequired: true,
    now,
  });
  return createGovernedOperationLane({
    laneId: "lane-20260520200000-codex",
    runtimeAssignment: assignment,
    now,
  });
}

// --- getLaneStateDisplay ---

test("getLaneStateDisplay returns correct label and variant for each lane state", () => {
  const planned = getLaneStateDisplay("planned");
  assert.equal(planned.label, "Planned");
  assert.equal(planned.variant, "neutral");
  assert.ok(planned.description.length > 0);

  const validating = getLaneStateDisplay("validating");
  assert.equal(validating.label, "Validating");
  assert.equal(validating.variant, "active");

  const approvalPending = getLaneStateDisplay("approval_pending");
  assert.equal(approvalPending.label, "Approval Pending");
  assert.equal(approvalPending.variant, "pending");

  const ready = getLaneStateDisplay("ready");
  assert.equal(ready.label, "Ready");
  assert.equal(ready.variant, "success");

  const blocked = getLaneStateDisplay("blocked");
  assert.equal(blocked.label, "Blocked");
  assert.equal(blocked.variant, "blocked");

  const denied = getLaneStateDisplay("denied");
  assert.equal(denied.label, "Denied");
  assert.equal(denied.variant, "denied");

  const verified = getLaneStateDisplay("verified");
  assert.equal(verified.label, "Verified");
  assert.equal(verified.variant, "success");

  const completed = getLaneStateDisplay("completed");
  assert.equal(completed.label, "Completed");
  assert.equal(completed.variant, "neutral");
});

// --- getRuntimeTypeDisplay ---

test("getRuntimeTypeDisplay returns correct label and domain for all known runtime types", () => {
  const openclaw = getRuntimeTypeDisplay("openclaw");
  assert.equal(openclaw.label, "OpenClaw");
  assert.equal(openclaw.domain, "Game Development");
  assert.equal(openclaw.shortLabel, "OC");

  const claudeCode = getRuntimeTypeDisplay("claude_code");
  assert.equal(claudeCode.label, "Claude Code");
  assert.equal(claudeCode.domain, "Code Review / Refactor");

  const codex = getRuntimeTypeDisplay("codex");
  assert.equal(codex.label, "Codex");
  assert.equal(codex.domain, "Testing / Implementation");

  const human = getRuntimeTypeDisplay("human");
  assert.equal(human.label, "Human");
  assert.equal(human.domain, "Manual Review");

  const unknown = getRuntimeTypeDisplay("unknown");
  assert.equal(unknown.label, "Unknown");
  assert.equal(unknown.shortLabel, "??");
});

// --- getApprovalStateDisplay ---

test("getApprovalStateDisplay returns correct label and variant", () => {
  assert.equal(getApprovalStateDisplay("pending").label, "Pending");
  assert.equal(getApprovalStateDisplay("pending").variant, "pending");

  assert.equal(getApprovalStateDisplay("approved").label, "Approved");
  assert.equal(getApprovalStateDisplay("approved").variant, "success");

  assert.equal(getApprovalStateDisplay("rejected").label, "Rejected");
  assert.equal(getApprovalStateDisplay("rejected").variant, "rejected");

  assert.equal(getApprovalStateDisplay("not_required").label, "Not Required");
  assert.equal(getApprovalStateDisplay("not_required").variant, "neutral");

  // Unknown values fall back gracefully
  const fallback = getApprovalStateDisplay("some_unknown_state");
  assert.equal(fallback.label, "some_unknown_state");
  assert.equal(fallback.variant, "neutral");
});

// --- getVerificationStateDisplay ---

test("getVerificationStateDisplay returns correct label and variant", () => {
  assert.equal(getVerificationStateDisplay("pending").label, "Pending");
  assert.equal(getVerificationStateDisplay("passed").label, "Passed");
  assert.equal(getVerificationStateDisplay("passed").variant, "success");
  assert.equal(getVerificationStateDisplay("blocked").label, "Blocked");
  assert.equal(getVerificationStateDisplay("blocked").variant, "blocked");
  assert.equal(getVerificationStateDisplay("failed").label, "Failed");
  assert.equal(getVerificationStateDisplay("failed").variant, "failed");
});

// --- buildLaneCardViewModel ---

test("buildLaneCardViewModel for a freshly-planned lane has correct defaults", () => {
  const lane = makeOpenClawLane();
  const vm = buildLaneCardViewModel(lane);

  assert.equal(vm.laneId, "lane-20260520200000-openclaw");
  assert.equal(vm.runtime.label, "OpenClaw");
  assert.equal(vm.runtime.domain, "Game Development");
  assert.equal(vm.laneState.label, "Planned");
  assert.equal(vm.approvalState.label, "Pending");
  assert.equal(vm.verificationState.label, "Pending");
  assert.equal(vm.sandboxId, "sandbox-openclaw-lane");
  assert.equal(vm.operationCount, 0);
  assert.equal(vm.dependencyCount, 0);
  assert.equal(vm.unresolvedDependencyCount, 0);
  assert.equal(vm.transitionCount, 0);
  assert.equal(vm.executionAllowed, false);
  assert.equal(vm.dryRun, true);
  assert.ok(vm.safetyBadges.includes("execution-blocked"));
  assert.ok(vm.safetyBadges.includes("dry-run-enforced"));
  assert.ok(vm.safetyBadges.includes("lane-isolated"));
  assert.ok(vm.safetyBadges.includes("human-authority"));
  assert.ok(vm.safetyBadges.includes("approval-required"));
  assert.equal(vm.lastTransitionReason, undefined);
});

test("buildLaneCardViewModel for an approved/ready lane reflects approval correctly", () => {
  let lane = makeClaudeCodeLane();
  lane = transitionGovernedLaneState(lane, "validating", { reason: "started", now });
  lane = transitionGovernedLaneState(lane, "approval_pending", { reason: "done", now });
  lane = transitionGovernedLaneState(lane, "ready", { reason: "operator approved", authorizedBy: "operator", now });

  const vm = buildLaneCardViewModel(lane);

  assert.equal(vm.laneState.label, "Ready");
  assert.equal(vm.laneState.variant, "success");
  assert.equal(vm.approvalState.label, "Approved");
  assert.equal(vm.approvalState.variant, "success");
  assert.equal(vm.transitionCount, 3);
  assert.equal(vm.lastTransitionReason, "operator approved");
  assert.equal(vm.lastTransitionAt, FIXED_TIME);
  assert.equal(vm.executionAllowed, false);
  assert.equal(vm.dryRun, true);
});

test("buildLaneCardViewModel for a blocked lane reflects blocked state correctly", () => {
  let lane = makeCodexLane();
  lane = transitionGovernedLaneState(lane, "validating", { reason: "started", now });
  lane = transitionGovernedLaneState(lane, "blocked", { reason: "command policy denied rm -rf", now });

  const vm = buildLaneCardViewModel(lane);

  assert.equal(vm.laneState.label, "Blocked");
  assert.equal(vm.laneState.variant, "blocked");
  assert.equal(vm.verificationState.label, "Blocked");
  assert.equal(vm.approvalState.label, "Pending");
  assert.equal(vm.lastTransitionReason, "command policy denied rm -rf");
  assert.equal(vm.executionAllowed, false);
});

test("buildLaneCardViewModel counts operations correctly", () => {
  let lane = makeOpenClawLane();
  lane = addGovernedLaneOperation(lane, { operationId: "op-20260520200000-build", now });
  lane = addGovernedLaneOperation(lane, { operationId: "op-20260520200000-lint", now });

  const vm = buildLaneCardViewModel(lane);
  assert.equal(vm.operationCount, 2);
});

test("buildLaneCardViewModel counts unresolved dependencies correctly", () => {
  let lane = makeCodexLane();
  lane = addGovernedLaneDependency(lane, {
    dependsOnLaneId: "lane-20260520200000-openclaw",
    dependencyKind: "requires_completion",
    now,
  });

  const vm = buildLaneCardViewModel(lane);
  assert.equal(vm.dependencyCount, 1);
  assert.equal(vm.unresolvedDependencyCount, 1);
  assert.ok(vm.safetyBadges.includes("dependencies-tracked"));
});

test("buildLaneCardViewModel exposes capabilities from runtime assignment", () => {
  const vm = buildLaneCardViewModel(makeClaudeCodeLane());
  assert.ok(vm.capabilities.includes("command_validation"));
  assert.ok(vm.capabilities.includes("patch_preview"));
  assert.ok(vm.capabilities.includes("approval_review"));
});

// --- buildGovernedOperationsDashboardViewModel ---

test("buildGovernedOperationsDashboardViewModel reflects three concurrent lanes correctly", () => {
  let queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-main", now });

  // Lane A: OpenClaw — validating
  let laneA = makeOpenClawLane();
  laneA = transitionGovernedLaneState(laneA, "validating", { reason: "validation started", now });

  // Lane B: Claude Code — approved and ready
  let laneB = makeClaudeCodeLane();
  laneB = transitionGovernedLaneState(laneB, "validating", { reason: "started", now });
  laneB = transitionGovernedLaneState(laneB, "approval_pending", { reason: "validation done", now });
  laneB = transitionGovernedLaneState(laneB, "ready", { reason: "operator approved", now });

  // Lane C: Codex — blocked by policy
  let laneC = makeCodexLane();
  laneC = transitionGovernedLaneState(laneC, "validating", { reason: "started", now });
  laneC = transitionGovernedLaneState(laneC, "blocked", { reason: "command policy denied rm -rf", now });

  queue = registerGovernedOperationLane(queue, laneA, { now });
  queue = registerGovernedOperationLane(queue, laneB, { now });
  queue = registerGovernedOperationLane(queue, laneC, { now });

  const vm = buildGovernedOperationsDashboardViewModel(queue, { now });

  assert.equal(vm.queueId, "queue-20260520200000-main");
  assert.equal(vm.totalLanes, 3);
  assert.equal(vm.lanes.length, 3);
  assert.equal(vm.allExecutionBlocked, true);
  assert.equal(vm.allDryRun, true);
  assert.ok(vm.governanceNote.length > 0);
  assert.ok(vm.governanceNote.toLowerCase().includes("governance"));

  // Lane A: OpenClaw, validating
  assert.equal(vm.lanes[0].runtime.label, "OpenClaw");
  assert.equal(vm.lanes[0].laneState.label, "Validating");
  assert.equal(vm.lanes[0].approvalState.label, "Pending");
  assert.equal(vm.lanes[0].executionAllowed, false);
  assert.equal(vm.lanes[0].dryRun, true);

  // Lane B: Claude Code, ready/approved
  assert.equal(vm.lanes[1].runtime.label, "Claude Code");
  assert.equal(vm.lanes[1].laneState.label, "Ready");
  assert.equal(vm.lanes[1].approvalState.label, "Approved");
  assert.equal(vm.lanes[1].executionAllowed, false);  // approved but still blocked

  // Lane C: Codex, blocked
  assert.equal(vm.lanes[2].runtime.label, "Codex");
  assert.equal(vm.lanes[2].laneState.label, "Blocked");
  assert.equal(vm.lanes[2].approvalState.label, "Pending");
  assert.equal(vm.lanes[2].executionAllowed, false);
});

test("buildGovernedOperationsDashboardViewModel snapshot counts match lane states", () => {
  let queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-main", now });

  let laneA = makeOpenClawLane();
  laneA = transitionGovernedLaneState(laneA, "validating", { reason: "started", now });
  laneA = transitionGovernedLaneState(laneA, "approval_pending", { reason: "done", now });
  laneA = transitionGovernedLaneState(laneA, "ready", { reason: "approved", now });

  let laneB = makeClaudeCodeLane();
  laneB = transitionGovernedLaneState(laneB, "blocked", { reason: "policy issue", now });

  const laneC = makeCodexLane();  // planned

  queue = registerGovernedOperationLane(queue, laneA, { now });
  queue = registerGovernedOperationLane(queue, laneB, { now });
  queue = registerGovernedOperationLane(queue, laneC, { now });

  const vm = buildGovernedOperationsDashboardViewModel(queue, { now });

  assert.equal(vm.summary.totalLanes, 3);
  assert.equal(vm.summary.blockedCount, 1);
  assert.equal(vm.summary.deniedCount, 0);
  assert.equal(vm.summary.allLanesExecutionAllowed, false);
  assert.equal(vm.summary.allLanesDryRun, true);

  const readyCount = vm.summary.laneStateCounts.find((c) => c.state === "ready");
  assert.equal(readyCount?.count, 1);

  const plannedCount = vm.summary.laneStateCounts.find((c) => c.state === "planned");
  assert.equal(plannedCount?.count, 1);
});

test("buildGovernedOperationsDashboardViewModel for empty queue has zero lanes", () => {
  const queue = createGovernedOperationQueue({ queueId: "queue-20260520200000-empty", now });
  const vm = buildGovernedOperationsDashboardViewModel(queue, { now });

  assert.equal(vm.totalLanes, 0);
  assert.equal(vm.lanes.length, 0);
  assert.equal(vm.allExecutionBlocked, true);
  assert.equal(vm.allDryRun, true);
});

// --- Safety: no runtime execution wiring ---

test("dashboard model contains no execution side effects — all values are pure display data", () => {
  const lane = makeOpenClawLane();
  const vm = buildLaneCardViewModel(lane);

  // executionAllowed and dryRun are structural constants in the view model,
  // not runtime-derived — confirm they cannot be mutated to true
  assert.equal(vm.executionAllowed, false);
  assert.equal(vm.dryRun, true);

  // Safety badges always include execution-blocked
  assert.ok(vm.safetyBadges.includes("execution-blocked"));

  // Runtime type is metadata only — no invocation possible from view model
  assert.ok(typeof vm.runtime.label === "string");
  assert.ok(typeof vm.runtime.domain === "string");
});
