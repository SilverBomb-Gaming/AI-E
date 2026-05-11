import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type PatchRiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type PatchApprovalStatus = "pending" | "approved" | "rejected";
export type PatchStatus = "prepared" | "awaiting_approval" | "approved" | "applying" | "applied" | "validating" | "validated" | "validation_failed" | "retry_ready" | "reverted" | "blocked" | "failed" | "mutation_disabled";
export type MutationTruthfulnessLabel = "preview_only_no_mutation" | "blocked_no_mutation" | "mutation_disabled_no_write" | "real_mutation_applied" | "real_mutation_validated" | "real_mutation_validation_failed" | "real_mutation_reverted" | "retry_prepared_no_mutation";
export type PatchMilestoneKind = "planning" | "execution" | "mutation" | "validation" | "rollback" | "retry";

export type PatchTargetFile = {
  filePath: string;
  proposedContent: string;
};

export type PatchMutationScope = {
  approvedDirectories: string[];
  approvedFiles: string[];
  allowLockfileMutation?: boolean;
};

export type PatchValidationPlan = {
  commands: string[];
};

export type PatchValidationResult = {
  command: string;
  status: "passed" | "failed" | "skipped";
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  elapsedMs: number;
  truthfulnessLabel: "real_validation_executed" | "validation_skipped";
};

export type PatchFileSnapshot = {
  filePath: string;
  existedBefore: boolean;
  contentBefore: string;
  contentAfter: string;
};

export type PatchLifecycleEvent = {
  milestoneKind: PatchMilestoneKind;
  patchStatus: PatchStatus;
  timestamp: string;
  summary: string;
};

export type ScopedRepoPatchRequest = {
  patchRequestId: string;
  targetFiles: PatchTargetFile[];
  patchIntent: string;
  proposedChangesSummary: string;
  riskLevel: PatchRiskLevel;
  requiresApproval: boolean;
  approvalStatus: PatchApprovalStatus;
  rollbackPlan: string;
  validationPlan: PatchValidationPlan;
  mutationScope: PatchMutationScope;
  patchStatus: PatchStatus;
  diffPreview: string;
  appliedAt?: string;
  revertedAt?: string;
  validationResults: PatchValidationResult[];
  mutationTruthfulnessLabel: MutationTruthfulnessLabel;
};

export type ScopedRepoPatchReport = ScopedRepoPatchRequest & {
  phaseId: "SCOPED_REPO_MUTATION_AND_PATCH_RUNTIME_PHASE1";
  mutationTrulyExecuted: boolean;
  rollbackAvailable: boolean;
  retryAllowed: boolean;
  blockedReason?: string;
  snapshots: PatchFileSnapshot[];
  lifecycle: PatchLifecycleEvent[];
  completedMilestoneKinds: PatchMilestoneKind[];
  recommendedNextAction: string;
};

export type PatchValidationRunner = (command: string, workingDirectory: string) => Promise<PatchValidationResult>;

export type RunScopedRepoPatchOptions = {
  trustedRepoRoot: string;
  approvalStatus: PatchApprovalStatus;
  approvedBy?: string;
  enableMutation?: boolean;
  now?: () => string;
  validationRunner?: PatchValidationRunner;
};

export type RollbackScopedRepoPatchOptions = {
  trustedRepoRoot: string;
  approvedFiles: string[];
  now?: () => string;
};

const credentialPatterns = [/(^|[/\\])\.env(\.|$)?/i, /(^|[/\\])id_rsa$/i, /\.(pem|key|p12|pfx)$/i, /credential/i, /secret/i, /token/i];
const lockfileNames = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]);

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isUnsafeRelativePath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  return path.isAbsolute(filePath) || normalized.includes("..") || /[*?<>|]/.test(normalized) || normalized.length === 0;
}

function isWithinApprovedDirectory(filePath: string, directories: string[]): boolean {
  const normalizedFile = normalizeRelativePath(filePath).toLowerCase();
  return directories.some((directory) => {
    const normalizedDirectory = normalizeRelativePath(directory).replace(/\/+$/, "").toLowerCase();
    if (normalizedDirectory === "." || normalizedDirectory === "") {
      return true;
    }
    return normalizedFile === normalizedDirectory || normalizedFile.startsWith(`${normalizedDirectory}/`);
  });
}

function blockedReasonForRequest(request: ScopedRepoPatchRequest): string | undefined {
  if (request.riskLevel === "HIGH") {
    return "High-risk repo mutation is outside the Phase 1 patch runtime boundary.";
  }
  if (request.requiresApproval && request.approvalStatus !== "approved") {
    return "Patch mutation requires explicit approval before writing files.";
  }
  if (!request.rollbackPlan.trim()) {
    return "Rollback plan is required before scoped repo mutation.";
  }
  if (request.targetFiles.length === 0) {
    return "Patch request must include at least one target file.";
  }
  for (const target of request.targetFiles) {
    const normalizedFile = normalizeRelativePath(target.filePath);
    const basename = path.posix.basename(normalizedFile).toLowerCase();
    if (isUnsafeRelativePath(normalizedFile)) {
      return `Target file '${target.filePath}' is not a safe explicit relative path.`;
    }
    if (!request.mutationScope.approvedFiles.map((entry) => normalizeRelativePath(entry).toLowerCase()).includes(normalizedFile.toLowerCase())) {
      return `Target file '${target.filePath}' was not explicitly approved.`;
    }
    if (!isWithinApprovedDirectory(normalizedFile, request.mutationScope.approvedDirectories)) {
      return `Target file '${target.filePath}' is outside approved directories.`;
    }
    if (credentialPatterns.some((pattern) => pattern.test(normalizedFile))) {
      return `Target file '${target.filePath}' matches a credential or secret path pattern.`;
    }
    if (lockfileNames.has(basename) && !request.mutationScope.allowLockfileMutation) {
      return `Lockfile '${target.filePath}' requires explicit lockfile approval.`;
    }
  }
  return undefined;
}

function formatDiff(filePath: string, before: string, after: string): string {
  if (before === after) {
    return [`diff -- ${filePath}`, "(no content changes)"].join("\n");
  }
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  return [
    `diff -- ${filePath}`,
    `--- ${filePath}`,
    `+++ ${filePath}`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ].join("\n");
}

async function snapshotTargets(request: ScopedRepoPatchRequest, trustedRepoRoot: string): Promise<PatchFileSnapshot[]> {
  return Promise.all(request.targetFiles.map(async (target) => {
    const absolutePath = path.join(trustedRepoRoot, normalizeRelativePath(target.filePath));
    try {
      const contentBefore = await readFile(absolutePath, "utf8");
      return { filePath: normalizeRelativePath(target.filePath), existedBefore: true, contentBefore, contentAfter: target.proposedContent };
    } catch {
      return { filePath: normalizeRelativePath(target.filePath), existedBefore: false, contentBefore: "", contentAfter: target.proposedContent };
    }
  }));
}

function withPreview(request: ScopedRepoPatchRequest, snapshots: PatchFileSnapshot[]): ScopedRepoPatchRequest {
  return {
    ...request,
    diffPreview: snapshots.map((snapshot) => formatDiff(snapshot.filePath, snapshot.contentBefore, snapshot.contentAfter)).join("\n\n"),
  };
}

function event(milestoneKind: PatchMilestoneKind, patchStatus: PatchStatus, timestamp: string, summary: string): PatchLifecycleEvent {
  return { milestoneKind, patchStatus, timestamp, summary };
}

function report(params: {
  request: ScopedRepoPatchRequest;
  snapshots: PatchFileSnapshot[];
  lifecycle: PatchLifecycleEvent[];
  blockedReason?: string;
  mutationTrulyExecuted: boolean;
}): ScopedRepoPatchReport {
  const validationFailed = params.request.validationResults.some((result) => result.status === "failed");
  const completedMilestoneKinds = Array.from(new Set(params.lifecycle.map((entry) => entry.milestoneKind)));
  const rollbackAvailable = params.mutationTrulyExecuted && params.request.patchStatus !== "reverted";
  const retryAllowed = params.request.patchStatus === "validation_failed" || params.request.patchStatus === "failed";
  const recommendedNextAction = params.blockedReason
    ? "Fix the approval, scope, rollback, or safety blocker before retrying."
    : params.request.patchStatus === "validated"
      ? "Review the applied diff and validation output before committing or continuing."
      : validationFailed
        ? "Review validation failure output, prepare a supervised retry patch, or roll back the mutation."
        : params.request.patchStatus === "reverted"
          ? "Confirm the rollback restored the target files before preparing another patch."
          : "Continue only through another approved scoped patch request.";

  return {
    ...params.request,
    phaseId: "SCOPED_REPO_MUTATION_AND_PATCH_RUNTIME_PHASE1",
    mutationTrulyExecuted: params.mutationTrulyExecuted,
    rollbackAvailable,
    retryAllowed,
    blockedReason: params.blockedReason,
    snapshots: params.snapshots,
    lifecycle: params.lifecycle,
    completedMilestoneKinds,
    recommendedNextAction,
  };
}

export async function runScopedRepoPatch(request: ScopedRepoPatchRequest, options: RunScopedRepoPatchOptions): Promise<ScopedRepoPatchReport> {
  const now = options.now ?? (() => new Date().toISOString());
  const trustedRepoRoot = path.resolve(options.trustedRepoRoot);
  const approvedRequest: ScopedRepoPatchRequest = { ...request, approvalStatus: options.approvalStatus };
  const snapshots = await snapshotTargets(approvedRequest, trustedRepoRoot);
  const preparedRequest = withPreview(approvedRequest, snapshots);
  const lifecycle = [event("planning", "prepared", now(), `Generated diff preview for patch ${request.patchRequestId}.`)];

  if (options.approvalStatus === "pending") {
    const awaitingRequest = { ...preparedRequest, patchStatus: "awaiting_approval" as const, mutationTruthfulnessLabel: "preview_only_no_mutation" as const };
    lifecycle.push(event("planning", "awaiting_approval", now(), "Patch is waiting for explicit mutation approval."));
    return report({ request: awaitingRequest, snapshots, lifecycle, mutationTrulyExecuted: false });
  }
  if (options.approvalStatus === "rejected") {
    const rejectedRequest = { ...preparedRequest, patchStatus: "blocked" as const, mutationTruthfulnessLabel: "blocked_no_mutation" as const };
    lifecycle.push(event("execution", "blocked", now(), "Patch approval was rejected; no files were written."));
    return report({ request: rejectedRequest, snapshots, lifecycle, blockedReason: "Patch mutation rejected by operator approval.", mutationTrulyExecuted: false });
  }

  const blockedReason = blockedReasonForRequest(preparedRequest);
  if (blockedReason) {
    const blockedRequest = { ...preparedRequest, patchStatus: "blocked" as const, mutationTruthfulnessLabel: "blocked_no_mutation" as const };
    lifecycle.push(event("execution", "blocked", now(), blockedReason));
    return report({ request: blockedRequest, snapshots, lifecycle, blockedReason, mutationTrulyExecuted: false });
  }

  if (options.enableMutation !== true && process.env.AIE_ENABLE_SCOPED_REPO_MUTATION !== "true") {
    const disabledRequest = { ...preparedRequest, patchStatus: "mutation_disabled" as const, mutationTruthfulnessLabel: "mutation_disabled_no_write" as const };
    lifecycle.push(event("execution", "mutation_disabled", now(), "Scoped repo mutation runtime is disabled; no files were written."));
    return report({ request: disabledRequest, snapshots, lifecycle, blockedReason: "Set AIE_ENABLE_SCOPED_REPO_MUTATION=true or pass enableMutation=true in a trusted runtime.", mutationTrulyExecuted: false });
  }

  lifecycle.push(event("execution", "approved", now(), `Patch approved by ${options.approvedBy ?? "operator"}.`));
  lifecycle.push(event("mutation", "applying", now(), "Applying scoped file writes from approved patch request."));
  for (const snapshot of snapshots) {
    const absolutePath = path.join(trustedRepoRoot, snapshot.filePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, snapshot.contentAfter, "utf8");
  }
  const appliedAt = now();
  let appliedRequest: ScopedRepoPatchRequest = {
    ...preparedRequest,
    patchStatus: "applied",
    appliedAt,
    mutationTruthfulnessLabel: "real_mutation_applied",
  };
  lifecycle.push(event("mutation", "applied", appliedAt, `Applied ${snapshots.length} approved file mutation(s).`));

  if (appliedRequest.validationPlan.commands.length > 0) {
    lifecycle.push(event("validation", "validating", now(), "Running scoped patch validation plan."));
    const validationResults = [];
    for (const command of appliedRequest.validationPlan.commands) {
      if (options.validationRunner) {
        validationResults.push(await options.validationRunner(command, trustedRepoRoot));
      } else {
        validationResults.push({ command, status: "skipped" as const, stdout: "", stderr: "No validation runner configured for scoped patch runtime.", exitCode: null, elapsedMs: 0, truthfulnessLabel: "validation_skipped" as const });
      }
    }
    const failed = validationResults.some((result) => result.status === "failed");
    appliedRequest = {
      ...appliedRequest,
      patchStatus: failed ? "validation_failed" : "validated",
      validationResults,
      mutationTruthfulnessLabel: failed ? "real_mutation_validation_failed" : "real_mutation_validated",
    };
    lifecycle.push(event("validation", appliedRequest.patchStatus, now(), failed ? "Validation failed after real scoped mutation." : "Validation passed after real scoped mutation."));
  }

  return report({ request: appliedRequest, snapshots, lifecycle, mutationTrulyExecuted: true });
}

export async function rollbackScopedRepoPatch(previousReport: ScopedRepoPatchReport, options: RollbackScopedRepoPatchOptions): Promise<ScopedRepoPatchReport> {
  const now = options.now ?? (() => new Date().toISOString());
  const trustedRepoRoot = path.resolve(options.trustedRepoRoot);
  const approvedFiles = options.approvedFiles.map((filePath) => normalizeRelativePath(filePath).toLowerCase());
  const lifecycle = [...previousReport.lifecycle, event("rollback", "applying", now(), "Restoring pre-mutation snapshots for approved files.")];

  for (const snapshot of previousReport.snapshots) {
    if (!approvedFiles.includes(snapshot.filePath.toLowerCase())) {
      const blockedRequest = { ...previousReport, patchStatus: "blocked" as const, mutationTruthfulnessLabel: "blocked_no_mutation" as const };
      lifecycle.push(event("rollback", "blocked", now(), `Rollback blocked because '${snapshot.filePath}' is not approved for rollback.`));
      return report({ request: blockedRequest, snapshots: previousReport.snapshots, lifecycle, blockedReason: "Rollback attempted outside approved files.", mutationTrulyExecuted: previousReport.mutationTrulyExecuted });
    }
    const absolutePath = path.join(trustedRepoRoot, snapshot.filePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, snapshot.contentBefore, "utf8");
  }

  const revertedAt = now();
  const revertedRequest: ScopedRepoPatchRequest = {
    ...previousReport,
    patchStatus: "reverted",
    revertedAt,
    mutationTruthfulnessLabel: "real_mutation_reverted",
  };
  lifecycle.push(event("rollback", "reverted", revertedAt, `Restored ${previousReport.snapshots.length} snapshot(s).`));
  return report({ request: revertedRequest, snapshots: previousReport.snapshots, lifecycle, mutationTrulyExecuted: true });
}

export function createSupervisedPatchRetry(previousReport: ScopedRepoPatchReport, retryPatchRequestId: string, targetFiles: PatchTargetFile[]): ScopedRepoPatchRequest {
  return {
    patchRequestId: retryPatchRequestId,
    targetFiles,
    patchIntent: `Retry: ${previousReport.patchIntent}`,
    proposedChangesSummary: `Supervised retry after ${previousReport.patchStatus}: ${previousReport.proposedChangesSummary}`,
    riskLevel: previousReport.riskLevel,
    requiresApproval: true,
    approvalStatus: "pending",
    rollbackPlan: previousReport.rollbackPlan,
    validationPlan: previousReport.validationPlan,
    mutationScope: previousReport.mutationScope,
    patchStatus: "retry_ready",
    diffPreview: "",
    validationResults: [],
    mutationTruthfulnessLabel: "retry_prepared_no_mutation",
  };
}