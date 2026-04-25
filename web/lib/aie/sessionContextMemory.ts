import type { ConversationalRefinementRequest } from "./conversationalIntentRefinement";
import type { ConversationalLoopSession } from "./multiTurnConversationalLoop";
import type { OperatorRequest } from "./operatorLightPlanner";

export type SessionPreference = {
  key: string;
  value: string;
  source: "answer" | "interpretation" | "planner_ready_request";
  updated_at: string;
  weight: number;
};

export type SessionIntentSnapshot = {
  intent_id: string;
  interpreted_intent: string;
  planner_ready_request: string;
  target: string;
  confidence_score: number;
  created_at: string;
};

export type SessionMemoryEntry = {
  entry_id: string;
  kind: "intent" | "preference" | "summary";
  value: string;
  created_at: string;
};

export type SessionContext = {
  session_id: string;
  created_at: string;
  updated_at: string;
  recent_intents: SessionIntentSnapshot[];
  resolved_preferences: SessionPreference[];
  recurring_targets: string[];
  last_planner_ready_request: string | null;
  confidence_history: number[];
  conversation_summary: string;
  context_version: number;
};

export type SessionContextUpdate = {
  loopSession: ConversationalLoopSession;
  updatedAt?: string;
};

export type SessionContextResult = {
  context: SessionContext;
  changed: boolean;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "session-context";
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function capList<T>(values: T[], maxItems: number): T[] {
  return values.slice(0, maxItems);
}

function containsAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function deriveTarget(text: string): string {
  const normalized = normalizeText(text).toLowerCase();

  if (containsAnyKeyword(normalized, ["enemy", "enemies", "ai"])) {
    return "enemies";
  }

  if (containsAnyKeyword(normalized, ["combat", "weapon", "weapons", "grenade"])) {
    return "combat";
  }

  if (containsAnyKeyword(normalized, ["movement", "jump", "controls", "traversal"])) {
    return "movement";
  }

  if (containsAnyKeyword(normalized, ["visual", "visuals", "graphics", "art"])) {
    return "visuals";
  }

  if (containsAnyKeyword(normalized, ["level", "layout", "pacing", "checkpoint"])) {
    return "level-design";
  }

  return "general";
}

function buildIntentId(loopSession: ConversationalLoopSession): string {
  return `intent-${slugify(loopSession.current_interpretation)}-${loopSession.updated_at.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000"}`;
}

function summarizeContext(context: SessionContext): string {
  const recentIntent = context.recent_intents[0];
  const preferences = context.resolved_preferences.map((preference) => `${preference.key}: ${preference.value}`).join(" | ") || "none";
  const targets = context.recurring_targets.join(", ") || "none";
  return [
    `Recent intent: ${recentIntent?.interpreted_intent ?? "none"}.`,
    `Recurring targets: ${targets}.`,
    `Preferences: ${preferences}.`,
    `Last planner-ready request: ${context.last_planner_ready_request ?? "none"}.`,
  ].join(" ");
}

function createPreference(
  key: string,
  value: string,
  source: SessionPreference["source"],
  updatedAt: string,
  weight = 1,
): SessionPreference {
  return {
    key,
    value,
    source,
    updated_at: updatedAt,
    weight,
  };
}

function extractAnswerPreferences(loopSession: ConversationalLoopSession, updatedAt: string): SessionPreference[] {
  const preferences: SessionPreference[] = [];
  const normalizedAnswers = loopSession.answers.map((item) => normalizeText(item.answer).toLowerCase());

  if (normalizedAnswers.some((answer) => answer.includes("enemy"))) {
    preferences.push(createPreference("focus-area", "enemies", "answer", updatedAt, 3));
  }

  if (normalizedAnswers.some((answer) => answer.includes("gameplay") || answer.includes("combat"))) {
    preferences.push(createPreference("priority", "gameplay over visuals", "answer", updatedAt, 2));
  }

  if (normalizedAnswers.some((answer) => answer.includes("visual"))) {
    preferences.push(createPreference("focus-area", "visuals", "answer", updatedAt, 2));
  }

  return preferences;
}

export function createSessionContext(session_id: string, createdAt?: string): SessionContext {
  const timestamp = normalizeText(createdAt) || new Date().toISOString();
  return {
    session_id,
    created_at: timestamp,
    updated_at: timestamp,
    recent_intents: [],
    resolved_preferences: [],
    recurring_targets: [],
    last_planner_ready_request: null,
    confidence_history: [],
    conversation_summary: "No conversational context has been stored yet.",
    context_version: 1,
  };
}

export function extractPreferences(loopSession: ConversationalLoopSession): SessionPreference[] {
  const updatedAt = loopSession.updated_at;
  const preferences = [
    ...extractAnswerPreferences(loopSession, updatedAt),
  ];

  const target = deriveTarget(loopSession.current_interpretation);
  if (target !== "general") {
    preferences.push(createPreference("focus-area", target, "interpretation", updatedAt, 2));
  }

  if (loopSession.planner_ready_request?.rawRequest && deriveTarget(loopSession.planner_ready_request.rawRequest) === "enemies") {
    preferences.push(createPreference("preferred-system", "enemy behavior", "planner_ready_request", updatedAt, 3));
  }

  const dedupedByKey = new Map<string, SessionPreference>();
  preferences.forEach((preference) => {
    const existing = dedupedByKey.get(preference.key);
    if (!existing || preference.weight >= existing.weight) {
      dedupedByKey.set(preference.key, preference);
    }
  });

  return [...dedupedByKey.values()];
}

export function mergeIntentSnapshots(
  context: SessionContext,
  loopSession: ConversationalLoopSession,
): SessionIntentSnapshot[] {
  if (loopSession.status !== "planner_ready" || !loopSession.planner_ready_request) {
    return [...context.recent_intents];
  }

  const snapshot: SessionIntentSnapshot = {
    intent_id: buildIntentId(loopSession),
    interpreted_intent: loopSession.current_interpretation,
    planner_ready_request: loopSession.planner_ready_request.rawRequest,
    target: deriveTarget(loopSession.current_interpretation),
    confidence_score: loopSession.confidence_score,
    created_at: loopSession.updated_at,
  };

  const filtered = context.recent_intents.filter((entry) => entry.target !== snapshot.target);
  return capList([snapshot, ...filtered], 5);
}

function mergePreferences(
  context: SessionContext,
  loopSession: ConversationalLoopSession,
): SessionPreference[] {
  const incoming = extractPreferences(loopSession);
  const byKey = new Map<string, SessionPreference>();

  [...context.resolved_preferences, ...incoming].forEach((preference) => {
    const existing = byKey.get(preference.key);
    if (!existing || preference.updated_at >= existing.updated_at || preference.weight >= existing.weight) {
      byKey.set(preference.key, preference);
    }
  });

  return capList(
    [...byKey.values()].sort((left, right) => right.updated_at.localeCompare(left.updated_at) || right.weight - left.weight),
    6,
  );
}

function buildRecurringTargets(
  intents: SessionIntentSnapshot[],
  preferences: SessionPreference[],
): string[] {
  return unique([
    ...intents.map((intent) => intent.target),
    ...preferences
      .filter((preference) => preference.key === "focus-area")
      .map((preference) => preference.value),
  ]);
}

export function updateSessionContext(
  context: SessionContext,
  loopSession: ConversationalLoopSession,
): SessionContextResult {
  const updatedAt = loopSession.updated_at;
  const recentIntents = mergeIntentSnapshots(context, loopSession);
  const resolvedPreferences = mergePreferences(context, loopSession);
  const recurringTargets = buildRecurringTargets(recentIntents, resolvedPreferences);
  const confidenceHistory = capList([loopSession.confidence_score, ...context.confidence_history], 8);

  const nextContext: SessionContext = {
    ...context,
    updated_at: updatedAt,
    recent_intents: recentIntents,
    resolved_preferences: resolvedPreferences,
    recurring_targets: recurringTargets,
    last_planner_ready_request: loopSession.planner_ready_request?.rawRequest ?? context.last_planner_ready_request,
    confidence_history: confidenceHistory,
    context_version: context.context_version + 1,
  };

  nextContext.conversation_summary = summarizeContext(nextContext);

  const changed = JSON.stringify(nextContext) !== JSON.stringify(context);
  return {
    context: nextContext,
    changed,
  };
}

function isRelevantContext(context: SessionContext, newInput: ConversationalRefinementRequest): boolean {
  const normalizedRequest = normalizeText(newInput.rawRequest).toLowerCase();
  const target = deriveTarget(normalizedRequest);

  if (target !== "general" && context.recurring_targets.includes(target)) {
    return true;
  }

  if (containsAnyKeyword(normalizedRequest, ["combat", "gameplay", "enemy", "enemies"])) {
    return context.recurring_targets.includes("enemies") || context.resolved_preferences.some((preference) => preference.value.includes("enemy"));
  }

  return false;
}

export function getContextAugmentedRequest(
  context: SessionContext,
  newInput: ConversationalRefinementRequest,
): ConversationalRefinementRequest {
  if (!isRelevantContext(context, newInput)) {
    return {
      ...newInput,
      operatorContext: newInput.operatorContext ? [...newInput.operatorContext] : undefined,
      knownConstraints: newInput.knownConstraints ? [...newInput.knownConstraints] : undefined,
    };
  }

  const contextNotes = [
    ...context.resolved_preferences.map((preference) => `Session preference: ${preference.value}`),
    ...context.recent_intents.slice(0, 2).map((intent) => `Recent session intent: ${intent.interpreted_intent}`),
  ];

  return {
    ...newInput,
    operatorContext: unique([
      ...(newInput.operatorContext ?? []),
      ...contextNotes,
    ]),
    knownConstraints: unique([
      ...(newInput.knownConstraints ?? []),
      context.last_planner_ready_request ? `Recent planner-ready request: ${context.last_planner_ready_request}` : "",
    ]),
  };
}

export function summarizeSessionContext(context: SessionContext): string {
  return [
    `Session context: ${context.session_id}`,
    `Context version: ${context.context_version}`,
    `Updated: ${context.updated_at}`,
    `Recurring targets: ${context.recurring_targets.join(", ") || "none"}`,
    `Preferences: ${context.resolved_preferences.map((preference) => `${preference.key}=${preference.value}`).join(" | ") || "none"}`,
    `Recent intents: ${context.recent_intents.map((intent) => intent.interpreted_intent).join(" | ") || "none"}`,
    `Confidence history: ${context.confidence_history.join(", ") || "none"}`,
    `Summary: ${context.conversation_summary}`,
  ].join("\n");
}