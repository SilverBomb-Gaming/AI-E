import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildGovernedSandboxScaffold,
  resolveGovernedSandboxPath,
  type BuildGovernedSandboxScaffoldInput,
  type GovernedSandboxSafePath,
  type GovernedSandboxScaffold,
} from "./sandboxExecutionBoundary";

export type SandboxSnapshotPhase = "before" | "after";

export type SandboxSnapshotDirectoryEntryKind = "file" | "directory" | "symlink" | "other";

export type SandboxSnapshotDirectoryEntry = {
  name: string;
  kind: SandboxSnapshotDirectoryEntryKind;
  sizeBytes?: number;
  modifiedAt?: string;
};

export type SandboxSnapshotWarningCode =
  | "workspace_missing"
  | "invalid_workspace_entry"
  | "skipped_symlink"
  | "skipped_unsupported_entry"
  | "read_failed"
  | "receipt_write_skipped";

export type SandboxSnapshotWarning = {
  code: SandboxSnapshotWarningCode;
  path?: string;
  message: string;
};

export type SandboxSnapshotFileInventoryEntry = {
  relativePath: string;
  sandboxRelativePath: string;
  sizeBytes: number;
  modifiedAt?: string;
  contentHash?: string;
  hashAlgorithm?: "sha256";
};

export type SandboxSnapshotReceiptStatus =
  | "dry_run_preview"
  | "write_not_requested"
  | "written";

export type SandboxSnapshotManifest = {
  manifestVersion: "EXEC-0043-B";
  sandboxId: string;
  phase: SandboxSnapshotPhase;
  createdAt: string;
  workspaceRoot: GovernedSandboxSafePath;
  fileInventory: SandboxSnapshotFileInventoryEntry[];
  fileCount: number;
  totalSizeBytes: number;
  includeContentHashes: boolean;
  warnings: SandboxSnapshotWarning[];
  receipt: {
    status: SandboxSnapshotReceiptStatus;
    path: GovernedSandboxSafePath;
    written: boolean;
  };
  safetyBoundary: {
    inspectedWorkspaceOnly: true;
    shellExecutionEnabled: false;
    networkExecutionEnabled: false;
    sourceWorkspaceMutationEnabled: false;
    rollbackExecutionEnabled: false;
    automaticRuntimeExecution: false;
  };
};

export type SandboxSnapshotLifecycleRecord = {
  manifest: SandboxSnapshotManifest;
  receiptPreview: string;
};

export type SandboxSnapshotFilesystem = {
  listDirectory?: (absolutePath: string) => Promise<SandboxSnapshotDirectoryEntry[]>;
  readFile?: (absolutePath: string) => Promise<Buffer | string>;
  createDirectory?: (absolutePath: string) => Promise<void>;
  writeFile?: (absolutePath: string, content: string) => Promise<void>;
};

export type CreateSandboxSnapshotManifestInput = BuildGovernedSandboxScaffoldInput & {
  scaffold?: GovernedSandboxScaffold;
  phase: SandboxSnapshotPhase;
  includeContentHashes?: boolean;
  dryRun?: boolean;
  writeReceipt?: boolean;
  receiptFileName?: string;
  filesystem?: SandboxSnapshotFilesystem;
};

function timestampId(now: () => string): string {
  return now().replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function workspaceRelativeFromSandboxPath(sandboxRelativePath: string): string {
  if (sandboxRelativePath === "workspace") {
    return "";
  }
  return sandboxRelativePath.replace(/^workspace\//, "");
}

function isMissingDirectoryError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isUnsafeEntryName(name: string): boolean {
  return !name.trim()
    || /[\x00-\x1F]/.test(name)
    || name.includes("/")
    || name.includes("\\")
    || /[*?<>|]/.test(name)
    || name.replace(/\\/g, "/").split("/").some((segment) => segment === "..");
}

function joinWorkspacePath(currentRelativePath: string, entryName: string): string {
  return currentRelativePath ? `${currentRelativePath}/${entryName}` : entryName;
}

function createContentHash(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function defaultListDirectory(absolutePath: string): Promise<SandboxSnapshotDirectoryEntry[]> {
  const entries = await readdir(absolutePath, { withFileTypes: true });

  return Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(absolutePath, entry.name);
    const stats = await lstat(entryPath);
    const kind: SandboxSnapshotDirectoryEntryKind = stats.isFile()
      ? "file"
      : stats.isDirectory()
        ? "directory"
        : stats.isSymbolicLink()
          ? "symlink"
          : "other";

    return {
      name: entry.name,
      kind,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    };
  }));
}

function resolveReceiptPath(scaffold: GovernedSandboxScaffold, phase: SandboxSnapshotPhase, input: CreateSandboxSnapshotManifestInput): GovernedSandboxSafePath {
  const receiptFileName = input.receiptFileName ?? `${phase}-snapshot-${timestampId(input.now ?? (() => new Date().toISOString()))}.json`;
  return resolveGovernedSandboxPath(scaffold, receiptFileName, "receipts");
}

async function inventoryWorkspace(input: {
  scaffold: GovernedSandboxScaffold;
  includeContentHashes: boolean;
  filesystem: Required<Pick<SandboxSnapshotFilesystem, "listDirectory" | "readFile">>;
}): Promise<{
  fileInventory: SandboxSnapshotFileInventoryEntry[];
  warnings: SandboxSnapshotWarning[];
}> {
  const fileInventory: SandboxSnapshotFileInventoryEntry[] = [];
  const warnings: SandboxSnapshotWarning[] = [];

  async function visitDirectory(absoluteDirectoryPath: string, currentRelativePath: string): Promise<void> {
    let entries: SandboxSnapshotDirectoryEntry[];
    try {
      entries = await input.filesystem.listDirectory(absoluteDirectoryPath);
    } catch (error) {
      if (!currentRelativePath && isMissingDirectoryError(error)) {
        warnings.push({
          code: "workspace_missing",
          path: input.scaffold.workspace.relativePath,
          message: "Sandbox workspace does not exist yet; snapshot inventory is empty.",
        });
        return;
      }

      warnings.push({
        code: "read_failed",
        path: currentRelativePath || input.scaffold.workspace.relativePath,
        message: error instanceof Error ? error.message : "Unable to read sandbox workspace directory.",
      });
      return;
    }

    const sortedEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of sortedEntries) {
      if (isUnsafeEntryName(entry.name)) {
        warnings.push({
          code: "invalid_workspace_entry",
          path: joinWorkspacePath(currentRelativePath, entry.name),
          message: "Workspace entry was skipped because its path is not sandbox-safe.",
        });
        continue;
      }

      let safePath: GovernedSandboxSafePath;
      try {
        safePath = resolveGovernedSandboxPath(input.scaffold, joinWorkspacePath(currentRelativePath, entry.name), "workspace");
      } catch (error) {
        warnings.push({
          code: "invalid_workspace_entry",
          path: joinWorkspacePath(currentRelativePath, entry.name),
          message: error instanceof Error ? error.message : "Workspace entry was rejected by the sandbox boundary.",
        });
        continue;
      }

      const workspaceRelativePath = workspaceRelativeFromSandboxPath(safePath.sandboxRelativePath);
      if (entry.kind === "directory") {
        await visitDirectory(safePath.absolutePath, workspaceRelativePath);
        continue;
      }

      if (entry.kind === "symlink") {
        warnings.push({
          code: "skipped_symlink",
          path: workspaceRelativePath,
          message: "Symbolic links are skipped so snapshot inventory does not follow paths outside the sandbox workspace.",
        });
        continue;
      }

      if (entry.kind !== "file") {
        warnings.push({
          code: "skipped_unsupported_entry",
          path: workspaceRelativePath,
          message: `Workspace entry kind '${entry.kind}' is not included in snapshot inventory.`,
        });
        continue;
      }

      const inventoryEntry: SandboxSnapshotFileInventoryEntry = {
        relativePath: workspaceRelativePath,
        sandboxRelativePath: safePath.sandboxRelativePath,
        sizeBytes: Math.max(0, Math.floor(entry.sizeBytes ?? 0)),
        modifiedAt: entry.modifiedAt,
      };

      if (input.includeContentHashes) {
        try {
          inventoryEntry.contentHash = createContentHash(await input.filesystem.readFile(safePath.absolutePath));
          inventoryEntry.hashAlgorithm = "sha256";
        } catch (error) {
          warnings.push({
            code: "read_failed",
            path: workspaceRelativePath,
            message: error instanceof Error ? error.message : "Unable to hash sandbox workspace file.",
          });
        }
      }

      fileInventory.push(inventoryEntry);
    }
  }

  await visitDirectory(input.scaffold.workspace.absolutePath, "");

  return {
    fileInventory: fileInventory.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    warnings,
  };
}

export async function createSandboxSnapshotManifest(input: CreateSandboxSnapshotManifestInput): Promise<SandboxSnapshotLifecycleRecord> {
  const dryRun = input.dryRun !== false;
  const writeReceipt = input.writeReceipt === true;
  const includeContentHashes = input.includeContentHashes === true;
  const createdAt = input.now?.() ?? new Date().toISOString();
  const scaffold = input.scaffold ?? buildGovernedSandboxScaffold(input);
  const receiptPath = resolveReceiptPath(scaffold, input.phase, input);
  const filesystem: Required<SandboxSnapshotFilesystem> = {
    listDirectory: input.filesystem?.listDirectory ?? defaultListDirectory,
    readFile: input.filesystem?.readFile ?? readFile,
    createDirectory: input.filesystem?.createDirectory ?? ((absolutePath: string) => mkdir(absolutePath, { recursive: true }).then(() => undefined)),
    writeFile: input.filesystem?.writeFile ?? ((absolutePath: string, content: string) => writeFile(absolutePath, content, "utf8")),
  };

  const inventory = await inventoryWorkspace({
    scaffold,
    includeContentHashes,
    filesystem,
  });

  const receiptStatus: SandboxSnapshotReceiptStatus = dryRun
    ? "dry_run_preview"
    : writeReceipt
      ? "written"
      : "write_not_requested";

  const manifest: SandboxSnapshotManifest = {
    manifestVersion: "EXEC-0043-B",
    sandboxId: scaffold.sandboxId,
    phase: input.phase,
    createdAt,
    workspaceRoot: resolveGovernedSandboxPath(scaffold, ".", "workspace"),
    fileInventory: inventory.fileInventory,
    fileCount: inventory.fileInventory.length,
    totalSizeBytes: inventory.fileInventory.reduce((total, entry) => total + entry.sizeBytes, 0),
    includeContentHashes,
    warnings: dryRun || writeReceipt
      ? inventory.warnings
      : [
          ...inventory.warnings,
          {
            code: "receipt_write_skipped",
            path: receiptPath.sandboxRelativePath,
            message: "Snapshot receipt writing was not requested; manifest was returned in memory only.",
          },
        ],
    receipt: {
      status: receiptStatus,
      path: receiptPath,
      written: !dryRun && writeReceipt,
    },
    safetyBoundary: {
      inspectedWorkspaceOnly: true,
      shellExecutionEnabled: false,
      networkExecutionEnabled: false,
      sourceWorkspaceMutationEnabled: false,
      rollbackExecutionEnabled: false,
      automaticRuntimeExecution: false,
    },
  };

  const receiptPreview = JSON.stringify(manifest, null, 2);
  if (!dryRun && writeReceipt) {
    await filesystem.createDirectory(path.dirname(receiptPath.absolutePath));
    await filesystem.writeFile(receiptPath.absolutePath, receiptPreview);
  }

  return {
    manifest,
    receiptPreview,
  };
}
