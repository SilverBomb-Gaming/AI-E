import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { buildExecutionAction } from "./executionBridge";
import { executeAction, isExecutableAction } from "./executionRuntime";

const REPO_ROOT = path.resolve(process.cwd(), "..");

test("execution runtime runs bounded inspections against repo files in read-only mode", async () => {
  const action = buildExecutionAction({
    proposedAction: "Inspect web/lib/aie/types.ts and summarize the file shape.",
    actionType: "inspection",
    expectedOutcome: "The bounded inspection should confirm the typed execution contract.",
  });

  assert.equal(isExecutableAction(action), true);

  const result = await executeAction(action);
  assert.equal(result.status, "success");
  assert.match(result.output ?? "", /Inspection completed in read-only mode/i);
  assert.match(result.output ?? "", /web\/lib\/aie\/types\.ts/i);
});

test("execution runtime runs bounded validation checks without shelling out", async () => {
  const action = buildExecutionAction({
    proposedAction: "Validate whether web/components/AnalysisResult.tsx exists before continuing.",
    actionType: "validation-check",
    expectedOutcome: "The dry-run validation should confirm the target file exists in the repo.",
  });

  assert.equal(isExecutableAction(action), true);

  const result = await executeAction(action);
  assert.equal(result.status, "success");
  assert.match(result.output ?? "", /Validation passed in dry-run mode/i);
  assert.match(result.output ?? "", /AnalysisResult\.tsx/i);
});

test("execution runtime blocks unsupported preview types", async () => {
  const action = buildExecutionAction({
    proposedAction: "Apply the smallest targeted code change.",
    actionType: "code-change",
    expectedOutcome: "The change should remove the conflicting same-frame write.",
  });

  assert.equal(isExecutableAction(action), false);

  const result = await executeAction(action);
  assert.equal(result.status, "blocked");
  assert.match(result.error ?? "", /unsupported action type/i);
});

test("execution runtime applies bounded sandbox file writes", async () => {
  const testDirectory = `web/sandbox/test-output-execution-runtime-${Date.now()}`;
  const targetPath = `${testDirectory}/execution-runtime.txt`;
  const absoluteTargetPath = path.resolve(REPO_ROOT, targetPath);

  try {
    const action = buildExecutionAction({
      proposedAction: `Create ${targetPath} with the text phase4b runtime validation.`,
      actionType: "file-write",
      expectedOutcome: "The sandbox validation file should exist after the bounded write.",
      metadata: {
        targetPath,
        allowedRoot: "web/sandbox",
        content: "phase4b runtime validation",
      },
    });

    assert.equal(isExecutableAction(action), true);

    const result = await executeAction(action);
    assert.equal(result.status, "success");
    assert.deepEqual(result.changedPaths, [targetPath]);
    assert.match(result.output ?? "", /Bounded file write applied/i);
    assert.equal(await readFile(absoluteTargetPath, "utf8"), "phase4b runtime validation");
  } finally {
    await rm(path.resolve(REPO_ROOT, testDirectory), { recursive: true, force: true });
  }
});