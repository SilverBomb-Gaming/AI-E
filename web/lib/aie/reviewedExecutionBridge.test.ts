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
import {
  createReviewedExecutionHandoff,
  summarizeReviewedExecutionBridge,
} from "./reviewedExecutionBridge";

function buildApprovedReadyInputs() {
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

  return { source, refinement, plan, artifact, decision };
}

test("ready approved artifact produces handoff packet", () => {
  const { artifact, decision } = buildApprovedReadyInputs();
  const result = createReviewedExecutionHandoff({ artifact, decision });

  assert.equal(result.status, "handoff_ready");
  assert.equal(result.ready_for_handoff, true);
  assert.ok(result.handoff_packet);
  assert.equal(result.handoff_packet?.source_artifact_id, artifact.artifact_id);
});

test("blocked decision does not produce packet", () => {
  const { artifact, decision } = buildApprovedReadyInputs();
  const blockedDecision = {
    ...decision,
    status: "needs_validation_plan" as const,
    ready_for_execution: false,
    blockers: [{
      code: "missing_validation_steps",
      message: "Artifact does not include validation steps.",
      blocking: true,
      recommended_next_action: "add_validation_plan" as const,
    }],
    recommended_next_action: "add_validation_plan" as const,
  };

  const result = createReviewedExecutionHandoff({ artifact, decision: blockedDecision });
  assert.equal(result.status, "needs_review");
  assert.equal(result.handoff_packet, null);
});

test("planned artifact does not produce packet", () => {
  const { source, refinement, plan } = buildApprovedReadyInputs();
  const artifact = createSessionArtifact({
    artifactType: "operator_plan",
    sourceRequest: source.rawRequest,
    refinement,
    plan,
    createdAt: "2026-04-24T12:00:00.000Z",
  });
  const decision = evaluateArtifactForExecution(artifact);

  const result = createReviewedExecutionHandoff({ artifact, decision });
  assert.equal(result.status, "needs_approval");
  assert.equal(result.ready_for_handoff, false);
});

test("high-risk artifact blocks", () => {
  const { artifact, decision } = buildApprovedReadyInputs();
  const highRiskArtifact = { ...artifact, risk_level: "high" as const };
  const highRiskDecision = { ...decision, status: "high_risk_blocked" as const, ready_for_execution: false, risk_level: "high" as const };

  const result = createReviewedExecutionHandoff({ artifact: highRiskArtifact, decision: highRiskDecision });
  assert.equal(result.status, "high_risk_blocked");
  assert.equal(result.handoff_packet, null);
});

test("handoff packet includes allowed and disallowed actions", () => {
  const { artifact, decision } = buildApprovedReadyInputs();
  const result = createReviewedExecutionHandoff({ artifact, decision });

  assert.ok(result.handoff_packet?.allowed_actions.includes("inspect files"));
  assert.ok(result.handoff_packet?.disallowed_actions.includes("run destructive commands"));
});

test("handoff packet includes GitHub procedure guidance", () => {
  const { artifact, decision } = buildApprovedReadyInputs();
  const result = createReviewedExecutionHandoff({ artifact, decision });

  assert.ok((result.handoff_packet?.commit_guidance.length ?? 0) > 0);
  assert.match(result.handoff_packet?.commit_guidance[0] ?? "", /Check branch and working tree state/i);
});

test("packet preserves validation and playtest requirements", () => {
  const { artifact, decision } = buildApprovedReadyInputs();
  const result = createReviewedExecutionHandoff({ artifact, decision });

  assert.equal(result.handoff_packet?.validation_steps.length, artifact.validation_steps.length);
  assert.equal(result.handoff_packet?.playtest_required, artifact.playtest_required);
});

test("summary is readable", () => {
  const { artifact, decision } = buildApprovedReadyInputs();
  const result = createReviewedExecutionHandoff({ artifact, decision });
  const summary = summarizeReviewedExecutionBridge(result);

  assert.match(summary, /Bridge status: handoff_ready/i);
  assert.match(summary, /Recommended next operator action:/i);
  assert.match(summary, /Handoff packet:/i);
});

test("works with combined_intake_packet artifacts", () => {
  const source = {
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  };
  const refinement = refineConversationalIntent(source);
  const plannerRequest = convertRefinementToPlannerRequest(refinement, source);
  assert.ok(plannerRequest);
  const plan = createOperatorLightPlan(plannerRequest);
  const combinedPacket = createCombinedIntakePacket(refinement, plan);
  const artifact = updateSessionArtifactStatus(createSessionArtifact({
    artifactType: "combined_intake_packet",
    sourceRequest: source.rawRequest,
    combinedPacket,
    createdAt: "2026-04-24T12:00:00.000Z",
  }), "approved");
  const decision = evaluateArtifactForExecution(artifact);

  const result = createReviewedExecutionHandoff({ artifact, decision });
  assert.equal(result.status, "handoff_ready");
  assert.equal(result.ready_for_handoff, true);
});