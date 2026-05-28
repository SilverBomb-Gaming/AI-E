// AI-E GOVERNED WORKFLOW EXECUTION (EXEC-0052-H)
//
// First governed multi-step sandbox patch workflow.
// Executes TWO sequential sandbox mutations under ONE proposal id, ONE workflow id,
// ONE authorization scope, with replay protection, rollback chain, and receipt aggregation.
//
// Step A: Inject ClampStaminaRegeneration() → sandboxGameplayFeaturePatch.cs
// Step B: Apply deterministic tuning values → sandboxGameplayConfig.json
//
// Both steps share ONE sandbox. The before-snapshot of Step B captures the state
// after Step A, giving a complete sequential rollback chain.
//
// Workflow-level replay is enforced by a separate workflowReplayRegistry.
// Per-step dispatchers receive step-scoped proposalIds to avoid cross-registry conflicts.
//
// NO child_process. NO shell. NO spawn/exec/execFile. NO network.
// NO production mutation. NO autonomous continuation. Human authority final.

import {
  GOVERNED_DISPATCH_APPROVAL_TOKEN,
  type GovernedDispatchDiffEntry,
  type GovernedExecutionApproval,
} from "./sandboxedRuntimeDispatch";
import {
  createGovernedProposalReplayRegistry,
  makeProposalReplayRejectionReceipt,
  recordProposalExecution,
  verifyProposalNotReplayed,
  type GovernedProposalReplayRegistry,
  type ProposalReplayRejectionReceipt,
} from "./governedProposalReplayRegistry";
import {
  executeSandboxGameplayFeaturePatchDispatch,
  type SandboxGameplayFeaturePatchDispatchResult,
} from "./sandboxGameplayFeaturePatchDispatch";
import {
  executeSandboxGameplayConfigDispatch,
  type SandboxGameplayConfigDispatchResult,
} from "./sandboxGameplayConfigDispatch";
import { buildGovernedSandboxScaffold } from "./sandboxExecutionBoundary";
import { makeRuntimeAdapterSafetyBoundary, type RuntimeAdapterSafetyBoundary } from "./governedRuntimeAdapterContract";
import { SANDBOX_GAMEPLAY_FEATURE_PATCH_FILE_NAME } from "./sandboxGameplayFeaturePatchAdapter";
import { SANDBOX_GAMEPLAY_CONFIG_FILE_NAME } from "./sandboxGameplayConfigAdapter";

// =====================================================================================
// WORKFLOW LIFECYCLE
// =====================================================================================

export type WorkflowLifecycleState =
  | "queued"
  | "authorization_verified"
  | "replay_verified"
  | "workflow_started"
  | "feature_patch_running"
  | "feature_patch_completed"
  | "gameplay_config_running"
  | "gameplay_config_completed"
  | "rollback_chain_created"
  | "receipt_aggregation_completed"
  | "completed"
  | "replay_rejected"
  | "failed";

export type WorkflowLifecycleRecord = {
  state: WorkflowLifecycleState;
  timestamp: string;
  message?: string;
};

// =====================================================================================
// MUTATION CHAIN
// =====================================================================================

export type WorkflowMutationStep = {
  stepIndex: number;
  stepId: string;
  operationRequest: string;
  dispatchId: string;
  invocationId: string;
  sandboxId: string;
  outcome: "completed" | "failed" | "timeout" | "rejected";
  affectedFiles: string[];
  receiptId: string;
};

export type WorkflowMutationChain = {
  workflowId: string;
  proposalId: string;
  steps: WorkflowMutationStep[];
  totalFilesAffected: string[];
  aggregatedDiffEntries: GovernedDispatchDiffEntry[];
  completedAt: string;
};

// =====================================================================================
// ROLLBACK CHAIN
// =====================================================================================

export type WorkflowRollbackStep = {
  stepIndex: number;
  stepId: string;
  affectedFiles: string[];
  beforeSnapshotId: string;
  afterSnapshotId: string;
  diffSummary: string;
  restorationReady: boolean;
};

export type WorkflowRollbackChain = {
  workflowId: string;
  proposalId: string;
  sandboxId: string;
  steps: WorkflowRollbackStep[];
  rollbackReady: boolean;
  createdAt: string;
};

// =====================================================================================
// RECEIPT AGGREGATION
// =====================================================================================

export type WorkflowStepReceiptSummary = {
  dispatchId: string;
  invocationId: string;
  receiptId: string;
  affectedFiles: string[];
  outcome: string;
};

export type WorkflowReceiptAggregation = {
  aggregationId: string;
  workflowId: string;
  proposalId: string;
  operatorId: string;
  sandboxId: string;
  sandboxRootPath: string;
  featurePatchMutation: WorkflowStepReceiptSummary;
  gameplayConfigMutation: WorkflowStepReceiptSummary;
  totalAffectedFiles: string[];
  dispatchReferences: string[];
  rollbackChainReferences: string[];
  runtimeIds: string[];
  lifecycle: WorkflowLifecycleRecord[];
  aggregatedAt: string;
};

// =====================================================================================
// REQUEST / RESULT
// =====================================================================================

export type GovernedWorkflowRequest = {
  workflowId?: string;
  proposalId: string;
  authorization: GovernedExecutionApproval;
  approvalToken: string;
  expiresAt: string;
  operatorId?: string;
  sandboxId?: string;
  repositoryRoot?: string;
  timeoutMs?: number;
  now?: () => string;
};

export type GovernedWorkflowResult = {
  manifestVersion: "EXEC-0052-H";
  outcome: "completed" | "failed" | "replay_rejected";
  workflowId: string;
  proposalId: string;
  operatorId: string;
  sandboxId: string;
  sandboxRootPath: string;
  lifecycle: WorkflowLifecycleRecord[];
  mutationChain: WorkflowMutationChain;
  rollbackChain: WorkflowRollbackChain;
  receiptAggregation: WorkflowReceiptAggregation;
  featurePatchResult: SandboxGameplayFeaturePatchDispatchResult | null;
  gameplayConfigResult: SandboxGameplayConfigDispatchResult | null;
  executedAt: string;
  durationMs: number;
  error?: string;
  proposalReplayRejectionReceipt?: ProposalReplayRejectionReceipt;
  safetyBoundary: RuntimeAdapterSafetyBoundary;
};

// =====================================================================================
// WORKFLOW-LEVEL REPLAY REGISTRY
// Separate from the per-dispatch proposalReplayRegistry — tracks workflow-level execution.
// =====================================================================================

const workflowReplayRegistry: GovernedProposalReplayRegistry =
  createGovernedProposalReplayRegistry();

// =====================================================================================
// INTERNAL HELPERS
// =====================================================================================

function makeWorkflowId(now: () => string): string {
  const ts = now().replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  return `workflow-${ts}-exec0052h`;
}

function makeAggregationId(workflowId: string, now: string): string {
  const ts = now.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  return `aggregation-${ts}-${workflowId.slice(-8)}`;
}

function advanceWorkflow(
  records: WorkflowLifecycleRecord[],
  state: WorkflowLifecycleState,
  timestamp: string,
  message?: string,
): WorkflowLifecycleRecord[] {
  return [...records, { state, timestamp, message }];
}

function extractAffectedFiles(
  result: SandboxGameplayFeaturePatchDispatchResult | SandboxGameplayConfigDispatchResult,
): string[] {
  return result.diffEntries
    .filter((e) => e.changeKind !== "unchanged")
    .map((e) => e.sandboxRelativePath);
}

function buildStepAuth(
  base: GovernedExecutionApproval,
  stepProposalId: string,
): GovernedExecutionApproval {
  return {
    authorityToken: base.authorityToken,
    approvedBy: base.approvedBy,
    approvedAt: base.approvedAt,
    proposalId: stepProposalId,
    operationRequest: base.operationRequest,
  };
}

function makeEmptyMutationChain(
  workflowId: string,
  proposalId: string,
  nowStr: string,
): WorkflowMutationChain {
  return {
    workflowId,
    proposalId,
    steps: [],
    totalFilesAffected: [],
    aggregatedDiffEntries: [],
    completedAt: nowStr,
  };
}

function makeEmptyRollbackChain(
  workflowId: string,
  proposalId: string,
  sandboxId: string,
  nowStr: string,
): WorkflowRollbackChain {
  return {
    workflowId,
    proposalId,
    sandboxId,
    steps: [],
    rollbackReady: false,
    createdAt: nowStr,
  };
}

function makeEmptyReceiptAggregation(
  workflowId: string,
  proposalId: string,
  operatorId: string,
  sandboxId: string,
  sandboxRootPath: string,
  lifecycle: WorkflowLifecycleRecord[],
  nowStr: string,
): WorkflowReceiptAggregation {
  const empty: WorkflowStepReceiptSummary = {
    dispatchId: "",
    invocationId: "",
    receiptId: "",
    affectedFiles: [],
    outcome: "rejected",
  };
  return {
    aggregationId: makeAggregationId(workflowId, nowStr),
    workflowId,
    proposalId,
    operatorId,
    sandboxId,
    sandboxRootPath,
    featurePatchMutation: empty,
    gameplayConfigMutation: { ...empty },
    totalAffectedFiles: [],
    dispatchReferences: [],
    rollbackChainReferences: [],
    runtimeIds: [],
    lifecycle,
    aggregatedAt: nowStr,
  };
}

function makeFailedResult(params: {
  workflowId: string;
  proposalId: string;
  operatorId: string;
  sandboxId: string;
  sandboxRootPath: string;
  lifecycle: WorkflowLifecycleRecord[];
  error: string | undefined;
  startTime: number;
  nowStr: string;
  featurePatchResult?: SandboxGameplayFeaturePatchDispatchResult;
  gameplayConfigResult?: SandboxGameplayConfigDispatchResult;
}): GovernedWorkflowResult {
  const { workflowId, proposalId, operatorId, sandboxId, sandboxRootPath, lifecycle, startTime, nowStr } = params;
  return {
    manifestVersion: "EXEC-0052-H",
    outcome: "failed",
    workflowId,
    proposalId,
    operatorId,
    sandboxId,
    sandboxRootPath,
    lifecycle,
    mutationChain: makeEmptyMutationChain(workflowId, proposalId, nowStr),
    rollbackChain: makeEmptyRollbackChain(workflowId, proposalId, sandboxId, nowStr),
    receiptAggregation: makeEmptyReceiptAggregation(workflowId, proposalId, operatorId, sandboxId, sandboxRootPath, lifecycle, nowStr),
    featurePatchResult: params.featurePatchResult ?? null,
    gameplayConfigResult: params.gameplayConfigResult ?? null,
    executedAt: nowStr,
    durationMs: Date.now() - startTime,
    error: params.error,
    safetyBoundary: makeRuntimeAdapterSafetyBoundary(),
  };
}

// =====================================================================================
// MAIN WORKFLOW EXECUTOR
// =====================================================================================

export async function executeGovernedWorkflow(
  request: GovernedWorkflowRequest,
): Promise<GovernedWorkflowResult> {
  const startTime = Date.now();
  const nowFn = request.now ?? (() => new Date().toISOString());
  const nowStr = nowFn();
  const stableNow = () => nowStr;

  const operatorId = request.operatorId?.trim() || "operator";
  const workflowId = request.workflowId?.trim() || makeWorkflowId(stableNow);

  // Build sandbox scaffold — shared across both steps
  const scaffold = buildGovernedSandboxScaffold({
    sandboxId: request.sandboxId,
    repositoryRoot: request.repositoryRoot,
    now: stableNow,
  });
  const sandboxId = scaffold.sandboxId;
  const sandboxRootPath = scaffold.sandboxRoot.absolutePath;

  let lifecycle: WorkflowLifecycleRecord[] = [];

  // --- queued ---
  lifecycle = advanceWorkflow(lifecycle, "queued", nowStr,
    `Workflow ${workflowId} queued for execution`);

  // Hard approval token check
  if (request.approvalToken !== GOVERNED_DISPATCH_APPROVAL_TOKEN) {
    lifecycle = advanceWorkflow(lifecycle, "failed", nowStr, "Invalid approval token — workflow rejected");
    return makeFailedResult({
      workflowId, proposalId: request.proposalId, operatorId,
      sandboxId, sandboxRootPath, lifecycle,
      error: "Invalid approval token — workflow rejected",
      startTime, nowStr,
    });
  }

  // --- authorization_verified ---
  lifecycle = advanceWorkflow(lifecycle, "authorization_verified", nowStr,
    "Approval token verified — operator authority confirmed");

  // Workflow-level replay protection (separate registry from per-dispatch replay registry)
  const workflowOperationRequest = `governed-workflow-exec0052h::${workflowId}`;
  const replayCheck = verifyProposalNotReplayed(
    workflowReplayRegistry,
    {
      proposalId: request.proposalId,
      approvalToken: request.authorization.authorityToken,
      operationRequest: workflowOperationRequest,
    },
    nowStr,
  );

  if (replayCheck.isReplay) {
    const replayRejectionReceipt: ProposalReplayRejectionReceipt = replayCheck.existingRecord
      ? makeProposalReplayRejectionReceipt({
          proposalId: request.proposalId,
          originalRecord: replayCheck.existingRecord,
          attemptedAt: nowStr,
          operatorId,
          replayFingerprint: replayCheck.fingerprint,
          reason: replayCheck.reason ?? "workflow-replay-rejected",
        })
      : {
          proposalId: request.proposalId,
          originalDispatchId: "unknown",
          originalSandboxId: "unknown",
          originalRuntimeType: "unknown",
          replayRejectionReason: replayCheck.reason ?? "workflow-replay-rejected",
          attemptedAt: nowStr,
          operatorId,
          replayFingerprint: replayCheck.fingerprint,
        };

    lifecycle = advanceWorkflow(lifecycle, "replay_rejected", nowStr,
      `Workflow replay rejected: ${replayCheck.reason ?? "proposal-id-already-executed"}`);

    return {
      manifestVersion: "EXEC-0052-H",
      outcome: "replay_rejected",
      workflowId,
      proposalId: request.proposalId,
      operatorId,
      sandboxId,
      sandboxRootPath,
      lifecycle,
      mutationChain: makeEmptyMutationChain(workflowId, request.proposalId, nowStr),
      rollbackChain: makeEmptyRollbackChain(workflowId, request.proposalId, sandboxId, nowStr),
      receiptAggregation: makeEmptyReceiptAggregation(workflowId, request.proposalId, operatorId, sandboxId, sandboxRootPath, lifecycle, nowStr),
      featurePatchResult: null,
      gameplayConfigResult: null,
      executedAt: nowStr,
      durationMs: Date.now() - startTime,
      error: `Workflow replay rejected: ${replayCheck.reason}`,
      proposalReplayRejectionReceipt: replayRejectionReceipt,
      safetyBoundary: makeRuntimeAdapterSafetyBoundary(),
    };
  }

  // --- replay_verified ---
  lifecycle = advanceWorkflow(lifecycle, "replay_verified", nowStr,
    "Workflow replay check passed — no prior execution found for this proposal");

  // --- workflow_started ---
  lifecycle = advanceWorkflow(lifecycle, "workflow_started", nowStr,
    `Workflow ${workflowId} started — 2 steps queued under proposal ${request.proposalId}`);

  // Step-scoped proposalIds prevent cross-registry conflicts between the two per-dispatch
  // proposalReplayRegistry entries (each dispatcher has its own registry check).
  const featurePatchProposalId = `${request.proposalId}-step-a`;
  const configProposalId = `${request.proposalId}-step-b`;

  // ==================================================================================
  // STEP A: Gameplay Feature Patch — inject ClampStaminaRegeneration()
  // ==================================================================================
  lifecycle = advanceWorkflow(lifecycle, "feature_patch_running", nowStr,
    `Step A: Injecting ClampStaminaRegeneration() → ${SANDBOX_GAMEPLAY_FEATURE_PATCH_FILE_NAME}`);

  let featurePatchResult: SandboxGameplayFeaturePatchDispatchResult;
  try {
    featurePatchResult = await executeSandboxGameplayFeaturePatchDispatch({
      approvalToken: GOVERNED_DISPATCH_APPROVAL_TOKEN,
      authorization: buildStepAuth(request.authorization, featurePatchProposalId),
      expiresAt: request.expiresAt,
      sandboxId,
      repositoryRoot: request.repositoryRoot,
      operatorId,
      operationRequest: "inject stamina clamp feature",
      timeoutMs: request.timeoutMs,
      now: stableNow,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    lifecycle = advanceWorkflow(lifecycle, "failed", nowStr, `Step A threw: ${errMsg}`);
    return makeFailedResult({
      workflowId, proposalId: request.proposalId, operatorId,
      sandboxId, sandboxRootPath, lifecycle, error: errMsg, startTime, nowStr,
    });
  }

  if (featurePatchResult.outcome !== "completed") {
    lifecycle = advanceWorkflow(lifecycle, "failed", nowStr,
      `Step A ${featurePatchResult.outcome}: ${featurePatchResult.error ?? "dispatch did not complete"}`);
    return makeFailedResult({
      workflowId, proposalId: request.proposalId, operatorId,
      sandboxId, sandboxRootPath, lifecycle,
      error: featurePatchResult.error ?? `Feature patch outcome: ${featurePatchResult.outcome}`,
      startTime, nowStr, featurePatchResult,
    });
  }

  // --- feature_patch_completed ---
  lifecycle = advanceWorkflow(lifecycle, "feature_patch_completed", nowStr,
    `Step A completed — ${SANDBOX_GAMEPLAY_FEATURE_PATCH_FILE_NAME} written, receipt ${featurePatchResult.receiptId}`);

  // ==================================================================================
  // STEP B: Gameplay Config Mutation — apply deterministic tuning values
  // movementSpeed += 0.5 | staminaCooldown -= 0.1 | enemyAggroRange += 1.0
  // ==================================================================================
  lifecycle = advanceWorkflow(lifecycle, "gameplay_config_running", nowStr,
    `Step B: Applying deterministic tuning step → ${SANDBOX_GAMEPLAY_CONFIG_FILE_NAME}`);

  let gameplayConfigResult: SandboxGameplayConfigDispatchResult;
  try {
    gameplayConfigResult = await executeSandboxGameplayConfigDispatch({
      approvalToken: GOVERNED_DISPATCH_APPROVAL_TOKEN,
      authorization: buildStepAuth(request.authorization, configProposalId),
      expiresAt: request.expiresAt,
      sandboxId,
      repositoryRoot: request.repositoryRoot,
      operatorId,
      operationRequest: "tuning step",
      timeoutMs: request.timeoutMs,
      now: stableNow,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    lifecycle = advanceWorkflow(lifecycle, "failed", nowStr, `Step B threw: ${errMsg}`);
    return makeFailedResult({
      workflowId, proposalId: request.proposalId, operatorId,
      sandboxId, sandboxRootPath, lifecycle, error: errMsg, startTime, nowStr, featurePatchResult,
    });
  }

  if (gameplayConfigResult.outcome !== "completed") {
    lifecycle = advanceWorkflow(lifecycle, "failed", nowStr,
      `Step B ${gameplayConfigResult.outcome}: ${gameplayConfigResult.error ?? "dispatch did not complete"}`);
    return makeFailedResult({
      workflowId, proposalId: request.proposalId, operatorId,
      sandboxId, sandboxRootPath, lifecycle,
      error: gameplayConfigResult.error ?? `Config dispatch outcome: ${gameplayConfigResult.outcome}`,
      startTime, nowStr, featurePatchResult, gameplayConfigResult,
    });
  }

  // --- gameplay_config_completed ---
  lifecycle = advanceWorkflow(lifecycle, "gameplay_config_completed", nowStr,
    `Step B completed — ${SANDBOX_GAMEPLAY_CONFIG_FILE_NAME} mutated, receipt ${gameplayConfigResult.receiptId}`);

  // ==================================================================================
  // ROLLBACK CHAIN
  // ==================================================================================
  const featurePatchAffectedFiles = extractAffectedFiles(featurePatchResult);
  const configAffectedFiles = extractAffectedFiles(gameplayConfigResult);

  const rollbackChain: WorkflowRollbackChain = {
    workflowId,
    proposalId: request.proposalId,
    sandboxId,
    steps: [
      {
        stepIndex: 0,
        stepId: `${workflowId}-step-a`,
        affectedFiles: featurePatchAffectedFiles,
        beforeSnapshotId: featurePatchResult.rollbackContract.beforeSnapshotId,
        afterSnapshotId: featurePatchResult.rollbackContract.afterSnapshotId,
        diffSummary: featurePatchResult.rollbackContract.rollbackMetadata.diffSummary,
        restorationReady: featurePatchResult.rollbackContract.rollbackReady,
      },
      {
        stepIndex: 1,
        stepId: `${workflowId}-step-b`,
        affectedFiles: configAffectedFiles,
        beforeSnapshotId: gameplayConfigResult.rollbackContract.beforeSnapshotId,
        afterSnapshotId: gameplayConfigResult.rollbackContract.afterSnapshotId,
        diffSummary: gameplayConfigResult.rollbackContract.rollbackMetadata.diffSummary,
        restorationReady: gameplayConfigResult.rollbackContract.rollbackReady,
      },
    ],
    rollbackReady: true,
    createdAt: nowStr,
  };

  // --- rollback_chain_created ---
  lifecycle = advanceWorkflow(lifecycle, "rollback_chain_created", nowStr,
    `Rollback chain created — ${rollbackChain.steps.length} steps, restoration ready`);

  // ==================================================================================
  // MUTATION CHAIN
  // ==================================================================================
  const allDiffEntries: GovernedDispatchDiffEntry[] = [
    ...featurePatchResult.diffEntries,
    ...gameplayConfigResult.diffEntries,
  ];
  const allAffectedFiles = [...new Set([...featurePatchAffectedFiles, ...configAffectedFiles])];

  const mutationChain: WorkflowMutationChain = {
    workflowId,
    proposalId: request.proposalId,
    steps: [
      {
        stepIndex: 0,
        stepId: `${workflowId}-step-a`,
        operationRequest: "inject stamina clamp feature",
        dispatchId: featurePatchResult.dispatchId,
        invocationId: featurePatchResult.invocationId,
        sandboxId: featurePatchResult.sandboxId,
        outcome: featurePatchResult.outcome,
        affectedFiles: featurePatchAffectedFiles,
        receiptId: featurePatchResult.receiptId,
      },
      {
        stepIndex: 1,
        stepId: `${workflowId}-step-b`,
        operationRequest: "tuning step",
        dispatchId: gameplayConfigResult.dispatchId,
        invocationId: gameplayConfigResult.invocationId,
        sandboxId: gameplayConfigResult.sandboxId,
        outcome: gameplayConfigResult.outcome,
        affectedFiles: configAffectedFiles,
        receiptId: gameplayConfigResult.receiptId,
      },
    ],
    totalFilesAffected: allAffectedFiles,
    aggregatedDiffEntries: allDiffEntries,
    completedAt: nowStr,
  };

  // ==================================================================================
  // RECEIPT AGGREGATION
  // ==================================================================================
  const aggregationId = makeAggregationId(workflowId, nowStr);

  const lifecycleBeforeAgg = advanceWorkflow(lifecycle, "receipt_aggregation_completed", nowStr,
    "Workflow receipt aggregated — all steps, dispatches, rollback refs included");

  const receiptAggregation: WorkflowReceiptAggregation = {
    aggregationId,
    workflowId,
    proposalId: request.proposalId,
    operatorId,
    sandboxId,
    sandboxRootPath,
    featurePatchMutation: {
      dispatchId: featurePatchResult.dispatchId,
      invocationId: featurePatchResult.invocationId,
      receiptId: featurePatchResult.receiptId,
      affectedFiles: featurePatchAffectedFiles,
      outcome: featurePatchResult.outcome,
    },
    gameplayConfigMutation: {
      dispatchId: gameplayConfigResult.dispatchId,
      invocationId: gameplayConfigResult.invocationId,
      receiptId: gameplayConfigResult.receiptId,
      affectedFiles: configAffectedFiles,
      outcome: gameplayConfigResult.outcome,
    },
    totalAffectedFiles: allAffectedFiles,
    dispatchReferences: [featurePatchResult.dispatchId, gameplayConfigResult.dispatchId],
    rollbackChainReferences: rollbackChain.steps.map((s) => s.stepId),
    runtimeIds: [featurePatchResult.invocationId, gameplayConfigResult.invocationId],
    lifecycle: lifecycleBeforeAgg,
    aggregatedAt: nowStr,
  };

  lifecycle = lifecycleBeforeAgg;

  // --- completed ---
  lifecycle = advanceWorkflow(lifecycle, "completed", nowStr,
    `Workflow ${workflowId} completed — 2 steps, ${allAffectedFiles.length} file(s) affected`);

  // Record workflow-level execution in workflowReplayRegistry
  recordProposalExecution(workflowReplayRegistry, {
    fingerprint: replayCheck.fingerprint,
    proposalId: request.proposalId,
    approvalToken: request.authorization.authorityToken,
    operationRequest: workflowOperationRequest,
    sandboxId,
    dispatchId: featurePatchResult.dispatchId,
    invocationId: featurePatchResult.invocationId,
    runtimeType: "openclaw",
    adapterId: featurePatchResult.adapterId as string,
    outcome: "completed",
    executedAt: nowStr,
    operatorId,
  });

  return {
    manifestVersion: "EXEC-0052-H",
    outcome: "completed",
    workflowId,
    proposalId: request.proposalId,
    operatorId,
    sandboxId,
    sandboxRootPath,
    lifecycle,
    mutationChain,
    rollbackChain,
    receiptAggregation,
    featurePatchResult,
    gameplayConfigResult,
    executedAt: nowStr,
    durationMs: Date.now() - startTime,
    safetyBoundary: makeRuntimeAdapterSafetyBoundary(),
  };
}
