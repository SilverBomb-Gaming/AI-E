import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { advanceTaskChain, createAutonomousTaskChain, evaluateTaskChainReadiness } from "./autonomousTaskChain";
import {
  createChainCheckpoint,
  evaluateRecoveryEligibility,
  resumeTaskChain,
  summarizeRecovery,
  validateCheckpoint,
} from "./autonomousChainRecovery";
import { executeControlledPatch } from "./controlledPatchExecutor";
import { evaluateCommitEligibility } from "./commitGate";
import { evaluateCommitApproval, evaluatePushApproval } from "./commitAndPushGate";
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
    application_packet_id: "application-packet-20260425190000-chain-recovery-test",
    source_draft_id: "patch-draft-chain-recovery",
    source_decision_id: "decision-chain-recovery",
    source_patch_plan_id: "patch-plan-chain-recovery",
    source_dry_run_id: "dry-run-chain-recovery",
    source_handoff_id: "handoff-chain-recovery",
    source_artifact_id: "artifact-chain-recovery",
    created_at: "2026-04-25T19:00:00.000Z",
    interpreted_goal: "Safely resume a bounded autonomous task chain.",
    risk_level: "low",
    application_instructions: ["Stay inside reviewed targets.", "Use explicit approvals for repo actions."],
    affected_targets: [...targets],
    validation_requirements: [{ title: "Run focused tests", details: "Run the reviewed test slice.", required: true }],
    git_commit_plan: {
      commit_message: "feat(autonomy): add autonomous chain recovery",
      stage_only: [...targets],
      github_procedure: ["stage only reviewed files", "renew approvals before commit or push"],
    },
    playtest_required: false,
    required_operator_review: true,
    human_approval_required: true,
    allowed_executor_actions: ["inspect target files", "apply reviewed file changes"],
    disallowed_executor_actions: ["apply patches automatically", "commit automatically", "push automatically", "deploy", "run destructive commands", "access secrets", "bypass validation"],
    completion_report_requirements: ["List changed files", "Record checkpoint status"],
    next_operator_action: "execution_ready_review",
    ...overrides,
  };
}

async function buildStepOutcome(prefix: string, options?: { commitApproval?: boolean; pushApproval?: boolean; tamperFile?: boolean }) {
  const sandbox = await createSandboxRoot(prefix);
  const targetPath = `${sandbox.relativeRoot}/chain-recovery.txt`;
  await writeFile(path.join(sandbox.absoluteRoot, "chain-recovery.txt"), "before\n", "utf8");
  const applicationPacket = buildPacket([targetPath]);
  const executionResult = await executeControlledPatch({
    applicationPacket,
    approval: true,
    fileChanges: [{
      file_path: targetPath,
      change_type: "update",
      after_snapshot: "after\n",
      summary_of_change: "Update reviewed file for chain recovery.",
    }],
    createdAt: "2026-04-25T19:10:00.000Z",
    allowedRoots: [sandbox.relativeRoot],
  });

  if (options?.tamperFile) {
    await writeFile(path.join(sandbox.absoluteRoot, "chain-recovery.txt"), "tampered\n", "utf8");
  }

  const validationResult = await runControlledValidation({
    executionResult,
    applicationPacket,
    createdAt: "2026-04-25T19:20:00.000Z",
    allowedRoots: [sandbox.relativeRoot],
  });
  const commitGateResult = evaluateCommitEligibility({
    validationResult,
    executionResult,
    applicationPacket,
    originalRequest: "resume bounded chain safely",
    createdAt: "2026-04-25T19:30:00.000Z",
  });
  const commitApprovalResult = evaluateCommitApproval({
    commitGateResult,
    approval: options?.commitApproval === true,
    createdAt: "2026-04-25T19:40:00.000Z",
  });
  const pushApprovalResult = evaluatePushApproval({
    commitApprovalResult,
    approval: options?.pushApproval === true,
    createdAt: "2026-04-25T19:50:00.000Z",
  });

  return {
    absoluteRoot: sandbox.absoluteRoot,
    validationResult,
    commitApprovalResult,
    pushApprovalResult,
  };
}

async function buildPausedChainForRecovery(prefix: string, options?: { commitApproval?: boolean; pushAllowed?: boolean; tamperFile?: boolean }) {
  const planned = createAutonomousTaskChain({
    originalRequest: "Run two safe steps with recovery",
    maxSteps: 2,
    chainApproval: true,
    requestedSteps: [
      { title: "First step", commitAllowed: true, pushAllowed: false },
      { title: "Second step", commitAllowed: true, pushAllowed: options?.pushAllowed === true },
    ],
    createdAt: "2026-04-25T20:00:00.000Z",
  });
  const ready = evaluateTaskChainReadiness(planned.chain);
  const firstOutcome = await buildStepOutcome(`${prefix}-first`, { commitApproval: true });
  const afterFirst = advanceTaskChain(ready.chain, {
    step_id: ready.chain.steps[0].step_id,
    validation_status: firstOutcome.validationResult.status,
    validation_recommendation: firstOutcome.validationResult.recommendation,
    commit_approval_status: firstOutcome.commitApprovalResult.status,
    rollback_recommended: firstOutcome.validationResult.recommendation === "rollback",
  });

  const secondOutcome = await buildStepOutcome(`${prefix}-second`, {
    commitApproval: options?.commitApproval,
    pushApproval: false,
    tamperFile: options?.tamperFile,
  });
  const afterSecond = advanceTaskChain(afterFirst.chain, {
    step_id: afterFirst.chain.steps[1].step_id,
    validation_status: secondOutcome.validationResult.status,
    validation_recommendation: secondOutcome.validationResult.recommendation,
    commit_approval_status: secondOutcome.commitApprovalResult.status,
    push_approval_status: secondOutcome.pushApprovalResult.status,
    rollback_recommended: secondOutcome.validationResult.recommendation === "rollback",
  });

  return {
    absoluteRoots: [firstOutcome.absoluteRoot, secondOutcome.absoluteRoot],
    afterFirst,
    afterSecond,
  };
}

test("resume after pause continues correctly", async () => {
  const context = await buildPausedChainForRecovery("resume-after-pause", { commitApproval: false });
  try {
    const checkpoint = createChainCheckpoint(context.afterFirst.chain);
    const resumed = resumeTaskChain(context.afterSecond.chain, checkpoint);

    assert.equal(resumed.status, "recoverable");
    assert.equal(resumed.resumed_chain?.current_step_index, 1);
    assert.equal(resumed.resumed_chain?.steps[0].status, "completed");
    assert.equal(resumed.resumed_chain?.steps[1].status, "ready");
  } finally {
    await Promise.all(context.absoluteRoots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

test("resume after validation failure is blocked", async () => {
  const context = await buildPausedChainForRecovery("resume-validation-failure", { commitApproval: true, tamperFile: true });
  try {
    const checkpoint = createChainCheckpoint(context.afterSecond.chain);
    const eligibility = evaluateRecoveryEligibility(context.afterSecond.chain, checkpoint);

    assert.equal(eligibility.status, "requires_restart");
  } finally {
    await Promise.all(context.absoluteRoots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

test("resume after approval gap requires reapproval", async () => {
  const context = await buildPausedChainForRecovery("resume-reapproval", { commitApproval: false });
  try {
    const checkpoint = createChainCheckpoint(context.afterFirst.chain);
    const eligibility = evaluateRecoveryEligibility(context.afterSecond.chain, checkpoint);

    assert.equal(eligibility.status, "awaiting_reapproval");
    assert.ok(eligibility.blockers.some((blocker) => blocker.code === "approval_missing"));
  } finally {
    await Promise.all(context.absoluteRoots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

test("checkpoint stores correct step index", async () => {
  const context = await buildPausedChainForRecovery("checkpoint-index", { commitApproval: false });
  try {
    const checkpoint = createChainCheckpoint(context.afterFirst.chain);

    assert.equal(checkpoint.last_completed_step_index, 0);
  } finally {
    await Promise.all(context.absoluteRoots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

test("resume does not rerun completed steps", async () => {
  const context = await buildPausedChainForRecovery("resume-no-rerun", { commitApproval: false });
  try {
    const checkpoint = createChainCheckpoint(context.afterFirst.chain);
    const resumed = resumeTaskChain(context.afterSecond.chain, checkpoint);

    assert.equal(resumed.resumed_chain?.steps[0].status, "completed");
    assert.equal(resumed.resumed_chain?.current_step_index, 1);
  } finally {
    await Promise.all(context.absoluteRoots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

test("unsafe checkpoint is not recoverable", () => {
  const validation = validateCheckpoint({
    checkpoint_id: "bad",
    chain_id: "chain-1",
    last_completed_step_index: 0,
    last_successful_state: "chain_paused",
    validation_snapshot: {
      status: "validation_failed",
      recommendation: "rollback",
    },
    approval_state: {
      chain_approval_granted: true,
      commit_approved: false,
      push_approved: false,
    },
    created_at: "2026-04-25T20:10:00.000Z",
  });

  assert.equal(validation.status, "requires_restart");
});

test("deterministic behavior", async () => {
  const context = await buildPausedChainForRecovery("recovery-deterministic", { commitApproval: false });
  try {
    const checkpoint = createChainCheckpoint(context.afterFirst.chain);
    const first = evaluateRecoveryEligibility(context.afterSecond.chain, checkpoint);
    const second = evaluateRecoveryEligibility(context.afterSecond.chain, checkpoint);

    assert.deepEqual(second, first);
  } finally {
    await Promise.all(context.absoluteRoots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

test("integrates with autonomousTaskChain", async () => {
  const context = await buildPausedChainForRecovery("recovery-integration", { commitApproval: false });
  try {
    const checkpoint = createChainCheckpoint(context.afterFirst.chain);
    const resumed = resumeTaskChain(context.afterSecond.chain, checkpoint);

    assert.equal(resumed.resumed_chain?.chain_id, context.afterSecond.chain.chain_id);
    assert.equal(resumed.resumed_chain?.completion_report.completed_steps.length, 1);
  } finally {
    await Promise.all(context.absoluteRoots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

test("summary readable", async () => {
  const context = await buildPausedChainForRecovery("recovery-summary", { commitApproval: false });
  try {
    const checkpoint = createChainCheckpoint(context.afterFirst.chain);
    const result = evaluateRecoveryEligibility(context.afterSecond.chain, checkpoint);
    const summary = summarizeRecovery(result);

    assert.match(summary, /Recovery status:/i);
    assert.match(summary, /Resume available:/i);
    assert.match(summary, /Explanation:/i);
  } finally {
    await Promise.all(context.absoluteRoots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

test("no side effects", async () => {
  const sandbox = await createSandboxRoot("recovery-no-side-effects");
  try {
    const markerPath = path.join(sandbox.absoluteRoot, "marker.txt");
    await writeFile(markerPath, "unchanged\n", "utf8");
    const chain = createAutonomousTaskChain({
      originalRequest: "recover without side effects",
      maxSteps: 1,
      chainApproval: true,
      requestedSteps: [{ title: "Only step" }],
      createdAt: "2026-04-25T20:20:00.000Z",
    }).chain;
    const checkpoint = createChainCheckpoint(chain);
    const before = await readFile(markerPath, "utf8");
    evaluateRecoveryEligibility(chain, checkpoint);
    const after = await readFile(markerPath, "utf8");

    assert.equal(after, before);
  } finally {
    await rm(sandbox.absoluteRoot, { recursive: true, force: true });
  }
});