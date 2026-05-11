import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runIterativeAutonomousWorkCycle } from "./iterativeAutonomousWorkCycleRuntime";
import type { PatchValidationResult, ScopedRepoPatchRequest } from "./scopedRepoMutationRuntime";

async function withTempRepo(run: (repoRoot: string) => Promise<void>) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aie-cycle-runtime-"));
  try {
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await writeFile(path.join(repoRoot, "src/example.ts"), "export const value = 1;\n", "utf8");
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

function patch(overrides: Partial<ScopedRepoPatchRequest> = {}): ScopedRepoPatchRequest {
  return {
    patchRequestId: "cycle-patch-1",
    targetFiles: [{ filePath: "src/example.ts", proposedContent: "export const value = 2;\n" }],
    patchIntent: "update example value",
    proposedChangesSummary: "Change example value from 1 to 2.",
    riskLevel: "LOW",
    requiresApproval: true,
    approvalStatus: "approved",
    rollbackPlan: "Restore the pre-cycle file snapshot.",
    validationPlan: { commands: ["npm test -- --example"] },
    mutationScope: { approvedDirectories: ["src"], approvedFiles: ["src/example.ts"] },
    patchStatus: "prepared",
    diffPreview: "",
    validationResults: [],
    mutationTruthfulnessLabel: "preview_only_no_mutation",
    ...overrides,
  };
}

function validation(status: PatchValidationResult["status"]): PatchValidationResult {
  return {
    command: "npm test -- --example",
    status,
    stdout: status === "passed" ? "pass" : "fail",
    stderr: status === "failed" ? "assertion failed" : "",
    exitCode: status === "passed" ? 0 : 1,
    elapsedMs: 50,
    truthfulnessLabel: "real_validation_executed",
  };
}

function clock() {
  const times = [
    "2026-05-11T09:00:00.000Z",
    "2026-05-11T09:00:01.000Z",
    "2026-05-11T09:00:02.000Z",
    "2026-05-11T09:00:03.000Z",
    "2026-05-11T09:00:04.000Z",
    "2026-05-11T09:00:05.000Z",
    "2026-05-11T09:00:06.000Z",
    "2026-05-11T09:00:07.000Z",
    "2026-05-11T09:00:08.000Z",
    "2026-05-11T09:00:09.000Z",
    "2026-05-11T09:00:10.000Z",
    "2026-05-11T09:00:11.000Z",
    "2026-05-11T09:00:12.000Z",
    "2026-05-11T09:00:13.000Z",
    "2026-05-11T09:00:14.000Z",
    "2026-05-11T09:00:15.000Z",
    "2026-05-11T09:00:16.000Z",
  ];
  return () => times.shift() ?? "2026-05-11T09:00:16.000Z";
}

test("multi-stage work cycle executes inspect mutate validate checkpoint and summarize", async () => {
  await withTempRepo(async (repoRoot) => {
    const state = await runIterativeAutonomousWorkCycle({
      cycleId: "cycle-pass",
      activeWorkItem: "update example",
      initialPatchRequest: patch(),
      retryMode: "none",
      maxRetries: 0,
      checkpointAfterEachStage: true,
    }, {
      trustedRepoRoot: repoRoot,
      enableMutation: true,
      now: clock(),
      validationRunner: async () => validation("passed"),
    });

    assert.equal(await readFile(path.join(repoRoot, "src/example.ts"), "utf8"), "export const value = 2;\n");
    assert.equal(state.phaseId, "ITERATIVE_AUTONOMOUS_WORK_CYCLE_PHASE1");
    assert.equal(state.retryCount, 0);
    assert.equal(state.rollbackCount, 0);
    assert.equal(state.checkpointCount >= 3, true);
    assert.equal(state.continuationOccurred, true);
    assert.equal(state.iterativeLoopExecuted, false);
    assert.equal(state.longRunningClaimAllowed, false);
    assert.equal(state.mutationReports.length, 1);
    assert.match(state.mutationReports[0]?.diffPreview ?? "", /diff -- src\/example.ts/);
    assert.equal(state.mutationReports[0]?.validationResults[0]?.truthfulnessLabel, "real_validation_executed");
    assert.match(state.finalSummary, /Completed rapidly|do not describe this as a long-running campaign/i);
    assert.ok(state.completedStages.some((stage) => stage.stageKind === "inspect"));
    assert.ok(state.completedStages.some((stage) => stage.stageKind === "mutation"));
    assert.ok(state.completedStages.some((stage) => stage.stageKind === "validation"));
    assert.ok(state.completedStages.some((stage) => stage.stageKind === "summarize"));
  });
});

test("validation failure can route to rollback and supervised retry", async () => {
  await withTempRepo(async (repoRoot) => {
    let validationCall = 0;
    const state = await runIterativeAutonomousWorkCycle({
      cycleId: "cycle-retry",
      activeWorkItem: "retry example",
      initialPatchRequest: patch(),
      retryPatchRequest: patch({ patchRequestId: "cycle-patch-retry", proposedChangesSummary: "Retry value update.", targetFiles: [{ filePath: "src/example.ts", proposedContent: "export const value = 3;\n" }] }),
      retryMode: "supervised_retry",
      maxRetries: 1,
      rollbackOnValidationFailure: true,
    }, {
      trustedRepoRoot: repoRoot,
      enableMutation: true,
      now: clock(),
      validationRunner: async () => {
        validationCall += 1;
        return validation(validationCall === 1 ? "failed" : "passed");
      },
    });

    assert.equal(await readFile(path.join(repoRoot, "src/example.ts"), "utf8"), "export const value = 3;\n");
    assert.equal(state.retryCount, 1);
    assert.equal(state.rollbackCount, 1);
    assert.equal(state.iterativeLoopExecuted, true);
    assert.equal(state.retryHistory.length, 1);
    assert.equal(state.rollbackHistory.length, 1);
    assert.ok(state.failedStages.some((stage) => stage.stageKind === "validation"));
    assert.ok(state.completedStages.some((stage) => stage.stageKind === "retry" && stage.truthfulnessLabel === "supervised_retry"));
    assert.ok(state.completedStages.some((stage) => stage.stageKind === "rollback" && stage.truthfulnessLabel === "real_rollback_stage"));
  });
});

test("retry limit enforcement blocks retry without fake loop", async () => {
  await withTempRepo(async (repoRoot) => {
    const state = await runIterativeAutonomousWorkCycle({
      cycleId: "cycle-limit",
      activeWorkItem: "limit example",
      initialPatchRequest: patch(),
      retryMode: "supervised_retry",
      maxRetries: 0,
    }, {
      trustedRepoRoot: repoRoot,
      enableMutation: true,
      now: clock(),
      validationRunner: async () => validation("failed"),
    });

    assert.equal(state.retryCount, 0);
    assert.equal(state.iterativeLoopExecuted, false);
    assert.ok(state.completedStages.some((stage) => stage.stageKind === "retry" && stage.status === "blocked" && stage.truthfulnessLabel === "blocked_retry"));
  });
});

test("checkpoint persistence captures completed failed retry and rollback history", async () => {
  await withTempRepo(async (repoRoot) => {
    const state = await runIterativeAutonomousWorkCycle({
      cycleId: "cycle-checkpoint",
      activeWorkItem: "checkpoint example",
      initialPatchRequest: patch(),
      retryMode: "none",
      maxRetries: 0,
      rollbackOnValidationFailure: true,
    }, {
      trustedRepoRoot: repoRoot,
      enableMutation: true,
      now: clock(),
      validationRunner: async () => validation("failed"),
    });

    const lastCheckpoint = state.checkpoints.at(-1);
    assert.ok(lastCheckpoint);
    assert.equal(lastCheckpoint.rollbackCount, 1);
    assert.equal(lastCheckpoint.retryCount, 0);
    assert.ok(lastCheckpoint.failedStages.includes("validation"));
    assert.equal(lastCheckpoint.activeWorkItem, "checkpoint example");
    assert.match(lastCheckpoint.validationOutcomeSummary, /failed/);
  });
});

test("truthful runtime reporting does not fake long-running behavior for rapid cycles", async () => {
  await withTempRepo(async (repoRoot) => {
    const state = await runIterativeAutonomousWorkCycle({
      cycleId: "cycle-truth",
      activeWorkItem: "truth example",
      initialPatchRequest: patch(),
      retryMode: "none",
      maxRetries: 0,
    }, {
      trustedRepoRoot: repoRoot,
      enableMutation: true,
      now: clock(),
      validationRunner: async () => validation("passed"),
    });

    assert.equal(state.elapsedRuntimeMs < 60_000, true);
    assert.equal(state.longRunningClaimAllowed, false);
    assert.match(state.truthfulnessWarnings.join("\n"), /Do not claim long-running behavior/);
    assert.doesNotMatch(state.finalSummary, /across \d+h|long-running campaign completed/i);
  });
});