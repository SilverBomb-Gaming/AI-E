import type { PlanRiskLevel } from "./operatorLightPlanner";
import {
  computeConfidenceScore as computeIntentConfidenceScore,
  scoreIntentConfidence,
  type IntentConfidenceResult,
} from "./intentConfidenceScoring";

export type QuestionNecessity = "low" | "medium" | "high";

export type QuestionPriority =
  | "scope-defining"
  | "system-impact"
  | "validation-critical"
  | "none";

export type AdaptiveStopReason =
  | "confidence_sufficient"
  | "max_follow_ups_reached"
  | "diminishing_returns"
  | "repetitive_vague_answers"
  | "high_risk_request"
  | null;

export type AdaptiveConversationSnapshot = {
  clarity_score: number;
  confidence_score: number;
  missing_information: string[];
  answers: Array<{ answer: string }>;
  questions: Array<{ prompt: string; answered: boolean }>;
  latest_refinement: {
    risk_level: PlanRiskLevel;
    follow_up_questions: string[];
    planner_ready_request: string | null;
    should_create_plan: boolean;
    ambiguity_flags: string[];
    missing_information: string[];
    clarity_score: number;
    confidence_score: number;
  };
};

export type AdaptiveDecision = {
  confidence_score: number;
  question_necessity: QuestionNecessity;
  question_priority: QuestionPriority;
  stop_reason: AdaptiveStopReason;
  should_ask_follow_up: boolean;
  selected_follow_up_question: string | null;
  proceed_to_planning: boolean;
  decision_reason: string;
  ambiguity_score: number;
  completeness_score: number;
  confidence_result: IntentConfidenceResult;
};

export type StopAskingResult = {
  should_stop: boolean;
  reason: AdaptiveStopReason;
};

type PrioritizedQuestion = {
  prompt: string;
  priority: QuestionPriority;
  score: number;
};

const CONFIDENCE_THRESHOLD = 0.8;
const MAX_FOLLOW_UPS = 3;
const VAGUE_PATTERNS = [
  /^better$/i,
  /^stuff$/i,
  /^things$/i,
  /^not sure$/i,
  /^idk$/i,
  /^i dont know$/i,
  /^i don't know$/i,
  /^same$/i,
  /^whatever$/i,
  /^more fun$/i,
  /^good$/i,
];

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isCriticalMissingInformation(item: string): boolean {
  const normalized = normalizeText(item).toLowerCase();
  return [
    "not named",
    "not specified",
    "not defined",
    "first safe bounded task",
    "approval boundaries",
    "target repo surface",
    "system anchor",
    "exact behavior change",
  ].some((needle) => normalized.includes(needle));
}

function isVagueAnswer(answer: string): boolean {
  const normalized = normalizeText(answer);
  return normalized.length <= 3 || VAGUE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasRepeatedVagueAnswers(answers: Array<{ answer: string }>): boolean {
  if (answers.length < 2) {
    return false;
  }

  const recentAnswers = answers.slice(-2).map((item) => normalizeText(item.answer).toLowerCase());
  return recentAnswers.every((answer) => isVagueAnswer(answer)) || recentAnswers[0] === recentAnswers[1];
}

function countCriticalMissingInformation(snapshot: AdaptiveConversationSnapshot): number {
  return snapshot.missing_information.filter(isCriticalMissingInformation).length;
}

function prioritizeQuestion(prompt: string): PrioritizedQuestion {
  const normalized = normalizeText(prompt).toLowerCase();

  if (
    normalized.includes("which part should improve first")
    || normalized.includes("what should enemies do better first")
    || normalized.includes("start with")
    || normalized.includes("what should ai-e change first")
  ) {
    return { prompt, priority: "scope-defining", score: 100 };
  }

  if (
    normalized.includes("behavior")
    || normalized.includes("system")
    || normalized.includes("surface")
    || normalized.includes("scene")
    || normalized.includes("repo")
  ) {
    return { prompt, priority: "system-impact", score: 75 };
  }

  if (
    normalized.includes("validation")
    || normalized.includes("test")
    || normalized.includes("playtest")
  ) {
    return { prompt, priority: "validation-critical", score: 50 };
  }

  return { prompt, priority: "none", score: 0 };
}

function buildFallbackQuestion(snapshot: AdaptiveConversationSnapshot): PrioritizedQuestion | null {
  const missingText = snapshot.missing_information.join(" ").toLowerCase();

  if (missingText.includes("first area to improve is not named")) {
    return prioritizeQuestion("What should AI-E improve first: enemies, weapons, controls, visuals, or level design?");
  }

  if (missingText.includes("exact behavior change is not specified")) {
    return prioritizeQuestion("What should that system do better first?");
  }

  if (missingText.includes("target repo surface") || missingText.includes("system anchor")) {
    return prioritizeQuestion("Which system or repo area should AI-E touch first?");
  }

  return null;
}

export function computeConfidenceScore(snapshot: AdaptiveConversationSnapshot): number {
  return computeIntentConfidenceScore({
    original_request: "",
    interpreted_intent: "",
    clarity_score: snapshot.latest_refinement.clarity_score,
    follow_up_questions: snapshot.latest_refinement.follow_up_questions,
    missing_information: snapshot.latest_refinement.missing_information,
    ambiguity_flags: snapshot.latest_refinement.ambiguity_flags,
    answers: snapshot.answers,
    questions: snapshot.questions,
    planner_ready_request: snapshot.latest_refinement.planner_ready_request,
    should_create_plan: snapshot.latest_refinement.should_create_plan,
    risk_level: snapshot.latest_refinement.risk_level,
  });
}

export function selectBestFollowUpQuestion(snapshot: AdaptiveConversationSnapshot): {
  question: string | null;
  priority: QuestionPriority;
} {
  const existingPrompts = new Set(snapshot.questions.map((question) => question.prompt));
  const candidates = snapshot.latest_refinement.follow_up_questions
    .filter((prompt) => !existingPrompts.has(prompt))
    .map(prioritizeQuestion)
    .sort((left, right) => right.score - left.score || left.prompt.localeCompare(right.prompt));

  if (candidates.length === 0) {
    const fallback = buildFallbackQuestion(snapshot);
    return {
      question: fallback?.prompt ?? null,
      priority: fallback?.priority ?? "none",
    };
  }

  return {
    question: candidates[0]?.prompt ?? null,
    priority: candidates[0]?.priority ?? "none",
  };
}

export function shouldStopAsking(
  snapshot: AdaptiveConversationSnapshot,
  previousClarityScore?: number,
): StopAskingResult {
  const confidenceScore = computeConfidenceScore(snapshot);
  const criticalMissingCount = countCriticalMissingInformation(snapshot);

  if (snapshot.latest_refinement.risk_level === "high" || snapshot.latest_refinement.risk_level === "blocked") {
    return { should_stop: true, reason: "high_risk_request" };
  }

  if (confidenceScore >= CONFIDENCE_THRESHOLD && criticalMissingCount === 0) {
    return { should_stop: true, reason: "confidence_sufficient" };
  }

  if (snapshot.answers.length >= MAX_FOLLOW_UPS) {
    return { should_stop: true, reason: "max_follow_ups_reached" };
  }

  if (snapshot.answers.length >= 2 && hasRepeatedVagueAnswers(snapshot.answers)) {
    return { should_stop: true, reason: "repetitive_vague_answers" };
  }

  if (
    snapshot.answers.length >= 2
    && typeof previousClarityScore === "number"
    && snapshot.latest_refinement.clarity_score - previousClarityScore <= 5
  ) {
    return { should_stop: true, reason: "diminishing_returns" };
  }

  return { should_stop: false, reason: null };
}

export function shouldAskFollowUp(
  snapshot: AdaptiveConversationSnapshot,
  previousClarityScore?: number,
): boolean {
  const stopResult = shouldStopAsking(snapshot, previousClarityScore);
  const confidenceScore = computeConfidenceScore(snapshot);
  const criticalMissingCount = countCriticalMissingInformation(snapshot);
  const bestQuestion = selectBestFollowUpQuestion(snapshot);

  if (stopResult.should_stop) {
    return false;
  }

  if (!bestQuestion.question || snapshot.questions.length >= MAX_FOLLOW_UPS) {
    return false;
  }

  return confidenceScore < CONFIDENCE_THRESHOLD
    && (criticalMissingCount > 0 || snapshot.latest_refinement.follow_up_questions.length > 0);
}

export function determineNextAction(
  snapshot: AdaptiveConversationSnapshot,
  previousClarityScore?: number,
): AdaptiveDecision {
  const confidenceResult = scoreIntentConfidence({
    original_request: "",
    interpreted_intent: "",
    clarity_score: snapshot.latest_refinement.clarity_score,
    follow_up_questions: snapshot.latest_refinement.follow_up_questions,
    missing_information: snapshot.latest_refinement.missing_information,
    ambiguity_flags: snapshot.latest_refinement.ambiguity_flags,
    answers: snapshot.answers,
    questions: snapshot.questions,
    planner_ready_request: snapshot.latest_refinement.planner_ready_request,
    should_create_plan: snapshot.latest_refinement.should_create_plan,
    risk_level: snapshot.latest_refinement.risk_level,
  });
  const confidenceScore = confidenceResult.confidence_score;
  const stopResult = shouldStopAsking(snapshot, previousClarityScore);
  const bestQuestion = selectBestFollowUpQuestion(snapshot);
  const criticalMissingCount = countCriticalMissingInformation(snapshot);

  let questionNecessity: QuestionNecessity = "medium";
  if (confidenceScore >= CONFIDENCE_THRESHOLD && criticalMissingCount === 0) {
    questionNecessity = "low";
  } else if (criticalMissingCount > 0) {
    questionNecessity = "high";
  }

  const proceedToPlanning = confidenceResult.decision.proceed_to_planning
    || (stopResult.should_stop && snapshot.latest_refinement.risk_level !== "high" && snapshot.latest_refinement.risk_level !== "blocked");

  return {
    confidence_score: confidenceScore,
    question_necessity: questionNecessity,
    question_priority: bestQuestion.priority,
    stop_reason: stopResult.reason,
    should_ask_follow_up: !proceedToPlanning && shouldAskFollowUp(snapshot, previousClarityScore),
    selected_follow_up_question: bestQuestion.question,
    proceed_to_planning: proceedToPlanning,
    decision_reason: confidenceResult.decision_reason,
    ambiguity_score: confidenceResult.ambiguity_score,
    completeness_score: confidenceResult.completeness_score,
    confidence_result: confidenceResult,
  };
}