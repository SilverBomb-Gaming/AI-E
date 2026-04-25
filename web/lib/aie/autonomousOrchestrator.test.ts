import assert from "node:assert/strict";
import test from "node:test";

import { completeTaskChain, createAutonomousTaskChain } from "./autonomousTaskChain";
import { createChainCheckpoint, type ChainCheckpoint } from "./autonomousChainRecovery";
import { createChainPersistenceRecord, type ChainPersistenceRecord } from "./chainPersistence";
import { decideAutonomousOrchestration, summarizeOrchestration } from "./autonomousOrchestrator";
import type { ApprovalState } from "./approvalFreshness";

function buildCompletedChain() {
  const planned = createAutonomousTaskChain({
    originalRequest: "Improve the OpenClaw orchestration loop safely",
    interpretedGoal: "Extend AI-E supervision beyond a single request",
    maxSteps: 2,
    chainApproval: true,
    requestedSteps: [
      { title: "Add persistence and freshness checks" },
      { title: "Validate safe continuation state" },
    ],
    createdAt: "2026-04-25T23:00:00.000Z",
  }).chain;
  planned.steps = planned.steps.map((step) => ({ ...step, status: "completed" }));
  planned.current_step_index = planned.steps.length - 1;
  return completeTaskChain(planned).chain;
}

function buildApprovalState(): ApprovalState[] {
  return [{
    approval_type: "chain",
    granted_at: "2026-04-25T23:05:00.000Z",
    expires_at: "2026-04-26T01:05:00.000Z",
    requires_reapproval: false,
  }];
}

function buildPersistenceRecord(chain = buildCompletedChain()): { chain: ReturnType<typeof buildCompletedChain>; checkpoint: ChainCheckpoint; record: ChainPersistenceRecord } {
  const checkpoint = createChainCheckpoint(chain);
  const record = createChainPersistenceRecord({
    chain,
    checkpoint,
    approvalState: buildApprovalState(),
    updatedAt: "2026-04-25T23:10:00.000Z",
  });
  return { chain, checkpoint, record };
}

test("proposes logical next step", () => {
  const { chain, record } = buildPersistenceRecord();

  const decision = decideAutonomousOrchestration({
    chain,
    persistenceRecord: record,
    maxProposedSteps: 2,
    confidence: 0.9,
    minimumConfidence: 0.7,
    supervisorApproval: true,
    now: "2026-04-25T23:15:00.000Z",
  });

  assert.equal(decision.status, "orchestration_ready");
  assert.match(decision.plan.proposed_steps[0]?.title ?? "", /review follow-up opportunities/i);
});

test("blocks low-confidence continuation", () => {
  const { chain, record } = buildPersistenceRecord();

  const decision = decideAutonomousOrchestration({
    chain,
    persistenceRecord: record,
    maxProposedSteps: 2,
    confidence: 0.4,
    minimumConfidence: 0.7,
    supervisorApproval: true,
    now: "2026-04-25T23:15:00.000Z",
  });

  assert.equal(decision.status, "orchestration_blocked");
  assert.ok(decision.blockers.some((blocker) => blocker.code === "low_confidence"));
});

test("respects max-step limits", () => {
  const { chain, record } = buildPersistenceRecord();

  const decision = decideAutonomousOrchestration({
    chain,
    persistenceRecord: record,
    maxProposedSteps: 1,
    confidence: 0.9,
    minimumConfidence: 0.7,
    supervisorApproval: true,
    now: "2026-04-25T23:15:00.000Z",
  });

  assert.equal(decision.plan.proposed_steps.length, 1);
});

test("requires approval before execution", () => {
  const { chain, record } = buildPersistenceRecord();

  const decision = decideAutonomousOrchestration({
    chain,
    persistenceRecord: record,
    maxProposedSteps: 2,
    confidence: 0.9,
    minimumConfidence: 0.7,
    supervisorApproval: false,
    now: "2026-04-25T23:15:00.000Z",
  });

  assert.equal(decision.status, "awaiting_supervisor_approval");
  assert.ok(decision.blockers.some((blocker) => blocker.code === "supervisor_approval_required"));
});

test("integrates with chain state", () => {
  const { chain, record } = buildPersistenceRecord();

  const decision = decideAutonomousOrchestration({
    chain,
    persistenceRecord: record,
    maxProposedSteps: 2,
    confidence: 0.9,
    minimumConfidence: 0.7,
    supervisorApproval: true,
    now: "2026-04-25T23:15:00.000Z",
  });

  assert.equal(decision.plan.prior_chain_status, "chain_completed");
  assert.equal(decision.plan.proposed_steps[0]?.derived_from_step_id, chain.steps.at(-1)?.step_id ?? null);
  assert.match(decision.plan.context_summary, new RegExp(chain.chain_id));
});

test("deterministic output", () => {
  const { chain, record } = buildPersistenceRecord();
  const input = {
    chain,
    persistenceRecord: record,
    maxProposedSteps: 2,
    confidence: 0.9,
    minimumConfidence: 0.7,
    supervisorApproval: true,
    now: "2026-04-25T23:15:00.000Z",
  };

  const first = decideAutonomousOrchestration(input);
  const second = decideAutonomousOrchestration(input);

  assert.deepEqual(second, first);
});

test("summary is readable", () => {
  const { chain, record } = buildPersistenceRecord();
  const decision = decideAutonomousOrchestration({
    chain,
    persistenceRecord: record,
    maxProposedSteps: 2,
    confidence: 0.9,
    minimumConfidence: 0.7,
    supervisorApproval: true,
    now: "2026-04-25T23:15:00.000Z",
  });
  const summary = summarizeOrchestration(decision);

  assert.match(summary, /Status:/i);
  assert.match(summary, /Confidence:/i);
  assert.match(summary, /Proposed steps:/i);
});

test("no side effects", () => {
  const { chain, record } = buildPersistenceRecord();
  const chainBefore = JSON.stringify(chain);
  const recordBefore = JSON.stringify(record);

  decideAutonomousOrchestration({
    chain,
    persistenceRecord: record,
    maxProposedSteps: 2,
    confidence: 0.9,
    minimumConfidence: 0.7,
    supervisorApproval: true,
    now: "2026-04-25T23:15:00.000Z",
  });

  assert.equal(JSON.stringify(chain), chainBefore);
  assert.equal(JSON.stringify(record), recordBefore);
});