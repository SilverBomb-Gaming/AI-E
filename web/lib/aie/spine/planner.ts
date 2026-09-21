import type { BoundedPlan, PlanStatus, PlanStep, PlannerIntent } from "./types";

const ENGINE_ALIASES: Record<string, string[]> = {
  unity: ["unity", "unity3d", "unity engine"],
  unreal: ["unreal", "unreal engine", "ue5", "ue4"],
  godot: ["godot", "godot engine", "godot 4"],
};

const PLATFORM_ALIASES: Record<string, string[]> = {
  mobile: ["mobile", "android", "ios"],
  pc: ["pc", "desktop", "windows"],
  webgl: ["webgl", "browser", "web"],
  console: ["console", "xbox", "playstation", "switch"],
};

const FEATURE_MARKERS: Array<[string, string[]]> = [
  ["third_person_controller", ["third-person controller", "third person controller"]],
  ["first_person_controller", ["first-person controller", "first person controller"]],
  ["inventory", ["inventory"]],
  ["camera", ["camera", "camera follow"]],
  ["movement", ["movement", "locomotion", "jump", "dash"]],
  ["combat", ["combat", "weapon", "enemy ai"]],
  ["dialogue", ["dialogue"]],
  ["save_system", ["save system", "saving"]],
];

const BLOCKED_CONDITIONS: Array<{ keywords: string[]; reason: string }> = [
  {
    keywords: ["edit scenes", "edit unity scenes", "modify scenes", "scene mutation", "mutate the scene"],
    reason: "Direct scene mutation is outside this public spine. The local operator console can review sandbox mutations; this demo only plans.",
  },
  {
    keywords: ["prefab edit", "edit prefab", "prefab editing"],
    reason: "Prefab editing is outside this public spine.",
  },
  {
    keywords: ["build pipeline", "full build", "build automation", "ship the build"],
    reason: "Build pipeline automation is outside this public spine.",
  },
  {
    keywords: ["autonomous", "fully automatic", "do everything automatically", "no human review"],
    reason: "Autonomous execution without review is outside AI-E's design. Plans stay review-gated.",
  },
];

const FEATURE_TITLES: Record<string, string> = {
  third_person_controller: "third-person controller",
  first_person_controller: "first-person controller",
  inventory: "inventory",
  camera: "camera follow",
  movement: "movement",
  combat: "combat",
  dialogue: "dialogue",
  save_system: "save system",
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function detectEngine(normalized: string): string | null {
  for (const [canonical, aliases] of Object.entries(ENGINE_ALIASES)) {
    if (includesAny(normalized, aliases)) {
      return canonical;
    }
  }
  return null;
}

function detectPlatform(normalized: string): string | null {
  for (const [canonical, aliases] of Object.entries(PLATFORM_ALIASES)) {
    if (includesAny(normalized, aliases)) {
      return canonical;
    }
  }
  return null;
}

function detectFeatures(normalized: string): string[] {
  const matches: string[] = [];
  for (const [feature, markers] of FEATURE_MARKERS) {
    if (includesAny(normalized, markers)) {
      matches.push(feature);
    }
  }
  return matches;
}

function detectBlocked(normalized: string): string[] {
  return BLOCKED_CONDITIONS.filter((condition) => includesAny(normalized, condition.keywords)).map(
    (condition) => condition.reason,
  );
}

function featureLabel(feature: string): string {
  return FEATURE_TITLES[feature] ?? feature.replace(/_/g, " ");
}

function buildMissingInputs(engineTarget: string | null, features: string[]): string[] {
  const missing: string[] = [];
  if (!engineTarget) {
    missing.push("engine_target");
  }
  if (features.length === 0) {
    missing.push("feature_slice");
  }
  return missing;
}

function statusFor(params: {
  blockedItems: string[];
  engineTarget: string | null;
  missingInputs: string[];
}): PlanStatus {
  if (params.blockedItems.length > 0) {
    return "blocked_unsafe";
  }
  if (params.engineTarget && params.engineTarget !== "unity") {
    return "unsupported_target";
  }
  if (!params.engineTarget || params.missingInputs.length > 0) {
    return "bounded_draft";
  }
  return "supported_ready";
}

function buildSteps(params: {
  status: PlanStatus;
  engineTarget: string | null;
  features: string[];
}): PlanStep[] {
  const feature = params.features[0] ? featureLabel(params.features[0]) : "requested mechanic";

  if (params.status === "blocked_unsafe") {
    return [
      {
        id: "reduce-scope",
        title: "Reduce the request to a reviewable slice",
        detail: "Remove scene, prefab, build, or autonomous execution language. Ask for a script-level scaffold instead.",
      },
      {
        id: "replan",
        title: "Re-run the planner on the reduced request",
        detail: "Once the request is bounded, AI-E can emit a scaffold-first plan with explicit review gates.",
      },
    ];
  }

  if (params.status === "unsupported_target") {
    return [
      {
        id: "confirm-engine",
        title: "Confirm a supported engine target",
        detail: `${params.engineTarget} is recognized but not implemented in this spine. Unity is the only adapter today.`,
      },
      {
        id: "retarget-or-wait",
        title: "Retarget to Unity or keep the request as a note",
        detail: "Do not pretend an Unreal or Godot adapter exists. Either rephrase for Unity or leave the work blocked.",
      },
    ];
  }

  const steps: PlanStep[] = [
    {
      id: "parse-intent",
      title: "Lock the bounded intent",
      detail: params.engineTarget
        ? `Treat this as a ${params.engineTarget} ${feature} slice, not a full game system.`
        : `Name the engine (Unity is supported) and keep the first slice to one mechanic such as ${feature}.`,
    },
    {
      id: "scaffold",
      title: `Scaffold the ${feature} surface`,
      detail:
        "Plan script-level stubs and inspector-driven wiring only. Do not mutate scenes, prefabs, or project settings from this demo.",
    },
    {
      id: "verify",
      title: "Define a single verification check",
      detail: "Enter Play Mode on a minimal scene and confirm only the targeted mechanic before adding adjacent systems.",
    },
    {
      id: "review",
      title: "Stop for human review",
      detail: "Hand the plan to an operator. This spine does not apply patches, run Unity, or approve its own work.",
    },
  ];

  if (params.status === "bounded_draft") {
    steps.unshift({
      id: "fill-gaps",
      title: "Fill missing inputs before execution talk",
      detail: "The request is usable as a draft, but engine or feature detail is incomplete. Keep it scaffold-only until those are named.",
    });
  }

  return steps;
}

function buildSummary(params: {
  status: PlanStatus;
  engineTarget: string | null;
  features: string[];
  blockedItems: string[];
}): string {
  const feature = params.features[0] ? featureLabel(params.features[0]) : "an underspecified mechanic";

  switch (params.status) {
    case "blocked_unsafe":
      return `Blocked: ${params.blockedItems[0] ?? "the request crosses a hard safety boundary."}`;
    case "unsupported_target":
      return `Unsupported engine target: ${params.engineTarget}. Unity is the only implemented adapter in this public spine.`;
    case "bounded_draft":
      return `Draft-only plan for ${feature}. Missing inputs stay visible instead of being guessed.`;
    case "supported_with_warnings":
    case "supported_ready":
      return `Bounded Unity plan for ${feature}. Scaffold and review only — this tool does not execute engine work.`;
  }
}

/**
 * Deterministic Constraint Router slice used by the public demo.
 * It plans. It does not run Unity, edit files, or approve itself.
 */
export function planBoundedRequest(rawRequest: string): BoundedPlan {
  const goal = rawRequest.trim().replace(/[.]+$/, "") || "(empty request)";
  const normalized = normalize(rawRequest);
  const engineTarget = detectEngine(normalized);
  const platformTarget = detectPlatform(normalized);
  const features = detectFeatures(normalized);
  const blockedItems = unique(detectBlocked(normalized));
  const missingInputs = engineTarget && engineTarget !== "unity" ? [] : buildMissingInputs(engineTarget, features);
  const status = statusFor({ blockedItems, engineTarget, missingInputs });

  const intent: PlannerIntent = {
    goal,
    engineTarget,
    platformTarget,
    features,
    missingInputs,
  };

  const limitations = unique([
    "This public spine plans only. It does not launch Unity, edit scenes, or apply patches.",
    "Unreal and Godot return explicit unsupported-target results.",
    "Vague requests become draft plans with missing inputs instead of hidden guesses.",
    ...(status === "blocked_unsafe" ? blockedItems : []),
  ]);

  return {
    status,
    summary: buildSummary({ status, engineTarget, features, blockedItems }),
    intent,
    steps: buildSteps({ status, engineTarget, features }),
    blockedItems,
    limitations,
    reviewRequired: true,
    executed: false,
  };
}
