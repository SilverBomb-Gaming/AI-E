import type { ConversationalRefinementRequest } from "./conversationalIntentRefinement";

export type NormalizationFlag =
  | "slang-detected"
  | "broken-grammar"
  | "low-specificity"
  | "indirect-phrasing"
  | "mixed-signals"
  | "uncertain-meaning";

export type NormalizedIntent = {
  target: string | null;
  action: string | null;
  scope: string | null;
  summary: string;
};

export type NormalizationConfidence = {
  value: number;
  reason: string;
};

export type IntentNormalizationResult = {
  original_input: string;
  normalized_input: string;
  extracted_intent: NormalizedIntent;
  detected_targets: string[];
  detected_actions: string[];
  normalization_flags: NormalizationFlag[];
  normalization_confidence: NormalizationConfidence;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function mapSynonyms(input: string): string {
  let normalized = normalizeText(input).toLowerCase();

  normalized = normalized
    .replace(/\bmake it fire\b/g, "improve quality")
    .replace(/\bai dumb\b/g, "improve ai behavior")
    .replace(/\benemy no react grenade\b/g, "enemies should react to grenades")
    .replace(/\bgame boring\b/g, "game feels boring and should be more engaging")
    .replace(/\bidk\b/g, "i don't know")
    .replace(/\bno react\b/g, "should react")
    .replace(/\bgrenade\b/g, "grenades")
    .replace(/\bmake it better\b/g, "improve it")
    .replace(/\bfeel(s)? boring\b/g, "feels boring and should be more engaging")
    .replace(/\bdumb\b/g, "weak")
    .replace(/\bfire\b/g, "high quality");

  return normalized;
}

export function detectTargets(input: string): string[] {
  const lower = normalizeText(input).toLowerCase();
  const targets: string[] = [];

  if (hasAnyKeyword(lower, ["enemy", "enemies", "ai", "npc"])) {
    targets.push("enemies");
  }

  if (hasAnyKeyword(lower, ["combat", "weapon", "weapons", "grenade", "grenades"])) {
    targets.push("combat");
  }

  if (hasAnyKeyword(lower, ["movement", "jump", "controls", "controller", "input"])) {
    targets.push("movement");
  }

  if (hasAnyKeyword(lower, ["visual", "visuals", "art", "graphics", "ui"])) {
    targets.push("visuals");
  }

  if (hasAnyKeyword(lower, ["game", "gameplay", "engagement", "feel"])) {
    targets.push("gameplay");
  }

  return unique(targets);
}

export function detectActions(input: string): string[] {
  const lower = normalizeText(input).toLowerCase();
  const actions: string[] = [];

  if (hasAnyKeyword(lower, ["improve", "better", "quality", "high quality"])) {
    actions.push("improve");
  }

  if (hasAnyKeyword(lower, ["react", "respond"])) {
    actions.push("react");
  }

  if (hasAnyKeyword(lower, ["engagement", "feel", "boring"])) {
    actions.push("improve-engagement");
  }

  if (hasAnyKeyword(lower, ["fix", "repair"])) {
    actions.push("fix");
  }

  return unique(actions);
}

export function extractIntentComponents(input: string): NormalizedIntent {
  const normalized = mapSynonyms(input);
  const detected_targets = detectTargets(normalized);
  const detected_actions = detectActions(normalized);
  const scope = hasAnyKeyword(normalized, ["grenade", "grenades", "when", "during", "first", "only"])
    ? "narrow"
    : null;

  let summary = normalizeText(normalized);

  if (detected_targets.includes("enemies") && detected_actions.includes("react") && hasAnyKeyword(normalized, ["grenade", "grenades"])) {
    summary = "improve enemy reaction to grenades";
  } else if (detected_targets.includes("enemies") && detected_actions.includes("improve")) {
    summary = "improve enemy ai behavior";
  } else if (detected_actions.includes("improve-engagement")) {
    summary = hasAnyKeyword(normalized, ["i don't know", "how to say"])
      ? "i don't know the exact area yet, but the game feels boring and should be more engaging"
      : hasAnyKeyword(normalized, ["boring"])
        ? "game feels boring and should be more engaging"
      : "improve game engagement";
  }

  return {
    target: detected_targets[0] ?? null,
    action: detected_actions[0] ?? null,
    scope,
    summary,
  };
}

export function normalizeUserInput(input: string | ConversationalRefinementRequest): IntentNormalizationResult {
  const original = typeof input === "string" ? input : input.rawRequest;
  const normalized = mapSynonyms(original);
  const extracted = extractIntentComponents(original);
  const detected_targets = detectTargets(normalized);
  const detected_actions = detectActions(normalized);
  const flags: NormalizationFlag[] = [];

  if (normalized !== normalizeText(original).toLowerCase()) {
    flags.push("slang-detected");
  }

  if (/\benemy no react grenade\b/i.test(original) || /\bno react\b/i.test(original)) {
    flags.push("broken-grammar");
  }

  if (hasAnyKeyword(normalized, ["better", "improve", "quality"]) && detected_targets.length === 0) {
    flags.push("low-specificity");
  }

  if (hasAnyKeyword(normalized, ["boring", "engagement", "feel"])) {
    flags.push("indirect-phrasing");
  }

  if (detected_targets.length > 1) {
    flags.push("mixed-signals");
  }

  if (detected_targets.length === 0 && detected_actions.length === 0) {
    flags.push("uncertain-meaning");
  }

  const confidenceBase = 0.88
    - (flags.includes("low-specificity") ? 0.2 : 0)
    - (flags.includes("mixed-signals") ? 0.18 : 0)
    - (flags.includes("uncertain-meaning") ? 0.22 : 0)
    - (flags.includes("indirect-phrasing") ? 0.08 : 0)
    + (flags.includes("broken-grammar") ? 0.04 : 0);

  return {
    original_input: normalizeText(original),
    normalized_input: extracted.summary,
    extracted_intent: extracted,
    detected_targets,
    detected_actions,
    normalization_flags: unique(flags),
    normalization_confidence: {
      value: Math.max(0, Math.min(1, Number(confidenceBase.toFixed(3)))),
      reason: flags.length > 0
        ? `Normalization applied with flags: ${flags.join(", ")}`
        : "Normalization confidence is high because the input already maps cleanly to known target/action patterns.",
    },
  };
}