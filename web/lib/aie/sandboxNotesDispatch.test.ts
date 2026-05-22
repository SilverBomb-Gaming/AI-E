import assert from "node:assert/strict";
import * as nodePath from "node:path";
import test from "node:test";

import { dispatchReplayMap } from "./dispatchAuthorizationBoundary";
import type { SandboxSnapshotDirectoryEntry } from "./sandboxSnapshotLifecycle";
import {
  SANDBOX_NOTES_ADAPTER_ID,
  SANDBOX_NOTES_ADAPTER_VERSION,
  SANDBOX_NOTES_FILE_NAME,
  applyNotesMutation,
  buildInitialNotesContent,
  buildNoteText,
  createSandboxNotesRuntimeAdapter,
  type SandboxNotesAdapterFilesystem,
} from "./sandboxNotesRuntimeAdapter";
import {
  makeDefaultSandboxRuntimeIOContract,
  type GovernedRuntimeAdapterId,
  type GovernedRuntimeInvocation,
} from "./governedRuntimeAdapterContract";
import {
  executeSandboxNotesDispatch,
  type SandboxNotesDispatchRequest,
} from "./sandboxNotesDispatch";

// =====================================================================================
// TEST FIXTURES
// =====================================================================================

const FIXED_TIME = "2026-05-22T14:00:00.000Z";
const EXPIRES_FUTURE = "2026-05-22T15:00:00.000Z";
const EXPIRES_PAST = "2026-05-22T13:00:00.000Z";
const REPO_ROOT = nodePath.resolve("E:/test-ai-e-exec0052c-notes");
const SANDBOX_ID = "sandbox-exec0052c-notes-test";

function key(absolutePath: string): string {
  return nodePath.normalize(absolutePath);
}

type SharedInMemoryFs = SandboxNotesAdapterFilesystem & {
  listDirectory: (p: string) => Promise<SandboxSnapshotDirectoryEntry[]>;
  getFileSize: (p: string) => Promise<number>;
  files: Map<string, string>;
  directories: Set<string>;
};

function makeSharedInMemoryFs(): SharedInMemoryFs {
  const files = new Map<string, string>();
  const directories = new Set<string>();

  function buildEntries(dirPath: string): SandboxSnapshotDirectoryEntry[] {
    const normalizedDir = key(dirPath);
    const entries: SandboxSnapshotDirectoryEntry[] = [];
    for (const [fp] of files) {
      if (nodePath.dirname(key(fp)) === normalizedDir) {
        entries.push({
          name: nodePath.basename(fp),
          kind: "file",
          sizeBytes: Buffer.byteLength(files.get(fp) ?? ""),
          modifiedAt: FIXED_TIME,
        });
      }
    }
    for (const dir of directories) {
      const nDir = key(dir);
      if (nodePath.dirname(nDir) === normalizedDir && nDir !== normalizedDir) {
        entries.push({ name: nodePath.basename(dir), kind: "directory" });
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
      return c ?? null;
    },
    listDirectory: async (p) => {
      const nPath = key(p);
      const known = directories.has(p) || [...files.keys()].some((f) => nodePath.dirname(f) === nPath);
      if (!known) { const e = Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" }); throw e; }
      return buildEntries(p);
    },
    getFileSize: async (p) => {
      const c = files.get(key(p));
      if (c === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      return Buffer.byteLength(c);
    },
  };
}

function makeApproval(proposalId?: string) {
  return {
    authorityToken: "operator-approved" as GovernedRuntimeAdapterId,
    approvedBy: "operator-exec0052c-notes",
    approvedAt: FIXED_TIME,
    proposalId: proposalId ?? `proposal-exec0052c-notes-${Math.random().toString(36).slice(2, 10)}`,
    operationRequest: "Added governed stamina cooldown note",
  };
}

function baseRequest(overrides?: Partial<SandboxNotesDispatchRequest>): SandboxNotesDispatchRequest {
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createSandboxNotesRuntimeAdapter(sharedFs);
  return {
    approvalToken: "operator-approved",
    authorization: makeApproval(),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operatorId: "operator-exec0052c-notes",
    operationRequest: "Added governed stamina cooldown note",
    now: () => FIXED_TIME,
    filesystem: sharedFs,
    adapter,
    ...overrides,
  };
}

function resetReplay() {
  dispatchReplayMap.clear();
}

function makeInvocation(workspaceRoot: string, overrides?: Partial<GovernedRuntimeInvocation>): GovernedRuntimeInvocation {
  return {
    invocationId: "invocation-20260522140000",
    dispatchId: "dispatch-20260522140000-exec0052c-notes",
    sandboxId: SANDBOX_ID,
    operatorId: "operator-exec0052c-notes",
    runtimeId: SANDBOX_NOTES_ADAPTER_ID,
    approvalReference: "proposal-exec0052c-notes-test",
    approval: makeApproval(),
    operationRequest: "Added governed stamina cooldown note",
    workspaceRoot,
    timeoutMs: 30_000,
    ioContract: makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: true }),
    requestedAt: FIXED_TIME,
    ...overrides,
  };
}

// =====================================================================================
// ADAPTER UNIT TESTS
// =====================================================================================

test("createSandboxNotesRuntimeAdapter satisfies GovernedRuntimeAdapter interface", () => {
  const adapter = createSandboxNotesRuntimeAdapter();
  assert.equal(typeof adapter.adapterId, "string");
  assert.equal(typeof adapter.runtimeType, "string");
  assert.equal(typeof adapter.adapterVersion, "string");
  assert.equal(typeof adapter.invoke, "function");
  assert.equal(adapter.adapterId, SANDBOX_NOTES_ADAPTER_ID);
  assert.equal(adapter.adapterVersion, SANDBOX_NOTES_ADAPTER_VERSION);
  assert.equal(adapter.runtimeType, "openclaw");
  assert.equal(adapter.capability.requiresSandbox, true);
  assert.equal(adapter.capability.requiresApproval, true);
  assert.equal(adapter.capability.shellExecutionEnabled, false);
  assert.equal(adapter.capability.networkExecutionEnabled, false);
  assert.equal(adapter.capability.productionMutationEnabled, false);
});

test("adapter invoke() rejects when ioContract.workspaceWriteAllowed=false", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxNotesRuntimeAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const invocation = makeInvocation(workspaceRoot, {
    ioContract: makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: false }),
  });
  const result = await adapter.invoke(invocation);
  assert.equal(result.outcome, "rejected");
  assert.equal(result.failure?.category, "operation_rejected_by_adapter");
  assert.equal(fs.files.size, 0, "no files written on IO rejection");
});

test("adapter invoke() creates sandboxNotes.md on first invocation", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxNotesRuntimeAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const result = await adapter.invoke(makeInvocation(workspaceRoot));
  assert.equal(result.outcome, "completed");
  const written = [...fs.files.entries()].find(([p]) => p.includes(SANDBOX_NOTES_FILE_NAME));
  assert.ok(written, "sandboxNotes.md was written");
  assert.ok(written[1].includes("# Sandbox Notes"), "file has markdown header");
  assert.ok(written[1].includes("- OpenClaw:"), "file has OpenClaw bullet");
});

test("adapter invoke() appends new bullet on second invocation", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxNotesRuntimeAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  await adapter.invoke(makeInvocation(workspaceRoot));
  const result2 = await adapter.invoke(makeInvocation(workspaceRoot, {
    operationRequest: "Added second note",
  }));
  assert.equal(result2.outcome, "completed");
  const written = [...fs.files.entries()].find(([p]) => p.includes(SANDBOX_NOTES_FILE_NAME));
  const content = written?.[1] ?? "";
  const bulletCount = (content.match(/^- /gm) ?? []).length;
  assert.ok(bulletCount >= 2, `file should have at least 2 bullets, got ${bulletCount}`);
  assert.ok(result2.outputCapture.stdout.includes("=== BEFORE ==="), "stdout has BEFORE section");
  assert.ok(result2.outputCapture.stdout.includes("=== AFTER ==="), "stdout has AFTER section");
  assert.ok(result2.outputCapture.stdout.includes("Added second note"), "stdout shows appended note");
});

test("adapter invoke() lifecycle includes all expected states on success", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxNotesRuntimeAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const result = await adapter.invoke(makeInvocation(workspaceRoot));
  const states = result.lifecycle.records.map((r) => r.state);
  assert.ok(states.includes("queued"), "has queued");
  assert.ok(states.includes("authorization_verified"), "has authorization_verified");
  assert.ok(states.includes("dispatching"), "has dispatching");
  assert.ok(states.includes("running"), "has running");
  assert.ok(states.includes("completed"), "has completed");
  assert.equal(result.lifecycle.currentState, "completed");
});

test("adapter invoke() safetyBoundary flags are all correct", async () => {
  const fs = makeSharedInMemoryFs();
  const adapter = createSandboxNotesRuntimeAdapter(fs);
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");
  const result = await adapter.invoke(makeInvocation(workspaceRoot));
  assert.equal(result.safetyBoundary.sandboxScoped, true);
  assert.equal(result.safetyBoundary.approvalRequired, true);
  assert.equal(result.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(result.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(result.safetyBoundary.productionWorkspaceMutationEnabled, false);
  assert.equal(result.safetyBoundary.humanAuthorityFinal, true);
});

test("buildInitialNotesContent returns valid markdown header", () => {
  const content = buildInitialNotesContent();
  assert.ok(content.includes("# Sandbox Notes"), "has markdown header");
});

test("applyNotesMutation with null existing creates header + bullet", () => {
  const { before, after } = applyNotesMutation(null, "OpenClaw: test note");
  assert.ok(before.includes("did not exist"), "before shows file was absent");
  assert.ok(after.includes("# Sandbox Notes"), "after has markdown header");
  assert.ok(after.includes("- OpenClaw: test note"), "after has bullet");
});

test("applyNotesMutation with existing content appends bullet", () => {
  const existing = "# Sandbox Notes\n\n- add first gameplay task";
  const { before, after } = applyNotesMutation(existing, "OpenClaw added governed stamina cooldown note");
  assert.equal(before, existing, "before is the original content");
  assert.ok(after.includes("- add first gameplay task"), "after preserves existing bullet");
  assert.ok(after.includes("- OpenClaw added governed stamina cooldown note"), "after has appended bullet");
  assert.ok(after.indexOf("- add first gameplay task") < after.indexOf("- OpenClaw"), "new bullet is after existing");
});

test("buildNoteText formats operationRequest into note text", () => {
  const note = buildNoteText("Added governed stamina cooldown note");
  assert.ok(note.startsWith("OpenClaw:"), "note starts with OpenClaw:");
  assert.ok(note.includes("Added governed stamina cooldown note"), "note includes operationRequest");
});

// =====================================================================================
// DISPATCH ORCHESTRATOR TESTS
// =====================================================================================

test("executeSandboxNotesDispatch fails with expired authorization", async () => {
  resetReplay();
  const result = await executeSandboxNotesDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(result.outcome, "rejected");
  assert.equal(result.rollbackContract.rollbackReady, false);
});

test("executeSandboxNotesDispatch fails on replay (same approval used twice)", async () => {
  resetReplay();
  const approval = makeApproval("proposal-notes-replay-test");
  await executeSandboxNotesDispatch(baseRequest({ authorization: approval }));
  const result2 = await executeSandboxNotesDispatch(baseRequest({ authorization: approval }));
  assert.equal(result2.outcome, "rejected");
});

test("executeSandboxNotesDispatch rejects wrong approvalToken", async () => {
  resetReplay();
  await assert.rejects(
    () => executeSandboxNotesDispatch(baseRequest({ approvalToken: "wrong-token" })),
    /rejected/,
  );
});

test("executeSandboxNotesDispatch succeeds with valid fresh authorization", async () => {
  resetReplay();
  const result = await executeSandboxNotesDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.equal(result.manifestVersion, "EXEC-0052-C");
  assert.equal(result.runtimeType, "openclaw");
  assert.equal(result.adapterId, SANDBOX_NOTES_ADAPTER_ID);
});

test("executeSandboxNotesDispatch creates sandboxNotes.md (before=0, after=1)", async () => {
  resetReplay();
  const result = await executeSandboxNotesDispatch(baseRequest());
  assert.equal(result.beforeSnapshotFileCount, 0);
  assert.equal(result.afterSnapshotFileCount, 1);
  assert.ok(result.diffEntries.some((e) => e.changeKind === "created"), "diff shows file created");
});

test("executeSandboxNotesDispatch notesFilePath contains SANDBOX_NOTES_FILE_NAME", async () => {
  resetReplay();
  const result = await executeSandboxNotesDispatch(baseRequest());
  assert.ok(result.notesFilePath.includes(SANDBOX_NOTES_FILE_NAME), "notesFilePath contains sandboxNotes.md");
});

test("executeSandboxNotesDispatch generates receipt on success", async () => {
  resetReplay();
  const result = await executeSandboxNotesDispatch(baseRequest());
  assert.ok(result.receiptId.length > 0, "receiptId is non-empty");
  assert.ok(result.receiptSandboxPath.length > 0, "receiptSandboxPath is non-empty");
});

test("executeSandboxNotesDispatch rollback ready=true on success, false on auth failure", async () => {
  resetReplay();
  const ok = await executeSandboxNotesDispatch(baseRequest());
  assert.equal(ok.rollbackContract.rollbackReady, true);

  const fail = await executeSandboxNotesDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(fail.rollbackContract.rollbackReady, false);
});

test("executeSandboxNotesDispatch lifecycle shows completed on success, rejected on auth failure", async () => {
  resetReplay();
  const ok = await executeSandboxNotesDispatch(baseRequest());
  assert.equal(ok.lifecycle.currentState, "completed");

  const fail = await executeSandboxNotesDispatch(baseRequest({ expiresAt: EXPIRES_PAST }));
  assert.equal(fail.lifecycle.currentState, "rejected");
});

test("executeSandboxNotesDispatch output captures before/after/note sections", async () => {
  resetReplay();
  const result = await executeSandboxNotesDispatch(baseRequest());
  assert.ok(result.outputCapture.stdout.includes("=== BEFORE ==="), "has BEFORE section");
  assert.ok(result.outputCapture.stdout.includes("=== AFTER ==="), "has AFTER section");
  assert.ok(result.outputCapture.stdout.includes("=== NOTE APPENDED ==="), "has NOTE APPENDED section");
  assert.ok(result.outputCapture.stdout.includes("OpenClaw:"), "has OpenClaw note");
  assert.ok(result.outputCapture.stdout.includes("stamina cooldown"), "has operationRequest content");
});

test("executeSandboxNotesDispatch dispatch record maps all required fields", async () => {
  resetReplay();
  const result = await executeSandboxNotesDispatch(baseRequest());
  const dr = result.dispatchRecord;
  assert.ok(dr.recordId.length > 0, "recordId present");
  assert.equal(dr.outcome, "completed");
  assert.equal(dr.runtimeType, "openclaw");
  assert.equal(dr.adapterVersion, SANDBOX_NOTES_ADAPTER_VERSION);
  assert.equal(dr.safetyBoundary.humanAuthorityFinal, true);
  assert.equal(dr.safetyBoundary.shellExecutionEnabled, false);
});

test("executeSandboxNotesDispatch times out via slow adapter", async () => {
  resetReplay();
  const slowAdapter = {
    ...createSandboxNotesRuntimeAdapter(),
    invoke: () => new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Sandbox notes dispatch timed out after 1000ms")), 1100);
    }),
  };
  const result = await executeSandboxNotesDispatch(baseRequest({ adapter: slowAdapter, timeoutMs: 1000 }));
  assert.equal(result.outcome, "timeout");
  assert.ok(result.error?.includes("timed out"), "error mentions timeout");
}, { timeout: 5000 });

test("executeSandboxNotesDispatch second dispatch appends second bullet (modified diff)", async () => {
  resetReplay();
  const sharedFs = makeSharedInMemoryFs();
  const adapter = createSandboxNotesRuntimeAdapter(sharedFs);

  await executeSandboxNotesDispatch({
    approvalToken: "operator-approved",
    authorization: makeApproval("proposal-notes-append-1"),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operationRequest: "Added first gameplay task note",
    now: () => FIXED_TIME,
    filesystem: sharedFs,
    adapter,
  });

  const result2 = await executeSandboxNotesDispatch({
    approvalToken: "operator-approved",
    authorization: makeApproval("proposal-notes-append-2"),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operationRequest: "Added governed stamina cooldown note",
    now: () => "2026-05-22T14:00:01.000Z",
    filesystem: sharedFs,
    adapter,
  });

  assert.equal(result2.outcome, "completed");
  assert.ok(
    result2.diffEntries.some((e) => e.changeKind === "modified"),
    "second dispatch shows file as modified (note appended)",
  );
  assert.ok(result2.outputCapture.stdout.includes("first gameplay task"), "BEFORE has first note");
  assert.ok(result2.outputCapture.stdout.includes("stamina cooldown"), "AFTER has second note");
});

test("executeSandboxNotesDispatch after content matches expected before/after example from spec", async () => {
  resetReplay();
  const sharedFs = makeSharedInMemoryFs();
  const workspaceRoot = nodePath.join(REPO_ROOT, ".ai-e/sandboxes", SANDBOX_ID, "workspace");

  // Pre-seed the file with the "before" content from the spec
  await sharedFs.createDirectory(workspaceRoot);
  const seedPath = key(nodePath.join(workspaceRoot, SANDBOX_NOTES_FILE_NAME));
  sharedFs.files.set(seedPath, "# Sandbox Notes\n- add first gameplay task");

  const adapter = createSandboxNotesRuntimeAdapter(sharedFs);
  await executeSandboxNotesDispatch({
    approvalToken: "operator-approved",
    authorization: makeApproval("proposal-notes-spec-example"),
    expiresAt: EXPIRES_FUTURE,
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    operationRequest: "Added governed stamina cooldown note",
    now: () => FIXED_TIME,
    filesystem: sharedFs,
    adapter,
  });

  const afterContent = sharedFs.files.get(seedPath) ?? "";
  assert.ok(afterContent.includes("- add first gameplay task"), "preserves existing bullet");
  assert.ok(afterContent.includes("- OpenClaw: Added governed stamina cooldown note"), "appended OpenClaw note");
  assert.ok(
    afterContent.indexOf("- add first gameplay task") < afterContent.indexOf("- OpenClaw:"),
    "new note appears after existing bullet",
  );
});
