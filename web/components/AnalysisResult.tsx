"use client";

import { useMemo, useState } from "react";

import type { FollowUpVerificationState } from "@/components/AnalysisForm";
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
  }) => void;
};

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
const ACTIONABLE_CONFIRMATION_STEP_PATTERN =
  /\b(?:disable|turn off|remove|bypass|force|toggle|clear|delay|comment out|skip|pause)\b/i;
const WEAK_CONFIRMATION_STEP_PATTERN =
  /^(?:temporarily\s+)?(?:add a debug log|log\b|inspect\b|check\b|verify\b|look at\b)/i;
const GENERIC_FOCUS_PATTERN =
  /\b(?:issue|problem|symptom|behavior|weirdness|feels wrong|same slowdown|snap back|run normally|changes made|current suspected system)\b/i;

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

function buildFollowUpProblemDescription(problemDescription: string, observation: string): string {
  const trimmedDescription = problemDescription.trim();
  const trimmedObservation = observation.trim();
  if (!trimmedObservation) {
    return trimmedDescription;
  }

  const separator = /[.!?]$/.test(trimmedDescription) ? " " : ". ";
  return `${trimmedDescription}${separator}After trying the first step: ${trimmedObservation}`;
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

function cleanFocusPhrase(text: string): string | null {
  const cleaned = trimLeadingArticle(trimTrailingPunctuation(text))
    .replace(/^(?:or\s+)?(?:disable|turn off|remove|bypass|force|clear|delay|skip|pause|comment out)\s+(?:the\s+)?/i, "")
    .replace(/^(?:most likely cause of|likely cause of|cause of|changes made to)\s+/i, "")
    .replace(/\s+(?:lets?|makes?|removes?|fixes?|resolves?|stops?|worked|solved)\b.*$/i, "")
    .replace(/\s+/g, " ");
  if (!cleaned) {
    return null;
  }

  return cleaned.split(" ").slice(0, 6).join(" ");
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
    const focus = cleanFocusPhrase(actionableMatch[1]);
    if (!isWeakFocusPhrase(focus)) {
      return focus;
    }
  }

  const nounPhraseMatches = text.matchAll(/\b(?:the|a|an)\s+([^.,;]+?)(?:\s+(?:is|are|was|were|to|before|after|during|when|that|which)\b|[.,;]|$)/gi);
  for (const match of nounPhraseMatches) {
    const focus = cleanFocusPhrase(match[1]);
    if (!isWeakFocusPhrase(focus)) {
      return focus;
    }
  }

  return null;
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
  const firstStep = params.originalResult.what_to_do_next[0] ?? "";
  const noEffectClause = params.observation.split(/\bbut\b/i)[0]?.trim() ?? "";
  const alternativeClause = params.observation.split(/\bbut\b/i)[1]?.trim() ?? params.observation.trim();
  const originalFocus =
    extractFocusPhrase(firstStep) ?? extractFocusPhrase(params.originalResult.what_happened) ?? "the original suspected system";
  const alternativeFocus =
    extractFocusPhrase(alternativeClause) ?? extractFocusPhrase(params.nextResult.what_happened) ?? "a different system";
  const noEffectSummary = noEffectClause
    ? lowerFirstCharacter(normalizeEvidenceClause(noEffectClause)).replace(/,\s+([A-Z])/g, (_, character: string) => `, ${character.toLowerCase()}`)
    : `changing ${trimLeadingArticle(originalFocus)} had no effect`;
  const alternativeEvidence = capitalizeSentence(normalizeEvidenceClause(alternativeClause));

  return `Since ${noEffectSummary}, the issue is more likely driven by ${trimLeadingArticle(alternativeFocus)} than ${trimLeadingArticle(originalFocus)}. ${alternativeEvidence}.`;
}

type StepMethod = "disable" | "isolate" | "replace" | "force" | "inspect" | "unknown";

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
  firstStep: string;
  candidateStep: string;
  candidateFocus: string | null;
}): boolean {
  const firstFocus = extractFocusPhrase(params.firstStep);
  const firstMethod = extractStepMethod(params.firstStep);
  const candidateMethod = extractStepMethod(params.candidateStep);
  const differentLever = hasDistinctAlternateLever(firstFocus, params.candidateFocus);
  const narrowerScope = isNarrowerScope(firstFocus, params.candidateFocus);
  const differentMethod = firstMethod !== candidateMethod && candidateMethod !== "unknown";
  const sameSystem = !differentLever && !narrowerScope;

  if (hasHighPhraseOverlap(params.firstStep, params.candidateStep)) {
    return false;
  }

  if (sameSystem && firstMethod === candidateMethod) {
    return false;
  }

  return differentLever || narrowerScope || differentMethod;
}

function buildSecondStepGuidance(params: {
  verificationState: FollowUpVerificationState | undefined;
  currentResult: FreeAnalysisResponse;
  observation: string | undefined;
}): string | null {
  if (!params.verificationState || !params.observation?.trim()) {
    return null;
  }

  const currentFirstStep = params.currentResult.what_to_do_next[0] ?? "";
  const strengthenedCurrentStep = strengthenConfirmationStep(currentFirstStep, params.currentResult.what_happened) ?? currentFirstStep;
  const alternativeClause = params.observation.split(/\bbut\b/i)[1]?.trim() ?? params.observation.trim();
  const diagnosisFocus = extractFocusPhrase(params.currentResult.what_happened);
  const observationFocus = extractFocusPhrase(params.observation);
  const currentFocus =
    (extractFocusPhrase(strengthenedCurrentStep) ??
      (WEAK_CONFIRMATION_STEP_PATTERN.test(currentFirstStep) ? extractFocusPhrase(params.currentResult.what_happened) : null) ??
      extractFocusPhrase(params.currentResult.what_happened)) ??
    "current suspected system";
  const alternateFocus = extractFocusPhrase(alternativeClause) ?? observationFocus ?? diagnosisFocus ?? currentFocus;
  const focusCandidates = [
    params.verificationState === "falsified" ? alternateFocus : diagnosisFocus,
    params.verificationState === "falsified" ? diagnosisFocus : observationFocus,
    params.verificationState === "falsified" ? observationFocus : alternateFocus,
    currentFocus,
  ].filter((focus, index, values): focus is string => Boolean(focus?.trim()) && values.indexOf(focus) === index);
  const orderedFocusCandidates = [
    ...focusCandidates.filter((focus) => !isWeakFocusPhrase(focus)),
    ...focusCandidates.filter((focus) => isWeakFocusPhrase(focus)),
  ].filter((focus, index, values) => values.indexOf(focus) === index);
  const methodCandidates: StepMethod[] =
    params.verificationState === "falsified" ? ["disable", "isolate", "replace", "force"] : ["isolate", "replace", "force", "disable"];

  for (const focus of orderedFocusCandidates) {
    for (const method of methodCandidates) {
      const step = buildActionableSecondStep(method, focus, params.verificationState);
      if (step === strengthenedCurrentStep) {
        continue;
      }

      if (isMeaningfullyProgressed({ firstStep: strengthenedCurrentStep, candidateStep: step, candidateFocus: focus })) {
        return step;
      }
    }
  }

  return null;
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
  const alternativeFocus = extractFocusPhrase(alternativeObservationText);
  const similarity = calculateSimilarity(originalTerms, nextTerms);
  const sharedTerms = [...originalTerms].filter((term) => nextTerms.has(term)).length;
  const stepAlignmentCount = [...firstStepTerms].filter((term) => observationTerms.has(term)).length;
  const alternativeAligned = [...alternativeTerms].some((term) => nextTerms.has(term) && !originalTerms.has(term));

  const hasConfirmationSignal = CONFIRMATION_SIGNAL_PATTERN.test(observation);
  const hasFalsificationSignal = FALSIFICATION_SIGNAL_PATTERN.test(observation);
  const hasPartialSignal = PARTIAL_SIGNAL_PATTERN.test(observation);
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

export function AnalysisResult({
  result,
  input,
  isRefined = false,
  lastObservation,
  verificationState,
  onResultChange,
}: AnalysisResultProps) {
  const [confirmFirstStep, ...followUpSteps] = result.what_to_do_next;
  const displayedConfirmFirstStep = strengthenConfirmationStep(confirmFirstStep, result.what_happened);
  const secondStepGuidance = isRefined
    ? buildSecondStepGuidance({
        verificationState,
        currentResult: result,
        observation: lastObservation,
      })
    : null;
  const showLowEvidenceCue = shouldShowLowEvidenceCue(result);
  const [observation, setObservation] = useState("");
  const [isSubmittingFollowUp, setIsSubmittingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const trimmedObservation = useMemo(() => observation.trim(), [observation]);
  const canSubmitFollowUp = Boolean(input?.problemDescription && trimmedObservation && !isSubmittingFollowUp);

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
          problemDescription: buildFollowUpProblemDescription(input.problemDescription, trimmedObservation),
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
      const nextResult =
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

      onResultChange?.({
        result: nextResult,
        observation: submittedObservation,
        verificationState,
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
        {followUpSteps.length > 0 ? (
          <div className="mt-4">
            <p className="section-label">Then continue</p>
            <ol className="mt-3 space-y-3 text-sm leading-7 text-ink/90 sm:text-base">
              {followUpSteps.map((item, index) => (
                <li key={item}>{index + 2}. {item}</li>
              ))}
            </ol>
          </div>
        ) : null}
        {isRefined && secondStepGuidance && verificationState !== "confirmed" ? (
          <div className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white/50 p-4">
            <p className="section-label">Next focused step</p>
            <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">2. {secondStepGuidance}</p>
          </div>
        ) : null}
        <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/40 p-4">
          <p className="text-sm leading-7 text-ink/90 sm:text-base">After you try the first step, what did you observe?</p>
          <input
            type="text"
            aria-label="Optional follow-up observation"
            value={observation}
            onChange={(event) => setObservation(event.target.value)}
            placeholder="Optional note for your next debugging pass"
            className="mt-3 w-full rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm text-ink outline-none placeholder:text-slate"
          />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-6 body-muted">
              AI-E will re-run the same analysis using your observation as additional context.
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