"use client";

import { useMemo, useState } from "react";

import {
  MAX_GUIDED_STEPS,
  buildFalsifiedDiagnosis,
  buildFollowUpProblemDescription,
  buildGuidedStepStack,
  buildNextStepGuidance,
  classifyFollowUpResult,
  classifyLoopTerminationStatus,
  deriveAnalysisResultSignals,
} from "./analysisResultLogic";
import type {
  ConfidenceAlignment,
  ConfidenceLevel,
  DecisionCommitment,
  DebuggingMode,
  EscalationStrategy,
  LoopTerminationStatus,
  SuggestedNextAction,
} from "./analysisResultLogic";
import type { FollowUpVerificationState, StoredActionChainState, StoredLoopTerminationStatus } from "@/components/AnalysisForm";
import { buildExecutionSessionContextBlock, type ExecutionSessionStep } from "@/lib/aie/executionSession";
import { buildExecutionOrchestrationContextBlock, type ExecutionOrchestrationState } from "@/lib/aie/orchestrationSession";
import type { AnalysisInput, FreeAnalysisResponse } from "@/lib/aie/types";

// Rendering decisions must come from analysisResultLogic.ts.
// Keep this component presentation-focused and do not reintroduce inline decision helpers here.

type AnalysisResultProps = {
  result: FreeAnalysisResponse;
  input?: AnalysisInput;
  isRefined?: boolean;
  lastObservation?: string;
  verificationState?: FollowUpVerificationState;
  actionChainState?: StoredActionChainState;
  goal?: string;
  currentStepIndex?: number;
  previousOutcome?: string;
  sessionHistory?: ExecutionSessionStep[];
  orchestrationState?: ExecutionOrchestrationState;
  onResultChange?: (update: {
    result: FreeAnalysisResponse;
    observation: string;
    verificationState: FollowUpVerificationState;
    attemptedStep?: string;
    loopTerminationStatus: StoredLoopTerminationStatus | null;
    actionChainState?: StoredActionChainState;
    confidenceLevel: ConfidenceLevel;
    suggestedNextAction: SuggestedNextAction;
    nextSuggestedStep?: string;
  }) => void;
};

function isFreeAnalysisResponse(value: unknown): value is FreeAnalysisResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const source = value as Record<string, unknown>;

  return (
    typeof source.what_happened === "string" &&
    Array.isArray(source.what_matters) &&
    Array.isArray(source.what_to_do_next) &&
    typeof source.upgrade_hint === "string"
  );
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

function getConfidenceAlignmentLabel(confidenceAlignment: ConfidenceAlignment | null): string | null {
  switch (confidenceAlignment) {
    case "increasing":
      return "Confidence rising";
    case "decreasing":
      return "Confidence falling";
    case "unstable":
      return "Confidence unstable";
    default:
      return null;
  }
}

function getConfidenceAlignmentClassName(confidenceAlignment: ConfidenceAlignment | null): string {
  switch (confidenceAlignment) {
    case "increasing":
      return "border-emerald-200/80 bg-emerald-50/80 text-emerald-700/90";
    case "decreasing":
      return "border-coral/20 bg-coral/10 text-ember";
    case "unstable":
    default:
      return "border-ink/10 bg-white/60 text-ink/65";
  }
}

function getDecisionCommitmentLabel(decisionCommitment: DecisionCommitment): string | null {
  switch (decisionCommitment) {
    case "committed":
      return "High confidence - confirm cause";
    case "pending":
      return "Confirming evidence still needed";
    default:
      return null;
  }
}

function getDecisionCommitmentClassName(decisionCommitment: DecisionCommitment): string {
  switch (decisionCommitment) {
    case "committed":
      return "border-emerald-200/80 bg-emerald-50/80 text-emerald-700/90";
    case "pending":
      return "border-amber-200/80 bg-amber-50/80 text-amber-700/90";
    default:
      return "border-ink/10 bg-white/60 text-ink/65";
  }
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

function getActionTypeLabel(actionType: FreeAnalysisResponse["actionType"]): string | null {
  switch (actionType) {
    case "inspection":
      return "Inspection";
    case "instrumentation":
      return "Instrumentation";
    case "code-change":
      return "Code change";
    case "tuning-pass":
      return "Tuning pass";
    case "design-iteration":
      return "Design iteration";
    case "validation-check":
      return "Validation check";
    default:
      return null;
  }
}

type VisibleExecutionStatus = "active" | "paused" | "blocked" | "complete" | "aborted";

function getVisibleExecutionStatus(orchestrationState: ExecutionOrchestrationState | undefined): VisibleExecutionStatus | null {
  if (!orchestrationState) {
    return null;
  }

  const selfDirectionStatus = orchestrationState.selfDirectionState.selfDirectionStatus;
  if (selfDirectionStatus === "paused") {
    return "paused";
  }
  if (selfDirectionStatus === "blocked" || orchestrationState.currentStatus === "blocked") {
    return "blocked";
  }
  if (selfDirectionStatus === "complete" || orchestrationState.currentStatus === "complete") {
    return "complete";
  }
  if (selfDirectionStatus === "aborted" || orchestrationState.currentStatus === "aborted") {
    return "aborted";
  }

  return "active";
}

function getVisibleExecutionStatusLabel(status: VisibleExecutionStatus | null): string | null {
  switch (status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "blocked":
      return "Blocked";
    case "complete":
      return "Complete";
    case "aborted":
      return "Aborted";
    default:
      return null;
  }
}

function getVisibleExecutionStatusClassName(status: VisibleExecutionStatus | null): string {
  switch (status) {
    case "active":
      return "border-ocean/20 bg-ocean/10 text-ocean";
    case "paused":
      return "border-amber-200/80 bg-amber-50/80 text-amber-700/90";
    case "blocked":
      return "border-coral/20 bg-coral/10 text-ember";
    case "complete":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "aborted":
      return "border-ink/10 bg-white/70 text-ink/70";
    default:
      return "border-ink/10 bg-white/70 text-ink/70";
  }
}

function getVisibleExecutionStatusHint(orchestrationState: ExecutionOrchestrationState | undefined): string | null {
  if (!orchestrationState) {
    return null;
  }

  const status = getVisibleExecutionStatus(orchestrationState);
  switch (status) {
    case "paused":
      return orchestrationState.selfDirectionState.lastPauseReason || "The planner is holding execution before the next bounded step can proceed.";
    case "blocked":
      return orchestrationState.selfDirectionState.lastBlockReason || "No safe bounded next step is available in the current scope.";
    case "complete":
      return orchestrationState.selfDirectionState.lastStopReason || "The approved goal is complete and no further bounded action is required.";
    case "aborted":
      return orchestrationState.selfDirectionState.lastStopReason || "The bounded run stopped before completion.";
    case "active":
    default:
      return orchestrationState.currentAgent === "executor"
        ? "The executor owns the current step and can act on the approved bounded action."
        : "The planner owns the current step and is deciding or rerouting the next bounded move.";
  }
}

function getCurrentOwnerLabel(orchestrationState: ExecutionOrchestrationState | undefined): string | null {
  if (!orchestrationState) {
    return null;
  }

  return orchestrationState.currentAgent === "executor" ? "Executor acting" : "Planner deciding";
}

function getCurrentOwnerHint(orchestrationState: ExecutionOrchestrationState | undefined): string | null {
  if (!orchestrationState) {
    return null;
  }

  const visibleStatus = getVisibleExecutionStatus(orchestrationState);
  if (orchestrationState.currentAgent === "executor") {
    return "The executor is holding the current bounded action.";
  }

  if (visibleStatus === "paused") {
    return "The planner is holding execution until approval or a stop condition is cleared.";
  }

  if (visibleStatus === "blocked" || visibleStatus === "complete" || visibleStatus === "aborted") {
    return "The planner owns the thread outcome and no executor step is running now.";
  }

  return "The planner owns the next handoff and chooses the next bounded move.";
}

function getNextBoundedActionSummary(params: {
  result: FreeAnalysisResponse;
  currentGuidedStep: string | null;
  nextStepGuidance: string | null;
  suggestedNextAction: SuggestedNextAction;
  orchestrationState?: ExecutionOrchestrationState;
}): string | null {
  const orchestrationState = params.orchestrationState;
  if (orchestrationState) {
    const visibleStatus = getVisibleExecutionStatus(orchestrationState);
    if (visibleStatus === "complete") {
      return "No further bounded action is required.";
    }
    if (visibleStatus === "blocked") {
      return orchestrationState.selfDirectionState.lastBlockReason || orchestrationState.plannerState.proposedAction || null;
    }
    if (visibleStatus === "paused") {
      return orchestrationState.plannerState.proposedAction || orchestrationState.executorState.pendingAction || params.result.proposedAction || null;
    }

    return orchestrationState.currentAgent === "executor"
      ? orchestrationState.executorState.pendingAction || orchestrationState.plannerState.proposedAction || params.result.proposedAction || params.currentGuidedStep
      : orchestrationState.plannerState.proposedAction || params.nextStepGuidance || params.result.proposedAction || params.currentGuidedStep;
  }

  if (params.suggestedNextAction === "stop") {
    return "No further bounded action is required.";
  }

  return params.result.proposedAction || params.currentGuidedStep || params.nextStepGuidance;
}

export function AnalysisResult({
  result,
  input,
  isRefined = false,
  lastObservation,
  verificationState,
  actionChainState,
  goal,
  currentStepIndex,
  previousOutcome,
  sessionHistory,
  orchestrationState,
  onResultChange,
}: AnalysisResultProps) {
  const [, ...initialFollowUpSteps] = result.what_to_do_next;
  const {
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
    confidenceAlignment,
    decisionCommitment,
    alignedSignalCount,
    suggestedNextAction,
    recommendedDebuggingMode,
    supervisedActionChain,
    supervisedActionChainActiveStepIndex,
    supervisedActionChainStepIndicator,
    currentSupervisedActionChainStep,
    isGuidedLoopActive,
  } = deriveAnalysisResultSignals({
    result,
    problemDescription: input?.problemDescription,
    isRefined,
    lastObservation,
    verificationState,
    previousActionChainState: actionChainState,
  });
  const [observation, setObservation] = useState("");
  const [isSubmittingFollowUp, setIsSubmittingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const trimmedObservation = useMemo(() => observation.trim(), [observation]);
  const nextStepIndex = Math.max(1, (currentStepIndex ?? input?.stepIndex ?? 1) + 1);
  const selfDirectionState = orchestrationState?.selfDirectionState;
  const visibleExecutionStatus = getVisibleExecutionStatus(orchestrationState);
  const topLevelGoal = goal ?? input?.goal ?? orchestrationState?.goal ?? null;
  const activeSubgoal = selfDirectionState?.currentSubgoal?.title ?? null;
  const currentOwnerLabel = getCurrentOwnerLabel(orchestrationState);
  const nextBoundedAction = getNextBoundedActionSummary({
    result,
    currentGuidedStep,
    nextStepGuidance,
    suggestedNextAction,
    orchestrationState,
  });
  const canSubmitFollowUp = Boolean(
    input?.problemDescription &&
      trimmedObservation &&
      !isSubmittingFollowUp &&
      canContinueGuidedLoop &&
      (!orchestrationState || (orchestrationState.currentStatus === "active" && orchestrationState.currentAgent === "executor")),
  );

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
          context: [
            input.context ?? "",
            buildExecutionSessionContextBlock({
              goal: goal ?? input.goal,
              currentStepIndex: nextStepIndex,
              previousOutcome,
              steps: sessionHistory,
            }),
            buildExecutionOrchestrationContextBlock({ orchestration: orchestrationState }),
          ]
            .filter(Boolean)
            .join("\n\n"),
          codeSnippet: input.codeSnippet ?? "",
          actionResult: trimmedObservation,
          sessionId: input.sessionId ?? "",
          stepIndex: nextStepIndex,
          goal: goal ?? input.goal ?? "",
        } satisfies AnalysisInput),
      });

      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiErrorMessage =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string" &&
          payload.error.trim()
            ? payload.error
            : "We couldn't generate an analysis right now. Please try again.";

        setFollowUpError(
          apiErrorMessage,
        );
        return;
      }

      if (!isFreeAnalysisResponse(payload)) {
        setFollowUpError("We couldn't generate an analysis right now. Please try again.");
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
        actionChainState: currentSupervisedActionChainStep
          ? {
              currentStepIndex: supervisedActionChainActiveStepIndex,
              totalSteps: supervisedActionChain?.length ?? 1,
              lastStepIntent: currentSupervisedActionChainStep.intent,
              isCommitted: decisionCommitment === "committed",
              alignedSignalCount,
              lastStepVerification: verificationState,
              lastStepWatchFor: currentSupervisedActionChainStep.watchFor,
              previousConfidenceLevel: confidenceLevel,
              confidenceHistory: [
                ...(actionChainState?.confidenceHistory ??
                  (actionChainState?.previousConfidenceLevel ? [actionChainState.previousConfidenceLevel] : [])),
                confidenceLevel,
              ].slice(-3),
            }
          : undefined,
        confidenceLevel,
        suggestedNextAction,
        nextSuggestedStep: nextResult.what_to_do_next[0] ?? undefined,
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
        <p className="section-label">Current AI-E state</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-[1rem] border border-ink/10 bg-white/55 p-4 xl:col-span-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Top-level goal</p>
            <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">{topLevelGoal ?? "No explicit goal recorded."}</p>
          </div>
          <div className="rounded-[1rem] border border-ink/10 bg-white/55 p-4 xl:col-span-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Current subgoal</p>
            <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">{activeSubgoal ?? "No active subgoal right now."}</p>
          </div>
          <div className="rounded-[1rem] border border-ink/10 bg-white/55 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Owner</p>
            <p className="mt-2 text-sm font-semibold leading-7 text-ink/90 sm:text-base">{currentOwnerLabel ?? "Single-agent analysis"}</p>
            {getCurrentOwnerHint(orchestrationState) ? (
              <p className="mt-1 text-xs leading-6 body-muted">{getCurrentOwnerHint(orchestrationState)}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[1rem] border border-ink/10 bg-white/55 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Status</p>
              {getVisibleExecutionStatusLabel(visibleExecutionStatus) ? (
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${getVisibleExecutionStatusClassName(visibleExecutionStatus)}`}>
                  {getVisibleExecutionStatusLabel(visibleExecutionStatus)}
                </span>
              ) : null}
            </div>
            {getVisibleExecutionStatusHint(orchestrationState) ? (
              <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">{getVisibleExecutionStatusHint(orchestrationState)}</p>
            ) : isRefined && getLoopTerminationStatusHint(loopTerminationStatus) ? (
              <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">{getLoopTerminationStatusHint(loopTerminationStatus)}</p>
            ) : null}
            {orchestrationState?.lastHandoff ? (
              <p className="mt-2 text-xs leading-6 body-muted">
                Last handoff: <span className="font-semibold text-ink">{orchestrationState.lastHandoff.handoffFrom ?? "none"} -&gt; {orchestrationState.lastHandoff.handoffTo ?? "none"}</span>
              </p>
            ) : null}
          </div>
          <div className="rounded-[1rem] border border-ocean/15 bg-ocean/5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Next bounded action</p>
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${getSuggestedNextActionClassName(suggestedNextAction)}`}>
                {getSuggestedNextActionLabel(suggestedNextAction)}
              </span>
            </div>
            <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">{nextBoundedAction ?? "No next bounded action is available."}</p>
            {result.expectedOutcome ? (
              <p className="mt-2 text-xs leading-6 body-muted">Expected outcome: {result.expectedOutcome}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${getConfidenceClassName(confidenceLevel)}`}>
            {getConfidenceLabel(confidenceLevel)} confidence
          </span>
          {isRefined && getConfidenceAlignmentLabel(confidenceAlignment) ? (
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${getConfidenceAlignmentClassName(confidenceAlignment)}`}>
              {getConfidenceAlignmentLabel(confidenceAlignment)}
            </span>
          ) : null}
          {recommendedDebuggingMode ? (
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.01em] ${getRecommendedDebuggingModeClassName(recommendedDebuggingMode)}`}>
              {getRecommendedDebuggingModeLabel(recommendedDebuggingMode)}
            </span>
          ) : null}
          {isRefined && getDecisionCommitmentLabel(decisionCommitment) ? (
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${getDecisionCommitmentClassName(decisionCommitment)}`}>
              {getDecisionCommitmentLabel(decisionCommitment)}
            </span>
          ) : null}
        </div>
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
            {getLoopTerminationStatusLabel(loopTerminationStatus) && !orchestrationState ? (
              <div className="rounded-[1rem] border border-ink/10 bg-white/40 p-3">
                <p className="section-label">Current status</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${getLoopTerminationStatusClassName(loopTerminationStatus)}`}>
                    {getLoopTerminationStatusLabel(loopTerminationStatus)}
                  </span>
                </div>
                {getSuggestedNextActionHint(suggestedNextAction) ? (
                  <p className="mt-2 text-xs leading-6 body-muted sm:text-sm">{getSuggestedNextActionHint(suggestedNextAction)}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {showLowEvidenceCue ? (
          <p className="mt-2 text-xs leading-6 body-muted sm:text-sm">
            Given the current details, this is the most likely explanation.
          </p>
        ) : null}
        <div className="mt-4 rounded-[1rem] border border-ink/10 bg-white/45 p-4">
          <p className="section-label">Diagnosis</p>
          <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">{result.what_happened}</p>
        </div>
        {orchestrationState ? (
          <details className="mt-4 rounded-[1rem] border border-ink/10 bg-white/40 p-4 text-xs leading-6 text-ink/80">
            <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">
              State details
            </summary>
            <div className="mt-3 space-y-1">
              {selfDirectionState?.subgoalQueue.length ? (
                <p>
                  Queued subgoals: <span className="font-semibold text-ink">{selfDirectionState.subgoalQueue.map((subgoal) => subgoal.title).join(" | ")}</span>
                </p>
              ) : null}
              {orchestrationState.lastHandoff ? (
                <p>
                  Handoff payload: <span className="font-semibold text-ink">{orchestrationState.lastHandoff.payloadSummary}</span>
                </p>
              ) : null}
              {selfDirectionState?.lastSelectionReason ? <p>Selection reason: {selfDirectionState.lastSelectionReason}</p> : null}
              {selfDirectionState?.lastRerouteReason ? <p>Reroute reason: {selfDirectionState.lastRerouteReason}</p> : null}
              {selfDirectionState?.lastPauseReason ? <p>Pause reason: {selfDirectionState.lastPauseReason}</p> : null}
              {selfDirectionState?.lastBlockReason ? <p>Block reason: {selfDirectionState.lastBlockReason}</p> : null}
              {selfDirectionState?.lastStopReason ? <p>Stop reason: {selfDirectionState.lastStopReason}</p> : null}
            </div>
          </details>
        ) : null}
      </section>
      {result.proposedAction && result.expectedOutcome ? (
        <section className="glass-card rounded-[1.75rem] p-6 shadow-float sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <p className="section-label">Next bounded action</p>
            <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/70">
              User-approved only
            </span>
            {getActionTypeLabel(result.actionType) ? (
              <span className="inline-flex rounded-full border border-ocean/15 bg-ocean/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ocean/80">
                {getActionTypeLabel(result.actionType)}
              </span>
            ) : null}
          </div>
          <p className="mt-3 text-sm leading-7 text-ink/90 sm:text-base">{result.proposedAction}</p>
          <p className="mt-3 text-xs leading-6 body-muted sm:text-sm">Expected outcome: {result.expectedOutcome}</p>
          <p className="mt-2 text-xs leading-6 body-muted sm:text-sm">This is the next bounded move AI-E expects to happen. Nothing executes automatically; inspect the proposal and approve any real change yourself.</p>
        </section>
      ) : null}
      <section className="glass-card rounded-[1.75rem] p-6 shadow-float sm:p-7">
        <p className="section-label">Why this is the likely cause</p>
        <ul className="mt-4 space-y-3 text-sm leading-7 text-ink/90 sm:text-base">
          {result.what_matters.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section className="glass-card rounded-[1.75rem] p-6 shadow-float sm:p-7">
        <p className="section-label">Step sequence</p>
        <p className="mt-3 text-sm leading-7 body-muted">Start with the current bounded check, then only continue if the signal still stays clear.</p>
        {supervisedActionChain ? (
          <div className="mt-4 rounded-[1.25rem] border border-ocean/15 bg-white/55 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="section-label">Bounded supervised chain</p>
              <span className="inline-flex rounded-full border border-ink/10 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/70">
                User-approved only
              </span>
              {supervisedActionChainStepIndicator ? (
                <span className="inline-flex rounded-full border border-ocean/15 bg-ocean/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ocean/80">
                  {supervisedActionChainStepIndicator}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-xs leading-6 body-muted sm:text-sm">
              {decisionCommitment === "committed"
                ? "AI-E has enough evidence to stop widening the search and switch into confirmation mode. Nothing runs automatically; verify the likely cause and leave this mode immediately if the signal weakens or contradicts it."
                : decisionCommitment === "pending"
                  ? "AI-E sees a strong candidate cause, but the confirming evidence is not stable enough yet to treat it as locked in. Stay in confirmation mode, verify the same signal again, and drop it immediately if the evidence turns noisy or contradictory."
                : "AI-E is suggesting a short evidence-gated sequence. Nothing runs automatically; approve one step at a time and stop as soon as the observation resolves or weakens the diagnosis."}
            </p>
            <ol className="mt-4 space-y-3">
              {supervisedActionChain.map((step, index) => (
                <li
                  key={`${step.label}-${index}`}
                  className={`rounded-[1rem] border p-3 ${index === supervisedActionChainActiveStepIndex ? "border-ocean/20 bg-ocean/5" : "border-ink/10 bg-white/70"}`}
                >
                  <p className="text-sm font-semibold leading-6 text-ink/90 sm:text-base">{index + 1}. {step.label}</p>
                  <p className="mt-1 text-sm leading-7 text-ink/90 sm:text-base">{step.purpose}</p>
                  <p className="mt-2 text-xs leading-6 body-muted sm:text-sm">Watch for: {step.watchFor}</p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {decisionCommitment && currentSupervisedActionChainStep ? (
          <div className="mt-4 rounded-[1.25rem] border border-emerald-200/70 bg-emerald-50/60 p-4">
            <p className="section-label">Confirm likely cause</p>
            <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">1. {currentSupervisedActionChainStep.purpose}</p>
            <p className="mt-2 text-xs leading-6 body-muted sm:text-sm">Verify: {currentSupervisedActionChainStep.watchFor}</p>
          </div>
        ) : displayedConfirmFirstStep ? (
          <div className="mt-4 rounded-[1.25rem] border border-ocean/15 bg-ocean/5 p-4">
            <p className="section-label">Confirm first</p>
            <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">1. {displayedConfirmFirstStep}</p>
          </div>
        ) : null}
        {isGuidedLoopActive && !decisionCommitment ? (
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
        {isGuidedLoopActive && !decisionCommitment && nextStepGuidance && loopTerminationStatus !== "stuck" ? (
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
                ? !orchestrationState || selfDirectionState?.selfDirectionStatus === "active"
                  ? "AI-E will re-run the same analysis using your latest step outcome as additional context."
                  : `The self-directed run is ${selfDirectionState?.selfDirectionStatus}, so the planner is holding execution until the stop condition is cleared.`
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


