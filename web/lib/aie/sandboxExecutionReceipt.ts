import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildGovernedSandboxScaffold,
  resolveGovernedSandboxPath,
  type BuildGovernedSandboxScaffoldInput,
  type GovernedSandboxSafePath,
  type GovernedSandboxScaffold,
} from "./sandboxExecutionBoundary";
import type { SandboxSnapshotPhase } from "./sandboxSnapshotLifecycle";

export type SandboxOperationPhase =
  | "planned"
  | "previewed"
  | "approved"
  | "rejected"
  | "executed"
  | "verified"
  | "failed";

export type SandboxApprovalState = "not_required" | "pending" | "approved" | "rejected";

export type SandboxReceiptWriteStatus =
  | "dry_run_preview"
  | "write_not_requested"
  | "written";

export type SandboxVerificationStatus =
  | "not_run"
  | "pending"
  | "passed"
  | "failed"
  | "blocked"
  | "skipped";

export type SandboxPlannedAction = {
  actionId: string;
  title: string;
  description: string;
  category: "inspect" | "prepare" | "write" | "validate" | "snapshot" | "receipt" | "other";
  requiresApproval: boolean;
  mutationExpected: boolean;
};

export type SandboxAffectedFileInput = string | {
  path: string;
  changeKind?: "create" | "modify" | "delete" | "read" | "unknown";
  requiredApproval?: boolean;
};

export type SandboxAffectedFile = {
  path: GovernedSandboxSafePath;
  changeKind: "create" | "modify" | "delete" | "read" | "unknown";
  requiredApproval: boolean;
};

export type SandboxSnapshotReceiptReference = {
  phase: SandboxSnapshotPhase;
  receiptPath?: string;
  manifestId?: string;
  createdAt?: string;
  fileCount?: number;
};

export type SandboxResolvedSnapshotReceiptReference = {
  phase: SandboxSnapshotPhase;
  receiptPath?: GovernedSandboxSafePath;
  manifestId?: string;
  createdAt?: string;
  fileCount?: number;
};

export type SandboxVerificationResult = {
  checkId: string;
  title: string;
  status: SandboxVerificationStatus;
  summary: string;
  evidencePath?: GovernedSandboxSafePath;
};

export type SandboxReceiptWarning = {
  code: string;
  message: string;
  path?: string;
};

export type SandboxReceiptError = {
  code: string;
  message: string;
  path?: string;
};

export type GovernedSandboxExecutionReceipt = {
  manifestVersion: "EXEC-0043-C";
  receiptId: string;
  sandboxId: string;
  createdAt: string;
  operationPhase: SandboxOperationPhase;
  approvalState: SandboxApprovalState;
  plannedActions: SandboxPlannedAction[];
  affectedFiles: SandboxAffectedFile[];
  snapshotReferences: SandboxResolvedSnapshotReceiptReference[];
  verificationResults: SandboxVerificationResult[];
  warnings: SandboxReceiptWarning[];
  errors: SandboxReceiptError[];
  dryRun: boolean;
  receipt: {
    status: SandboxReceiptWriteStatus;
    path: GovernedSandboxSafePath;
    written: boolean;
  };
  safetyBoundary: {
    receiptOnly: true;
    receiptDirectoryOnly: true;
    workspaceMutationEnabled: false;
    shellExecutionEnabled: false;
    networkExecutionEnabled: false;
    runtimeExecutionEnabled: false;
    rollbackExecutionEnabled: false;
    automaticRuntimeExecution: false;
    humanAuthorityRequired: true;
  };
};

export type SandboxExecutionReceiptRecord = {
  receipt: GovernedSandboxExecutionReceipt;
  receiptPreview: string;
};

export type SandboxExecutionReceiptFilesystem = {
  createDirectory?: (absolutePath: string) => Promise<void>;
  writeFile?: (absolutePath: string, content: string) => Promise<void>;
};

export type CreateSandboxExecutionReceiptInput = BuildGovernedSandboxScaffoldInput & {
  scaffold?: GovernedSandboxScaffold;
  receiptId?: string;
  operationPhase: SandboxOperationPhase;
  approvalState: SandboxApprovalState;
  plannedActions?: SandboxPlannedAction[];
  affectedFiles?: SandboxAffectedFileInput[];
  snapshotReferences?: SandboxSnapshotReceiptReference[];
  verificationResults?: Array<Omit<SandboxVerificationResult, "evidencePath"> & { evidencePath?: string }>;
  warnings?: SandboxReceiptWarning[];
  errors?: SandboxReceiptError[];
  dryRun?: boolean;
  writeReceipt?: boolean;
  receiptFileName?: string;
  filesystem?: SandboxExecutionReceiptFilesystem;
};

const RECEIPT_ID_PATTERN = /^receipt-[a-z0-9][a-z0-9_-]{0,79}$/;

function timestampId(now: () => string): string {
  return now().replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "operation";
}

export function normalizeSandboxExecutionReceiptId(receiptId: string): string {
  const normalizedId = receiptId.trim();
  if (!RECEIPT_ID_PATTERN.test(normalizedId)) {
    throw new Error("Sandbox receipt ids must use the receipt-<id> format with only lowercase letters, numbers, dashes, or underscores.");
  }

  return normalizedId;
}

export function createSandboxExecutionReceiptId(input: { operationPhase: SandboxOperationPhase; now?: () => string }): string {
  return normalizeSandboxExecutionReceiptId(`receipt-${timestampId(input.now ?? (() => new Date().toISOString()))}-${slugify(input.operationPhase)}`);
}

function resolveReceiptPath(scaffold: GovernedSandboxScaffold, receiptId: string, input: CreateSandboxExecutionReceiptInput): GovernedSandboxSafePath {
  const receiptFileName = input.receiptFileName ?? `${receiptId}.json`;
  return resolveGovernedSandboxPath(scaffold, receiptFileName, "receipts");
}

function resolveAffectedFiles(scaffold: GovernedSandboxScaffold, affectedFiles: SandboxAffectedFileInput[] = []): SandboxAffectedFile[] {
  return affectedFiles.map((entry) => {
    const pathInput = typeof entry === "string" ? entry : entry.path;
    return {
      path: resolveGovernedSandboxPath(scaffold, pathInput, "workspace"),
      changeKind: typeof entry === "string" ? "unknown" : entry.changeKind ?? "unknown",
      requiredApproval: typeof entry === "string" ? true : entry.requiredApproval ?? true,
    };
  });
}

function resolveSnapshotReferences(
  scaffold: GovernedSandboxScaffold,
  references: SandboxSnapshotReceiptReference[] = [],
): SandboxResolvedSnapshotReceiptReference[] {
  return references.map((reference) => ({
    phase: reference.phase,
    receiptPath: reference.receiptPath ? resolveGovernedSandboxPath(scaffold, reference.receiptPath, "receipts") : undefined,
    manifestId: reference.manifestId,
    createdAt: reference.createdAt,
    fileCount: reference.fileCount,
  }));
}

function resolveVerificationResults(
  scaffold: GovernedSandboxScaffold,
  results: CreateSandboxExecutionReceiptInput["verificationResults"] = [],
): SandboxVerificationResult[] {
  return results.map((result) => ({
    ...result,
    evidencePath: result.evidencePath ? resolveGovernedSandboxPath(scaffold, result.evidencePath, "receipts") : undefined,
  }));
}

function impliedWarnings(input: {
  approvalState: SandboxApprovalState;
  plannedActions: SandboxPlannedAction[];
  operationPhase: SandboxOperationPhase;
  dryRun: boolean;
  writeReceipt: boolean;
}): SandboxReceiptWarning[] {
  const warnings: SandboxReceiptWarning[] = [];

  if (input.approvalState === "pending" && input.operationPhase !== "planned" && input.operationPhase !== "previewed") {
    warnings.push({
      code: "approval_pending_for_later_phase",
      message: "Operation phase is beyond preview while approval remains pending; receipt records this mismatch without executing anything.",
    });
  }

  if (input.plannedActions.some((action) => action.mutationExpected) && input.approvalState !== "approved") {
    warnings.push({
      code: "mutation_requires_approval",
      message: "One or more planned actions expects mutation, but the receipt does not carry approved state.",
    });
  }

  if (!input.dryRun && !input.writeReceipt) {
    warnings.push({
      code: "receipt_write_skipped",
      message: "Receipt writing was not requested; operational truth was returned in memory only.",
    });
  }

  return warnings;
}

export async function createSandboxExecutionReceipt(input: CreateSandboxExecutionReceiptInput): Promise<SandboxExecutionReceiptRecord> {
  const dryRun = input.dryRun !== false;
  const writeReceipt = input.writeReceipt === true;
  const createdAt = input.now?.() ?? new Date().toISOString();
  const scaffold = input.scaffold ?? buildGovernedSandboxScaffold(input);
  const receiptId = normalizeSandboxExecutionReceiptId(input.receiptId ?? createSandboxExecutionReceiptId({
    operationPhase: input.operationPhase,
    now: input.now,
  }));
  const receiptPath = resolveReceiptPath(scaffold, receiptId, input);
  const plannedActions = [...(input.plannedActions ?? [])];
  const filesystem: Required<SandboxExecutionReceiptFilesystem> = {
    createDirectory: input.filesystem?.createDirectory ?? ((absolutePath: string) => mkdir(absolutePath, { recursive: true }).then(() => undefined)),
    writeFile: input.filesystem?.writeFile ?? ((absolutePath: string, content: string) => writeFile(absolutePath, content, "utf8")),
  };

  const receiptStatus: SandboxReceiptWriteStatus = dryRun
    ? "dry_run_preview"
    : writeReceipt
      ? "written"
      : "write_not_requested";

  const receipt: GovernedSandboxExecutionReceipt = {
    manifestVersion: "EXEC-0043-C",
    receiptId,
    sandboxId: scaffold.sandboxId,
    createdAt,
    operationPhase: input.operationPhase,
    approvalState: input.approvalState,
    plannedActions,
    affectedFiles: resolveAffectedFiles(scaffold, input.affectedFiles),
    snapshotReferences: resolveSnapshotReferences(scaffold, input.snapshotReferences),
    verificationResults: resolveVerificationResults(scaffold, input.verificationResults),
    warnings: [
      ...(input.warnings ?? []),
      ...impliedWarnings({
        approvalState: input.approvalState,
        plannedActions,
        operationPhase: input.operationPhase,
        dryRun,
        writeReceipt,
      }),
    ],
    errors: [...(input.errors ?? [])],
    dryRun,
    receipt: {
      status: receiptStatus,
      path: receiptPath,
      written: !dryRun && writeReceipt,
    },
    safetyBoundary: {
      receiptOnly: true,
      receiptDirectoryOnly: true,
      workspaceMutationEnabled: false,
      shellExecutionEnabled: false,
      networkExecutionEnabled: false,
      runtimeExecutionEnabled: false,
      rollbackExecutionEnabled: false,
      automaticRuntimeExecution: false,
      humanAuthorityRequired: true,
    },
  };

  const receiptPreview = JSON.stringify(receipt, null, 2);
  if (!dryRun && writeReceipt) {
    await filesystem.createDirectory(path.dirname(receiptPath.absolutePath));
    await filesystem.writeFile(receiptPath.absolutePath, receiptPreview);
  }

  return {
    receipt,
    receiptPreview,
  };
}
