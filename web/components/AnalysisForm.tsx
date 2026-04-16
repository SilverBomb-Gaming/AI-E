"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import type { AnalysisInput, FreeAnalysisResponse } from "@/lib/aie/types";

const STORAGE_KEY = "aie-free-analysis-result";

export type FollowUpVerificationState = "confirmed" | "falsified" | "inconclusive";
export type StoredLoopTerminationStatus = "resolved" | "converging" | "stuck";

export type StoredAnalysisState = {
  input?: AnalysisInput;
  result: FreeAnalysisResponse;
  refinedFromObservation?: boolean;
  lastObservation?: string;
  verificationState?: FollowUpVerificationState;
  lastAttemptedStep?: string;
  loopTerminationStatus?: StoredLoopTerminationStatus;
};

export type ContinuationThreadSnapshot = {
  diagnosis: string;
  lastAttemptedStep?: string;
  lastClassification?: "Resolved" | "Converging" | "Stuck";
};

const initialForm: AnalysisInput = {
  problemDescription: "",
  codeSnippet: "",
  errorMessage: "",
  context: "",
};

export function isFreeAnalysisResponse(value: unknown): value is FreeAnalysisResponse {
  const source = value as Record<string, unknown>;

  return (
    typeof source?.what_happened === "string" &&
    Array.isArray(source?.what_matters) &&
    Array.isArray(source?.what_to_do_next) &&
    typeof source?.upgrade_hint === "string"
  );
}

export function normalizeAnalysisInput(value: unknown): AnalysisInput | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const problemDescription = String(source.problemDescription ?? "").trim();
  if (!problemDescription) {
    return undefined;
  }

  return {
    problemDescription,
    codeSnippet: String(source.codeSnippet ?? "").trim(),
    errorMessage: String(source.errorMessage ?? "").trim(),
    context: String(source.context ?? "").trim(),
  };
}

export function normalizeStoredAnalysisState(value: unknown): StoredAnalysisState | null {
  if (isFreeAnalysisResponse(value)) {
    return {
      result: value,
      refinedFromObservation: false,
    };
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  if (!isFreeAnalysisResponse(source.result)) {
    return null;
  }

  return {
    input: normalizeAnalysisInput(source.input),
    result: source.result,
    refinedFromObservation: Boolean(source.refinedFromObservation),
    lastObservation: typeof source.lastObservation === "string" ? source.lastObservation.trim() || undefined : undefined,
    verificationState:
      source.verificationState === "confirmed" || source.verificationState === "falsified" || source.verificationState === "inconclusive"
        ? (source.verificationState as FollowUpVerificationState)
        : undefined,
    lastAttemptedStep: typeof source.lastAttemptedStep === "string" ? source.lastAttemptedStep.trim() || undefined : undefined,
    loopTerminationStatus:
      source.loopTerminationStatus === "resolved" || source.loopTerminationStatus === "converging" || source.loopTerminationStatus === "stuck"
        ? (source.loopTerminationStatus as StoredLoopTerminationStatus)
        : undefined,
  };
}

function getLoopTerminationLabel(status: StoredLoopTerminationStatus | undefined): ContinuationThreadSnapshot["lastClassification"] | undefined {
  switch (status) {
    case "resolved":
      return "Resolved";
    case "converging":
      return "Converging";
    case "stuck":
      return "Stuck";
    default:
      return undefined;
  }
}

export function getContinuationThreadSnapshot(state: StoredAnalysisState | null | undefined): ContinuationThreadSnapshot | null {
  const diagnosis = state?.result.what_happened?.trim();
  if (!diagnosis) {
    return null;
  }

  return {
    diagnosis,
    lastAttemptedStep: state?.lastAttemptedStep,
    lastClassification: getLoopTerminationLabel(state?.loopTerminationStatus),
  };
}

export function buildContinuationContextBlock(snapshot: ContinuationThreadSnapshot): string {
  const lines = [
    "Continuation context from the previous AI-E debugging turn:",
    `- Last diagnosis: ${snapshot.diagnosis}`,
  ];

  if (snapshot.lastAttemptedStep) {
    lines.push(`- Last step attempted: ${snapshot.lastAttemptedStep}`);
  }

  if (snapshot.lastClassification) {
    lines.push(`- Last classification: ${snapshot.lastClassification}`);
  }

  lines.push("Use this as the starting context for the new analysis instead of restarting from a fresh first pass.");
  return lines.join("\n");
}

export function AnalysisForm() {
  const router = useRouter();
  const [form, setForm] = useState<AnalysisInput>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [storedState, setStoredState] = useState<StoredAnalysisState | null>(null);
  const [includeContinuationContext, setIncludeContinuationContext] = useState(true);

  const descriptionLength = useMemo(() => form.problemDescription.trim().length, [form.problemDescription]);
  const continuationSnapshot = useMemo(() => getContinuationThreadSnapshot(storedState), [storedState]);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      setStoredState(normalizeStoredAnalysisState(JSON.parse(raw)));
    } catch {
      setStoredState(null);
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (descriptionLength < 24) {
      setErrorMessage("Please describe the Unity issue in a little more detail.");
      return;
    }

    setIsSubmitting(true);

    const submittedInput = {
      ...form,
      context: [
        form.context.trim(),
        includeContinuationContext && continuationSnapshot ? buildContinuationContextBlock(continuationSnapshot) : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    } satisfies AnalysisInput;

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(submittedInput),
      });

      const payload = (await response.json()) as FreeAnalysisResponse | { error?: string };

      if (!response.ok) {
        setErrorMessage(payload && "error" in payload ? payload.error || "We couldn't generate an analysis right now. Please try again." : "We couldn't generate an analysis right now. Please try again.");
        return;
      }

      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          input: submittedInput,
          result: payload,
          refinedFromObservation: false,
          lastObservation: undefined,
          verificationState: undefined,
          lastAttemptedStep: undefined,
          loopTerminationStatus: undefined,
        } satisfies StoredAnalysisState),
      );
      router.push("/result");
    } catch {
      setErrorMessage("We couldn't generate an analysis right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="glass-card rounded-[2rem] p-6 shadow-float sm:p-8">
      <div className="grid gap-6">
        <div>
          <p className="section-label">Free analysis</p>
          <h2 className="headline mt-3 text-3xl font-semibold">Drop in the issue and get a structured read.</h2>
          <p className="mt-3 text-sm leading-7 body-muted">
            Keep it simple. Describe the problem, add the error or snippet if it helps, and AI-E will return a productized first-pass analysis.
          </p>
        </div>

        {continuationSnapshot ? (
          <div className="rounded-[1.5rem] border border-ocean/15 bg-ocean/5 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="section-label">Session threading</p>
                <p className="mt-2 text-sm leading-7 text-ink/90">
                  Continue from the last debugging result by passing the previous diagnosis, most recent attempted step, and last status into this new turn.
                </p>
              </div>
              <label className="flex items-center gap-3 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={includeContinuationContext}
                  onChange={(event) => setIncludeContinuationContext(event.target.checked)}
                  className="h-4 w-4 rounded border border-ink/20 text-ocean focus:ring-ocean/30"
                />
                Continue previous debugging flow
              </label>
            </div>
            <div className="mt-4 grid gap-2 text-xs leading-6 body-muted sm:text-sm">
              <p>
                <span className="font-semibold text-ink">Last diagnosis:</span> {continuationSnapshot.diagnosis}
              </p>
              {continuationSnapshot.lastAttemptedStep ? (
                <p>
                  <span className="font-semibold text-ink">Last step attempted:</span> {continuationSnapshot.lastAttemptedStep}
                </p>
              ) : null}
              {continuationSnapshot.lastClassification ? (
                <p>
                  <span className="font-semibold text-ink">Last classification:</span> {continuationSnapshot.lastClassification}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <label className="grid gap-2 text-sm font-medium text-ink">
          Problem description
          <textarea
            required
            rows={6}
            value={form.problemDescription}
            onChange={(event) => setForm((current) => ({ ...current, problemDescription: event.target.value }))}
            placeholder="Example: My Unity scene throws a NullReferenceException after loading a prefab and the player controller stops responding."
            className="min-h-[180px] rounded-[1.5rem] border border-ink/10 bg-white/80 px-5 py-4 text-sm text-ink outline-none transition placeholder:text-slate focus:border-coral focus:ring-2 focus:ring-coral/20"
          />
          <span className="text-xs body-muted">Aim for one or two sentences with the failure, where it happens, and what changed.</span>
        </label>

        <div className="grid gap-5 lg:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-ink">
            Optional code snippet
            <textarea
              rows={5}
              value={form.codeSnippet}
              onChange={(event) => setForm((current) => ({ ...current, codeSnippet: event.target.value }))}
              placeholder="Paste the key script fragment if the issue is code-level."
              className="rounded-[1.5rem] border border-ink/10 bg-white/80 px-5 py-4 text-sm text-ink outline-none transition placeholder:text-slate focus:border-coral focus:ring-2 focus:ring-coral/20"
            />
          </label>

          <div className="grid gap-5">
            <label className="grid gap-2 text-sm font-medium text-ink">
              Optional error message
              <textarea
                rows={2}
                value={form.errorMessage}
                onChange={(event) => setForm((current) => ({ ...current, errorMessage: event.target.value }))}
                placeholder="Paste the console error or warning if you have it."
                className="rounded-[1.5rem] border border-ink/10 bg-white/80 px-5 py-4 text-sm text-ink outline-none transition placeholder:text-slate focus:border-coral focus:ring-2 focus:ring-coral/20"
              />
            </label>

            <label className="grid gap-2 text-sm font-medium text-ink">
              Optional context
              <textarea
                rows={2}
                value={form.context}
                onChange={(event) => setForm((current) => ({ ...current, context: event.target.value }))}
                placeholder="Scene setup, Unity version, package info, or what you already tried."
                className="rounded-[1.5rem] border border-ink/10 bg-white/80 px-5 py-4 text-sm text-ink outline-none transition placeholder:text-slate focus:border-coral focus:ring-2 focus:ring-coral/20"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-[1.5rem] bg-white/70 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-ink">Free includes one structured analysis.</p>
            <p className="mt-1 text-xs body-muted">Premium later adds deeper workflow guidance, richer follow-up, and saved results.</p>
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Analyzing..." : "Get free analysis"}
          </button>
        </div>

        {errorMessage ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm text-ember">{errorMessage}</p> : null}
      </div>
    </form>
  );
}

export const resultStorageKey = STORAGE_KEY;