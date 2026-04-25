import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomousTaskChain } from "./autonomousTaskChain";
import { evaluateRecoveryEligibility } from "./autonomousChainRecovery";
import {
  evaluateApprovalFreshness,
  evaluateContextStaleness,
  requireReapprovalIfNeeded,
  type ApprovalState,
} from "./approvalFreshness";

function buildChain() {
  return createAutonomousTaskChain({
    originalRequest: "Resume long lived chain safely",
    maxSteps: 2,
    chainApproval: true,
    requestedSteps: [{ title: "Step one" }, { title: "Step two" }],
    createdAt: "2026-04-25T21:00:00.000Z",
  }).chain;
}

function buildApprovalState(overrides: Partial<ApprovalState> = {}): ApprovalState {
  return {
    approval_type: "commit",
    granted_at: "2026-04-25T21:10:00.000Z",
    expires_at: "2026-04-25T22:10:00.000Z",
    requires_reapproval: false,
    ...overrides,
  };
}

test("approvals expire after configured window", () => {
  const result = evaluateApprovalFreshness({
    approvalState: buildApprovalState(),
    now: "2026-04-25T22:20:00.000Z",
  });

  assert.equal(result.status, "expired");
});

test("expired approval requires reapproval", () => {
  const chain = buildChain();
  const result = requireReapprovalIfNeeded({
    chain,
    approvalStates: [buildApprovalState()],
    now: "2026-04-25T22:20:00.000Z",
  });

  assert.equal(result.status, "requires_reapproval");
  assert.deepEqual(result.approvals_requiring_reapproval, ["commit"]);
});

test("fresh approval allows continuation", () => {
  const result = evaluateApprovalFreshness({
    approvalState: buildApprovalState(),
    now: "2026-04-25T21:20:00.000Z",
  });

  assert.equal(result.status, "fresh");
});

test("stale context forces revalidation", () => {
  const chain = buildChain();
  const result = evaluateContextStaleness({
    chain,
    contextSnapshot: {
      chain_updated_at: "2026-04-25T21:00:00.000Z",
      validation_completed_at: "2026-04-25T21:00:00.000Z",
      stale_after_ms: 10 * 60 * 1000,
    },
    now: "2026-04-25T21:30:00.000Z",
  });

  assert.equal(result.status, "requires_revalidation");
  assert.ok(result.reasons.includes("context-stale"));
});

test("resume after long delay triggers safety checks", () => {
  const chain = buildChain();
  const checkpoint = {
    checkpoint_id: "checkpoint-1",
    chain_id: chain.chain_id,
    last_completed_step_index: 0,
    last_successful_state: "chain_paused" as const,
    validation_snapshot: {
      status: "validation_passed" as const,
      recommendation: "keep_changes" as const,
    },
    approval_state: {
      chain_approval_granted: true,
      commit_approved: false,
      push_approved: false,
    },
    created_at: "2026-04-25T21:00:00.000Z",
  };
  chain.status = "chain_paused";
  chain.blockers = [{
    code: "commit_approval_missing",
    message: "Commit approval is missing.",
    recommended_action: "approve",
  }];
  const result = evaluateRecoveryEligibility(chain, checkpoint);

  assert.equal(result.status, "awaiting_reapproval");
});

test("deterministic behavior", () => {
  const approvalState = buildApprovalState();
  const first = evaluateApprovalFreshness({ approvalState, now: "2026-04-25T21:20:00.000Z" });
  const second = evaluateApprovalFreshness({ approvalState, now: "2026-04-25T21:20:00.000Z" });

  assert.deepEqual(second, first);
});

test("summary readable via requireReapprovalIfNeeded explanation", () => {
  const chain = buildChain();
  const result = requireReapprovalIfNeeded({
    chain,
    approvalStates: [buildApprovalState({ requires_reapproval: true })],
    now: "2026-04-25T21:20:00.000Z",
  });

  assert.match(result.explanation, /requires renewed approval/i);
});

test("no side effects", () => {
  const chain = buildChain();
  const before = JSON.stringify(chain);
  requireReapprovalIfNeeded({
    chain,
    approvalStates: [buildApprovalState()],
    now: "2026-04-25T21:20:00.000Z",
  });
  const after = JSON.stringify(chain);

  assert.equal(after, before);
});