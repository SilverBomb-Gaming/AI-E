import type { FollowUpVerificationState, StoredLoopTerminationStatus } from "./AnalysisForm";
import type { FreeAnalysisResponse } from "../lib/aie/types";

// Single source of truth for AnalysisResult decision logic.
// Keep renderer-facing behavior derivation here and do not reintroduce inline decision helpers in AnalysisResult.tsx.

export type LoopTerminationStatus = StoredLoopTerminationStatus;
export type ConfidenceLevel = "high" | "medium" | "low";
export type EscalationStrategy = "minimal-repro" | "logging" | "single-system-rebuild" | "clean-environment";
export type SuggestedNextAction = "continue-thread" | "restart-fresh" | "stop" | "escalate";
export type DebuggingMode =
  | "isolate-one-subsystem"
  | "instrument-with-logging"
  | "check-initialization-order"
  | "reproduce-in-clean-scene"
  | "check-duplicate-writers"
  | "validate-ownership-references";
export type SupervisedActionChainStep = {
  label: string;
  purpose: string;
  watchFor: string;
};
type IntentAnchor = "isolate-root-cause" | "confirm-system-boundary" | "narrow-conflicting-systems" | "verify-state-transitions";
type StepMethod = "disable" | "isolate" | "replace" | "force" | "inspect" | "unknown";

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
const ACTIONABLE_CONFIRMATION_STEP_PATTERN = /\b(?:disable|turn off|remove|bypass|force|toggle|clear|delay|comment out|skip|pause)\b/i;
const WEAK_CONFIRMATION_STEP_PATTERN = /^(?:temporarily\s+)?(?:add a debug log|log\b|inspect\b|check\b|verify\b|look at\b)/i;
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

export const MAX_GUIDED_STEPS = 3;

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

export function shouldShowLowEvidenceCue(result: FreeAnalysisResponse): boolean {
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

export function buildFollowUpProblemDescription(
  problemDescription: string,
  observation: string,
  attemptedStep?: string,
  stepNumber?: number,
): string {
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

export function shouldRestartFreshFromObservation(observation: string | undefined): boolean {
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

export function shouldUseMessyInputFirstStep(problemDescription: string | undefined): boolean {
  if (!problemDescription) {
    return false;
  }

  const recentChangeCandidates = extractRecentChangeCandidates(problemDescription);
  return MESSY_MULTI_SYSTEM_INPUT_PATTERN.test(problemDescription) || hasBroadSystemMixSignal(problemDescription) || recentChangeCandidates.length >= 3;
}

export function refineFirstStepPrecision(params: {
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

export function buildFalsifiedDiagnosis(params: {
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
  const verificationBiasedMethods: StepMethod[] =
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

export function buildNextStepGuidance(params: {
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

export function getGuidedStepStack(params: {
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

export function buildGuidedStepStack(nextStep: string | null, priorSteps: string[]): string[] {
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

export function getSuggestedEscalationStrategy(params: {
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

export function classifyLoopTerminationStatus(params: {
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

  if (params.reachedGuidedStepLimit && !hasPartialSignal) {
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

export function classifyFollowUpResult(params: {
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

export function getConfidenceLevel(params: {
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

export function getSuggestedNextAction(params: {
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

function shouldSuppressRecommendedDebuggingMode(params: {
  isRefined: boolean;
  problemDescription: string | undefined;
  confidenceLevel: ConfidenceLevel;
  showLowEvidenceCue: boolean;
}): boolean {
  if (params.isRefined || !params.problemDescription || !shouldUseMessyInputFirstStep(params.problemDescription)) {
    return false;
  }

  return params.showLowEvidenceCue || params.confidenceLevel !== "high";
}

export function getRecommendedDebuggingMode(params: {
  isRefined: boolean;
  problemDescription: string | undefined;
  diagnosis: string;
  primaryStep: string | null;
  nextStepGuidance: string | null;
  loopTerminationStatus: LoopTerminationStatus | null;
  suggestedNextAction: SuggestedNextAction;
  suggestedEscalationStrategy: EscalationStrategy | null;
  confidenceLevel: ConfidenceLevel;
  showLowEvidenceCue: boolean;
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
    shouldSuppressRecommendedDebuggingMode({
      isRefined: params.isRefined,
      problemDescription: params.problemDescription,
      confidenceLevel: params.confidenceLevel,
      showLowEvidenceCue: params.showLowEvidenceCue,
    })
  ) {
    return null;
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

function getEscalationStrategyFallbackLabel(strategy: EscalationStrategy | null): string {
  switch (strategy) {
    case "logging":
      return "focused logging";
    case "single-system-rebuild":
      return "a single-system rebuild";
    case "clean-environment":
      return "a clean scene check";
    case "minimal-repro":
      return "a minimal reproduction";
    default:
      return "an escalation path";
  }
}

function getActionChainFocusLabel(step: string | null): string {
  const focus = extractFocusPhrase(step ?? "") ?? extractObservationFocus(step ?? "") ?? "suspected system";
  return trimLeadingArticle(focus);
}

function getActionChainStepLabel(step: string | null, mode: DebuggingMode): string {
  const method = step ? extractStepMethod(step) : "unknown";

  if (method === "inspect") {
    return mode === "instrument-with-logging" ? "Inspect the signal with logging" : "Inspect the suspect state";
  }

  if (method === "force") {
    return "Force a known-safe state";
  }

  if (method === "replace") {
    return "Swap in a known-safe default";
  }

  if (method === "disable" || method === "isolate") {
    if (mode === "check-duplicate-writers") {
      return "Disable one writer";
    }

    if (mode === "validate-ownership-references") {
      return "Isolate the active reference path";
    }

    return "Isolate the suspected subsystem";
  }

  switch (mode) {
    case "instrument-with-logging":
      return "Inspect the signal with logging";
    case "check-initialization-order":
      return "Check lifecycle ordering";
    case "check-duplicate-writers":
      return "Trace the second writer";
    case "validate-ownership-references":
      return "Verify the active reference path";
    case "reproduce-in-clean-scene":
      return "Reproduce in a clean scene";
    case "isolate-one-subsystem":
    default:
      return "Isolate the suspected subsystem";
  }
}

function getActionChainStepPurpose(step: string | null, mode: DebuggingMode): string {
  const focus = getActionChainFocusLabel(step);
  const method = step ? extractStepMethod(step) : "unknown";

  if (mode === "instrument-with-logging" || method === "inspect") {
    return `Use ${focus} to find the exact branch, event, or value that diverges when the symptom appears.`;
  }

  if (mode === "check-initialization-order") {
    return `Confirm whether ${focus} runs before its dependency is ready.`;
  }

  if (mode === "check-duplicate-writers") {
    return `Test whether ${focus} is being overwritten by a second writer or listener.`;
  }

  if (mode === "validate-ownership-references") {
    return `Confirm whether ${focus} is still the active owner or reference when the symptom appears.`;
  }

  if (method === "force" || method === "replace") {
    return `Use ${focus} to isolate the failing path without widening the test.`;
  }

  return `Test whether ${focus} is the single subsystem actually driving the symptom.`;
}

function getActionChainStepWatchFor(step: string | null, mode: DebuggingMode): string {
  const focus = getActionChainFocusLabel(step);
  const method = step ? extractStepMethod(step) : "unknown";

  if (mode === "instrument-with-logging" || method === "inspect") {
    return `Watch for which branch, value, or event around ${focus} first diverges at the moment the symptom appears.`;
  }

  if (mode === "check-initialization-order") {
    return `Watch for whether ${focus} runs too early, too late, or before the required dependency is populated.`;
  }

  if (mode === "check-duplicate-writers") {
    return `Watch for whether the symptom stops after one writer is isolated or another write immediately restores the bad state.`;
  }

  if (mode === "validate-ownership-references") {
    return `Watch for whether the active owner or reference around ${focus} goes stale, null, or points at the wrong object.`;
  }

  if (method === "force" || method === "replace") {
    return `Watch for whether changing ${focus} shifts the symptom immediately instead of only producing later side effects.`;
  }

  return `Watch for whether isolating ${focus} makes the symptom disappear, weaken, or stay exactly the same.`;
}

function buildSupervisedActionChainStep(step: string | null, mode: DebuggingMode): SupervisedActionChainStep | null {
  if (!step?.trim()) {
    return null;
  }

  return {
    label: getActionChainStepLabel(step, mode),
    purpose: getActionChainStepPurpose(step, mode),
    watchFor: getActionChainStepWatchFor(step, mode),
  };
}

function buildModeFallbackActionChainStep(mode: DebuggingMode, currentStep: string | null): SupervisedActionChainStep | null {
  const focus = getActionChainFocusLabel(currentStep);

  switch (mode) {
    case "instrument-with-logging":
      return {
        label: "Compare the logged signal",
        purpose: `Use the logs around ${focus} to confirm the failing branch before widening the search.`,
        watchFor: `Watch for the first value, event, or branch around ${focus} that stops matching the expected flow.`,
      };
    case "check-initialization-order":
      return {
        label: "Compare lifecycle timing",
        purpose: `Use the timing around ${focus} to confirm whether the failure is really an order-of-execution issue.`,
        watchFor: `Watch for the first Awake, Start, or enable-time mismatch that appears before the symptom.`,
      };
    case "check-duplicate-writers":
      return {
        label: "Confirm the overwrite path",
        purpose: `Use the narrowed check around ${focus} to confirm whether a second writer is reapplying the bad state.`,
        watchFor: `Watch for one writer restoring the correct value and another write immediately undoing it.`,
      };
    case "validate-ownership-references":
      return {
        label: "Confirm the live reference",
        purpose: `Use the narrowed check around ${focus} to verify the object or owner in use at symptom time.`,
        watchFor: `Watch for the reference around ${focus} going stale, null, or switching owners unexpectedly.`,
      };
    case "isolate-one-subsystem":
      return {
        label: "Compare the before/after result",
        purpose: `Use the isolated check around ${focus} to confirm or reject the current subsystem boundary.`,
        watchFor: `Watch for an immediate symptom shift after isolating ${focus}, not just unrelated side effects.`,
      };
    case "reproduce-in-clean-scene":
    default:
      return null;
  }
}

function buildActionChainDecisionStep(params: {
  suggestedEscalationStrategy: EscalationStrategy | null;
}): SupervisedActionChainStep {
  return {
    label: "Decide continue vs escalate",
    purpose: "Keep the chain bounded and evidence-led instead of freelancing into a longer plan.",
    watchFor: `Stop the chain if the symptom resolves. Continue only if the latest step produced a clearer single-cause signal; otherwise switch to ${getEscalationStrategyFallbackLabel(params.suggestedEscalationStrategy)} instead of widening the loop.`,
  };
}

export function getBoundedSupervisedActionChain(params: {
  isRefined: boolean;
  problemDescription: string | undefined;
  recommendedDebuggingMode: DebuggingMode | null;
  suggestedNextAction: SuggestedNextAction;
  loopTerminationStatus: LoopTerminationStatus | null;
  confidenceLevel: ConfidenceLevel;
  showLowEvidenceCue: boolean;
  currentGuidedStep: string | null;
  nextStepGuidance: string | null;
  suggestedEscalationStrategy: EscalationStrategy | null;
}): SupervisedActionChainStep[] | null {
  if (!params.recommendedDebuggingMode || params.recommendedDebuggingMode === "reproduce-in-clean-scene") {
    return null;
  }

  if (params.suggestedNextAction !== "continue-thread") {
    return null;
  }

  if (params.loopTerminationStatus === "resolved" || params.loopTerminationStatus === "stuck") {
    return null;
  }

  if (params.showLowEvidenceCue || params.confidenceLevel === "low" || !params.currentGuidedStep) {
    return null;
  }

  if (!params.isRefined && shouldUseMessyInputFirstStep(params.problemDescription)) {
    return null;
  }

  const stepOne = buildSupervisedActionChainStep(params.currentGuidedStep, params.recommendedDebuggingMode);
  const stepTwo = params.nextStepGuidance
    ? buildSupervisedActionChainStep(params.nextStepGuidance, params.recommendedDebuggingMode)
    : buildModeFallbackActionChainStep(params.recommendedDebuggingMode, params.currentGuidedStep);
  const stepThree = buildActionChainDecisionStep({
    suggestedEscalationStrategy: params.suggestedEscalationStrategy,
  });

  const chain = [stepOne, stepTwo, stepThree].filter(
    (step): step is SupervisedActionChainStep => Boolean(step),
  );

  const dedupedChain = chain.filter((step, index, steps) => {
    return steps.findIndex((candidate) => candidate.label === step.label && candidate.watchFor === step.watchFor) === index;
  });

  return dedupedChain.length >= 2 ? dedupedChain.slice(0, MAX_GUIDED_STEPS) : null;
}

export function deriveAnalysisResultSignals(params: {
  result: FreeAnalysisResponse;
  problemDescription?: string;
  isRefined?: boolean;
  lastObservation?: string;
  verificationState?: FollowUpVerificationState;
}): {
  displayedConfirmFirstStep: string | undefined;
  guidedStepStack: string[];
  displayedGuidedSteps: string[];
  currentGuidedStep: string | null;
  currentGuidedStepNumber: number;
  nextStepGuidance: string | null;
  reachedGuidedStepLimit: boolean;
  canContinueGuidedLoop: boolean;
  loopTerminationStatus: LoopTerminationStatus | null;
  suggestedEscalationStrategy: EscalationStrategy | null;
  showLowEvidenceCue: boolean;
  confidenceLevel: ConfidenceLevel;
  suggestedNextAction: SuggestedNextAction;
  recommendedDebuggingMode: DebuggingMode | null;
  supervisedActionChain: SupervisedActionChainStep[] | null;
  isGuidedLoopActive: boolean;
} {
  const { result, problemDescription, isRefined = false, verificationState, lastObservation } = params;
  const [initialConfirmFirstStep] = result.what_to_do_next;
  const displayedConfirmFirstStep = refineFirstStepPrecision({
    step: initialConfirmFirstStep,
    diagnosis: result.what_happened,
    problemDescription,
  });
  const isGuidedLoopActive = isRefined && verificationState !== "confirmed";
  const guidedStepStack = isGuidedLoopActive
    ? getGuidedStepStack({ result, isRefined, problemDescription })
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
    problemDescription,
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
    isRefined,
    problemDescription,
    diagnosis: result.what_happened,
    primaryStep: currentGuidedStep ?? displayedConfirmFirstStep ?? null,
    nextStepGuidance,
    loopTerminationStatus,
    suggestedNextAction,
    suggestedEscalationStrategy,
    confidenceLevel,
    showLowEvidenceCue,
  });
  const supervisedActionChain = getBoundedSupervisedActionChain({
    isRefined,
    problemDescription,
    recommendedDebuggingMode,
    suggestedNextAction,
    loopTerminationStatus,
    confidenceLevel,
    showLowEvidenceCue,
    currentGuidedStep,
    nextStepGuidance,
    suggestedEscalationStrategy,
  });

  return {
    displayedConfirmFirstStep,
    guidedStepStack,
    displayedGuidedSteps,
    currentGuidedStep,
    currentGuidedStepNumber,
    nextStepGuidance,
    reachedGuidedStepLimit,
    canContinueGuidedLoop,
    loopTerminationStatus,
    suggestedEscalationStrategy,
    showLowEvidenceCue,
    confidenceLevel,
    suggestedNextAction,
    recommendedDebuggingMode,
    supervisedActionChain,
    isGuidedLoopActive,
  };
}
