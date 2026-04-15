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
  /works? again|behaves? normally|returned to normal|fixed|resolved|disappeared|went away|stops? (?:happening|flickering|crashing)|regains? control|starts? working/i;
const FALSIFICATION_SIGNAL_PATTERN =
  /nothing changed|no change|same issue|same behavior|still broken the same|did not help|doesn't help|no effect|unchanged|still happens exactly the same/i;
const PARTIAL_SIGNAL_PATTERN =
  /\bbut\b|partially|reduced|less severe|less often|smaller|improved?.*\bstill\b|fixed.*\bbut\b|stops?.*\bbut\b/i;

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

function classifyFollowUpResult(params: {
  originalResult: FreeAnalysisResponse;
  nextResult: FreeAnalysisResponse;
  observation: string;
}): FollowUpVerificationState {
  const observation = params.observation.trim();
  const originalSummary = `${params.originalResult.what_happened} ${params.originalResult.what_to_do_next[0] ?? ""}`;
  const nextSummary = `${params.nextResult.what_happened} ${params.nextResult.what_to_do_next[0] ?? ""}`;
  const alternativeObservationText = observation.split(/\bbut\b/i)[1] ?? "";

  const originalTerms = extractComparableTerms(originalSummary);
  const nextTerms = extractComparableTerms(nextSummary);
  const alternativeTerms = extractComparableTerms(alternativeObservationText);
  const similarity = calculateSimilarity(originalTerms, nextTerms);
  const sharedTerms = [...originalTerms].filter((term) => nextTerms.has(term)).length;
  const alternativeAligned = [...alternativeTerms].some((term) => nextTerms.has(term) && !originalTerms.has(term));

  const hasConfirmationSignal = CONFIRMATION_SIGNAL_PATTERN.test(observation);
  const hasFalsificationSignal = FALSIFICATION_SIGNAL_PATTERN.test(observation);
  const hasPartialSignal = PARTIAL_SIGNAL_PATTERN.test(observation);

  const sameGroundedCause = sharedTerms >= 3 || similarity >= 0.3;
  const shiftedGroundedCause = sharedTerms === 0 && similarity <= 0.12;

  if (hasFalsificationSignal && (shiftedGroundedCause || alternativeAligned)) {
    return "falsified";
  }

  if (hasPartialSignal) {
    return "inconclusive";
  }

  if (hasConfirmationSignal && sameGroundedCause) {
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

export function AnalysisResult({
  result,
  input,
  isRefined = false,
  lastObservation,
  verificationState,
  onResultChange,
}: AnalysisResultProps) {
  const [confirmFirstStep, ...followUpSteps] = result.what_to_do_next;
  const showLowEvidenceCue = shouldShowLowEvidenceCue(result);
  const [observation, setObservation] = useState("");
  const [lastSubmittedObservation, setLastSubmittedObservation] = useState<string | null>(null);
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

      onResultChange?.(payload);
      onResultChange?.({
        result: payload,
        observation: submittedObservation,
        verificationState: classifyFollowUpResult({
          originalResult: result,
          nextResult: payload,
          observation: submittedObservation,
        }),
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
        {confirmFirstStep ? (
          <div className="mt-4 rounded-[1.25rem] border border-ocean/15 bg-ocean/5 p-4">
            <p className="section-label">Confirm first</p>
            <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">1. {confirmFirstStep}</p>
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