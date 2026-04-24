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
import {
  runExecutionDryRun,
  summarizeDryRunReport,
} from "./executionDryRunRunner";

function buildReviewedHandoff() {
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
  const bridge = createReviewedExecutionHandoff({ artifact, decision });
  assert.ok(bridge.handoff_packet);
  return bridge.handoff_packet!;
}

test("valid handoff packet produces dry_run_ready report", () => {
  const handoffPacket = buildReviewedHandoff();
  const report = runExecutionDryRun({ handoffPacket, createdAt: "2026-04-24T13:00:00.000Z" });

  assert.equal(report.status, "dry_run_ready");
  assert.equal(report.simulated_steps.length, handoffPacket.execution_steps.length);
});

test("missing operator review blocks", () => {
  const handoffPacket = {
    ...buildReviewedHandoff(),
    required_operator_review: false as never,
  };
  const report = runExecutionDryRun({ handoffPacket });

  assert.equal(report.status, "dry_run_needs_review");
  assert.ok(report.blockers.some((blocker) => blocker.code === "missing_operator_review"));
});

test("missing allowed actions blocks", () => {
  const handoffPacket = {
    ...buildReviewedHandoff(),
    allowed_actions: [],
  };
  const report = runExecutionDryRun({ handoffPacket });

  assert.equal(report.status, "dry_run_blocked");
  assert.ok(report.blockers.some((blocker) => blocker.code === "missing_allowed_actions"));
});

test("missing validation plan blocks", () => {
  const handoffPacket = {
    ...buildReviewedHandoff(),
    validation_steps: [],
  };
  const report = runExecutionDryRun({ handoffPacket });

  assert.equal(report.status, "dry_run_blocked");
  assert.ok(report.blockers.some((blocker) => blocker.code === "missing_validation_plan"));
});

test("disallowed action in execution step blocks", () => {
  const handoffPacket = {
    ...buildReviewedHandoff(),
    execution_steps: [
      ...buildReviewedHandoff().execution_steps,
      {
        phase: "implementation" as const,
        title: "Deploy the change",
        details: "Deploy production changes immediately.",
        status: "ready" as const,
      },
    ],
  };
  const report = runExecutionDryRun({ handoffPacket });

  assert.equal(report.status, "dry_run_blocked");
  assert.ok(report.blockers.some((blocker) => blocker.code === "disallowed_action_required"));
});

test("simulated steps always have mutation_allowed false", () => {
  const handoffPacket = buildReviewedHandoff();
  const report = runExecutionDryRun({ handoffPacket });

  assert.ok(report.simulated_steps.every((step) => step.mutation_allowed === false));
});

test("proposed file targets derive from repo_targets", () => {
  const handoffPacket = buildReviewedHandoff();
  const report = runExecutionDryRun({ handoffPacket });

  assert.deepEqual(report.proposed_file_targets, handoffPacket.repo_targets);
});

test("report preserves playtest_required", () => {
  const handoffPacket = buildReviewedHandoff();
  const report = runExecutionDryRun({ handoffPacket });

  assert.equal(report.playtest_required, handoffPacket.playtest_required);
});

test("readable summary includes next operator action", () => {
  const handoffPacket = buildReviewedHandoff();
  const report = runExecutionDryRun({ handoffPacket });
  const summary = summarizeDryRunReport(report);

  assert.match(summary, /Next operator action:/i);
  assert.match(summary, /Dry-run status: dry_run_ready/i);
});

test("works with reviewed bridge output", () => {
  const source = {
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  };
  const refinement = refineConversationalIntent(source);
  const plannerRequest = convertRefinementToPlannerRequest(refinement, source);
  assert.ok(plannerRequest);
  const plan = createOperatorLightPlan(plannerRequest);
  const packet = createCombinedIntakePacket(refinement, plan);
  const artifact = updateSessionArtifactStatus(createSessionArtifact({
    artifactType: "combined_intake_packet",
    sourceRequest: source.rawRequest,
    combinedPacket: packet,
    createdAt: "2026-04-24T12:00:00.000Z",
  }), "approved");
  const decision = evaluateArtifactForExecution(artifact);
  const bridge = createReviewedExecutionHandoff({ artifact, decision });
  assert.ok(bridge.handoff_packet);

  const report = runExecutionDryRun({ handoffPacket: bridge.handoff_packet });
  assert.equal(report.status, "dry_run_ready");
});