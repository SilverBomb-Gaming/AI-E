import assert from "node:assert/strict";
import test from "node:test";

import { runDevelopmentCampaignEngine } from "./developmentCampaignEngine";
import { getDefaultDevelopmentCampaignLayers } from "./developmentCampaignState";
import { planDevelopmentCampaign } from "./developmentCampaignPlanner";

test("selects the highest-impact unblocked next layer", () => {
  const result = runDevelopmentCampaignEngine();

  assert.equal(result.engineStatus, "AUTONOMOUS_DEVELOPMENT_CAMPAIGN_ENGINE_PHASE1");
  assert.equal(result.plan.selectedLayer.layerId, "UNITY_WORKFLOW_AWARENESS_PHASE1");
  assert.equal(result.plan.claimsAutonomousExecution, false);
});

test("does not select layers blocked by missing dependencies", () => {
  const result = runDevelopmentCampaignEngine();
  const blockedLayerIds = result.plan.blockedLayers.map((blocker) => blocker.layerId);

  assert.equal(blockedLayerIds.includes("FULL_HANDS_OFF_STUDIO_OPERATION"), true);
  assert.notEqual(result.plan.selectedLayer.layerId, "FULL_HANDS_OFF_STUDIO_OPERATION");
});

test("labels scaffolded and missing capabilities truthfully", () => {
  const result = runDevelopmentCampaignEngine();
  const durableMemory = result.capabilityMap.find((layer) => layer.layerId === "DURABLE_PROJECT_MEMORY_AND_TASK_STATE_PHASE1");
  const projectInspection = result.capabilityMap.find((layer) => layer.layerId === "PROJECT_STATE_INSPECTION_PHASE1");
  const codebasePlanning = result.capabilityMap.find((layer) => layer.layerId === "CODEBASE_CHANGE_PLANNING_PHASE1");
  const outcomeLearning = result.capabilityMap.find((layer) => layer.layerId === "OUTCOME_LEARNING_AND_RETROSPECTIVE_MEMORY_PHASE1");
  const longRunningRuntime = result.capabilityMap.find((layer) => layer.layerId === "LONG_RUNNING_CAMPAIGN_RUNTIME_PHASE1");
  const scopedExecution = result.capabilityMap.find((layer) => layer.layerId === "SCOPED_SUPERVISED_EXECUTION_RUNTIME_PHASE1");
  const approvedPipeline = result.capabilityMap.find((layer) => layer.layerId === "APPROVED_EXECUTION_PIPELINE_PHASE1");
  const scopedMutation = result.capabilityMap.find((layer) => layer.layerId === "SCOPED_REPO_MUTATION_AND_PATCH_RUNTIME_PHASE1");
  const iterativeCycle = result.capabilityMap.find((layer) => layer.layerId === "ITERATIVE_AUTONOMOUS_WORK_CYCLE_PHASE1");
  const safeGuardrails = result.capabilityMap.find((layer) => layer.layerId === "SAFE_EXECUTION_GUARDRAILS_PHASE1");
  const supervisedQueue = result.capabilityMap.find((layer) => layer.layerId === "SUPERVISED_MULTI_STEP_EXECUTION_PHASE1");
  const fullStudio = result.capabilityMap.find((layer) => layer.layerId === "FULL_HANDS_OFF_STUDIO_OPERATION");

  assert.equal(durableMemory?.status, "real");
  assert.equal(projectInspection?.status, "real");
  assert.equal(codebasePlanning?.status, "real");
  assert.equal(outcomeLearning?.status, "real");
  assert.equal(longRunningRuntime?.status, "real");
  assert.equal(scopedExecution?.status, "real");
  assert.equal(approvedPipeline?.status, "real");
  assert.equal(scopedMutation?.status, "real");
  assert.equal(iterativeCycle?.status, "real");
  assert.equal(safeGuardrails?.status, "real");
  assert.equal(supervisedQueue?.status, "real");
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

test("keeps full hands-off operation future-only after Unity workflow awareness is marked real", () => {
  const layers = getDefaultDevelopmentCampaignLayers().map((layer) => layer.layerId === "UNITY_WORKFLOW_AWARENESS_PHASE1"
    ? { ...layer, status: "real" as const }
    : layer);

  assert.throws(() => planDevelopmentCampaign(layers), /No unblocked development campaign layer is available/);
});

test("campaign map distinguishes execution mutation validation rollback and retry milestones", () => {
  const result = runDevelopmentCampaignEngine();
  const scopedMutation = result.capabilityMap.find((layer) => layer.layerId === "SCOPED_REPO_MUTATION_AND_PATCH_RUNTIME_PHASE1");
  const iterativeCycle = result.capabilityMap.find((layer) => layer.layerId === "ITERATIVE_AUTONOMOUS_WORK_CYCLE_PHASE1");

  assert.deepEqual(scopedMutation?.milestoneCategories, ["planning", "execution", "mutation", "validation", "rollback", "retry"]);
  assert.deepEqual(iterativeCycle?.milestoneCategories, ["planning", "execution", "mutation", "validation", "rollback", "retry"]);
  assert.equal(result.plan.selectedLayer.layerId, "UNITY_WORKFLOW_AWARENESS_PHASE1");
});