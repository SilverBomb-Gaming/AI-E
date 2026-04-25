import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createAutonomousTaskChain } from "./autonomousTaskChain";
import { createChainCheckpoint, resumeTaskChain } from "./autonomousChainRecovery";
import { createChainPersistenceRecord, loadChainState, persistChainState, summarizePersistenceState } from "./chainPersistence";
import type { ApprovalState } from "./approvalFreshness";

const REPO_ROOT = path.resolve(process.cwd(), "..");

async function createSandboxRoot(prefix: string): Promise<string> {
  const sandboxParent = path.join(REPO_ROOT, "web", "sandbox");
  await mkdir(sandboxParent, { recursive: true });
  return mkdtemp(path.join(sandboxParent, `${prefix}-`));
}

function buildChain() {
  const planned = createAutonomousTaskChain({
    originalRequest: "Persist a bounded chain",
    maxSteps: 2,
    chainApproval: true,
    requestedSteps: [{ title: "First step" }, { title: "Second step" }],
    createdAt: "2026-04-25T22:00:00.000Z",
  }).chain;
  planned.steps[0].status = "completed";
  planned.steps[1].status = "paused";
  planned.current_step_index = 1;
  planned.status = "chain_paused";
  return planned;
}

function buildApprovalState(): ApprovalState[] {
  return [{
    approval_type: "chain",
    granted_at: "2026-04-25T22:05:00.000Z",
    expires_at: "2026-04-25T23:05:00.000Z",
    requires_reapproval: false,
  }];
}

test("chain state persists correctly", async () => {
  const tempDir = await createSandboxRoot("chain-persistence-state");
  const prior = process.env.AIE_CHAIN_STATE_DIR;
  process.env.AIE_CHAIN_STATE_DIR = tempDir;
  try {
    const chain = buildChain();
    const checkpoint = createChainCheckpoint(chain);
    const record = createChainPersistenceRecord({
      chain,
      checkpoint,
      approvalState: buildApprovalState(),
      updatedAt: "2026-04-25T22:10:00.000Z",
    });
    await persistChainState(record);
    const loaded = await loadChainState(chain.chain_id);

    assert.deepEqual(loaded, record);
  } finally {
    if (prior === undefined) {
      delete process.env.AIE_CHAIN_STATE_DIR;
    } else {
      process.env.AIE_CHAIN_STATE_DIR = prior;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("checkpoint stores correct step index", () => {
  const chain = buildChain();
  const checkpoint = createChainCheckpoint(chain);

  assert.equal(checkpoint.last_completed_step_index, 0);
});

test("resume does not rerun completed steps", () => {
  const chain = buildChain();
  const checkpoint = createChainCheckpoint(chain);
  const resumed = resumeTaskChain(chain, checkpoint);

  assert.equal(resumed.resumed_chain?.steps[0].status, "completed");
  assert.equal(resumed.resumed_chain?.current_step_index, 1);
});

test("integrates with autonomousChainRecovery", () => {
  const chain = buildChain();
  const checkpoint = createChainCheckpoint(chain);
  const resumed = resumeTaskChain(chain, checkpoint);
  const record = createChainPersistenceRecord({
    chain: resumed.resumed_chain ?? chain,
    checkpoint,
    approvalState: buildApprovalState(),
    updatedAt: "2026-04-25T22:10:00.000Z",
  });

  assert.equal(record.chain_id, chain.chain_id);
  assert.equal(record.last_completed_step_index, 0);
});

test("summary readable", () => {
  const chain = buildChain();
  const checkpoint = createChainCheckpoint(chain);
  const record = createChainPersistenceRecord({
    chain,
    checkpoint,
    approvalState: buildApprovalState(),
    updatedAt: "2026-04-25T22:10:00.000Z",
  });
  const summary = summarizePersistenceState(record);

  assert.match(summary, /Chain id:/i);
  assert.match(summary, /Last updated:/i);
  assert.match(summary, /Validation status:/i);
});

test("no side effects", async () => {
  const tempDir = await createSandboxRoot("chain-persistence-side-effects");
  const prior = process.env.AIE_CHAIN_STATE_DIR;
  process.env.AIE_CHAIN_STATE_DIR = tempDir;
  try {
    const chain = buildChain();
    const checkpoint = createChainCheckpoint(chain);
    const record = createChainPersistenceRecord({
      chain,
      checkpoint,
      approvalState: buildApprovalState(),
      updatedAt: "2026-04-25T22:10:00.000Z",
    });
    const before = JSON.stringify(chain);
    await persistChainState(record);
    const filePath = path.join(tempDir, `${chain.chain_id}.json`);
    const persisted = await readFile(filePath, "utf8");
    const after = JSON.stringify(chain);

    assert.equal(after, before);
    assert.match(persisted, /chain_id/i);
  } finally {
    if (prior === undefined) {
      delete process.env.AIE_CHAIN_STATE_DIR;
    } else {
      process.env.AIE_CHAIN_STATE_DIR = prior;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});