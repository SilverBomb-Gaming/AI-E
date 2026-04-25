import { detectActions, detectTargets, extractIntentComponents, mapSynonyms } from "./intentNormalization";

export type IntentPriority = "primary" | "secondary" | "deferred";

export type DecompositionFlag =
  | "multiple-intents-detected"
  | "vague-intent-recovery"
  | "conflicting-signals"
  | "needs-clarification"
  | "low-confidence"
  | "original-input-preserved";

export type DecompositionConfidence = {
  value: number;
  reason: string;
};

export type SubIntent = {
  intent_id: string;
  order: number;
  source_text: string;
  summary: string;
  target: string | null;
  action: string | null;
  scope: string | null;
  priority: IntentPriority;
};

export type IntentDecompositionResult = {
  original_input: string;
  normalized_input: string;
  sub_intents: SubIntent[];
  recovery_candidates: string[];
  primary_intent: SubIntent | null;
  multiple_intents_detected: boolean;
  conflicting_signals_detected: boolean;
  should_route_to_clarification: boolean;
  decomposition_flags: DecompositionFlag[];
  decomposition_confidence: DecompositionConfidence;
};

const CONFLICT_PAIRS: Array<[string, string]> = [
  ["faster", "slower"],
  ["more aggressive", "less aggressive"],
  ["harder", "easier"],
  ["more enemies", "fewer enemies"],
  ["increase", "decrease"],
];

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "intent";
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function splitClauses(input: string): string[] {
  return unique(
    normalizeText(input)
      .split(/\b(?:and then|then|also|plus)\b|[;,]+|\s+and\s+/i)
      .map((part) => normalizeText(part))
      .filter(Boolean),
  );
}

function inferExtendedTarget(input: string, detectedTargets: string[]): string | null {
  if (detectedTargets.length > 0) {
    return detectedTargets[0] ?? null;
  }

  const lower = normalizeText(input).toLowerCase();
  if (hasAnyKeyword(lower, ["doc", "docs", "documentation", "readme"])) {
    return "documentation";
  }

  if (hasAnyKeyword(lower, ["test", "tests", "coverage"])) {
    return "tests";
  }

  if (hasAnyKeyword(lower, ["vfx", "sfx", "sound", "audio", "ui", "hud", "visual"])) {
    return "visuals";
  }

  if (hasAnyKeyword(lower, ["level", "layout", "checkpoint", "pacing"])) {
    return "level-design";
  }

  return null;
}

function inferExtendedAction(input: string, detectedActions: string[]): string | null {
  if (detectedActions.length > 0) {
    return detectedActions[0] ?? null;
  }

  const lower = normalizeText(input).toLowerCase();
  if (hasAnyKeyword(lower, ["fix", "repair"])) {
    return "fix";
  }

  if (hasAnyKeyword(lower, ["update", "document", "explain"])) {
    return "update";
  }

  if (hasAnyKeyword(lower, ["add", "include", "hook"])) {
    return "add";
  }

  if (hasAnyKeyword(lower, ["improve", "better", "smarter", "nicer"])) {
    return "improve";
  }

  return null;
}

function buildIntentSummary(input: string, target: string | null, action: string | null): string {
  const extracted = extractIntentComponents(input);
  if (normalizeText(extracted.summary)) {
    return extracted.summary;
  }

  if (target === "documentation") {
    return action === "fix" ? "fix documentation" : "update documentation";
  }

  if (target === "tests") {
    return action === "add" ? "add test coverage" : "update test coverage";
  }

  if (target === "visuals") {
    return action === "add" ? "add visual or audio hook" : "improve visuals or audio feedback";
  }

  if (target === "level-design") {
    return "improve level pacing or checkpoint flow";
  }

  return normalizeText(mapSynonyms(input));
}

function buildSubIntent(sourceText: string, order: number): SubIntent {
  const normalized = mapSynonyms(sourceText);
  const detectedTargets = detectTargets(normalized);
  const detectedActions = detectActions(normalized);
  const extracted = extractIntentComponents(sourceText);
  const target = extracted.target ?? inferExtendedTarget(sourceText, detectedTargets);
  const action = extracted.action ?? inferExtendedAction(sourceText, detectedActions);
  const scope = extracted.scope ?? (hasAnyKeyword(normalized.toLowerCase(), ["when", "during", "first", "only", "grenade", "grenades"]) ? "narrow" : null);
  const summary = buildIntentSummary(sourceText, target, action);

  return {
    intent_id: `sub-intent-${order}-${slugify(summary || sourceText)}`,
    order,
    source_text: normalizeText(sourceText),
    summary,
    target,
    action,
    scope,
    priority: "deferred",
  };
}

function scoreIntent(intent: SubIntent): number {
  return (intent.target ? 3 : 0)
    + (intent.action ? 3 : 0)
    + (intent.scope === "narrow" ? 2 : 0)
    + (intent.summary.includes("improve game engagement") ? -1 : 0)
    + (intent.summary.includes("Clarify") ? -2 : 0)
    - (intent.target === null ? 1 : 0);
}

function detectConflictingSignals(input: string): boolean {
  const lower = normalizeText(mapSynonyms(input)).toLowerCase();
  return CONFLICT_PAIRS.some(([left, right]) => lower.includes(left) && lower.includes(right));
}

function isLowSignalInput(input: string): boolean {
  const normalized = normalizeText(mapSynonyms(input)).toLowerCase();
  const targets = detectTargets(normalized);
  const actions = detectActions(normalized);
  return normalized.split(" ").filter(Boolean).length <= 4
    || (targets.length === 0 && actions.length === 0)
    || (actions.includes("improve") && targets.length === 0)
    || normalized === "make it better"
    || normalized === "improve it";
}

export function detectMultipleIntents(input: string): string[] {
  const clauses = splitClauses(mapSynonyms(input));
  if (clauses.length <= 1) {
    return [];
  }

  return clauses.filter((clause) => {
    const normalized = normalizeText(clause).toLowerCase();
    return detectTargets(normalized).length > 0
      || detectActions(normalized).length > 0
      || hasAnyKeyword(normalized, ["docs", "documentation", "readme", "tests", "vfx", "sfx", "audio", "visual"]);
  });
}

export function recoverVagueIntent(input: string): string[] {
  const normalized = normalizeText(mapSynonyms(input)).toLowerCase();

  if (!isLowSignalInput(normalized)) {
    return [];
  }

  if (hasAnyKeyword(normalized, ["boring", "engaging", "fun", "feel"])) {
    return [
      "improve game engagement",
      "improve combat feel",
      "improve movement feel",
    ];
  }

  if (hasAnyKeyword(normalized, ["enemy", "ai", "npc"])) {
    return [
      "improve enemy behavior",
      "improve enemy reaction to player actions",
    ];
  }

  if (hasAnyKeyword(normalized, ["fix", "broken", "bug"])) {
    return [
      "fix the most visible gameplay issue",
      "fix the named system once the target area is clarified",
    ];
  }

  return [
    "improve gameplay feel",
    "improve enemy behavior",
    "improve controls or movement feel",
  ];
}

export function prioritizeIntents(intents: SubIntent[]): SubIntent[] {
  const ranked = [...intents]
    .sort((left, right) => scoreIntent(right) - scoreIntent(left) || left.order - right.order)
    .map((intent, index) => ({
      ...intent,
      priority: index === 0 ? "primary" : index === 1 ? "secondary" : "deferred",
    }));

  return ranked;
}

export function decomposeIntent(input: string): IntentDecompositionResult {
  const originalInput = normalizeText(input);
  const normalizedInput = normalizeText(mapSynonyms(input));
  const splitIntents = detectMultipleIntents(originalInput);
  const subIntents = (splitIntents.length > 0 ? splitIntents : [normalizedInput])
    .map((clause, index) => buildSubIntent(clause, index + 1));
  const prioritizedIntents = prioritizeIntents(subIntents);
  const recoveryCandidates = recoverVagueIntent(originalInput);
  const conflictingSignalsDetected = detectConflictingSignals(originalInput);
  const flags: DecompositionFlag[] = ["original-input-preserved"];

  if (splitIntents.length > 1) {
    flags.push("multiple-intents-detected");
  }

  if (recoveryCandidates.length > 0) {
    flags.push("vague-intent-recovery");
  }

  if (conflictingSignalsDetected) {
    flags.push("conflicting-signals");
  }

  const shouldRouteToClarification = conflictingSignalsDetected || recoveryCandidates.length > 0;
  if (shouldRouteToClarification) {
    flags.push("needs-clarification");
  }

  const confidenceValue = Number(Math.max(0, Math.min(1,
    0.92
      - (splitIntents.length > 1 ? 0.08 : 0)
      - (recoveryCandidates.length > 0 ? 0.22 : 0)
      - (conflictingSignalsDetected ? 0.26 : 0),
  )).toFixed(3));

  if (confidenceValue < 0.7) {
    flags.push("low-confidence");
  }

  return {
    original_input: originalInput,
    normalized_input: prioritizedIntents[0]?.summary ?? normalizedInput,
    sub_intents: prioritizedIntents,
    recovery_candidates: recoveryCandidates,
    primary_intent: prioritizedIntents[0] ?? null,
    multiple_intents_detected: splitIntents.length > 1,
    conflicting_signals_detected: conflictingSignalsDetected,
    should_route_to_clarification: shouldRouteToClarification,
    decomposition_flags: unique(flags),
    decomposition_confidence: {
      value: confidenceValue,
      reason: shouldRouteToClarification
        ? `Decomposition requires clarification because flags were raised: ${unique(flags).join(", ")}`
        : "Decomposition confidence is high because the input mapped cleanly into one or more bounded sub-intents.",
    },
  };
}

export function summarizeDecomposition(result: IntentDecompositionResult): string {
  return [
    `Original input: ${result.original_input}`,
    `Primary intent: ${result.primary_intent?.summary ?? "none"}`,
    `Sub-intents: ${result.sub_intents.length}`,
    `Recovery candidates: ${result.recovery_candidates.length}`,
    `Flags: ${result.decomposition_flags.join(", ") || "none"}`,
    `Clarification required: ${String(result.should_route_to_clarification)}`,
  ].join("\n");
}