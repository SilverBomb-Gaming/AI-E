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
import { evaluatePatchPlanForApplication } from "./reviewedPatchApplicationGate";
import {
  generateReviewedPatchDraft,
  summarizeReviewedPatchDraft,
} from "./reviewedPatchDraftGenerator";

function buildApplicationDecision() {
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
  const executionDecision = evaluateArtifactForExecution(artifact);
  const handoff = createReviewedExecutionHandoff({ artifact, decision: executionDecision });
  assert.ok(handoff.handoff_packet);
  const dryRun = runExecutionDryRun({ handoffPacket: handoff.handoff_packet, createdAt: "2026-04-24T13:00:00.000Z" });
  const prep = prepareReviewedPatchPlan({ report: dryRun, createdAt: "2026-04-24T14:00:00.000Z" });
  const applicationGate = evaluatePatchPlanForApplication({ preparationResult: prep, createdAt: "2026-04-24T15:00:00.000Z" });
  assert.ok(applicationGate.decision);
  return applicationGate.decision!;
}

test("valid application_eligible decision produces draft_ready", () => {
  const decision = buildApplicationDecision();
  const result = generateReviewedPatchDraft({ decision, createdAt: "2026-04-24T16:00:00.000Z" });

  assert.equal(result.status, "draft_ready");
  assert.ok(result.draft);
});

test("blocked decision does not produce draft", () => {
  const decision = {
    ...buildApplicationDecision(),
    status: "application_blocked" as const,
    eligible_for_application: false,
  };
  const result = generateReviewedPatchDraft({ decision });

  assert.equal(result.status, "draft_blocked");
  assert.equal(result.draft, null);
});

test("missing planned change groups blocks", () => {
  const decision = {
    ...buildApplicationDecision(),
    source_patch_plan: {
      ...buildApplicationDecision().source_patch_plan,
      planned_change_groups: [],
    },
  };
  const result = generateReviewedPatchDraft({ decision });

  assert.equal(result.status, "draft_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_planned_change_groups"));
});

test("high-risk decision blocks", () => {
  const decision = {
    ...buildApplicationDecision(),
    risk_level: "high" as const,
  };
  const result = generateReviewedPatchDraft({ decision });

  assert.equal(result.status, "high_risk_blocked");
  assert.equal(result.draft, null);
});

test("missing validation requirements blocks", () => {
  const decision = {
    ...buildApplicationDecision(),
    validation_requirements: [],
  };
  const result = generateReviewedPatchDraft({ decision });

  assert.equal(result.status, "draft_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_validation_requirements"));
});

test("missing git commit plan blocks", () => {
  const decision = {
    ...buildApplicationDecision(),
    git_commit_plan: null as never,
  };
  const result = generateReviewedPatchDraft({ decision });

  assert.equal(result.status, "draft_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_git_commit_plan"));
});

test("change descriptions map from planned change groups", () => {
  const decision = buildApplicationDecision();
  const result = generateReviewedPatchDraft({ decision });

  assert.equal(result.draft?.change_descriptions.length, decision.source_patch_plan.planned_change_groups.length);
});

test("expected diff summary exists", () => {
  const decision = buildApplicationDecision();
  const result = generateReviewedPatchDraft({ decision });

  assert.match(result.draft?.expected_diff_summary ?? "", /Likely changes are limited to/i);
});

test("allowed and disallowed constraints preserved", () => {
  const decision = buildApplicationDecision();
  const result = generateReviewedPatchDraft({ decision });

  assert.ok(result.draft?.allowed_draft_actions.includes("describe changes"));
  assert.ok(result.draft?.disallowed_draft_actions.includes("apply patches"));
});

test("summary is readable", () => {
  const decision = buildApplicationDecision();
  const result = generateReviewedPatchDraft({ decision });
  const summary = summarizeReviewedPatchDraft(result);

  assert.match(summary, /Patch draft status: draft_ready/i);
  assert.match(summary, /Recommended next operator action:/i);
  assert.match(summary, /Draft:/i);
});

test("works with output from reviewedPatchApplicationGate", () => {
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
  const executionDecision = evaluateArtifactForExecution(artifact);
  const handoff = createReviewedExecutionHandoff({ artifact, decision: executionDecision });
  assert.ok(handoff.handoff_packet);
  const dryRun = runExecutionDryRun({ handoffPacket: handoff.handoff_packet });
  const prep = prepareReviewedPatchPlan({ report: dryRun });
  const applicationGate = evaluatePatchPlanForApplication({ preparationResult: prep });
  assert.ok(applicationGate.decision);

  const result = generateReviewedPatchDraft({ decision: applicationGate.decision });
  assert.equal(result.status, "draft_ready");
});