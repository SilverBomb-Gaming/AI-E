import assert from "node:assert/strict";
import test from "node:test";
import { authorizeDispatch, createDispatchIdempotencyKey, checkDispatchApprovalExpiry, checkDispatchReplayGuard, checkDispatchDuplicatePrevention } from "./dispatchAuthorizationBoundary";

// HACK: Reset the in-memory replay/duplicate map before each test for isolation
const resetReplayMap = () => {
  // @ts-expect-error: access internal test-only map
  const mod = require("./dispatchAuthorizationBoundary");
  if (mod && mod.__esModule && mod.dispatchReplayMap) {
    mod.dispatchReplayMap.clear();
  } else if (mod && mod.dispatchReplayMap) {
    mod.dispatchReplayMap.clear();
  }
};



const sandboxId = "sandbox-EXEC-0051-B-test";
const operationRequest = "Write governed proof file";

function makeApproval({
  authorityToken = "token-123" as any,
  approvedBy = "operator-1",
  approvedAt = "2026-05-21T00:00:00.000Z",
  proposalId = "proposal-0051-B-1",
  operationRequest,
}: {
  authorityToken?: any;
  approvedBy?: string;
  approvedAt?: string;
  proposalId?: string;
  operationRequest: string;
}) {
  return { authorityToken, approvedBy, approvedAt, proposalId, operationRequest };
}

const expiresAt = "2026-05-21T00:10:00.000Z";
const now = "2026-05-21T00:01:00.000Z";

test("authorizeDispatch grants authorization for fresh approval, first use", () => {
  resetReplayMap();
  const approval = makeApproval({ proposalId: "proposal-unique-1", approvedAt: "2026-05-21T00:01:00.000Z", operationRequest });
  const receipt = authorizeDispatch({ approval, sandboxId, operationRequest, expiresAt, now: "2026-05-21T00:01:01.000Z" });
  console.log('idempotencyKey:', receipt.result.token.idempotencyKey);
  console.log('expiry.expired:', receipt.result.reason === 'approval-expired');
  console.log('replayGuard.replayed:', receipt.replayGuard.replayed);
  console.log('duplicatePrevention.duplicate:', receipt.duplicatePrevention.duplicate);
  assert.equal(receipt.result.authorized, true);
  assert.equal(receipt.replayGuard.replayed, false);
  assert.equal(receipt.duplicatePrevention.duplicate, false);
  assert.equal(receipt.result.token.sandboxId, sandboxId);
  assert.equal(receipt.result.token.operationRequest, operationRequest);
});

test("authorizeDispatch rejects expired approval", () => {
  resetReplayMap();
  const approval = makeApproval({ proposalId: "proposal-unique-2", approvedAt: "2026-05-21T00:01:00.000Z", operationRequest });
  const expiredNow = "2026-05-21T00:20:00.000Z";
  const receipt = authorizeDispatch({ approval, sandboxId, operationRequest, expiresAt, now: expiredNow });
  assert.equal(receipt.result.authorized, false);
  assert.equal(receipt.result.reason, "approval-expired");
});

test("authorizeDispatch rejects replayed dispatch (idempotency)", () => {
  resetReplayMap();
  const approval = makeApproval({ proposalId: "proposal-unique-3", approvedAt: "2026-05-21T00:01:00.000Z", operationRequest });
  // First call is authorized
  const first = authorizeDispatch({ approval, sandboxId, operationRequest, expiresAt, now: "2026-05-21T00:01:02.000Z" });
  assert.equal(first.result.authorized, true);
  // Second call is replayed/duplicate (same approval, same idempotency key, same timestamp)
  const second = authorizeDispatch({ approval, sandboxId, operationRequest, expiresAt, now: "2026-05-21T00:01:02.000Z" });
  assert.equal(second.result.authorized, false);
  assert.equal(second.replayGuard.replayed, true);
  assert.equal(second.duplicatePrevention.duplicate, true);
  // Third call with a new approval (different proposalId) should be authorized
  const approval2 = makeApproval({ proposalId: "proposal-unique-4", approvedAt: "2026-05-21T00:01:03.000Z", operationRequest });
  const third = authorizeDispatch({ approval: approval2, sandboxId, operationRequest, expiresAt, now: "2026-05-21T00:01:04.000Z" });
  assert.equal(third.result.authorized, true);
});

test("createDispatchIdempotencyKey is deterministic and unique per approval", () => {
  resetReplayMap();
  const key1 = createDispatchIdempotencyKey({ sandboxId, operationRequest, approvalId: "A" });
  const key2 = createDispatchIdempotencyKey({ sandboxId, operationRequest, approvalId: "B" });
  assert.notEqual(key1, key2);
  assert.equal(typeof key1, "string");
});

test("checkDispatchApprovalExpiry returns expired when now > expiresAt", () => {
  resetReplayMap();
  const result = checkDispatchApprovalExpiry({ expiresAt: "2026-05-21T00:00:00.000Z", now: "2026-05-21T01:00:00.000Z" });
  assert.equal(result.expired, true);
  assert.equal(result.reason, "approval-expired");
});

test("checkDispatchReplayGuard and checkDispatchDuplicatePrevention track first/last seen", () => {
  resetReplayMap();
  const key = createDispatchIdempotencyKey({ sandboxId, operationRequest, approvalId: "C" });
  const first = checkDispatchReplayGuard(key, now);
  assert.equal(first.replayed, false);
  const second = checkDispatchReplayGuard(key, now);
  assert.equal(second.replayed, true);
  const dup = checkDispatchDuplicatePrevention(key, now, false);
  assert.equal(dup.duplicate, true);
});
