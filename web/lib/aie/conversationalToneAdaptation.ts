import type { PlanRiskLevel } from "./operatorLightPlanner";
import type { AmbiguityFlag, UserLevelEstimate } from "./conversationalIntentRefinement";

export type ResponseMode =
  | "beginner_friendly"
  | "standard"
  | "technical"
  | "handoff_only"
  | "clarification_minimal"
  | "safety_review";

export type ToneAdaptationReason = {
  code:
    | "beginner-language-detected"
    | "technical-language-detected"
    | "handoff-requested"
    | "clarification-needed"
    | "safety-boundary"
    | "confidence-low"
    | "normalized-input-used"
    | "plain-language-preferred";
  message: string;
};

export type UserSkillSignal = {
  signal:
    | "beginner-wording"
    | "technical-wording"
    | "handoff-wording"
    | "uncertainty-wording"
    | "risky-autonomy"
    | "normalized-request";
  strength: "low" | "medium" | "high";
  evidence: string;
};

export type AdaptedResponseGuidance = {
  communication_goal: string;
  explanation_style: string;
  question_style: string;
  handoff_style: string;
  next_step_style: string;
  example_response: string;
};

export type ConversationalToneProfile = {
  response_mode: ResponseMode;
  user_level_estimate: UserLevelEstimate;
  detail_level: "minimal" | "standard" | "detailed";
  should_use_plain_language: boolean;
  should_include_examples: boolean;
  should_include_technical_terms: boolean;
  should_use_handoff_format: boolean;
  should_minimize_questions: boolean;
  safety_tone_required: boolean;
};

export type ToneAdaptationInput = {
  rawRequest: string;
  normalizedInput?: string;
  user_level_estimate?: UserLevelEstimate;
  confidence_score?: number;
  clarity_score?: number;
  ambiguity_flags?: AmbiguityFlag[];
  risk_level?: PlanRiskLevel;
  should_create_plan?: boolean;
  current_interpretation?: string;
};

export type ToneAdaptationResult = ConversationalToneProfile & {
  reasons: ToneAdaptationReason[];
  user_skill_signals: UserSkillSignal[];
  adapted_guidance: AdaptedResponseGuidance;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueByCode<T extends { code?: string; signal?: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  values.forEach((value) => {
    const key = value.code ?? value.signal ?? JSON.stringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  });

  return result;
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function inferUserLevel(input: ToneAdaptationInput): UserLevelEstimate {
  if (input.user_level_estimate) {
    return input.user_level_estimate;
  }

  const lower = normalizeText(input.normalizedInput ?? input.rawRequest).toLowerCase();

  if (hasAnyKeyword(lower, ["contract", "schema", "deterministic", "artifact", "gate", "unit test", "integration test", "api", "module"])) {
    return "technical";
  }

  if (hasAnyKeyword(lower, ["idk", "i don't know", "dont know", "how to say", "less dumb", "make better", "boring"])) {
    return "plain-language";
  }

  return lower.split(" ").filter(Boolean).length <= 3 ? "uncertain" : "mixed";
}

export function detectUserSkillSignals(input: ToneAdaptationInput): UserSkillSignal[] {
  const raw = normalizeText(input.rawRequest).toLowerCase();
  const normalized = normalizeText(input.normalizedInput).toLowerCase();
  const signals: UserSkillSignal[] = [];

  if (hasAnyKeyword(raw, ["idk", "i don't know", "dont know", "how to say", "less dumb", "make better"])) {
    signals.push({
      signal: "beginner-wording",
      strength: "high",
      evidence: normalizeText(input.rawRequest),
    });
  }

  if (hasAnyKeyword(raw, ["deterministic", "artifact", "eligibility gate", "contract", "schema", "unit test", "integration test", "api", "module"])) {
    signals.push({
      signal: "technical-wording",
      strength: "high",
      evidence: normalizeText(input.rawRequest),
    });
  }

  if (hasAnyKeyword(raw, ["handoff please", "next handoff", "handoff only", "just the handoff"])) {
    signals.push({
      signal: "handoff-wording",
      strength: "high",
      evidence: normalizeText(input.rawRequest),
    });
  }

  if (hasAnyKeyword(raw, ["idk", "i don't know", "dont know", "how to say", "not sure"])) {
    signals.push({
      signal: "uncertainty-wording",
      strength: "medium",
      evidence: normalizeText(input.rawRequest),
    });
  }

  if ((input.ambiguity_flags ?? []).includes("risky-autonomy") || hasAnyKeyword(raw, ["overnight", "automatically", "autonomous", "do everything"])) {
    signals.push({
      signal: "risky-autonomy",
      strength: "high",
      evidence: normalizeText(input.rawRequest),
    });
  }

  if (normalized && normalized !== raw) {
    signals.push({
      signal: "normalized-request",
      strength: "medium",
      evidence: normalizeText(input.normalizedInput),
    });
  }

  return uniqueByCode(signals);
}

export function selectResponseMode(input: ToneAdaptationInput): ResponseMode {
  const userLevel = inferUserLevel(input);
  const signals = detectUserSkillSignals(input);
  const confidence = input.confidence_score ?? 0;
  const ambiguityFlags = input.ambiguity_flags ?? [];
  const isRisky = input.risk_level === "high" || input.risk_level === "blocked" || ambiguityFlags.includes("risky-autonomy");

  if (isRisky) {
    return "safety_review";
  }

  if (signals.some((signal) => signal.signal === "handoff-wording")) {
    return "handoff_only";
  }

  if (signals.some((signal) => signal.signal === "technical-wording") && userLevel === "technical") {
    return "technical";
  }

  if (userLevel === "plain-language") {
    return "beginner_friendly";
  }

  if (userLevel === "uncertain" || ambiguityFlags.includes("too-vague") || ambiguityFlags.includes("missing-target-area") || ambiguityFlags.includes("low-vocabulary-uncertainty") || confidence < 0.6) {
    return "clarification_minimal";
  }

  return "standard";
}

function buildReasons(input: ToneAdaptationInput, responseMode: ResponseMode, signals: UserSkillSignal[], userLevel: UserLevelEstimate): ToneAdaptationReason[] {
  const reasons: ToneAdaptationReason[] = [];

  if (responseMode === "beginner_friendly") {
    reasons.push({
      code: "beginner-language-detected",
      message: "Plain-language or low-vocabulary wording suggests AI-E should explain in simpler terms.",
    });
  }

  if (responseMode === "technical") {
    reasons.push({
      code: "technical-language-detected",
      message: "The request uses technical implementation language, so concise contract-and-test wording is appropriate.",
    });
  }

  if (responseMode === "handoff_only") {
    reasons.push({
      code: "handoff-requested",
      message: "The user explicitly asked for a handoff-style response with minimal explanatory prose.",
    });
  }

  if (responseMode === "clarification_minimal") {
    reasons.push({
      code: "clarification-needed",
      message: "The request is still ambiguous enough that AI-E should ask one simple, direct clarification instead of over-explaining.",
    });
  }

  if (responseMode === "safety_review") {
    reasons.push({
      code: "safety-boundary",
      message: "Risk or autonomy signals require a safety-focused response that explains blockers and the next safe step.",
    });
  }

  if ((input.confidence_score ?? 1) < 0.6) {
    reasons.push({
      code: "confidence-low",
      message: "Confidence is low enough that the response should keep assumptions visible and keep questions narrow.",
    });
  }

  if (signals.some((signal) => signal.signal === "normalized-request")) {
    reasons.push({
      code: "normalized-input-used",
      message: "Tone selection considered the normalized request so noisy wording does not distort the communication style.",
    });
  }

  if (userLevel === "plain-language") {
    reasons.push({
      code: "plain-language-preferred",
      message: "The estimated user level suggests plain language is preferable to jargon-heavy phrasing.",
    });
  }

  return uniqueByCode(reasons);
}

export function buildToneAdaptationGuidance(input: ToneAdaptationInput): ToneAdaptationResult {
  const userLevel = inferUserLevel(input);
  const responseMode = selectResponseMode({ ...input, user_level_estimate: userLevel });
  const signals = detectUserSkillSignals({ ...input, user_level_estimate: userLevel });
  const reasons = buildReasons(input, responseMode, signals, userLevel);

  const detail_level = responseMode === "handoff_only" || responseMode === "clarification_minimal"
    ? "minimal"
    : responseMode === "beginner_friendly"
      ? "detailed"
      : "standard";

  const should_use_plain_language = responseMode === "beginner_friendly" || responseMode === "clarification_minimal" || userLevel === "plain-language";
  const should_include_examples = responseMode === "beginner_friendly" || (responseMode === "clarification_minimal" && (input.confidence_score ?? 1) < 0.6);
  const should_include_technical_terms = responseMode === "technical";
  const should_use_handoff_format = responseMode === "handoff_only";
  const should_minimize_questions = responseMode === "handoff_only" || responseMode === "clarification_minimal" || responseMode === "safety_review";
  const safety_tone_required = responseMode === "safety_review";

  const adapted_guidance: AdaptedResponseGuidance = responseMode === "technical"
    ? {
      communication_goal: "Use precise engineering language without extra tutorial framing.",
      explanation_style: "Lead with contracts, bounded scope, validation targets, and explicit assumptions.",
      question_style: "Ask only the highest-signal clarification needed to define the implementation surface.",
      handoff_style: "Use concise implementation bullets when handing off work.",
      next_step_style: "Prioritize exact tests, interfaces, and acceptance criteria.",
      example_response: "Implement a deterministic eligibility gate, add focused tests, and validate the contract boundaries.",
    }
    : responseMode === "handoff_only"
      ? {
        communication_goal: "Deliver only the handoff-ready outcome with minimal narrative.",
        explanation_style: "Skip long explanations unless a blocker must be stated.",
        question_style: "Avoid extra questions unless a single blocker prevents safe handoff.",
        handoff_style: "Use direct handoff format with scope, blockers, and next action.",
        next_step_style: "State the next bounded task plainly.",
        example_response: "Handoff: implement the next bounded layer, validate with focused tests, then return the result summary.",
      }
      : responseMode === "clarification_minimal"
        ? {
          communication_goal: "Get one missing detail with the fewest possible words.",
          explanation_style: "Keep the explanation short and avoid layered prose.",
          question_style: "Ask one simple question that names a few concrete options.",
          handoff_style: "Do not switch to handoff format yet unless the request becomes specific.",
          next_step_style: "Explain that AI-E is waiting on one missing choice before planning.",
          example_response: "Which area should AI-E focus on first: enemies, movement, visuals, or level pacing?",
        }
        : responseMode === "safety_review"
          ? {
            communication_goal: "Explain the safety boundary clearly and keep the next safe step explicit.",
            explanation_style: "State the blocker first, then name the first safe bounded alternative.",
            question_style: "Ask only approval or scope questions needed to continue safely.",
            handoff_style: "Use a concise review format that highlights the blocker and safe next step.",
            next_step_style: "Do not imply automatic execution; require a bounded approved task.",
            example_response: "AI-E cannot do everything automatically overnight. Name the first safe bounded task to review next.",
          }
          : responseMode === "beginner_friendly"
            ? {
              communication_goal: "Meet the user at a plain-language level and reduce jargon.",
              explanation_style: "Use simple wording and short explanations before asking for one concrete detail.",
              question_style: "Ask small, direct questions with examples when the request is vague.",
              handoff_style: "Only use handoff formatting if the user explicitly asks for it.",
              next_step_style: "Explain what AI-E understands so far, then show one easy next choice.",
              example_response: "It sounds like you want enemies to act smarter. For example, should they react faster, aim better, or respond to grenades?",
            }
            : {
              communication_goal: "Keep the response balanced, direct, and easy to scan.",
              explanation_style: "Use normal implementation wording without over-explaining.",
              question_style: "Ask concise follow-ups only when they materially improve the plan.",
              handoff_style: "Use standard structured summaries when handing off work.",
              next_step_style: "State the current interpretation and the next bounded action.",
              example_response: "AI-E can proceed once the target area is confirmed, then produce a bounded plan and validation steps.",
            };

  return {
    response_mode: responseMode,
    user_level_estimate: userLevel,
    detail_level,
    should_use_plain_language,
    should_include_examples,
    should_include_technical_terms,
    should_use_handoff_format,
    should_minimize_questions,
    safety_tone_required,
    reasons,
    user_skill_signals: signals,
    adapted_guidance,
  };
}

export function summarizeToneAdaptation(result: ToneAdaptationResult): string {
  return [
    `Response mode: ${result.response_mode}`,
    `User level: ${result.user_level_estimate}`,
    `Detail level: ${result.detail_level}`,
    `Plain language: ${result.should_use_plain_language}`,
    `Examples: ${result.should_include_examples}`,
    `Technical terms: ${result.should_include_technical_terms}`,
    `Handoff format: ${result.should_use_handoff_format}`,
    `Minimize questions: ${result.should_minimize_questions}`,
    `Safety review: ${result.safety_tone_required}`,
    `Reasons: ${result.reasons.map((reason) => reason.message).join(" | ") || "none"}`,
    `Guidance: ${result.adapted_guidance.communication_goal}`,
  ].join("\n");
}