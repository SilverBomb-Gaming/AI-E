import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { executeControlledPatch } from "./controlledPatchExecutor";
import { evaluateCommitEligibility, summarizeCommitGate } from "./commitGate";
import { runControlledValidation } from "./controlledExecutionValidation";
import type { ReviewedPatchApplicationPacket } from "./reviewedPatchApplicationExecutor";

const REPO_ROOT = path.resolve(process.cwd(), "..");

async function createSandboxRoot(prefix: string): Promise<{ absoluteRoot: string; relativeRoot: string }> {
  const sandboxParent = path.join(REPO_ROOT, "web", "sandbox");
  await mkdir(sandboxParent, { recursive: true });
  const absoluteRoot = await mkdtemp(path.join(sandboxParent, `${prefix}-`));
  const relativeRoot = path.relative(REPO_ROOT, absoluteRoot).split(path.sep).join("/");
  return { absoluteRoot, relativeRoot };
}

function buildPacket(targets: string[], overrides: Partial<ReviewedPatchApplicationPacket> = {}): ReviewedPatchApplicationPacket {
  return {
    application_packet_id: "application-packet-20260425130000-commit-gate-test",
    source_draft_id: "patch-draft-commit-gate",
    source_decision_id: "decision-commit-gate",
    source_patch_plan_id: "patch-plan-commit-gate",
    source_dry_run_id: "dry-run-commit-gate",
    source_handoff_id: "handoff-commit-gate",
    source_artifact_id: "artifact-commit-gate",
    created_at: "2026-04-25T13:00:00.000Z",
    interpreted_goal: "Apply validated reviewed changes and decide whether commit is safe.",
    risk_level: "low",
    application_instructions: ["Stay inside the reviewed target.", "Apply only the approved diff."],
    affected_targets: [...targets],
    validation_requirements: [{ title: "Run focused tests", details: "Run the reviewed test slice.", required: true }],
    git_commit_plan: {
      commit_message: "feat(execution): add commit gate coverage",
      stage_only: [...targets],
      github_procedure: ["stage only reviewed files", "commit reviewed changes after approval"],
    },
    playtest_required: false,
    required_operator_review: true,
    human_approval_required: true,
    allowed_executor_actions: ["inspect target files", "apply reviewed file changes"],
    disallowed_executor_actions: ["apply patches automatically", "commit automatically", "push automatically", "deploy", "run destructive commands", "access secrets", "bypass validation"],
    completion_report_requirements: ["List changed files", "Record validation summary"],
    next_operator_action: "execution_ready_review",
    ...overrides,
  };
}

async function buildGateInput(prefix: string, options?: {
  packetOverrides?: Partial<ReviewedPatchApplicationPacket>;
  tamperFile?: boolean;
  validationCreatedAt?: string;
  gateCreatedAt?: string;
}) {
  const sandbox = await createSandboxRoot(prefix);
  const targetPath = `${sandbox.relativeRoot}/commit-gate.txt`;
  await writeFile(path.join(sandbox.absoluteRoot, "commit-gate.txt"), "before\n", "utf8");
  const applicationPacket = buildPacket([targetPath], options?.packetOverrides);
  const executionResult = await executeControlledPatch({
    applicationPacket,
    approval: true,
    fileChanges: [{
      file_path: targetPath,
      change_type: "update",
      after_snapshot: "after\n",
      summary_of_change: "Update the reviewed file for commit gating.",
    }],
    createdAt: "2026-04-25T13:10:00.000Z",
    allowedRoots: [sandbox.relativeRoot],
  });

  if (options?.tamperFile) {
    await writeFile(path.join(sandbox.absoluteRoot, "commit-gate.txt"), "tampered\n", "utf8");
  }

  const validationResult = await runControlledValidation({
    executionResult,
    applicationPacket,
    createdAt: options?.validationCreatedAt ?? "2026-04-25T13:20:00.000Z",
    allowedRoots: [sandbox.relativeRoot],
  });

  return {
    absoluteRoot: sandbox.absoluteRoot,
    targetPath,
    input: {
      validationResult,
      executionResult,
      applicationPacket,
      originalRequest: "make the reviewed execution safe to commit",
      createdAt: options?.gateCreatedAt ?? "2026-04-25T13:30:00.000Z",
    },
  };
}

test("validation_passed returns commit_ready", async () => {
  const context = await buildGateInput("commit-gate-ready");
  try {
    const result = evaluateCommitEligibility(context.input);

    assert.equal(result.status, "commit_ready");
    assert.equal(result.recommended_action, "commit");
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("validation_failed returns commit_blocked", async () => {
  const context = await buildGateInput("commit-gate-failed", { tamperFile: true });
  try {
    const result = evaluateCommitEligibility(context.input);

    assert.equal(result.status, "commit_blocked");
    assert.ok(result.blockers.some((blocker) => blocker.code === "validation_failed"));
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("rollback recommendation returns commit_blocked", async () => {
  const context = await buildGateInput("commit-gate-rollback", { tamperFile: true });
  try {
    const result = evaluateCommitEligibility(context.input);

    assert.equal(result.status, "commit_blocked");
    assert.equal(result.recommended_action, "rollback");
    assert.ok(result.blockers.some((blocker) => blocker.code === "rollback_recommended"));
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("medium risk returns commit_needs_review", async () => {
  const context = await buildGateInput("commit-gate-medium", {
    packetOverrides: { risk_level: "medium" },
  });
  try {
    const result = evaluateCommitEligibility(context.input);

    assert.equal(result.status, "commit_needs_review");
    assert.equal(result.recommended_action, "review");
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("report contains correct file list", async () => {
  const context = await buildGateInput("commit-gate-report-files");
  try {
    const result = evaluateCommitEligibility(context.input);

    assert.deepEqual(result.completion_report.files_changed, [context.input.executionResult.changed_files[0]]);
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("report contains validation summary", async () => {
  const context = await buildGateInput("commit-gate-report-validation");
  try {
    const result = evaluateCommitEligibility(context.input);

    assert.match(result.completion_report.validation_summary, /Controlled validation status:/i);
    assert.equal(result.completion_report.validation_result, "validation_passed");
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("deterministic output", async () => {
  const context = await buildGateInput("commit-gate-deterministic");
  try {
    const first = evaluateCommitEligibility(context.input);
    const second = evaluateCommitEligibility(context.input);

    assert.deepEqual(second, first);
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("works with validation runner output", async () => {
  const context = await buildGateInput("commit-gate-validation-output");
  try {
    const result = evaluateCommitEligibility(context.input);

    assert.equal(result.status, "commit_ready");
    assert.equal(result.completion_report.rollback_available, true);
    assert.equal(result.completion_report.diff_summary[0], `UPDATE ${context.targetPath}: Update the reviewed file for commit gating.`);
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("summary is readable", async () => {
  const context = await buildGateInput("commit-gate-summary");
  try {
    const result = evaluateCommitEligibility(context.input);
    const summary = summarizeCommitGate(result);

    assert.match(summary, /Commit gate status:/i);
    assert.match(summary, /Recommended action:/i);
    assert.match(summary, /Validation result:/i);
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("no side effects", async () => {
  const context = await buildGateInput("commit-gate-side-effects");
  try {
    const before = await readFile(path.join(context.absoluteRoot, "commit-gate.txt"), "utf8");
    evaluateCommitEligibility(context.input);
    const after = await readFile(path.join(context.absoluteRoot, "commit-gate.txt"), "utf8");

    assert.equal(after, before);
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});