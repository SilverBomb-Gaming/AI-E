import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFileBackedDurableProjectMemoryStore } from "./durableProjectMemoryStore";
import { prepareOperatorWorkCycleRequest, type OperatorWorkCycleRequest } from "./operatorWorkCycleLauncher";
import { runRealLongDurationActiveOperation } from "./realLongDurationActiveOperationRuntime";

async function withTempRepo(run: (repoRoot: string, storageRoot: string) => Promise<void>) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aie-active-operation-"));
  try {
    await mkdir(path.join(repoRoot, "runner_artifacts/operator_work_cycle"), { recursive: true });
    await writeFile(path.join(repoRoot, "runner_artifacts/operator_work_cycle/latest_cycle_request.txt"), "before\n", "utf8");
    await run(repoRoot, path.join(repoRoot, ".aie", "durable_project_memory"));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

function request(cycleRequestId: string, content: string): OperatorWorkCycleRequest {
  return {
    ...prepareOperatorWorkCycleRequest({
      cycleRequestId,
      cycleIntent: "record real long-duration active operation progress",
      targetFiles: ["runner_artifacts/operator_work_cycle/latest_cycle_request.txt"],
      proposedChanges: [{ filePath: "runner_artifacts/operator_work_cycle/latest_cycle_request.txt", proposedContent: content }],
      rollbackPlan: "Restore the pre-cycle active operation artifact snapshot.",
      validationPlan: { commands: [] },
      retryLimit: 1,
      mutationScope: {
        approvedDirectories: ["runner_artifacts/operator_work_cycle"],
        approvedFiles: ["runner_artifacts/operator_work_cycle/latest_cycle_request.txt"],
      },
    }),
    approvalStatus: "approved",
  };
}

test("runs multiple supervised cycles across real elapsed active-session time", async () => {
  await withTempRepo(async (repoRoot, storageRoot) => {
    const store = createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" });
    const report = await runRealLongDurationActiveOperation({
      sessionId: "active-session-real-elapsed",
      projectId: "AI-E",
      cycleRequests: [request("active-cycle-1", "cycle-one\n"), request("active-cycle-2", "cycle-two\n")],
      minimumRealElapsedMs: 650,
      waitBetweenCyclesMs: 275,
    }, { trustedRepoRoot: repoRoot, durableStore: store, enableMutation: true });

    assert.equal(report.phaseId, "REAL_LONG_DURATION_ACTIVE_OPERATION_PHASE1");
    assert.equal(report.cycleCount, 2);
    assert.ok(report.elapsedRuntimeMs >= 650);
    assert.ok(report.milestoneCount >= 12);
    assert.ok(report.checkpointCount >= 4);
    assert.equal(report.retryCount, 0);
    assert.equal(report.rollbackCount, 0);
    assert.equal(report.operatorApprovedContinuation, true);
    assert.equal(report.activeAcrossMultipleRealOperationalStages, true);
    assert.equal(report.durableStateUsed, true);
    assert.equal(report.persistedToDurableMemory, true);
    assert.equal(report.independentExclusiveExecutionStatus, "supervised_real");
    assert.doesNotMatch(report.summary, /autonomous_real execution is available|unattended background agent is running/i);
    console.log(`ACTIVE_OPERATION_REPORT ${JSON.stringify({ startedAt: report.startedAt, completedAt: report.completedAt, elapsedRuntimeMs: report.elapsedRuntimeMs, cycleCount: report.cycleCount, milestoneCount: report.milestoneCount, checkpointCount: report.checkpointCount, retryCount: report.retryCount, rollbackCount: report.rollbackCount })}`);
  });
});

test("active operation report is persisted into durable project memory", async () => {
  await withTempRepo(async (repoRoot, storageRoot) => {
    const store = createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" });
    const report = await runRealLongDurationActiveOperation({
      sessionId: "active-session-persisted",
      projectId: "AI-E",
      cycleRequests: [request("persisted-cycle-1", "persisted-one\n"), request("persisted-cycle-2", "persisted-two\n")],
      minimumRealElapsedMs: 250,
      waitBetweenCyclesMs: 125,
    }, { trustedRepoRoot: repoRoot, durableStore: store, enableMutation: true });
    const persisted = await createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" }).load();

    assert.equal(persisted?.activeOperationHistory.length, 1);
    assert.equal(persisted?.activeOperationHistory[0]?.sessionId, report.sessionId);
    assert.equal(persisted?.totalCycleCount, 2);
    assert.ok((persisted?.checkpointHistory.length ?? 0) >= report.checkpointCount);
    assert.equal(persisted?.latestExecutionStatus, "active_operation_completed");
  });
});

test("unapproved continuation is blocked before active operation starts", async () => {
  await withTempRepo(async (repoRoot, storageRoot) => {
    const store = createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" });
    const unapproved = { ...request("blocked-cycle-2", "blocked\n"), approvalStatus: "pending" as const };
    const report = await runRealLongDurationActiveOperation({
      sessionId: "active-session-blocked",
      projectId: "AI-E",
      cycleRequests: [request("blocked-cycle-1", "approved\n"), unapproved],
      minimumRealElapsedMs: 200,
      waitBetweenCyclesMs: 100,
    }, { trustedRepoRoot: repoRoot, durableStore: store, enableMutation: true });

    assert.equal(report.runtimeTruthfulnessLabel, "blocked_no_active_operation");
    assert.equal(report.cycleCount, 0);
    assert.equal(report.operatorApprovedContinuation, false);
    assert.equal(report.independentExclusiveExecutionStatus, "not_real");
    assert.match(report.blockedReason ?? "", /explicitly operator-approved/);
  });
});