import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildGovernedSandboxScaffold,
  createGovernedSandboxId,
  normalizeGovernedSandboxId,
  prepareGovernedSandboxWorkspace,
  resolveGovernedSandboxPath,
} from "./sandboxExecutionBoundary";

const FIXED_TIME = "2026-05-20T16:00:00.000Z";

test("buildGovernedSandboxScaffold defines the governed execution boundary structure", () => {
  const repositoryRoot = path.resolve("E:/test-ai-e");
  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot,
    sandboxId: "sandbox-exec-0043-a",
  });

  assert.equal(scaffold.sandboxId, "sandbox-exec-0043-a");
  assert.equal(scaffold.governedRoot.relativePath, ".ai-e/sandboxes");
  assert.deepEqual(scaffold.directories.map((entry) => entry.relativePath), [
    ".ai-e/sandboxes",
    ".ai-e/sandboxes/sandbox-exec-0043-a",
    ".ai-e/sandboxes/sandbox-exec-0043-a/workspace",
    ".ai-e/sandboxes/sandbox-exec-0043-a/snapshots",
    ".ai-e/sandboxes/sandbox-exec-0043-a/snapshots/before",
    ".ai-e/sandboxes/sandbox-exec-0043-a/snapshots/after",
    ".ai-e/sandboxes/sandbox-exec-0043-a/receipts",
  ]);
});

test("prepareGovernedSandboxWorkspace can dry-run without creating directories", async () => {
  const createdDirectories: string[] = [];
  const receipt = await prepareGovernedSandboxWorkspace({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-dry-run",
    now: () => FIXED_TIME,
    dryRun: true,
    createDirectory: async (directoryPath) => {
      createdDirectories.push(directoryPath);
    },
  });

  assert.equal(receipt.receiptVersion, "EXEC-0043-A");
  assert.equal(receipt.status, "dry_run_prepared");
  assert.equal(receipt.preparedAt, FIXED_TIME);
  assert.equal(createdDirectories.length, 0);
  assert.ok(receipt.directories.every((entry) => entry.created === false));
  assert.deepEqual(receipt.safetyBoundary, {
    boundedToSandboxRoot: true,
    shellExecutionEnabled: false,
    networkExecutionEnabled: false,
    deletionEnabled: false,
    automaticRuntimeExecution: false,
    runtimeApprovalRequired: true,
  });
});

test("prepareGovernedSandboxWorkspace explicitly creates only scaffold directories when enabled", async () => {
  const repositoryRoot = path.resolve("E:/test-ai-e");
  const createdDirectories: string[] = [];
  const receipt = await prepareGovernedSandboxWorkspace({
    repositoryRoot,
    sandboxId: "sandbox-create-check",
    now: () => FIXED_TIME,
    dryRun: false,
    createDirectory: async (directoryPath) => {
      createdDirectories.push(path.relative(repositoryRoot, directoryPath).split(path.sep).join("/"));
    },
  });

  assert.equal(receipt.status, "prepared");
  assert.deepEqual(createdDirectories, receipt.directories.map((entry) => entry.relativePath));
  assert.ok(createdDirectories.every((entry) => entry === ".ai-e/sandboxes" || entry.startsWith(".ai-e/sandboxes/sandbox-create-check")));
  assert.ok(receipt.directories.every((entry) => entry.created === true));
});

test("resolveGovernedSandboxPath keeps relative and absolute paths inside the sandbox root", () => {
  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-path-check",
  });

  const workspaceFile = resolveGovernedSandboxPath(scaffold, "src/example.ts");
  assert.equal(workspaceFile.base, "workspace");
  assert.equal(workspaceFile.sandboxRelativePath, "workspace/src/example.ts");

  const receiptFile = resolveGovernedSandboxPath(scaffold, "receipt.json", "receipts");
  assert.equal(receiptFile.sandboxRelativePath, "receipts/receipt.json");

  const absoluteInside = resolveGovernedSandboxPath(scaffold, path.join(scaffold.workspace.absolutePath, "nested", "file.txt"));
  assert.equal(absoluteInside.sandboxRelativePath, "workspace/nested/file.txt");
});

test("resolveGovernedSandboxPath rejects traversal, wildcard, empty, and out-of-sandbox paths", () => {
  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-blocked-paths",
  });

  assert.throws(() => resolveGovernedSandboxPath(scaffold, "../outside.txt"), /path traversal/i);
  assert.throws(() => resolveGovernedSandboxPath(scaffold, "nested/../../outside.txt"), /path traversal/i);
  assert.throws(() => resolveGovernedSandboxPath(scaffold, "src/*.ts"), /wildcard/i);
  assert.throws(() => resolveGovernedSandboxPath(scaffold, " "), /required/i);
  assert.throws(() => resolveGovernedSandboxPath(scaffold, path.resolve("E:/outside-ai-e/file.txt")), /sandbox root/i);
  assert.throws(() => resolveGovernedSandboxPath(scaffold, path.join(scaffold.receipts.absolutePath, "receipt.json")), /base directory/i);
});

test("sandbox id helpers preserve sandbox-id format and reject unsafe ids", () => {
  assert.equal(normalizeGovernedSandboxId("sandbox-exec_0043-a"), "sandbox-exec_0043-a");
  assert.equal(createGovernedSandboxId({ label: "EXEC 0043 A", now: () => FIXED_TIME }), "sandbox-20260520160000-exec-0043-a");

  assert.throws(() => normalizeGovernedSandboxId("exec-0043-a"), /sandbox-<id>/i);
  assert.throws(() => normalizeGovernedSandboxId("sandbox-../escape"), /sandbox-<id>/i);
  assert.throws(() => normalizeGovernedSandboxId("sandbox-UpperCase"), /sandbox-<id>/i);
});
