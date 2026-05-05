import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { ControlledExecutionDiff } from "./controlledPatchExecutor";
import { executePostPlaytestFix } from "./postPlaytestExecutor";
import type { PostPlaytestExecutionPlanResult } from "./postPlaytestExecutionEngine";

const REPO_ROOT = path.resolve(process.cwd(), "..");

function createExecutionPlan(overrides: Partial<PostPlaytestExecutionPlanResult> = {}): PostPlaytestExecutionPlanResult {
  return {
    status: "execution_ready",
    reason: "A bounded controlled-action envelope is ready for operator approval.",
    proposed_actions: ["Apply the smallest safe fix to the failing Unity script."],
    allowed_file_scopes: ["web/sandbox"],
    max_changed_files: 2,
    max_retry_count: 1,
    requires_operator_approval: true,
    confidence: "high",
    source_feature: "enemy-health",
    source_outcome_session_key: "session-1",
    ...overrides,
  };
}

async function createSandboxFile(prefix: string, content = "before\n") {
  const sandboxParent = path.join(REPO_ROOT, "web", "sandbox");
  await mkdir(sandboxParent, { recursive: true });
  const absoluteRoot = await mkdtemp(path.join(sandboxParent, `${prefix}-`));
  const relativeRoot = path.relative(REPO_ROOT, absoluteRoot).split(path.sep).join("/");
  const absoluteFile = path.join(absoluteRoot, "target.txt");
  await writeFile(absoluteFile, content, "utf8");

  return {
    absoluteRoot,
    relativeRoot,
    filePath: `${relativeRoot}/target.txt`,
    async cleanup() {
      await rm(absoluteRoot, { recursive: true, force: true });
    },
  };
}

function createUpdate(filePath: string, afterSnapshot = "after\n"): ControlledExecutionDiff {
  return {
    file_path: filePath,
    change_type: "update",
    after_snapshot: afterSnapshot,
    summary_of_change: "Apply the smallest safe reviewed fix.",
  };
}

test("no approval yields operator_approval_required", async () => {
  const sandbox = await createSandboxFile("post-playtest-no-approval");
  try {
    const result = await executePostPlaytestFix({
      execution_plan: createExecutionPlan({ allowed_file_scopes: [sandbox.relativeRoot] }),
      operator_approval: false,
      retry_count: 0,
      file_changes: [createUpdate(sandbox.filePath)],
      rerun_validation: async () => ({ completed: true, succeeded: true, reason: "clean" }),
    });

    assert.equal(result.status, "operator_approval_required");
    assert.equal(result.validation_rerun_requested, false);
  } finally {
    await sandbox.cleanup();
  }
});

test("no_action_needed yields no_action_needed", async () => {
  const result = await executePostPlaytestFix({
    execution_plan: createExecutionPlan({
      status: "no_action_needed",
      reason: "No fix is needed.",
      max_changed_files: 0,
      max_retry_count: 0,
      requires_operator_approval: false,
      allowed_file_scopes: [],
    }),
    operator_approval: false,
    retry_count: 0,
    file_changes: [],
  });

  assert.equal(result.status, "no_action_needed");
});

test("execution_ready with approval yields executed", async () => {
  const sandbox = await createSandboxFile("post-playtest-executed");
  try {
    const result = await executePostPlaytestFix({
      execution_plan: createExecutionPlan({ allowed_file_scopes: [sandbox.relativeRoot] }),
      operator_approval: true,
      retry_count: 0,
      file_changes: [createUpdate(sandbox.filePath)],
      rerun_validation: async () => ({ completed: true, succeeded: true, reason: "reviewed rerun passed" }),
    });

    assert.equal(result.status, "executed");
    assert.equal(result.retry_count, 1);
    assert.equal(result.validation_rerun_requested, true);
    assert.equal(result.validation_rerun_completed, true);
    assert.equal(result.followup_learning_required, true);
    assert.equal(await readFile(path.join(sandbox.absoluteRoot, "target.txt"), "utf8"), "after\n");
  } finally {
    await sandbox.cleanup();
  }
});

test("outside file scope yields blocked", async () => {
  const sandbox = await createSandboxFile("post-playtest-outside-scope");
  try {
    const result = await executePostPlaytestFix({
      execution_plan: createExecutionPlan({ allowed_file_scopes: ["web/sandbox/other-root"] }),
      operator_approval: true,
      retry_count: 0,
      file_changes: [createUpdate(sandbox.filePath)],
      rerun_validation: async () => ({ completed: true, succeeded: true, reason: "clean" }),
    });

    assert.equal(result.status, "blocked");
    assert.match(result.reason, /outside the approved file scopes/i);
  } finally {
    await sandbox.cleanup();
  }
});

test("exceeds max files yields blocked", async () => {
  const first = await createSandboxFile("post-playtest-max-files-1");
  const second = await createSandboxFile("post-playtest-max-files-2");
  const third = await createSandboxFile("post-playtest-max-files-3");
  try {
    const result = await executePostPlaytestFix({
      execution_plan: createExecutionPlan({
        allowed_file_scopes: ["web/sandbox"],
        max_changed_files: 2,
      }),
      operator_approval: true,
      retry_count: 0,
      file_changes: [createUpdate(first.filePath), createUpdate(second.filePath), createUpdate(third.filePath)],
      rerun_validation: async () => ({ completed: true, succeeded: true, reason: "clean" }),
    });

    assert.equal(result.status, "blocked");
    assert.match(result.reason, /allowed file budget/i);
  } finally {
    await first.cleanup();
    await second.cleanup();
    await third.cleanup();
  }
});

test("retry count exceeded yields retry_limit_reached", async () => {
  const sandbox = await createSandboxFile("post-playtest-retry-limit");
  try {
    const result = await executePostPlaytestFix({
      execution_plan: createExecutionPlan({ allowed_file_scopes: [sandbox.relativeRoot], max_retry_count: 1 }),
      operator_approval: true,
      retry_count: 1,
      file_changes: [createUpdate(sandbox.filePath)],
      rerun_validation: async () => ({ completed: true, succeeded: true, reason: "clean" }),
    });

    assert.equal(result.status, "retry_limit_reached");
  } finally {
    await sandbox.cleanup();
  }
});

test("execution failure restores snapshot and yields rolled_back", async () => {
  const sandbox = await createSandboxFile("post-playtest-rollback");
  try {
    const result = await executePostPlaytestFix({
      execution_plan: createExecutionPlan({ allowed_file_scopes: [sandbox.relativeRoot] }),
      operator_approval: true,
      retry_count: 0,
      file_changes: [createUpdate(sandbox.filePath)],
      rerun_validation: async () => ({ completed: true, succeeded: false, reason: "Reviewed Unity validation rerun failed after the guarded fix." }),
    });

    assert.equal(result.status, "rolled_back");
    assert.equal(await readFile(path.join(sandbox.absoluteRoot, "target.txt"), "utf8"), "before\n");
  } finally {
    await sandbox.cleanup();
  }
});

test("no infinite retry behavior reruns nothing after limit is reached", async () => {
  const sandbox = await createSandboxFile("post-playtest-no-loop");
  let rerunCalls = 0;

  try {
    const result = await executePostPlaytestFix({
      execution_plan: createExecutionPlan({ allowed_file_scopes: [sandbox.relativeRoot], max_retry_count: 1 }),
      operator_approval: true,
      retry_count: 1,
      file_changes: [createUpdate(sandbox.filePath)],
      rerun_validation: async () => {
        rerunCalls += 1;
        return { completed: true, succeeded: true, reason: "clean" };
      },
    });

    assert.equal(result.status, "retry_limit_reached");
    assert.equal(rerunCalls, 0);
  } finally {
    await sandbox.cleanup();
  }
});