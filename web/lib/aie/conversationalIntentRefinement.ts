import type { OperatorRequest, PlanRiskLevel } from "./operatorLightPlanner";

export type UserLevelEstimate = "plain-language" | "mixed" | "technical" | "uncertain";

export type AmbiguityFlag =
  | "too-vague"
  | "missing-target-area"
  | "missing-behavior-detail"
  | "missing-technical-anchor"
  | "risky-autonomy"
  | "broad-scope"
  | "low-vocabulary-uncertainty"
  | "playtest-sensitive";

export type RefinementNextAction = "create-plan" | "ask-follow-up" | "simplify" | "block";

export type ConversationalRefinementRequest = {
  rawRequest: string;
  projectName?: string;
  repoName?: string;
  repoRoot?: string;
  branchName?: string;
  operatorContext?: string[];
  knownConstraints?: string[];
};

export type ConversationalRefinementResult = {
  original_request: string;
  interpreted_intent: string;
  user_level_estimate: UserLevelEstimate;
  clarity_score: number;
  confidence_score: number;
  ambiguity_flags: AmbiguityFlag[];
  missing_information: string[];
  follow_up_questions: string[];
  simplified_rest_above_user_request: string;
  planner_ready_request: string | null;
  should_ask_follow_up: boolean;
  should_create_plan: boolean;
  risk_level: PlanRiskLevel;
  next_action: RefinementNextAction;
};

type RefinementSignals = {
  normalizedRequest: string;
  lowerRequest: string;
  mentionsEnemy: boolean;
  mentionsGrenade: boolean;
  mentionsGameplay: boolean;
  mentionsVisuals: boolean;
  mentionsControls: boolean;
  mentionsWeapons: boolean;
  mentionsLevelDesign: boolean;
  mentionsMovement: boolean;
  mentionsBoring: boolean;
  mentionsOvernight: boolean;
  mentionsAutomatic: boolean;
  mentionsEverything: boolean;
  mentionsUncertainty: boolean;
  mentionsTests: boolean;
  mentionsDocs: boolean;
  containsSimpleImprovementLanguage: boolean;
  containsTechnicalLanguage: boolean;
  requestWordCount: number;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function capQuestions(questions: string[], maxQuestions = 3): string[] {
  return unique(questions.filter(Boolean)).slice(0, maxQuestions);
}

function inferSignals(request: ConversationalRefinementRequest): RefinementSignals {
  const normalizedRequest = normalizeText(request.rawRequest);
  const lowerRequest = normalizedRequest.toLowerCase();

  return {
    normalizedRequest,
    lowerRequest,
    mentionsEnemy: hasAnyKeyword(lowerRequest, ["enemy", "enemies", "ai", "npc"]),
    mentionsGrenade: hasAnyKeyword(lowerRequest, ["grenade", "explosion", "blast", "explosive"]),
    mentionsGameplay: hasAnyKeyword(lowerRequest, ["game", "gameplay", "enemy", "weapon", "movement", "jump", "checkpoint", "level", "combat"]),
    mentionsVisuals: hasAnyKeyword(lowerRequest, ["visual", "visuals", "graphics", "art", "look"]),
    mentionsControls: hasAnyKeyword(lowerRequest, ["control", "controls", "input", "kbm", "controller"]),
    mentionsWeapons: hasAnyKeyword(lowerRequest, ["weapon", "weapons", "grenade", "gun", "combat"]),
    mentionsLevelDesign: hasAnyKeyword(lowerRequest, ["level", "layout", "pacing", "checkpoint", "design"]),
    mentionsMovement: hasAnyKeyword(lowerRequest, ["movement", "move", "jump", "feel", "traversal"]),
    mentionsBoring: hasAnyKeyword(lowerRequest, ["boring", "less boring", "more fun", "engaging", "better"]),
    mentionsOvernight: hasAnyKeyword(lowerRequest, ["overnight"]),
    mentionsAutomatic: hasAnyKeyword(lowerRequest, ["automatic", "automatically", "autonomous", "auto", "by itself"]),
    mentionsEverything: hasAnyKeyword(lowerRequest, ["everything", "all of it", "all", "whole game", "entire repo"]),
    mentionsUncertainty: hasAnyKeyword(lowerRequest, ["i dont know", "i don't know", "not sure", "how to say", "hard to explain", "dont know how to explain", "don't know how to explain"]),
    mentionsTests: hasAnyKeyword(lowerRequest, ["test", "tests", "unit test", "integration test", "playtest"]),
    mentionsDocs: hasAnyKeyword(lowerRequest, ["readme", "doc", "docs", "documentation"]),
    containsSimpleImprovementLanguage: hasAnyKeyword(lowerRequest, ["better", "smarter", "improve", "fix boring", "less boring", "good", "stuff"]),
    containsTechnicalLanguage: hasAnyKeyword(lowerRequest, ["parser", "queue", "unit test", "readme", "module", "api", "contract", "schema"]),
    requestWordCount: lowerRequest.split(" ").filter(Boolean).length,
  };
}

function estimateUserLevel(signals: RefinementSignals): UserLevelEstimate {
  if (signals.containsTechnicalLanguage && !signals.mentionsUncertainty) {
    return "technical";
  }

  if (signals.mentionsUncertainty && !signals.containsTechnicalLanguage) {
    return "plain-language";
  }

  if (signals.containsSimpleImprovementLanguage && !signals.containsTechnicalLanguage) {
    return "plain-language";
  }

  if (signals.containsTechnicalLanguage && signals.containsSimpleImprovementLanguage) {
    return "mixed";
  }

  return signals.requestWordCount <= 3 ? "uncertain" : "mixed";
}

function buildInterpretedIntent(signals: RefinementSignals): string {
  if (!signals.normalizedRequest) {
    return "No usable request was provided.";
  }

  if ((signals.mentionsAutomatic || signals.mentionsOvernight) && signals.mentionsEverything) {
    return "Request broad autonomous execution across an unsafe or unbounded scope.";
  }

  if (signals.mentionsEnemy && signals.mentionsGrenade) {
    return "Improve enemy AI reaction to grenade explosions.";
  }

  if (signals.mentionsEnemy) {
    return "Improve enemy behavior.";
  }

  if (signals.mentionsMovement && signals.mentionsLevelDesign) {
    return "Improve platformer movement feel and reduce frustration around checkpoint pacing.";
  }

  if (signals.mentionsMovement) {
    return "Improve movement feel or traversal responsiveness.";
  }

  if (signals.mentionsWeapons) {
    return "Improve combat or weapon behavior.";
  }

  if (signals.mentionsDocs && signals.mentionsTests) {
    return "Update documentation and test coverage for a specific technical surface.";
  }

  if (signals.mentionsBoring) {
    return "Improve player engagement or game feel.";
  }

  if (signals.containsTechnicalLanguage) {
    return "Implement a specific technical maintenance or tooling request.";
  }

  return `Clarify and refine the rough request: ${signals.normalizedRequest}.`;
}

function buildAmbiguityFlags(signals: RefinementSignals): AmbiguityFlag[] {
  const flags: AmbiguityFlag[] = [];

  if (!signals.normalizedRequest || signals.requestWordCount <= 2) {
    flags.push("too-vague");
  }

  if (signals.containsSimpleImprovementLanguage && !signals.mentionsEnemy && !signals.mentionsWeapons && !signals.mentionsControls && !signals.mentionsVisuals && !signals.mentionsLevelDesign && !signals.mentionsMovement && !signals.containsTechnicalLanguage) {
    flags.push("missing-target-area");
  }

  if (signals.mentionsEnemy && !signals.mentionsGrenade && signals.containsSimpleImprovementLanguage) {
    flags.push("missing-behavior-detail");
  }

  if (signals.mentionsGameplay && !signals.containsTechnicalLanguage && signals.requestWordCount <= 4) {
    flags.push("missing-technical-anchor");
  }

  if ((signals.mentionsAutomatic || signals.mentionsOvernight) && signals.mentionsEverything) {
    flags.push("risky-autonomy");
    flags.push("broad-scope");
  }

  if (signals.mentionsUncertainty || (signals.containsSimpleImprovementLanguage && signals.requestWordCount <= 7)) {
    flags.push("low-vocabulary-uncertainty");
  }

  if (signals.mentionsMovement || signals.mentionsGameplay) {
    flags.push("playtest-sensitive");
  }

  return unique(flags);
}

function buildMissingInformation(signals: RefinementSignals, ambiguityFlags: AmbiguityFlag[]): string[] {
  const missing: string[] = [];

  if (!signals.normalizedRequest) {
    missing.push("A user request was not provided.");
  }

  if (ambiguityFlags.includes("missing-target-area")) {
    missing.push("The first area to improve is not named.");
  }

  if (ambiguityFlags.includes("missing-behavior-detail")) {
    missing.push("The exact behavior change is not specified.");
  }

  if (ambiguityFlags.includes("missing-technical-anchor")) {
    missing.push("The target repo surface, scene, or system anchor is still too broad.");
  }

  if (ambiguityFlags.includes("risky-autonomy")) {
    missing.push("The first safe bounded task is not defined.");
    missing.push("Approval boundaries for overnight or autonomous execution are not specified.");
  }

  return unique(missing);
}

function buildFollowUpQuestions(signals: RefinementSignals, ambiguityFlags: AmbiguityFlag[]): string[] {
  const questions: string[] = [];

  if (ambiguityFlags.includes("risky-autonomy")) {
    questions.push("What is the first safe bounded task AI-E should run overnight?");
    return capQuestions(questions, 1);
  }

  if (signals.lowerRequest === "make the game better" || ambiguityFlags.includes("missing-target-area")) {
    questions.push("Which part should improve first: enemies, weapons, controls, visuals, or level design?");
    return capQuestions(questions, 1);
  }

  if (signals.mentionsEnemy && !signals.mentionsGrenade && ambiguityFlags.includes("missing-behavior-detail")) {
    questions.push("What should enemies do better first: react faster, aim better, flank smarter, or respond to player actions more clearly?");
  }

  if (signals.mentionsBoring || signals.mentionsUncertainty) {
    questions.push("Should we start with combat feel, enemy behavior, movement, visuals, or level pacing?");
  }

  if (!signals.mentionsGameplay && !signals.containsTechnicalLanguage && signals.requestWordCount <= 4) {
    questions.push("What should AI-E change first?");
  }

  if (signals.containsTechnicalLanguage && signals.mentionsDocs && !signals.mentionsTests) {
    questions.push("Should AI-E update only the docs, or docs plus matching tests?");
  }

  return capQuestions(questions);
}

function determineRiskLevel(signals: RefinementSignals, ambiguityFlags: AmbiguityFlag[]): PlanRiskLevel {
  if (!signals.normalizedRequest) {
    return "blocked";
  }

  if (ambiguityFlags.includes("risky-autonomy") || ambiguityFlags.includes("broad-scope")) {
    return "high";
  }

  if (ambiguityFlags.includes("too-vague") && !signals.containsTechnicalLanguage) {
    return "medium";
  }

  if (signals.mentionsGameplay) {
    return ambiguityFlags.includes("missing-behavior-detail") ? "medium" : "low";
  }

  return ambiguityFlags.length > 0 ? "medium" : "low";
}

function determineClarityScore(signals: RefinementSignals, ambiguityFlags: AmbiguityFlag[]): number {
  let score = 82;

  if (!signals.normalizedRequest) {
    return 0;
  }

  score -= ambiguityFlags.length * 15;

  if (signals.requestWordCount <= 3) {
    score -= 20;
  }

  if (signals.containsTechnicalLanguage) {
    score += 10;
  }

  if (signals.mentionsEnemy && signals.mentionsGrenade) {
    score += 8;
  }

  return Math.max(0, Math.min(100, score));
}

function determineConfidenceScore(signals: RefinementSignals, ambiguityFlags: AmbiguityFlag[]): number {
  let score = 76;

  if (!signals.normalizedRequest) {
    return 0;
  }

  score -= ambiguityFlags.length * 10;

  if (signals.mentionsEnemy && signals.mentionsGrenade) {
    score += 12;
  }

  if (signals.containsTechnicalLanguage) {
    score += 10;
  }

  if (signals.mentionsUncertainty) {
    score -= 8;
  }

  return Math.max(0, Math.min(100, score));
}

function buildSimplifiedRestatement(signals: RefinementSignals, interpretedIntent: string, ambiguityFlags: AmbiguityFlag[]): string {
  if (!signals.normalizedRequest) {
    return "AI-E needs a short request before it can refine the intent.";
  }

  if (ambiguityFlags.includes("risky-autonomy")) {
    return "You want AI-E to help overnight, but the task is too broad to run safely without narrowing it first.";
  }

  if (signals.mentionsEnemy && signals.mentionsGrenade) {
    return "You want enemies to react smarter when grenade explosions happen.";
  }

  if (signals.mentionsBoring || signals.mentionsUncertainty) {
    return "You want the game to feel less boring, but AI-E still needs one clear area to improve first.";
  }

  if (ambiguityFlags.includes("missing-target-area")) {
    return "You want the game to improve, but the first system to work on is not named yet.";
  }

  return interpretedIntent;
}

function buildPlannerReadyRequest(signals: RefinementSignals, ambiguityFlags: AmbiguityFlag[]): string | null {
  if (!signals.normalizedRequest || ambiguityFlags.includes("risky-autonomy")) {
    return null;
  }

  if (signals.mentionsEnemy && signals.mentionsGrenade) {
    return "Add enemy reaction behavior to grenade explosions in BABYLON.";
  }

  if (signals.mentionsMovement && signals.mentionsLevelDesign) {
    return "Tune movement feel and checkpoint spacing in the target platformer slice, then validate with required human playtesting.";
  }

  if (signals.containsTechnicalLanguage && signals.mentionsDocs && signals.mentionsTests) {
    return "Update the named documentation surface and add or adjust matching unit tests before validation.";
  }

  if (
    ambiguityFlags.includes("missing-target-area") ||
    ambiguityFlags.includes("missing-behavior-detail") ||
    ambiguityFlags.includes("too-vague") ||
    ambiguityFlags.includes("low-vocabulary-uncertainty")
  ) {
    return null;
  }

  return signals.normalizedRequest.charAt(0).toUpperCase() + signals.normalizedRequest.slice(1);
}

function determineNextAction(
  plannerReadyRequest: string | null,
  ambiguityFlags: AmbiguityFlag[],
  signals: RefinementSignals,
  followUpQuestions: string[],
  riskLevel: PlanRiskLevel,
): RefinementNextAction {
  if (riskLevel === "high" || riskLevel === "blocked") {
    return "block";
  }

  if (plannerReadyRequest) {
    return "create-plan";
  }

  if (followUpQuestions.length > 0 && signals.mentionsUncertainty) {
    return "simplify";
  }

  if (ambiguityFlags.length > 0 || followUpQuestions.length > 0) {
    return "ask-follow-up";
  }

  return "create-plan";
}

export function refineConversationalIntent(
  request: ConversationalRefinementRequest,
): ConversationalRefinementResult {
  const signals = inferSignals(request);
  const interpretedIntent = buildInterpretedIntent(signals);
  const userLevelEstimate = estimateUserLevel(signals);
  const ambiguityFlags = buildAmbiguityFlags(signals);
  const missingInformation = buildMissingInformation(signals, ambiguityFlags);
  const followUpQuestions = buildFollowUpQuestions(signals, ambiguityFlags);
  const plannerReadyRequest = buildPlannerReadyRequest(signals, ambiguityFlags);
  const riskLevel = determineRiskLevel(signals, ambiguityFlags);
  const nextAction = determineNextAction(
    plannerReadyRequest,
    ambiguityFlags,
    signals,
    followUpQuestions,
    riskLevel,
  );

  return {
    original_request: signals.normalizedRequest,
    interpreted_intent: interpretedIntent,
    user_level_estimate: userLevelEstimate,
    clarity_score: determineClarityScore(signals, ambiguityFlags),
    confidence_score: determineConfidenceScore(signals, ambiguityFlags),
    ambiguity_flags: ambiguityFlags,
    missing_information: missingInformation,
    follow_up_questions: followUpQuestions,
    simplified_rest_above_user_request: buildSimplifiedRestatement(signals, interpretedIntent, ambiguityFlags),
    planner_ready_request: plannerReadyRequest,
    should_ask_follow_up: followUpQuestions.length > 0,
    should_create_plan: Boolean(plannerReadyRequest) && riskLevel !== "high" && riskLevel !== "blocked",
    risk_level: riskLevel,
    next_action: nextAction,
  };
}

export function convertRefinementToPlannerRequest(
  refinement: ConversationalRefinementResult,
  sourceRequest: ConversationalRefinementRequest,
): OperatorRequest | null {
  if (!refinement.should_create_plan || !refinement.planner_ready_request) {
    return null;
  }

  return {
    rawRequest: refinement.planner_ready_request,
    projectName: sourceRequest.projectName,
    repoName: sourceRequest.repoName,
    repoRoot: sourceRequest.repoRoot,
    branchName: sourceRequest.branchName,
    operatorContext: unique([
      ...(sourceRequest.operatorContext ?? []),
      `Original user request: ${refinement.original_request}`,
      `Simplified request: ${refinement.simplified_rest_above_user_request}`,
    ]),
    knownConstraints: unique([
      ...(sourceRequest.knownConstraints ?? []),
      ...refinement.missing_information,
    ]),
  };
}