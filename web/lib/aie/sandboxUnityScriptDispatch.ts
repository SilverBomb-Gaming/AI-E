// AI-E SANDBOX UNITY SCRIPT DISPATCH (EXEC-0052-E)
//
// Orchestrates the first governed Unity-style C# script mutation:
// authorization → workspace prep → before-snapshot → adapter.invoke()
// → after-snapshot → diff → receipt → rollback contract → dispatch record.
//
// Uses sandboxUnityScriptAdapter: reads sandboxPlayerMovement.cs,
// applies deterministic movement speed mutation (+0.5f), writes back.
// On first invocation: creates the file with sandbox defaults.
//
// NO child_process. NO shell. NO spawn/exec/execFile. NO network.
// NO production Unity mutation. Mutation bounded to .ai-e/sandboxes/<id>/workspace/.

import { lstat, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { authorizeDispatch } from "./dispatchAuthorizationBoundary";
import type { DispatchAuthorizationReceipt } from "./dispatchAuthorizationBoundary";
import {
  makeProposalReplayRejectionReceipt,
  proposalReplayRegistry,
  recordProposalExecution,
  verifyProposalNotReplayed,
  type ProposalReplayRejectionReceipt,
} from "./governedProposalReplayRegistry";
import {
  SANDBOX_UNITY_SCRIPT_ADAPTER_ID,
  SANDBOX_UNITY_SCRIPT_ADAPTER_VERSION,
  SANDBOX_UNITY_SCRIPT_FILE_NAME,
  createSandboxUnityScriptAdapter,
  type SandboxUnityScriptFilesystem,
} from "./sandboxUnityScriptAdapter";
import {
  advanceLifecycleState,
  createGovernedRuntimeDispatchRecord,
  createRuntimeExecutionLifecycle,
  createRuntimeInvocationId,
  makeDefaultSandboxRuntimeIOContract,
  makeEmptyOutputCapture,
  makeFailedInvocationResult,
  makeRuntimeAdapterSafetyBoundary,
  makeRuntimeFailure,
  type GovernedRuntimeAdapter,
  type GovernedRuntimeAdapterId,
  type GovernedRuntimeDispatchRecord,
  type GovernedRuntimeType,
  type RuntimeAdapterSafetyBoundary,
  type RuntimeExecutionLifecycle,
  type RuntimeExecutionLifecycleRecord,
  type RuntimeInvocationResult,
  type RuntimeOutputCapture,
} from "./governedRuntimeAdapterContract";
import {
  buildGovernedSandboxScaffold,
  prepareGovernedSandboxWorkspace,
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
import {
  GOVERNED_DISPATCH_APPROVAL_TOKEN,
  type GovernedDispatchDiffEntry,
  type GovernedDispatchFilesystem,
  type GovernedExecutionApproval,
  type GovernedRollbackContract,
} from "./sandboxedRuntimeDispatch";

// =====================================================================================
// PUBLIC REQUEST TYPE
// =====================================================================================

export type SandboxUnityScriptDispatchRequest = BuildGovernedSandboxScaffoldInput & {
  approvalToken: string;
  authorization: GovernedExecutionApproval;
  expiresAt: string;
  operatorId?: string;
  operationRequest?: string;
  timeoutMs?: number;
  filesystem?: GovernedDispatchFilesystem;
  adapter?: GovernedRuntimeAdapter;
};

// =====================================================================================
// PUBLIC RESULT TYPE
// =====================================================================================

export type SandboxUnityScriptDispatchResult = {
  manifestVersion: "EXEC-0052-E";
  outcome: "completed" | "failed" | "timeout" | "rejected";
  dispatchId: string;
  invocationId: string;
  sandboxId: string;
  sandboxRootPath: string;
  runtimeType: GovernedRuntimeType;
  adapterId: GovernedRuntimeAdapterId;
  adapterVersion: string;
  operationRequest: string;
  scriptFilePath: string;
  receiptId: string;
  receiptSandboxPath: string;
  beforeSnapshotFileCount: number;
  afterSnapshotFileCount: number;
  diffEntries: GovernedDispatchDiffEntry[];
  lifecycle: RuntimeExecutionLifecycle;
  outputCapture: RuntimeOutputCapture;
  rollbackContract: GovernedRollbackContract;
  authorizationReceipt: DispatchAuthorizationReceipt;
  dispatchRecord: GovernedRuntimeDispatchRecord;
  executedAt: string;
  durationMs: number;
  error?: string;
  proposalReplayRejectionReceipt?: ProposalReplayRejectionReceipt;
  safetyBoundary: RuntimeAdapterSafetyBoundary;
};

// =====================================================================================
// INTERNAL HELPERS
// =====================================================================================

function makeUnityDispatchId(now: () => string): string {
  const ts = now().replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  return `dispatch-${ts}-exec0052e`;
}

function withUnityTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Sandbox Unity script dispatch timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e); },
    );
  });
}

function computeUnityDiff(
  before: SandboxSnapshotFileInventoryEntry[],
  after: SandboxSnapshotFileInventoryEntry[],
): GovernedDispatchDiffEntry[] {
  const beforeMap = new Map(before.map((e) => [e.sandboxRelativePath, e]));
  const afterMap = new Map(after.map((e) => [e.sandboxRelativePath, e]));
  const allPaths = new Set([...beforeMap.keys(), ...afterMap.keys()]);
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

function buildUnityRollbackContract(
  sandboxId: string,
  diffEntries: GovernedDispatchDiffEntry[],
  outcome: "completed" | "failed" | "timeout" | "rejected",
  nowStr: string,
  error?: string,
): GovernedRollbackContract {
  const changed = diffEntries.filter((e) => e.changeKind !== "unchanged");
  const created = diffEntries.filter((e) => e.changeKind === "created").length;
  const modified = diffEntries.filter((e) => e.changeKind === "modified").length;
  const deleted = diffEntries.filter((e) => e.changeKind === "deleted").length;
  const succeeded = outcome === "completed";
  return {
    rollbackReady: succeeded,
    beforeSnapshotId: `${sandboxId}-before-snapshot`,
    afterSnapshotId: `${sandboxId}-after-snapshot`,
    rollbackMetadata: {
      changedFiles: changed.map((e) => e.sandboxRelativePath),
      diffSummary: `${created} created, ${modified} modified, ${deleted} deleted`,
      createdAt: nowStr,
    },
    verification: {
      valid: succeeded,
      reason: succeeded ? undefined : (error ?? "dispatch did not complete"),
      checkedAt: nowStr,
    },
  };
}

async function defaultListDirectory(absolutePath: string): Promise<SandboxSnapshotDirectoryEntry[]> {
  const entries = await readdir(absolutePath, { withFileTypes: true });
  return Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(absolutePath, entry.name);
    const stats = await lstat(entryPath);
    const kind: SandboxSnapshotDirectoryEntry["kind"] =
      stats.isFile() ? "file"
      : stats.isDirectory() ? "directory"
      : stats.isSymbolicLink() ? "symlink"
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

// =====================================================================================
// AUTHORIZATION-DENIED RESULT
// =====================================================================================

function makeUnityAuthDeniedResult(params: {
  dispatchId: string;
  invocationId: string;
  scaffold: GovernedSandboxScaffold;
  operationRequest: string;
  adapterId: GovernedRuntimeAdapterId;
  adapterVersion: string;
  operatorId: string;
  approvalReference: string;
  authorizationReceipt: DispatchAuthorizationReceipt;
  reason: string;
  nowStr: string;
  startTime: number;
  scriptFilePath: string;
}): SandboxUnityScriptDispatchResult {
  const emptyLifecycle = createRuntimeExecutionLifecycle(params.invocationId, params.nowStr);
  const rejectedLifecycle = advanceLifecycleState(emptyLifecycle, "rejected", params.nowStr,
    `Authorization denied: ${params.reason}`);
  const failure = makeRuntimeFailure("authorization_denied",
    `Dispatch authorization denied: ${params.reason}`, params.nowStr);
  const invResult = makeFailedInvocationResult({
    invocationId: params.invocationId,
    dispatchId: params.dispatchId,
    sandboxId: params.scaffold.sandboxId,
    runtimeType: "openclaw",
    adapterId: params.adapterId,
    failure,
    lifecycle: rejectedLifecycle,
    now: params.nowStr,
  });
  const emptyDiff: GovernedDispatchDiffEntry[] = [];
  const rollbackContract = buildUnityRollbackContract(
    params.scaffold.sandboxId, emptyDiff, "rejected", params.nowStr, params.reason,
  );
  const dispatchRecord = createGovernedRuntimeDispatchRecord({
    dispatchId: params.dispatchId,
    operatorId: params.operatorId,
    operationRequest: params.operationRequest,
    approvalReference: params.approvalReference,
    result: invResult,
    adapterVersion: params.adapterVersion,
    recordedAt: params.nowStr,
  });
  return {
    manifestVersion: "EXEC-0052-E",
    outcome: "rejected",
    dispatchId: params.dispatchId,
    invocationId: params.invocationId,
    sandboxId: params.scaffold.sandboxId,
    sandboxRootPath: params.scaffold.sandboxRoot.absolutePath,
    runtimeType: "openclaw",
    adapterId: params.adapterId,
    adapterVersion: params.adapterVersion,
    operationRequest: params.operationRequest,
    scriptFilePath: params.scriptFilePath,
    receiptId: "",
    receiptSandboxPath: "",
    beforeSnapshotFileCount: 0,
    afterSnapshotFileCount: 0,
    diffEntries: emptyDiff,
    lifecycle: rejectedLifecycle,
    outputCapture: makeEmptyOutputCapture(params.nowStr),
    rollbackContract,
    authorizationReceipt: params.authorizationReceipt,
    dispatchRecord,
    executedAt: params.nowStr,
    durationMs: Date.now() - params.startTime,
    error: `Dispatch authorization denied: ${params.reason}`,
    safetyBoundary: makeRuntimeAdapterSafetyBoundary(),
  };
}

// =====================================================================================
// MAIN DISPATCH FUNCTION
// =====================================================================================

function insertReplayVerifiedRecord(
  lifecycle: RuntimeExecutionLifecycle,
  replayVerifiedAt: string,
): RuntimeExecutionLifecycle {
  const authIdx = lifecycle.records.findIndex((r) => r.state === "authorization_verified");
  if (authIdx === -1) return lifecycle;
  const record: RuntimeExecutionLifecycleRecord = {
    state: "replay_verified",
    timestamp: replayVerifiedAt,
    message: "Proposal replay check passed — no prior execution found",
  };
  return {
    ...lifecycle,
    records: [
      ...lifecycle.records.slice(0, authIdx + 1),
      record,
      ...lifecycle.records.slice(authIdx + 1),
    ],
  };
}

function makeUnityReplayRejectedResult(params: {
  dispatchId: string;
  invocationId: string;
  scaffold: GovernedSandboxScaffold;
  operationRequest: string;
  adapterId: GovernedRuntimeAdapterId;
  adapterVersion: string;
  operatorId: string;
  approvalReference: string;
  authorizationReceipt: DispatchAuthorizationReceipt;
  proposalReplayRejectionReceipt: ProposalReplayRejectionReceipt;
  reason: string;
  nowStr: string;
  startTime: number;
  scriptFilePath: string;
}): SandboxUnityScriptDispatchResult {
  let lifecycle = createRuntimeExecutionLifecycle(params.invocationId, params.nowStr);
  lifecycle = advanceLifecycleState(lifecycle, "authorization_verified", params.nowStr,
    "Authorization token verified");
  lifecycle = advanceLifecycleState(lifecycle, "replay_rejected", params.nowStr,
    `Proposal replay rejected: ${params.reason}`);
  const failure = makeRuntimeFailure("proposal_replay_rejected",
    `Proposal replay rejected: ${params.reason}`, params.nowStr);
  const invResult = makeFailedInvocationResult({
    invocationId: params.invocationId,
    dispatchId: params.dispatchId,
    sandboxId: params.scaffold.sandboxId,
    runtimeType: "openclaw",
    adapterId: params.adapterId,
    failure,
    lifecycle,
    now: params.nowStr,
  });
  const emptyDiff: GovernedDispatchDiffEntry[] = [];
  const rollbackContract = buildUnityRollbackContract(
    params.scaffold.sandboxId, emptyDiff, "rejected", params.nowStr, params.reason,
  );
  const dispatchRecord = createGovernedRuntimeDispatchRecord({
    dispatchId: params.dispatchId,
    operatorId: params.operatorId,
    operationRequest: params.operationRequest,
    approvalReference: params.approvalReference,
    result: invResult,
    adapterVersion: params.adapterVersion,
    recordedAt: params.nowStr,
  });
  return {
    manifestVersion: "EXEC-0052-E",
    outcome: "rejected",
    dispatchId: params.dispatchId,
    invocationId: params.invocationId,
    sandboxId: params.scaffold.sandboxId,
    sandboxRootPath: params.scaffold.sandboxRoot.absolutePath,
    runtimeType: "openclaw",
    adapterId: params.adapterId,
    adapterVersion: params.adapterVersion,
    operationRequest: params.operationRequest,
    scriptFilePath: params.scriptFilePath,
    receiptId: "",
    receiptSandboxPath: "",
    beforeSnapshotFileCount: 0,
    afterSnapshotFileCount: 0,
    diffEntries: emptyDiff,
    lifecycle,
    outputCapture: makeEmptyOutputCapture(params.nowStr),
    rollbackContract,
    authorizationReceipt: params.authorizationReceipt,
    dispatchRecord,
    proposalReplayRejectionReceipt: params.proposalReplayRejectionReceipt,
    executedAt: params.nowStr,
    durationMs: Date.now() - params.startTime,
    error: `Proposal replay rejected: ${params.reason}`,
    safetyBoundary: makeRuntimeAdapterSafetyBoundary(),
  };
}

export async function executeSandboxUnityScriptDispatch(
  request: SandboxUnityScriptDispatchRequest,
): Promise<SandboxUnityScriptDispatchResult> {
  const startTime = Date.now();
  const nowFn = request.now ?? (() => new Date().toISOString());
  const nowStr = nowFn();
  const stableNow = () => nowStr;

  const timeoutMs = Math.max(1000, request.timeoutMs ?? 30_000);
  const operationRequest = request.operationRequest?.trim() || "apply Unity script mutation";
  const operatorId = request.operatorId?.trim() || "operator";

  if (request.approvalToken !== GOVERNED_DISPATCH_APPROVAL_TOKEN) {
    throw new Error(
      `Sandbox Unity script dispatch rejected: approvalToken must be "${GOVERNED_DISPATCH_APPROVAL_TOKEN}".`,
    );
  }

  const scaffold = buildGovernedSandboxScaffold({
    sandboxId: request.sandboxId,
    repositoryRoot: request.repositoryRoot,
    now: stableNow,
  });

  const dispatchId = makeUnityDispatchId(stableNow);
  const invocationId = createRuntimeInvocationId(nowStr);
  const approvalReference = request.authorization.proposalId;
  const resolvedFs = resolveFilesystem(request.filesystem);
  const snapshotFs: SandboxSnapshotFilesystem = {
    listDirectory: resolvedFs.listDirectory,
    readFile: resolvedFs.readFile,
    createDirectory: resolvedFs.createDirectory,
    writeFile: resolvedFs.writeFile,
  };

  const scriptFilePath = path.join(scaffold.workspace.absolutePath, SANDBOX_UNITY_SCRIPT_FILE_NAME);

  const authReceipt = authorizeDispatch({
    approval: request.authorization,
    sandboxId: scaffold.sandboxId,
    operationRequest,
    expiresAt: request.expiresAt,
    now: nowStr,
  });

  if (!authReceipt.result.authorized) {
    const reason = authReceipt.result.reason ?? "authorization denied";
    return makeUnityAuthDeniedResult({
      dispatchId,
      invocationId,
      scaffold,
      operationRequest,
      adapterId: SANDBOX_UNITY_SCRIPT_ADAPTER_ID,
      adapterVersion: SANDBOX_UNITY_SCRIPT_ADAPTER_VERSION,
      operatorId,
      approvalReference,
      authorizationReceipt: authReceipt,
      reason,
      nowStr,
      startTime,
      scriptFilePath,
    });
  }

  // Proposal-scoped replay check — enforces global proposal identity as replay boundary
  const replayCheck = verifyProposalNotReplayed(
    proposalReplayRegistry,
    {
      proposalId: request.authorization.proposalId,
      approvalToken: request.authorization.authorityToken,
      operationRequest,
    },
    nowStr,
  );
  if (replayCheck.isReplay) {
    const replayRejectionReceipt = replayCheck.existingRecord
      ? makeProposalReplayRejectionReceipt({
          proposalId: request.authorization.proposalId,
          originalRecord: replayCheck.existingRecord,
          attemptedAt: nowStr,
          operatorId,
          replayFingerprint: replayCheck.fingerprint,
          reason: replayCheck.reason ?? "proposal-replay-rejected",
        })
      : {
          proposalId: request.authorization.proposalId,
          originalDispatchId: "unknown",
          originalSandboxId: "unknown",
          originalRuntimeType: "unknown",
          replayRejectionReason: replayCheck.reason ?? "proposal-replay-rejected",
          attemptedAt: nowStr,
          operatorId,
          replayFingerprint: replayCheck.fingerprint,
        };
    return makeUnityReplayRejectedResult({
      dispatchId,
      invocationId,
      scaffold,
      operationRequest,
      adapterId: SANDBOX_UNITY_SCRIPT_ADAPTER_ID,
      adapterVersion: SANDBOX_UNITY_SCRIPT_ADAPTER_VERSION,
      operatorId,
      approvalReference,
      authorizationReceipt: authReceipt,
      proposalReplayRejectionReceipt: replayRejectionReceipt,
      reason: replayCheck.reason ?? "proposal-replay-rejected",
      nowStr,
      startTime,
      scriptFilePath,
    });
  }

  const adapterFs: SandboxUnityScriptFilesystem = {
    createDirectory: resolvedFs.createDirectory,
    writeFile: resolvedFs.writeFile,
    readFile: async (p) => {
      try {
        const result = await resolvedFs.readFile(p);
        if (result instanceof Buffer) return result.toString("utf8");
        return result as string;
      } catch (e: unknown) {
        if (
          typeof e === "object" && e !== null && "code" in e &&
          (e as { code: string }).code === "ENOENT"
        ) {
          return null;
        }
        throw e;
      }
    },
  };
  const adapter: GovernedRuntimeAdapter = request.adapter ?? createSandboxUnityScriptAdapter(adapterFs);
  const adapterId = adapter.adapterId;
  const adapterVersion = adapter.adapterVersion;

  const makeFailureResult = (
    outcome: "failed" | "timeout",
    error: unknown,
    invResult?: RuntimeInvocationResult,
  ): SandboxUnityScriptDispatchResult => {
    const errMsg = error instanceof Error ? error.message : String(error);
    const fLifecycle = invResult?.lifecycle ?? (() => {
      const lc = createRuntimeExecutionLifecycle(invocationId, nowStr);
      return advanceLifecycleState(lc, outcome === "timeout" ? "timeout" : "failed", nowStr, errMsg);
    })();
    const emptyDiff: GovernedDispatchDiffEntry[] = [];
    const rc = buildUnityRollbackContract(scaffold.sandboxId, emptyDiff, outcome, nowStr, errMsg);
    const fFailure = makeRuntimeFailure(
      outcome === "timeout" ? "invocation_timeout" : "unknown_failure", errMsg, nowStr,
    );
    const fInvResult = invResult ?? makeFailedInvocationResult({
      invocationId, dispatchId, sandboxId: scaffold.sandboxId,
      runtimeType: adapter.runtimeType, adapterId,
      failure: fFailure, lifecycle: fLifecycle, now: nowStr,
    });
    const dr = createGovernedRuntimeDispatchRecord({
      dispatchId, operatorId, operationRequest, approvalReference,
      result: fInvResult, adapterVersion, recordedAt: nowStr,
    });
    return {
      manifestVersion: "EXEC-0052-E",
      outcome, dispatchId, invocationId,
      sandboxId: scaffold.sandboxId,
      sandboxRootPath: scaffold.sandboxRoot.absolutePath,
      runtimeType: adapter.runtimeType, adapterId, adapterVersion,
      operationRequest, scriptFilePath,
      receiptId: "", receiptSandboxPath: "",
      beforeSnapshotFileCount: 0, afterSnapshotFileCount: 0,
      diffEntries: emptyDiff, lifecycle: fLifecycle,
      outputCapture: fInvResult.outputCapture,
      rollbackContract: rc, authorizationReceipt: authReceipt,
      dispatchRecord: dr, executedAt: nowStr,
      durationMs: Date.now() - startTime, error: errMsg,
      safetyBoundary: makeRuntimeAdapterSafetyBoundary(),
    };
  };

  try {
    await prepareGovernedSandboxWorkspace({
      sandboxId: scaffold.sandboxId,
      repositoryRoot: scaffold.repositoryRoot,
      dryRun: false,
      createDirectory: resolvedFs.createDirectory,
      now: stableNow,
    });

    const beforeRecord = await createSandboxSnapshotManifest({
      scaffold, phase: "before", dryRun: false, writeReceipt: true,
      includeContentHashes: true, filesystem: snapshotFs, now: stableNow,
    });

    const ioContract = makeDefaultSandboxRuntimeIOContract({ workspaceWriteAllowed: true });
    const invocation = {
      invocationId, dispatchId, sandboxId: scaffold.sandboxId, operatorId,
      runtimeId: adapterId, approvalReference, approval: request.authorization,
      operationRequest, workspaceRoot: scaffold.workspace.absolutePath,
      timeoutMs, ioContract, requestedAt: nowStr,
    };

    let invResult: RuntimeInvocationResult;
    try {
      invResult = await withUnityTimeout(adapter.invoke(invocation), timeoutMs);
    } catch (timeoutError) {
      return makeFailureResult("timeout", timeoutError);
    }

    const afterRecord = await createSandboxSnapshotManifest({
      scaffold, phase: "after", dryRun: false, writeReceipt: true,
      includeContentHashes: true, filesystem: snapshotFs, now: stableNow,
    });

    const diffEntries = computeUnityDiff(
      beforeRecord.manifest.fileInventory,
      afterRecord.manifest.fileInventory,
    );

    const receiptId = createSandboxExecutionReceiptId({ operationPhase: "executed", now: stableNow });
    const receiptRecord = await createSandboxExecutionReceipt({
      scaffold, receiptId,
      operationPhase: "executed", approvalState: "approved",
      dryRun: false, writeReceipt: true,
      affectedFiles: [{ path: SANDBOX_UNITY_SCRIPT_FILE_NAME, changeKind: "create", requiredApproval: true }],
      snapshotReferences: [
        { phase: "before", createdAt: nowStr, fileCount: beforeRecord.manifest.fileCount },
        { phase: "after", createdAt: nowStr, fileCount: afterRecord.manifest.fileCount },
      ],
      plannedActions: [{
        actionId: `${dispatchId}-apply-unity-mutation`,
        title: `Apply movement speed mutation to ${SANDBOX_UNITY_SCRIPT_FILE_NAME}`,
        description: `Apply deterministic movement speed mutation to ${SANDBOX_UNITY_SCRIPT_FILE_NAME} via ${adapterId}. Sandbox-only, no production Unity assets touched.`,
        category: "write",
        requiresApproval: true,
        mutationExpected: true,
      }],
      filesystem: { createDirectory: resolvedFs.createDirectory, writeFile: resolvedFs.writeFile },
      now: stableNow,
    });

    const outcome = invResult.outcome === "completed" ? "completed"
      : invResult.outcome === "timeout" ? "timeout"
      : invResult.outcome === "rejected" ? "rejected"
      : "failed";
    const rollbackContract = buildUnityRollbackContract(
      scaffold.sandboxId, diffEntries, outcome, nowStr, invResult.failure?.message,
    );

    if (outcome === "completed") {
      recordProposalExecution(proposalReplayRegistry, {
        fingerprint: replayCheck.fingerprint,
        proposalId: request.authorization.proposalId,
        approvalToken: request.authorization.authorityToken,
        operationRequest,
        sandboxId: scaffold.sandboxId,
        dispatchId,
        invocationId,
        runtimeType: adapter.runtimeType,
        adapterId: adapterId as string,
        outcome: "completed",
        executedAt: nowStr,
        operatorId,
      });
    }

    const finalLifecycle = insertReplayVerifiedRecord(invResult.lifecycle, nowStr);

    const dispatchRecord = createGovernedRuntimeDispatchRecord({
      dispatchId, operatorId, operationRequest, approvalReference,
      result: invResult, adapterVersion, recordedAt: nowStr,
    });

    return {
      manifestVersion: "EXEC-0052-E",
      outcome, dispatchId, invocationId,
      sandboxId: scaffold.sandboxId,
      sandboxRootPath: scaffold.sandboxRoot.absolutePath,
      runtimeType: adapter.runtimeType, adapterId, adapterVersion,
      operationRequest, scriptFilePath,
      receiptId: receiptRecord.receipt.receiptId,
      receiptSandboxPath: receiptRecord.receipt.receipt.path.sandboxRelativePath,
      beforeSnapshotFileCount: beforeRecord.manifest.fileCount,
      afterSnapshotFileCount: afterRecord.manifest.fileCount,
      diffEntries, lifecycle: finalLifecycle,
      outputCapture: invResult.outputCapture,
      rollbackContract, authorizationReceipt: authReceipt,
      dispatchRecord, executedAt: nowStr,
      durationMs: Date.now() - startTime,
      error: invResult.failure?.message,
      safetyBoundary: makeRuntimeAdapterSafetyBoundary(),
    };
  } catch (error) {
    return makeFailureResult("failed", error);
  }
}
