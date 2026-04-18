"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AnalysisResult } from "@/components/AnalysisResult";
import { normalizeStoredAnalysisState, resultStorageKey, type StoredAnalysisState } from "@/components/AnalysisForm";
import { UpgradeCard } from "@/components/UpgradeCard";

export default function ResultPage() {
  const [storedState, setStoredState] = useState<StoredAnalysisState | null>(null);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(resultStorageKey);
    if (!raw) {
      return;
    }

    try {
      const nextState = normalizeStoredAnalysisState(JSON.parse(raw));
      if (!nextState) {
        window.sessionStorage.removeItem(resultStorageKey);
        return;
      }

      setStoredState(nextState);
    } catch {
      window.sessionStorage.removeItem(resultStorageKey);
    }
  }, []);

  if (!storedState) {
    return (
      <main className="page-shell mx-auto max-w-4xl px-6 py-12 lg:px-10">
        <div className="glass-card rounded-[2rem] p-8 shadow-float">
          <p className="section-label">No result yet</p>
          <h1 className="headline mt-4 text-3xl font-semibold">Run the free analysis first.</h1>
          <p className="mt-3 text-sm leading-7 body-muted">
            AI-E stores the latest free analysis in your current browser session. Start from the analyze page to generate a new result.
          </p>
          <div className="mt-6 flex gap-3">
            <Link href="/analyze?mode=fresh" className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">
              Go to analyze
            </Link>
            <Link href="/" className="rounded-full border border-ink/10 px-5 py-3 text-sm font-semibold text-ink">
              Back home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell mx-auto max-w-6xl px-6 py-8 lg:px-10 lg:py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="section-label">Free analysis result</p>
          <h1 className="headline mt-2 text-4xl font-semibold">A structured first pass on your Unity issue.</h1>
        </div>
        <div className="flex gap-3">
          <Link href="/analyze?mode=continue" className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">
            Continue this debugging flow
          </Link>
          <Link href="/analyze?mode=fresh" className="rounded-full border border-ink/10 px-5 py-3 text-sm font-semibold text-ink">
            Analyze another issue
          </Link>
          <Link href="/upgrade" className="rounded-full bg-coral px-5 py-3 text-sm font-semibold text-white">
            See premium path
          </Link>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <AnalysisResult
          result={storedState.result}
          input={storedState.input}
          isRefined={Boolean(storedState.refinedFromObservation)}
          lastObservation={storedState.lastObservation}
          verificationState={storedState.verificationState}
          actionChainState={storedState.actionChainState}
          onResultChange={({ result: nextResult, observation, verificationState, attemptedStep, loopTerminationStatus, actionChainState }) => {
            setStoredState((current) => {
              if (!current) {
                return current;
              }

              const nextState = {
                ...current,
                input: current.input
                  ? {
                      ...current.input,
                      actionResult: observation,
                    }
                  : current.input,
                result: nextResult,
                refinedFromObservation: true,
                lastObservation: observation,
                verificationState,
                lastAttemptedStep: attemptedStep,
                loopTerminationStatus: loopTerminationStatus ?? undefined,
                actionChainState,
              } satisfies StoredAnalysisState;

              window.sessionStorage.setItem(resultStorageKey, JSON.stringify(nextState));
              return nextState;
            });
          }}
        />
        <div className="space-y-6">
          <div className="glass-card rounded-[1.75rem] p-6 shadow-float">
            <p className="section-label">Upgrade hint</p>
            <p className="mt-3 text-sm leading-7 text-ink/90">{storedState.result.upgrade_hint}</p>
          </div>
          <UpgradeCard compact />
        </div>
      </div>
    </main>
  );
}