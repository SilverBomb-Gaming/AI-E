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
  updateSessionArtifactStatus,
} from "./sessionArtifacts";
import {
  evaluateArtifactForExecution,
  listArtifactExecutionBlockers,
  summarizeExecutionDecision,
} from "./artifactExecutionConsumer";

function buildApprovedArtifact() {
  const source = {
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  };
  const refinement = refineConversationalIntent(source);
  const plannerRequest = convertRefinementToPlannerRequest(refinement, source);
  assert.ok(plannerRequest);
  const plan = createOperatorLightPlan(plannerRequest!);
  const artifact = createSessionArtifact({
    artifactType: "operator_plan",
    sourceRequest: source.rawRequest,
    refinement,
    plan,
    createdAt: "2026-04-24T12:00:00.000Z",
  });

  return updateSessionArtifactStatus(artifact, "approved");
}

test("approved low or medium-risk artifact becomes ready", () => {
  const artifact = buildApprovedArtifact();
  const decision = evaluateArtifactForExecution(artifact);

  assert.equal(decision.status, "ready");
  assert.equal(decision.ready_for_execution, true);
  assert.equal(decision.blockers.length, 0);
});

test("planned artifact needs approval", () => {
  const artifact = createSessionArtifact({
    artifactType: "operator_plan",
    sourceRequest: "make enemies smarter when grenade blows up",
    refinement: refineConversationalIntent({
      rawRequest: "make enemies smarter when grenade blows up",
      projectName: "BABYLON Unity gameplay project",
      repoName: "AI-E",
    }),
    plan: createOperatorLightPlan({
      rawRequest: "Add enemy reaction behavior to grenade explosions in BABYLON.",
      projectName: "BABYLON Unity gameplay project",
      repoName: "AI-E",
    }),
    createdAt: "2026-04-24T12:00:00.000Z",
  });

  const decision = evaluateArtifactForExecution(artifact);
  assert.equal(decision.status, "needs_approval");
  assert.equal(decision.ready_for_execution, false);
  assert.match(decision.explanation, /only approved artifacts/i);
});

test("high-risk artifact is blocked", () => {
  const artifact = buildApprovedArtifact();
  const highRiskArtifact = {
    ...artifact,
    risk_level: "high" as const,
  };

  const decision = evaluateArtifactForExecution(highRiskArtifact);
  assert.equal(decision.status, "high_risk_blocked");
  assert.equal(decision.recommended_next_action, "reduce_risk");
});

test("artifact missing validation steps is blocked", () => {
  const artifact = {
    ...buildApprovedArtifact(),
    validation_steps: [],
  };

  const decision = evaluateArtifactForExecution(artifact);
  assert.equal(decision.status, "needs_validation_plan");
  assert.ok(listArtifactExecutionBlockers(artifact).some((blocker) => blocker.code === "missing_validation_steps"));
});

test("artifact missing git commit plan is blocked", () => {
  const artifact = {
    ...buildApprovedArtifact(),
    git_commit_plan: null,
  };

  const decision = evaluateArtifactForExecution(artifact);
  assert.equal(decision.status, "needs_validation_plan");
  assert.ok(decision.blockers.some((blocker) => blocker.code === "missing_git_commit_plan"));
});

test("artifact with missing info needs clarification", () => {
  const artifact = {
    ...buildApprovedArtifact(),
    missing_information: ["The exact behavior change is not specified."],
    next_operator_decision: "Provide the missing scope and approval boundary before execution.",
  };

  const decision = evaluateArtifactForExecution(artifact);
  assert.equal(decision.status, "needs_clarification");
  assert.equal(decision.recommended_next_action, "provide_clarification");
});

test("artifact requiring playtest remains ready only if playtest is explicitly flagged", () => {
  const artifact = buildApprovedArtifact();
  const decision = evaluateArtifactForExecution(artifact);

  assert.equal(typeof artifact.playtest_required, "boolean");
  assert.equal(decision.status, "ready");
});

test("readable summary explains decision", () => {
  const artifact = {
    ...buildApprovedArtifact(),
    validation_steps: [],
  };
  const decision = evaluateArtifactForExecution(artifact);
  const summary = summarizeExecutionDecision(decision);

  assert.match(summary, /Execution status: needs_validation_plan/i);
  assert.match(summary, /Recommended next action:/i);
  assert.match(summary, /Blockers:/i);
});

test("works with combined intake packet artifacts", () => {
  const source = {
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  };
  const refinement = refineConversationalIntent(source);
  const plannerRequest = convertRefinementToPlannerRequest(refinement, source);
  assert.ok(plannerRequest);
  const plan = createOperatorLightPlan(plannerRequest!);
  const packet = createCombinedIntakePacket(refinement, plan);
  const artifact = updateSessionArtifactStatus(createSessionArtifact({
    artifactType: "combined_intake_packet",
    sourceRequest: source.rawRequest,
    combinedPacket: packet,
    createdAt: "2026-04-24T12:00:00.000Z",
  }), "approved");

  const decision = evaluateArtifactForExecution(artifact);
  assert.equal(decision.status, "ready");
  assert.equal(decision.ready_for_execution, true);
});