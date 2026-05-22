import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { dispatchReplayMap } from "./dispatchAuthorizationBoundary";
import type { SandboxSnapshotDirectoryEntry } from "./sandboxSnapshotLifecycle";
import {
  executeGovernedProofDispatch,
  PROOF_FILE_NAME,
  type GovernedDispatchFilesystem,
  type GovernedExecutionApproval,
  type GovernedProofDispatchRequest,
  type ApprovalAuthorityToken,
} from "./sandboxedRuntimeDispatch";

const FIXED_TIME = "2026-05-21T00:00:00.000Z";
const EXPIRES_FUTURE = "2026-05-21T01:00:00.000Z";
const EXPIRES_PAST = "2026-05-20T23:00:00.000Z";
const REPO_ROOT = path.resolve("E:/test-ai-e");
const SANDBOX_ID = "sandbox-proof-0051c-test";

function key(absolutePath: string): string {
  return path.normalize(absolutePath);
}

function makeInMemoryFs(): GovernedDispatchFilesystem & {
  files: Map<string, string>;
  directories: Set<string>;
} {
  const files = new Map<string, string>();
  const directories = new Set<string>();

  function buildEntries(dirPath: string): SandboxSnapshotDirectoryEntry[] {
    const normalizedDir = key(dirPath);
    const entries: SandboxSnapshotDirectoryEntry[] = [];
    for (const [fp] of files) {
      if (path.dirname(key(fp)) === normalizedDir) {
        entries.push({ name: path.basename(fp), kind: "file", sizeBytes: Buffer.byteLength(files.get(fp) ?? ""), modifiedAt: FIXED_TIME });
      }
    }
    for (const dir of directories) {
      const nDir = key(dir);
      if (path.dirname(nDir) === normalizedDir && nDir !== normalizedDir) {
        entries.push({ name: path.basename(dir), kind: "directory" });
      }
    }
    return entries;
  }

  return {
    files,
    directories,
    createDirectory: async (p) => { directories.add(p); },
    writeFile: async (p, c) => { files.set(key(p), c); },
    readFile: async (p) => {
      const c = files.get(key(p));
      if (c === undefined) { const e = Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" }); throw e; }
      return c;
    },
    listDirectory: async (p) => {
      const nPath = key(p);
      const known = directories.has(p) || [...files.keys()].some((f) => path.dirname(f) === nPath);
      if (!known) { const e = Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" }); throw e; }
      return buildEntries(p);
    },
    getFileSize: async (p) => { const c = files.get(key(p)); if (c === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" }); return Buffer.byteLength(c); },
  };
}

function makeApproval(overrides?: Partial<GovernedExecutionApproval>): GovernedExecutionApproval {
  return {
    authorityToken: "operator-approved" as ApprovalAuthorityToken,
    approvedBy: "operator-test",
    approvedAt: FIXED_TIME,
    proposalId: `proposal-${Math.random().toString(36).slice(2, 10)}`,
    operationRequest: "Write AI_E_DISPATCH_PROOF.txt to sandbox workspace",
    ...overrides,
  };
}

function baseRequest(overrides?: Partial<GovernedProofDispatchRequest>): GovernedProofDispatchRequest {
  return {
    approvalToken: "operator-approved",
    authorization: makeApproval(),
    expiresAt: EXPIRES_FUTURE,
    operationRequest: "Write AI_E_DISPATCH_PROOF.txt to sandbox workspace",
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operatorId: "operator-test",
    runtimeId: "aie-exec0051c-bounded-write",
    now: () => FIXED_TIME,
    filesystem: makeInMemoryFs(),
    ...overrides,
  };
}

// Reset replay map before each proof dispatch test to prevent cross-test contamination
function resetReplay() {
  dispatchReplayMap.clear();
}

// ---- Authorization gate tests -------------------------------------------------------

test("executeGovernedProofDispatch fails with expired authorization", async () => {
  resetReplay();
  const result = await executeGovernedProofDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(result.outcome, "failed");
  assert.match(result.error ?? "", /authorization denied/i);
  assert.equal(result.authorizationReceipt.result.authorized, false);
  assert.equal(result.authorizationReceipt.result.reason, "approval-expired");
});

test("executeGovernedProofDispatch fails on replay (second dispatch with same approval)", async () => {
  resetReplay();
  const approval = makeApproval({ proposalId: "proposal-replay-test" });
  const fs1 = makeInMemoryFs();
  const first = await executeGovernedProofDispatch(baseRequest({ authorization: approval, filesystem: fs1 }));
  assert.equal(first.outcome, "completed", "First dispatch should complete");

  const fs2 = makeInMemoryFs();
  const second = await executeGovernedProofDispatch(baseRequest({ authorization: approval, filesystem: fs2 }));
  assert.equal(second.outcome, "failed", "Second dispatch with same approval should fail");
  assert.match(second.error ?? "", /authorization denied/i);
  assert.equal(second.authorizationReceipt.replayGuard.replayed, true);
});

test("executeGovernedProofDispatch succeeds with valid fresh authorization", async () => {
  resetReplay();
  const result = await executeGovernedProofDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.equal(result.authorizationReceipt.result.authorized, true);
});

// ---- Proof file tests ---------------------------------------------------------------

test("executeGovernedProofDispatch writes AI_E_DISPATCH_PROOF.txt to sandbox workspace", async () => {
  resetReplay();
  const fs = makeInMemoryFs();
  const result = await executeGovernedProofDispatch(baseRequest({ filesystem: fs }));
  assert.equal(result.outcome, "completed");
  assert.ok(result.proofFilePath.includes(PROOF_FILE_NAME), `proofFilePath "${result.proofFilePath}" should include "${PROOF_FILE_NAME}"`);
  const writtenFiles = [...fs.files.keys()].filter((p) => p.includes(PROOF_FILE_NAME));
  assert.ok(writtenFiles.length > 0, "Expected proof file to be written to in-memory filesystem");
});

test("executeGovernedProofDispatch proof file content contains all required fields", async () => {
  resetReplay();
  const fs = makeInMemoryFs();
  const result = await executeGovernedProofDispatch(baseRequest({ filesystem: fs }));
  assert.equal(result.outcome, "completed");
  const proofPath = [...fs.files.keys()].find((p) => p.includes(PROOF_FILE_NAME));
  const proofContent = proofPath ? fs.files.get(proofPath) ?? "" : "";

  assert.ok(proofContent.includes("AI-E DISPATCH PROOF"), "Missing header");
  assert.ok(proofContent.includes("Dispatch ID:"), "Missing dispatch ID");
  assert.ok(proofContent.includes("Sandbox ID:"), "Missing sandbox ID");
  assert.ok(proofContent.includes("Operator ID:"), "Missing operator ID");
  assert.ok(proofContent.includes("Runtime ID:"), "Missing runtime ID");
  assert.ok(proofContent.includes("Approval ID:"), "Missing approval ID");
  assert.ok(proofContent.includes("Authority Token:"), "Missing authority token");
  assert.ok(proofContent.includes("Timestamp:"), "Missing timestamp");
  assert.ok(proofContent.includes("Authorization Result:"), "Missing authorization result");
  assert.ok(proofContent.includes("Rollback Reference:"), "Missing rollback reference");
  assert.ok(proofContent.includes("EXEC-0051-C"), "Missing EXEC-0051-C marker");
});

// ---- Lifecycle tests ----------------------------------------------------------------

test("executeGovernedProofDispatch lifecycle includes all expected states on success", async () => {
  resetReplay();
  const result = await executeGovernedProofDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  const states = result.lifecycle.map((r) => r.state);
  assert.ok(states.includes("awaiting_approval"), "Missing awaiting_approval lifecycle state");
  assert.ok(states.includes("dispatching"), "Missing dispatching lifecycle state");
  assert.ok(states.includes("executing"), "Missing executing lifecycle state");
  assert.ok(states.includes("completed"), "Missing completed lifecycle state");
});

test("executeGovernedProofDispatch lifecycle shows failed state on authorization failure", async () => {
  resetReplay();
  const result = await executeGovernedProofDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  const states = result.lifecycle.map((r) => r.state);
  assert.ok(states.includes("awaiting_approval"), "Missing awaiting_approval");
  assert.ok(states.includes("failed"), "Missing failed lifecycle state");
  assert.ok(!states.includes("executing"), "Should not reach executing state");
});

// ---- Rollback contract tests --------------------------------------------------------

test("executeGovernedProofDispatch generates rollback contract with ready=true on success", async () => {
  resetReplay();
  const result = await executeGovernedProofDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.equal(result.rollbackContract.rollbackReady, true);
  assert.ok(result.rollbackContract.rollbackMetadata.changedFiles.length > 0, "Expected at least one changed file");
  assert.ok(result.rollbackContract.rollbackMetadata.diffSummary.includes("created"), "Expected diff summary to mention created files");
  assert.equal(result.rollbackContract.verification.valid, true);
});

test("executeGovernedProofDispatch generates rollback contract with ready=false on authorization failure", async () => {
  resetReplay();
  const result = await executeGovernedProofDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(result.rollbackContract.rollbackReady, false);
  assert.equal(result.rollbackContract.verification.valid, false);
});

// ---- Snapshot tests ----------------------------------------------------------------

test("executeGovernedProofDispatch before=0 after=1 snapshot file counts", async () => {
  resetReplay();
  const result = await executeGovernedProofDispatch(baseRequest());
  assert.equal(result.beforeSnapshotFileCount, 0);
  assert.equal(result.afterSnapshotFileCount, 1);
});

test("executeGovernedProofDispatch diff shows one created entry for the proof file", async () => {
  resetReplay();
  const result = await executeGovernedProofDispatch(baseRequest());
  assert.equal(result.diffEntries.length, 1);
  assert.equal(result.diffEntries[0]?.changeKind, "created");
  assert.ok(result.diffEntries[0]?.sandboxRelativePath.includes(PROOF_FILE_NAME));
});

// ---- Safety boundary ---------------------------------------------------------------

test("executeGovernedProofDispatch safety boundary flags are all correct", async () => {
  resetReplay();
  const result = await executeGovernedProofDispatch(baseRequest());
  assert.equal(result.safetyBoundary.approvalRequired, true);
  assert.equal(result.safetyBoundary.sandboxScoped, true);
  assert.equal(result.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(result.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(result.safetyBoundary.productionWorkspaceMutationEnabled, false);
  assert.equal(result.safetyBoundary.automaticContinuationEnabled, false);
  assert.equal(result.safetyBoundary.humanAuthorityFinal, true);
});
