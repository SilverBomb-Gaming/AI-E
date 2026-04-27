import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { runFileWrite } from "./executionHandlers/runFileWrite";
import type { ExecutionActionPreview } from "./types";

const REPO_ROOT = path.resolve(process.cwd(), "..");

function makeAction(targetPath: string, content: string, scope: ExecutionActionPreview["scope"] = "safe"): ExecutionActionPreview {
  return {
    id: `file-write-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "file-write",
    scope,
    description: `Write ${targetPath}`,
    expectedOutcome: "The bounded file write should update only the requested sandbox file.",
    requiresApproval: true,
    metadata: {
      sourceActionType: "file-write",
      targetPath,
      allowedRoot: "web/sandbox",
      content,
    },
  };
}

test("runFileWrite creates and then overwrites a bounded sandbox file with rollback metadata", async () => {
  const testDirectory = `web/sandbox/test-output-run-file-write-${Date.now()}`;
  const targetPath = `${testDirectory}/run-file-write.txt`;
  const absoluteTargetPath = path.resolve(REPO_ROOT, targetPath);

  try {
    const createResult = await runFileWrite(makeAction(targetPath, "phase4b-create"));
    assert.equal(createResult.status, "success");
    assert.deepEqual(createResult.changedPaths, [targetPath]);
    assert.equal(createResult.rollback, undefined);
    assert.match(createResult.diffSummary ?? "", /Created new file/i);
    assert.equal(await readFile(absoluteTargetPath, "utf8"), "phase4b-create");

    const overwriteResult = await runFileWrite(makeAction(targetPath, "phase4b-overwrite"));
    assert.equal(overwriteResult.status, "success");
    assert.deepEqual(overwriteResult.changedPaths, [targetPath]);
    assert.match(overwriteResult.diffSummary ?? "", /Replaced file contents/i);
    assert.equal(overwriteResult.rollback?.targetPath, targetPath);
    assert.equal(overwriteResult.rollback?.previousContent, "phase4b-create");
    assert.equal(await readFile(absoluteTargetPath, "utf8"), "phase4b-overwrite");
  } finally {
    await rm(path.resolve(REPO_ROOT, testDirectory), { recursive: true, force: true });
  }
});

test("runFileWrite blocks patch-only writes and writes outside the allowed root", async () => {
  const patchOnlyResult = await runFileWrite({
    id: "patch-only",
    type: "file-write",
    scope: "safe",
    description: "Patch the sandbox file.",
    expectedOutcome: "The file should update.",
    requiresApproval: true,
    metadata: {
      sourceActionType: "file-write",
      targetPath: "web/sandbox/patch-only.txt",
      allowedRoot: "web/sandbox",
      patch: "-old\n+new",
    },
  });

  assert.equal(patchOnlyResult.status, "blocked");
  assert.match(patchOnlyResult.error ?? "", /patch-only/i);

  const outsideRootResult = await runFileWrite({
    id: "outside-root",
    type: "file-write",
    scope: "caution",
    description: "Write outside the sandbox.",
    expectedOutcome: "This should be blocked.",
    requiresApproval: true,
    metadata: {
      sourceActionType: "file-write",
      targetPath: "web/package.json",
      allowedRoot: "web/sandbox",
      content: "blocked",
    },
  });

  assert.equal(outsideRootResult.status, "blocked");
  assert.match(outsideRootResult.error ?? "", /approved execution roots/i);
});