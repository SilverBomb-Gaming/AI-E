import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSupervisedPatchRetry, rollbackScopedRepoPatch, runScopedRepoPatch, type PatchValidationResult, type ScopedRepoPatchRequest } from "./scopedRepoMutationRuntime";

async function withTempRepo(run: (repoRoot: string) => Promise<void>) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aie-patch-runtime-"));
  try {
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

function request(overrides: Partial<ScopedRepoPatchRequest> = {}): ScopedRepoPatchRequest {
  return {
    patchRequestId: "patch-1",
    targetFiles: [{ filePath: "src/example.ts", proposedContent: "export const value = 2;\n" }],
    patchIntent: "update example constant",
    proposedChangesSummary: "Change value from 1 to 2.",
    riskLevel: "LOW",
    requiresApproval: true,
    approvalStatus: "pending",
    rollbackPlan: "Restore the pre-mutation file snapshot.",
    validationPlan: { commands: ["npm test -- --example"] },
    mutationScope: {
      approvedDirectories: ["src"],
      approvedFiles: ["src/example.ts"],
    },
    patchStatus: "prepared",
    diffPreview: "",
    validationResults: [],
    mutationTruthfulnessLabel: "preview_only_no_mutation",
    ...overrides,
  };
}

function validation(status: PatchValidationResult["status"] = "passed"): PatchValidationResult {
  return {
    command: "npm test -- --example",
    status,
    stdout: status === "passed" ? "tests passed" : "tests failed",
    stderr: status === "passed" ? "" : "assertion failed",
    exitCode: status === "passed" ? 0 : 1,
    elapsedMs: 25,
    truthfulnessLabel: "real_validation_executed",
  };
}

async function seedFile(repoRoot: string, filePath: string, content: string): Promise<void> {
  const absolutePath = path.join(repoRoot, filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, { encoding: "utf8" });
}

test("approved patch application writes scoped file and validates", async () => {
  await withTempRepo(async (repoRoot) => {
    await seedFile(repoRoot, "src/example.ts", "export const value = 1;\n");

    const report = await runScopedRepoPatch(request(), {
      trustedRepoRoot: repoRoot,
      approvalStatus: "approved",
      approvedBy: "test-operator",
      enableMutation: true,
      validationRunner: async () => validation("passed"),
    });

    assert.equal(await readFile(path.join(repoRoot, "src/example.ts"), "utf8"), "export const value = 2;\n");
    assert.equal(report.phaseId, "SCOPED_REPO_MUTATION_AND_PATCH_RUNTIME_PHASE1");
    assert.equal(report.patchStatus, "validated");
    assert.equal(report.mutationTrulyExecuted, true);
    assert.equal(report.mutationTruthfulnessLabel, "real_mutation_validated");
    assert.match(report.diffPreview, /-export const value = 1;/);
    assert.match(report.diffPreview, /\+export const value = 2;/);
    assert.deepEqual(report.lifecycle.map((entry) => entry.patchStatus), ["prepared", "approved", "applying", "applied", "validating", "validated"]);
    assert.ok(report.completedMilestoneKinds.includes("mutation"));
    assert.ok(report.completedMilestoneKinds.includes("validation"));
  });
});

test("pending patch creates diff preview without mutation", async () => {
  await withTempRepo(async (repoRoot) => {
    await seedFile(repoRoot, "src/example.ts", "export const value = 1;\n");

    const report = await runScopedRepoPatch(request(), {
      trustedRepoRoot: repoRoot,
      approvalStatus: "pending",
      enableMutation: true,
    });

    assert.equal(report.patchStatus, "awaiting_approval");
    assert.equal(report.mutationTrulyExecuted, false);
    assert.equal(report.mutationTruthfulnessLabel, "preview_only_no_mutation");
    assert.equal(await readFile(path.join(repoRoot, "src/example.ts"), "utf8"), "export const value = 1;\n");
    assert.match(report.diffPreview, /diff -- src\/example.ts/);
  });
});

test("blocked mutation outside approved scope does not write", async () => {
  await withTempRepo(async (repoRoot) => {
    await seedFile(repoRoot, "src/example.ts", "export const value = 1;\n");
    const unsafe = request({ targetFiles: [{ filePath: "other/example.ts", proposedContent: "changed\n" }] });

    const report = await runScopedRepoPatch(unsafe, {
      trustedRepoRoot: repoRoot,
      approvalStatus: "approved",
      enableMutation: true,
    });

    assert.equal(report.patchStatus, "blocked");
    assert.equal(report.mutationTrulyExecuted, false);
    assert.match(report.blockedReason ?? "", /not explicitly approved|outside approved directories/);
  });
});

test("lockfiles and credential paths are blocked unless explicitly safe", async () => {
  await withTempRepo(async (repoRoot) => {
    const lockfile = request({
      targetFiles: [{ filePath: "package-lock.json", proposedContent: "{}\n" }],
      mutationScope: { approvedDirectories: ["."], approvedFiles: ["package-lock.json"] },
    });
    const lockReport = await runScopedRepoPatch(lockfile, { trustedRepoRoot: repoRoot, approvalStatus: "approved", enableMutation: true });
    assert.equal(lockReport.patchStatus, "blocked");
    assert.match(lockReport.blockedReason ?? "", /Lockfile/);

    const secret = request({
      targetFiles: [{ filePath: "src/.env", proposedContent: "TOKEN=secret\n" }],
      mutationScope: { approvedDirectories: ["src"], approvedFiles: ["src/.env"] },
    });
    const secretReport = await runScopedRepoPatch(secret, { trustedRepoRoot: repoRoot, approvalStatus: "approved", enableMutation: true });
    assert.equal(secretReport.patchStatus, "blocked");
    assert.match(secretReport.blockedReason ?? "", /credential|secret/);
  });
});

test("rollback restores pre-mutation snapshot", async () => {
  await withTempRepo(async (repoRoot) => {
    await seedFile(repoRoot, "src/example.ts", "export const value = 1;\n");
    const applied = await runScopedRepoPatch(request(), {
      trustedRepoRoot: repoRoot,
      approvalStatus: "approved",
      enableMutation: true,
      validationRunner: async () => validation("passed"),
    });

    const rollback = await rollbackScopedRepoPatch(applied, {
      trustedRepoRoot: repoRoot,
      approvedFiles: ["src/example.ts"],
    });

    assert.equal(await readFile(path.join(repoRoot, "src/example.ts"), "utf8"), "export const value = 1;\n");
    assert.equal(rollback.patchStatus, "reverted");
    assert.equal(rollback.mutationTruthfulnessLabel, "real_mutation_reverted");
    assert.equal(rollback.rollbackAvailable, false);
    assert.ok(rollback.completedMilestoneKinds.includes("rollback"));
  });
});

test("validation failure is captured and allows supervised retry", async () => {
  await withTempRepo(async (repoRoot) => {
    await seedFile(repoRoot, "src/example.ts", "export const value = 1;\n");
    const failed = await runScopedRepoPatch(request(), {
      trustedRepoRoot: repoRoot,
      approvalStatus: "approved",
      enableMutation: true,
      validationRunner: async () => validation("failed"),
    });

    assert.equal(failed.patchStatus, "validation_failed");
    assert.equal(failed.retryAllowed, true);
    assert.equal(failed.validationResults[0]?.status, "failed");
    assert.equal(failed.validationResults[0]?.stderr, "assertion failed");

    const retry = createSupervisedPatchRetry(failed, "patch-retry-1", [{ filePath: "src/example.ts", proposedContent: "export const value = 3;\n" }]);
    assert.equal(retry.patchStatus, "retry_ready");
    assert.equal(retry.approvalStatus, "pending");
    assert.equal(retry.mutationTruthfulnessLabel, "retry_prepared_no_mutation");
  });
});

test("disabled mutation runtime does not fake file writes", async () => {
  await withTempRepo(async (repoRoot) => {
    await seedFile(repoRoot, "src/example.ts", "export const value = 1;\n");
    const report = await runScopedRepoPatch(request(), {
      trustedRepoRoot: repoRoot,
      approvalStatus: "approved",
      enableMutation: false,
    });

    assert.equal(report.patchStatus, "mutation_disabled");
    assert.equal(report.mutationTrulyExecuted, false);
    assert.equal(report.mutationTruthfulnessLabel, "mutation_disabled_no_write");
    assert.equal(await readFile(path.join(repoRoot, "src/example.ts"), "utf8"), "export const value = 1;\n");
  });
});