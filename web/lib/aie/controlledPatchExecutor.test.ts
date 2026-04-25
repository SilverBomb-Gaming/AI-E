import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  executeControlledPatch,
  generatePatchDiff,
  rollbackExecution,
  summarizeExecution,
  type ControlledExecutionDiff,
} from "./controlledPatchExecutor";
import type { ReviewedPatchApplicationPacket } from "./reviewedPatchApplicationExecutor";
import {
  convertRefinementToPlannerRequest,
  refineConversationalIntent,
} from "./conversationalIntentRefinement";
import { createOperatorLightPlan } from "./operatorLightPlanner";
import { evaluateArtifactForExecution } from "./artifactExecutionConsumer";
import { createReviewedExecutionHandoff } from "./reviewedExecutionBridge";
import { runExecutionDryRun } from "./executionDryRunRunner";
import { prepareReviewedPatchPlan } from "./reviewedPatchPreparation";
import { evaluatePatchPlanForApplication } from "./reviewedPatchApplicationGate";
import { generateReviewedPatchDraft } from "./reviewedPatchDraftGenerator";
import { createReviewedPatchApplicationPacket } from "./reviewedPatchApplicationExecutor";
import { createSessionArtifact, updateSessionArtifactStatus } from "./sessionArtifacts";

const REPO_ROOT = path.resolve(process.cwd(), "..");

async function createSandboxRoot(prefix: string): Promise<{ absoluteRoot: string; relativeRoot: string }> {
  const sandboxParent = path.join(REPO_ROOT, "web", "sandbox");
  await mkdir(sandboxParent, { recursive: true });
  const absoluteRoot = await mkdtemp(path.join(sandboxParent, `${prefix}-`));
  const relativeRoot = path.relative(REPO_ROOT, absoluteRoot).split(path.sep).join("/");
  return { absoluteRoot, relativeRoot };
}

async function withSandbox<T>(prefix: string, callback: (sandbox: { absoluteRoot: string; relativeRoot: string }) => Promise<T>): Promise<T> {
  const sandbox = await createSandboxRoot(prefix);
  try {
    return await callback(sandbox);
  } finally {
    await rm(sandbox.absoluteRoot, { recursive: true, force: true });
  }
}

function buildPacket(targets: string[], overrides: Partial<ReviewedPatchApplicationPacket> = {}): ReviewedPatchApplicationPacket {
  return {
    application_packet_id: "application-packet-20260425090000-controlled-test",
    source_draft_id: "patch-draft-1",
    source_decision_id: "decision-1",
    source_patch_plan_id: "patch-plan-1",
    source_dry_run_id: "dry-run-1",
    source_handoff_id: "handoff-1",
    source_artifact_id: "artifact-1",
    created_at: "2026-04-25T09:00:00.000Z",
    interpreted_goal: "Apply one reviewed file change safely.",
    risk_level: "low",
    application_instructions: ["Stay within the reviewed file target.", "Show the diff before applying."],
    affected_targets: [...targets],
    validation_requirements: [{ title: "Run focused tests", details: "Run only the reviewed slice.", required: true }],
    git_commit_plan: {
      commit_message: "feat(execution): apply reviewed controlled patch",
      stage_only: [...targets],
      github_procedure: ["stage only reviewed files", "commit reviewed changes"],
    },
    playtest_required: false,
    required_operator_review: true,
    human_approval_required: true,
    allowed_executor_actions: ["inspect target files", "apply reviewed file changes"],
    disallowed_executor_actions: ["apply patches automatically", "commit automatically", "push automatically", "deploy", "run destructive commands", "access secrets", "bypass validation"],
    completion_report_requirements: ["List changed files", "Keep rollback data"],
    next_operator_action: "execution_ready_review",
    ...overrides,
  };
}

async function buildReviewedPacketForSandbox(targetPath: string): Promise<ReviewedPatchApplicationPacket> {
  const source = {
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  };
  const refinement = refineConversationalIntent(source);
  const plannerRequest = convertRefinementToPlannerRequest(refinement, source);
  assert.ok(plannerRequest);
  const plan = createOperatorLightPlan(plannerRequest);
  const artifact = updateSessionArtifactStatus(createSessionArtifact({
    artifactType: "operator_plan",
    sourceRequest: source.rawRequest,
    refinement,
    plan,
    createdAt: "2026-04-25T10:00:00.000Z",
  }), "approved");
  const executionDecision = evaluateArtifactForExecution(artifact);
  const handoff = createReviewedExecutionHandoff({ artifact, decision: executionDecision });
  assert.ok(handoff.handoff_packet);
  const dryRun = runExecutionDryRun({ handoffPacket: handoff.handoff_packet, createdAt: "2026-04-25T10:10:00.000Z" });
  const prep = prepareReviewedPatchPlan({ report: dryRun, createdAt: "2026-04-25T10:20:00.000Z" });
  const applicationGate = evaluatePatchPlanForApplication({ preparationResult: prep, createdAt: "2026-04-25T10:30:00.000Z" });
  assert.ok(applicationGate.decision);
  const draftResult = generateReviewedPatchDraft({ decision: applicationGate.decision, createdAt: "2026-04-25T10:40:00.000Z" });
  const applicationResult = createReviewedPatchApplicationPacket({ draftResult, createdAt: "2026-04-25T10:50:00.000Z" });
  assert.ok(applicationResult.application_packet);

  return {
    ...applicationResult.application_packet,
    affected_targets: [targetPath],
    git_commit_plan: {
      ...applicationResult.application_packet.git_commit_plan,
      stage_only: [targetPath],
    },
  };
}

test("execution without approval returns awaiting_approval", async () => {
  await withSandbox("controlled-exec-awaiting", async ({ absoluteRoot, relativeRoot }) => {
    const targetPath = `${relativeRoot}/note.txt`;
    await writeFile(path.join(absoluteRoot, "note.txt"), "before\n", "utf8");
    const result = await executeControlledPatch({
      applicationPacket: buildPacket([targetPath]),
      approval: false,
      fileChanges: [{
        file_path: targetPath,
        change_type: "update",
        after_snapshot: "after\n",
        summary_of_change: "Replace note contents.",
      }],
      createdAt: "2026-04-25T09:10:00.000Z",
      allowedRoots: [relativeRoot],
    });

    assert.equal(result.status, "awaiting_approval");
    assert.equal(result.preview_diff[0]?.before_snapshot, "before\n");
    assert.equal(await readFile(path.join(absoluteRoot, "note.txt"), "utf8"), "before\n");
  });
});

test("execution with approval returns applied", async () => {
  await withSandbox("controlled-exec-applied", async ({ absoluteRoot, relativeRoot }) => {
    const targetPath = `${relativeRoot}/apply.txt`;
    await writeFile(path.join(absoluteRoot, "apply.txt"), "old\n", "utf8");
    const result = await executeControlledPatch({
      applicationPacket: buildPacket([targetPath]),
      approval: true,
      fileChanges: [{
        file_path: targetPath,
        change_type: "update",
        after_snapshot: "new\n",
        summary_of_change: "Update controlled execution note.",
      }],
      createdAt: "2026-04-25T09:20:00.000Z",
      allowedRoots: [relativeRoot],
    });

    assert.equal(result.status, "applied");
    assert.equal(await readFile(path.join(absoluteRoot, "apply.txt"), "utf8"), "new\n");
    assert.ok(result.rollback_point);
  });
});

test("diff preview is generated correctly", async () => {
  await withSandbox("controlled-exec-diff", async ({ absoluteRoot, relativeRoot }) => {
    const targetPath = `${relativeRoot}/preview.txt`;
    await writeFile(path.join(absoluteRoot, "preview.txt"), "before preview\n", "utf8");
    const preview = await generatePatchDiff(
      buildPacket([targetPath]),
      [{
        file_path: targetPath,
        change_type: "update",
        after_snapshot: "after preview\n",
        summary_of_change: "Preview exact file replacement.",
      }],
      [relativeRoot],
    );

    assert.equal(preview[0]?.file_path, targetPath);
    assert.equal(preview[0]?.change_type, "update");
    assert.equal(preview[0]?.before_snapshot, "before preview\n");
    assert.equal(preview[0]?.after_snapshot, "after preview\n");
  });
});

test("only allowed files are modified", async () => {
  await withSandbox("controlled-exec-allowed", async ({ absoluteRoot, relativeRoot }) => {
    const allowedTarget = `${relativeRoot}/allowed.txt`;
    const otherTarget = `${relativeRoot}/other.txt`;
    await writeFile(path.join(absoluteRoot, "allowed.txt"), "allowed before\n", "utf8");
    await writeFile(path.join(absoluteRoot, "other.txt"), "other before\n", "utf8");
    const result = await executeControlledPatch({
      applicationPacket: buildPacket([allowedTarget]),
      approval: true,
      fileChanges: [
        {
          file_path: allowedTarget,
          change_type: "update",
          after_snapshot: "allowed after\n",
          summary_of_change: "Update allowed file.",
        },
        {
          file_path: otherTarget,
          change_type: "update",
          after_snapshot: "other after\n",
          summary_of_change: "Attempt unrelated update.",
        },
      ],
      createdAt: "2026-04-25T09:30:00.000Z",
      allowedRoots: [relativeRoot],
    });

    assert.equal(result.status, "blocked");
    assert.equal(await readFile(path.join(absoluteRoot, "allowed.txt"), "utf8"), "allowed before\n");
    assert.equal(await readFile(path.join(absoluteRoot, "other.txt"), "utf8"), "other before\n");
  });
});

test("rollback restores previous state", async () => {
  await withSandbox("controlled-exec-rollback", async ({ absoluteRoot, relativeRoot }) => {
    const targetPath = `${relativeRoot}/rollback.txt`;
    await writeFile(path.join(absoluteRoot, "rollback.txt"), "rollback before\n", "utf8");
    const applied = await executeControlledPatch({
      applicationPacket: buildPacket([targetPath]),
      approval: true,
      fileChanges: [{
        file_path: targetPath,
        change_type: "update",
        after_snapshot: "rollback after\n",
        summary_of_change: "Update rollback file.",
      }],
      createdAt: "2026-04-25T09:40:00.000Z",
      allowedRoots: [relativeRoot],
    });
    assert.equal(await readFile(path.join(absoluteRoot, "rollback.txt"), "utf8"), "rollback after\n");

    const rolledBack = await rollbackExecution(applied.rollback_point, [relativeRoot]);

    assert.equal(rolledBack.status, "rolled_back");
    assert.equal(await readFile(path.join(absoluteRoot, "rollback.txt"), "utf8"), "rollback before\n");
  });
});

test("disallowed actions block execution", async () => {
  await withSandbox("controlled-exec-disallowed", async ({ absoluteRoot, relativeRoot }) => {
    const targetPath = `${relativeRoot}/blocked.txt`;
    await writeFile(path.join(absoluteRoot, "blocked.txt"), "blocked before\n", "utf8");
    const result = await executeControlledPatch({
      applicationPacket: buildPacket([targetPath], {
        disallowed_executor_actions: ["apply patches", "deploy"],
      }),
      approval: true,
      fileChanges: [{
        file_path: targetPath,
        change_type: "update",
        after_snapshot: "blocked after\n",
        summary_of_change: "Should not apply.",
      }],
      createdAt: "2026-04-25T09:50:00.000Z",
      allowedRoots: [relativeRoot],
    });

    assert.equal(result.status, "blocked");
    assert.ok(result.blockers.some((blocker) => blocker.code === "disallowed_action"));
    assert.equal(await readFile(path.join(absoluteRoot, "blocked.txt"), "utf8"), "blocked before\n");
  });
});

test("invalid packet blocks execution", async () => {
  const result = await executeControlledPatch({
    applicationPacket: null,
    approval: true,
    fileChanges: [],
    createdAt: "2026-04-25T10:00:00.000Z",
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_application_packet"));
});

test("logs capture all steps", async () => {
  await withSandbox("controlled-exec-logs", async ({ absoluteRoot, relativeRoot }) => {
    const targetPath = `${relativeRoot}/logs.txt`;
    await writeFile(path.join(absoluteRoot, "logs.txt"), "logs before\n", "utf8");
    const result = await executeControlledPatch({
      applicationPacket: buildPacket([targetPath]),
      approval: true,
      fileChanges: [{
        file_path: targetPath,
        change_type: "update",
        after_snapshot: "logs after\n",
        summary_of_change: "Update log file.",
      }],
      createdAt: "2026-04-25T10:10:00.000Z",
      allowedRoots: [relativeRoot],
    });

    assert.ok(result.logs.some((log) => log.step === "preview"));
    assert.ok(result.logs.some((log) => log.step === "validate"));
    assert.ok(result.logs.some((log) => log.step === "apply"));
  });
});

test("deterministic execution", async () => {
  await withSandbox("controlled-exec-deterministic", async ({ absoluteRoot, relativeRoot }) => {
    const targetPath = `${relativeRoot}/deterministic.txt`;
    await writeFile(path.join(absoluteRoot, "deterministic.txt"), "stable before\n", "utf8");
    const fileChanges: ControlledExecutionDiff[] = [{
      file_path: targetPath,
      change_type: "update",
      after_snapshot: "stable after\n",
      summary_of_change: "Stable update.",
    }];

    const first = await executeControlledPatch({
      applicationPacket: buildPacket([targetPath]),
      approval: false,
      fileChanges,
      createdAt: "2026-04-25T10:20:00.000Z",
      allowedRoots: [relativeRoot],
    });
    const second = await executeControlledPatch({
      applicationPacket: buildPacket([targetPath]),
      approval: false,
      fileChanges,
      createdAt: "2026-04-25T10:20:00.000Z",
      allowedRoots: [relativeRoot],
    });

    assert.deepEqual(second.preview_diff, first.preview_diff);
    assert.deepEqual(second.logs, first.logs);
  });
});

test("works with reviewed patch application packet", async () => {
  await withSandbox("controlled-exec-reviewed-packet", async ({ absoluteRoot, relativeRoot }) => {
    const targetPath = `${relativeRoot}/reviewed-packet.txt`;
    await writeFile(path.join(absoluteRoot, "reviewed-packet.txt"), "reviewed before\n", "utf8");
    const packet = await buildReviewedPacketForSandbox(targetPath);
    const result = await executeControlledPatch({
      applicationPacket: packet,
      approval: true,
      fileChanges: [{
        file_path: targetPath,
        change_type: "update",
        after_snapshot: "reviewed after\n",
        summary_of_change: "Apply reviewed packet mutation in sandbox.",
      }],
      createdAt: "2026-04-25T10:30:00.000Z",
      allowedRoots: [relativeRoot],
    });
    const summary = summarizeExecution(result);

    assert.equal(result.status, "applied");
    assert.equal(await readFile(path.join(absoluteRoot, "reviewed-packet.txt"), "utf8"), "reviewed after\n");
    assert.match(summary, /Controlled execution status: applied/i);
  });
});