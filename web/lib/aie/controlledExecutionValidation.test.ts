import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { executeControlledPatch } from "./controlledPatchExecutor";
import {
  runControlledValidation,
  summarizeValidation,
  type ControlledValidationInput,
} from "./controlledExecutionValidation";
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
    application_packet_id: "application-packet-20260425110000-validation-test",
    source_draft_id: "patch-draft-1",
    source_decision_id: "decision-1",
    source_patch_plan_id: "patch-plan-1",
    source_dry_run_id: "dry-run-1",
    source_handoff_id: "handoff-1",
    source_artifact_id: "artifact-1",
    created_at: "2026-04-25T11:00:00.000Z",
    interpreted_goal: "Apply one reviewed file change safely.",
    risk_level: "low",
    application_instructions: ["Stay within the reviewed file target.", "Show the diff before applying."],
    affected_targets: [...targets],
    validation_requirements: [{ title: "Run focused tests", details: "Run only the reviewed slice.", required: true }],
    git_commit_plan: {
      commit_message: "feat(execution): validate reviewed controlled patch",
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
    createdAt: "2026-04-25T11:10:00.000Z",
  }), "approved");
  const executionDecision = evaluateArtifactForExecution(artifact);
  const handoff = createReviewedExecutionHandoff({ artifact, decision: executionDecision });
  assert.ok(handoff.handoff_packet);
  const dryRun = runExecutionDryRun({ handoffPacket: handoff.handoff_packet, createdAt: "2026-04-25T11:20:00.000Z" });
  const prep = prepareReviewedPatchPlan({ report: dryRun, createdAt: "2026-04-25T11:30:00.000Z" });
  const applicationGate = evaluatePatchPlanForApplication({ preparationResult: prep, createdAt: "2026-04-25T11:40:00.000Z" });
  assert.ok(applicationGate.decision);
  const draftResult = generateReviewedPatchDraft({ decision: applicationGate.decision, createdAt: "2026-04-25T11:50:00.000Z" });
  const applicationResult = createReviewedPatchApplicationPacket({ draftResult, createdAt: "2026-04-25T12:00:00.000Z" });
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

async function buildAppliedValidationInput(prefix: string): Promise<ControlledValidationInput & { absoluteRoot: string; targetPath: string; relativeRoot: string }> {
  const sandbox = await createSandboxRoot(prefix);
  const targetPath = `${sandbox.relativeRoot}/validated.txt`;
  await writeFile(path.join(sandbox.absoluteRoot, "validated.txt"), "before\n", "utf8");
  const packet = buildPacket([targetPath]);
  const executionResult = await executeControlledPatch({
    applicationPacket: packet,
    approval: true,
    fileChanges: [{
      file_path: targetPath,
      change_type: "update",
      after_snapshot: "after\n",
      summary_of_change: "Apply reviewed validation change.",
    }],
    createdAt: "2026-04-25T12:10:00.000Z",
    allowedRoots: [sandbox.relativeRoot],
  });

  return {
    executionResult,
    applicationPacket: packet,
    createdAt: "2026-04-25T12:20:00.000Z",
    allowedRoots: [sandbox.relativeRoot],
    absoluteRoot: sandbox.absoluteRoot,
    targetPath,
    relativeRoot: sandbox.relativeRoot,
  };
}

test("valid execution returns validation_passed", async () => {
  const input = await buildAppliedValidationInput("controlled-validation-pass");
  try {
    const result = await runControlledValidation(input);

    assert.equal(result.status, "validation_passed");
    assert.equal(result.recommendation, "keep_changes");
  } finally {
    await rm(input.absoluteRoot, { recursive: true, force: true });
  }
});

test("mismatched file content returns validation_failed", async () => {
  const input = await buildAppliedValidationInput("controlled-validation-mismatch");
  try {
    await writeFile(path.join(input.absoluteRoot, "validated.txt"), "tampered\n", "utf8");
    const result = await runControlledValidation(input);

    assert.equal(result.status, "validation_failed");
    assert.ok(result.failures.some((failure) => failure.code === "content_mismatch"));
  } finally {
    await rm(input.absoluteRoot, { recursive: true, force: true });
  }
});

test("missing file returns validation_failed", async () => {
  const input = await buildAppliedValidationInput("controlled-validation-missing");
  try {
    await rm(path.join(input.absoluteRoot, "validated.txt"), { force: true });
    const result = await runControlledValidation(input);

    assert.equal(result.status, "validation_failed");
    assert.ok(result.failures.some((failure) => failure.code === "missing_file"));
  } finally {
    await rm(input.absoluteRoot, { recursive: true, force: true });
  }
});

test("unexpected file change returns validation_failed", async () => {
  const input = await buildAppliedValidationInput("controlled-validation-unexpected");
  try {
    const result = await runControlledValidation({
      ...input,
      executionResult: {
        ...input.executionResult,
        changed_files: [...input.executionResult.changed_files, `${input.relativeRoot}/unexpected.txt`],
      },
    });

    assert.equal(result.status, "validation_failed");
    assert.ok(result.failures.some((failure) => failure.code === "unexpected_changed_file"));
  } finally {
    await rm(input.absoluteRoot, { recursive: true, force: true });
  }
});

test("clean result recommends keep_changes", async () => {
  const input = await buildAppliedValidationInput("controlled-validation-keep");
  try {
    const result = await runControlledValidation(input);

    assert.equal(result.recommendation, "keep_changes");
  } finally {
    await rm(input.absoluteRoot, { recursive: true, force: true });
  }
});

test("failed result recommends rollback", async () => {
  const input = await buildAppliedValidationInput("controlled-validation-rollback");
  try {
    await writeFile(path.join(input.absoluteRoot, "validated.txt"), "tampered\n", "utf8");
    const result = await runControlledValidation(input);

    assert.equal(result.recommendation, "rollback");
  } finally {
    await rm(input.absoluteRoot, { recursive: true, force: true });
  }
});

test("deterministic output", async () => {
  const input = await buildAppliedValidationInput("controlled-validation-deterministic");
  try {
    const first = await runControlledValidation(input);
    const second = await runControlledValidation(input);

    assert.deepEqual(second, first);
  } finally {
    await rm(input.absoluteRoot, { recursive: true, force: true });
  }
});

test("works with controlledPatchExecutor output", async () => {
  await withSandbox("controlled-validation-executor-output", async ({ absoluteRoot, relativeRoot }) => {
    const targetPath = `${relativeRoot}/executor-output.txt`;
    await writeFile(path.join(absoluteRoot, "executor-output.txt"), "executor before\n", "utf8");
    const packet = await buildReviewedPacketForSandbox(targetPath);
    const executionResult = await executeControlledPatch({
      applicationPacket: packet,
      approval: true,
      fileChanges: [{
        file_path: targetPath,
        change_type: "update",
        after_snapshot: "executor after\n",
        summary_of_change: "Apply reviewed packet mutation.",
      }],
      createdAt: "2026-04-25T12:30:00.000Z",
      allowedRoots: [relativeRoot],
    });
    const result = await runControlledValidation({
      executionResult,
      applicationPacket: packet,
      createdAt: "2026-04-25T12:40:00.000Z",
      allowedRoots: [relativeRoot],
    });

    assert.equal(result.status, "validation_passed");
    assert.equal(await readFile(path.join(absoluteRoot, "executor-output.txt"), "utf8"), "executor after\n");
  });
});

test("readable summary", async () => {
  const input = await buildAppliedValidationInput("controlled-validation-summary");
  try {
    const result = await runControlledValidation(input);
    const summary = summarizeValidation(result);

    assert.match(summary, /Controlled validation status:/i);
    assert.match(summary, /Recommendation:/i);
    assert.match(summary, /Explanation:/i);
  } finally {
    await rm(input.absoluteRoot, { recursive: true, force: true });
  }
});

test("no side effects during validation", async () => {
  const input = await buildAppliedValidationInput("controlled-validation-side-effects");
  try {
    const before = await readFile(path.join(input.absoluteRoot, "validated.txt"), "utf8");
    await runControlledValidation(input);
    const after = await readFile(path.join(input.absoluteRoot, "validated.txt"), "utf8");

    assert.equal(after, before);
  } finally {
    await rm(input.absoluteRoot, { recursive: true, force: true });
  }
});