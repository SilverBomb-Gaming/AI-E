import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLiteEliteAgent, runLiteEliteAgentTask, type LiteEliteTaskContract } from "./liteEliteAgentRuntime";

async function withTempRepo(run: (repoRoot: string) => Promise<void>) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "aie-lite-agent-"));
  try {
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

function baseTask(overrides?: Partial<LiteEliteTaskContract>): LiteEliteTaskContract {
  return {
    taskId: "task-1",
    title: "Update bounded artifact",
    userGoal: "Update a scoped artifact safely.",
    repoScope: "runner_artifacts/lite_elite_agent",
    allowedPaths: ["runner_artifacts/lite_elite_agent"],
    forbiddenPaths: [".git", "node_modules"],
    expectedOutputs: ["updated artifact"],
    verificationCommands: ["git diff --name-only"],
    riskLevel: "low",
    requiresHumanApprovalBeforeWrite: false,
    filesToInspect: ["runner_artifacts/lite_elite_agent/notes.txt"],
    requestedChanges: [{ path: "runner_artifacts/lite_elite_agent/notes.txt", content: "updated\n" }],
    ...overrides,
  };
}

test("bounded executor writes only inside allowed paths", async () => {
  await withTempRepo(async (repoRoot) => {
    const target = path.join(repoRoot, "runner_artifacts/lite_elite_agent/notes.txt");
    await writeFile(target, "old\n", "utf8").catch(async () => {
      await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(target), { recursive: true }));
      await writeFile(target, "old\n", "utf8");
    });
    const agent = createLiteEliteAgent({ allowedPaths: ["runner_artifacts/lite_elite_agent"], allowedCommands: ["git diff --name-only"] });
    const result = await runLiteEliteAgentTask(agent, baseTask(), {
      repoRoot,
      commandRunner: async (command) => ({ command, exitCode: 0, stdout: "runner_artifacts/lite_elite_agent/notes.txt\n", stderr: "", skipped: false }),
      now: () => "2026-05-12T00:00:00.000Z",
    });

    assert.equal(result.summary.status, "completed");
    assert.deepEqual(result.summary.filesChanged, ["runner_artifacts/lite_elite_agent/notes.txt"]);
    assert.equal(await readFile(target, "utf8"), "updated\n");
  });
});

test("blocked paths and task scope expansion are rejected", async () => {
  await withTempRepo(async (repoRoot) => {
    const agent = createLiteEliteAgent({ allowedPaths: ["runner_artifacts/lite_elite_agent"], blockedPaths: ["README.md", ".git"] });
    const result = await runLiteEliteAgentTask(agent, baseTask({
      allowedPaths: ["README.md"],
      requestedChanges: [{ path: "README.md", content: "bad\n" }],
      filesToInspect: ["README.md"],
    }), { repoRoot, now: () => "2026-05-12T00:00:00.000Z" });

    assert.equal(result.summary.status, "blocked");
    assert.match(result.summary.unresolvedBlockers.join(" "), /blocked|outside allowed scope/i);
    assert.equal(result.summary.filesChanged.length, 0);
  });
});

test("max step limit blocks oversized executor loops", async () => {
  await withTempRepo(async (repoRoot) => {
    const agent = createLiteEliteAgent({ maxSteps: 3 });
    const result = await runLiteEliteAgentTask(agent, baseTask(), { repoRoot, now: () => "2026-05-12T00:00:00.000Z" });

    assert.equal(result.summary.status, "blocked");
    assert.match(result.summary.unresolvedBlockers.join(" "), /Max step limit/i);
    assert.equal(result.summary.filesChanged.length, 0);
  });
});

test("conflict detection prevents overwriting files changed after inspection", async () => {
  await withTempRepo(async (repoRoot) => {
    const target = path.join(repoRoot, "runner_artifacts/lite_elite_agent/notes.txt");
    await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(target), { recursive: true }));
    await writeFile(target, "old\n", "utf8");
    const agent = createLiteEliteAgent({ allowedPaths: ["runner_artifacts/lite_elite_agent"] });
    const result = await runLiteEliteAgentTask(agent, baseTask(), {
      repoRoot,
      onBeforeWrite: async () => {
        await writeFile(target, "external change\n", "utf8");
      },
      now: () => "2026-05-12T00:00:00.000Z",
    });

    assert.equal(result.summary.status, "blocked");
    assert.match(result.summary.unresolvedBlockers.join(" "), /Conflict detected/);
    assert.equal(await readFile(target, "utf8"), "external change\n");
    assert.equal(result.summary.filesChanged.length, 0);
  });
});

test("verification command reporting records command results", async () => {
  await withTempRepo(async (repoRoot) => {
    const target = path.join(repoRoot, "runner_artifacts/lite_elite_agent/notes.txt");
    await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(target), { recursive: true }));
    await writeFile(target, "old\n", "utf8");
    const agent = createLiteEliteAgent({ allowedCommands: ["npm test"] });
    const result = await runLiteEliteAgentTask(agent, baseTask({ verificationCommands: ["npm test"], requestedChanges: [] }), {
      repoRoot,
      commandRunner: async (command) => ({ command, exitCode: 1, stdout: "", stderr: "test failed", skipped: false }),
      now: () => "2026-05-12T00:00:00.000Z",
    });

    assert.equal(result.summary.status, "failed");
    assert.equal(result.summary.commandsRun[0]?.command, "npm test");
    assert.equal(result.summary.commandsRun[0]?.exitCode, 1);
    assert.match(result.summary.failures.join(" "), /Verification command failed/);
  });
});

test("approval-required tasks do not write without approval", async () => {
  await withTempRepo(async (repoRoot) => {
    const target = path.join(repoRoot, "runner_artifacts/lite_elite_agent/notes.txt");
    await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(target), { recursive: true }));
    await writeFile(target, "old\n", "utf8");
    const agent = createLiteEliteAgent();
    const result = await runLiteEliteAgentTask(agent, baseTask({ riskLevel: "medium", requiresHumanApprovalBeforeWrite: true }), {
      repoRoot,
      now: () => "2026-05-12T00:00:00.000Z",
    });

    assert.equal(result.summary.status, "awaiting_approval");
    assert.match(result.summary.unresolvedBlockers.join(" "), /Human approval is required/);
    assert.equal(await readFile(target, "utf8"), "old\n");
    assert.equal(result.summary.scaffoldStatus, "AIE_LITE_ELITE_AGENT_PHASE1_BLOCKED_NO_EXECUTION");
  });
});

test("truthful scaffold status rejects AGI or unattended claims", async () => {
  await withTempRepo(async (repoRoot) => {
    const agent = createLiteEliteAgent();
    const result = await runLiteEliteAgentTask(agent, baseTask({ requestedChanges: [], verificationCommands: [] }), {
      repoRoot,
      now: () => "2026-05-12T00:00:00.000Z",
    });

    assert.equal(result.summary.scaffoldStatus, "AIE_LITE_ELITE_AGENT_PHASE1_REAL_BOUNDED_EXECUTOR");
    assert.match(result.summary.truthfulCapabilityBoundary, /bounded local executor/i);
    assert.doesNotMatch(result.summary.truthfulCapabilityBoundary, /fully autonomous|AGI|unattended indefinitely/i);
  });
});
