import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  createGovernedOperationLane,
  createGovernedRuntimeAssignment,
  transitionGovernedLaneState,
  addGovernedLaneOperation,
} from "./governedOperationLane";
import {
  GOVERNED_RUNTIME_ADAPTER_VERSION,
  buildRuntimeExecutionIntent,
  buildRuntimeInvocationRequest,
  checkRuntimeCapabilityMatch,
  checkRuntimeInvocationEligibility,
  createGovernedRuntimeAdapter,
  simulateRuntimeInvocation,
} from "./governedRuntimeAdapter";
import { validateGovernedRuntimeOperation } from "./governedRuntimeValidation";

const FIXED_TIME = "2026-05-20T20:00:00.000Z";
const now = () => FIXED_TIME;
const REPO_ROOT = path.resolve("E:/test-ai-e");

// ---- Fixtures ----

function makeOpenClawLane(extra?: Partial<{ sandboxId: string }>) {
  const sandboxId = extra?.sandboxId ?? "sandbox-openclaw-exec-0046";
  const assignment = createGovernedRuntimeAssignment({
    runtimeId: "runtime-20260520200000-openclaw",
    runtimeType: "openclaw",
    runtimeCapabilities: ["command_validation", "file_inspection", "build_execution"],
    sandboxId,
    approvalRequired: true,
    now,
  });
  return createGovernedOperationLane({
    laneId: "lane-20260520200000-openclaw",
    runtimeAssignment: assignment,
    now,
  });
}

function makeCodexLane() {
  const assignment = createGovernedRuntimeAssignment({
    runtimeId: "runtime-20260520200000-codex",
    runtimeType: "codex",
    runtimeCapabilities: ["command_validation", "test_execution"],
    sandboxId: "sandbox-codex-exec-0046",
    approvalRequired: true,
    now,
  });
  return createGovernedOperationLane({
    laneId: "lane-20260520200000-codex",
    runtimeAssignment: assignment,
    now,
  });
}

function readyLane() {
  let lane = makeOpenClawLane();
  lane = transitionGovernedLaneState(lane, "validating", { reason: "started", now });
  lane = transitionGovernedLaneState(lane, "approval_pending", { reason: "validation done", now });
  lane = transitionGovernedLaneState(lane, "ready", { reason: "operator approved", authorizedBy: "operator", now });
  return lane;
}

// --- checkRuntimeCapabilityMatch ---

test("checkRuntimeCapabilityMatch returns isMatch=true when all required capabilities are present", () => {
  const lane = makeOpenClawLane();
  const match = checkRuntimeCapabilityMatch(
    lane.runtimeAssignment,
    ["command_validation", "file_inspection"],
  );

  assert.equal(match.isMatch, true);
  assert.equal(match.matchedCapabilities.length, 2);
  assert.equal(match.unmatchedCapabilities.length, 0);
  assert.equal(match.matchRatio, 1);
  assert.equal(match.runtimeType, "openclaw");
});

test("checkRuntimeCapabilityMatch returns isMatch=false when capabilities are missing", () => {
  const lane = makeOpenClawLane();
  const match = checkRuntimeCapabilityMatch(
    lane.runtimeAssignment,
    ["command_validation", "patch_preview"],  // patch_preview not in openclaw
  );

  assert.equal(match.isMatch, false);
  assert.ok(match.unmatchedCapabilities.includes("patch_preview"));
  assert.equal(match.matchedCapabilities.length, 1);
  assert.equal(match.matchRatio, 0.5);
});

test("checkRuntimeCapabilityMatch with empty requirements always returns isMatch=true with ratio 1", () => {
  const lane = makeOpenClawLane();
  const match = checkRuntimeCapabilityMatch(lane.runtimeAssignment, []);

  assert.equal(match.isMatch, true);
  assert.equal(match.matchRatio, 1);
  assert.equal(match.requiredCapabilities.length, 0);
  assert.equal(match.matchedCapabilities.length, 0);
  assert.equal(match.unmatchedCapabilities.length, 0);
});

// --- checkRuntimeInvocationEligibility ---

test("eligible=true for a ready lane with matching capabilities and approval", () => {
  const lane = readyLane();
  const eligibility = checkRuntimeInvocationEligibility(
    lane,
    ["command_validation", "build_execution"],
    { now },
  );

  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.blockers.length, 0);
  assert.equal(eligibility.executionAllowed, false);  // always false
  assert.equal(eligibility.simulationOnly, true);
  assert.equal(eligibility.laneState, "ready");
  assert.equal(eligibility.approvalState, "approved");
  assert.equal(eligibility.adapterVersion, GOVERNED_RUNTIME_ADAPTER_VERSION);
  assert.equal(eligibility.safetyBoundary.runtimeInvocationEnabled, false);
  assert.equal(eligibility.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(eligibility.safetyBoundary.eligibilityCheckOnly, true);
});

test("eligible=false and blocker=lane_not_ready for a planned lane", () => {
  const lane = makeOpenClawLane();  // in "planned" state
  const eligibility = checkRuntimeInvocationEligibility(lane, [], { now });

  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.blockers.includes("lane_not_ready"));
  assert.equal(eligibility.executionAllowed, false);
  assert.equal(eligibility.laneState, "planned");
});

test("eligible=false and blocker=approval_pending for a lane awaiting approval", () => {
  let lane = makeOpenClawLane();
  lane = transitionGovernedLaneState(lane, "validating", { reason: "started", now });
  lane = transitionGovernedLaneState(lane, "approval_pending", { reason: "done", now });

  const eligibility = checkRuntimeInvocationEligibility(lane, [], { now });

  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.blockers.includes("lane_not_ready"));
  assert.ok(eligibility.blockers.includes("approval_pending"));
  assert.equal(eligibility.executionAllowed, false);
});

test("eligible=false and blocker=lane_denied for a denied lane", () => {
  let lane = makeOpenClawLane();
  lane = transitionGovernedLaneState(lane, "denied", { reason: "policy violation", now });

  const eligibility = checkRuntimeInvocationEligibility(lane, [], { now });

  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.blockers.includes("lane_denied"));
  assert.equal(eligibility.executionAllowed, false);
});

test("eligible=false and blocker=lane_blocked for a blocked lane", () => {
  let lane = makeOpenClawLane();
  lane = transitionGovernedLaneState(lane, "validating", { reason: "started", now });
  lane = transitionGovernedLaneState(lane, "blocked", { reason: "command policy issue", now });

  const eligibility = checkRuntimeInvocationEligibility(lane, [], { now });

  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.blockers.includes("lane_blocked"));
  assert.equal(eligibility.executionAllowed, false);
});

test("eligible=false and blocker=capability_mismatch when runtime lacks required capability", () => {
  const lane = readyLane();  // openclaw: command_validation, file_inspection, build_execution
  const eligibility = checkRuntimeInvocationEligibility(
    lane,
    ["patch_preview"],  // not in openclaw capabilities
    { now },
  );

  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.blockers.includes("capability_mismatch"));
  assert.equal(eligibility.executionAllowed, false);
  assert.equal(eligibility.capabilityMatch.isMatch, false);
  assert.ok(eligibility.capabilityMatch.unmatchedCapabilities.includes("patch_preview"));
});

test("eligible=false and blocker=approval_rejected for a rejected lane", () => {
  let lane = makeOpenClawLane();
  lane = transitionGovernedLaneState(lane, "validating", { reason: "started", now });
  // Go directly to denied — which sets approvalState to rejected
  lane = transitionGovernedLaneState(lane, "blocked", { reason: "issue", now });
  lane = transitionGovernedLaneState(lane, "denied", { reason: "irrecoverable", now });

  const eligibility = checkRuntimeInvocationEligibility(lane, [], { now });

  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.blockers.includes("lane_denied"));
  assert.ok(eligibility.blockers.includes("approval_rejected"));
  assert.equal(eligibility.executionAllowed, false);
});

// --- buildRuntimeExecutionIntent ---

test("buildRuntimeExecutionIntent returns simulation_ready for an approved ready lane", () => {
  const lane = readyLane();
  const intent = buildRuntimeExecutionIntent(lane, { now });

  assert.equal(intent.adapterVersion, GOVERNED_RUNTIME_ADAPTER_VERSION);
  assert.equal(intent.laneId, "lane-20260520200000-openclaw");
  assert.equal(intent.runtimeType, "openclaw");
  assert.equal(intent.intentStatus, "simulation_ready");
  assert.equal(intent.executionAllowed, false);
  assert.equal(intent.dryRun, true);
  assert.equal(intent.safetyBoundary.runtimeInvocationEnabled, false);
  assert.equal(intent.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(intent.safetyBoundary.intentOnlyNoExecution, true);
  assert.equal(intent.safetyBoundary.executionOccurred, false);
  assert.match(intent.intentId, /^intent-/);
});

test("buildRuntimeExecutionIntent returns pending for a validating lane", () => {
  let lane = makeOpenClawLane();
  lane = transitionGovernedLaneState(lane, "validating", { reason: "started", now });
  const intent = buildRuntimeExecutionIntent(lane, { now });

  assert.equal(intent.intentStatus, "pending");
  assert.equal(intent.executionAllowed, false);
});

test("buildRuntimeExecutionIntent returns denied for a denied lane", () => {
  let lane = makeOpenClawLane();
  lane = transitionGovernedLaneState(lane, "denied", { reason: "policy", now });
  const intent = buildRuntimeExecutionIntent(lane, { now });

  assert.equal(intent.intentStatus, "denied");
  assert.equal(intent.executionAllowed, false);
});

test("buildRuntimeExecutionIntent includes operation ids from lane", () => {
  let lane = readyLane();
  lane = addGovernedLaneOperation(lane, { operationId: "op-20260520200000-build", now });
  lane = addGovernedLaneOperation(lane, { operationId: "op-20260520200000-lint", now });

  const intent = buildRuntimeExecutionIntent(lane, { validationResultRefs: ["val-ref-001"], now });

  assert.deepEqual(intent.operationIds, ["op-20260520200000-build", "op-20260520200000-lint"]);
  assert.deepEqual(intent.validationResultRefs, ["val-ref-001"]);
});

// --- buildRuntimeInvocationRequest ---

test("buildRuntimeInvocationRequest builds a non-dispatching request with correct shape", () => {
  const lane = readyLane();
  const request = buildRuntimeInvocationRequest(lane, {
    requiredCapabilities: ["command_validation"],
    proposedCommands: [{ command: "npm.cmd run build" }],
    now,
  });

  assert.equal(request.adapterVersion, GOVERNED_RUNTIME_ADAPTER_VERSION);
  assert.equal(request.laneId, "lane-20260520200000-openclaw");
  assert.equal(request.runtimeType, "openclaw");
  assert.equal(request.sandboxId, "sandbox-openclaw-exec-0046");
  assert.equal(request.approvalState, "approved");
  assert.equal(request.executionAllowed, false);
  assert.equal(request.dryRun, true);
  assert.deepEqual(request.requiredCapabilities, ["command_validation"]);
  assert.equal(request.proposedCommands.length, 1);
  assert.equal(request.proposedCommands[0].command, "npm.cmd run build");
  assert.match(request.requestId, /^req-/);
  assert.equal(request.safetyBoundary.requestOnlyNoDispatch, true);
  assert.equal(request.safetyBoundary.runtimeInvocationEnabled, false);
  assert.equal(request.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(request.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(request.safetyBoundary.workspaceMutationEnabled, false);
});

test("buildRuntimeInvocationRequest derives commands from lane operations with validation results", async () => {
  const validationResult = await validateGovernedRuntimeOperation({
    repositoryRoot: REPO_ROOT,
    sandboxId: "sandbox-openclaw-exec-0046",
    proposedCommands: [{ command: "npm.cmd run build" }],
    now,
  });

  let lane = readyLane();
  lane = addGovernedLaneOperation(lane, {
    operationId: "op-20260520200000-build",
    validationResult,
    now,
  });

  const request = buildRuntimeInvocationRequest(lane, { now });

  assert.equal(request.proposedCommands.length, 1);
  assert.equal(request.proposedCommands[0].command, "npm.cmd run build");
});

// --- simulateRuntimeInvocation ---

test("simulation for a ready approved lane produces status=simulated with no execution", () => {
  const lane = readyLane();
  const sim = simulateRuntimeInvocation(lane, { now });

  assert.equal(sim.adapterVersion, GOVERNED_RUNTIME_ADAPTER_VERSION);
  assert.equal(sim.laneId, "lane-20260520200000-openclaw");
  assert.equal(sim.runtimeType, "openclaw");
  assert.equal(sim.result.status, "simulated");
  assert.equal(sim.result.executionOccurred, false);
  assert.equal(sim.executionOccurred, false);
  assert.equal(sim.executionAllowed, false);
  assert.equal(sim.dryRun, true);
  assert.ok(sim.invocationRequest !== null);
  assert.ok(sim.eligibility.eligible);
  assert.equal(sim.eligibility.executionAllowed, false);
  assert.ok(sim.result.simulatedOutput?.includes("[SIMULATION]"));
  assert.ok(sim.simulationNote.length > 0);
  assert.match(sim.simulationId, /^sim-/);
  assert.equal(sim.safetyBoundary.simulationOnly, true);
  assert.equal(sim.safetyBoundary.runtimeInvocationEnabled, false);
  assert.equal(sim.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(sim.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(sim.safetyBoundary.workspaceMutationEnabled, false);
  assert.equal(sim.safetyBoundary.rollbackExecutionEnabled, false);
  assert.equal(sim.safetyBoundary.autonomousExecutionEnabled, false);
  assert.equal(sim.safetyBoundary.executionOccurred, false);
  assert.equal(sim.safetyBoundary.humanAuthorityRequired, true);
});

test("simulation for a planned lane produces status=eligibility_blocked and no invocation request", () => {
  const lane = makeOpenClawLane();
  const sim = simulateRuntimeInvocation(lane, { now });

  assert.equal(sim.result.status, "eligibility_blocked");
  assert.equal(sim.invocationRequest, null);
  assert.equal(sim.eligibility.eligible, false);
  assert.ok(sim.eligibility.blockers.includes("lane_not_ready"));
  assert.equal(sim.executionOccurred, false);
  assert.equal(sim.executionAllowed, false);
  assert.equal(sim.result.simulatedOutput, undefined);
  assert.ok(sim.simulationNote.includes("lane_not_ready"));
});

test("simulation for a denied lane produces status=denied and no invocation request", () => {
  let lane = makeOpenClawLane();
  lane = transitionGovernedLaneState(lane, "denied", { reason: "policy violation", now });
  const sim = simulateRuntimeInvocation(lane, { now });

  assert.equal(sim.result.status, "denied");
  assert.equal(sim.invocationRequest, null);
  assert.equal(sim.eligibility.eligible, false);
  assert.ok(sim.eligibility.blockers.includes("lane_denied"));
  assert.equal(sim.executionOccurred, false);
  assert.equal(sim.executionAllowed, false);
});

test("simulation for a blocked lane produces status=eligibility_blocked", () => {
  let lane = makeCodexLane();
  lane = transitionGovernedLaneState(lane, "validating", { reason: "started", now });
  lane = transitionGovernedLaneState(lane, "blocked", { reason: "command policy denied rm -rf", now });
  const sim = simulateRuntimeInvocation(lane, { now });

  assert.equal(sim.result.status, "eligibility_blocked");
  assert.equal(sim.invocationRequest, null);
  assert.ok(sim.eligibility.blockers.includes("lane_blocked"));
  assert.equal(sim.executionOccurred, false);
  assert.equal(sim.executionAllowed, false);
});

test("simulation with capability mismatch produces eligibility_blocked even for a ready lane", () => {
  const lane = readyLane();
  const sim = simulateRuntimeInvocation(lane, {
    requiredCapabilities: ["patch_preview"],  // not in openclaw
    now,
  });

  assert.equal(sim.result.status, "eligibility_blocked");
  assert.equal(sim.invocationRequest, null);
  assert.ok(sim.eligibility.blockers.includes("capability_mismatch"));
  assert.equal(sim.executionOccurred, false);
  assert.equal(sim.executionAllowed, false);
});

test("simulation produces an execution intent in all cases", () => {
  const planned = makeOpenClawLane();
  const planSim = simulateRuntimeInvocation(planned, { now });
  assert.ok(planSim.executionIntent !== null);
  assert.equal(planSim.executionIntent.intentStatus, "pending");
  assert.equal(planSim.executionIntent.executionAllowed, false);

  const ready = readyLane();
  const readySim = simulateRuntimeInvocation(ready, { now });
  assert.equal(readySim.executionIntent.intentStatus, "simulation_ready");
  assert.equal(readySim.executionIntent.executionAllowed, false);
});

test("caller-supplied simulationNote is preserved", () => {
  const lane = readyLane();
  const sim = simulateRuntimeInvocation(lane, {
    simulationNote: "Custom governance note for operator review.",
    now,
  });

  assert.equal(sim.simulationNote, "Custom governance note for operator review.");
});

// --- createGovernedRuntimeAdapter ---

test("createGovernedRuntimeAdapter returns a functional adapter binding", () => {
  const adapter = createGovernedRuntimeAdapter({
    runtimeType: "openclaw",
    runtimeId: "runtime-20260520200000-openclaw",
    capabilities: ["command_validation", "file_inspection", "build_execution"],
  });

  assert.equal(adapter.adapterVersion, GOVERNED_RUNTIME_ADAPTER_VERSION);
  assert.equal(adapter.runtimeType, "openclaw");
  assert.equal(adapter.runtimeId, "runtime-20260520200000-openclaw");
  assert.ok(adapter.capabilities.includes("command_validation"));
});

test("adapter.checkEligibility delegates correctly to checkRuntimeInvocationEligibility", () => {
  const adapter = createGovernedRuntimeAdapter({
    runtimeType: "openclaw",
    runtimeId: "runtime-20260520200000-openclaw",
    capabilities: ["command_validation", "file_inspection", "build_execution"],
  });

  const lane = readyLane();
  const eligibility = adapter.checkEligibility(lane, ["command_validation"], { now });

  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.executionAllowed, false);
  assert.equal(eligibility.adapterVersion, GOVERNED_RUNTIME_ADAPTER_VERSION);
});

test("adapter.simulate produces a simulation result with no execution", () => {
  const adapter = createGovernedRuntimeAdapter({
    runtimeType: "openclaw",
    runtimeId: "runtime-20260520200000-openclaw",
    capabilities: ["command_validation", "file_inspection", "build_execution"],
  });

  const lane = readyLane();
  const sim = adapter.simulate(lane, { now });

  assert.equal(sim.result.status, "simulated");
  assert.equal(sim.executionOccurred, false);
  assert.equal(sim.executionAllowed, false);
  assert.equal(sim.safetyBoundary.simulationOnly, true);
});

// --- Three-lane concurrent simulation scenario (from EXEC-0046 spec) ---

test("three concurrent lanes can all be simulated simultaneously with independent results", () => {
  // Lane A: OpenClaw — ready (eligible)
  const laneA = readyLane();

  // Lane B: Claude Code — approval pending (ineligible)
  const assignmentB = createGovernedRuntimeAssignment({
    runtimeId: "runtime-20260520200000-claude-code",
    runtimeType: "claude_code",
    runtimeCapabilities: ["command_validation", "patch_preview", "approval_review"],
    sandboxId: "sandbox-claudecode-exec-0046",
    approvalRequired: true,
    now,
  });
  let laneB = createGovernedOperationLane({
    laneId: "lane-20260520200000-claude-code",
    runtimeAssignment: assignmentB,
    now,
  });
  laneB = transitionGovernedLaneState(laneB, "validating", { reason: "started", now });
  laneB = transitionGovernedLaneState(laneB, "approval_pending", { reason: "done", now });

  // Lane C: Codex — blocked by policy
  let laneC = makeCodexLane();
  laneC = transitionGovernedLaneState(laneC, "validating", { reason: "started", now });
  laneC = transitionGovernedLaneState(laneC, "blocked", { reason: "rm -rf denied", now });

  const simA = simulateRuntimeInvocation(laneA, { now });
  const simB = simulateRuntimeInvocation(laneB, { now });
  const simC = simulateRuntimeInvocation(laneC, { now });

  // Lane A: OpenClaw — eligible, simulation_ready
  assert.equal(simA.runtimeType, "openclaw");
  assert.equal(simA.eligibility.eligible, true);
  assert.equal(simA.result.status, "simulated");
  assert.equal(simA.executionAllowed, false);
  assert.ok(simA.invocationRequest !== null);

  // Lane B: Claude Code — ineligible, approval_pending
  assert.equal(simB.runtimeType, "claude_code");
  assert.equal(simB.eligibility.eligible, false);
  assert.ok(simB.eligibility.blockers.includes("approval_pending"));
  assert.equal(simB.result.status, "eligibility_blocked");
  assert.equal(simB.executionAllowed, false);
  assert.equal(simB.invocationRequest, null);

  // Lane C: Codex — ineligible, blocked by policy
  assert.equal(simC.runtimeType, "codex");
  assert.equal(simC.eligibility.eligible, false);
  assert.ok(simC.eligibility.blockers.includes("lane_blocked"));
  assert.equal(simC.result.status, "eligibility_blocked");
  assert.equal(simC.executionAllowed, false);
  assert.equal(simC.invocationRequest, null);

  // All have the same safety boundary regardless of eligibility
  for (const sim of [simA, simB, simC]) {
    assert.equal(sim.executionOccurred, false);
    assert.equal(sim.dryRun, true);
    assert.equal(sim.safetyBoundary.simulationOnly, true);
    assert.equal(sim.safetyBoundary.runtimeInvocationEnabled, false);
    assert.equal(sim.safetyBoundary.humanAuthorityRequired, true);
  }
});

// --- Safety: executionAllowed never changes ---

test("executionAllowed and executionOccurred are always false across all result types", () => {
  const scenarios = [
    makeOpenClawLane(),                                 // planned
    (() => { let l = makeOpenClawLane(); return transitionGovernedLaneState(l, "validating", { reason: "go", now }); })(),
    readyLane(),                                        // ready + approved
    (() => { let l = makeOpenClawLane(); return transitionGovernedLaneState(l, "denied", { reason: "denied", now }); })(),
  ];

  for (const lane of scenarios) {
    const sim = simulateRuntimeInvocation(lane, { now });
    assert.equal(sim.executionAllowed, false, `executionAllowed must be false for laneState '${lane.laneState}'`);
    assert.equal(sim.executionOccurred, false, `executionOccurred must be false for laneState '${lane.laneState}'`);
    assert.equal(sim.result.executionOccurred, false);
    assert.equal(sim.dryRun, true);
    assert.equal(sim.eligibility.executionAllowed, false);
    assert.equal(sim.safetyBoundary.executionOccurred, false);
  }
});
