import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildGovernedSandboxScaffold } from "./sandboxExecutionBoundary";
import {
  createSandboxSnapshotManifest,
  type SandboxSnapshotDirectoryEntry,
  type SandboxSnapshotFilesystem,
} from "./sandboxSnapshotLifecycle";

const FIXED_TIME = "2026-05-20T17:00:00.000Z";

function key(absolutePath: string): string {
  return path.normalize(absolutePath);
}

function createVirtualFilesystem(input: {
  directories: Map<string, SandboxSnapshotDirectoryEntry[]>;
  files?: Map<string, Buffer | string>;
  written?: Array<{ absolutePath: string; content: string }>;
  createdDirectories?: string[];
}): SandboxSnapshotFilesystem {
  return {
    listDirectory: async (absolutePath) => {
      const entries = input.directories.get(key(absolutePath));
      if (!entries) {
        const error = new Error(`ENOENT: no such directory, scandir '${absolutePath}'`);
        (error as Error & { code: string }).code = "ENOENT";
        throw error;
      }
      return entries;
    },
    readFile: async (absolutePath) => {
      const content = input.files?.get(key(absolutePath));
      if (content === undefined) {
        throw new Error(`Unable to read ${absolutePath}`);
      }
      return content;
    },
    createDirectory: async (absolutePath) => {
      input.createdDirectories?.push(absolutePath);
    },
    writeFile: async (absolutePath, content) => {
      input.written?.push({ absolutePath, content });
    },
  };
}

test("createSandboxSnapshotManifest produces a dry-run before manifest with workspace inventory and hashes", async () => {
  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-snapshot-before",
  });
  const directories = new Map<string, SandboxSnapshotDirectoryEntry[]>([
    [key(scaffold.workspace.absolutePath), [
      { name: "src", kind: "directory" },
      { name: "README.md", kind: "file", sizeBytes: 7, modifiedAt: FIXED_TIME },
    ]],
    [key(path.join(scaffold.workspace.absolutePath, "src")), [
      { name: "index.ts", kind: "file", sizeBytes: 18, modifiedAt: FIXED_TIME },
    ]],
  ]);
  const files = new Map<string, Buffer | string>([
    [key(path.join(scaffold.workspace.absolutePath, "README.md")), "read-me"],
    [key(path.join(scaffold.workspace.absolutePath, "src", "index.ts")), "export const ok = 1;"],
  ]);

  const record = await createSandboxSnapshotManifest({
    scaffold,
    phase: "before",
    now: () => FIXED_TIME,
    includeContentHashes: true,
    filesystem: createVirtualFilesystem({ directories, files }),
  });

  assert.equal(record.manifest.manifestVersion, "EXEC-0043-B");
  assert.equal(record.manifest.phase, "before");
  assert.equal(record.manifest.receipt.status, "dry_run_preview");
  assert.equal(record.manifest.receipt.written, false);
  assert.equal(record.manifest.workspaceRoot.sandboxRelativePath, "workspace");
  assert.deepEqual(record.manifest.fileInventory.map((entry) => entry.relativePath), ["README.md", "src/index.ts"]);
  assert.equal(record.manifest.fileCount, 2);
  assert.equal(record.manifest.totalSizeBytes, 25);
  assert.ok(record.manifest.fileInventory.every((entry) => entry.hashAlgorithm === "sha256"));
  assert.ok(record.manifest.fileInventory.every((entry) => typeof entry.contentHash === "string" && entry.contentHash.length === 64));
  assert.match(record.receiptPreview, /"manifestVersion": "EXEC-0043-B"/);
});

test("snapshot inventory skips unsafe workspace entries without leaving the sandbox workspace", async () => {
  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-snapshot-safety",
  });
  const directories = new Map<string, SandboxSnapshotDirectoryEntry[]>([
    [key(scaffold.workspace.absolutePath), [
      { name: "../outside.txt", kind: "file", sizeBytes: 4 },
      { name: "src/*.ts", kind: "file", sizeBytes: 8 },
      { name: "link-to-host", kind: "symlink" },
      { name: "socket-like", kind: "other" },
      { name: "safe.txt", kind: "file", sizeBytes: 4 },
    ]],
  ]);
  const files = new Map<string, Buffer | string>([
    [key(path.join(scaffold.workspace.absolutePath, "safe.txt")), "safe"],
  ]);

  const record = await createSandboxSnapshotManifest({
    scaffold,
    phase: "after",
    now: () => FIXED_TIME,
    includeContentHashes: true,
    filesystem: createVirtualFilesystem({ directories, files }),
  });

  assert.deepEqual(record.manifest.fileInventory.map((entry) => entry.relativePath), ["safe.txt"]);
  assert.ok(record.manifest.warnings.some((warning) => warning.code === "invalid_workspace_entry" && warning.path === "../outside.txt"));
  assert.ok(record.manifest.warnings.some((warning) => warning.code === "invalid_workspace_entry" && warning.path === "src/*.ts"));
  assert.ok(record.manifest.warnings.some((warning) => warning.code === "skipped_symlink" && warning.path === "link-to-host"));
  assert.ok(record.manifest.warnings.some((warning) => warning.code === "skipped_unsupported_entry" && warning.path === "socket-like"));
});

test("snapshot receipt writing only occurs when dry-run is disabled and receipt writing is requested", async () => {
  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-snapshot-write",
  });
  const directories = new Map<string, SandboxSnapshotDirectoryEntry[]>([
    [key(scaffold.workspace.absolutePath), [
      { name: "result.txt", kind: "file", sizeBytes: 6, modifiedAt: FIXED_TIME },
    ]],
  ]);
  const createdDirectories: string[] = [];
  const written: Array<{ absolutePath: string; content: string }> = [];

  const dryRunRecord = await createSandboxSnapshotManifest({
    scaffold,
    phase: "after",
    now: () => FIXED_TIME,
    filesystem: createVirtualFilesystem({ directories, createdDirectories, written }),
  });

  assert.equal(dryRunRecord.manifest.receipt.status, "dry_run_preview");
  assert.equal(createdDirectories.length, 0);
  assert.equal(written.length, 0);

  const writtenRecord = await createSandboxSnapshotManifest({
    scaffold,
    phase: "after",
    now: () => FIXED_TIME,
    dryRun: false,
    writeReceipt: true,
    receiptFileName: "after-manifest.json",
    filesystem: createVirtualFilesystem({ directories, createdDirectories, written }),
  });

  assert.equal(writtenRecord.manifest.receipt.status, "written");
  assert.equal(writtenRecord.manifest.receipt.path.sandboxRelativePath, "receipts/after-manifest.json");
  assert.deepEqual(createdDirectories, [scaffold.receipts.absolutePath]);
  assert.equal(written.length, 1);
  assert.equal(written[0]?.absolutePath, path.join(scaffold.receipts.absolutePath, "after-manifest.json"));
  assert.match(written[0]?.content ?? "", /"phase": "after"/);
});

test("snapshot lifecycle reports missing workspaces and validates receipt paths", async () => {
  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-snapshot-missing",
  });
  const record = await createSandboxSnapshotManifest({
    scaffold,
    phase: "before",
    now: () => FIXED_TIME,
    filesystem: createVirtualFilesystem({ directories: new Map() }),
  });

  assert.equal(record.manifest.fileCount, 0);
  assert.ok(record.manifest.warnings.some((warning) => warning.code === "workspace_missing"));

  await assert.rejects(
    createSandboxSnapshotManifest({
      scaffold,
      phase: "before",
      now: () => FIXED_TIME,
      receiptFileName: "../escape.json",
      filesystem: createVirtualFilesystem({ directories: new Map() }),
    }),
    /path traversal/i,
  );
});
