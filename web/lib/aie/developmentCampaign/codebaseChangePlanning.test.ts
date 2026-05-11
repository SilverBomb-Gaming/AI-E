import assert from "node:assert/strict";
import test from "node:test";

import { planCodebaseChanges } from "./codebaseChangePlanning";
import { inspectProjectState } from "./projectStateInspection";

const inspection = inspectProjectState({
  projectRootLabel: "AI-E",
  requestedScope: "campaign files",
  facts: [
    {
      path: "web/lib/aie/developmentCampaign/developmentCampaignState.ts",
      kind: "source_file",
      verified: true,
      summary: "campaign map file inspected",
    },
    {
      path: "web/lib/aie/developmentCampaign/missing.ts",
      kind: "source_file",
      verified: false,
      summary: "mentioned target not inspected",
    },
  ],
});

test("codebase change plan names files risks validation and rollback without editing", () => {
  const plan = planCodebaseChanges({
    planId: "plan-campaign-state",
    objective: "Update campaign state safely",
    inspection,
    proposedChanges: [
      {
        changeId: "state",
        targetPath: "web/lib/aie/developmentCampaign/developmentCampaignState.ts",
        summary: "mark a verified capability layer real",
        riskLevel: "MEDIUM",
        validationCommands: ["npm run build"],
        rollbackNote: "restore previous layer status and rerun campaign tests",
      },
    ],
  });

  assert.equal(plan.planStatus, "ready_for_review");
  assert.deepEqual(plan.verifiedTargetPaths, ["web/lib/aie/developmentCampaign/developmentCampaignState.ts"]);
  assert.deepEqual(plan.validationCommands, ["npm run build"]);
  assert.match(plan.riskSummary.join("\n"), /MEDIUM/);
  assert.match(plan.rollbackNotes.join("\n"), /restore previous layer status/);
  assert.equal(plan.executionTriggered, false);
  assert.equal(plan.mutationPerformed, false);
});

test("codebase change plan blocks unverified target files", () => {
  const plan = planCodebaseChanges({
    planId: "plan-unverified",
    objective: "Attempt unverified target",
    inspection,
    proposedChanges: [
      {
        changeId: "missing",
        targetPath: "web/lib/aie/developmentCampaign/missing.ts",
        summary: "edit an unverified file",
        riskLevel: "HIGH",
        validationCommands: ["npm run build"],
        rollbackNote: "do not apply until the file is verified",
      },
    ],
  });

  assert.equal(plan.planStatus, "blocked_unverified_targets");
  assert.deepEqual(plan.unverifiedTargetPaths, ["web/lib/aie/developmentCampaign/missing.ts"]);
  assert.equal(plan.plannedChanges[0].planningStatus, "blocked_unverified_target");
  assert.match(plan.truthfulnessWarnings.join("\n"), /Unverified target files must remain blocked/);
});

test("codebase change plan keeps repo mutation approval separate from planning", () => {
  const plan = planCodebaseChanges({
    planId: "plan-approval",
    objective: "Plan a source edit",
    inspection,
    proposedChanges: [
      {
        changeId: "state",
        targetPath: "web/lib/aie/developmentCampaign/developmentCampaignState.ts",
        summary: "edit campaign status metadata",
        riskLevel: "LOW",
        validationCommands: ["./node_modules/.bin/tsx.cmd --test lib/aie/developmentCampaign/developmentCampaign.test.ts"],
        rollbackNote: "revert the planned metadata edit if validation fails",
      },
    ],
  });

  assert.equal(plan.plannedChanges[0].guardrailDecision.decisionStatus, "blocked_pending_operator_approval");
  assert.equal(plan.plannedChanges[0].guardrailDecision.canMutate, false);
  assert.match(plan.truthfulnessWarnings.join("\n"), /does not edit files/);
});