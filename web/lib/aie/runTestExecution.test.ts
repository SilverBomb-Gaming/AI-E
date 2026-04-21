import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { resolveTestCommand, runTestExecution } from "./executionHandlers/runTestExecution";
import type { ExecutionActionPreview } from "./types";

function makeAction(testTarget: string): ExecutionActionPreview {
  return {
    id: `test-run-${testTarget}`,
    type: "test-run",
    scope: "safe",
    description: `Run ${testTarget}`,
    expectedOutcome: "The bounded test target should report a healthy result.",
    requiresApproval: true,
    metadata: {
      sourceActionType: "test-run",
      testTarget,
    },
  };
}

test("resolveTestCommand maps the bounded test targets", async () => {
  assert.equal((await resolveTestCommand(makeAction("core")))?.label, "npm test");
  assert.equal((await resolveTestCommand(makeAction("trace")))?.label, "npm run test:trace");
  assert.equal((await resolveTestCommand(makeAction("build")))?.label, "npm run build");
});

test("runTestExecution returns success metadata for whitelisted targets", async () => {
  const result = await runTestExecution(makeAction("core"), {
    execCommand: async (config) => ({
      stdout: `${config.label} passed`,
      stderr: "",
      exitCode: 0,
    }),
  });

  assert.equal(result.status, "success");
  assert.equal(result.commandLabel, "npm test");
  assert.equal(result.exitCode, 0);
  assert.match(result.output ?? "", /passed/i);
});

test("runTestExecution returns failure metadata and blocks unknown targets", async () => {
  const failedResult = await runTestExecution(makeAction("trace"), {
    execCommand: async (config) => ({
      stdout: "",
      stderr: `${config.label} failed`,
      exitCode: 1,
    }),
  });

  assert.equal(failedResult.status, "failed");
  assert.equal(failedResult.commandLabel, "npm run test:trace");
  assert.equal(failedResult.exitCode, 1);
  assert.match(failedResult.error ?? "", /exited with code 1/i);

  const blockedResult = await runTestExecution(makeAction("lint"));
  assert.equal(blockedResult.status, "blocked");
  assert.match(blockedResult.error ?? "", /unsupported test target/i);
});

test("resolveTestCommand maps bounded specific test files inside the repo", async () => {
  const fixtureRoot = path.resolve(process.cwd(), "temp-run-test-execution");
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(path.join(fixtureRoot, "web", "lib", "aie"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "web", "lib", "aie", "retryPolicy.test.ts"), "export const ok = true;\n", "utf8");

  try {
    const config = await resolveTestCommand(makeAction("web/lib/aie/retryPolicy.test.ts"), {
      cwd: path.join(fixtureRoot, "web"),
      repoRoot: fixtureRoot,
    });

    assert.ok(config);
    assert.match(config?.label ?? "", /retryPolicy\.test\.ts/i);
    assert.match((config?.args ?? []).join(" "), /retryPolicy\.test\.ts/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});