"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import type { AnalysisInput, FreeAnalysisResponse } from "@/lib/aie/types";

const STORAGE_KEY = "aie-free-analysis-result";

export type FollowUpVerificationState = "confirmed" | "falsified" | "inconclusive";

export type StoredAnalysisState = {
  input?: AnalysisInput;
  result: FreeAnalysisResponse;
  refinedFromObservation?: boolean;
  lastObservation?: string;
  verificationState?: FollowUpVerificationState;
};

const initialForm: AnalysisInput = {
  problemDescription: "",
  codeSnippet: "",
  errorMessage: "",
  context: "",
};

export function AnalysisForm() {
  const router = useRouter();
  const [form, setForm] = useState<AnalysisInput>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const descriptionLength = useMemo(() => form.problemDescription.trim().length, [form.problemDescription]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (descriptionLength < 24) {
      setErrorMessage("Please describe the Unity issue in a little more detail.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const payload = (await response.json()) as FreeAnalysisResponse | { error?: string };

      if (!response.ok) {
        setErrorMessage(payload && "error" in payload ? payload.error || "We couldn't generate an analysis right now. Please try again." : "We couldn't generate an analysis right now. Please try again.");
        return;
      }

      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          input: form,
          result: payload,
          refinedFromObservation: false,
          lastObservation: undefined,
          verificationState: undefined,
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