import { getDefaultDevelopmentCampaignLayers } from "./developmentCampaignState";
import { planDevelopmentCampaign } from "./developmentCampaignPlanner";
import type { DevelopmentCampaignEngineResult, DevelopmentCampaignLayer } from "./developmentCampaignTypes";

export function runDevelopmentCampaignEngine(layers: DevelopmentCampaignLayer[] = getDefaultDevelopmentCampaignLayers()): DevelopmentCampaignEngineResult {
  const capabilityMap = layers.map((layer) => ({
    ...layer,
    dependencyLayerIds: [...layer.dependencyLayerIds],
    truthfulnessRequirements: [...layer.truthfulnessRequirements],
    completionCriteria: [...layer.completionCriteria],
    verificationCommands: [...layer.verificationCommands],
    nextActions: [...layer.nextActions],
  }));
  const plan = planDevelopmentCampaign(capabilityMap);
  const nextLayerAfterSelected = plan.selectedLayer.layerId === "AUTONOMOUS_DEVELOPMENT_CAMPAIGN_ENGINE_PHASE1"
    ? "DURABLE_PROJECT_MEMORY_AND_TASK_STATE_PHASE1"
    : plan.selectedLayer.layerId === "SAFE_EXECUTION_GUARDRAILS_PHASE1"
      ? "PROJECT_STATE_INSPECTION_PHASE1"
      : undefined;

  return {
    engineStatus: "AUTONOMOUS_DEVELOPMENT_CAMPAIGN_ENGINE_PHASE1",
    capabilityMap,
    plan,
    truthfulnessSummary: "Campaign engine Phase 1 is a typed planning and handoff generator only. It does not autonomously edit files, run Unity, execute agents, or provide durable memory.",
    nextLayerAfterSelected,
  };
}

export function isDevelopmentCampaignRequest(message: string): boolean {
  return /\b(what\s+should\s+ai-e\s+build\s+next|continue\s+improving\s+yourself|start\s+an\s+overnight\s+task|advance\s+as\s+far\s+as\s+possible|what\s+layer\s+are\s+we\s+on|what\s+is\s+still\s+scaffolded|closer\s+to\s+hands-off|overnight\s+autonomous|development\s+campaign)\b/i.test(message);
}