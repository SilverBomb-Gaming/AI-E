import assert from "node:assert/strict";
import test from "node:test";

import { inspectProjectState, type ProjectStateFact } from "./projectStateInspection";

const facts: ProjectStateFact[] = [
  {
    path: "web/app/operator/chat/GameDevChatClient.tsx",
    kind: "source_file",
    verified: true,
    summary: "operator chat UI exists",
  },
  {
    path: "web/lib/aie/developmentCampaign/developmentCampaignState.ts",
    kind: "source_file",
    verified: true,
    summary: "campaign capability map exists",
  },
  {
    path: "orchestrator_lane/Tools/Unknown/Assets/Scenes/Main.unity",
    kind: "unity_scene",
    verified: false,
    summary: "scene path mentioned by user but not inspected",
  },
];

test("project inspection separates verified and unverified facts", () => {
  const inspection = inspectProjectState({
    projectRootLabel: "AI-E",
    requestedScope: "operator chat and campaign files",
    facts,
  });

  assert.equal(inspection.layerId, "PROJECT_STATE_INSPECTION_PHASE1");
  assert.equal(inspection.verifiedFacts.length, 2);
  assert.equal(inspection.unverifiedFacts.length, 1);
  assert.match(inspection.planningSignals.join("\n"), /verified source_file/);
  assert.match(inspection.planningSignals.join("\n"), /unverified unity_scene/);
});

test("project inspection is bounded and reports omitted facts", () => {
  const inspection = inspectProjectState({
    projectRootLabel: "AI-E",
    requestedScope: "large scope",
    maxFacts: 2,
    facts,
  });

  assert.equal(inspection.boundedFactLimit, 2);
  assert.equal(inspection.inspectedFacts.length, 2);
  assert.equal(inspection.omittedFactCount, 1);
});

test("project inspection never claims execution or mutation", () => {
  const inspection = inspectProjectState({
    projectRootLabel: "AI-E",
    requestedScope: "safe planning",
    facts,
  });

  assert.equal(inspection.executionTriggered, false);
  assert.equal(inspection.mutationPerformed, false);
  assert.match(inspection.truthfulnessWarnings.join("\n"), /does not edit files, run Unity, run tests, or claim implementation/);
});