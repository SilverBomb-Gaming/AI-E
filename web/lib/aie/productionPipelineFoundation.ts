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
};

const EXECUTION_PATH = "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control" as const;

const DOMAIN_KEYWORDS: Record<ProductionPipelineDomain, string[]> = {
  assets: ["asset", "assets", "import", "texture", "material", "sprite", "mesh", "prefab", "addressable"],
  art: ["art", "concept", "ui", "vfx", "animation", "visual", "look", "style", "paintover"],
  audio: ["audio", "sound", "sfx", "music", "voice", "mix", "ambience", "foley"],
  "unity-integration": ["unity", "scene", "prefab", "scriptableobject", "animator", "timeline", "package", "editor", "integration"],
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
  };
}