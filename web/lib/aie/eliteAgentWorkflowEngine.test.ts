import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceEliteAgentWorkflow,
  buildEliteAgentApprovalGateGuidance,
  buildEliteAgentBlockedWorkflowRecoveryGuidance,
  buildEliteAgentWorkflowSession,
  convertBlockedWorkflowToSafePatchPreparation,
  isEliteAgentWorkflowStageAutoAdvancable,
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
  assert.deepEqual(stageTypesFor("prepare a safe movement patch"), ["REQUEST_APPROVAL", "READ_REPO_CONTEXT", "PREPARE_PATCH", "GENERATE_REPORT"]);
});

test("deterministic workflow generation maps concrete game-dev changes to approval-aware chains", () => {
  const prompts = [
    "I need you to take a look at my current BABYLON game and have the gameplay loop reach round 5, spawn 5 zombies and increase their health.",
    "Modify my enemy spawner so it creates 5 zombies.",
    "Update the round system so the game reaches round 5.",
  ];

  for (const prompt of prompts) {
    const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt });

    assert.deepEqual(session.stages.map((stage) => stage.type), ["REQUEST_APPROVAL", "READ_REPO_CONTEXT", "PREPARE_PATCH", "GENERATE_REPORT"], prompt);
    assert.match(session.deterministicSelectionReason, /session-level approval/i, prompt);
  }
});

test("deterministic workflow generation blocks automatic patch application until approval route exists", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "apply the patch automatically" });

  assert.deepEqual(session.stages.map((stage) => stage.type), ["BLOCKED_EXTERNAL_DEPENDENCY"]);
  assert.equal(session.status, "BLOCKED");
  assert.match(session.blockedStageReason ?? "", /approval|runtime route/i);
});

test("blocked automatic patch workflows expose safe recovery guidance", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "apply the patch automatically" });
  const guidance = buildEliteAgentBlockedWorkflowRecoveryGuidance(session);

  assert.equal(guidance?.title, "Safe Recovery Path");
  assert.equal(guidance?.kind, "automatic_patch_application");
  assert.match(guidance?.blockedExplanation ?? "", /Blocked:/);
  assert.match(guidance?.safetyRuleTriggered ?? "", /Automatic file mutation requires/i);
  assert.match(guidance?.safeAlternative ?? "", /Prepare the patch first/i);
  assert.deepEqual(guidance?.actions.map((action) => action.label), [
    "Prepare Safe Patch Instead",
    "Request Approval",
    "Explain Blocker",
  ]);
});

test("blocked automatic patch workflows convert to safe patch preparation without applying", () => {
  const blocked = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "apply the patch automatically" });
  const safe = convertBlockedWorkflowToSafePatchPreparation(blocked, { now: "2026-05-12T12:14:00.000Z" });

  assert.equal(blocked.status, "BLOCKED");
  assert.deepEqual(safe.stages.map((stage) => stage.type), ["REQUEST_APPROVAL", "READ_REPO_CONTEXT", "PREPARE_PATCH", "GENERATE_REPORT"]);
  assert.equal(safe.status, "PENDING");
  assert.match(safe.deterministicSelectionReason, /original blocked workflow remains visible and no patch was applied/i);
  assert.doesNotMatch(safe.deterministicSelectionReason, /applied successfully|executed/i);
});

test("deterministic workflow generation maps verification prompts to verify validate report", () => {
  assert.deepEqual(stageTypesFor("verify the latest gameplay patch"), ["VERIFY_BUILD", "VALIDATE_PATCH", "GENERATE_REPORT"]);
});

test("deterministic workflow generation maps dummy workflow prompts to simulation-safe progression chains", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "Run a 10-second dummy workflow so I can test the progress bar and completion state." });

  assert.deepEqual(session.stages.map((stage) => stage.type), ["READ_REPO_CONTEXT", "VERIFY_BUILD", "GENERATE_REPORT"]);
  assert.equal(session.status, "PENDING");
  assert.match(session.deterministicSelectionReason, /Demo workflow prompt selected/i);
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
  const readStage = session.stages[1]!;

  assert.throws(() => advanceEliteAgentWorkflow(session, {
    stageId: readStage.stageId,
    action: "START_STAGE",
    now: "2026-05-12T12:00:01.000Z",
  }), /cannot run before/i);
});

test("session approval is the first human gate for concrete dev workflows", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const approvalStage = session.stages[0]!;
  const approvalPending = buildEliteAgentApprovalGateGuidance(session);

  assert.equal(session.currentStageId, approvalStage.stageId);
  assert.equal(approvalPending?.workflowStage, "REQUEST_APPROVAL");
  assert.equal(approvalPending?.approvalGateState, "WAITING_FOR_APPROVAL");
  assert.equal(approvalPending?.actionBeingApproved, "Scoped dev session boundary");
});

test("auto-advancement rules start after session approval and stay inside low-risk stages", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const approvalStage = session.stages[0]!;
  const readStage = session.stages[1]!;
  const patchStage = session.stages[2]!;
  const reportStage = session.stages[3]!;

  assert.equal(isEliteAgentWorkflowStageAutoAdvancable(approvalStage), false);
  assert.equal(isEliteAgentWorkflowStageAutoAdvancable(readStage), true);
  assert.equal(isEliteAgentWorkflowStageAutoAdvancable(patchStage), true);
  assert.equal(isEliteAgentWorkflowStageAutoAdvancable(reportStage), true);

  const approved = advanceEliteAgentWorkflow(session, { stageId: approvalStage.stageId, action: "APPROVE_STAGE" });
  assert.equal(approved.currentStageId, readStage.stageId);
  assert.equal(isEliteAgentWorkflowStageAutoAdvancable(approved.stages[1]), true);

  const afterRead = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(approved, { stageId: readStage.stageId, action: "START_STAGE" }),
    { stageId: readStage.stageId, action: "COMPLETE_STAGE" },
  );
  assert.equal(afterRead.currentStageId, patchStage.stageId);
  assert.equal(isEliteAgentWorkflowStageAutoAdvancable(afterRead.stages[2]), true);
});

test("session approval completes the human gate without claiming execution", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const approvalStage = session.stages[0]!;
  const readStage = session.stages[1]!;
  const approved = advanceEliteAgentWorkflow(session, { stageId: approvalStage.stageId, action: "APPROVE_STAGE" });

  assert.equal(approved.stages[0]?.approvalState, "APPROVED");
  assert.equal(approved.stages[0]?.lifecycleState, "COMPLETED");
  assert.equal(approved.currentStageId, readStage.stageId);
  assert.equal(approved.status, "PARTIALLY_COMPLETED");
});

test("approval gate guidance explains the supervised action before approval", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const guidance = buildEliteAgentApprovalGateGuidance(session);

  assert.equal(guidance?.title, "Approval Required");
  assert.equal(guidance?.approvalGateState, "WAITING_FOR_APPROVAL");
  assert.equal(guidance?.workflowStage, "REQUEST_APPROVAL");
  assert.equal(guidance?.actionBeingApproved, "Scoped dev session boundary");
  assert.deepEqual(guidance?.allowedPathScope, ["runner_artifacts/lite_elite_agent"]);
  assert.equal(guidance?.mutationPermission, "NO_MUTATION");
  assert.match(guidance?.whatHappensAfterApproval ?? "", /in-scope, low-risk workflow stages automatically/i);
  assert.match(guidance?.allowedToDo ?? "", /inspect scoped repo context/i);
  assert.match(guidance?.notAllowedToDo ?? "", /auto-apply patches|unrestricted shell/i);
});

test("approval grant records approved-by-operator event without fake execution", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const approvalStage = session.stages[0]!;
  const approved = advanceEliteAgentWorkflow(session, {
    stageId: approvalStage.stageId,
    action: "APPROVE_STAGE",
    reason: "Operator approved this supervised stage only.",
    now: "2026-05-12T12:15:00.000Z",
  });

  assert.equal(approved.stages[0]?.approvalState, "APPROVED");
  assert.equal(approved.stages[0]?.lifecycleState, "COMPLETED");
  assert.equal(approved.status, "PARTIALLY_COMPLETED");
  assert.equal(approved.approvalEvents.at(-1)?.approvalGateState, "APPROVED_BY_OPERATOR");
  assert.equal(approved.approvalEvents.at(-1)?.stageType, "REQUEST_APPROVAL");
  assert.doesNotMatch(approved.approvalEvents.at(-1)?.message ?? "", /applied|executed automatically/i);
});

test("approval denial safely blocks the workflow and records denial history", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const approvalStage = session.stages[0]!;
  const denied = advanceEliteAgentWorkflow(session, {
    stageId: approvalStage.stageId,
    action: "DENY_STAGE_APPROVAL",
    reason: "Approval denied by operator.",
    now: "2026-05-12T12:16:00.000Z",
  });

  assert.equal(denied.status, "BLOCKED");
  assert.equal(denied.stages[0]?.approvalState, "REJECTED");
  assert.equal(denied.approvalEvents.at(-1)?.approvalGateState, "APPROVAL_DENIED");
  assert.match(denied.blockedStageReason ?? "", /denied/i);
  const stillBlocked = advanceEliteAgentWorkflow(denied, { stageId: approvalStage.stageId, action: "START_STAGE" });
  assert.equal(stillBlocked.status, "BLOCKED");
  assert.equal(stillBlocked.stages[0]?.approvalState, "REJECTED");
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
  const approvalStage = session.stages[0]!;
  const readStage = session.stages[1]!;
  const patchStage = session.stages[2]!;
  const approved = advanceEliteAgentWorkflow(session, { stageId: approvalStage.stageId, action: "APPROVE_STAGE" });
  const afterRead = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(approved, { stageId: readStage.stageId, action: "START_STAGE" }),
    { stageId: readStage.stageId, action: "COMPLETE_STAGE" },
  );
  const running = advanceEliteAgentWorkflow(afterRead, { stageId: patchStage.stageId, action: "START_STAGE" });
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
  assert.deepEqual(summary.stageTypes, ["REQUEST_APPROVAL", "READ_REPO_CONTEXT", "PREPARE_PATCH", "GENERATE_REPORT"]);
  assert.equal(summary.approvalCheckpoints.length, 1);
  assert.equal(summary.validationCheckpoints.length, 0);
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
  assert.equal(definitions.find((definition) => definition.type === "PREPARE_PATCH")?.mutationPermission, "READ_ONLY");
  assert.equal(definitions.find((definition) => definition.type === "PREPARE_PATCH")?.validationRequired, false);
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

test("approval-aware resume allows safe preparation but keeps approval checkpoint pending", () => {
  const session = buildEliteAgentWorkflowSession({ ...baseInput, prompt: "prepare a safe movement patch" });
  const approvalStage = session.stages[0]!;
  const readStage = session.stages[1]!;
  const patchStage = session.stages[2]!;
  const approved = advanceEliteAgentWorkflow(session, { stageId: approvalStage.stageId, action: "APPROVE_STAGE" });
  const afterRead = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(approved, { stageId: readStage.stageId, action: "START_STAGE" }),
    { stageId: readStage.stageId, action: "COMPLETE_STAGE" },
  );
  const pausedPatch = advanceEliteAgentWorkflow(afterRead, { stageId: patchStage.stageId, action: "PAUSE_WORKFLOW" });
  const resumablePatch = advanceEliteAgentWorkflow(pausedPatch, { stageId: patchStage.stageId, action: "MARK_RESUMABLE" });
  const resumed = resumeEliteAgentWorkflow(resumablePatch);

  assert.equal(resumed.status, "RUNNING");
  assert.equal(resumed.stages[0]?.approvalState, "APPROVED");
  assert.equal(resumed.stages[2]?.lifecycleState, "RUNNING");
});
