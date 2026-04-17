"use client";

import { useMemo, useState } from "react";

import type { FollowUpVerificationState, StoredLoopTerminationStatus } from "@/components/AnalysisForm";
import type { AnalysisInput, FreeAnalysisResponse } from "@/lib/aie/types";

type AnalysisResultProps = {
  result: FreeAnalysisResponse;
  input?: AnalysisInput;
  isRefined?: boolean;
  lastObservation?: string;
  verificationState?: FollowUpVerificationState;
  onResultChange?: (update: {
    result: FreeAnalysisResponse;
    observation: string;
    verificationState: FollowUpVerificationState;
    attemptedStep?: string;
    loopTerminationStatus: StoredLoopTerminationStatus | null;
  }) => void;
};

type LoopTerminationStatus = StoredLoopTerminationStatus;
type ConfidenceLevel = "high" | "medium" | "low";
type EscalationStrategy = "minimal-repro" | "logging" | "single-system-rebuild" | "clean-environment";
type SuggestedNextAction = "continue-thread" | "restart-fresh" | "stop" | "escalate";
type DebuggingMode =
  | "isolate-one-subsystem"
  | "instrument-with-logging"
  | "check-initialization-order"
  | "reproduce-in-clean-scene"
  | "check-duplicate-writers"
  | "validate-ownership-references";
type IntentAnchor = "isolate-root-cause" | "confirm-system-boundary" | "narrow-conflicting-systems" | "verify-state-transitions";

const EVIDENCE_GAP_PATTERN =
  /absence of error messages|lack of error messages|without an error message|no obvious console errors|no error messages|not a runtime exception/i;
const GENERIC_DIAGNOSIS_PATTERN =
  /component or object|critical object or component|missing or incorrect reference|missing reference|misconfiguration|disconnection|state management|physics settings|collision detection logic/i;
const CONCRETE_ANCHOR_PATTERN =
  /\b(?:Rigidbody2D|NavMeshAgent|Cinemachine|Animator|CanvasGroup|SceneManager|NullReferenceException|MissingReferenceException|Transform|Button|Slider|Image|Update|Start|Awake|FixedUpdate|MovePosition|AddForce|onClick|FadeOut)\b|[A-Za-z_]+\.[A-Za-z_]+/;
const CONFIRMATION_SIGNAL_PATTERN =
  /works? again|behaves? normally|returned to normal|fixed|resolved|disappear(?:ed|s)?|went away|stops? (?:happening|flickering|crashing)|regains? control|starts? working|lets? .*run normally|makes? .*disappear|removes? .*completely/i;
const FALSIFICATION_SIGNAL_PATTERN =
  /nothing changed|changes nothing|no change|same issue|same behavior|still broken the same|did not help|did nothing|doesn't help|no effect|unchanged|still happens exactly the same/i;
const PARTIAL_SIGNAL_PATTERN =
  /\bbut\b|partially|reduced|less severe|less often|smaller|improved?.*\bstill\b|fixed.*\bbut\b|stops?.*\bbut\b/i;
const STRONG_RESOLVED_SIGNAL_PATTERN =
  /works? normally|moves? normally|responds? to input again|fixed it|resolved|gone now|issue disappeared|now works?|back to normal|behaves? normally|working again/i;
const STRONG_STUCK_SIGNAL_PATTERN =
  /nothing clearly fixed (?:the )?issue|no obvious change|still happen(?:s)? inconsistently|still occurs? inconsistently|still all over the place|can(?:not|'t) tell (?:what'?s )?related to what|tried (?:a few|several|different) (?:things|systems).*nothing (?:really )?changed/i;
const DEAD_END_STUCK_SIGNAL_PATTERN =
  /nothing clearly fixed (?:the )?issue|no obvious change|still happen(?:s)? inconsistently|still occurs? inconsistently|tried (?:a few|several|different) (?:things|systems).*nothing (?:really )?changed/i;
const LOW_SIGNAL_RESET_PATTERN =
  /still all over the place|can(?:not|'t) tell (?:what'?s )?related to what|everything seems broken|not sure where to start/i;
const ACTIONABLE_CONFIRMATION_STEP_PATTERN =
  /\b(?:disable|turn off|remove|bypass|force|toggle|clear|delay|comment out|skip|pause)\b/i;
const WEAK_CONFIRMATION_STEP_PATTERN =
  /^(?:temporarily\s+)?(?:add a debug log|log\b|inspect\b|check\b|verify\b|look at\b)/i;
const GENERIC_FOCUS_PATTERN =
  /\b(?:issue|problem|symptom|behavior|weirdness|feels wrong|same slowdown|snap back|run normally|changes made|current suspected system)\b/i;
const OUTCOME_FOCUS_PATTERN =
  /\b(?:moves? normally|move normally|responds?(?: normally)?|works? again|working again|behaves? normally|run normally|running normally|fixed|resolved|disappear(?:ed|s)?|went away|back to normal|better now|worse now|same behavior|no obvious change)\b/i;
const PROCESS_FOCUS_PATTERN =
  /\b(?:different systems one by one|one by one|before and after|first thing|next thing|first check|next check|second check|third check|first suggestion|next suggestion|second suggestion|third suggestion|first test|next test|second test|third test|first attempt|next attempt|second attempt|third attempt|next step(?: too)?|current step|same weird behavior|same issue|same problem|different system|suspected system)\b/i;
const CONVERSATIONAL_FRAGMENT_PATTERN =
  /\b(?:can(?:not|'t) tell what|can(?:not|'t) tell what'?s|kind of|sort of|place and i can(?:not|'t)|what'?s wrong|i am not sure|i'm not sure)\b/i;
const COMPONENT_LIKE_FOCUS_PATTERN =
  /\b(?:animator|animation|speed sync|sync|limiter|stamina|controller|state machine|pathfinding|pool|reference|target reference|overlay|bootstrap|singleton|timeline|handoff|priority|camera|recenter|rigidbody|velocity|wall-jump|jump script|audio|button|canvas|input|friction|slope|dash|ground|menu|scene|ui flow|event|transition|prefab|component|manager|handler|script|system)\b/i;
const MESSY_MULTI_SYSTEM_INPUT_PATTERN =
  /\b(?:changed a bunch|changed a lot|touched\b|multiple systems?|various systems?|everything feels broken|not sure where to start|not sure|mixed together|all at once|one pass|a bunch of)\b/i;
const MAX_GUIDED_STEPS = 3;

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "because",
  "before",
  "being",
  "between",
  "caused",
  "cause",
  "character",
  "clearly",
  "during",
  "feature",
  "issue",
  "likely",
  "player",
  "script",
  "scene",
  "still",
  "system",
  "their",
  "there",
  "these",
  "this",
  "trying",
  "when",
  "with",
]);

function shouldShowLowEvidenceCue(result: FreeAnalysisResponse): boolean {
  const supportingText = [result.what_happened, ...result.what_matters].join(" ");
  const hasEvidenceGapSignal = EVIDENCE_GAP_PATTERN.test(supportingText);
  const hasGenericDiagnosisSignal = GENERIC_DIAGNOSIS_PATTERN.test(supportingText);
  const hasConcreteAnchor = CONCRETE_ANCHOR_PATTERN.test(supportingText);
  const hedgedDiagnosis = /\b(?:most likely|likely|probably)\b/i.test(result.what_happened);

  return hasEvidenceGapSignal || hasGenericDiagnosisSignal || (hedgedDiagnosis && !hasConcreteAnchor);
}

function summarizeStepForPrompt(step: string | undefined): string | null {
  if (!step) {
    return null;
  }

  const summarized = trimTrailingPunctuation(step).split(/\s+/).slice(0, 18).join(" ");
  return summarized || null;
}

function buildFollowUpProblemDescription(problemDescription: string, observation: string, attemptedStep?: string, stepNumber?: number): string {
  const trimmedDescription = problemDescription.trim();
  const trimmedObservation = observation.trim();
  if (!trimmedObservation) {
    return trimmedDescription;
  }

  const separator = /[.!?]$/.test(trimmedDescription) ? " " : ". ";
  const stepSummary = summarizeStepForPrompt(attemptedStep);
  const stepLabel = stepNumber ? `step ${stepNumber}` : "the current step";
  const stepContext = stepSummary ? `After trying ${stepLabel} (${stepSummary}): ${trimmedObservation}` : `After trying ${stepLabel}: ${trimmedObservation}`;

  return `${trimmedDescription}${separator}${stepContext}`;
}

function extractComparableTerms(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9][a-z0-9-]+/g) ?? []).filter(
      (token) => token.length >= 4 && !STOP_WORDS.has(token),
    ),
  );
}

function calculateSimilarity(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) {
    return 0;
  }

  let sharedTerms = 0;
  for (const term of left) {
    if (right.has(term)) {
      sharedTerms += 1;
    }
  }

  return sharedTerms / new Set([...left, ...right]).size;
}

function countSharedTerms(left: Set<string>, right: Set<string>): number {
  let sharedTerms = 0;

  for (const term of left) {
    if (right.has(term)) {
      sharedTerms += 1;
    }
  }

  return sharedTerms;
}

function trimLeadingArticle(text: string): string {
  return text.replace(/^(?:the|a|an)\s+/i, "").trim();
}

function trimTrailingPunctuation(text: string): string {
  return text.replace(/[.?!,;:]+$/g, "").trim();
}

function capitalizeSentence(text: string): string {
  if (!text) {
    return text;
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowerFirstCharacter(text: string): string {
  if (!text) {
    return text;
  }

  return text.charAt(0).toLowerCase() + text.slice(1);
}

function normalizeEvidenceClause(text: string): string {
  return trimTrailingPunctuation(text).replace(/[.?!]+\s*/g, ", ").replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
}

function normalizeFocusKey(text: string | null): string | null {
  if (!text) {
    return null;
  }

  return trimLeadingArticle(text.toLowerCase()).replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim() || null;
}

function hasDistinctAlternateLever(originalFocus: string | null, alternativeFocus: string | null): boolean {
  const originalKey = normalizeFocusKey(originalFocus);
  const alternativeKey = normalizeFocusKey(alternativeFocus);
  if (!originalKey || !alternativeKey) {
    return false;
  }

  return originalKey !== alternativeKey && !originalKey.includes(alternativeKey) && !alternativeKey.includes(originalKey);
}

function isSameNormalizedFocus(left: string | null, right: string | null): boolean {
  const leftKey = normalizeFocusKey(left);
  const rightKey = normalizeFocusKey(right);

  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function getFocusDomain(text: string | null): string | null {
  if (!text) {
    return null;
  }

  const normalized = normalizeFocusKey(text) ?? "";
  if (!normalized) {
    return null;
  }

  if (/\b(?:audio|music|sound|singleton)\b/.test(normalized)) {
    return "audio";
  }

  if (/\b(?:button|click|ui|menu|overlay|canvas)\b/.test(normalized)) {
    return "ui";
  }

  if (/\b(?:scene|transition|bootstrap|handoff|load(?:ing)?)\b/.test(normalized)) {
    return "scene";
  }

  if (/\b(?:slope|slopes|friction|ground|landing)\b/.test(normalized)) {
    return "surface-motion";
  }

  if (/\b(?:dash|run|speed|stamina|blend|animat(?:or|ion))\b/.test(normalized)) {
    return "movement";
  }

  if (/\b(?:enemy|ai|pathfinding|state machine|pooling|animation events|freezing|spinning)\b/.test(normalized)) {
    return "enemy-ai";
  }

  return null;
}

function cleanFocusPhrase(text: string): string | null {
  const cleaned = trimLeadingArticle(trimTrailingPunctuation(text))
    .replace(/^(?:or\s+)?(?:disable|turn off|remove|bypass|force|clear|delay|skip|pause|comment out)\s+(?:the\s+)?/i, "")
    .replace(/^(?:most likely cause of|likely cause of|cause of|changes made to)\s+/i, "")
    .replace(/\s+and\s+one\s+related\s+variable\b.*$/i, "")
    .replace(/\s+(?:lets?|makes?|removes?|fixes?|resolves?|stops?|worked|solved)\b.*$/i, "")
    .replace(/\s+/g, " ");
  if (!cleaned) {
    return null;
  }

  return cleaned.split(" ").slice(0, 6).join(" ");
}

function isPronounHeavyFocusPhrase(text: string | null): boolean {
  if (!text) {
    return true;
  }

  const tokens = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (!tokens.length) {
    return true;
  }

  const pronounCount = tokens.filter((token) => /^(?:i|me|my|mine|you|your|yours|we|our|ours|they|their|theirs|it|its|this|that|these|those|what|which)$/.test(token)).length;
  return pronounCount >= 2 || pronounCount >= Math.ceil(tokens.length / 3);
}

function isClauseHeavyFocusPhrase(text: string | null): boolean {
  if (!text) {
    return true;
  }

  const clauseCount = (text.match(/\b(?:and|but|because|which|that|while|when|where|what)\b/gi) ?? []).length;
  return clauseCount >= 2 || (clauseCount >= 1 && text.split(/\s+/).length > 5);
}

function isBlockedFocusPhrase(text: string | null, source: "general" | "observation"): boolean {
  if (!text) {
    return true;
  }

  if (/\bnext likely system\b/i.test(text)) {
    return true;
  }

  if (OUTCOME_FOCUS_PATTERN.test(text) || PROCESS_FOCUS_PATTERN.test(text) || CONVERSATIONAL_FRAGMENT_PATTERN.test(text)) {
    return true;
  }

  if (isPronounHeavyFocusPhrase(text) || isClauseHeavyFocusPhrase(text)) {
    return true;
  }

  if (source === "observation") {
    return !CONCRETE_ANCHOR_PATTERN.test(text) && !COMPONENT_LIKE_FOCUS_PATTERN.test(text);
  }

  return false;
}

function isMetaStepReference(text: string | null): boolean {
  if (!text) {
    return true;
  }

  return /\b(?:first|second|third|next|current|previous)\s+(?:thing|check|step|suggestion|test|attempt)\b|\b(?:step|check|suggestion|test|attempt)\s+(?:one|two|three)\b/i.test(text);
}

function getSanitizedFocusPhrase(text: string | null, source: "general" | "observation" = "general"): string | null {
  if (!text || isMetaStepReference(text) || isWeakFocusPhrase(text) || isBlockedFocusPhrase(text, source)) {
    return null;
  }

  return text;
}

function isConcreteProgressionFocus(text: string | null): text is string {
  return Boolean(text && !isMetaStepReference(text) && !isWeakFocusPhrase(text) && !isBlockedFocusPhrase(text, "general"));
}

function isDisplayableGuidedStep(step: string | null | undefined): step is string {
  if (!step?.trim()) {
    return false;
  }

  const focus = extractFocusPhrase(step);
  return isConcreteProgressionFocus(focus) && extractStepMethod(step) !== "unknown";
}

function isWeakFocusPhrase(text: string | null): boolean {
  const focus = normalizeFocusKey(text);
  if (!focus) {
    return true;
  }

  return GENERIC_FOCUS_PATTERN.test(focus) || focus.split(" ").filter((token) => token.length >= 4).length < 2;
}

function extractFocusPhrase(text: string): string | null {
  const actionableMatch = text.match(
    /\b(?:temporarily\s+)?(?:disable|disabling|turn off|turning off|remove|removing|bypass|bypassing|force|forcing|clear|clearing|delay|delaying|skip|skipping|pause|pausing|comment out|commenting out)(?:\s+or\s+(?:disable|turn off|remove|bypass|force|clear|delay|skip|pause|comment out))?\s+(?:the\s+)?([^.,;]+?)(?:\s+(?:once|immediately|to|and compare|lets?|makes?|causes?|restores?|returns?|removes?|fixes?|resolves?|stops?|supports?)\b|[.,;]|$)/i,
  );
  if (actionableMatch) {
    const focus = getSanitizedFocusPhrase(cleanFocusPhrase(actionableMatch[1]));
    if (focus) {
      return focus;
    }
  }

  const nounPhraseMatches = text.matchAll(/\b(?:the|a|an)\s+([^.,;]+?)(?:\s+(?:is|are|was|were|to|before|after|during|when|that|which)\b|[.,;]|$)/gi);
  for (const match of nounPhraseMatches) {
    const focus = getSanitizedFocusPhrase(cleanFocusPhrase(match[1]));
    if (focus) {
      return focus;
    }
  }

  return null;
}

function extractObservationFocus(text: string): string | null {
  const anchorFocus = extractObservationAnchor(text);
  if (anchorFocus) {
    return anchorFocus;
  }

  const actionableMatch = text.match(
    /\b(?:temporarily\s+)?(?:disable|disabling|turn off|turning off|remove|removing|bypass|bypassing|force|forcing|clear|clearing|delay|delaying|skip|skipping|pause|pausing|comment out|commenting out)(?:\s+or\s+(?:disable|turn off|remove|bypass|force|clear|delay|skip|pause|comment out))?\s+(?:the\s+)?([^.,;]+?)(?:\s+(?:once|immediately|to|and compare|lets?|makes?|causes?|restores?|returns?|removes?|fixes?|resolves?|stops?|supports?)\b|[.,;]|$)/i,
  );
  if (actionableMatch) {
    const focus = getSanitizedFocusPhrase(cleanFocusPhrase(actionableMatch[1]), "observation");
    if (focus) {
      return focus;
    }
  }

  const nounPhraseMatches = text.matchAll(/\b(?:the|a|an)\s+([^.,;]+?)(?:\s+(?:is|are|was|were|to|before|after|during|when|that|which)\b|[.,;]|$)/gi);
  for (const match of nounPhraseMatches) {
    const focus = getSanitizedFocusPhrase(cleanFocusPhrase(match[1]), "observation");
    if (focus) {
      return focus;
    }
  }

  return null;
}

function extractObservationAnchor(text: string): string | null {
  const anchorPatterns = [
    /\b(?:still happens on|still appears on|shows up on)\s+([^.,;]+?)(?:[.,;]|$)/i,
    /\b(?:still happens|still occurs|still shows up|still breaks|still drops|still slows down|still sticks)(?:\s+(?:mostly|mainly|especially))?\s+(?:on|during|after|around)\s+([^.,;]+?)(?:[.,;]|$)/i,
    /\b(?:when|during|while|between|around)\s+([^.,;]+?)(?:[.,;]|$)/i,
    /\b(?:overlap|overlaps|overlapping)\s+([^.,;]+?)(?:[.,;]|$)/i,
    /\b(audio duplication|music still doubles|button issue|scene transitions?|transition blend|freezing and spinning|shallow slopes(?: after a dash)?)\b/i,
  ];

  for (const pattern of anchorPatterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const focus = getSanitizedFocusPhrase(cleanFocusPhrase(match[1].replace(/^(?:some|the)\s+/i, "")), "observation");
    if (focus) {
      return focus;
    }
  }

  return null;
}

function hasStrongResolvedRecovery(observation: string, latestStep: string | undefined): boolean {
  const trimmedObservation = observation.trim();
  if (!trimmedObservation || !STRONG_RESOLVED_SIGNAL_PATTERN.test(trimmedObservation)) {
    return false;
  }

  const latestStepTerms = extractComparableTerms(latestStep ?? "");
  const observationTerms = extractComparableTerms(trimmedObservation);
  const sharedTerms = countSharedTerms(latestStepTerms, observationTerms);

  return sharedTerms >= 1 || ACTIONABLE_CONFIRMATION_STEP_PATTERN.test(trimmedObservation);
}

function hasStrongStuckObservation(observation: string): boolean {
  return STRONG_STUCK_SIGNAL_PATTERN.test(observation.trim());
}

function shouldEscalateFromObservation(observation: string | undefined): boolean {
  return Boolean(observation?.trim() && DEAD_END_STUCK_SIGNAL_PATTERN.test(observation));
}

function shouldRestartFreshFromObservation(observation: string | undefined): boolean {
  return Boolean(observation?.trim() && LOW_SIGNAL_RESET_PATTERN.test(observation));
}

function extractRecentChangeCandidates(problemDescription: string | undefined): string[] {
  if (!problemDescription) {
    return [];
  }

  const candidatePatterns: Array<{ label: string; pattern: RegExp }> = [
    { label: "animation system", pattern: /\banimation\b/i },
    { label: "slope handling", pattern: /\bslopes?\b/i },
    { label: "dash handling", pattern: /\bdash\b/i },
    { label: "friction settings", pattern: /\bfriction\b/i },
    { label: "camera setup", pattern: /\bcamera\b/i },
    { label: "ground detection", pattern: /\bground\b/i },
    { label: "UI system", pattern: /\bui\b/i },
    { label: "UI flow", pattern: /\bui flow\b/i },
    { label: "audio system", pattern: /\baudio\b/i },
    { label: "audio singleton", pattern: /\baudio singleton\b/i },
    { label: "loading overlay", pattern: /\bloading overlay\b/i },
    { label: "scene bootstrap", pattern: /\bscene bootstrap\b/i },
    { label: "scene loading", pattern: /\bscene load(?:ing)?\b|\bscene swap\b/i },
    { label: "timeline handoff", pattern: /\btimeline handoff\b/i },
    { label: "camera recenter", pattern: /\brecenter\b/i },
    { label: "stamina limiter", pattern: /\bstamina\b/i },
    { label: "animator speed sync", pattern: /\banimator\b|\banimation\b/i },
    { label: "movement script", pattern: /\bmovement script\b|\bmovement\b/i },
    { label: "pathfinding", pattern: /\bpathfinding\b/i },
    { label: "state machine", pattern: /\bstate machine\b/i },
    { label: "animation events", pattern: /\banimation events\b/i },
    { label: "pooling", pattern: /\bpooling\b|\bpool\b/i },
    { label: "button input", pattern: /\bbutton\b|\bclick\b/i },
  ];

  return candidatePatterns
    .map((candidate) => {
      const match = problemDescription.match(candidate.pattern);
      return match ? { label: candidate.label, index: match.index ?? Number.MAX_SAFE_INTEGER } : null;
    })
    .filter((candidate): candidate is { label: string; index: number } => Boolean(candidate))
    .sort((left, right) => left.index - right.index)
    .map((candidate) => candidate.label)
    .filter((label, index, values) => values.indexOf(label) === index);
}

function shouldUseMessyInputFirstStep(problemDescription: string | undefined): boolean {
  if (!problemDescription) {
    return false;
  }

  const recentChangeCandidates = extractRecentChangeCandidates(problemDescription);
  return MESSY_MULTI_SYSTEM_INPUT_PATTERN.test(problemDescription) || hasBroadSystemMixSignal(problemDescription) || recentChangeCandidates.length >= 3;
}

function refineFirstStepPrecision(params: {
  step: string | undefined;
  diagnosis: string;
  problemDescription: string | undefined;
}): string | undefined {
  const strengthenedStep = strengthenConfirmationStep(params.step, params.diagnosis);
  if (!strengthenedStep) {
    return strengthenedStep;
  }

  if (!shouldUseMessyInputFirstStep(params.problemDescription)) {
    return strengthenedStep;
  }

  const recentChangeCandidates = extractRecentChangeCandidates(params.problemDescription);
  const primarySystem = recentChangeCandidates[0];
  const secondarySystem = recentChangeCandidates[1];

  if (primarySystem) {
    const startingPoint = secondarySystem
      ? `Start by isolating one recently changed system at a time, beginning with ${primarySystem} before moving to ${secondarySystem}.`
      : `Start by isolating one recently changed system at a time, beginning with ${primarySystem}.`;

    return `${startingPoint} Temporarily disable or bypass only the ${trimLeadingArticle(primarySystem)}-related change and compare the behavior before and after. If the symptom shifts, keep narrowing inside ${trimLeadingArticle(primarySystem)} before touching the other changed systems.`;
  }

  return "Start by isolating one recently changed system at a time and test it independently before combining signals. Compare one system before and after each change instead of checking multiple systems together.";
}

function strengthenConfirmationStep(step: string | undefined, diagnosis: string): string | undefined {
  if (!step) {
    return step;
  }

  if (ACTIONABLE_CONFIRMATION_STEP_PATTERN.test(step) || !WEAK_CONFIRMATION_STEP_PATTERN.test(step)) {
    return step;
  }

  const focus = extractFocusPhrase(step) ?? extractFocusPhrase(diagnosis) ?? "suspected system";
  return `Temporarily disable or bypass the ${focus} once and compare the behavior before and after. If the issue changes immediately, that supports this diagnosis. If nothing changes, it points elsewhere.`;
}

function buildFalsifiedDiagnosis(params: {
  originalResult: FreeAnalysisResponse;
  nextResult: FreeAnalysisResponse;
  observation: string;
}): string {
  const attemptedStep = params.originalResult.what_to_do_next[0] ?? "";
  const noEffectClause = params.observation.split(/\bbut\b/i)[0]?.trim() ?? "";
  const alternativeClause = params.observation.split(/\bbut\b/i)[1]?.trim() ?? params.observation.trim();
  const originalFocus =
    extractFocusPhrase(attemptedStep) ?? extractFocusPhrase(params.originalResult.what_happened) ?? "the original suspected system";
  const alternativeFocus =
    extractObservationFocus(alternativeClause) ?? extractFocusPhrase(params.nextResult.what_happened) ?? "a different system";
  const noEffectSummary = noEffectClause
    ? lowerFirstCharacter(normalizeEvidenceClause(noEffectClause)).replace(/,\s+([A-Z])/g, (_, character: string) => `, ${character.toLowerCase()}`)
    : `changing ${trimLeadingArticle(originalFocus)} had no effect`;
  const alternativeEvidence = capitalizeSentence(normalizeEvidenceClause(alternativeClause));

  return `Since ${noEffectSummary}, the issue is more likely driven by ${trimLeadingArticle(alternativeFocus)} than ${trimLeadingArticle(originalFocus)}. ${alternativeEvidence}.`;
}

type StepMethod = "disable" | "isolate" | "replace" | "force" | "inspect" | "unknown";

function hasStateTransitionSignal(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }

  return /\b(?:state|transition|blend|handoff|sync|update|fixedupdate|awake|start|timing|order|velocity|phase|frame|animator|timeline)\b/i.test(text);
}

function extractStepMethod(text: string): StepMethod {
  if (/\b(?:isolate|narrow)\b/i.test(text)) {
    return "isolate";
  }

  if (/\b(?:replace|swap|substitute|stub|mock)\b/i.test(text)) {
    return "replace";
  }

  if (/\b(?:force|set)\b/i.test(text)) {
    return "force";
  }

  if (/\b(?:inspect|check|verify|look at|log)\b/i.test(text)) {
    return "inspect";
  }

  if (/\b(?:disable|turn off|remove|bypass|clear|delay|skip|pause|comment out)\b/i.test(text)) {
    return "disable";
  }

  return "unknown";
}

function extractFocusTerms(text: string | null): Set<string> {
  const focusKey = normalizeFocusKey(text);
  if (!focusKey) {
    return new Set();
  }

  return new Set(focusKey.split(" ").filter((token) => token.length >= 4 && !STOP_WORDS.has(token)));
}

function hasHighPhraseOverlap(left: string, right: string): boolean {
  return calculateSimilarity(extractComparableTerms(left), extractComparableTerms(right)) >= 0.55;
}

function isNarrowerScope(baseFocus: string | null, candidateFocus: string | null): boolean {
  const baseTerms = extractFocusTerms(baseFocus);
  const candidateTerms = extractFocusTerms(candidateFocus);
  if (!baseTerms.size || !candidateTerms.size || candidateTerms.size <= baseTerms.size) {
    return false;
  }

  const sharedTerms = [...baseTerms].filter((term) => candidateTerms.has(term)).length;
  return sharedTerms >= Math.min(2, baseTerms.size);
}

function buildActionableSecondStep(method: StepMethod, focus: string, verificationState: FollowUpVerificationState): string {
  const trimmedFocus = trimLeadingArticle(focus);

  if (method === "replace") {
    return `Temporarily replace the ${trimmedFocus} with a known-safe default or stub, then compare the behavior immediately before and after. If the symptom changes right away, that isolates the failing path without widening the test.`;
  }

  if (method === "force") {
    return `Temporarily force the ${trimmedFocus} to a known-safe value and compare the behavior immediately before and after. If the symptom changes right away, that isolates the branch that is actually driving the issue.`;
  }

  if (method === "isolate") {
    return `Temporarily isolate only the ${trimmedFocus} and one related variable, then compare whether the symptom changes immediately. If nothing changes, move to the next likely system instead of broadening the test.`;
  }

  if (verificationState === "falsified") {
    return `Temporarily disable or bypass the ${trimmedFocus} and compare the behavior immediately before and after. If the issue changes right away, that confirms the updated diagnosis.`;
  }

  return `Temporarily disable or bypass the ${trimmedFocus} once and compare the behavior immediately before and after. If the symptom changes right away, that gives you a stronger signal before widening the search.`;
}

function isMeaningfullyProgressed(params: {
  priorSteps: string[];
  candidateStep: string;
  candidateFocus: string | null;
}): boolean {
  const latestStep = params.priorSteps[0] ?? "";
  const latestFocus = extractFocusPhrase(latestStep);
  const latestMethod = extractStepMethod(latestStep);
  const candidateMethod = extractStepMethod(params.candidateStep);
  const differentLever = hasDistinctAlternateLever(latestFocus, params.candidateFocus);
  const narrowerScope = isNarrowerScope(latestFocus, params.candidateFocus);
  const differentMethod = latestMethod !== candidateMethod && candidateMethod !== "unknown";

  if (params.priorSteps.some((step) => hasHighPhraseOverlap(step, params.candidateStep))) {
    return false;
  }

  if (!(differentLever || narrowerScope || differentMethod)) {
    return false;
  }

  return params.priorSteps.every((step) => {
    const priorFocus = extractFocusPhrase(step);
    const priorMethod = extractStepMethod(step);

    return (
      hasDistinctAlternateLever(priorFocus, params.candidateFocus) ||
      isNarrowerScope(priorFocus, params.candidateFocus) ||
      (priorMethod !== candidateMethod && candidateMethod !== "unknown")
    );
  });
}

function scoreProgressionCandidate(params: {
  priorSteps: string[];
  candidateStep: string;
  candidateFocus: string | null;
}): number {
  const latestStep = params.priorSteps[0] ?? "";
  const latestFocus = extractFocusPhrase(latestStep);
  const latestMethod = extractStepMethod(latestStep);
  const candidateMethod = extractStepMethod(params.candidateStep);
  const differentLever = hasDistinctAlternateLever(latestFocus, params.candidateFocus);
  const narrowerScope = isNarrowerScope(latestFocus, params.candidateFocus);
  const differentMethod = latestMethod !== candidateMethod && candidateMethod !== "unknown";
  const sameFocus = isSameNormalizedFocus(latestFocus, params.candidateFocus);
  const latestDomain = getFocusDomain(latestFocus);
  const candidateDomain = getFocusDomain(params.candidateFocus);
  const sameDomain = Boolean(latestDomain && candidateDomain && latestDomain === candidateDomain);
  const latestFocusTerms = extractFocusTerms(latestFocus);
  const candidateFocusTerms = extractFocusTerms(params.candidateFocus);
  const sharedFocusTerms = countSharedTerms(latestFocusTerms, candidateFocusTerms);

  let score = 0;

  if (differentLever) {
    score += 4;
  }

  if (narrowerScope) {
    score += 3;
  }

  if (differentMethod) {
    score += 2;
  }

  if (candidateMethod !== "inspect") {
    score += 1;
  }

  if (!differentLever && sharedFocusTerms >= 2 && candidateFocusTerms.size > latestFocusTerms.size) {
    score += 1;
  }

  if (sameFocus && differentMethod) {
    score -= 2;
  }

  if (sameFocus && latestMethod === "inspect" && candidateMethod === "isolate") {
    score -= 2;
  }

  if (sameDomain && candidateMethod === latestMethod && !narrowerScope) {
    score -= 4;
  }

  if (sameDomain && !differentMethod && !narrowerScope) {
    score -= 2;
  }

  if (!differentLever && !narrowerScope && !differentMethod) {
    score -= 4;
  }

  return score;
}

function deriveIntentAnchor(params: {
  priorSteps: string[];
  verificationState: FollowUpVerificationState;
  currentResult: FreeAnalysisResponse;
  observation: string;
}): IntentAnchor {
  const earliestStep = params.priorSteps[params.priorSteps.length - 1] ?? "";
  const latestStep = params.priorSteps[0] ?? "";
  const earliestFocus = extractFocusPhrase(earliestStep);
  const latestFocus = extractFocusPhrase(latestStep);
  const combinedContext = [earliestStep, latestStep, params.currentResult.what_happened, params.observation].filter(Boolean).join(" ");

  if (hasStateTransitionSignal(combinedContext) && /\b(?:state machine|timeline|transition|velocity|animator|sync|handoff|blend)\b/i.test(combinedContext)) {
    return "verify-state-transitions";
  }

  if (params.verificationState === "falsified" || hasBroadSystemMixSignal(combinedContext)) {
    return "narrow-conflicting-systems";
  }

  if (/\b(?:conflict|overlap|between|boundary|both|twice|ownership|handoff|order)\b/i.test(combinedContext)) {
    return "confirm-system-boundary";
  }

  if (params.priorSteps.length >= 2 && hasDistinctAlternateLever(earliestFocus, latestFocus)) {
    return "confirm-system-boundary";
  }

  return "isolate-root-cause";
}

function getIntentMethodCandidates(params: {
  intentAnchor: IntentAnchor;
  verificationState: FollowUpVerificationState;
  latestMethod: StepMethod;
}): StepMethod[] {
  const methodsByIntent: Record<IntentAnchor, StepMethod[]> = {
    "isolate-root-cause": ["isolate", "replace", "force", "disable"],
    "confirm-system-boundary": ["disable", "isolate", "force", "replace"],
    "narrow-conflicting-systems": ["disable", "isolate", "replace", "force"],
    "verify-state-transitions": ["force", "replace", "isolate", "disable"],
  };

  const baseMethods = methodsByIntent[params.intentAnchor];
  const verificationBiasedMethods =
    params.verificationState === "falsified" && params.intentAnchor !== "verify-state-transitions"
      ? ["disable", ...baseMethods.filter((method) => method !== "disable")]
      : baseMethods;

  return [
    ...verificationBiasedMethods.filter((method) => method !== params.latestMethod),
    ...verificationBiasedMethods.filter((method) => method === params.latestMethod),
  ];
}

function scoreIntentAlignment(params: {
  intentAnchor: IntentAnchor;
  priorSteps: string[];
  candidateStep: string;
  candidateFocus: string | null;
  currentFocus: string | null;
  alternateFocus: string | null;
}): number {
  const latestStep = params.priorSteps[0] ?? "";
  const latestFocus = extractFocusPhrase(latestStep);
  const latestMethod = extractStepMethod(latestStep);
  const candidateMethod = extractStepMethod(params.candidateStep);
  const latestDomain = getFocusDomain(latestFocus);
  const currentDomain = getFocusDomain(params.currentFocus);
  const candidateDomain = getFocusDomain(params.candidateFocus);
  const sameLatestDomain = Boolean(latestDomain && candidateDomain && latestDomain === candidateDomain);
  const sameCurrentDomain = Boolean(currentDomain && candidateDomain && currentDomain === candidateDomain);
  const sharedWithLatest = countSharedTerms(extractFocusTerms(latestFocus), extractFocusTerms(params.candidateFocus));
  let score = 0;

  if (candidateMethod === latestMethod && isSameNormalizedFocus(latestFocus, params.candidateFocus)) {
    return -6;
  }

  if (candidateMethod === latestMethod && sameLatestDomain && sharedWithLatest >= 2) {
    score -= 4;
  }

  switch (params.intentAnchor) {
    case "isolate-root-cause":
      if (candidateMethod === "isolate") {
        score += 3;
      }
      if (isNarrowerScope(params.currentFocus, params.candidateFocus)) {
        score += 3;
      }
      if (sameCurrentDomain) {
        score += 1;
      }
      break;
    case "confirm-system-boundary":
      if (candidateMethod === "disable" || candidateMethod === "isolate") {
        score += 2;
      }
      if (hasDistinctAlternateLever(params.currentFocus, params.candidateFocus)) {
        score += 3;
      }
      if (sameLatestDomain || sameCurrentDomain) {
        score += 1;
      }
      break;
    case "narrow-conflicting-systems":
      if (candidateMethod === "disable") {
        score += 3;
      }
      if (hasDistinctAlternateLever(params.currentFocus, params.candidateFocus)) {
        score += 3;
      }
      if (params.alternateFocus && isSameNormalizedFocus(params.candidateFocus, params.alternateFocus)) {
        score += 2;
      }
      if (!sameLatestDomain && candidateDomain) {
        score += 1;
      }
      break;
    case "verify-state-transitions":
      if (candidateMethod === "force") {
        score += 3;
      }
      if (candidateMethod === "replace") {
        score += 2;
      }
      if (hasStateTransitionSignal(params.candidateFocus) || hasStateTransitionSignal(params.candidateStep)) {
        score += 3;
      }
      if (sameLatestDomain || sameCurrentDomain) {
        score += 1;
      }
      break;
  }

  return score;
}

function buildNextStepGuidance(params: {
  verificationState: FollowUpVerificationState | undefined;
  currentResult: FreeAnalysisResponse;
  observation: string | undefined;
  priorSteps: string[];
}): string | null {
  if (!params.verificationState || !params.observation?.trim() || params.verificationState === "confirmed") {
    return null;
  }

  if (params.priorSteps.length >= MAX_GUIDED_STEPS) {
    return null;
  }

  const currentStep = params.priorSteps[0] ?? "";
  const analyzerSuggestedStep = strengthenConfirmationStep(params.currentResult.what_to_do_next[0], params.currentResult.what_happened) ?? params.currentResult.what_to_do_next[0] ?? "";
  const alternativeClause = params.observation.split(/\bbut\b/i)[1]?.trim() ?? params.observation.trim();
  const diagnosisFocus = extractFocusPhrase(params.currentResult.what_happened);
  const observationFocus = extractObservationFocus(params.observation);
  const analyzerSuggestedFocus = extractFocusPhrase(analyzerSuggestedStep);
  const currentFocus =
    (extractFocusPhrase(currentStep) ??
      (WEAK_CONFIRMATION_STEP_PATTERN.test(currentStep) ? extractFocusPhrase(params.currentResult.what_happened) : null) ??
      extractFocusPhrase(params.currentResult.what_happened)) ??
    "current suspected system";
  const alternateFocus = extractObservationFocus(alternativeClause) ?? diagnosisFocus ?? currentFocus;
  const intentAnchor = deriveIntentAnchor({
    priorSteps: params.priorSteps,
    verificationState: params.verificationState,
    currentResult: params.currentResult,
    observation: params.observation,
  });
  const focusCandidates = [
    params.verificationState === "falsified" ? alternateFocus : observationFocus,
    analyzerSuggestedFocus,
    params.verificationState === "falsified" ? diagnosisFocus : alternateFocus,
    params.verificationState === "falsified" ? currentFocus : diagnosisFocus,
    params.verificationState === "falsified" ? observationFocus : currentFocus,
    currentFocus,
  ].filter((focus, index, values): focus is string => Boolean(focus?.trim()) && values.indexOf(focus) === index);
  const orderedFocusCandidates = focusCandidates.filter((focus) => isConcreteProgressionFocus(focus));

  if (!orderedFocusCandidates.length) {
    return null;
  }

  const latestMethod = extractStepMethod(currentStep);
  const methodCandidates = getIntentMethodCandidates({
    intentAnchor,
    verificationState: params.verificationState,
    latestMethod,
  });
  let bestCandidate: { step: string; score: number } | null = null;

  for (const focus of orderedFocusCandidates) {
    for (const method of methodCandidates) {
      const step = buildActionableSecondStep(method, focus, params.verificationState);
      if (params.priorSteps.includes(step)) {
        continue;
      }

      if (!isMeaningfullyProgressed({ priorSteps: params.priorSteps, candidateStep: step, candidateFocus: focus })) {
        continue;
      }

      const score =
        scoreProgressionCandidate({ priorSteps: params.priorSteps, candidateStep: step, candidateFocus: focus }) +
        scoreIntentAlignment({
          intentAnchor,
          priorSteps: params.priorSteps,
          candidateStep: step,
          candidateFocus: focus,
          currentFocus,
          alternateFocus,
        });
      if (score < 4) {
        continue;
      }

      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = { step, score };
      }
    }
  }

  return bestCandidate?.step ?? null;
}

function getGuidedStepStack(params: {
  result: FreeAnalysisResponse;
  isRefined: boolean;
  problemDescription?: string;
}): string[] {
  if (params.isRefined) {
    return params.result.what_to_do_next.filter(isDisplayableGuidedStep).slice(0, MAX_GUIDED_STEPS);
  }

  const firstStep = refineFirstStepPrecision({
    step: params.result.what_to_do_next[0],
    diagnosis: params.result.what_happened,
    problemDescription: params.problemDescription,
  });
  return isDisplayableGuidedStep(firstStep) ? [firstStep] : [];
}

function buildGuidedStepStack(nextStep: string | null, priorSteps: string[]): string[] {
  const sanitizedPriorSteps = priorSteps.filter(isDisplayableGuidedStep);

  if (!isDisplayableGuidedStep(nextStep)) {
    return sanitizedPriorSteps.slice(0, MAX_GUIDED_STEPS);
  }

  return [nextStep, ...sanitizedPriorSteps]
    .filter((step, index, values) => Boolean(step) && values.indexOf(step) === index)
    .slice(0, MAX_GUIDED_STEPS);
}

function hasGuidedProgression(stepStack: string[]): boolean {
  const chronologicalSteps = [...stepStack].reverse();
  if (chronologicalSteps.length < 2) {
    return false;
  }

  return chronologicalSteps.slice(1).every((step, index) => {
    const priorSteps = [...chronologicalSteps.slice(0, index + 1)].reverse();
    return isMeaningfullyProgressed({
      priorSteps,
      candidateStep: step,
      candidateFocus: extractFocusPhrase(step),
    });
  });
}

function countDistinctStepFocuses(stepStack: string[]): number {
  return new Set(stepStack.map((step) => normalizeFocusKey(extractFocusPhrase(step))).filter(Boolean)).size;
}

function hasSceneEnvironmentSignal(text: string | undefined): boolean {
  if (!text) {
    return false;
  }

  return /\bscene|environment|bootstrap|loading overlay|timeline|camera|menu|ui flow|singleton|prefab|project settings|handoff\b/i.test(text);
}

function hasBroadSystemMixSignal(text: string | undefined): boolean {
  if (!text) {
    return false;
  }

  return /\b(?:slopes|dash|friction|camera|ground|audio|ui|bootstrap|pooling|pathfinding|state machine|animation events|timeline)\b.*\b(?:slopes|dash|friction|camera|ground|audio|ui|bootstrap|pooling|pathfinding|state machine|animation events|timeline)\b/i.test(
    text,
  );
}

function isEscalationMeaningfullyDifferent(strategy: EscalationStrategy, priorSteps: string[]): boolean {
  const escalationTextByStrategy: Record<EscalationStrategy, string> = {
    "minimal-repro":
      "Isolate to minimal reproduction. Strip the failure down to the smallest reproducible setup that still breaks, then add surrounding pieces back one at a time only after the core symptom is stable.",
    logging:
      "Switch to logging/debug instrumentation. Pause the current swap-and-compare loop and add focused logs or debugger breakpoints around the state change that should happen.",
    "single-system-rebuild":
      "Disable all but one system and rebuild. Turn off every related system except one core path, confirm the base behavior, then re-enable the surrounding systems one by one until the failure returns.",
    "clean-environment":
      "Test in a clean scene or environment. Recreate the failing setup in a clean scene or isolated environment with fresh defaults to separate scene wiring from the local step you just tested.",
  };

  return priorSteps.every((step) => !hasHighPhraseOverlap(step, escalationTextByStrategy[strategy]));
}

function getSuggestedEscalationStrategy(params: {
  status: LoopTerminationStatus | null;
  guidedStepStack: string[];
  observation: string | undefined;
  problemDescription: string | undefined;
}): EscalationStrategy | null {
  if (params.status !== "stuck") {
    return null;
  }

  const combinedContext = [params.problemDescription, params.observation].filter(Boolean).join(" ");
  const distinctFocusCount = countDistinctStepFocuses(params.guidedStepStack);
  const activeInterventionCount = params.guidedStepStack.filter((step) => extractStepMethod(step) !== "inspect").length;
  const latestStep = params.guidedStepStack[0] ?? "";
  const latestSceneFocusedStep = hasSceneEnvironmentSignal(`${extractFocusPhrase(latestStep) ?? ""} ${latestStep}`);
  const candidateStrategies: EscalationStrategy[] = [];

  if (hasSceneEnvironmentSignal(combinedContext) && latestSceneFocusedStep) {
    candidateStrategies.push("logging");
  }

  if (hasSceneEnvironmentSignal(combinedContext)) {
    candidateStrategies.push("clean-environment");
  }

  if (distinctFocusCount >= 2 || hasBroadSystemMixSignal(params.problemDescription)) {
    candidateStrategies.push("single-system-rebuild");
  }

  if (activeInterventionCount >= Math.min(2, params.guidedStepStack.length)) {
    candidateStrategies.push("logging");
  }

  candidateStrategies.push("minimal-repro");

  const orderedCandidates = [
    ...candidateStrategies,
    ...(["minimal-repro", "logging", "single-system-rebuild", "clean-environment"] as EscalationStrategy[]),
  ].filter((strategy, index, values) => values.indexOf(strategy) === index);

  return orderedCandidates.find((strategy) => isEscalationMeaningfullyDifferent(strategy, params.guidedStepStack)) ?? orderedCandidates[0] ?? null;
}

function classifyLoopTerminationStatus(params: {
  isRefined: boolean;
  verificationState: FollowUpVerificationState | undefined;
  observation: string | undefined;
  guidedStepStack: string[];
  nextStepGuidance: string | null;
  reachedGuidedStepLimit: boolean;
}): LoopTerminationStatus | null {
  if (!params.isRefined || !params.verificationState || !params.observation?.trim()) {
    return null;
  }

  const trimmedObservation = params.observation.trim();
  const hasConfirmationSignal = CONFIRMATION_SIGNAL_PATTERN.test(trimmedObservation);
  const hasPartialSignal = PARTIAL_SIGNAL_PATTERN.test(trimmedObservation);
  const progressionAcrossChain = hasGuidedProgression(params.guidedStepStack);
  const currentFocus = extractFocusPhrase(params.guidedStepStack[0] ?? "");
  const nextFocus = extractFocusPhrase(params.nextStepGuidance ?? "");
  const hasClearLever = !isWeakFocusPhrase(currentFocus) || !isWeakFocusPhrase(nextFocus);
  const hasMeaningfulShift = progressionAcrossChain || Boolean(params.nextStepGuidance && hasClearLever);
  const strongResolvedOverride = !hasPartialSignal && hasStrongResolvedRecovery(trimmedObservation, params.guidedStepStack[0]);
  const strongStuckOverride = hasStrongStuckObservation(trimmedObservation);

  if (strongResolvedOverride) {
    return "resolved";
  }

  if (strongStuckOverride) {
    return "stuck";
  }

  if (params.verificationState === "confirmed") {
    return "resolved";
  }

  if (params.reachedGuidedStepLimit && params.verificationState !== "confirmed" && !hasPartialSignal) {
    return "stuck";
  }

  if (
    params.verificationState === "inconclusive" &&
    !hasPartialSignal &&
    !hasMeaningfulShift &&
    (!params.nextStepGuidance || !hasClearLever)
  ) {
    return "stuck";
  }

  if (hasPartialSignal || hasMeaningfulShift || (params.verificationState === "falsified" && hasClearLever)) {
    return "converging";
  }

  return "stuck";
}

function classifyFollowUpResult(params: {
  originalResult: FreeAnalysisResponse;
  nextResult: FreeAnalysisResponse;
  observation: string;
}): FollowUpVerificationState {
  const observation = params.observation.trim();
  const firstStep = params.originalResult.what_to_do_next[0] ?? "";
  const originalSummary = `${params.originalResult.what_happened} ${firstStep}`;
  const nextSummary = `${params.nextResult.what_happened} ${params.nextResult.what_to_do_next[0] ?? ""}`;
  const alternativeObservationText = observation.split(/\bbut\b/i)[1] ?? "";

  const originalTerms = extractComparableTerms(originalSummary);
  const nextTerms = extractComparableTerms(nextSummary);
  const firstStepTerms = extractComparableTerms(firstStep);
  const observationTerms = extractComparableTerms(observation);
  const alternativeTerms = extractComparableTerms(alternativeObservationText);
  const originalFocus = extractFocusPhrase(firstStep) ?? extractFocusPhrase(params.originalResult.what_happened);
  const alternativeFocus = extractObservationFocus(alternativeObservationText);
  const similarity = calculateSimilarity(originalTerms, nextTerms);
  const sharedTerms = [...originalTerms].filter((term) => nextTerms.has(term)).length;
  const stepAlignmentCount = [...firstStepTerms].filter((term) => observationTerms.has(term)).length;
  const alternativeAligned = [...alternativeTerms].some((term) => nextTerms.has(term) && !originalTerms.has(term));

  const hasConfirmationSignal = CONFIRMATION_SIGNAL_PATTERN.test(observation);
  const hasFalsificationSignal = FALSIFICATION_SIGNAL_PATTERN.test(observation);
  const hasPartialSignal = PARTIAL_SIGNAL_PATTERN.test(observation);
  const hasStrongResolvedOverride = !hasPartialSignal && hasStrongResolvedRecovery(observation, firstStep);
  const alternativeEffectSignal = CONFIRMATION_SIGNAL_PATTERN.test(alternativeObservationText);
  const alternateLeverDominance =
    hasFalsificationSignal &&
    alternativeEffectSignal &&
    (hasDistinctAlternateLever(originalFocus, alternativeFocus) || [...alternativeTerms].some((term) => !firstStepTerms.has(term)));

  const sameGroundedCause = sharedTerms >= 3 || similarity >= 0.3;
  const shiftedGroundedCause = sharedTerms === 0 && similarity <= 0.12;
  const directStepRecovery = stepAlignmentCount >= 2 && hasConfirmationSignal;

  if (hasFalsificationSignal && (shiftedGroundedCause || alternativeAligned || alternateLeverDominance)) {
    return "falsified";
  }

  if (hasPartialSignal) {
    return "inconclusive";
  }

  if (hasStrongResolvedOverride) {
    return "confirmed";
  }

  if (hasConfirmationSignal && (sameGroundedCause || directStepRecovery)) {
    return "confirmed";
  }

  return "inconclusive";
}

function getVerificationLabel(verificationState: FollowUpVerificationState | undefined): string | null {
  if (!verificationState) {
    return null;
  }

  switch (verificationState) {
    case "confirmed":
      return "Confirmed";
    case "falsified":
      return "Falsified";
    case "inconclusive":
      return "Inconclusive";
  }
}

function getVerificationClassName(verificationState: FollowUpVerificationState | undefined): string {
  switch (verificationState) {
    case "confirmed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "falsified":
      return "border-coral/20 bg-coral/10 text-ember";
    default:
      return "border-ink/10 bg-white/70 text-ink/70";
  }
}

function getVerificationHint(verificationState: FollowUpVerificationState | undefined): string | null {
  switch (verificationState) {
    case "confirmed":
      return "This supports the current diagnosis. Continue with the next steps.";
    case "falsified":
      return "This suggests a different cause. Focus on the updated diagnosis.";
    case "inconclusive":
      return "This result is not definitive. Try a more isolating check.";
    default:
      return null;
  }
}

function getLoopTerminationStatusLabel(status: LoopTerminationStatus | null): string | null {
  switch (status) {
    case "resolved":
      return "Resolved";
    case "converging":
      return "Converging";
    case "stuck":
      return "Stuck";
    default:
      return null;
  }
}

function getLoopTerminationStatusClassName(status: LoopTerminationStatus | null): string {
  switch (status) {
    case "resolved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "converging":
      return "border-ocean/20 bg-ocean/10 text-ocean";
    case "stuck":
      return "border-coral/20 bg-coral/10 text-ember";
    default:
      return "border-ink/10 bg-white/70 text-ink/70";
  }
}

function getLoopTerminationStatusHint(status: LoopTerminationStatus | null): string | null {
  switch (status) {
    case "resolved":
      return "The latest step strongly indicates the issue is fixed or no longer present.";
    case "converging":
      return "The loop is producing clearer evidence and the next step is still narrowing the likely cause.";
    case "stuck":
      return "Recent checks are not shifting the signal enough to justify continuing the current loop unchanged.";
    default:
      return null;
  }
}

function getConfidenceLevel(params: {
  verificationState: FollowUpVerificationState | undefined;
  loopTerminationStatus: LoopTerminationStatus | null;
  showLowEvidenceCue: boolean;
}): ConfidenceLevel {
  if (params.loopTerminationStatus === "resolved" || params.verificationState === "confirmed") {
    return "high";
  }

  if (
    params.loopTerminationStatus === "stuck" ||
    params.verificationState === "inconclusive" ||
    params.showLowEvidenceCue
  ) {
    return "low";
  }

  if (params.loopTerminationStatus === "converging" || params.verificationState === "falsified") {
    return "medium";
  }

  return "medium";
}

function getConfidenceLabel(confidenceLevel: ConfidenceLevel): string {
  switch (confidenceLevel) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
  }
}

function getConfidenceClassName(confidenceLevel: ConfidenceLevel): string {
  switch (confidenceLevel) {
    case "high":
      return "border-emerald-200/80 bg-emerald-50/80 text-emerald-700/90";
    case "medium":
      return "border-ocean/15 bg-ocean/10 text-ocean/80";
    case "low":
      return "border-ink/10 bg-white/60 text-ink/65";
  }
}

function getSuggestedNextAction(params: {
  loopTerminationStatus: LoopTerminationStatus | null;
  isRefined: boolean;
  verificationState: FollowUpVerificationState | undefined;
  nextStepGuidance: string | null;
  showLowEvidenceCue: boolean;
  hasGuidedStep: boolean;
  observation: string | undefined;
}): SuggestedNextAction {
  if (params.loopTerminationStatus === "resolved") {
    return "stop";
  }

  if (params.loopTerminationStatus === "stuck") {
    return shouldRestartFreshFromObservation(params.observation) ? "restart-fresh" : "escalate";
  }

  if (params.loopTerminationStatus === "converging") {
    return "continue-thread";
  }

  const hasMessySignals =
    params.showLowEvidenceCue ||
    shouldRestartFreshFromObservation(params.observation) ||
    (params.isRefined && params.verificationState === "inconclusive" && !params.nextStepGuidance && !params.hasGuidedStep) ||
    (!params.isRefined && !params.hasGuidedStep);

  if (hasMessySignals) {
    return "restart-fresh";
  }

  if (!params.isRefined) {
    return "continue-thread";
  }

  if (params.verificationState === "falsified" || params.verificationState === "inconclusive") {
    return "continue-thread";
  }

  return "restart-fresh";
}

function getSuggestedNextActionLabel(action: SuggestedNextAction): string {
  switch (action) {
    case "continue-thread":
      return "Continue debugging (use threaded context)";
    case "restart-fresh":
      return "Restart fresh (ignore previous context)";
    case "stop":
      return "Stop (issue appears resolved)";
    case "escalate":
      return "Escalate";
  }
}

function getSuggestedNextActionClassName(action: SuggestedNextAction): string {
  switch (action) {
    case "continue-thread":
      return "border-ocean/20 bg-ocean/10 text-ocean";
    case "restart-fresh":
      return "border-ink/10 bg-white/70 text-ink/80";
    case "stop":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "escalate":
      return "border-coral/20 bg-coral/10 text-ember";
  }
}

function getSuggestedNextActionHint(action: SuggestedNextAction): string {
  switch (action) {
    case "continue-thread":
      return "Keep the current debugging thread. The latest result is still narrowing the likely cause, so carry this context into the next turn.";
    case "restart-fresh":
      return "The current signal is too mixed or underspecified to keep threading confidently. Start a fresh analysis without previous context to reset the frame.";
    case "stop":
      return "The latest observation strongly supports resolution. Verify the fix in your project, then stop the current thread unless the symptom returns.";
    case "escalate":
      return "Do not continue the same bounded thread unchanged. Use the escalation path below to switch to a broader recovery move.";
  }
}

function getEscalationStrategyTitle(strategy: EscalationStrategy | null): string | null {
  switch (strategy) {
    case "minimal-repro":
      return "Isolate to minimal reproduction";
    case "logging":
      return "Switch to logging/debug instrumentation";
    case "single-system-rebuild":
      return "Disable all but one system and rebuild";
    case "clean-environment":
      return "Test in a clean scene or environment";
    default:
      return null;
  }
}

function getEscalationStrategyGuidance(strategy: EscalationStrategy | null): string | null {
  switch (strategy) {
    case "minimal-repro":
      return "Strip the failure down to the smallest reproducible setup that still breaks, then add surrounding pieces back one at a time only after the core symptom is stable.";
    case "logging":
      return "Pause the current swap-and-compare loop and add focused logs or debugger breakpoints around the state change that should happen, so you can see the exact branch, value, or event flow at the moment the symptom appears.";
    case "single-system-rebuild":
      return "Turn off every related system except one core path, confirm the base behavior, then re-enable the surrounding systems one by one until the failure returns. That reintroduction order is the new signal.";
    case "clean-environment":
      return "Recreate the failing setup in a clean scene or isolated environment with fresh defaults. If the issue disappears there, the problem is likely in scene wiring, initialization order, or project-level state rather than the local step you just tested.";
    default:
      return null;
  }
}

function getRecommendedDebuggingMode(params: {
  diagnosis: string;
  primaryStep: string | null;
  nextStepGuidance: string | null;
  loopTerminationStatus: LoopTerminationStatus | null;
  suggestedNextAction: SuggestedNextAction;
  suggestedEscalationStrategy: EscalationStrategy | null;
  confidenceLevel: ConfidenceLevel;
}): DebuggingMode | null {
  if (params.suggestedNextAction === "stop") {
    return null;
  }

  const supportingText = [params.diagnosis, params.primaryStep ?? "", params.nextStepGuidance ?? ""].join(" ");

  if (
    params.suggestedEscalationStrategy === "clean-environment" ||
    params.suggestedEscalationStrategy === "minimal-repro" ||
    /\b(?:clean scene|clean environment|isolated environment|fresh defaults|minimal repro(?:duction)?|small(?:er)? reproduction|strip the failure down|recreate the failing setup)\b/i.test(
      supportingText,
    ) ||
    ((params.loopTerminationStatus === "stuck" || params.suggestedNextAction === "restart-fresh") &&
      params.confidenceLevel === "low" &&
      !params.primaryStep)
  ) {
    return "reproduce-in-clean-scene";
  }

  if (
    /\b(?:duplicate writers?|multiple scripts writing|two scripts writing|duplicate listeners?|multiple listeners?|duplicate handlers?|event duplication|double[- ]fir(?:e|ing)|written from two places|overwrit(?:e|es|ing)|duplicate sources?)\b/i.test(
      supportingText,
    )
  ) {
    return "check-duplicate-writers";
  }

  if (
    /\b(?:stale references?|cached references?|ownership|owner|missing references?|wrong references?|null references?|lost references?|validate references?|validate ownership|handoff between systems)\b/i.test(
      supportingText,
    )
  ) {
    return "validate-ownership-references";
  }

  if (
    /\b(?:scene load|startup|initialization|initialize|lifecycle|order of execution|execution order|bootstrap|awake|start\(\)|start method|onenable|loaded before|loaded after|initial state)\b/i.test(
      supportingText,
    )
  ) {
    return "check-initialization-order";
  }

  if (
    params.suggestedEscalationStrategy === "logging" ||
    /\b(?:debug logs?|log\b|logging|instrument(?:ation)?|trace\b|breakpoint|inspect state|track values?|watch values?|observe lifecycle timing|verify transitions?|state transitions?|event flow)\b/i.test(
      supportingText,
    )
  ) {
    return "instrument-with-logging";
  }

  if (
    params.suggestedEscalationStrategy === "single-system-rebuild" ||
    /\b(?:disable|bypass|turn off|remove|isolate|compare before and after|compare the behavior|one system at a time|toggle|comment out|skip\b|re-enable .* one by one)\b/i.test(
      supportingText,
    )
  ) {
    return "isolate-one-subsystem";
  }

  if (params.loopTerminationStatus === "stuck") {
    return "reproduce-in-clean-scene";
  }

  return "isolate-one-subsystem";
}

function getRecommendedDebuggingModeLabel(mode: DebuggingMode | null): string | null {
  switch (mode) {
    case "isolate-one-subsystem":
      return "Isolate one subsystem";
    case "instrument-with-logging":
      return "Instrument with logging";
    case "check-initialization-order":
      return "Check initialization order";
    case "reproduce-in-clean-scene":
      return "Reproduce in a clean scene";
    case "check-duplicate-writers":
      return "Check for duplicate writers";
    case "validate-ownership-references":
      return "Validate ownership / references";
    default:
      return null;
  }
}

function getRecommendedDebuggingModeClassName(mode: DebuggingMode | null): string {
  switch (mode) {
    case "instrument-with-logging":
      return "border-ink/10 bg-white/60 text-ink/80";
    case "check-initialization-order":
      return "border-ocean/15 bg-ocean/10 text-ocean/80";
    case "reproduce-in-clean-scene":
      return "border-coral/15 bg-coral/5 text-ember/80";
    case "check-duplicate-writers":
      return "border-ink/10 bg-white/60 text-ink/80";
    case "validate-ownership-references":
      return "border-ink/10 bg-white/60 text-ink/80";
    case "isolate-one-subsystem":
    default:
      return "border-ocean/15 bg-ocean/10 text-ocean/80";
  }
}

export function AnalysisResult({
  result,
  input,
  isRefined = false,
  lastObservation,
  verificationState,
  onResultChange,
}: AnalysisResultProps) {
  const [initialConfirmFirstStep, ...initialFollowUpSteps] = result.what_to_do_next;
  const displayedConfirmFirstStep = refineFirstStepPrecision({
    step: initialConfirmFirstStep,
    diagnosis: result.what_happened,
    problemDescription: input?.problemDescription,
  });
  const isGuidedLoopActive = isRefined && verificationState !== "confirmed";
  const guidedStepStack = isGuidedLoopActive
    ? getGuidedStepStack({ result, isRefined, problemDescription: input?.problemDescription })
    : displayedConfirmFirstStep
      ? [displayedConfirmFirstStep]
      : [];
  const displayedGuidedSteps = [...guidedStepStack].reverse();
  const currentGuidedStep = guidedStepStack[0] ?? null;
  const currentGuidedStepNumber = guidedStepStack.length;
  const nextStepGuidance = isGuidedLoopActive
    ? buildNextStepGuidance({
        verificationState,
        currentResult: result,
        observation: lastObservation,
        priorSteps: guidedStepStack,
      })
    : null;
  const reachedGuidedStepLimit = isGuidedLoopActive && guidedStepStack.length >= MAX_GUIDED_STEPS;
  const canContinueGuidedLoop = !reachedGuidedStepLimit;
  const loopTerminationStatus = classifyLoopTerminationStatus({
    isRefined,
    verificationState,
    observation: lastObservation,
    guidedStepStack,
    nextStepGuidance,
    reachedGuidedStepLimit,
  });
  const suggestedEscalationStrategy = getSuggestedEscalationStrategy({
    status: loopTerminationStatus,
    guidedStepStack,
    observation: lastObservation,
    problemDescription: input?.problemDescription,
  });
  const showLowEvidenceCue = shouldShowLowEvidenceCue(result);
  const confidenceLevel = getConfidenceLevel({
    verificationState,
    loopTerminationStatus,
    showLowEvidenceCue,
  });
  const suggestedNextAction = getSuggestedNextAction({
    loopTerminationStatus,
    isRefined,
    verificationState,
    nextStepGuidance,
    showLowEvidenceCue,
    hasGuidedStep: Boolean(currentGuidedStep),
    observation: lastObservation,
  });
  const recommendedDebuggingMode = getRecommendedDebuggingMode({
    diagnosis: result.what_happened,
    primaryStep: currentGuidedStep ?? displayedConfirmFirstStep ?? null,
    nextStepGuidance,
    loopTerminationStatus,
    suggestedNextAction,
    suggestedEscalationStrategy,
    confidenceLevel,
  });
  const [observation, setObservation] = useState("");
  const [isSubmittingFollowUp, setIsSubmittingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const trimmedObservation = useMemo(() => observation.trim(), [observation]);
  const canSubmitFollowUp = Boolean(input?.problemDescription && trimmedObservation && !isSubmittingFollowUp && canContinueGuidedLoop);

  const handleFollowUpSubmit = async () => {
    if (!input?.problemDescription || !trimmedObservation || isSubmittingFollowUp) {
      return;
    }

    const submittedObservation = trimmedObservation;

    setFollowUpError(null);
    setIsSubmittingFollowUp(true);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          problemDescription: buildFollowUpProblemDescription(
            input.problemDescription,
            trimmedObservation,
            currentGuidedStep ?? undefined,
            currentGuidedStepNumber || undefined,
          ),
          errorMessage: input.errorMessage ?? "",
          context: input.context ?? "",
          codeSnippet: input.codeSnippet ?? "",
        } satisfies AnalysisInput),
      });

      const payload = (await response.json()) as FreeAnalysisResponse | { error?: string };
      if (!response.ok) {
        setFollowUpError(
          payload && "error" in payload
            ? payload.error || "We couldn't generate an analysis right now. Please try again."
            : "We couldn't generate an analysis right now. Please try again.",
        );
        return;
      }

      const verificationState = classifyFollowUpResult({
        originalResult: result,
        nextResult: payload,
        observation: submittedObservation,
      });
      const refinedPayload =
        verificationState === "falsified"
          ? {
              ...payload,
              what_happened: buildFalsifiedDiagnosis({
                originalResult: result,
                nextResult: payload,
                observation: submittedObservation,
              }),
            }
          : payload;
      const nextGuidedStep = buildNextStepGuidance({
        verificationState,
        currentResult: refinedPayload,
        observation: submittedObservation,
        priorSteps: guidedStepStack,
      });
      const nextGuidedStepStack = verificationState === "confirmed" ? guidedStepStack : buildGuidedStepStack(nextGuidedStep, guidedStepStack);
      const upcomingNextStepGuidance =
        verificationState === "confirmed"
          ? null
          : buildNextStepGuidance({
              verificationState,
              currentResult: refinedPayload,
              observation: submittedObservation,
              priorSteps: nextGuidedStepStack,
            });
      const nextLoopTerminationStatus = classifyLoopTerminationStatus({
        isRefined: true,
        verificationState,
        observation: submittedObservation,
        guidedStepStack: nextGuidedStepStack,
        nextStepGuidance: upcomingNextStepGuidance,
        reachedGuidedStepLimit: verificationState === "confirmed" ? false : nextGuidedStepStack.length >= MAX_GUIDED_STEPS,
      });
      const nextResult =
        verificationState === "confirmed"
          ? refinedPayload
          : {
              ...refinedPayload,
              what_to_do_next: nextGuidedStepStack,
            };

      onResultChange?.({
        result: nextResult,
        observation: submittedObservation,
        verificationState,
        attemptedStep: currentGuidedStep ?? undefined,
        loopTerminationStatus: nextLoopTerminationStatus,
      });
      setObservation("");
    } catch {
      setFollowUpError("We couldn't generate an analysis right now. Please try again.");
    } finally {
      setIsSubmittingFollowUp(false);
    }
  };

  return (
    <div className="grid gap-5">
      <section className="glass-card rounded-[1.75rem] p-6 shadow-float sm:p-7">
        <p className="section-label">Diagnosis</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Confidence</p>
          <span
            className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${getConfidenceClassName(confidenceLevel)}`}
          >
            {getConfidenceLabel(confidenceLevel)}
          </span>
        </div>
        {recommendedDebuggingMode ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Recommended mode</p>
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.01em] ${getRecommendedDebuggingModeClassName(recommendedDebuggingMode)}`}
            >
              {getRecommendedDebuggingModeLabel(recommendedDebuggingMode)}
            </span>
          </div>
        ) : null}
        {isRefined ? (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ocean/80">
                Refined based on your observation
              </p>
              {getVerificationLabel(verificationState) ? (
                <span
                  className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${getVerificationClassName(verificationState)}`}
                >
                  {getVerificationLabel(verificationState)}
                </span>
              ) : null}
            </div>
            {lastObservation ? (
              <p className="text-xs leading-6 body-muted sm:text-sm">
                You observed: &quot;{lastObservation}&quot;
              </p>
            ) : null}
            {getVerificationHint(verificationState) ? (
              <p className="text-xs leading-6 body-muted sm:text-sm">{getVerificationHint(verificationState)}</p>
            ) : null}
            {getLoopTerminationStatusLabel(loopTerminationStatus) ? (
              <div className="rounded-[1rem] border border-ink/10 bg-white/40 p-3">
                <p className="section-label">Current status</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${getLoopTerminationStatusClassName(loopTerminationStatus)}`}
                  >
                    {getLoopTerminationStatusLabel(loopTerminationStatus)}
                  </span>
                </div>
                {getLoopTerminationStatusHint(loopTerminationStatus) ? (
                  <p className="mt-2 text-xs leading-6 body-muted sm:text-sm">{getLoopTerminationStatusHint(loopTerminationStatus)}</p>
                ) : null}
                <div className="mt-3 rounded-[1rem] border border-ink/10 bg-white/50 p-3">
                  <p className="section-label">Suggested next action</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${getSuggestedNextActionClassName(suggestedNextAction)}`}
                    >
                      {getSuggestedNextActionLabel(suggestedNextAction)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-6 body-muted sm:text-sm">{getSuggestedNextActionHint(suggestedNextAction)}</p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {showLowEvidenceCue ? (
          <p className="mt-2 text-xs leading-6 body-muted sm:text-sm">
            Given the current details, this is the most likely explanation.
          </p>
        ) : null}
        <p className="mt-3 text-sm leading-7 text-ink/90 sm:text-base">{result.what_happened}</p>
      </section>
      <section className="glass-card rounded-[1.75rem] p-6 shadow-float sm:p-7">
        <p className="section-label">Why this is the likely cause</p>
        <ul className="mt-4 space-y-3 text-sm leading-7 text-ink/90 sm:text-base">
          {result.what_matters.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section className="glass-card rounded-[1.75rem] p-6 shadow-float sm:p-7">
        <p className="section-label">What to do next</p>
        <p className="mt-3 text-sm leading-7 body-muted">Start with the first check before making broader changes.</p>
        {displayedConfirmFirstStep ? (
          <div className="mt-4 rounded-[1.25rem] border border-ocean/15 bg-ocean/5 p-4">
            <p className="section-label">Confirm first</p>
            <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">1. {displayedConfirmFirstStep}</p>
          </div>
        ) : null}
        {isGuidedLoopActive ? (
          <div className="mt-4">
            <p className="section-label">Then continue</p>
            <ol className="mt-3 space-y-3 text-sm leading-7 text-ink/90 sm:text-base">
              {displayedGuidedSteps.slice(1).map((item, index) => (
                <li key={item}>{index + 2}. {item}</li>
              ))}
            </ol>
          </div>
        ) : initialFollowUpSteps.length > 0 ? (
          <div className="mt-4">
            <p className="section-label">Then continue</p>
            <ol className="mt-3 space-y-3 text-sm leading-7 text-ink/90 sm:text-base">
              {initialFollowUpSteps.map((item, index) => (
                <li key={item}>{index + 2}. {item}</li>
              ))}
            </ol>
          </div>
        ) : null}
        {isGuidedLoopActive && nextStepGuidance && loopTerminationStatus !== "stuck" ? (
          <div className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white/50 p-4">
            <p className="section-label">Next focused step</p>
            <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">{displayedGuidedSteps.length + 1}. {nextStepGuidance}</p>
          </div>
        ) : null}
        {suggestedNextAction === "escalate" && getEscalationStrategyTitle(suggestedEscalationStrategy) ? (
          <div className="mt-4 rounded-[1.25rem] border border-coral/20 bg-coral/5 p-4">
            <p className="section-label">Suggested escalation</p>
            <p className="mt-2 text-sm font-semibold leading-7 text-ink/90 sm:text-base">
              {getEscalationStrategyTitle(suggestedEscalationStrategy)}
            </p>
            {getEscalationStrategyGuidance(suggestedEscalationStrategy) ? (
              <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">{getEscalationStrategyGuidance(suggestedEscalationStrategy)}</p>
            ) : null}
          </div>
        ) : null}
        {reachedGuidedStepLimit ? (
          <div className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white/50 p-4">
            <p className="section-label">Guided loop limit</p>
            <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">
              The bounded guided loop now stops at step 3. Try the current step, then restart a fresh analysis if you need a wider debugging pass.
            </p>
          </div>
        ) : null}
        <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/40 p-4">
          <p className="text-sm leading-7 text-ink/90 sm:text-base">
            After you try {currentGuidedStepNumber > 1 ? `step ${currentGuidedStepNumber}` : "the first step"}, what did you observe?
          </p>
          <input
            type="text"
            aria-label="Optional follow-up observation"
            value={observation}
            onChange={(event) => setObservation(event.target.value)}
            placeholder="Optional note for your next debugging pass"
            disabled={!canContinueGuidedLoop}
            className="mt-3 w-full rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm text-ink outline-none placeholder:text-slate"
          />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-6 body-muted">
              {canContinueGuidedLoop
                ? "AI-E will re-run the same analysis using your latest step outcome as additional context."
                : "This bounded guided loop stops at three steps to avoid drifting into unreviewed chained reasoning."}
            </p>
            <button
              type="button"
              onClick={handleFollowUpSubmit}
              disabled={!canSubmitFollowUp}
              className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmittingFollowUp ? "Re-running..." : "Re-run analysis with observation"}
            </button>
          </div>
          {followUpError ? <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-sm text-ember">{followUpError}</p> : null}
        </div>
      </section>
    </div>
  );
}
