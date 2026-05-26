// AI-E GOVERNED PROPOSAL REPLAY REGISTRY TESTS (EXEC-0052-F)
// Tests for proposal-scoped replay protection across sandbox boundaries.
// Verifies all three replay guards and cross-sandbox rejection behavior.

import assert from "node:assert/strict";
import { test } from "node:test";
import nodePath from "node:path";

import {
  createGovernedProposalReplayRegistry,
  createProposalExecutionFingerprint,
  makeProposalReplayRejectionReceipt,
  recordProposalExecution,
  verifyProposalNotReplayed,
  type ProposalExecutionRecord,
} from "./governedProposalReplayRegistry";
import { executeSandboxGameplayConfigDispatch } from "./sandboxGameplayConfigDispatch";
import { executeSandboxUnityScriptDispatch } from "./sandboxUnityScriptDispatch";

// =====================================================================================
// SHARED TEST FIXTURES
// =====================================================================================

const FIXED_TIME = "2026-05-22T14:00:00.000Z";
const EXPIRES_FUTURE = "2026-05-22T15:00:00.000Z";
const REPO_ROOT = nodePath.resolve("E:/test-ai-e-exec0052f-replay");
const PROPOSAL_A = "proposal-exec0052f-alpha";
const PROPOSAL_B = "proposal-exec0052f-beta";
const TOKEN_A = "operator-approved";
const OP_REQ = "apply gameplay tuning";

function makeSharedInMemoryFs() {
  const files = new Map<string, string>();
  return {
    createDirectory: async (_p: string) => { /* no-op */ },
    writeFile: async (p: string, c: string) => { files.set(p, c); },
    readFile: async (p: string) => files.get(p) ?? null,
    listDirectory: async (p: string) => {
      const entries: { name: string; kind: "file"; sizeBytes: number; modifiedAt: string }[] = [];
      for (const [key, value] of files) {
        if (key.startsWith(p + "/") || key.startsWith(p + nodePath.sep)) {
          const name = key.slice(p.length + 1).split(/[/\\]/)[0];
          if (name && !name.includes("/") && !name.includes("\\")) {
            entries.push({ name, kind: "file", sizeBytes: Buffer.byteLength(value), modifiedAt: FIXED_TIME });
          }
        }
      }
      return entries;
    },
    getFileSize: async (p: string) => Buffer.byteLength(files.get(p) ?? ""),
  };
}

// =====================================================================================
// UNIT TESTS: Registry functions
// =====================================================================================

test("createGovernedProposalReplayRegistry returns empty registry", () => {
  const reg = createGovernedProposalReplayRegistry();
  assert.equal(reg.records.size, 0);
  assert.equal(reg.proposalIds.size, 0);
});

test("createProposalExecutionFingerprint produces deterministic string", () => {
  const fp1 = createProposalExecutionFingerprint({
    proposalId: "p1",
    approvalToken: "tok1",
    operationRequest: "op1",
  });
  const fp2 = createProposalExecutionFingerprint({
    proposalId: "p1",
    approvalToken: "tok1",
    operationRequest: "op1",
  });
  assert.equal(fp1, fp2);
  assert.match(fp1, /p1::tok1::op1/);
});

test("verifyProposalNotReplayed returns isReplay=false for fresh registry", () => {
  const reg = createGovernedProposalReplayRegistry();
  const result = verifyProposalNotReplayed(reg, {
    proposalId: PROPOSAL_A,
    approvalToken: TOKEN_A,
    operationRequest: OP_REQ,
  }, FIXED_TIME);
  assert.equal(result.isReplay, false);
  assert.ok(!result.reason);
  assert.ok(!result.existingRecord);
});

test("recordProposalExecution adds to all indexes", () => {
  const reg = createGovernedProposalReplayRegistry();
  const fp = createProposalExecutionFingerprint({
    proposalId: PROPOSAL_A, approvalToken: TOKEN_A, operationRequest: OP_REQ,
  });
  const record: ProposalExecutionRecord = {
    fingerprint: fp,
    proposalId: PROPOSAL_A,
    approvalToken: TOKEN_A,
    operationRequest: OP_REQ,
    sandboxId: "sandbox-test-a",
    dispatchId: "dispatch-001",
    invocationId: "invocation-001",
    runtimeType: "openclaw",
    adapterId: "openclaw-sandbox-gameplay-config-v1",
    outcome: "completed",
    executedAt: FIXED_TIME,
    operatorId: "operator",
  };
  recordProposalExecution(reg, record);
  assert.equal(reg.records.size, 1);
  assert.ok(reg.proposalIds.has(PROPOSAL_A));
});

test("verifyProposalNotReplayed detects fingerprint match", () => {
  const reg = createGovernedProposalReplayRegistry();
  const fp = createProposalExecutionFingerprint({
    proposalId: PROPOSAL_A, approvalToken: TOKEN_A, operationRequest: OP_REQ,
  });
  recordProposalExecution(reg, {
    fingerprint: fp, proposalId: PROPOSAL_A, approvalToken: TOKEN_A,
    operationRequest: OP_REQ, sandboxId: "sandbox-a", dispatchId: "d1",
    invocationId: "i1", runtimeType: "openclaw", adapterId: "adapter-a",
    outcome: "completed", executedAt: FIXED_TIME, operatorId: "operator",
  });
  const result = verifyProposalNotReplayed(reg, {
    proposalId: PROPOSAL_A, approvalToken: TOKEN_A, operationRequest: OP_REQ,
  });
  assert.equal(result.isReplay, true);
  assert.equal(result.reason, "proposal-fingerprint-already-executed");
  assert.ok(result.existingRecord);
});

test("verifyProposalNotReplayed detects proposalId match across different operations", () => {
  const reg = createGovernedProposalReplayRegistry();
  const fp = createProposalExecutionFingerprint({
    proposalId: PROPOSAL_A, approvalToken: TOKEN_A, operationRequest: OP_REQ,
  });
  recordProposalExecution(reg, {
    fingerprint: fp, proposalId: PROPOSAL_A, approvalToken: TOKEN_A,
    operationRequest: OP_REQ, sandboxId: "sandbox-a", dispatchId: "d1",
    invocationId: "i1", runtimeType: "openclaw", adapterId: "adapter-a",
    outcome: "completed", executedAt: FIXED_TIME, operatorId: "operator",
  });
  // Same proposalId but DIFFERENT sandbox, operation request, and token
  const result = verifyProposalNotReplayed(reg, {
    proposalId: PROPOSAL_A, approvalToken: "fresh-token", operationRequest: "different-op",
  });
  assert.equal(result.isReplay, true);
  assert.equal(result.reason, "proposal-id-already-executed");
});

test("different proposal IDs are not flagged as replay (was: different IDs and tokens)", () => {
  // This test was previously verifying different IDs and tokens. Now verifies different proposalId allows new execution.
  const reg = createGovernedProposalReplayRegistry();
  const fp = createProposalExecutionFingerprint({
    proposalId: PROPOSAL_A, approvalToken: TOKEN_A, operationRequest: OP_REQ,
  });
  recordProposalExecution(reg, {
    fingerprint: fp, proposalId: PROPOSAL_A, approvalToken: TOKEN_A,
    operationRequest: OP_REQ, sandboxId: "sandbox-a", dispatchId: "d1",
    invocationId: "i1", runtimeType: "openclaw", adapterId: "adapter-a",
    outcome: "completed", executedAt: FIXED_TIME, operatorId: "operator",
  });
  const result = verifyProposalNotReplayed(reg, {
    proposalId: PROPOSAL_B, approvalToken: "fresh-token", operationRequest: "different-op",
  });
  assert.equal(result.isReplay, false);
});

test("makeProposalReplayRejectionReceipt builds correct receipt", () => {
  const fp = createProposalExecutionFingerprint({
    proposalId: PROPOSAL_A, approvalToken: TOKEN_A, operationRequest: OP_REQ,
  });
  const originalRecord: ProposalExecutionRecord = {
    fingerprint: fp, proposalId: PROPOSAL_A, approvalToken: TOKEN_A,
    operationRequest: OP_REQ, sandboxId: "sandbox-orig", dispatchId: "d-orig",
    invocationId: "i-orig", runtimeType: "openclaw", adapterId: "adapter-a",
    outcome: "completed", executedAt: FIXED_TIME, operatorId: "operator",
  };
  const receipt = makeProposalReplayRejectionReceipt({
    proposalId: PROPOSAL_A,
    originalRecord,
    attemptedAt: FIXED_TIME,
    operatorId: "operator",
    replayFingerprint: fp,
    reason: "proposal-id-already-executed",
  });
  assert.equal(receipt.proposalId, PROPOSAL_A);
  assert.equal(receipt.originalDispatchId, "d-orig");
  assert.equal(receipt.originalSandboxId, "sandbox-orig");
  assert.equal(receipt.originalRuntimeType, "openclaw");
  assert.equal(receipt.replayRejectionReason, "proposal-id-already-executed");
  assert.equal(receipt.replayFingerprint, fp);
});

// =====================================================================================
// INTEGRATION TESTS: Cross-sandbox replay rejection in dispatch
// =====================================================================================

function makeGameplayRequest(opts: {
  proposalId: string;
  sandboxId: string;
  now: string;
  registry?: typeof import("./governedProposalReplayRegistry").proposalReplayRegistry;
}) {
  const fs = makeSharedInMemoryFs();
  return {
    sandboxId: opts.sandboxId,
    repositoryRoot: REPO_ROOT,
    approvalToken: "operator-approved",
    authorization: {
      authorityToken: "operator-approved" as const,
      approvedBy: "operator",
      approvedAt: opts.now,
      proposalId: opts.proposalId,
      operationRequest: "apply gameplay tuning",
    },
    expiresAt: EXPIRES_FUTURE,
    operatorId: "operator",
    operationRequest: "apply gameplay tuning",
    now: () => opts.now,
    filesystem: fs,
  };
}

function makeUnityRequest(opts: {
  proposalId: string;
  sandboxId: string;
  now: string;
}) {
  const fs = makeSharedInMemoryFs();
  return {
    sandboxId: opts.sandboxId,
    repositoryRoot: REPO_ROOT,
    approvalToken: "operator-approved",
    authorization: {
      authorityToken: "operator-approved" as const,
      approvedBy: "operator",
      approvedAt: opts.now,
      proposalId: opts.proposalId,
      operationRequest: "apply Unity script mutation",
    },
    expiresAt: EXPIRES_FUTURE,
    operatorId: "operator",
    operationRequest: "apply Unity script mutation",
    now: () => opts.now,
    filesystem: fs,
  };
}

test("gameplay dispatch succeeds on first execution and records proposal", async () => {
  const req = makeGameplayRequest({
    proposalId: `proposal-${Date.now()}-gameplay-first`,
    sandboxId: `sandbox-exec0052f-${Date.now()}-gameplay-first`,
    now: FIXED_TIME,
  });
  const result = await executeSandboxGameplayConfigDispatch(req);
  assert.equal(result.outcome, "completed");
  assert.equal(result.manifestVersion, "EXEC-0052-D");
  assert.ok(!result.proposalReplayRejectionReceipt);
});

test("gameplay dispatch rejects same proposal replayed in a fresh sandbox", async () => {
  const proposalId = `proposal-${Date.now()}-gameplay-cross-sandbox`;
  const req1 = makeGameplayRequest({
    proposalId,
    sandboxId: `sandbox-exec0052f-${Date.now()}-first`,
    now: FIXED_TIME,
  });
  const result1 = await executeSandboxGameplayConfigDispatch(req1);
  assert.equal(result1.outcome, "completed", "First dispatch must succeed");

  // New sandbox, same proposalId — should be rejected
  const req2 = makeGameplayRequest({
    proposalId,
    sandboxId: `sandbox-exec0052f-${Date.now()}-second`,
    now: "2026-05-22T14:01:00.000Z",
  });
  const result2 = await executeSandboxGameplayConfigDispatch(req2);
  assert.equal(result2.outcome, "rejected", "Replay with new sandbox must be rejected");
  assert.ok(result2.proposalReplayRejectionReceipt, "Rejection receipt must be present");
  assert.equal(result2.proposalReplayRejectionReceipt!.proposalId, proposalId);
  assert.ok(result2.proposalReplayRejectionReceipt!.originalDispatchId);
  assert.ok(result2.proposalReplayRejectionReceipt!.originalSandboxId);
});

test("gameplay dispatch replay_rejected lifecycle has correct states", async () => {
  const proposalId = `proposal-${Date.now()}-gameplay-lifecycle`;
  const req1 = makeGameplayRequest({
    proposalId,
    sandboxId: `sandbox-exec0052f-${Date.now()}-lc-first`,
    now: FIXED_TIME,
  });
  await executeSandboxGameplayConfigDispatch(req1);

  const req2 = makeGameplayRequest({
    proposalId,
    sandboxId: `sandbox-exec0052f-${Date.now()}-lc-second`,
    now: "2026-05-22T14:02:00.000Z",
  });
  const result = await executeSandboxGameplayConfigDispatch(req2);
  assert.equal(result.outcome, "rejected");
  const states = result.lifecycle.records.map((r) => r.state);
  assert.ok(states.includes("queued"), "lifecycle must include queued");
  assert.ok(states.includes("authorization_verified"), "lifecycle must include authorization_verified");
  assert.ok(states.includes("replay_rejected"), "lifecycle must include replay_rejected");
  assert.equal(result.lifecycle.currentState, "replay_rejected");
});

test("gameplay dispatch successful execution includes replay_verified in lifecycle", async () => {
  const req = makeGameplayRequest({
    proposalId: `proposal-${Date.now()}-gameplay-replay-verified`,
    sandboxId: `sandbox-exec0052f-${Date.now()}-rv`,
    now: FIXED_TIME,
  });
  const result = await executeSandboxGameplayConfigDispatch(req);
  assert.equal(result.outcome, "completed");
  const states = result.lifecycle.records.map((r) => r.state);
  assert.ok(states.includes("replay_verified"), "lifecycle must include replay_verified on success");
  const authIdx = states.indexOf("authorization_verified");
  const replayIdx = states.indexOf("replay_verified");
  assert.ok(authIdx !== -1 && replayIdx !== -1);
  assert.ok(replayIdx > authIdx, "replay_verified must come after authorization_verified");
});

test("unity script dispatch rejects same proposal in fresh sandbox", async () => {
  const proposalId = `proposal-${Date.now()}-unity-cross-sandbox`;
  const req1 = makeUnityRequest({
    proposalId,
    sandboxId: `sandbox-exec0052f-${Date.now()}-unity-first`,
    now: FIXED_TIME,
  });
  const result1 = await executeSandboxUnityScriptDispatch(req1);
  assert.equal(result1.outcome, "completed", "First Unity dispatch must succeed");

  const req2 = makeUnityRequest({
    proposalId,
    sandboxId: `sandbox-exec0052f-${Date.now()}-unity-second`,
    now: "2026-05-22T14:03:00.000Z",
  });
  const result2 = await executeSandboxUnityScriptDispatch(req2);
  assert.equal(result2.outcome, "rejected", "Replay in new sandbox must be rejected");
  assert.ok(result2.proposalReplayRejectionReceipt);
  assert.equal(result2.proposalReplayRejectionReceipt!.proposalId, proposalId);
  assert.ok(result2.proposalReplayRejectionReceipt!.originalSandboxId.startsWith("sandbox-"));
});

test("unity script dispatch includes replay_verified in successful lifecycle", async () => {
  const req = makeUnityRequest({
    proposalId: `proposal-${Date.now()}-unity-rv`,
    sandboxId: `sandbox-exec0052f-${Date.now()}-unity-rv`,
    now: FIXED_TIME,
  });
  const result = await executeSandboxUnityScriptDispatch(req);
  assert.equal(result.outcome, "completed");
  const states = result.lifecycle.records.map((r) => r.state);
  assert.ok(states.includes("replay_verified"));
  const authIdx = states.indexOf("authorization_verified");
  const replayIdx = states.indexOf("replay_verified");
  assert.ok(replayIdx > authIdx);
});

test("separate proposals with unique IDs and tokens are not blocked", async () => {
  const req1 = makeGameplayRequest({
    proposalId: `proposal-${Date.now()}-independent-a`,
    sandboxId: `sandbox-exec0052f-${Date.now()}-ind-a`,
    now: FIXED_TIME,
  });
  const req2 = makeGameplayRequest({
    proposalId: `proposal-${Date.now()}-independent-b`,
    sandboxId: `sandbox-exec0052f-${Date.now()}-ind-b`,
    now: "2026-05-22T14:04:00.000Z",
  });
  const [r1, r2] = await Promise.all([
    executeSandboxGameplayConfigDispatch(req1),
    executeSandboxGameplayConfigDispatch(req2),
  ]);
  assert.equal(r1.outcome, "completed");
  assert.equal(r2.outcome, "completed");
});

test("replay rejection receipt includes original sandbox id and dispatch id", async () => {
  const proposalId = `proposal-${Date.now()}-receipt-check`;
  const firstSandboxId = `sandbox-exec0052f-${Date.now()}-receipt-first`;
  const req1 = makeGameplayRequest({
    proposalId,
    sandboxId: firstSandboxId,
    now: FIXED_TIME,
  });
  const result1 = await executeSandboxGameplayConfigDispatch(req1);
  assert.equal(result1.outcome, "completed");

  const req2 = makeGameplayRequest({
    proposalId,
    sandboxId: `sandbox-exec0052f-${Date.now()}-receipt-second`,
    now: "2026-05-22T14:05:00.000Z",
  });
  const result2 = await executeSandboxGameplayConfigDispatch(req2);
  assert.equal(result2.outcome, "rejected");
  const receipt = result2.proposalReplayRejectionReceipt!;
  assert.equal(receipt.originalSandboxId, firstSandboxId);
  assert.equal(receipt.originalDispatchId, result1.dispatchId);
  assert.equal(receipt.originalRuntimeType, "openclaw");
  assert.ok(receipt.replayFingerprint);
  assert.ok(receipt.attemptedAt);
  assert.ok(receipt.operatorId);
});
