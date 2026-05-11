import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFileBackedDurableProjectMemoryStore } from "./durableProjectMemoryStore";
import { runMeaningfulLongRunSupervisedOperation } from "./meaningfulLongRunSupervisedOperation";
import { prepareOperatorWorkCycleRequest, type OperatorWorkCycleRequest } from "./operatorWorkCycleLauncher";

async function withTempRepo(run: (repoRoot: string, storageRoot: string) => Promise<void>) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aie-meaningful-long-run-"));
  try {
    await mkdir(path.join(repoRoot, "runner_artifacts/operator_work_cycle"), { recursive: true });
    await writeFile(path.join(repoRoot, "runner_artifacts/operator_work_cycle/latest_cycle_request.txt"), "before\n", "utf8");
    await run(repoRoot, path.join(repoRoot, ".aie", "durable_project_memory"));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

function request(cycleRequestId: string, content: string, approvalStatus: "approved" | "pending" = "approved"): OperatorWorkCycleRequest {
  return {
    ...prepareOperatorWorkCycleRequest({
      cycleRequestId,
      cycleIntent: "record meaningful long-run supervised operation progress",
      targetFiles: ["runner_artifacts/operator_work_cycle/latest_cycle_request.txt"],
      proposedChanges: [{ filePath: "runner_artifacts/operator_work_cycle/latest_cycle_request.txt", proposedContent: content }],
      rollbackPlan: "Restore the pre-cycle meaningful long-run artifact snapshot.",
      validationPlan: { commands: [] },
      retryLimit: 1,
      mutationScope: {
        approvedDirectories: ["runner_artifacts/operator_work_cycle"],
        approvedFiles: ["runner_artifacts/operator_work_cycle/latest_cycle_request.txt"],
      },
    }),
    approvalStatus,
  };
}

test("test-mode long-run session meets a short real elapsed target with periodic checkpoints", async () => {
  await withTempRepo(async (repoRoot, storageRoot) => {
    const store = createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" });
    const report = await runMeaningfulLongRunSupervisedOperation({
      sessionId: "meaningful-test-mode",
      projectId: "AI-E",
      mode: "test_mode",
      targetRuntimeMs: 900,
      checkpointIntervalMs: 200,
      approvedCycleRequests: [request("meaningful-cycle-1", "one\n"), request("meaningful-cycle-2", "two\n")],
      failureLimit: 2,
      meaningfulProofThresholdMs: 5 * 60 * 1000,
    }, { trustedRepoRoot: repoRoot, durableStore: store, enableMutation: true });

    assert.equal(report.phaseId, "MEANINGFUL_LONG_RUN_SUPERVISED_OPERATION_PHASE1");
    assert.equal(report.mode, "test_mode");
    assert.equal(report.targetRuntimeMet, true);
    assert.ok(report.actualRuntimeMs >= 900);
    assert.equal(report.cycleCount, 2);
    assert.ok(report.milestoneCount >= 12);
    assert.ok(report.checkpointCount >= 3);
    assert.equal(report.retryCount, 0);
    assert.equal(report.rollbackCount, 0);
    assert.equal(report.failureCount, 0);
    assert.equal(report.usefulWorkOccurred, true);
    assert.equal(report.meaningfulLongRunProof, false);
    assert.equal(report.truthfulnessLabel, "test_mode_real_elapsed");
    assert.equal(report.independentExclusiveExecutionStatus, "supervised_real");
    assert.equal(report.persistedToDurableMemory, true);
    console.log(`MEANINGFUL_LONG_RUN_TEST_REPORT ${JSON.stringify({ startedAt: report.startedAt, endedAt: report.endedAt, targetRuntimeMs: report.targetRuntimeMs, actualRuntimeMs: report.actualRuntimeMs, targetRuntimeMet: report.targetRuntimeMet, cycleCount: report.cycleCount, checkpointCount: report.checkpointCount, retryCount: report.retryCount, rollbackCount: report.rollbackCount, failureCount: report.failureCount, meaningfulLongRunProof: report.meaningfulLongRunProof })}`);
  });
});

test("long-run report persists into durable memory", async () => {
  await withTempRepo(async (repoRoot, storageRoot) => {
    const store = createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" });
    const report = await runMeaningfulLongRunSupervisedOperation({
      sessionId: "meaningful-persisted",
      projectId: "AI-E",
      mode: "test_mode",
      targetRuntimeMs: 350,
      checkpointIntervalMs: 125,
      approvedCycleRequests: [request("persisted-meaningful-cycle", "persisted\n")],
      failureLimit: 2,
      meaningfulProofThresholdMs: 5 * 60 * 1000,
    }, { trustedRepoRoot: repoRoot, durableStore: store, enableMutation: true });
    const persisted = await createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" }).load();

    assert.equal(persisted?.meaningfulLongRunHistory.length, 1);
    assert.equal(persisted?.meaningfulLongRunHistory[0]?.sessionId, report.sessionId);
    assert.equal(persisted?.meaningfulLongRunHistory[0]?.targetRuntimeMet, true);
    assert.ok((persisted?.meaningfulLongRunHistory[0]?.checkpointCount ?? 0) >= 2);
  });
});

test("unapproved cycle blocks before execution", async () => {
  await withTempRepo(async (repoRoot, storageRoot) => {
    const report = await runMeaningfulLongRunSupervisedOperation({
      sessionId: "meaningful-blocked-unapproved",
      projectId: "AI-E",
      mode: "test_mode",
      targetRuntimeMs: 200,
      checkpointIntervalMs: 100,
      approvedCycleRequests: [request("unapproved-cycle", "pending\n", "pending")],
      failureLimit: 2,
      meaningfulProofThresholdMs: 5 * 60 * 1000,
    }, { trustedRepoRoot: repoRoot, durableStore: createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" }), enableMutation: true });

    assert.equal(report.stopReason, "blocked_unapproved_cycle");
    assert.equal(report.cycleCount, 0);
    assert.equal(report.independentExclusiveExecutionStatus, "not_real");
    assert.match(report.blockedReason ?? "", /explicitly approved/);
  });
});

test("repeated blocked cycles stop safely on failure limit", async () => {
  await withTempRepo(async (repoRoot, storageRoot) => {
    const blockedOne = request("blocked-scope-1", "blocked one\n");
    const blockedTwo = request("blocked-scope-2", "blocked two\n");
    blockedOne.mutationScope.approvedFiles = ["runner_artifacts/operator_work_cycle/different.txt"];
    blockedTwo.mutationScope.approvedFiles = ["runner_artifacts/operator_work_cycle/different.txt"];
    const report = await runMeaningfulLongRunSupervisedOperation({
      sessionId: "meaningful-failure-limit",
      projectId: "AI-E",
      mode: "test_mode",
      targetRuntimeMs: 800,
      checkpointIntervalMs: 100,
      approvedCycleRequests: [blockedOne, blockedTwo],
      failureLimit: 2,
      meaningfulProofThresholdMs: 5 * 60 * 1000,
    }, { trustedRepoRoot: repoRoot, durableStore: createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" }), enableMutation: true });

    assert.equal(report.stopReason, "failure_limit_reached");
    assert.equal(report.failureCount, 2);
    assert.equal(report.targetRuntimeMet, false);
    assert.equal(report.meaningfulLongRunProof, false);
    assert.equal(report.truthfulnessLabel, "target_not_met");
  });
});