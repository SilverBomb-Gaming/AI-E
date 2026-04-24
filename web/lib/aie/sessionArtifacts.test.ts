import assert from "node:assert/strict";
import test from "node:test";

import {
  convertRefinementToPlannerRequest,
  refineConversationalIntent,
} from "./conversationalIntentRefinement";
import { createOperatorLightPlan } from "./operatorLightPlanner";
import {
  createCombinedIntakePacket,
  createSessionArtifact,
  summarizeSessionArtifact,
  updateSessionArtifactStatus,
} from "./sessionArtifacts";

function buildPlanningInputs() {
  const source = {
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  };
  const refinement = refineConversationalIntent(source);
  const plannerRequest = convertRefinementToPlannerRequest(refinement, source);

  assert.ok(plannerRequest);

  const plan = createOperatorLightPlan(plannerRequest!);
  return { source, refinement, plan, plannerRequest: plannerRequest! };
}

test("creates refinement artifact", () => {
  const refinement = refineConversationalIntent({
    rawRequest: "make the game better",
  });

  const artifact = createSessionArtifact({
    artifactType: "conversational_refinement",
    sourceRequest: refinement.original_request,
    refinement,
    createdAt: "2026-04-24T12:00:00.000Z",
  });

  assert.equal(artifact.artifact_type, "conversational_refinement");
  assert.equal(artifact.status, "awaiting_clarification");
  assert.equal(artifact.interpreted_intent, refinement.interpreted_intent);
  assert.equal(artifact.planner_ready_request, null);
});

test("creates planner artifact", () => {
  const { source, refinement, plan } = buildPlanningInputs();
  const artifact = createSessionArtifact({
    artifactType: "operator_plan",
    sourceRequest: source.rawRequest,
    refinement,
    plan,
    createdAt: "2026-04-24T12:00:00.000Z",
  });

  assert.equal(artifact.artifact_type, "operator_plan");
  assert.equal(artifact.status, "planned");
  assert.equal(artifact.risk_level, plan.risk_level);
  assert.equal(artifact.validation_steps.length, plan.validation_steps.length);
});

test("creates combined intake packet", () => {
  const { refinement, plan } = buildPlanningInputs();
  const packet = createCombinedIntakePacket(refinement, plan);

  assert.equal(packet.source_request, refinement.original_request);
  assert.equal(packet.interpreted_intent, refinement.interpreted_intent);
  assert.equal(packet.repo_targets.length, plan.repo_targets.length);
  assert.equal(packet.execution_steps.length, plan.execution_steps.length);
});

test("preserves source request", () => {
  const { source, refinement, plan } = buildPlanningInputs();
  const packet = createCombinedIntakePacket(refinement, plan);
  const artifact = createSessionArtifact({
    artifactType: "combined_intake_packet",
    sourceRequest: source.rawRequest,
    combinedPacket: packet,
    createdAt: "2026-04-24T12:00:00.000Z",
  });

  assert.equal(artifact.source_request, source.rawRequest);
  assert.equal(artifact.combined_intake_packet?.source_request, source.rawRequest);
});

test("preserves risk and validation fields", () => {
  const { source, refinement, plan } = buildPlanningInputs();
  const artifact = createSessionArtifact({
    artifactType: "operator_plan",
    sourceRequest: source.rawRequest,
    refinement,
    plan,
    createdAt: "2026-04-24T12:00:00.000Z",
  });

  assert.equal(artifact.risk_level, plan.risk_level);
  assert.equal(artifact.playtest_required, plan.playtest_required);
  assert.deepEqual(artifact.validation_steps, plan.validation_steps);
  assert.deepEqual(artifact.git_commit_plan, plan.git_commit_plan);
});

test("updates status safely", () => {
  const { source, refinement, plan } = buildPlanningInputs();
  const artifact = createSessionArtifact({
    artifactType: "operator_plan",
    sourceRequest: source.rawRequest,
    refinement,
    plan,
    createdAt: "2026-04-24T12:00:00.000Z",
  });

  const updated = updateSessionArtifactStatus(artifact, "approved");
  assert.equal(updated.status, "approved");
  assert.equal(artifact.status, "planned");
});

test("rejects invalid status if requested", () => {
  const { source, refinement, plan } = buildPlanningInputs();
  const artifact = createSessionArtifact({
    artifactType: "operator_plan",
    sourceRequest: source.rawRequest,
    refinement,
    plan,
    createdAt: "2026-04-24T12:00:00.000Z",
  });

  assert.throws(
    () => updateSessionArtifactStatus(artifact, "shipped"),
    /Unsupported session artifact status/i,
  );
});

test("produces readable summary", () => {
  const { source, refinement, plan } = buildPlanningInputs();
  const artifact = createSessionArtifact({
    artifactType: "operator_plan",
    sourceRequest: source.rawRequest,
    refinement,
    plan,
    createdAt: "2026-04-24T12:00:00.000Z",
  });

  const summary = summarizeSessionArtifact(artifact);
  assert.match(summary, /Type: operator_plan/i);
  assert.match(summary, /Risk: /i);
  assert.match(summary, /Repo targets:/i);
  assert.match(summary, /Next operator decision:/i);
});

test("works with output from conversational refinement and Operator-Light Planner", () => {
  const { source, refinement, plan } = buildPlanningInputs();
  const packet = createCombinedIntakePacket(refinement, plan);
  const artifact = createSessionArtifact({
    artifactType: "combined_intake_packet",
    sourceRequest: source.rawRequest,
    combinedPacket: packet,
    createdAt: "2026-04-24T12:00:00.000Z",
  });

  assert.equal(artifact.status, "planned");
  assert.equal(artifact.interpreted_intent, refinement.interpreted_intent);
  assert.equal(artifact.next_operator_decision, plan.next_operator_decision);
  assert.equal(artifact.repo_targets.length, plan.repo_targets.length);
  assert.equal(artifact.execution_steps.length, plan.execution_steps.length);
});