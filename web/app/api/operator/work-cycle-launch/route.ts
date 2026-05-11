import path from "node:path";
import { NextResponse } from "next/server";

import { createFileBackedDurableProjectMemoryStore } from "@/lib/aie/durableProjectMemoryStore";
import { launchOperatorWorkCycle, restoreOperatorWorkCycleCheckpoint, type OperatorWorkCycleRequest } from "@/lib/aie/operatorWorkCycleLauncher";

export const runtime = "nodejs";

function normalizeRequest(value: unknown): OperatorWorkCycleRequest | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Record<string, unknown>;
  const mutationScope = source.mutationScope;
  if (!mutationScope || typeof mutationScope !== "object" || Array.isArray(mutationScope)) {
    return null;
  }
  const scope = mutationScope as Record<string, unknown>;
  const proposedChanges = Array.isArray(source.proposedChanges) ? source.proposedChanges : [];
  const validationPlan = source.validationPlan && typeof source.validationPlan === "object" ? source.validationPlan as Record<string, unknown> : { commands: [] };
  if (
    typeof source.cycleRequestId !== "string"
    || typeof source.cycleIntent !== "string"
    || !Array.isArray(source.targetFiles)
    || !Array.isArray(scope.approvedDirectories)
    || !Array.isArray(scope.approvedFiles)
    || typeof source.rollbackPlan !== "string"
    || typeof source.retryLimit !== "number"
    || source.requiresApproval !== true
    || (source.approvalStatus !== "pending" && source.approvalStatus !== "approved" && source.approvalStatus !== "rejected")
  ) {
    return null;
  }

  return {
    cycleRequestId: source.cycleRequestId.trim(),
    cycleIntent: source.cycleIntent.trim(),
    targetFiles: source.targetFiles.filter((entry): entry is string => typeof entry === "string"),
    validationPlan: { commands: Array.isArray(validationPlan.commands) ? validationPlan.commands.filter((entry): entry is string => typeof entry === "string") : [] },
    rollbackPlan: source.rollbackPlan.trim(),
    retryLimit: Math.trunc(source.retryLimit),
    mutationScope: {
      approvedDirectories: scope.approvedDirectories.filter((entry): entry is string => typeof entry === "string"),
      approvedFiles: scope.approvedFiles.filter((entry): entry is string => typeof entry === "string"),
      allowLockfileMutation: scope.allowLockfileMutation === true,
    },
    requiresApproval: true,
    approvalStatus: source.approvalStatus,
    cycleStatus: "approved",
    proposedChanges: proposedChanges
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .filter((entry) => typeof entry.filePath === "string" && typeof entry.proposedContent === "string")
      .map((entry) => ({ filePath: String(entry.filePath), proposedContent: String(entry.proposedContent) })),
    retryMode: source.retryMode === "none" || source.retryMode === "automatic_retry" || source.retryMode === "supervised_retry" ? source.retryMode : "supervised_retry",
    rollbackOnValidationFailure: source.rollbackOnValidationFailure === true,
    stageHistory: [],
    checkpointHistory: [],
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const trustedWebRoot = process.cwd();
  const trustedRepoRoot = path.resolve(trustedWebRoot, "..");
  const durableStore = createFileBackedDurableProjectMemoryStore({
    storageRoot: path.join(trustedRepoRoot, ".aie", "durable_project_memory"),
    projectId: typeof body.projectId === "string" ? body.projectId : "AI-E",
  });

  if (body.restore === true && typeof body.cycleRequestId === "string") {
    const restored = restoreOperatorWorkCycleCheckpoint(body.cycleRequestId, typeof body.checkpointId === "string" ? body.checkpointId : undefined);
    const durableContinuity = await durableStore.restoreRuntimeContinuity();
    if (!restored && !durableContinuity.durableRestorationOccurred) {
      return NextResponse.json({ error: "No restorable checkpoint or durable runtime state found for that cycle." }, { status: 404 });
    }
    return NextResponse.json({ summaryReport: restored, durableContinuity });
  }

  const cycleRequest = normalizeRequest(body.request);
  if (!cycleRequest) {
    return NextResponse.json({ error: "The operator work cycle request is invalid." }, { status: 400 });
  }
  const launched = await launchOperatorWorkCycle(cycleRequest, {
    trustedRepoRoot,
    enableMutation: process.env.AIE_ENABLE_SCOPED_REPO_MUTATION === "true",
  });
  const durableState = await durableStore.recordOperatorCycle(launched, typeof body.previousCycleId === "string" ? body.previousCycleId : undefined);
  return NextResponse.json({ ...launched, durableState });
}