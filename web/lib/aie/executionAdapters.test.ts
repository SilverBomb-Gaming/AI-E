import assert from "node:assert/strict";
import test from "node:test";

import {
  executeWithAdapter,
  selectExecutionAdapter,
  summarizeExecutionAdapterContext,
} from "./executionAdapters";
import type { ExecutionActionPreview } from "./types";

function makeAction(
  type: ExecutionActionPreview["type"],
  sourceActionType: NonNullable<ExecutionActionPreview["metadata"]["sourceActionType"]>,
): ExecutionActionPreview {
  return {
    id: `${type}-action`,
    type,
    scope: type === "file-write" ? "caution" : "safe",
    description: `Run ${type}`,
    expectedOutcome: "The bounded runtime should complete this action.",
    requiresApproval: true,
    metadata:
      type === "file-write"
        ? {
            sourceActionType,
            targetPath: "web/sandbox/adapter-test.txt",
            allowedRoot: "web/sandbox",
            content: "adapter test",
          }
        : type === "test-run"
          ? {
              sourceActionType,
              testTarget: "core",
            }
          : {
              sourceActionType,
            },
  };
}

test("selectExecutionAdapter routes actions to the expected adapter families", () => {
  assert.equal(selectExecutionAdapter(makeAction("inspection", "inspection"), { runtimeMode: "web" })?.id, "web-sandbox");
  assert.equal(selectExecutionAdapter(makeAction("inspection", "inspection"), { runtimeMode: "headless" })?.id, "headless-local");
  assert.equal(selectExecutionAdapter(makeAction("file-write", "file-write"), { runtimeMode: "web" })?.id, "repo-filesystem");
  assert.equal(selectExecutionAdapter(makeAction("test-run", "test-run"), { runtimeMode: "headless" })?.id, "repo-tests");
});

test("selectExecutionAdapter returns null for unsupported actions", () => {
  const action: ExecutionActionPreview = {
    id: "unsupported",
    type: "unknown",
    scope: "dangerous",
    description: "Do something unsafe.",
    expectedOutcome: "This should be blocked.",
    requiresApproval: true,
    metadata: {
      sourceActionType: "unknown",
    },
  };

  assert.equal(selectExecutionAdapter(action, { runtimeMode: "web" }), null);
});

test("executeWithAdapter dispatches through the selected adapter and reports context summary", async () => {
  const execution = await executeWithAdapter(makeAction("validation-check", "validation-check"), {
    runtimeMode: "headless",
    cwd: process.cwd(),
  });

  assert.equal(execution.adapter.id, "headless-local");
  assert.equal(execution.result.status, "success");
  assert.match(execution.contextSummary, /adapter=headless-local/i);
  assert.equal(summarizeExecutionAdapterContext(execution.adapter.id, { runtimeMode: "headless" }), "adapter=headless-local | mode=headless");
});

test("summarizeExecutionAdapterContext includes repo metadata for local execution nodes", () => {
  const summary = summarizeExecutionAdapterContext("repo-tests", {
    runtimeMode: "local",
    cwd: "E:/AI projects 2025/AI-E/web",
    repoRoot: "E:/AI projects 2025/AI-E",
    allowedDirectories: ["web/lib/aie"],
    adapterMetadata: {
      testTarget: "lib/aie/repoContext.test.ts",
      sourceActionType: "test-run",
    },
  });

  assert.match(summary, /mode=local/i);
  assert.match(summary, /repoRoot=/i);
  assert.match(summary, /dirs=web\/lib\/aie/i);
  assert.match(summary, /testTarget=lib\/aie\/repoContext.test.ts/i);
});