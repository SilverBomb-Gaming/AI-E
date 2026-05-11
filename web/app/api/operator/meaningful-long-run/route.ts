import path from "node:path";
import { NextResponse } from "next/server";

import { createFileBackedDurableProjectMemoryStore } from "@/lib/aie/durableProjectMemoryStore";
import { runMeaningfulLongRunSupervisedOperation, type MeaningfulLongRunMode } from "@/lib/aie/meaningfulLongRunSupervisedOperation";
import { prepareOperatorWorkCycleRequest } from "@/lib/aie/operatorWorkCycleLauncher";

export const runtime = "nodejs";

function modeFrom(value: unknown): MeaningfulLongRunMode {
  return value === "supervised_mode" || value === "campaign_mode" || value === "test_mode" ? value : "test_mode";
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  if (body.approvalStatus !== "approved") {
    return NextResponse.json({ error: "Meaningful long-run operation requires explicit operator approval." }, { status: 403 });
  }
  const trustedWebRoot = process.cwd();
  const trustedRepoRoot = path.resolve(trustedWebRoot, "..");
  const projectId = typeof body.projectId === "string" ? body.projectId : "AI-E";
  const mode = modeFrom(body.mode);
  const targetRuntimeMs = positiveNumber(body.targetRuntimeMs, mode === "test_mode" ? 5 * 60 * 1000 : 30 * 60 * 1000);
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : `meaningful-long-run-${Date.now()}`;
  const targetFile = "runner_artifacts/operator_work_cycle/latest_cycle_request.txt";
  const cycleRequests = [1, 2].map((index) => ({
    ...prepareOperatorWorkCycleRequest({
      cycleRequestId: `${sessionId}-cycle-${index}`,
      cycleIntent: `meaningful long-run supervised operation cycle ${index}`,
      targetFiles: [targetFile],
      proposedChanges: [{ filePath: targetFile, proposedContent: [`session=${sessionId}`, `cycle=${index}`, `mode=${mode}`, `targetRuntimeMs=${targetRuntimeMs}`, ""].join("\n") }],
      rollbackPlan: "Restore the previous long-run operation artifact snapshot.",
      validationPlan: { commands: [] },
      retryLimit: 1,
      mutationScope: {
        approvedDirectories: ["runner_artifacts/operator_work_cycle"],
        approvedFiles: [targetFile],
      },
    }),
    approvalStatus: "approved" as const,
  }));
  const durableStore = createFileBackedDurableProjectMemoryStore({
    storageRoot: path.join(trustedRepoRoot, ".aie", "durable_project_memory"),
    projectId,
  });
  const report = await runMeaningfulLongRunSupervisedOperation({
    sessionId,
    projectId,
    mode,
    targetRuntimeMs,
    checkpointIntervalMs: positiveNumber(body.checkpointIntervalMs, Math.min(60_000, Math.max(1_000, Math.floor(targetRuntimeMs / 5)))),
    approvedCycleRequests: cycleRequests,
    failureLimit: positiveNumber(body.failureLimit, 2),
    meaningfulProofThresholdMs: mode === "campaign_mode" ? 2 * 60 * 60 * 1000 : 5 * 60 * 1000,
  }, {
    trustedRepoRoot,
    durableStore,
    enableMutation: process.env.AIE_ENABLE_SCOPED_REPO_MUTATION === "true",
  });
  return NextResponse.json({ report });
}