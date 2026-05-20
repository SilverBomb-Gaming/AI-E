import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildGovernedSandboxScaffold } from "./sandboxExecutionBoundary";
import {
  createSandboxExecutionReceipt,
  createSandboxExecutionReceiptId,
  normalizeSandboxExecutionReceiptId,
  type SandboxExecutionReceiptFilesystem,
  type SandboxPlannedAction,
} from "./sandboxExecutionReceipt";

const FIXED_TIME = "2026-05-20T18:00:00.000Z";

function createFilesystemRecorder(input: {
  createdDirectories?: string[];
  written?: Array<{ absolutePath: string; content: string }>;
}): SandboxExecutionReceiptFilesystem {
  return {
    createDirectory: async (absolutePath) => {
      input.createdDirectories?.push(absolutePath);
    },
    writeFile: async (absolutePath, content) => {
      input.written?.push({ absolutePath, content });
    },
  };
}

const plannedAction: SandboxPlannedAction = {
  actionId: "planned-action-1",
  title: "Prepare bounded workspace patch",
  description: "Record the future sandbox operation without running it.",
  category: "prepare",
  requiresApproval: true,
  mutationExpected: false,
};

test("createSandboxExecutionReceipt produces a dry-run governed operation receipt by default", async () => {
  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-receipt-dry-run",
  });
  const written: Array<{ absolutePath: string; content: string }> = [];
  const createdDirectories: string[] = [];

  const record = await createSandboxExecutionReceipt({
    scaffold,
    receiptId: "receipt-preview-plan",
    operationPhase: "planned",
    approvalState: "pending",
    plannedActions: [plannedAction],
    affectedFiles: [
      { path: "src/example.ts", changeKind: "modify", requiredApproval: true },
    ],
    snapshotReferences: [
      { phase: "before", receiptPath: "before-snapshot.json", manifestId: "snapshot-before-1", fileCount: 2 },
    ],
    verificationResults: [
      { checkId: "review-only", title: "Review receipt", status: "not_run", summary: "No runtime verification has run.", evidencePath: "evidence/review.json" },
    ],
    now: () => FIXED_TIME,
    filesystem: createFilesystemRecorder({ createdDirectories, written }),
  });

  assert.equal(record.receipt.manifestVersion, "EXEC-0043-C");
  assert.equal(record.receipt.receiptId, "receipt-preview-plan");
  assert.equal(record.receipt.sandboxId, "sandbox-receipt-dry-run");
  assert.equal(record.receipt.operationPhase, "planned");
  assert.equal(record.receipt.approvalState, "pending");
  assert.equal(record.receipt.dryRun, true);
  assert.equal(record.receipt.receipt.status, "dry_run_preview");
  assert.equal(record.receipt.receipt.written, false);
  assert.equal(record.receipt.receipt.path.sandboxRelativePath, "receipts/receipt-preview-plan.json");
  assert.equal(record.receipt.affectedFiles[0]?.path.sandboxRelativePath, "workspace/src/example.ts");
  assert.equal(record.receipt.snapshotReferences[0]?.receiptPath?.sandboxRelativePath, "receipts/before-snapshot.json");
  assert.equal(record.receipt.verificationResults[0]?.evidencePath?.sandboxRelativePath, "receipts/evidence/review.json");
  assert.equal(createdDirectories.length, 0);
  assert.equal(written.length, 0);
  assert.match(record.receiptPreview, /"runtimeExecutionEnabled": false/);
});

test("createSandboxExecutionReceipt writes only under receipts when explicitly requested", async () => {
  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-receipt-write",
  });
  const written: Array<{ absolutePath: string; content: string }> = [];
  const createdDirectories: string[] = [];

  const record = await createSandboxExecutionReceipt({
    scaffold,
    receiptId: "receipt-approved-operation",
    operationPhase: "approved",
    approvalState: "approved",
    plannedActions: [{ ...plannedAction, mutationExpected: true }],
    affectedFiles: ["workspace-output.txt"],
    dryRun: false,
    writeReceipt: true,
    receiptFileName: "operations/approved-operation.json",
    now: () => FIXED_TIME,
    filesystem: createFilesystemRecorder({ createdDirectories, written }),
  });

  assert.equal(record.receipt.receipt.status, "written");
  assert.equal(record.receipt.receipt.written, true);
  assert.equal(record.receipt.receipt.path.sandboxRelativePath, "receipts/operations/approved-operation.json");
  assert.deepEqual(createdDirectories, [path.join(scaffold.receipts.absolutePath, "operations")]);
  assert.equal(written.length, 1);
  assert.equal(written[0]?.absolutePath, path.join(scaffold.receipts.absolutePath, "operations", "approved-operation.json"));
  assert.match(written[0]?.content ?? "", /"manifestVersion": "EXEC-0043-C"/);
  assert.match(written[0]?.content ?? "", /"operationPhase": "approved"/);
});

test("createSandboxExecutionReceipt rejects unsafe receipt and reference paths", async () => {
  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-receipt-safety",
  });

  await assert.rejects(
    createSandboxExecutionReceipt({
      scaffold,
      receiptId: "receipt-unsafe-path",
      operationPhase: "planned",
      approvalState: "pending",
      receiptFileName: "../escape.json",
    }),
    /path traversal/i,
  );

  await assert.rejects(
    createSandboxExecutionReceipt({
      scaffold,
      receiptId: "receipt-unsafe-reference",
      operationPhase: "planned",
      approvalState: "pending",
      snapshotReferences: [{ phase: "after", receiptPath: "snapshots/*.json" }],
    }),
    /wildcard/i,
  );

  await assert.rejects(
    createSandboxExecutionReceipt({
      scaffold,
      receiptId: "receipt-unsafe-evidence",
      operationPhase: "planned",
      approvalState: "pending",
      verificationResults: [{ checkId: "bad", title: "Bad evidence", status: "blocked", summary: "Blocked.", evidencePath: path.resolve("E:/outside-ai-e/evidence.json") }],
    }),
    /sandbox root/i,
  );
});

test("createSandboxExecutionReceipt rejects affected files outside the sandbox workspace", async () => {
  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-receipt-affected-files",
  });

  await assert.rejects(
    createSandboxExecutionReceipt({
      scaffold,
      receiptId: "receipt-unsafe-affected-file",
      operationPhase: "planned",
      approvalState: "pending",
      affectedFiles: ["../outside.ts"],
    }),
    /path traversal/i,
  );

  await assert.rejects(
    createSandboxExecutionReceipt({
      scaffold,
      receiptId: "receipt-absolute-affected-file",
      operationPhase: "planned",
      approvalState: "pending",
      affectedFiles: [path.join(scaffold.receipts.absolutePath, "receipt.json")],
    }),
    /base directory/i,
  );
});

test("receipt helpers normalize ids and implied warnings preserve approval boundaries", async () => {
  assert.equal(normalizeSandboxExecutionReceiptId("receipt-exec_0043-c"), "receipt-exec_0043-c");
  assert.equal(createSandboxExecutionReceiptId({ operationPhase: "previewed", now: () => FIXED_TIME }), "receipt-20260520180000-previewed");
  assert.throws(() => normalizeSandboxExecutionReceiptId("exec-0043-c"), /receipt-<id>/i);
  assert.throws(() => normalizeSandboxExecutionReceiptId("receipt-UpperCase"), /receipt-<id>/i);

  const scaffold = buildGovernedSandboxScaffold({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-receipt-warnings",
  });
  const record = await createSandboxExecutionReceipt({
    scaffold,
    receiptId: "receipt-warning-check",
    operationPhase: "approved",
    approvalState: "pending",
    plannedActions: [{ ...plannedAction, mutationExpected: true }],
    dryRun: false,
    writeReceipt: false,
  });

  assert.equal(record.receipt.receipt.status, "write_not_requested");
  assert.ok(record.receipt.warnings.some((warning) => warning.code === "approval_pending_for_later_phase"));
  assert.ok(record.receipt.warnings.some((warning) => warning.code === "mutation_requires_approval"));
  assert.ok(record.receipt.warnings.some((warning) => warning.code === "receipt_write_skipped"));
});
