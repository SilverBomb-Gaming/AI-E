import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceEliteAgentWorkflow,
  buildEliteAgentWorkflowSession,
  listEliteAgentWorkflowStageDefinitions,
  markEliteAgentWorkflowValidation,
  resumeEliteAgentWorkflow,
  summarizeEliteAgentWorkflow,
  type EliteAgentWorkflowStageType,
} from "./eliteAgentWorkflowEngine";

const baseInput = {
  agentId: "lite-elite-repo-maintainer-01",
  allowedPaths: ["runner_artifacts/lite_elite_agent"],
  now: "2026-05-12T12:00:00.000Z",
};

function stageTypesFor(prompt: string): EliteAgentWorkflowStageType[] {
  return buildEliteAgentWorkflowSession({ ...baseInput, prompt }).stages.map((stage) => stage.type);
}

test("deterministic workflow generation maps inspection prompts to read and report stages", () => {
  assert.deepEqual(stageTypesFor("inspect the inventory system"), ["READ_REPO_CONTEXT", "GENERATE_REPORT"]);
});

test("deterministic workflow generation maps safe patch prompts to approval-aware chains", () => {
  assert.deepEqual(stageTypesFor("prepare a safe movement patch"), ["READ_REPO_CONTEXT", "PREPARE_PATCH", "REQUEST_APPROVAL"]);
});

test("deterministic workflow generation blocks automatic patch application until approval route exists", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "apply the patch automatically" });

  assert.deepEqual(session.stages.map((stage) => stage.type), ["BLOCKED_EXTERNAL_DEPENDENCY"]);
  assert.equal(session.status, "BLOCKED");
  assert.match(session.blockedStageReason ?? "", /approval|runtime route/i);
});

test("deterministic workflow generation maps verification prompts to verify validate report", () => {
  assert.deepEqual(stageTypesFor("verify the latest gameplay patch"), ["VERIFY_BUILD", "VALIDATE_PATCH", "GENERATE_REPORT"]);
});

test("workflow lifecycle transitions maintain ordered supervised progression", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "inspect the inventory system" });
  const firstStage = session.stages[0]!;
  const secondStage = session.stages[1]!;

  const started = advanceEliteAgentWorkflow(session, { stageId: firstStage.stageId, action: "START_STAGE", now: "2026-05-12T12:00:01.000Z" });
  assert.equal(started.stages[0]?.lifecycleState, "RUNNING");

  const completedFirst = advanceEliteAgentWorkflow(started, { stageId: firstStage.stageId, action: "COMPLETE_STAGE", now: "2026-05-12T12:00:02.000Z" });
  assert.equal(completedFirst.stages[0]?.lifecycleState, "COMPLETED");
  assert.equal(completedFirst.status, "PARTIALLY_COMPLETED");
  assert.equal(completedFirst.currentStageId, secondStage.stageId);

  const startedSecond = advanceEliteAgentWorkflow(completedFirst, { stageId: secondStage.stageId, action: "START_STAGE", now: "2026-05-12T12:00:03.000Z" });
  const completedSecond = advanceEliteAgentWorkflow(startedSecond, { stageId: secondStage.stageId, action: "COMPLETE_STAGE", now: "2026-05-12T12:00:04.000Z" });

  assert.equal(completedSecond.status, "COMPLETED");
  assert.equal(completedSecond.completedStageCount, 2);
  assert.equal(completedSecond.logs.length >= 5, true);
});

test("workflow engine prevents unsafe out-of-order transitions", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const patchStage = session.stages[1]!;

  assert.throws(() => advanceEliteAgentWorkflow(session, {
    stageId: patchStage.stageId,
    action: "START_STAGE",
    now: "2026-05-12T12:00:01.000Z",
  }), /cannot run before/i);
});

test("mutation-capable stages remain blocked without explicit approval", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const readStage = session.stages[0]!;
  const patchStage = session.stages[1]!;
  const afterRead = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(session, { stageId: readStage.stageId, action: "START_STAGE" }),
    { stageId: readStage.stageId, action: "COMPLETE_STAGE" },
  );

  const blocked = advanceEliteAgentWorkflow(afterRead, { stageId: patchStage.stageId, action: "START_STAGE" });

  assert.equal(blocked.stages[1]?.lifecycleState, "BLOCKED");
  assert.equal(blocked.stages[1]?.approvalState, "BLOCKED");
  assert.match(blocked.blockedStageReason ?? "", /approval/i);
});

test("approval checkpoints allow mutation-capable stages to start but still require validation", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const readStage = session.stages[0]!;
  const patchStage = session.stages[1]!;
  const afterRead = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(session, { stageId: readStage.stageId, action: "START_STAGE" }),
    { stageId: readStage.stageId, action: "COMPLETE_STAGE" },
  );
  const approved = advanceEliteAgentWorkflow(afterRead, { stageId: patchStage.stageId, action: "APPROVE_STAGE" });
  const running = advanceEliteAgentWorkflow(approved, { stageId: patchStage.stageId, action: "START_STAGE" });
  const blockedCompletion = advanceEliteAgentWorkflow(running, { stageId: patchStage.stageId, action: "COMPLETE_STAGE" });

  assert.equal(approved.stages[1]?.approvalState, "APPROVED");
  assert.equal(running.stages[1]?.lifecycleState, "RUNNING");
  assert.equal(blockedCompletion.stages[1]?.lifecycleState, "BLOCKED");
  assert.match(blockedCompletion.blockedStageReason ?? "", /Validation-required/);
});

test("validation-required stages support validation pending and success before completion", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "verify the latest gameplay patch" });
  const verifyStage = session.stages[0]!;
  const running = advanceEliteAgentWorkflow(session, { stageId: verifyStage.stageId, action: "START_STAGE" });
  const validating = advanceEliteAgentWorkflow(running, { stageId: verifyStage.stageId, action: "BEGIN_VALIDATION" });
  const validated = markEliteAgentWorkflowValidation(validating, { stageId: verifyStage.stageId, validationState: "SUCCESS" });
  const completed = advanceEliteAgentWorkflow(validated, { stageId: verifyStage.stageId, action: "COMPLETE_STAGE" });

  assert.equal(validating.stages[0]?.lifecycleState, "VALIDATING");
  assert.equal(validated.stages[0]?.validationState, "SUCCESS");
  assert.equal(completed.stages[0]?.lifecycleState, "COMPLETED");
});

test("rollback metadata is prepared without executing autonomous rollback", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const readStage = session.stages[0]!;
  const patchStage = session.stages[1]!;
  const afterRead = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(session, { stageId: readStage.stageId, action: "START_STAGE" }),
    { stageId: readStage.stageId, action: "COMPLETE_STAGE" },
  );
  const approved = advanceEliteAgentWorkflow(afterRead, { stageId: patchStage.stageId, action: "APPROVE_STAGE" });
  const running = advanceEliteAgentWorkflow(approved, { stageId: patchStage.stageId, action: "START_STAGE" });
  const rollback = advanceEliteAgentWorkflow(running, {
    stageId: patchStage.stageId,
    action: "PREPARE_ROLLBACK",
    reason: "Patch preparation can be reverted by operator review.",
  });

  assert.equal(rollback.rollbackAvailable, true);
  assert.equal(rollback.rollbackPrepared, true);
  assert.match(rollback.rollbackReason ?? "", /operator review/i);
});

test("workflow summaries expose approval validation rollback and stage history", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const summary = summarizeEliteAgentWorkflow(session);

  assert.equal(summary.workflowSessionId, "elite-workflow-lite-elite-repo-maintainer-01-20260512120000");
  assert.deepEqual(summary.stageTypes, ["READ_REPO_CONTEXT", "PREPARE_PATCH", "REQUEST_APPROVAL"]);
  assert.equal(summary.approvalCheckpoints.length, 2);
  assert.equal(summary.validationCheckpoints.length, 1);
  assert.equal(summary.rollbackAvailable, false);
  assert.match(summary.truthfulCapabilityBoundary, /supervised multi-step workflow/i);
});

test("safe path enforcement blocks unsafe workflow scopes", () => {
  const session = buildEliteAgentWorkflowSession({
    ...baseInput,
    prompt: "inspect the inventory system",
    allowedPaths: ["../outside"],
  });

  assert.equal(session.status, "BLOCKED");
  assert.deepEqual(session.stages.map((stage) => stage.type), ["BLOCKED_EXTERNAL_DEPENDENCY"]);
  assert.match(session.deterministicSelectionReason, /Unsafe workflow path rejected/i);
});

test("stage definitions include requested workflow categories and governance metadata", () => {
  const definitions = listEliteAgentWorkflowStageDefinitions(["runner_artifacts/lite_elite_agent"]);
  const stageTypes = definitions.map((definition) => definition.type);

  assert.deepEqual(stageTypes, [
    "READ_REPO_CONTEXT",
    "PREPARE_PATCH",
    "VALIDATE_PATCH",
    "VERIFY_BUILD",
    "GENERATE_REPORT",
    "REQUEST_APPROVAL",
    "BLOCKED_EXTERNAL_DEPENDENCY",
  ]);
  assert.equal(definitions.find((definition) => definition.type === "PREPARE_PATCH")?.mutationPermission, "MUTATION_REQUIRES_APPROVAL");
  assert.equal(definitions.find((definition) => definition.type === "VERIFY_BUILD")?.validationRequired, true);
  assert.equal(definitions.find((definition) => definition.type === "REQUEST_APPROVAL")?.externalDependencyRequired, true);
});

test("workflow boundary avoids unrestricted execution claims", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "inspect the inventory system" });

  assert.match(session.truthfulCapabilityBoundary, /bounded paths/);
  assert.doesNotMatch(session.truthfulCapabilityBoundary, /fully autonomous|AGI|unattended indefinitely|autonomous_real/i);
});

test("paused workflows can be marked resumable and resume from the correct stage", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "inspect the inventory system" });
  const readStage = session.stages[0]!;
  const running = advanceEliteAgentWorkflow(session, { stageId: readStage.stageId, action: "START_STAGE" });
  const paused = advanceEliteAgentWorkflow(running, { stageId: readStage.stageId, action: "PAUSE_WORKFLOW", reason: "Operator paused during context review." });
  const resumable = advanceEliteAgentWorkflow(paused, { stageId: readStage.stageId, action: "MARK_RESUMABLE" });
  const resumed = resumeEliteAgentWorkflow(resumable, { now: "2026-05-12T12:10:00.000Z" });

  assert.equal(paused.status, "PAUSED");
  assert.equal(resumable.status, "RESUMABLE");
  assert.equal(resumable.resumeEligible, true);
  assert.equal(resumable.resumeFromStageId, readStage.stageId);
  assert.equal(resumed.stages[0]?.lifecycleState, "RUNNING");
});

test("interrupted workflows require resumable marking before continuation", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "inspect the inventory system" });
  const readStage = session.stages[0]!;
  const running = advanceEliteAgentWorkflow(session, { stageId: readStage.stageId, action: "START_STAGE" });
  const interrupted = advanceEliteAgentWorkflow(running, { stageId: readStage.stageId, action: "INTERRUPT_WORKFLOW", reason: "Terminal closed during inspection." });

  assert.equal(interrupted.status, "INTERRUPTED");
  assert.equal(interrupted.resumeEligible, false);
  assert.throws(() => resumeEliteAgentWorkflow(interrupted), /not marked resumable|No resumable/i);

  const resumable = advanceEliteAgentWorkflow(interrupted, { stageId: readStage.stageId, action: "MARK_RESUMABLE" });
  assert.equal(resumable.status, "RESUMABLE");
  assert.equal(resumable.resumeEligible, true);
});

test("approval-aware resume keeps mutation stages blocked without approval", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const readStage = session.stages[0]!;
  const patchStage = session.stages[1]!;
  const afterRead = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(session, { stageId: readStage.stageId, action: "START_STAGE" }),
    { stageId: readStage.stageId, action: "COMPLETE_STAGE" },
  );
  const pausedPatch = advanceEliteAgentWorkflow(afterRead, { stageId: patchStage.stageId, action: "PAUSE_WORKFLOW" });
  const resumablePatch = advanceEliteAgentWorkflow(pausedPatch, { stageId: patchStage.stageId, action: "MARK_RESUMABLE" });
  const resumed = resumeEliteAgentWorkflow(resumablePatch);

  assert.equal(resumed.status, "BLOCKED");
  assert.match(resumed.blockedStageReason ?? "", /approval/i);
  assert.equal(resumed.stages[1]?.approvalState, "BLOCKED");
});
