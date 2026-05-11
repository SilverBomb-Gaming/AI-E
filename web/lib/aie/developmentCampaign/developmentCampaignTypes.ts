export type DevelopmentCapabilityStatus = "real" | "scaffolded" | "partial" | "missing" | "blocked" | "future" | "current_target";

export type DevelopmentRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "FUTURE_ONLY";

export type DevelopmentCampaignMilestoneKind = "planning" | "execution" | "mutation" | "validation" | "rollback" | "retry" | "checkpoint";

export type DevelopmentCampaignLayer = {
  layerId: string;
  layerName: string;
  status: DevelopmentCapabilityStatus;
  priority: number;
  dependencyLayerIds: string[];
  riskLevel: DevelopmentRiskLevel;
  truthfulnessRequirements: string[];
  completionCriteria: string[];
  verificationCommands: string[];
  nextActions: string[];
  milestoneCategories?: DevelopmentCampaignMilestoneKind[];
};

export type DevelopmentCampaignBlocker = {
  layerId: string;
  reason: string;
  missingDependencyLayerIds: string[];
};

export type DevelopmentCampaignPlan = {
  selectedLayer: DevelopmentCampaignLayer;
  selectedReason: string;
  unblockedLayerIds: string[];
  blockedLayers: DevelopmentCampaignBlocker[];
  milestonePlan: string[];
  implementationPlan: string[];
  testsAndVerification: string[];
  readmeUpdateRequirements: string[];
  scaffoldWarnings: string[];
  handoffMarkdown: string;
  claimsAutonomousExecution: false;
};

export type DevelopmentCampaignEngineResult = {
  engineStatus: "AUTONOMOUS_DEVELOPMENT_CAMPAIGN_ENGINE_PHASE1";
  capabilityMap: DevelopmentCampaignLayer[];
  plan: DevelopmentCampaignPlan;
  truthfulnessSummary: string;
  nextLayerAfterSelected?: string;
};