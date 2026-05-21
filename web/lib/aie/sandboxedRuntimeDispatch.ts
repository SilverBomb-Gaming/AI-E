// =====================
// AI-E GOVERNED DISPATCH CONTRACTS (EXEC-0051-A)
// =====================

/**
 * APPROVAL CONTRACT
 * Defines who can authorize execution, how approval is persisted, and how it is verified before dispatch.
 */
export interface GovernedExecutionApproval {
  authorityToken: ApprovalAuthorityToken;
  approvedBy: string; // operator id or username
  approvedAt: string; // ISO timestamp
  proposalId: string;
  operationRequest: string;
}

export type ApprovalAuthorityToken = string & { readonly __approval: unique symbol };

export interface ApprovalVerificationResult {
  valid: boolean;
  reason?: string;
  checkedAt: string;
  authorityToken: ApprovalAuthorityToken;
}

/**
 * SANDBOX MUTATION CONTRACT
 * Defines what paths may mutate, how allowed paths are validated, and how sandbox boundaries are enforced.
 */
export interface GovernedSandboxMutationScope {
  allowedPaths: AllowedMutationPath[];
  forbiddenPaths: string[];
  enforceBoundaries: boolean;
}

export interface AllowedMutationPath {
  sandboxRelativePath: string;
  description?: string;
}

export interface SandboxMutationValidationResult {
  valid: boolean;
  attemptedPath: string;
  reason?: string;
  checkedAt: string;
}

/**
 * RUNTIME INVOCATION CONTRACT
 * Defines runtime invocation boundaries, timeout, stdout/stderr capture, and lifecycle transitions.
 */
export interface GovernedRuntimeDispatchContract {
  dispatchId: string;
  runtime: string;
  operationRequest: string;
  approval: GovernedExecutionApproval;
  mutationScope: GovernedSandboxMutationScope;
  invocationBoundary: RuntimeInvocationBoundary;
  lifecycle: DispatchLifecycleRecord[];
}

export interface RuntimeInvocationBoundary {
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  allowShell: false;
  allowNetwork: false;
  allowProductionMutation: false;
}

export interface RuntimeDispatchResult {
  dispatchId: string;
  startedAt: string;
  completedAt: string;
  outcome: GovernedDispatchOutcome;
  stdout: string;
  stderr: string[];
  error?: string;
}

export interface DispatchLifecycleRecord {
  state: 'awaiting_approval' | 'dispatching' | 'executing' | 'completed' | 'failed';
  timestamp: string;
  message?: string;
}

/**
 * ROLLBACK CONTRACT
 * Defines rollback guarantees, snapshot lifecycle, and rollback metadata.
 */
export interface GovernedRollbackContract {
  rollbackReady: boolean;
  beforeSnapshotId: string;
  afterSnapshotId: string;
  rollbackMetadata: RollbackMetadata;
  verification: RollbackVerificationResult;
}

export interface RollbackMetadata {
  changedFiles: string[];
  diffSummary: string;
  createdAt: string;
}

export interface RollbackVerificationResult {
  valid: boolean;
  reason?: string;
  checkedAt: string;
}

/**
 * RECEIPT CONTRACT
 * Defines what must be recorded atomically, mutation evidence, and lifecycle visibility.
 */
export interface GovernedDispatchReceiptContract {
  receiptId: string;
  dispatchId: string;
  issuedAt: string;
  issuedBy: string;
  evidence: DispatchEvidenceRecord;
  lifecycle: DispatchLifecycleRecord[];
  atomic: boolean;
}

export interface DispatchEvidenceRecord {
  changedFiles: string[];
  diffEntries: GovernedDispatchDiffEntry[];
  beforeSnapshotId: string;
  afterSnapshotId: string;
  mutationScope: GovernedSandboxMutationScope;
  approval: GovernedExecutionApproval;
}

// =====================
// END AI-E GOVERNED DISPATCH CONTRACTS (EXEC-0051-A)
// =====================
// EXEC-0051 — First Governed Sandboxed Runtime Dispatch
//
// This module orchestrates one real, bounded, sandbox-scoped file mutation through
// the full AI-E governance lifecycle: approval gate → workspace preparation →
// before-snapshot → bounded write → after-snapshot → diff → receipt.
//
// NO child_process. NO shell. NO network. Mutation is ONE fs.writeFile call,
// bounded by resolveGovernedSandboxPath, and never touches the production workspace.

import { lstat, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

import {
  buildGovernedSandboxScaffold,
  prepareGovernedSandboxWorkspace,
  resolveGovernedSandboxPath,
  type BuildGovernedSandboxScaffoldInput,
  type GovernedSandboxScaffold,
} from "./sandboxExecutionBoundary";
import {
  createSandboxSnapshotManifest,
  type SandboxSnapshotDirectoryEntry,
  type SandboxSnapshotFileInventoryEntry,
  type SandboxSnapshotFilesystem,
} from "./sandboxSnapshotLifecycle";
import {
  createSandboxExecutionReceipt,
  createSandboxExecutionReceiptId,
} from "./sandboxExecutionReceipt";

// ---- Approval token ----------------------------------------------------------------

export const GOVERNED_DISPATCH_APPROVAL_TOKEN = "operator-approved" as const;
export type GovernedDispatchApprovalToken = typeof GOVERNED_DISPATCH_APPROVAL_TOKEN;

// ---- Public types ------------------------------------------------------------------

export type GovernedDispatchOutcome = "completed" | "failed" | "timed_out";

export type GovernedDispatchDiffEntry = {
  sandboxRelativePath: string;
  changeKind: "created" | "modified" | "deleted" | "unchanged";
  beforeHash?: string;
  afterHash?: string;
  beforeSizeBytes?: number;
  afterSizeBytes?: number;
};

export type GovernedDispatchResult = {
  manifestVersion: "EXEC-0051";
  dispatchId: string;
  sandboxId: string;
  sandboxRootPath: string;
  outcome: GovernedDispatchOutcome;
  operationRequest: string;
  targetFile: {
    sandboxRelativePath: string;
    sizeBytes: number;
  };
  stdout: string;
  stderr: string[];
  beforeSnapshotFileCount: number;
  afterSnapshotFileCount: number;
  diffEntries: GovernedDispatchDiffEntry[];
  receiptId: string;
  receiptSandboxPath: string;
  executedAt: string;
  durationMs: number;
  error?: string;
  safetyBoundary: {
    approvalRequired: true;
    sandboxScoped: true;
    shellExecutionEnabled: false;
    networkExecutionEnabled: false;
    productionWorkspaceMutationEnabled: false;
    automaticContinuationEnabled: false;
    singleOperationOnly: true;
    humanAuthorityFinal: true;
  };
};

export type GovernedDispatchFilesystem = {
  createDirectory?: (absolutePath: string) => Promise<void>;
  writeFile?: (absolutePath: string, content: string) => Promise<void>;
  readFile?: (absolutePath: string) => Promise<Buffer | string>;
  listDirectory?: (absolutePath: string) => Promise<SandboxSnapshotDirectoryEntry[]>;
  getFileSize?: (absolutePath: string) => Promise<number>;
};

export type GovernedDispatchRequest = BuildGovernedSandboxScaffoldInput & {
  approvalToken: string;
  operationRequest: string;
  operationContent: string;
  targetFileName: string;
  timeoutMs?: number;
  filesystem?: GovernedDispatchFilesystem;
};

// ---- Safety boundary constant ------------------------------------------------------

const SAFETY_BOUNDARY: GovernedDispatchResult["safetyBoundary"] = {
  approvalRequired: true,
  sandboxScoped: true,
  shellExecutionEnabled: false,
  networkExecutionEnabled: false,
  productionWorkspaceMutationEnabled: false,
  automaticContinuationEnabled: false,
  singleOperationOnly: true,
  humanAuthorityFinal: true,
};

// ---- Internal helpers --------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Governed dispatch timed out after ${ms}ms: ${label}`)),
      ms,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function computeDiff(
  before: SandboxSnapshotFileInventoryEntry[],
  after: SandboxSnapshotFileInventoryEntry[],
): GovernedDispatchDiffEntry[] {
  const beforeMap = new Map(before.map((e) => [e.sandboxRelativePath, e]));
  const afterMap = new Map(after.map((e) => [e.sandboxRelativePath, e]));
  const allPaths = new Set([
    ...Array.from(beforeMap.keys()),
    ...Array.from(afterMap.keys()),
  ]);
  const entries: GovernedDispatchDiffEntry[] = [];

  for (const p of Array.from(allPaths)) {
    const b = beforeMap.get(p);
    const a = afterMap.get(p);
    if (!b && a) {
      entries.push({ sandboxRelativePath: p, changeKind: "created", afterHash: a.contentHash, afterSizeBytes: a.sizeBytes });
    } else if (b && !a) {
      entries.push({ sandboxRelativePath: p, changeKind: "deleted", beforeHash: b.contentHash, beforeSizeBytes: b.sizeBytes });
    } else if (b && a && b.contentHash !== a.contentHash) {
      entries.push({ sandboxRelativePath: p, changeKind: "modified", beforeHash: b.contentHash, afterHash: a.contentHash, beforeSizeBytes: b.sizeBytes, afterSizeBytes: a.sizeBytes });
    } else if (b && a) {
      entries.push({ sandboxRelativePath: p, changeKind: "unchanged", beforeHash: b.contentHash, afterHash: a.contentHash, beforeSizeBytes: b.sizeBytes, afterSizeBytes: a.sizeBytes });
    }
  }

  return entries.sort((x, y) => x.sandboxRelativePath.localeCompare(y.sandboxRelativePath));
}

function makeDispatchId(now: () => string): string {
  const ts = now().replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  return `dispatch-${ts}-exec0051`;
}

async function defaultListDirectory(absolutePath: string): Promise<SandboxSnapshotDirectoryEntry[]> {
  const entries = await readdir(absolutePath, { withFileTypes: true });
  return Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(absolutePath, entry.name);
    const stats = await lstat(entryPath);
    const kind: SandboxSnapshotDirectoryEntry["kind"] = stats.isFile()
      ? "file"
      : stats.isDirectory()
        ? "directory"
        : stats.isSymbolicLink()
          ? "symlink"
          : "other";
    return { name: entry.name, kind, sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString() };
  }));
}

function resolveFilesystem(input?: GovernedDispatchFilesystem): Required<GovernedDispatchFilesystem> {
  return {
    createDirectory: input?.createDirectory ?? ((p) => mkdir(p, { recursive: true }).then(() => undefined)),
    writeFile: input?.writeFile ?? ((p, c) => writeFile(p, c, "utf8")),
    readFile: input?.readFile ?? readFile,
    listDirectory: input?.listDirectory ?? defaultListDirectory,
    getFileSize: input?.getFileSize ?? (async (p) => (await stat(p)).size),
  };
}

// ---- Core dispatch -----------------------------------------------------------------

async function runDispatch(input: {
  scaffold: GovernedSandboxScaffold;
  operationRequest: string;
  operationContent: string;
  targetSandboxRelativePath: string;
  targetAbsolutePath: string;
  dispatchId: string;
  executedAt: string;
  now: () => string;
  fs: Required<GovernedDispatchFilesystem>;
}): Promise<Omit<GovernedDispatchResult, "manifestVersion" | "dispatchId" | "sandboxId" | "sandboxRootPath" | "outcome" | "executedAt" | "durationMs" | "error" | "safetyBoundary">> {
  const { scaffold, operationContent, targetSandboxRelativePath, targetAbsolutePath, executedAt, now, fs } = input;

  const snapshotFs: SandboxSnapshotFilesystem = {
    listDirectory: fs.listDirectory,
    readFile: fs.readFile,
    createDirectory: fs.createDirectory,
    writeFile: fs.writeFile,
  };

  // 1. Prepare workspace (real directories created on disk)
  await prepareGovernedSandboxWorkspace({
    sandboxId: scaffold.sandboxId,
    repositoryRoot: scaffold.repositoryRoot,
    dryRun: false,
    createDirectory: fs.createDirectory,
    now,
  });

  // 2. Before snapshot — workspace is empty at this point
  const beforeRecord = await createSandboxSnapshotManifest({
    scaffold,
    phase: "before",
    dryRun: false,
    writeReceipt: true,
    includeContentHashes: true,
    filesystem: snapshotFs,
    now,
  });

  const stderr: string[] = beforeRecord.manifest.warnings.map((w) => `[before-snapshot] ${w.code}: ${w.message}`);

  // 3. Execute: write ONE file to the sandbox workspace (the real bounded mutation)
  await fs.writeFile(targetAbsolutePath, operationContent);
  const writtenSizeBytes = await fs.getFileSize(targetAbsolutePath);
  const stdout = operationContent;

  // 4. After snapshot — workspace now contains the written file
  const afterRecord = await createSandboxSnapshotManifest({
    scaffold,
    phase: "after",
    dryRun: false,
    writeReceipt: true,
    includeContentHashes: true,
    filesystem: snapshotFs,
    now,
  });

  for (const w of afterRecord.manifest.warnings) {
    stderr.push(`[after-snapshot] ${w.code}: ${w.message}`);
  }

  // 5. Diff
  const diffEntries = computeDiff(
    beforeRecord.manifest.fileInventory,
    afterRecord.manifest.fileInventory,
  );

  // 6. Execution receipt (real write to receipts directory)
  const receiptId = createSandboxExecutionReceiptId({ operationPhase: "executed", now });
  const receiptRecord = await createSandboxExecutionReceipt({
    scaffold,
    receiptId,
    operationPhase: "executed",
    approvalState: "approved",
    dryRun: false,
    writeReceipt: true,
    affectedFiles: [{ path: targetSandboxRelativePath, changeKind: "create", requiredApproval: true }],
    snapshotReferences: [
      { phase: "before", createdAt: executedAt, fileCount: beforeRecord.manifest.fileCount },
      { phase: "after", createdAt: now(), fileCount: afterRecord.manifest.fileCount },
    ],
    plannedActions: [{
      actionId: `${input.dispatchId}-write`,
      title: "Write review artifact to sandbox workspace",
      description: `Write ${targetSandboxRelativePath} into the governed sandbox workspace.`,
      category: "write",
      requiresApproval: true,
      mutationExpected: true,
    }],
    filesystem: {
      createDirectory: fs.createDirectory,
      writeFile: fs.writeFile,
    },
    now,
  });

  return {
    operationRequest: input.operationRequest,
    targetFile: { sandboxRelativePath: targetSandboxRelativePath, sizeBytes: writtenSizeBytes },
    stdout,
    stderr,
    beforeSnapshotFileCount: beforeRecord.manifest.fileCount,
    afterSnapshotFileCount: afterRecord.manifest.fileCount,
    diffEntries,
    receiptId: receiptRecord.receipt.receiptId,
    receiptSandboxPath: receiptRecord.receipt.receipt.path.sandboxRelativePath,
  };
}

// ---- Public entry point ------------------------------------------------------------

export async function executeGovernedSandboxDispatch(
  request: GovernedDispatchRequest,
): Promise<GovernedDispatchResult> {
  const startTime = Date.now();
  const now = request.now ?? (() => new Date().toISOString());
  const executedAt = now();
  const dispatchId = makeDispatchId(now);
  const timeoutMs = Math.max(1000, request.timeoutMs ?? 30_000);

  // Hard approval gate — any value other than the exact token is rejected
  if (request.approvalToken !== GOVERNED_DISPATCH_APPROVAL_TOKEN) {
    throw new Error(
      `Governed dispatch rejected: approvalToken must be exactly "${GOVERNED_DISPATCH_APPROVAL_TOKEN}". ` +
      "No execution occurs without explicit operator approval.",
    );
  }

  // Validate target filename: no separators, traversal, control chars, or shell metacharacters
  const targetFileName = request.targetFileName.trim();
  if (
    !targetFileName ||
    targetFileName.includes("/") ||
    targetFileName.includes("\\") ||
    targetFileName.includes("..") ||
    /[\x00-\x1F*?<>|]/.test(targetFileName)
  ) {
    throw new Error(
      `Governed dispatch rejected: targetFileName "${request.targetFileName}" is not a safe sandbox filename.`,
    );
  }

  const scaffold = buildGovernedSandboxScaffold({ sandboxId: request.sandboxId, repositoryRoot: request.repositoryRoot, now });
  // resolveGovernedSandboxPath enforces sandbox boundary — throws if path escapes
  const targetSafePath = resolveGovernedSandboxPath(scaffold, targetFileName, "workspace");
  const fs = resolveFilesystem(request.filesystem);

  const failureResult = (outcome: "failed" | "timed_out", error: unknown): GovernedDispatchResult => ({
    manifestVersion: "EXEC-0051",
    dispatchId,
    sandboxId: scaffold.sandboxId,
    sandboxRootPath: scaffold.sandboxRoot.absolutePath,
    outcome,
    operationRequest: request.operationRequest,
    targetFile: { sandboxRelativePath: targetSafePath.sandboxRelativePath, sizeBytes: 0 },
    stdout: "",
    stderr: [],
    beforeSnapshotFileCount: 0,
    afterSnapshotFileCount: 0,
    diffEntries: [],
    receiptId: "",
    receiptSandboxPath: "",
    executedAt,
    durationMs: Date.now() - startTime,
    error: error instanceof Error ? error.message : String(error),
    safetyBoundary: SAFETY_BOUNDARY,
  });

  try {
    const inner = await withTimeout(
      runDispatch({
        scaffold,
        operationRequest: request.operationRequest,
        operationContent: request.operationContent,
        targetSandboxRelativePath: targetSafePath.sandboxRelativePath,
        targetAbsolutePath: targetSafePath.absolutePath,
        dispatchId,
        executedAt,
        now,
        fs,
      }),
      timeoutMs,
      "sandboxed runtime dispatch",
    );

    return {
      manifestVersion: "EXEC-0051",
      dispatchId,
      sandboxId: scaffold.sandboxId,
      sandboxRootPath: scaffold.sandboxRoot.absolutePath,
      outcome: "completed",
      executedAt,
      durationMs: Date.now() - startTime,
      safetyBoundary: SAFETY_BOUNDARY,
      ...inner,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.message.includes("timed out");
    return failureResult(isTimeout ? "timed_out" : "failed", error);
  }
}
