import assert from "node:assert/strict";
import test from "node:test";

import {
  convertRefinementToPlannerRequest,
  refineConversationalIntent,
} from "./conversationalIntentRefinement";
import { createOperatorLightPlan } from "./operatorLightPlanner";
import { evaluateArtifactForExecution } from "./artifactExecutionConsumer";
import {
  createCombinedIntakePacket,
  createSessionArtifact,
  updateSessionArtifactStatus,
} from "./sessionArtifacts";
import { createReviewedExecutionHandoff } from "./reviewedExecutionBridge";
import { runExecutionDryRun } from "./executionDryRunRunner";
import { prepareReviewedPatchPlan } from "./reviewedPatchPreparation";
import {
  evaluatePatchPlanForApplication,
  summarizePatchApplicationGate,
} from "./reviewedPatchApplicationGate";

function buildPatchPreparationResult() {
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
    createdAt: "2026-04-24T12:00:00.000Z",
  }), "approved");
  const decision = evaluateArtifactForExecution(artifact);
  const handoff = createReviewedExecutionHandoff({ artifact, decision });
  assert.ok(handoff.handoff_packet);
  const dryRun = runExecutionDryRun({ handoffPacket: handoff.handoff_packet, createdAt: "2026-04-24T13:00:00.000Z" });
  return prepareReviewedPatchPlan({ report: dryRun, createdAt: "2026-04-24T14:00:00.000Z" });
}

test("valid patch plan returns application_eligible", () => {
  const preparationResult = buildPatchPreparationResult();
  const result = evaluatePatchPlanForApplication({ preparationResult, createdAt: "2026-04-24T15:00:00.000Z" });

  assert.equal(result.status, "application_eligible");
  assert.equal(result.decision?.eligible_for_application, true);
});

test("blocked patch plan returns application_blocked", () => {
  const preparationResult = {
    ...buildPatchPreparationResult(),
    status: "patch_plan_blocked" as const,
  };
  const result = evaluatePatchPlanForApplication({ preparationResult });

  assert.equal(result.status, "application_blocked");
  assert.equal(result.decision, null);
});

test("high-risk patch plan blocks", () => {
  const base = buildPatchPreparationResult();
  const preparationResult = {
    ...base,
    patch_plan: base.patch_plan ? { ...base.patch_plan, risk_level: "high" as const } : null,
  };
  const result = evaluatePatchPlanForApplication({ preparationResult });

  assert.equal(result.status, "high_risk_blocked");
  assert.equal(result.decision, null);
});

test("missing planned change groups blocks", () => {
  const base = buildPatchPreparationResult();
  const preparationResult = {
    ...base,
    patch_plan: base.patch_plan ? { ...base.patch_plan, planned_change_groups: [] } : null,
  };
  const result = evaluatePatchPlanForApplication({ preparationResult });

  assert.equal(result.status, "application_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_planned_change_groups"));
});

test("change group with mutation_allowed true blocks", () => {
  const base = buildPatchPreparationResult();
  const preparationResult = {
    ...base,
    patch_plan: base.patch_plan ? {
      ...base.patch_plan,
      planned_change_groups: [{ ...base.patch_plan.planned_change_groups[0]!, mutation_allowed: true as never }],
    } : null,
  };
  const result = evaluatePatchPlanForApplication({ preparationResult });

  assert.equal(result.status, "application_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "planned_change_group_mutation_violation"));
});

test("missing validation requirements blocks", () => {
  const base = buildPatchPreparationResult();
  const preparationResult = {
    ...base,
    patch_plan: base.patch_plan ? { ...base.patch_plan, validation_requirements: [] } : null,
  };
  const result = evaluatePatchPlanForApplication({ preparationResult });

  assert.equal(result.status, "application_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_validation_requirements"));
});

test("missing git commit plan blocks", () => {
  const base = buildPatchPreparationResult();
  const preparationResult = {
    ...base,
    patch_plan: base.patch_plan ? { ...base.patch_plan, git_commit_plan: null as never } : null,
  };
  const result = evaluatePatchPlanForApplication({ preparationResult });

  assert.equal(result.status, "application_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_git_commit_plan"));
});

test("missing required disallowed actions blocks", () => {
  const base = buildPatchPreparationResult();
  const preparationResult = {
    ...base,
    patch_plan: base.patch_plan ? {
      ...base.patch_plan,
      disallowed_patch_actions: ["deploy"],
    } : null,
  };
  const result = evaluatePatchPlanForApplication({ preparationResult });

  assert.equal(result.status, "application_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_required_disallowed_actions"));
});

test("decision preserves source IDs", () => {
  const preparationResult = buildPatchPreparationResult();
  const result = evaluatePatchPlanForApplication({ preparationResult, createdAt: "2026-04-24T15:00:00.000Z" });

  assert.equal(result.decision?.source_patch_plan_id, preparationResult.patch_plan?.patch_plan_id);
  assert.equal(result.decision?.source_dry_run_id, preparationResult.patch_plan?.source_dry_run_id);
  assert.equal(result.decision?.source_handoff_id, preparationResult.patch_plan?.source_handoff_id);
  assert.equal(result.decision?.source_artifact_id, preparationResult.patch_plan?.source_artifact_id);
});

test("summary is readable", () => {
  const preparationResult = buildPatchPreparationResult();
  const result = evaluatePatchPlanForApplication({ preparationResult });
  const summary = summarizePatchApplicationGate(result);

  assert.match(summary, /Patch application status: application_eligible/i);
  assert.match(summary, /Recommended next operator action:/i);
  assert.match(summary, /Decision:/i);
});

test("works with output from reviewedPatchPreparation", () => {
  const source = {
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  };
  const refinement = refineConversationalIntent(source);
  const plannerRequest = convertRefinementToPlannerRequest(refinement, source);
  assert.ok(plannerRequest);
  const plan = createOperatorLightPlan(plannerRequest);
  const combined = createCombinedIntakePacket(refinement, plan);
  const artifact = updateSessionArtifactStatus(createSessionArtifact({
    artifactType: "combined_intake_packet",
    sourceRequest: source.rawRequest,
    combinedPacket: combined,
    createdAt: "2026-04-24T12:00:00.000Z",
  }), "approved");
  const decision = evaluateArtifactForExecution(artifact);
  const handoff = createReviewedExecutionHandoff({ artifact, decision });
  assert.ok(handoff.handoff_packet);
  const dryRun = runExecutionDryRun({ handoffPacket: handoff.handoff_packet });
  const prep = prepareReviewedPatchPlan({ report: dryRun });

  const result = evaluatePatchPlanForApplication({ preparationResult: prep });
  assert.equal(result.status, "application_eligible");
});