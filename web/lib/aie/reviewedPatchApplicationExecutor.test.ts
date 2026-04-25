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
import { generateReviewedPatchDraft } from "./reviewedPatchDraftGenerator";
import {
  createReviewedPatchApplicationPacket,
  summarizeReviewedPatchApplicationExecutor,
} from "./reviewedPatchApplicationExecutor";

function buildDraftResult() {
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
  return generateReviewedPatchDraft({ decision: applicationGate.decision, createdAt: "2026-04-24T16:00:00.000Z" });
}

test("draft_ready result produces application_packet_ready", () => {
  const draftResult = buildDraftResult();
  const result = createReviewedPatchApplicationPacket({ draftResult, createdAt: "2026-04-24T17:00:00.000Z" });

  assert.equal(result.status, "application_packet_ready");
  assert.ok(result.application_packet);
});

test("blocked draft result does not produce application packet", () => {
  const draftResult = {
    ...buildDraftResult(),
    status: "draft_blocked" as const,
  };
  const result = createReviewedPatchApplicationPacket({ draftResult });

  assert.equal(result.status, "application_packet_blocked");
  assert.equal(result.application_packet, null);
});

test("missing reviewed patch draft blocks", () => {
  const draftResult = {
    ...buildDraftResult(),
    draft: null,
  };
  const result = createReviewedPatchApplicationPacket({ draftResult });

  assert.equal(result.status, "application_packet_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_patch_draft"));
});

test("missing operator review requires review", () => {
  const draftResult = {
    ...buildDraftResult(),
    draft: {
      ...buildDraftResult().draft!,
      required_operator_review: false as never,
    },
  };
  const result = createReviewedPatchApplicationPacket({ draftResult });

  assert.equal(result.status, "application_packet_needs_review");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_operator_review"));
});

test("invalid change descriptions block", () => {
  const draftResult = {
    ...buildDraftResult(),
    draft: {
      ...buildDraftResult().draft!,
      change_descriptions: [{
        ...buildDraftResult().draft!.change_descriptions[0],
        mutation_allowed: true as never,
      }],
    },
  };
  const result = createReviewedPatchApplicationPacket({ draftResult });

  assert.equal(result.status, "application_packet_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "invalid_change_descriptions"));
});

test("missing validation requirements blocks", () => {
  const draftResult = {
    ...buildDraftResult(),
    draft: {
      ...buildDraftResult().draft!,
      validation_requirements: [],
    },
  };
  const result = createReviewedPatchApplicationPacket({ draftResult });

  assert.equal(result.status, "application_packet_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_validation_requirements"));
});

test("missing git commit plan blocks", () => {
  const draftResult = {
    ...buildDraftResult(),
    draft: {
      ...buildDraftResult().draft!,
      git_commit_plan: null as never,
    },
  };
  const result = createReviewedPatchApplicationPacket({ draftResult });

  assert.equal(result.status, "application_packet_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_git_commit_plan"));
});

test("missing required disallowed draft actions blocks", () => {
  const draftResult = {
    ...buildDraftResult(),
    draft: {
      ...buildDraftResult().draft!,
      disallowed_draft_actions: ["deploy"],
    },
  };
  const result = createReviewedPatchApplicationPacket({ draftResult });

  assert.equal(result.status, "application_packet_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_disallowed_draft_actions"));
});

test("high-risk draft blocks", () => {
  const draftResult = {
    ...buildDraftResult(),
    draft: {
      ...buildDraftResult().draft!,
      risk_level: "high" as const,
    },
  };
  const result = createReviewedPatchApplicationPacket({ draftResult });

  assert.equal(result.status, "high_risk_blocked");
  assert.equal(result.application_packet, null);
});

test("application packet preserves source ids and required fields", () => {
  const draftResult = buildDraftResult();
  const result = createReviewedPatchApplicationPacket({ draftResult, createdAt: "2026-04-24T17:00:00.000Z" });

  assert.equal(result.application_packet?.source_draft_id, draftResult.draft?.draft_id);
  assert.equal(result.application_packet?.source_decision_id, draftResult.draft?.source_decision_id);
  assert.equal(result.application_packet?.human_approval_required, true);
  assert.ok(result.application_packet?.allowed_executor_actions.includes("generate patch proposal text"));
  assert.ok(result.application_packet?.disallowed_executor_actions.includes("apply patches automatically"));
});

test("summary is readable", () => {
  const draftResult = buildDraftResult();
  const result = createReviewedPatchApplicationPacket({ draftResult });
  const summary = summarizeReviewedPatchApplicationExecutor(result);

  assert.match(summary, /Patch application executor status: application_packet_ready/i);
  assert.match(summary, /Recommended next operator action:/i);
  assert.match(summary, /Application packet:/i);
});

test("works with output from reviewedPatchDraftGenerator", () => {
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
  const draftResult = generateReviewedPatchDraft({ decision: applicationGate.decision });

  const result = createReviewedPatchApplicationPacket({ draftResult });
  assert.equal(result.status, "application_packet_ready");
});