"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AnalysisResult } from "@/components/AnalysisResult";
import { normalizeStoredAnalysisState, resultStorageKey, type StoredAnalysisState } from "@/components/AnalysisForm";
import { advanceExecutionSession } from "@/lib/aie/executionSession";
import {
  advanceExecutionSelfDirection,
  advanceExecutionOrchestration,
  createExecutionOrchestrationState,
  deriveNextExecutionOrchestrationPhase,
  recordExecutorOutcome,
  recordPlannerHandoff,
} from "@/lib/aie/orchestrationSession";
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
          goal={storedState.input?.goal}
          currentStepIndex={storedState.input?.stepIndex}
          previousOutcome={storedState.previousOutcome}
          sessionHistory={storedState.sessionHistory}
          orchestrationState={storedState.orchestrationState}
          onResultChange={({ result: nextResult, observation, verificationState, attemptedStep, loopTerminationStatus, actionChainState, confidenceLevel, suggestedNextAction, nextSuggestedStep }) => {
            setStoredState((current) => {
              if (!current) {
                return current;
              }

              const nextSession = advanceExecutionSession({
                currentStepIndex: current.input?.stepIndex ?? 1,
                attemptedStep,
                actionResult: observation,
                verificationState,
                diagnosis: nextResult.what_happened,
                loopTerminationStatus: loopTerminationStatus ?? null,
                steps: current.sessionHistory,
              });
              const currentOrchestration = current.orchestrationState ?? createExecutionOrchestrationState({ goal: current.input?.goal ?? "Resolve the current issue." });
              const pauseForLowConfidence = suggestedNextAction === "restart-fresh" && confidenceLevel === "low";
              const statusOverride = pauseForLowConfidence ? "active" : undefined;
              const nextPlannerAction = nextSuggestedStep ?? nextResult.proposedAction ?? nextResult.what_to_do_next[0] ?? "";
              const nextSafeAction = suggestedNextAction === "continue-thread" || pauseForLowConfidence ? nextPlannerAction : "";
              const executorStepNumber = Math.max(1, current.input?.stepIndex ?? 1);
              const executorUpdated = recordExecutorOutcome({
                state: currentOrchestration,
                stepNumber: executorStepNumber,
                executedAction: attemptedStep ?? current.result.proposedAction ?? current.result.what_to_do_next[0],
                actionResult: observation,
                validationResult: verificationState,
                executionNotes: nextResult.what_happened,
              });
              const nextOrchestration = advanceExecutionOrchestration({
                state: executorUpdated.state,
                phase: executorUpdated.state.currentPhase,
                proposedAction: current.result.proposedAction ?? current.result.what_to_do_next[0],
                executedAction: attemptedStep ?? current.result.proposedAction ?? current.result.what_to_do_next[0],
                actionResult: observation,
                verificationState,
                diagnosis: nextResult.what_happened,
                loopTerminationStatus: loopTerminationStatus ?? null,
                nextSafeAction,
                statusOverride,
                nextPhase: deriveNextExecutionOrchestrationPhase({
                  currentPhase: currentOrchestration.currentPhase,
                  verificationState,
                  loopTerminationStatus: loopTerminationStatus ?? null,
                  nextSafeAction,
                  statusOverride,
                }),
              });
              const preliminaryPlannerDecision =
                pauseForLowConfidence
                  ? "continue"
                  : nextOrchestration.state.currentStatus === "complete" || suggestedNextAction === "stop"
                    ? "complete"
                    : nextOrchestration.state.currentStatus === "blocked" || !nextSafeAction
                      ? "block"
                      : verificationState === "falsified"
                        ? "reroute"
                        : "continue";
              const nextSelfDirectionState = advanceExecutionSelfDirection({
                state: nextOrchestration.state.selfDirectionState,
                verificationState,
                loopTerminationStatus: loopTerminationStatus ?? null,
                plannerDecision: preliminaryPlannerDecision,
                nextProposedAction: nextPlannerAction,
                nextExpectedOutcome: nextResult.expectedOutcome ?? nextResult.what_matters[0] ?? "",
                confidenceLevel,
                selectionReason:
                  preliminaryPlannerDecision === "continue"
                    ? "The latest executor result still supports continuing the bounded top-level goal, so AI-E selected the next queued subgoal."
                    : preliminaryPlannerDecision === "reroute"
                      ? "The latest executor result falsified the current subgoal, so AI-E inserted a bounded recovery subgoal."
                      : preliminaryPlannerDecision === "complete"
                        ? "The latest executor result satisfied the approved top-level goal, so AI-E stopped the self-directed run."
                        : "The latest executor result leaves no safe next subgoal inside the bounded scope."
                ,
                rerouteReason: verificationState === "falsified" ? nextResult.what_happened : undefined,
                stopReason: suggestedNextAction === "stop" ? nextResult.what_happened : undefined,
                blockReason: preliminaryPlannerDecision === "block" ? nextResult.what_happened : undefined,
                pauseReason: pauseForLowConfidence
                  ? "Confidence fell too low to continue the self-directed run without widening risk, so the planner paused the queue."
                  : undefined,
              });
              const orchestrationWithSelfDirection = {
                ...nextOrchestration.state,
                selfDirectionState: nextSelfDirectionState,
              };
              const plannerDecision =
                nextSelfDirectionState.selfDirectionStatus === "complete"
                  ? "complete"
                  : nextSelfDirectionState.selfDirectionStatus === "blocked" || nextSelfDirectionState.selfDirectionStatus === "aborted"
                    ? "block"
                    : preliminaryPlannerDecision;
              const finalOrchestration = recordPlannerHandoff({
                state: orchestrationWithSelfDirection,
                stepNumber:
                  plannerDecision === "continue" || plannerDecision === "reroute"
                    ? nextSession.nextStepIndex
                    : executorStepNumber,
                diagnosis: nextResult.what_happened,
                proposedAction: nextSafeAction || nextPlannerAction,
                expectedOutcome: nextResult.expectedOutcome ?? nextResult.what_matters[0] ?? "",
                plannerDecision,
                handoffTo: plannerDecision === "continue" || plannerDecision === "reroute" ? "executor" : null,
              });

              const nextState = {
                ...current,
                input: current.input
                  ? {
                      ...current.input,
                      actionResult: observation,
                      stepIndex: nextSession.nextStepIndex,
                    }
                  : current.input,
                result: nextResult,
                refinedFromObservation: true,
                lastObservation: observation,
                previousOutcome: nextSession.previousOutcome,
                verificationState,
                lastAttemptedStep: attemptedStep,
                loopTerminationStatus: loopTerminationStatus ?? undefined,
                actionChainState,
                sessionHistory: nextSession.steps,
                orchestrationState: finalOrchestration.state,
              } satisfies StoredAnalysisState;

              window.sessionStorage.setItem(resultStorageKey, JSON.stringify(nextState));
              return nextState;
            });
          }}
        />
        <div className="space-y-6">
          {storedState.input?.goal || storedState.input?.stepIndex || storedState.previousOutcome ? (
            <div className="glass-card rounded-[1.75rem] p-6 shadow-float">
              <p className="section-label">Execution snapshot</p>
              <div className="mt-4 grid gap-3">
                <div className="rounded-[1rem] border border-ink/10 bg-white/55 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Top-level goal</p>
                  <p className="mt-2 text-sm leading-7 text-ink/90">{storedState.input?.goal ?? "No explicit goal recorded."}</p>
                </div>
                <div className="rounded-[1rem] border border-ink/10 bg-white/55 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Current subgoal</p>
                  <p className="mt-2 text-sm leading-7 text-ink/90">{storedState.orchestrationState?.selfDirectionState.currentSubgoal?.title ?? "No active subgoal right now."}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1rem] border border-ink/10 bg-white/55 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Owner</p>
                    <p className="mt-2 text-sm font-semibold leading-7 text-ink/90">{storedState.orchestrationState?.currentAgent ?? "Single analysis thread"}</p>
                    {storedState.orchestrationState?.currentPhase ? (
                      <p className="mt-1 text-xs leading-6 body-muted">Phase: {storedState.orchestrationState.currentPhase}</p>
                    ) : null}
                  </div>
                  <div className="rounded-[1rem] border border-ink/10 bg-white/55 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Status</p>
                    <p className="mt-2 text-sm font-semibold leading-7 text-ink/90">{storedState.orchestrationState?.selfDirectionState.selfDirectionStatus ?? storedState.orchestrationState?.currentStatus ?? "Active"}</p>
                    {storedState.input?.stepIndex ? (
                      <p className="mt-1 text-xs leading-6 body-muted">Current step: {storedState.input.stepIndex}</p>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-[1rem] border border-ocean/15 bg-ocean/5 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Next bounded action</p>
                  <p className="mt-2 text-sm leading-7 text-ink/90">
                    {storedState.orchestrationState?.plannerState.proposedAction ??
                      storedState.orchestrationState?.executorState.pendingAction ??
                      storedState.result.proposedAction ??
                      storedState.result.what_to_do_next[0] ??
                      "No next bounded action recorded."}
                  </p>
                </div>
                <details className="rounded-[1rem] border border-ink/10 bg-white/45 p-4 text-xs leading-6 body-muted">
                  <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">Session details</summary>
                  <div className="mt-3 grid gap-2">
                    {storedState.previousOutcome ? (
                      <p>
                        <span className="font-semibold text-ink">Previous outcome:</span> {storedState.previousOutcome}
                      </p>
                    ) : null}
                    {storedState.orchestrationState ? (
                      <>
                        <p>
                          <span className="font-semibold text-ink">Completed / blocked:</span> {storedState.orchestrationState.completedSteps.length} / {storedState.orchestrationState.blockedSteps.length}
                        </p>
                        {storedState.orchestrationState.selfDirectionState.subgoalQueue.length > 0 ? (
                          <p>
                            <span className="font-semibold text-ink">Queued subgoals:</span> {storedState.orchestrationState.selfDirectionState.subgoalQueue.map((subgoal) => subgoal.title).join(" | ")}
                          </p>
                        ) : null}
                        {storedState.orchestrationState.lastHandoff ? (
                          <p>
                            <span className="font-semibold text-ink">Last handoff:</span> {storedState.orchestrationState.lastHandoff.handoffFrom ?? "none"} -&gt; {storedState.orchestrationState.lastHandoff.handoffTo ?? "none"} ({storedState.orchestrationState.lastHandoff.payloadSummary})
                          </p>
                        ) : null}
                        {storedState.orchestrationState.selfDirectionState.lastSelectionReason ? (
                          <p>
                            <span className="font-semibold text-ink">Selection reason:</span> {storedState.orchestrationState.selfDirectionState.lastSelectionReason}
                          </p>
                        ) : null}
                        {storedState.orchestrationState.selfDirectionState.lastPauseReason ? (
                          <p>
                            <span className="font-semibold text-ink">Pause reason:</span> {storedState.orchestrationState.selfDirectionState.lastPauseReason}
                          </p>
                        ) : null}
                        {storedState.orchestrationState.selfDirectionState.lastBlockReason ? (
                          <p>
                            <span className="font-semibold text-ink">Block reason:</span> {storedState.orchestrationState.selfDirectionState.lastBlockReason}
                          </p>
                        ) : null}
                        {storedState.orchestrationState.selfDirectionState.lastStopReason ? (
                          <p>
                            <span className="font-semibold text-ink">Stop reason:</span> {storedState.orchestrationState.selfDirectionState.lastStopReason}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </details>
              </div>
            </div>
          ) : null}
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