import type {
  AutonomousDeliveryPackage,
  AutonomousReviewPackage,
} from "./autonomousWorkPlanning";
import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";
import type { PostPlaytestDecisionResult } from "./postPlaytestDecisionEngine";
import type { PostPlaytestExecutionPlanResult } from "./postPlaytestExecutionEngine";
import type { PostPlaytestExecutionResult } from "./postPlaytestExecutor";
import type { PostPlaytestFixPlanResult } from "./postPlaytestFixPlanner";

export type ProductionPipelineDomain = "assets" | "art" | "audio" | "unity-integration";

export type ProductionPipelineNextStage = "strategy" | "planning" | "review";

export type ProductionPipelineMutationPolicy = "planning_only";

export type ProductionPipelineCapability = {
  domain: ProductionPipelineDomain;
  title: string;
  roadmap_summary: string;
  future_interfaces: string[];
  operator_review_focus: string[];
};

export type ProductionPipelineRequestEnvelope = {
  domain: ProductionPipelineDomain;
  objective: string;
  next_safe_stage: ProductionPipelineNextStage;
  mutation_policy: ProductionPipelineMutationPolicy;
  requires_operator_review: true;
  execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control";
  future_interfaces: string[];
};

export type UnityProductionRequestType =
  | "scene_request"
  | "scene_object_creation_request"
  | "prefab_request"
  | "component_script_request"
  | "validation_playtest_request"
  | "asset_import_request";

export type UnityProductionPlanningRequest = {
  request_type: UnityProductionRequestType;
  objective: string;
  next_safe_stage: ProductionPipelineNextStage;
  required_review_artifacts: string[];
  required_approval_gates: string[];
};

export type UnityProductionPlanningPacket = {
  packet_id: string;
  objective: string;
  domains: ProductionPipelineDomain[];
  request_types: UnityProductionRequestType[];
  planning_scope: string[];
  next_safe_stage: ProductionPipelineNextStage;
  mutation_policy: ProductionPipelineMutationPolicy;
  execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control";
  required_review_artifacts: string[];
  required_approval_gates: string[];
  requests: UnityProductionPlanningRequest[];
  adapter_status: "design_only";
};

export type UnityValidationApprovalStatus = "missing" | "approved";

export type UnityValidationBridgeExecutionKind = "adapter_preview" | "real_bridge_unavailable" | "real_bridge_read_only";

export type UnityValidationBridgeStatus = "bridge_unavailable" | "bridge_ready";

export type UnityValidationSceneStatus = "not_checked" | "checked_clean" | "checked_with_findings" | "unknown";

export type UnityValidationExecutionResult = {
  request_id: string;
  domain: "Unity";
  request_type: "validation_playtest_request";
  execution_mode: "read_only_validation_preview" | "read_only_runtime_bridge";
  execution_kind: UnityValidationBridgeExecutionKind;
  review_approval_id: string | null;
  review_approval_status: UnityValidationApprovalStatus;
  operator_approval_id: string | null;
  operator_approval_status: UnityValidationApprovalStatus;
  executed: boolean;
  blocked_reason: string | null;
  bridge_status: UnityValidationBridgeStatus;
  scene_validation_status: UnityValidationSceneStatus;
  missing_script_count: number | null;
  console_error_count: number | null;
  object_count: number | null;
  checked_scene_name: string | null;
  evidence_timestamp: string;
  raw_evidence_summary: string | null;
  validation_checklist: string[];
  delivery_summary: string;
  recommended_next_operator_action: string;
  artifact_label: "adapter_level_validation_preview" | "unity_bridge_unavailable_report" | "unity_read_only_validation_report";
  review_package: AutonomousReviewPackage | null;
  delivery_package: AutonomousDeliveryPackage | null;
  post_playtest_learning: AutoRecordOutcomeResult | null;
  post_playtest_decision: PostPlaytestDecisionResult | null;
  post_playtest_fix_plan: PostPlaytestFixPlanResult | null;
  post_playtest_execution_plan: PostPlaytestExecutionPlanResult | null;
  post_playtest_execution_result: PostPlaytestExecutionResult | null;
  mutating: false;
};

export type ProductionPipelinePlan = {
  plan_id: string;
  objective: string;
  domains: ProductionPipelineDomain[];
  summary: string;
  next_safe_stage: ProductionPipelineNextStage;
  mutation_policy: ProductionPipelineMutationPolicy;
  execution_path: "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control";
  capability_map: ProductionPipelineCapability[];
  safe_interface: ProductionPipelineRequestEnvelope[];
  operator_review_focus: string[];
  unity_planning_packet: UnityProductionPlanningPacket | null;
  unity_validation_execution_result: UnityValidationExecutionResult | null;
};

const EXECUTION_PATH = "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control" as const;

const DOMAIN_KEYWORDS: Record<ProductionPipelineDomain, string[]> = {
  assets: ["asset", "assets", "import", "texture", "material", "sprite", "mesh", "prefab", "addressable"],
  art: ["art", "concept", "ui", "vfx", "animation", "visual", "look", "style", "paintover"],
  audio: ["audio", "sound", "sfx", "music", "voice", "mix", "ambience", "foley"],
  "unity-integration": ["unity", "scene", "prefab", "scriptableobject", "animator", "timeline", "package", "editor", "integration"],
};

const UNITY_REQUEST_KEYWORDS: Record<UnityProductionRequestType, string[]> = {
  scene_request: ["scene", "level", "room", "lighting", "navmesh"],
  scene_object_creation_request: ["create object", "add object", "spawn object", "scene object", "gameobject", "game object", "empty object"],
  prefab_request: ["prefab", "hud", "ui prefab", "spawnable", "variant"],
  component_script_request: ["component", "script", "behaviour", "behavior", "monobehaviour", "scriptableobject"],
  validation_playtest_request: ["validate", "validation", "playtest", "qa", "smoke", "verify", "test"],
  asset_import_request: ["import", "asset", "texture", "mesh", "sprite", "audio clip", "fbx", "png"],
};

export const PRODUCTION_PIPELINE_CAPABILITY_MAP: ProductionPipelineCapability[] = [
  {
    domain: "assets",
    title: "Asset Pipeline Planning",
    roadmap_summary: "Plan bounded intake, validation, naming, packaging, and delivery steps for production assets without mutating the project directly.",
    future_interfaces: ["asset intake packet", "import validation plan", "delivery checklist"],
    operator_review_focus: ["source-of-truth paths", "import constraints", "validation gates"],
  },
  {
    domain: "art",
    title: "Art Pipeline Planning",
    roadmap_summary: "Prepare advisory briefs, review packets, and handoff checkpoints for concept, UI, VFX, and gameplay art requests.",
    future_interfaces: ["art brief", "art review packet", "handoff checklist"],
    operator_review_focus: ["style guardrails", "playtest sensitivity", "handoff acceptance criteria"],
  },
  {
    domain: "audio",
    title: "Audio Pipeline Planning",
    roadmap_summary: "Model safe planning contracts for SFX, music, voice, and mixing requests while keeping approvals explicit.",
    future_interfaces: ["audio request packet", "mix review packet", "implementation checklist"],
    operator_review_focus: ["reference material", "mix targets", "engine hookup review"],
  },
  {
    domain: "unity-integration",
    title: "Unity Integration Planning",
    roadmap_summary: "Represent scene, prefab, package, and engine-integration requests as bounded planning artifacts before any execution path exists.",
    future_interfaces: ["unity integration packet", "scene validation plan", "delivery checklist"],
    operator_review_focus: ["scene safety", "prefab boundaries", "engine-side validation steps"],
  },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "production-pipeline";
}

function uniqueDomains(domains: ProductionPipelineDomain[]): ProductionPipelineDomain[] {
  return [...new Set(domains)];
}

function uniqueUnityRequestTypes(requestTypes: UnityProductionRequestType[]): UnityProductionRequestType[] {
  return [...new Set(requestTypes)];
}

function detectProductionPipelineDomains(requestText: string): ProductionPipelineDomain[] {
  const normalized = requestText.toLowerCase();

  return uniqueDomains(
    PRODUCTION_PIPELINE_CAPABILITY_MAP
      .filter((capability) => DOMAIN_KEYWORDS[capability.domain].some((keyword) => normalized.includes(keyword)))
      .map((capability) => capability.domain),
  );
}

function resolveNextSafeStage(route: "clarify" | "plan" | "review" | "block"): ProductionPipelineNextStage {
  if (route === "plan") {
    return "planning";
  }
  if (route === "review") {
    return "review";
  }
  return "strategy";
}

function detectUnityProductionRequestTypes(objective: string): UnityProductionRequestType[] {
  const normalized = objective.toLowerCase();

  return uniqueUnityRequestTypes(
    Object.entries(UNITY_REQUEST_KEYWORDS)
      .filter(([, keywords]) => keywords.some((keyword) => normalized.includes(keyword)))
      .map(([requestType]) => requestType as UnityProductionRequestType),
  );
}

function buildUnityPlanningScope(requestTypes: UnityProductionRequestType[]): string[] {
  return requestTypes.flatMap((requestType) => {
    switch (requestType) {
      case "scene_request":
        return ["scene change planning", "scene validation checklist"];
      case "scene_object_creation_request":
        return ["scene object creation dry-run preview", "scene mutation safety checklist"];
      case "prefab_request":
        return ["prefab boundary review", "prefab rollout checklist"];
      case "component_script_request":
        return ["component/script dependency review", "engine integration checklist"];
      case "validation_playtest_request":
        return ["playtest plan", "validation evidence checklist"];
      case "asset_import_request":
        return ["asset import validation", "import rollback checklist"];
      default:
        return [];
    }
  });
}

function buildUnityReviewArtifacts(requestTypes: UnityProductionRequestType[]): string[] {
  return uniqueDomains([]).concat(...requestTypes.map((requestType) => {
    switch (requestType) {
      case "scene_request":
        return ["scene review packet", "affected-scene diff summary"];
      case "scene_object_creation_request":
        return ["scene object creation preview", "mutation rollback plan"];
      case "prefab_request":
        return ["prefab review packet", "prefab dependency summary"];
      case "component_script_request":
        return ["component/script review packet", "script dependency summary"];
      case "validation_playtest_request":
        return ["playtest plan", "validation checklist"];
      case "asset_import_request":
        return ["asset import review packet", "import source manifest"];
      default:
        return [];
    }
  })).filter((value, index, values) => values.indexOf(value) === index);
}

function buildUnityApprovalGates(requestTypes: UnityProductionRequestType[]): string[] {
  const baseGates = ["operator planning approval", "review package approval"];
  const requestGates = requestTypes.flatMap((requestType) => {
    switch (requestType) {
      case "scene_object_creation_request":
        return ["operator approval", "dry-run preview approval", "explicit final execute gate"];
      case "validation_playtest_request":
        return ["playtest approval"];
      case "asset_import_request":
        return ["import approval"];
      default:
        return ["unity execution approval"];
    }
  });

  return [...new Set([...baseGates, ...requestGates])];
}

export function buildUnityProductionPlanningPacket(
  objective: string,
  route: "clarify" | "plan" | "review" | "block",
  domains: ProductionPipelineDomain[],
): UnityProductionPlanningPacket | null {
  const normalizedObjective = objective.trim();
  if (!normalizedObjective) {
    return null;
  }

  if (!domains.includes("unity-integration")) {
    return null;
  }

  const requestTypes = detectUnityProductionRequestTypes(normalizedObjective);
  if (requestTypes.length === 0) {
    return null;
  }

  const nextSafeStage = resolveNextSafeStage(route);
  const requiredReviewArtifacts = buildUnityReviewArtifacts(requestTypes);
  const requiredApprovalGates = buildUnityApprovalGates(requestTypes);

  return {
    packet_id: `unity-planning-${slugify(normalizedObjective)}`,
    objective: normalizedObjective,
    domains,
    request_types: requestTypes,
    planning_scope: [...new Set(buildUnityPlanningScope(requestTypes))],
    next_safe_stage: nextSafeStage,
    mutation_policy: "planning_only",
    execution_path: EXECUTION_PATH,
    required_review_artifacts: requiredReviewArtifacts,
    required_approval_gates: requiredApprovalGates,
    requests: requestTypes.map((requestType) => ({
      request_type: requestType,
      objective: normalizedObjective,
      next_safe_stage: nextSafeStage,
      required_review_artifacts: requiredReviewArtifacts,
      required_approval_gates: requiredApprovalGates,
    })),
    adapter_status: "design_only",
  };
}

export function deriveProductionPipelinePlan(
  requestText: string,
  route: "clarify" | "plan" | "review" | "block",
): ProductionPipelinePlan | null {
  const objective = requestText.trim();
  if (!objective) {
    return null;
  }

  const domains = detectProductionPipelineDomains(objective);
  if (domains.length === 0) {
    return null;
  }

  const capabilityMap = PRODUCTION_PIPELINE_CAPABILITY_MAP.filter((capability) => domains.includes(capability.domain));
  const nextSafeStage = resolveNextSafeStage(route);
  const unityPlanningPacket = buildUnityProductionPlanningPacket(objective, route, domains);

  return {
    plan_id: `production-pipeline-${slugify(objective)}`,
    objective,
    domains,
    summary: `Route this ${domains.join(", ")} request into ${nextSafeStage} as an advisory production-pipeline plan only. No runtime execution or unsafe file mutation is permitted from chat.`,
    next_safe_stage: nextSafeStage,
    mutation_policy: "planning_only",
    execution_path: EXECUTION_PATH,
    capability_map: capabilityMap,
    safe_interface: capabilityMap.map((capability) => ({
      domain: capability.domain,
      objective,
      next_safe_stage: nextSafeStage,
      mutation_policy: "planning_only",
      requires_operator_review: true,
      execution_path: EXECUTION_PATH,
      future_interfaces: capability.future_interfaces,
    })),
    operator_review_focus: capabilityMap.flatMap((capability) => capability.operator_review_focus),
    unity_planning_packet: unityPlanningPacket,
    unity_validation_execution_result: null,
  };
}