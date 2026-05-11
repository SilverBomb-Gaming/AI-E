import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFileBackedDurableProjectMemoryStore, createInitialDurableProjectRuntimeState } from "./durableProjectMemoryStore";
import { interruptOperatorWorkCycle, launchOperatorWorkCycle, prepareOperatorWorkCycleRequest } from "./operatorWorkCycleLauncher";

async function withTempRepo(run: (repoRoot: string, storageRoot: string) => Promise<void>) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aie-durable-runtime-"));
  try {
    await mkdir(path.join(repoRoot, "runner_artifacts/operator_work_cycle"), { recursive: true });
    await writeFile(path.join(repoRoot, "runner_artifacts/operator_work_cycle/latest_cycle_request.txt"), "before\n", "utf8");
    await run(repoRoot, path.join(repoRoot, ".aie", "durable_project_memory"));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

function request(cycleRequestId: string, content = "after\n") {
  return prepareOperatorWorkCycleRequest({
    cycleRequestId,
    cycleIntent: "record durable multi-cycle runtime progress",
    targetFiles: ["runner_artifacts/operator_work_cycle/latest_cycle_request.txt"],
    proposedChanges: [{ filePath: "runner_artifacts/operator_work_cycle/latest_cycle_request.txt", proposedContent: content }],
    rollbackPlan: "Restore the pre-cycle artifact snapshot.",
    validationPlan: { commands: [] },
    retryLimit: 1,
    mutationScope: {
      approvedDirectories: ["runner_artifacts/operator_work_cycle"],
      approvedFiles: ["runner_artifacts/operator_work_cycle/latest_cycle_request.txt"],
    },
  });
}

test("durable save and load persists project runtime state", async () => {
  await withTempRepo(async (_repoRoot, storageRoot) => {
    const store = createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" });
    const state = createInitialDurableProjectRuntimeState("AI-E", () => "2026-05-11T10:00:00.000Z");
    await store.save({ ...state, latestExecutionStatus: "saved_for_test" });
    const loaded = await store.load();

    assert.equal(loaded?.projectId, "AI-E");
    assert.equal(loaded?.latestExecutionStatus, "saved_for_test");
    assert.match(await readFile(store.stateFilePath, "utf8"), /DURABLE_PROJECT_MEMORY_AND_MULTI_CYCLE_RUNTIME_PHASE1/);
  });
});

test("operator cycle recording survives store recreation", async () => {
  await withTempRepo(async (repoRoot, storageRoot) => {
    const launched = await launchOperatorWorkCycle({ ...request("cycle-1"), approvalStatus: "approved" }, { trustedRepoRoot: repoRoot, enableMutation: true });
    await createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" }).recordOperatorCycle(launched);
    const recreatedStore = createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" });
    const restored = await recreatedStore.restoreRuntimeContinuity(() => "2026-05-11T10:01:00.000Z");

    assert.equal(restored.durableRestorationOccurred, true);
    assert.equal(restored.runtimeContinuitySurvivedRestart, true);
    assert.equal(restored.totalCycleCount, 1);
    assert.equal(restored.cycleCountResumed, 1);
    assert.equal(restored.independentExclusiveExecutionStatus, "supervised_real");
    assert.equal(restored.persistenceBoundary, "local_json_file");
  });
});

test("checkpoint recovery is reported from durable state", async () => {
  await withTempRepo(async (repoRoot, storageRoot) => {
    const launched = await launchOperatorWorkCycle({ ...request("cycle-checkpoint"), approvalStatus: "approved" }, { trustedRepoRoot: repoRoot, enableMutation: true });
    await createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" }).recordOperatorCycle(launched);
    const restored = await createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" }).restoreRuntimeContinuity();

    assert.equal(restored.checkpointRecoveryOccurred, true);
    assert.ok(restored.checkpointCountRestored >= 1);
    assert.match(restored.summary, /checkpoint/);
  });
});

test("previous campaign interruption can be restored truthfully", async () => {
  await withTempRepo(async (_repoRoot, storageRoot) => {
    const interrupted = interruptOperatorWorkCycle(request("cycle-interrupted"), "Power loss interrupted the supervised cycle.");
    const store = createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" });
    await store.recordInterruption(interrupted, "Power loss interrupted the supervised cycle.");
    const restored = await createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" }).restoreRuntimeContinuity();

    assert.equal(restored.interruptionRecoveryOccurred, true);
    assert.equal(restored.durableRestorationOccurred, true);
    assert.equal(restored.independentExclusiveExecutionStatus, "not_real");
    assert.equal(restored.runtimeTruthfulnessLabel, "restored_summary_only");
    assert.doesNotMatch(restored.summary, /autonomous_real execution is available|unattended background agent is running/i);
  });
});

test("multi-cycle chaining records previous cycle references and cumulative runtime", async () => {
  await withTempRepo(async (repoRoot, storageRoot) => {
    const store = createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" });
    const first = await launchOperatorWorkCycle({ ...request("cycle-a", "after-a\n"), approvalStatus: "approved" }, { trustedRepoRoot: repoRoot, enableMutation: true });
    const second = await launchOperatorWorkCycle({ ...request("cycle-b", "after-b\n"), approvalStatus: "approved" }, { trustedRepoRoot: repoRoot, enableMutation: true });
    await store.recordOperatorCycle(first);
    const chained = await store.recordOperatorCycle(second, first.cycleRequestId);

    assert.equal(chained.totalCycleCount, 2);
    assert.deepEqual(chained.previousCycleReferences.map((entry) => entry.cycleId), ["cycle-a", "cycle-b"]);
    assert.equal(chained.previousCycleReferences[1]?.previousCycleId, "cycle-a");
    assert.equal(chained.independentExclusiveExecutionStatus, "supervised_real");
    assert.ok(chained.cumulativeRuntimeMs >= 0);
  });
});

test("missing durable state does not fake persistence or autonomy", async () => {
  await withTempRepo(async (_repoRoot, storageRoot) => {
    const restored = await createFileBackedDurableProjectMemoryStore({ storageRoot, projectId: "AI-E" }).restoreRuntimeContinuity();

    assert.equal(restored.durableRestorationOccurred, false);
    assert.equal(restored.runtimeContinuitySurvivedRestart, false);
    assert.equal(restored.independentExclusiveExecutionStatus, "not_real");
    assert.equal(restored.runtimeTruthfulnessLabel, "no_durable_state_found");
    assert.match(restored.blockedReason ?? "", /No local durable runtime state/);
  });
});