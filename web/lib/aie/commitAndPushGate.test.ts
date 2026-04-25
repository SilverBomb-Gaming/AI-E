import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { executeControlledPatch } from "./controlledPatchExecutor";
import { evaluateCommitEligibility } from "./commitGate";
import { evaluateCommitApproval, evaluatePushApproval, summarizeApproval } from "./commitAndPushGate";
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
    application_packet_id: "application-packet-20260425150000-approval-gate-test",
    source_draft_id: "patch-draft-approval-gate",
    source_decision_id: "decision-approval-gate",
    source_patch_plan_id: "patch-plan-approval-gate",
    source_dry_run_id: "dry-run-approval-gate",
    source_handoff_id: "handoff-approval-gate",
    source_artifact_id: "artifact-approval-gate",
    created_at: "2026-04-25T15:00:00.000Z",
    interpreted_goal: "Apply, validate, and explicitly approve reviewed repository actions.",
    risk_level: "low",
    application_instructions: ["Stay inside the reviewed target.", "Do not auto-commit or auto-push."],
    affected_targets: [...targets],
    validation_requirements: [{ title: "Run focused tests", details: "Run the reviewed test slice.", required: true }],
    git_commit_plan: {
      commit_message: "feat(execution): add commit and push approval gates",
      stage_only: [...targets],
      github_procedure: ["stage only reviewed files", "wait for explicit approval before commit or push"],
    },
    playtest_required: false,
    required_operator_review: true,
    human_approval_required: true,
    allowed_executor_actions: ["inspect target files", "apply reviewed file changes"],
    disallowed_executor_actions: ["apply patches automatically", "commit automatically", "push automatically", "deploy", "run destructive commands", "access secrets", "bypass validation"],
    completion_report_requirements: ["List changed files", "Record approval status"],
    next_operator_action: "execution_ready_review",
    ...overrides,
  };
}

async function buildApprovalContext(prefix: string, options?: { tamperFile?: boolean; packetOverrides?: Partial<ReviewedPatchApplicationPacket> }) {
  const sandbox = await createSandboxRoot(prefix);
  const targetPath = `${sandbox.relativeRoot}/approval-gate.txt`;
  await writeFile(path.join(sandbox.absoluteRoot, "approval-gate.txt"), "before\n", "utf8");
  const applicationPacket = buildPacket([targetPath], options?.packetOverrides);
  const executionResult = await executeControlledPatch({
    applicationPacket,
    approval: true,
    fileChanges: [{
      file_path: targetPath,
      change_type: "update",
      after_snapshot: "after\n",
      summary_of_change: "Update the reviewed file for approval gating.",
    }],
    createdAt: "2026-04-25T15:10:00.000Z",
    allowedRoots: [sandbox.relativeRoot],
  });

  if (options?.tamperFile) {
    await writeFile(path.join(sandbox.absoluteRoot, "approval-gate.txt"), "tampered\n", "utf8");
  }

  const validationResult = await runControlledValidation({
    executionResult,
    applicationPacket,
    createdAt: "2026-04-25T15:20:00.000Z",
    allowedRoots: [sandbox.relativeRoot],
  });
  const commitGateResult = evaluateCommitEligibility({
    validationResult,
    executionResult,
    applicationPacket,
    originalRequest: "require explicit approval before commit and push",
    createdAt: "2026-04-25T15:30:00.000Z",
  });

  return {
    absoluteRoot: sandbox.absoluteRoot,
    targetPath,
    commitGateResult,
  };
}

test("commit_ready plus no approval returns awaiting", async () => {
  const context = await buildApprovalContext("approval-commit-awaiting");
  try {
    const result = evaluateCommitApproval({
      commitGateResult: context.commitGateResult,
      approval: false,
      createdAt: "2026-04-25T15:40:00.000Z",
    });

    assert.equal(result.status, "commit_awaiting_approval");
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("commit_ready plus approval returns approved", async () => {
  const context = await buildApprovalContext("approval-commit-approved");
  try {
    const result = evaluateCommitApproval({
      commitGateResult: context.commitGateResult,
      approval: true,
      createdAt: "2026-04-25T15:41:00.000Z",
    });

    assert.equal(result.status, "commit_approved");
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("commit_blocked remains blocked", async () => {
  const context = await buildApprovalContext("approval-commit-blocked", { tamperFile: true });
  try {
    const result = evaluateCommitApproval({
      commitGateResult: context.commitGateResult,
      approval: true,
      createdAt: "2026-04-25T15:42:00.000Z",
    });

    assert.equal(result.status, "commit_blocked");
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("push without commit approval is blocked", async () => {
  const context = await buildApprovalContext("approval-push-blocked");
  try {
    const commitResult = evaluateCommitApproval({
      commitGateResult: context.commitGateResult,
      approval: false,
      createdAt: "2026-04-25T15:43:00.000Z",
    });
    const pushResult = evaluatePushApproval({
      commitApprovalResult: commitResult,
      approval: true,
      createdAt: "2026-04-25T15:44:00.000Z",
    });

    assert.equal(pushResult.status, "push_blocked");
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("push with approval returns approved", async () => {
  const context = await buildApprovalContext("approval-push-approved");
  try {
    const commitResult = evaluateCommitApproval({
      commitGateResult: context.commitGateResult,
      approval: true,
      createdAt: "2026-04-25T15:45:00.000Z",
    });
    const pushResult = evaluatePushApproval({
      commitApprovalResult: commitResult,
      approval: true,
      createdAt: "2026-04-25T15:46:00.000Z",
    });

    assert.equal(pushResult.status, "push_approved");
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("approval logs are recorded", async () => {
  const context = await buildApprovalContext("approval-logs");
  try {
    const commitResult = evaluateCommitApproval({
      commitGateResult: context.commitGateResult,
      approval: false,
      createdAt: "2026-04-25T15:47:00.000Z",
    });

    assert.equal(commitResult.approval_log.stage, "commit");
    assert.equal(commitResult.approval_log.approval_requested, true);
    assert.equal(commitResult.approval_log.approval_received, false);
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("deterministic behavior", async () => {
  const context = await buildApprovalContext("approval-deterministic");
  try {
    const first = evaluateCommitApproval({
      commitGateResult: context.commitGateResult,
      approval: true,
      createdAt: "2026-04-25T15:48:00.000Z",
    });
    const second = evaluateCommitApproval({
      commitGateResult: context.commitGateResult,
      approval: true,
      createdAt: "2026-04-25T15:48:00.000Z",
    });

    assert.deepEqual(second, first);
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("no side effects", async () => {
  const context = await buildApprovalContext("approval-side-effects");
  try {
    const before = await readFile(path.join(context.absoluteRoot, "approval-gate.txt"), "utf8");
    evaluateCommitApproval({
      commitGateResult: context.commitGateResult,
      approval: true,
      createdAt: "2026-04-25T15:49:00.000Z",
    });
    const after = await readFile(path.join(context.absoluteRoot, "approval-gate.txt"), "utf8");

    assert.equal(after, before);
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("works with commitGate output", async () => {
  const context = await buildApprovalContext("approval-commit-gate-output");
  try {
    const commitResult = evaluateCommitApproval({
      commitGateResult: context.commitGateResult,
      approval: true,
      createdAt: "2026-04-25T15:50:00.000Z",
    });

    assert.equal(commitResult.status, "commit_approved");
    assert.equal(commitResult.approval_log.status, "commit_approved");
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("summary is readable", async () => {
  const context = await buildApprovalContext("approval-summary");
  try {
    const commitResult = evaluateCommitApproval({
      commitGateResult: context.commitGateResult,
      approval: false,
      createdAt: "2026-04-25T15:51:00.000Z",
    });
    const summary = summarizeApproval(commitResult);

    assert.match(summary, /Approval status:/i);
    assert.match(summary, /Stage:/i);
    assert.match(summary, /Explanation:/i);
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});