import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildGovernedSandboxScaffold } from "./sandboxExecutionBoundary";
import type { SandboxSnapshotDirectoryEntry } from "./sandboxSnapshotLifecycle";
import {
  executeGovernedSandboxDispatch,
  GOVERNED_DISPATCH_APPROVAL_TOKEN,
  type GovernedDispatchFilesystem,
  type GovernedDispatchRequest,
} from "./sandboxedRuntimeDispatch";

const FIXED_TIME = "2026-05-21T00:00:00.000Z";
const REPO_ROOT = path.resolve("E:/test-ai-e");
const SANDBOX_ID = "sandbox-exec-0051-test";

function key(absolutePath: string): string {
  return path.normalize(absolutePath);
}

// In-memory filesystem used by most tests — no real disk I/O
function createInMemoryFilesystem(): GovernedDispatchFilesystem & {
  files: Map<string, string>;
  directories: Set<string>;
} {
  const files = new Map<string, string>();
  const directories = new Set<string>();

  function buildDirectoryEntries(dirPath: string): SandboxSnapshotDirectoryEntry[] {
    const normalizedDir = key(dirPath);
    const entries: SandboxSnapshotDirectoryEntry[] = [];

    for (const [filePath] of files) {
      const normalizedFile = key(filePath);
      const parent = path.dirname(normalizedFile);
      if (parent === normalizedDir) {
        entries.push({
          name: path.basename(filePath),
          kind: "file",
          sizeBytes: Buffer.byteLength(files.get(filePath) ?? ""),
          modifiedAt: FIXED_TIME,
        });
      }
    }

    for (const dir of directories) {
      const normalizedCandidate = key(dir);
      const parent = path.dirname(normalizedCandidate);
      if (parent === normalizedDir && normalizedCandidate !== normalizedDir) {
        entries.push({ name: path.basename(dir), kind: "directory" });
      }
    }

    return entries;
  }

  return {
    files,
    directories,
    createDirectory: async (absolutePath) => {
      directories.add(absolutePath);
    },
    writeFile: async (absolutePath, content) => {
      files.set(key(absolutePath), content);
    },
    readFile: async (absolutePath) => {
      const content = files.get(key(absolutePath));
      if (content === undefined) {
        const err = new Error(`ENOENT: no such file: ${absolutePath}`);
        (err as Error & { code: string }).code = "ENOENT";
        throw err;
      }
      return content;
    },
    listDirectory: async (absolutePath) => {
      const normalizedPath = key(absolutePath);
      const isKnown = directories.has(absolutePath) || [...files.keys()].some((f) => path.dirname(f) === normalizedPath);
      if (!isKnown) {
        const err = new Error(`ENOENT: no such directory: ${absolutePath}`);
        (err as Error & { code: string }).code = "ENOENT";
        throw err;
      }
      return buildDirectoryEntries(absolutePath);
    },
    getFileSize: async (absolutePath) => {
      const content = files.get(key(absolutePath));
      if (content === undefined) {
        throw new Error(`ENOENT: ${absolutePath}`);
      }
      return Buffer.byteLength(content);
    },
  };
}

function baseRequest(overrides?: Partial<GovernedDispatchRequest>): GovernedDispatchRequest {
  return {
    approvalToken: GOVERNED_DISPATCH_APPROVAL_TOKEN,
    operationRequest: "Write governed review artifact to sandbox workspace",
    operationContent: "# Review Artifact\n\nGoverned dispatch test output.",
    targetFileName: "review-artifact.md",
    sandboxId: SANDBOX_ID,
    repositoryRoot: REPO_ROOT,
    now: () => FIXED_TIME,
    filesystem: createInMemoryFilesystem(),
    ...overrides,
  };
}

// ---- Approval gate tests -----------------------------------------------------------

test("executeGovernedSandboxDispatch throws when approvalToken is missing", async () => {
  await assert.rejects(
    () => executeGovernedSandboxDispatch(baseRequest({ approvalToken: "" })),
    /approvalToken must be exactly "operator-approved"/,
  );
});

test("executeGovernedSandboxDispatch throws when approvalToken is wrong string", async () => {
  await assert.rejects(
    () => executeGovernedSandboxDispatch(baseRequest({ approvalToken: "approved" })),
    /approvalToken must be exactly "operator-approved"/,
  );
});

test("executeGovernedSandboxDispatch throws when approvalToken is simulated value", async () => {
  await assert.rejects(
    () => executeGovernedSandboxDispatch(baseRequest({ approvalToken: "SIMULATED" })),
    /approvalToken must be exactly "operator-approved"/,
  );
});

// ---- Target filename validation tests ----------------------------------------------

test("executeGovernedSandboxDispatch throws for filename with path separator", async () => {
  await assert.rejects(
    () => executeGovernedSandboxDispatch(baseRequest({ targetFileName: "sub/file.md" })),
    /not a safe sandbox filename/,
  );
});

test("executeGovernedSandboxDispatch throws for filename with traversal", async () => {
  await assert.rejects(
    () => executeGovernedSandboxDispatch(baseRequest({ targetFileName: "../escape.md" })),
    /not a safe sandbox filename/,
  );
});

test("executeGovernedSandboxDispatch throws for empty target filename", async () => {
  await assert.rejects(
    () => executeGovernedSandboxDispatch(baseRequest({ targetFileName: "   " })),
    /not a safe sandbox filename/,
  );
});

// ---- Execution lifecycle tests -----------------------------------------------------

test("executeGovernedSandboxDispatch returns completed outcome with correct approval token", async () => {
  const result = await executeGovernedSandboxDispatch(baseRequest());
  assert.equal(result.outcome, "completed");
  assert.equal(result.manifestVersion, "EXEC-0051");
  assert.equal(result.sandboxId, SANDBOX_ID);
});

test("executeGovernedSandboxDispatch before snapshot is empty, after snapshot has the written file", async () => {
  const result = await executeGovernedSandboxDispatch(baseRequest());
  assert.equal(result.beforeSnapshotFileCount, 0, "Before snapshot should show empty workspace");
  assert.equal(result.afterSnapshotFileCount, 1, "After snapshot should show the written file");
});

test("executeGovernedSandboxDispatch diff shows one created entry", async () => {
  const result = await executeGovernedSandboxDispatch(baseRequest());
  assert.equal(result.diffEntries.length, 1);
  assert.equal(result.diffEntries[0]?.changeKind, "created");
  assert.ok(result.diffEntries[0]?.sandboxRelativePath.includes("review-artifact.md"));
});

test("executeGovernedSandboxDispatch stdout is the content written to the sandbox file", async () => {
  const content = "# Test Content\n\nThis is real bounded execution output.";
  const result = await executeGovernedSandboxDispatch(baseRequest({ operationContent: content }));
  assert.equal(result.stdout, content);
});

test("executeGovernedSandboxDispatch receipt is generated with executed phase", async () => {
  const result = await executeGovernedSandboxDispatch(baseRequest());
  assert.ok(result.receiptId.startsWith("receipt-"), `Expected receiptId to start with "receipt-", got "${result.receiptId}"`);
  assert.ok(result.receiptSandboxPath.length > 0, "receiptSandboxPath should be non-empty");
});

test("executeGovernedSandboxDispatch target file size is non-zero after execution", async () => {
  const result = await executeGovernedSandboxDispatch(baseRequest());
  assert.ok(result.targetFile.sizeBytes > 0, "Written file should have non-zero size");
});

test("executeGovernedSandboxDispatch sandboxRootPath is within .ai-e/sandboxes", async () => {
  const result = await executeGovernedSandboxDispatch(baseRequest());
  const relative = path.relative(REPO_ROOT, result.sandboxRootPath).split(path.sep).join("/");
  assert.ok(relative.startsWith(".ai-e/sandboxes/"), `sandboxRootPath "${relative}" should start with .ai-e/sandboxes/`);
});

test("executeGovernedSandboxDispatch safety boundary flags are all correct", async () => {
  const result = await executeGovernedSandboxDispatch(baseRequest());
  assert.equal(result.safetyBoundary.approvalRequired, true);
  assert.equal(result.safetyBoundary.sandboxScoped, true);
  assert.equal(result.safetyBoundary.shellExecutionEnabled, false);
  assert.equal(result.safetyBoundary.networkExecutionEnabled, false);
  assert.equal(result.safetyBoundary.productionWorkspaceMutationEnabled, false);
  assert.equal(result.safetyBoundary.automaticContinuationEnabled, false);
  assert.equal(result.safetyBoundary.singleOperationOnly, true);
  assert.equal(result.safetyBoundary.humanAuthorityFinal, true);
});

test("executeGovernedSandboxDispatch durationMs is a non-negative number", async () => {
  const result = await executeGovernedSandboxDispatch(baseRequest());
  assert.equal(typeof result.durationMs, "number");
  assert.ok(result.durationMs >= 0);
});

// ---- Timeout test ------------------------------------------------------------------

test("executeGovernedSandboxDispatch returns timed_out outcome when filesystem hangs", async () => {
  const hangingFs: GovernedDispatchFilesystem = {
    createDirectory: () => new Promise(() => { /* never resolves */ }),
    writeFile: () => new Promise(() => { /* never resolves */ }),
    readFile: () => new Promise(() => { /* never resolves */ }),
    listDirectory: () => new Promise(() => { /* never resolves */ }),
    getFileSize: () => new Promise(() => { /* never resolves */ }),
  };
  const result = await executeGovernedSandboxDispatch(baseRequest({ filesystem: hangingFs, timeoutMs: 100 }));
  assert.equal(result.outcome, "timed_out");
  assert.ok(result.error?.includes("timed out"), `Expected timed_out error, got: "${result.error}"`);
}, { timeout: 5000 });

// ---- Sandbox boundary test ---------------------------------------------------------

test("executeGovernedSandboxDispatch file written is inside the sandbox workspace path", async () => {
  const fs = createInMemoryFilesystem();
  await executeGovernedSandboxDispatch(baseRequest({ filesystem: fs }));

  const scaffold = buildGovernedSandboxScaffold({ sandboxId: SANDBOX_ID, repositoryRoot: REPO_ROOT, now: () => FIXED_TIME });
  const expectedBase = key(scaffold.workspace.absolutePath);
  const writtenPaths = [...fs.files.keys()].filter((p) => !p.includes("receipts") && !p.includes("snapshots"));

  assert.ok(writtenPaths.length > 0, "Expected at least one file written to workspace");
  for (const writtenPath of writtenPaths) {
    const relative = path.relative(expectedBase, writtenPath);
    assert.ok(
      !relative.startsWith(".."),
      `File "${writtenPath}" is outside sandbox workspace "${expectedBase}"`,
    );
  }
});
