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
import {
  prepareReviewedPatchPlan,
  summarizeReviewedPatchPreparation,
} from "./reviewedPatchPreparation";

function buildDryRunReport() {
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
  return runExecutionDryRun({ handoffPacket: handoff.handoff_packet, createdAt: "2026-04-24T13:00:00.000Z" });
}

test("valid dry-run report produces patch_plan_ready", () => {
  const report = buildDryRunReport();
  const result = prepareReviewedPatchPlan({ report, createdAt: "2026-04-24T14:00:00.000Z" });

  assert.equal(result.status, "patch_plan_ready");
  assert.equal(result.ready_for_patch_plan, true);
  assert.ok(result.patch_plan);
});

test("blocked dry-run report does not produce patch plan", () => {
  const report = {
    ...buildDryRunReport(),
    status: "dry_run_blocked" as const,
    blockers: [{
      code: "missing_validation_plan" as const,
      message: "Dry-run packets must include a validation plan.",
      recommended_next_action: "add_validation_plan" as const,
    }],
  };
  const result = prepareReviewedPatchPlan({ report });

  assert.equal(result.status, "patch_plan_blocked");
  assert.equal(result.patch_plan, null);
});

test("high-risk dry-run blocks", () => {
  const report = {
    ...buildDryRunReport(),
    risk_level: "high" as const,
  };
  const result = prepareReviewedPatchPlan({ report });

  assert.equal(result.status, "high_risk_blocked");
  assert.equal(result.patch_plan, null);
});

test("missing simulated steps blocks", () => {
  const report = {
    ...buildDryRunReport(),
    simulated_steps: [],
  };
  const result = prepareReviewedPatchPlan({ report });

  assert.equal(result.status, "patch_plan_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_simulated_steps"));
});

test("simulated step with mutation_allowed true blocks", () => {
  const report = {
    ...buildDryRunReport(),
    simulated_steps: [
      {
        ...buildDryRunReport().simulated_steps[0]!,
        mutation_allowed: true as never,
      },
    ],
  };
  const result = prepareReviewedPatchPlan({ report });

  assert.equal(result.status, "patch_plan_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "mutation_not_allowed_violation"));
});

test("missing validation plan blocks", () => {
  const report = {
    ...buildDryRunReport(),
    validation_plan: [],
  };
  const result = prepareReviewedPatchPlan({ report });

  assert.equal(result.status, "patch_plan_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_validation_plan"));
});

test("missing git commit plan blocks", () => {
  const report = {
    ...buildDryRunReport(),
    git_commit_plan: null as never,
  };
  const result = prepareReviewedPatchPlan({ report });

  assert.equal(result.status, "patch_plan_blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "missing_git_commit_plan"));
});

test("planned change groups preserve proposed file targets", () => {
  const report = buildDryRunReport();
  const result = prepareReviewedPatchPlan({ report });

  assert.deepEqual(result.patch_plan?.proposed_file_targets, report.proposed_file_targets);
  assert.equal(result.patch_plan?.planned_change_groups.length, report.proposed_file_targets.length);
});

test("allowed and disallowed patch actions are included", () => {
  const report = buildDryRunReport();
  const result = prepareReviewedPatchPlan({ report });

  assert.ok(result.patch_plan?.allowed_patch_actions.includes("inspect target files"));
  assert.ok(result.patch_plan?.disallowed_patch_actions.includes("apply patches"));
});

test("summary is readable", () => {
  const report = buildDryRunReport();
  const result = prepareReviewedPatchPlan({ report });
  const summary = summarizeReviewedPatchPreparation(result);

  assert.match(summary, /Patch preparation status: patch_plan_ready/i);
  assert.match(summary, /Recommended next operator action:/i);
  assert.match(summary, /Patch plan:/i);
});

test("works with output from executionDryRunRunner", () => {
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
  const report = runExecutionDryRun({ handoffPacket: handoff.handoff_packet });

  const result = prepareReviewedPatchPlan({ report });
  assert.equal(result.status, "patch_plan_ready");
});