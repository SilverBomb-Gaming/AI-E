import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  advanceTaskChain,
  completeTaskChain,
  createAutonomousTaskChain,
  evaluateTaskChainReadiness,
  summarizeTaskChain,
} from "./autonomousTaskChain";
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
    application_packet_id: "application-packet-20260425170000-task-chain-test",
    source_draft_id: "patch-draft-task-chain",
    source_decision_id: "decision-task-chain",
    source_patch_plan_id: "patch-plan-task-chain",
    source_dry_run_id: "dry-run-task-chain",
    source_handoff_id: "handoff-task-chain",
    source_artifact_id: "artifact-task-chain",
    created_at: "2026-04-25T17:00:00.000Z",
    interpreted_goal: "Run a supervised bounded sequence safely.",
    risk_level: "low",
    application_instructions: ["Stay inside reviewed targets.", "Use explicit approvals for repo actions."],
    affected_targets: [...targets],
    validation_requirements: [{ title: "Run focused tests", details: "Run the reviewed test slice.", required: true }],
    git_commit_plan: {
      commit_message: "feat(autonomy): add bounded autonomous task chaining",
      stage_only: [...targets],
      github_procedure: ["stage only reviewed files", "wait for approval before commit and push"],
    },
    playtest_required: false,
    required_operator_review: true,
    human_approval_required: true,
    allowed_executor_actions: ["inspect target files", "apply reviewed file changes"],
    disallowed_executor_actions: ["apply patches automatically", "commit automatically", "push automatically", "deploy", "run destructive commands", "access secrets", "bypass validation"],
    completion_report_requirements: ["List changed files", "Record chain status"],
    next_operator_action: "execution_ready_review",
    ...overrides,
  };
}

async function buildApprovedStepResult(prefix: string, options?: { commitApproval?: boolean; pushApproval?: boolean; tamperFile?: boolean }) {
  const sandbox = await createSandboxRoot(prefix);
  const targetPath = `${sandbox.relativeRoot}/task-chain.txt`;
  await writeFile(path.join(sandbox.absoluteRoot, "task-chain.txt"), "before\n", "utf8");
  const applicationPacket = buildPacket([targetPath]);
  const executionResult = await executeControlledPatch({
    applicationPacket,
    approval: true,
    fileChanges: [{
      file_path: targetPath,
      change_type: "update",
      after_snapshot: "after\n",
      summary_of_change: "Update reviewed file for chained task execution.",
    }],
    createdAt: "2026-04-25T17:10:00.000Z",
    allowedRoots: [sandbox.relativeRoot],
  });

  if (options?.tamperFile) {
    await writeFile(path.join(sandbox.absoluteRoot, "task-chain.txt"), "tampered\n", "utf8");
  }

  const validationResult = await runControlledValidation({
    executionResult,
    applicationPacket,
    createdAt: "2026-04-25T17:20:00.000Z",
    allowedRoots: [sandbox.relativeRoot],
  });
  const commitGateResult = evaluateCommitEligibility({
    validationResult,
    executionResult,
    applicationPacket,
    originalRequest: "run bounded chained task safely",
    createdAt: "2026-04-25T17:30:00.000Z",
  });
  const commitApprovalResult = evaluateCommitApproval({
    commitGateResult,
    approval: options?.commitApproval === true,
    createdAt: "2026-04-25T17:40:00.000Z",
  });
  const pushApprovalResult = evaluatePushApproval({
    commitApprovalResult,
    approval: options?.pushApproval === true,
    createdAt: "2026-04-25T17:50:00.000Z",
  });

  return {
    absoluteRoot: sandbox.absoluteRoot,
    stepOutcome: {
      validationResult,
      commitApprovalResult,
      pushApprovalResult,
    },
  };
}

test("creates bounded chain from request", () => {
  const result = createAutonomousTaskChain({
    originalRequest: "Improve grenade gameplay in three safe steps.",
    interpretedGoal: "Improve grenade gameplay through bounded supervised steps.",
    maxSteps: 3,
    chainApproval: false,
    requestedSteps: [
      { title: "Add damage radius" },
      { title: "Add VFX/SFX hook" },
      { title: "Add cooldown/inventory rule" },
    ],
    createdAt: "2026-04-25T18:00:00.000Z",
  });

  assert.equal(result.status, "chain_planned");
  assert.equal(result.chain.steps.length, 3);
  assert.equal(result.chain.steps[0].title, "Add damage radius");
});

test("refuses chain over max_steps", () => {
  const result = createAutonomousTaskChain({
    originalRequest: "Too many steps",
    maxSteps: 2,
    requestedSteps: [
      { title: "One" },
      { title: "Two" },
      { title: "Three" },
    ],
    createdAt: "2026-04-25T18:01:00.000Z",
  });

  assert.equal(result.status, "chain_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "max_steps_exceeded"));
});

test("requires explicit chain approval", () => {
  const planned = createAutonomousTaskChain({
    originalRequest: "Do two safe steps",
    maxSteps: 2,
    chainApproval: false,
    requestedSteps: [{ title: "Step one" }, { title: "Step two" }],
    createdAt: "2026-04-25T18:02:00.000Z",
  });
  const readiness = evaluateTaskChainReadiness(planned.chain);

  assert.equal(readiness.status, "awaiting_chain_approval");
});

test("blocks high-risk chain", () => {
  const planned = createAutonomousTaskChain({
    originalRequest: "Do risky step",
    maxSteps: 1,
    chainApproval: true,
    riskLevel: "high",
    requestedSteps: [{ title: "High risk step" }],
    createdAt: "2026-04-25T18:03:00.000Z",
  });
  const readiness = evaluateTaskChainReadiness(planned.chain);

  assert.equal(readiness.status, "chain_blocked");
});

test("advances after successful step result", async () => {
  const planned = createAutonomousTaskChain({
    originalRequest: "Do two safe steps",
    maxSteps: 2,
    chainApproval: true,
    requestedSteps: [{ title: "First step" }, { title: "Second step" }],
    createdAt: "2026-04-25T18:04:00.000Z",
  });
  const ready = evaluateTaskChainReadiness(planned.chain);
  const context = await buildApprovedStepResult("task-chain-advance", { commitApproval: true });
  try {
    const advanced = advanceTaskChain(ready.chain, {
      step_id: ready.chain.steps[0].step_id,
      validation_status: context.stepOutcome.validationResult.status,
      validation_recommendation: context.stepOutcome.validationResult.recommendation,
      commit_approval_status: context.stepOutcome.commitApprovalResult.status,
      rollback_recommended: context.stepOutcome.validationResult.recommendation === "rollback",
    });

    assert.equal(advanced.status, "chain_running");
    assert.equal(advanced.chain.current_step_index, 1);
    assert.equal(advanced.chain.steps[0].status, "completed");
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("pauses after failed validation", async () => {
  const planned = createAutonomousTaskChain({
    originalRequest: "Do one safe step",
    maxSteps: 1,
    chainApproval: true,
    requestedSteps: [{ title: "Only step" }],
    createdAt: "2026-04-25T18:05:00.000Z",
  });
  const ready = evaluateTaskChainReadiness(planned.chain);
  const context = await buildApprovedStepResult("task-chain-validation-pause", { tamperFile: true, commitApproval: true });
  try {
    const advanced = advanceTaskChain(ready.chain, {
      step_id: ready.chain.steps[0].step_id,
      validation_status: context.stepOutcome.validationResult.status,
      validation_recommendation: context.stepOutcome.validationResult.recommendation,
      commit_approval_status: context.stepOutcome.commitApprovalResult.status,
      rollback_recommended: context.stepOutcome.validationResult.recommendation === "rollback",
    });

    assert.equal(advanced.status, "chain_paused");
    assert.ok(advanced.blockers.some((blocker) => blocker.code === "validation_failed" || blocker.code === "rollback_recommended"));
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("pauses when commit approval missing", async () => {
  const planned = createAutonomousTaskChain({
    originalRequest: "Do one safe step",
    maxSteps: 1,
    chainApproval: true,
    requestedSteps: [{ title: "Only step" }],
    createdAt: "2026-04-25T18:06:00.000Z",
  });
  const ready = evaluateTaskChainReadiness(planned.chain);
  const context = await buildApprovedStepResult("task-chain-commit-pause", { commitApproval: false });
  try {
    const advanced = advanceTaskChain(ready.chain, {
      step_id: ready.chain.steps[0].step_id,
      validation_status: context.stepOutcome.validationResult.status,
      validation_recommendation: context.stepOutcome.validationResult.recommendation,
      commit_approval_status: context.stepOutcome.commitApprovalResult.status,
      rollback_recommended: context.stepOutcome.validationResult.recommendation === "rollback",
    });

    assert.equal(advanced.status, "chain_paused");
    assert.ok(advanced.blockers.some((blocker) => blocker.code === "commit_approval_missing"));
  } finally {
    await rm(context.absoluteRoot, { recursive: true, force: true });
  }
});

test("completes when all steps pass", async () => {
  const planned = createAutonomousTaskChain({
    originalRequest: "Do two safe steps",
    maxSteps: 2,
    chainApproval: true,
    requestedSteps: [{ title: "First step" }, { title: "Second step" }],
    createdAt: "2026-04-25T18:07:00.000Z",
  });
  const ready = evaluateTaskChainReadiness(planned.chain);
  const contextOne = await buildApprovedStepResult("task-chain-complete-one", { commitApproval: true });
  const contextTwo = await buildApprovedStepResult("task-chain-complete-two", { commitApproval: true });
  try {
    const afterOne = advanceTaskChain(ready.chain, {
      step_id: ready.chain.steps[0].step_id,
      validation_status: contextOne.stepOutcome.validationResult.status,
      validation_recommendation: contextOne.stepOutcome.validationResult.recommendation,
      commit_approval_status: contextOne.stepOutcome.commitApprovalResult.status,
      rollback_recommended: contextOne.stepOutcome.validationResult.recommendation === "rollback",
    });
    const afterTwo = advanceTaskChain(afterOne.chain, {
      step_id: afterOne.chain.steps[1].step_id,
      validation_status: contextTwo.stepOutcome.validationResult.status,
      validation_recommendation: contextTwo.stepOutcome.validationResult.recommendation,
      commit_approval_status: contextTwo.stepOutcome.commitApprovalResult.status,
      rollback_recommended: contextTwo.stepOutcome.validationResult.recommendation === "rollback",
    });

    assert.equal(afterTwo.status, "chain_completed");
    assert.equal(afterTwo.chain.completion_report.completed_steps.length, 2);
  } finally {
    await rm(contextOne.absoluteRoot, { recursive: true, force: true });
    await rm(contextTwo.absoluteRoot, { recursive: true, force: true });
  }
});

test("produces readable report", () => {
  const planned = createAutonomousTaskChain({
    originalRequest: "Readable report",
    maxSteps: 1,
    chainApproval: true,
    requestedSteps: [{ title: "Only step" }],
    createdAt: "2026-04-25T18:08:00.000Z",
  });
  const completed = completeTaskChain(planned.chain);
  const summary = summarizeTaskChain(completed.chain);

  assert.match(summary, /Task chain status:/i);
  assert.match(summary, /Total steps:/i);
  assert.match(summary, /Summary:/i);
});

test("does not mutate files or bypass gates", async () => {
  const sandbox = await createSandboxRoot("task-chain-no-side-effects");
  try {
    const markerPath = path.join(sandbox.absoluteRoot, "marker.txt");
    await writeFile(markerPath, "unchanged\n", "utf8");
    const planned = createAutonomousTaskChain({
      originalRequest: "No side effects",
      maxSteps: 1,
      chainApproval: true,
      requestedSteps: [{ title: "Only step", commitAllowed: false, pushAllowed: false }],
      createdAt: "2026-04-25T18:09:00.000Z",
    });
    const ready = evaluateTaskChainReadiness(planned.chain);
    const before = await readFile(markerPath, "utf8");
    advanceTaskChain(ready.chain, {
      step_id: ready.chain.steps[0].step_id,
      validation_status: "validation_passed",
      validation_recommendation: "keep_changes",
      rollback_recommended: false,
    });
    const after = await readFile(markerPath, "utf8");

    assert.equal(after, before);
  } finally {
    await rm(sandbox.absoluteRoot, { recursive: true, force: true });
  }
});