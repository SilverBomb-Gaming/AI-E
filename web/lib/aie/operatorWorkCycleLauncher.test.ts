import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { interruptOperatorWorkCycle, launchOperatorWorkCycle, prepareOperatorWorkCycleRequest, restoreOperatorWorkCycleCheckpoint } from "./operatorWorkCycleLauncher";

async function withTempRepo(run: (repoRoot: string) => Promise<void>) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aie-operator-cycle-"));
  try {
    await mkdir(path.join(repoRoot, "runner_artifacts/operator_work_cycle"), { recursive: true });
    await writeFile(path.join(repoRoot, "runner_artifacts/operator_work_cycle/latest_cycle_request.txt"), "before\n", "utf8");
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

function request() {
  return prepareOperatorWorkCycleRequest({
    cycleRequestId: "operator-cycle-1",
    cycleIntent: "record bounded operator cycle progress",
    targetFiles: ["runner_artifacts/operator_work_cycle/latest_cycle_request.txt"],
    proposedChanges: [{ filePath: "runner_artifacts/operator_work_cycle/latest_cycle_request.txt", proposedContent: "after\n" }],
    rollbackPlan: "Restore the pre-cycle artifact snapshot.",
    validationPlan: { commands: [] },
    retryLimit: 1,
    mutationScope: {
      approvedDirectories: ["runner_artifacts/operator_work_cycle"],
      approvedFiles: ["runner_artifacts/operator_work_cycle/latest_cycle_request.txt"],
    },
  });
}

test("launches a bounded work cycle from operator flow", async () => {
  await withTempRepo(async (repoRoot) => {
    const approved = { ...request(), approvalStatus: "approved" as const };
    const launched = await launchOperatorWorkCycle(approved, { trustedRepoRoot: repoRoot, enableMutation: true });

    assert.equal(await readFile(path.join(repoRoot, "runner_artifacts/operator_work_cycle/latest_cycle_request.txt"), "utf8"), "after\n");
    assert.equal(launched.summaryReport?.phaseId, "OPERATOR_WORK_CYCLE_LAUNCHER_PHASE1");
    assert.equal(launched.summaryReport?.runtimeExecutedThroughOperatorWorkflow, true);
    assert.equal(launched.summaryReport?.independentExclusiveExecutionStatus, "supervised_real");
    assert.equal(launched.summaryReport?.truthfulnessLabel, "operator_workflow_executed");
    assert.ok((launched.summaryReport?.operationalStageCount ?? 0) >= 6);
    assert.ok((launched.summaryReport?.checkpointCount ?? 0) >= 2);
  });
});

test("approval is required before launch", async () => {
  await withTempRepo(async (repoRoot) => {
    const launched = await launchOperatorWorkCycle(request(), { trustedRepoRoot: repoRoot, enableMutation: true });

    assert.equal(launched.cycleStatus, "awaiting_approval");
    assert.equal(launched.summaryReport?.independentExclusiveExecutionStatus, "not_real");
    assert.equal(launched.summaryReport?.runtimeExecutedThroughOperatorWorkflow, false);
    assert.equal(await readFile(path.join(repoRoot, "runner_artifacts/operator_work_cycle/latest_cycle_request.txt"), "utf8"), "before\n");
  });
});

test("disabled runtime reports partial operator workflow without fake mutation", async () => {
  await withTempRepo(async (repoRoot) => {
    const approved = { ...request(), approvalStatus: "approved" as const };
    const launched = await launchOperatorWorkCycle(approved, { trustedRepoRoot: repoRoot, enableMutation: false });

    assert.equal(launched.summaryReport?.runtimeExecutedThroughOperatorWorkflow, true);
    assert.equal(launched.summaryReport?.independentExclusiveExecutionStatus, "partial");
    assert.equal(launched.summaryReport?.truthfulnessLabel, "operator_workflow_partial");
    assert.equal(await readFile(path.join(repoRoot, "runner_artifacts/operator_work_cycle/latest_cycle_request.txt"), "utf8"), "before\n");
  });
});

test("checkpoint restoration reports restorable cycle state", async () => {
  await withTempRepo(async (repoRoot) => {
    const approved = { ...request(), approvalStatus: "approved" as const, cycleRequestId: "operator-cycle-restore" };
    const launched = await launchOperatorWorkCycle(approved, { trustedRepoRoot: repoRoot, enableMutation: true });
    const restored = restoreOperatorWorkCycleCheckpoint(launched.cycleRequestId);

    assert.equal(restored?.cycleStatus, "restored");
    assert.equal(restored?.currentStage, "checkpoint");
    assert.ok((restored?.checkpointCount ?? 0) >= 1);
    assert.match(restored?.summary ?? "", /Restored checkpoint/);
  });
});

test("interrupted cycle reports interruption without fake execution", () => {
  const interrupted = interruptOperatorWorkCycle(request(), "Operator paused the cycle before launch.");

  assert.equal(interrupted.cycleStatus, "interrupted");
  assert.equal(interrupted.summaryReport?.independentExclusiveExecutionStatus, "not_real");
  assert.equal(interrupted.summaryReport?.runtimeExecutedThroughOperatorWorkflow, false);
  assert.match(interrupted.summaryReport?.summary ?? "", /Operator paused/);
});

test("retry limits are enforced by operator launcher", async () => {
  await withTempRepo(async (repoRoot) => {
    const tooWide = { ...request(), approvalStatus: "approved" as const, retryLimit: 5 };
    const launched = await launchOperatorWorkCycle(tooWide, { trustedRepoRoot: repoRoot, enableMutation: true });

    assert.equal(launched.cycleStatus, "blocked");
    assert.equal(launched.summaryReport?.independentExclusiveExecutionStatus, "not_real");
    assert.match(launched.summaryReport?.blockedState ?? "", /Retry limit/);
  });
});