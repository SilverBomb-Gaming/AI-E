import assert from "node:assert/strict";
import test from "node:test";

import { runDevelopmentCampaignEngine } from "./developmentCampaignEngine";
import { getDefaultDevelopmentCampaignLayers } from "./developmentCampaignState";
import { planDevelopmentCampaign } from "./developmentCampaignPlanner";

test("selects the highest-impact unblocked next layer", () => {
  const result = runDevelopmentCampaignEngine();

  assert.equal(result.engineStatus, "AUTONOMOUS_DEVELOPMENT_CAMPAIGN_ENGINE_PHASE1");
  assert.equal(result.plan.selectedLayer.layerId, "SAFE_EXECUTION_GUARDRAILS_PHASE1");
  assert.equal(result.plan.claimsAutonomousExecution, false);
});

test("does not select layers blocked by missing dependencies", () => {
  const result = runDevelopmentCampaignEngine();
  const blockedLayerIds = result.plan.blockedLayers.map((blocker) => blocker.layerId);

  assert.equal(blockedLayerIds.includes("SUPERVISED_MULTI_STEP_EXECUTION_PHASE1"), true);
  assert.notEqual(result.plan.selectedLayer.layerId, "SUPERVISED_MULTI_STEP_EXECUTION_PHASE1");
});

test("labels scaffolded and missing capabilities truthfully", () => {
  const result = runDevelopmentCampaignEngine();
  const durableMemory = result.capabilityMap.find((layer) => layer.layerId === "DURABLE_PROJECT_MEMORY_AND_TASK_STATE_PHASE1");
  const fullStudio = result.capabilityMap.find((layer) => layer.layerId === "FULL_HANDS_OFF_STUDIO_OPERATION");

  assert.equal(durableMemory?.status, "real");
  assert.equal(fullStudio?.status, "future");
  assert.match(result.truthfulnessSummary, /does not autonomously edit files/);
});

test("generates a safe Codex/Copilot handoff", () => {
  const result = runDevelopmentCampaignEngine();

  assert.match(result.plan.handoffMarkdown, /# Codex Handoff/);
  assert.match(result.plan.handoffMarkdown, /Truthfulness Constraint/);
  assert.match(result.plan.handoffMarkdown, /did not edit files, run Unity, execute Codex\/Copilot, or perform autonomous development/);
  assert.equal(result.plan.testsAndVerification.length > 0, true);
});

test("does not claim fake autonomous execution", () => {
  const result = runDevelopmentCampaignEngine();
  const combined = `${result.truthfulnessSummary}\n${result.plan.handoffMarkdown}\n${result.plan.scaffoldWarnings.join("\n")}`;

  assert.equal(result.plan.claimsAutonomousExecution, false);
  assert.doesNotMatch(combined, /I edited|I ran Unity|I executed Codex|hands-off operation is real/i);
});

test("continues to supervised execution planning after safe guardrails is marked real", () => {
  const layers = getDefaultDevelopmentCampaignLayers().map((layer) => layer.layerId === "SAFE_EXECUTION_GUARDRAILS_PHASE1"
    ? { ...layer, status: "real" as const }
    : layer);
  const plan = planDevelopmentCampaign(layers);

  assert.equal(plan.selectedLayer.layerId, "SUPERVISED_MULTI_STEP_EXECUTION_PHASE1");
  assert.match(plan.handoffMarkdown, /Supervised multi-step execution Phase 1/);
});