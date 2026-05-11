import type { DevelopmentCampaignBlocker, DevelopmentCampaignLayer, DevelopmentCampaignPlan } from "./developmentCampaignTypes";

const selectableStatuses = new Set<DevelopmentCampaignLayer["status"]>(["missing", "partial", "current_target", "scaffolded"]);
const completeStatuses = new Set<DevelopmentCampaignLayer["status"]>(["real"]);

function isDependencySatisfied(layerId: string, layersById: Map<string, DevelopmentCampaignLayer>): boolean {
  const layer = layersById.get(layerId);
  return Boolean(layer && completeStatuses.has(layer.status));
}

function blockerFor(layer: DevelopmentCampaignLayer, layersById: Map<string, DevelopmentCampaignLayer>): DevelopmentCampaignBlocker | undefined {
  const missingDependencyLayerIds = layer.dependencyLayerIds.filter((dependencyId) => !isDependencySatisfied(dependencyId, layersById));
  if (layer.status === "blocked") {
    return { layerId: layer.layerId, reason: "Layer is explicitly blocked", missingDependencyLayerIds };
  }
  if (layer.status === "future") {
    return { layerId: layer.layerId, reason: "Future-only layer is not selectable in Phase 1", missingDependencyLayerIds };
  }
  if (missingDependencyLayerIds.length > 0) {
    return { layerId: layer.layerId, reason: "Missing required dependency layers", missingDependencyLayerIds };
  }
  return undefined;
}

function selectionScore(layer: DevelopmentCampaignLayer): number {
  const statusBoost = layer.status === "current_target" ? 6 : layer.status === "partial" ? 4 : layer.status === "missing" ? 2 : 0;
  const safetyPenalty = layer.riskLevel === "HIGH" ? 8 : layer.riskLevel === "MEDIUM" ? 3 : layer.riskLevel === "FUTURE_ONLY" ? 999 : 0;
  return layer.priority + statusBoost - safetyPenalty;
}

function buildHandoffMarkdown(layer: DevelopmentCampaignLayer, blockedLayers: DevelopmentCampaignBlocker[]): string {
  return [
    `# Codex Handoff: ${layer.layerName}`,
    "",
    "## Goal",
    `Implement the first bounded, truthful milestone for ${layer.layerId}.`,
    "",
    "## Why This Layer",
    `Priority ${layer.priority}, status ${layer.status}, risk ${layer.riskLevel}. It is the highest-impact unblocked layer under the current capability map.`,
    "",
    "## Implementation Steps",
    ...layer.nextActions.map((action) => `- ${action}`),
    "- Keep the implementation typed, testable, and planning-only unless a separate approved execution path is explicitly implemented.",
    "- Update README with real/scaffolded limitations and validation results.",
    "",
    "## Completion Criteria",
    ...layer.completionCriteria.map((criterion) => `- ${criterion}`),
    "",
    "## Milestone Categories",
    ...(layer.milestoneCategories?.length ? layer.milestoneCategories.map((category) => `- ${category}`) : ["- planning"]),
    "",
    "## Verification Commands",
    ...layer.verificationCommands.map((command) => `- ${command}`),
    "",
    "## Truthfulness Requirements",
    ...layer.truthfulnessRequirements.map((requirement) => `- ${requirement}`),
    "- Do not claim autonomous execution, Unity execution, file edits, durable memory, or long-term learning unless that capability is actually implemented and verified.",
    "",
    "## Blocked Or Deferred Layers",
    ...(blockedLayers.length > 0 ? blockedLayers.map((blocker) => `- ${blocker.layerId}: ${blocker.reason}${blocker.missingDependencyLayerIds.length ? ` (${blocker.missingDependencyLayerIds.join(", ")})` : ""}`) : ["- None detected for this selection."]),
    "",
    "## Truthfulness Constraint",
    "This campaign engine generated a plan and handoff only. It did not edit files, run Unity, execute Codex/Copilot, or perform autonomous development.",
  ].join("\n");
}

export function planDevelopmentCampaign(layers: DevelopmentCampaignLayer[]): DevelopmentCampaignPlan {
  const layersById = new Map(layers.map((layer) => [layer.layerId, layer]));
  const blockedLayers = layers.map((layer) => blockerFor(layer, layersById)).filter((blocker): blocker is DevelopmentCampaignBlocker => Boolean(blocker));
  const blockedLayerIds = new Set(blockedLayers.map((blocker) => blocker.layerId));
  const unblockedLayers = layers
    .filter((layer) => selectableStatuses.has(layer.status))
    .filter((layer) => !blockedLayerIds.has(layer.layerId));

  const selectedLayer = [...unblockedLayers].sort((left, right) => selectionScore(right) - selectionScore(left) || right.priority - left.priority)[0];
  if (!selectedLayer) {
    throw new Error("No unblocked development campaign layer is available");
  }

  const milestonePlan = selectedLayer.layerId === "DURABLE_PROJECT_MEMORY_AND_TASK_STATE_PHASE1"
    ? [
        "Milestone 1: create a typed durable project/task state interface and local adapter boundary without expanding autonomy.",
        "Milestone 2: persist explicit project/task state across reloads with migration/corruption handling.",
        "Milestone 3: connect persisted state to chat continuation after reload while preserving truthful scope labels.",
      ]
    : [
        "Milestone 1: implement the typed planning model and deterministic selection logic.",
        "Milestone 2: expose the plan through /operator/chat as a visible, copyable handoff.",
        "Milestone 3: document limitations and validation commands.",
      ];

  const implementationPlan = [
    "Inspect current capability map and statuses.",
    "Exclude future, blocked, and dependency-blocked layers.",
    "Rank unblocked layers by priority, status urgency, and safety risk.",
    "Generate a bounded next-step plan with tests, README requirements, and scaffold warnings.",
    "Return a Codex/Copilot-ready handoff without claiming execution.",
  ];
  const scaffoldWarnings = [
    "This is a planning engine, not a hands-off execution engine.",
    "It does not edit files or run Unity by itself.",
    "Durable multi-cycle state is local JSON file-backed only; it is not cloud persistence, distributed orchestration, or a background agent.",
  ];

  return {
    selectedLayer,
    selectedReason: `${selectedLayer.layerId} is the highest-impact unblocked layer after dependency and risk filtering.`,
    unblockedLayerIds: unblockedLayers.map((layer) => layer.layerId),
    blockedLayers,
    milestonePlan,
    implementationPlan,
    testsAndVerification: selectedLayer.verificationCommands,
    readmeUpdateRequirements: [
      "Document campaign engine status and capability map.",
      "List real vs scaffolded capability claims.",
      "Record validation commands/results.",
    ],
    scaffoldWarnings,
    handoffMarkdown: buildHandoffMarkdown(selectedLayer, blockedLayers),
    claimsAutonomousExecution: false,
  };
}