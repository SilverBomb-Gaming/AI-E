import type { PlanRiskLevel } from "./operatorLightPlanner";

export type AmbiguityFlag =
  | "vague-terms"
  | "missing-target-system"
  | "missing-action"
  | "missing-scope"
  | "conflicting-signals"
  | "risky-autonomy"
  | "broad-scope"
  | "low-vocabulary";

export type IntentConfidenceInput = {
  original_request?: string;
  interpreted_intent?: string;
  clarity_score: number;
  follow_up_questions: string[];
  missing_information: string[];
  ambiguity_flags?: string[];
  answers?: Array<{ answer: string }>;
  questions?: Array<{ prompt: string; answered: boolean }>;
  planner_ready_request: string | null;
  should_create_plan: boolean;
  risk_level: PlanRiskLevel;
};

export type AmbiguityScore = {
  value: number;
  flags: AmbiguityFlag[];
};

export type CompletenessScore = {
  value: number;
  critical_missing_fields: string[];
  non_critical_missing_fields: string[];
};

export type ConfidenceBreakdown = {
  clarity_component: number;
  completeness_component: number;
  inverse_ambiguity_component: number;
  risk_penalty: number;
  answer_bonus: number;
  explanation: string[];
};

export type ConfidenceDecision = {
  action: "proceed_to_planning" | "ask_one_question" | "ask_prioritized_questions" | "block" | "needs_review";
  question_budget: 0 | 1 | 2;
  proceed_to_planning: boolean;
  decision_reason: string;
};

export type IntentConfidenceResult = {
  ambiguity_score: number;
  completeness_score: number;
  confidence_score: number;
  critical_missing_fields: string[];
  non_critical_missing_fields: string[];
  ambiguity_flags: AmbiguityFlag[];
  decision_reason: string;
  breakdown: ConfidenceBreakdown;
  decision: ConfidenceDecision;
};

const VAGUE_TERMS = ["better", "improve", "fix stuff", "stuff", "things", "make it good", "more fun"];
const TARGET_TERMS = ["enemy", "enemies", "ai", "combat", "weapon", "weapons", "movement", "controls", "visual", "visuals", "ui", "level", "checkpoint", "docs", "tests"];
const ACTION_TERMS = ["react", "update", "improve", "fix", "tune", "add", "remove", "refine", "change", "respond"];
const SCOPE_TERMS = ["first", "when", "during", "for", "in", "around", "only", "specific", "target"];

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function collectText(input: IntentConfidenceInput): string {
  return [
    normalizeText(input.original_request),
    normalizeText(input.interpreted_intent),
    normalizeText(input.planner_ready_request),
    ...(input.answers ?? []).map((answer) => normalizeText(answer.answer)),
  ].join(" ").toLowerCase();
}

function isCriticalMissingInformation(item: string): boolean {
  const normalized = normalizeText(item).toLowerCase();
  return [
    "first area to improve is not named",
    "exact behavior change is not specified",
    "target repo surface",
    "system anchor",
    "first safe bounded task",
    "approval boundaries",
  ].some((needle) => normalized.includes(needle));
}

function hasConflictingSignals(text: string): boolean {
  const gameplay = hasAnyKeyword(text, ["enemy", "combat", "movement", "level"]);
  const maintenance = hasAnyKeyword(text, ["readme", "docs", "tests", "documentation"]);
  const visuals = hasAnyKeyword(text, ["visual", "art", "graphics"]);
  return Number(gameplay) + Number(maintenance) + Number(visuals) >= 2 && text.split(" ").length <= 8;
}

export function computeAmbiguityScore(input: IntentConfidenceInput): AmbiguityScore {
  const text = collectText(input);
  const flags: AmbiguityFlag[] = [];
  let value = 0.08;

  if (hasAnyKeyword(text, VAGUE_TERMS)) {
    flags.push("vague-terms");
    value += 0.22;
  }

  if (!hasAnyKeyword(text, TARGET_TERMS)) {
    flags.push("missing-target-system");
    value += 0.24;
  }

  if (!hasAnyKeyword(text, ACTION_TERMS)) {
    flags.push("missing-action");
    value += 0.18;
  }

  if (!hasAnyKeyword(text, SCOPE_TERMS) && normalizeText(input.original_request).split(" ").length <= 6) {
    flags.push("missing-scope");
    value += 0.14;
  }

  if (hasConflictingSignals(text)) {
    flags.push("conflicting-signals");
    value += 0.18;
  }

  if (input.risk_level === "high" || input.risk_level === "blocked" || (input.ambiguity_flags ?? []).includes("risky-autonomy")) {
    flags.push("risky-autonomy");
    value += 0.2;
  }

  if ((input.ambiguity_flags ?? []).includes("broad-scope")) {
    flags.push("broad-scope");
    value += 0.12;
  }

  if ((input.ambiguity_flags ?? []).includes("low-vocabulary-uncertainty")) {
    flags.push("low-vocabulary");
    value += 0.1;
  }

  return {
    value: clamp01(value),
    flags: unique(flags),
  };
}

export function computeCompletenessScore(input: IntentConfidenceInput): CompletenessScore {
  const text = collectText(input);
  const critical_missing_fields = unique(input.missing_information.filter(isCriticalMissingInformation));
  const non_critical_missing_fields = unique(input.missing_information.filter((item) => !isCriticalMissingInformation(item)));
  let value = 0.15;

  if (hasAnyKeyword(text, TARGET_TERMS)) {
    value += 0.3;
  }

  if (hasAnyKeyword(text, ACTION_TERMS)) {
    value += 0.25;
  }

  if (hasAnyKeyword(text, SCOPE_TERMS) || input.answers?.length) {
    value += 0.15;
  }

  if (input.planner_ready_request || input.should_create_plan) {
    value += 0.2;
  }

  value -= critical_missing_fields.length * 0.18;
  value -= non_critical_missing_fields.length * 0.06;

  return {
    value: clamp01(value),
    critical_missing_fields,
    non_critical_missing_fields,
  };
}

export function computeConfidenceScore(input: IntentConfidenceInput): number {
  const clarity_component = clamp01((input.clarity_score ?? 0) / 100);
  const ambiguity = computeAmbiguityScore(input);
  const completeness = computeCompletenessScore(input);
  const answer_bonus = clamp01(Math.min((input.answers?.length ?? 0) * 0.05, 0.12));
  const risk_penalty = input.risk_level === "high" || input.risk_level === "blocked" ? 0.25 : 0;
  const combined = (clarity_component * 0.35)
    + (completeness.value * 0.4)
    + ((1 - ambiguity.value) * 0.25)
    + answer_bonus
    - risk_penalty;

  return clamp01(combined);
}

export function buildConfidenceBreakdown(input: IntentConfidenceInput): ConfidenceBreakdown {
  const ambiguity = computeAmbiguityScore(input);
  const completeness = computeCompletenessScore(input);
  const clarity_component = clamp01((input.clarity_score ?? 0) / 100);
  const answer_bonus = clamp01(Math.min((input.answers?.length ?? 0) * 0.05, 0.12));
  const risk_penalty = input.risk_level === "high" || input.risk_level === "blocked" ? 0.25 : 0;
  const explanation = [
    `clarity=${clarity_component}`,
    `completeness=${completeness.value}`,
    `inverse_ambiguity=${clamp01(1 - ambiguity.value)}`,
  ];

  if (completeness.critical_missing_fields.length > 0) {
    explanation.push(`critical missing fields: ${completeness.critical_missing_fields.join(", ")}`);
  }

  if (ambiguity.flags.length > 0) {
    explanation.push(`ambiguity flags: ${ambiguity.flags.join(", ")}`);
  }

  if (risk_penalty > 0) {
    explanation.push("high-risk penalty applied");
  }

  return {
    clarity_component,
    completeness_component: completeness.value,
    inverse_ambiguity_component: clamp01(1 - ambiguity.value),
    risk_penalty,
    answer_bonus,
    explanation,
  };
}

export function determineConfidenceDecision(result: IntentConfidenceResult): ConfidenceDecision {
  if ((result.ambiguity_flags.includes("risky-autonomy") || result.ambiguity_flags.includes("broad-scope")) && result.ambiguity_score >= 0.55) {
    return {
      action: result.ambiguity_flags.includes("risky-autonomy") ? "block" : "needs_review",
      question_budget: 0,
      proceed_to_planning: false,
      decision_reason: `High ambiguity (${result.ambiguity_score}) combined with risky or broad scope requires review before planning.`,
    };
  }

  if (result.confidence_score >= 0.8) {
    return {
      action: "proceed_to_planning",
      question_budget: 0,
      proceed_to_planning: true,
      decision_reason: `Confidence ${result.confidence_score} is above the planning threshold with acceptable ambiguity and completeness.`,
    };
  }

  if (result.confidence_score >= 0.5) {
    return {
      action: "ask_one_question",
      question_budget: 1,
      proceed_to_planning: false,
      decision_reason: `Confidence ${result.confidence_score} is partial; one focused question should resolve the remaining ambiguity or missing detail.`,
    };
  }

  return {
    action: "ask_prioritized_questions",
    question_budget: 2,
    proceed_to_planning: false,
    decision_reason: `Confidence ${result.confidence_score} is too low; ask one or two prioritized questions before planning.`,
  };
}

export function scoreIntentConfidence(input: IntentConfidenceInput): IntentConfidenceResult {
  const ambiguity = computeAmbiguityScore(input);
  const completeness = computeCompletenessScore(input);
  const confidence_score = computeConfidenceScore(input);
  const breakdown = buildConfidenceBreakdown(input);
  const base: IntentConfidenceResult = {
    ambiguity_score: ambiguity.value,
    completeness_score: completeness.value,
    confidence_score,
    critical_missing_fields: completeness.critical_missing_fields,
    non_critical_missing_fields: completeness.non_critical_missing_fields,
    ambiguity_flags: ambiguity.flags,
    decision_reason: "",
    breakdown,
    decision: {
      action: "ask_prioritized_questions",
      question_budget: 2,
      proceed_to_planning: false,
      decision_reason: "",
    },
  };
  const decision = determineConfidenceDecision(base);
  return {
    ...base,
    decision,
    decision_reason: decision.decision_reason,
  };
}