"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  buildExecutionSessionContextBlock,
  normalizeExecutionGoal,
  type ExecutionSessionStep,
} from "@/lib/aie/executionSession";
import {
  buildExecutionOrchestrationContextBlock,
  createExecutionOrchestrationState,
  initializeExecutionSelfDirection,
  normalizeExecutionOrchestrationState,
  recordPlannerHandoff,
  type ExecutionOrchestrationState,
} from "@/lib/aie/orchestrationSession";
import type { AnalysisInput, ExecutionRuntimeResult, FreeAnalysisResponse } from "@/lib/aie/types";

const STORAGE_KEY = "aie-free-analysis-result";

export type AnalysisEntryMode = "fresh" | "continue";

export type FollowUpVerificationState = "confirmed" | "falsified" | "inconclusive";
export type StoredLoopTerminationStatus = "resolved" | "converging" | "stuck";
export type StoredActionChainIntent = "isolation" | "instrumentation" | "timing" | "duplicate-writer" | "ownership" | "confirmation" | "decision";
export type StoredConfidenceLevel = "high" | "medium" | "low";

export type StoredActionChainState = {
  currentStepIndex: number;
  totalSteps: number;
  lastStepIntent: StoredActionChainIntent;
  isCommitted?: boolean;
  alignedSignalCount?: number;
  lastStepVerification?: FollowUpVerificationState;
  lastStepWatchFor?: string;
  previousConfidenceLevel?: StoredConfidenceLevel;
  confidenceHistory?: StoredConfidenceLevel[];
};

export type StoredAnalysisState = {
  input?: AnalysisInput;
  result: FreeAnalysisResponse;
  executionResult?: ExecutionRuntimeResult;
  refinedFromObservation?: boolean;
  lastObservation?: string;
  previousOutcome?: string;
  verificationState?: FollowUpVerificationState;
  lastAttemptedStep?: string;
  loopTerminationStatus?: StoredLoopTerminationStatus;
  actionChainState?: StoredActionChainState;
  sessionHistory?: ExecutionSessionStep[];
  orchestrationState?: ExecutionOrchestrationState;
};

export type ContinuationThreadSnapshot = {
  goal?: string;
  currentStepIndex?: number;
  diagnosis: string;
  previousOutcome?: string;
  lastAttemptedStep?: string;
  lastClassification?: "Resolved" | "Converging" | "Stuck";
  actionChainProgress?: string;
  orchestrationId?: string;
  orchestrationStatus?: string;
  orchestrationPhase?: string;
  orchestrationCurrentAgent?: string;
  orchestrationProgress?: string;
  lastHandoff?: string;
  selfDirectionStatus?: string;
  currentSubgoal?: string;
  queuedSubgoals?: string;
  nextBoundedAction?: string;
};

const initialForm: AnalysisInput = {
  goal: "",
  problemDescription: "",
  codeSnippet: "",
  errorMessage: "",
  context: "",
  actionResult: "",
};

const START_HERE_EXAMPLES = [
  "Camera zoom jitters when switching states",
  "Enemy AI stops moving after respawn",
  "Animation speed desyncs from player movement",
] as const;

function buildRoutingHintBlock(enabled: boolean): string {
  return enabled
    ? "AI-E routing hint: light\nAI-E response mode: light"
    : "AI-E routing hint: standard\nAI-E response mode: standard";
}

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
    goal: String(source.goal ?? "").trim(),
    problemDescription,
    codeSnippet: String(source.codeSnippet ?? "").trim(),
    errorMessage: String(source.errorMessage ?? "").trim(),
    context: String(source.context ?? "").trim(),
    actionResult: String(source.actionResult ?? "").trim(),
    sessionId: String(source.sessionId ?? "").trim(),
    stepIndex:
      Number.isFinite(Number(source.stepIndex)) && Number(source.stepIndex) > 0
        ? Math.floor(Number(source.stepIndex))
        : undefined,
  };
}

function normalizeSessionHistory(value: unknown): ExecutionSessionStep[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const steps = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const rawStepIndex = Number(item.stepIndex ?? 0);
      const verificationState = item.verificationState;
      const loopTerminationStatus = item.loopTerminationStatus;

      if (
        !Number.isFinite(rawStepIndex) ||
        rawStepIndex <= 0 ||
        typeof item.attemptedStep !== "string" ||
        typeof item.actionResult !== "string" ||
        typeof item.diagnosis !== "string" ||
        (verificationState !== "confirmed" && verificationState !== "falsified" && verificationState !== "inconclusive") ||
        (loopTerminationStatus !== undefined && loopTerminationStatus !== null && loopTerminationStatus !== "resolved" && loopTerminationStatus !== "converging" && loopTerminationStatus !== "stuck")
      ) {
        return null;
      }

      const rawAction = item.action;
      const action: ExecutionSessionStep["action"] =
        rawAction && typeof rawAction === "object" && typeof (rawAction as Record<string, unknown>).description === "string"
          ? {
              id:
                typeof (rawAction as Record<string, unknown>).id === "string"
                  ? String((rawAction as Record<string, unknown>).id).trim() || undefined
                  : undefined,
              description: String((rawAction as Record<string, unknown>).description).trim(),
              approved: Boolean((rawAction as Record<string, unknown>).approved),
              result:
                typeof (rawAction as Record<string, unknown>).result === "string"
                  ? String((rawAction as Record<string, unknown>).result).trim() || undefined
                  : undefined,
              type:
                (rawAction as Record<string, unknown>).type === "read" ||
                (rawAction as Record<string, unknown>).type === "write" ||
                (rawAction as Record<string, unknown>).type === "inspect" ||
                (rawAction as Record<string, unknown>).type === "run" ||
                (rawAction as Record<string, unknown>).type === "unknown"
                  ? ((rawAction as Record<string, unknown>).type as "read" | "write" | "inspect" | "run" | "unknown")
                  : undefined,
              scope:
                (rawAction as Record<string, unknown>).scope === "safe" ||
                (rawAction as Record<string, unknown>).scope === "caution" ||
                (rawAction as Record<string, unknown>).scope === "dangerous"
                  ? ((rawAction as Record<string, unknown>).scope as "safe" | "caution" | "dangerous")
                  : undefined,
              executionResult: normalizeExecutionRuntimeResult((rawAction as Record<string, unknown>).executionResult),
            }
          : undefined;

      const normalizedStep: ExecutionSessionStep = {
        stepIndex: Math.floor(rawStepIndex),
        attemptedStep: String(item.attemptedStep).trim(),
        actionResult: String(item.actionResult).trim(),
        verificationState,
        diagnosis: String(item.diagnosis).trim(),
        loopTerminationStatus: loopTerminationStatus ?? null,
        action,
        executionResult: normalizeExecutionRuntimeResult(item.executionResult),
      };

      return normalizedStep;
    })
    .filter((item): item is ExecutionSessionStep => item !== null)
    .slice(-6);

  return steps.length ? steps : undefined;
}

function normalizeStoredConfidenceLevel(value: unknown): StoredConfidenceLevel | undefined {
  return value === "high" || value === "medium" || value === "low" ? (value as StoredConfidenceLevel) : undefined;
}

function normalizeStoredConfidenceHistory(value: unknown): StoredConfidenceLevel[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const history = value
    .map((item) => normalizeStoredConfidenceLevel(item))
    .filter((item): item is StoredConfidenceLevel => Boolean(item))
    .slice(-3);

  return history.length ? history : undefined;
}

function normalizeExecutionRuntimeResult(value: unknown): ExecutionRuntimeResult | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  if (source.status !== "success" && source.status !== "failed" && source.status !== "blocked") {
    return undefined;
  }

  const output = typeof source.output === "string" ? source.output.trim() : "";
  const error = typeof source.error === "string" ? source.error.trim() : "";
  const changedPaths = Array.isArray(source.changedPaths)
    ? source.changedPaths.map((item) => String(item ?? "").trim()).filter(Boolean)
    : undefined;
  const diffSummary = typeof source.diffSummary === "string" ? source.diffSummary.trim() : "";
  const commandLabel = typeof source.commandLabel === "string" ? source.commandLabel.trim() : "";
  const rollback =
    source.rollback &&
    typeof source.rollback === "object" &&
    (source.rollback as Record<string, unknown>).type === "restore-file" &&
    typeof (source.rollback as Record<string, unknown>).targetPath === "string" &&
    typeof (source.rollback as Record<string, unknown>).previousContent === "string" &&
    typeof (source.rollback as Record<string, unknown>).snapshotId === "string" &&
    typeof (source.rollback as Record<string, unknown>).createdAt === "string"
      ? {
          type: "restore-file" as const,
          targetPath: String((source.rollback as Record<string, unknown>).targetPath).trim(),
          previousContent: String((source.rollback as Record<string, unknown>).previousContent),
          snapshotId: String((source.rollback as Record<string, unknown>).snapshotId).trim(),
          createdAt: String((source.rollback as Record<string, unknown>).createdAt).trim(),
        }
      : undefined;

  return {
    status: source.status,
    output: output || undefined,
    error: error || undefined,
    changedPaths: changedPaths?.length ? changedPaths : undefined,
    diffSummary: diffSummary || undefined,
    exitCode: Number.isInteger(Number(source.exitCode)) ? Number(source.exitCode) : undefined,
    commandLabel: commandLabel || undefined,
    rollback,
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
    executionResult: normalizeExecutionRuntimeResult(source.executionResult),
    refinedFromObservation: Boolean(source.refinedFromObservation),
    lastObservation: typeof source.lastObservation === "string" ? source.lastObservation.trim() || undefined : undefined,
    previousOutcome: typeof source.previousOutcome === "string" ? source.previousOutcome.trim() || undefined : undefined,
    verificationState:
      source.verificationState === "confirmed" || source.verificationState === "falsified" || source.verificationState === "inconclusive"
        ? (source.verificationState as FollowUpVerificationState)
        : undefined,
    lastAttemptedStep: typeof source.lastAttemptedStep === "string" ? source.lastAttemptedStep.trim() || undefined : undefined,
    loopTerminationStatus:
      source.loopTerminationStatus === "resolved" || source.loopTerminationStatus === "converging" || source.loopTerminationStatus === "stuck"
        ? (source.loopTerminationStatus as StoredLoopTerminationStatus)
        : undefined,
    actionChainState:
      source.actionChainState &&
      typeof source.actionChainState === "object" &&
      typeof (source.actionChainState as Record<string, unknown>).currentStepIndex === "number" &&
      typeof (source.actionChainState as Record<string, unknown>).totalSteps === "number" &&
      ((source.actionChainState as Record<string, unknown>).lastStepIntent === "isolation" ||
        (source.actionChainState as Record<string, unknown>).lastStepIntent === "instrumentation" ||
        (source.actionChainState as Record<string, unknown>).lastStepIntent === "timing" ||
        (source.actionChainState as Record<string, unknown>).lastStepIntent === "duplicate-writer" ||
        (source.actionChainState as Record<string, unknown>).lastStepIntent === "ownership" ||
        (source.actionChainState as Record<string, unknown>).lastStepIntent === "confirmation" ||
        (source.actionChainState as Record<string, unknown>).lastStepIntent === "decision")
        ? {
            currentStepIndex: Math.max(0, Math.min(2, Math.floor(Number((source.actionChainState as Record<string, unknown>).currentStepIndex)))),
            totalSteps: Math.max(1, Math.min(3, Math.floor(Number((source.actionChainState as Record<string, unknown>).totalSteps)))),
            lastStepIntent: (source.actionChainState as Record<string, unknown>).lastStepIntent as StoredActionChainIntent,
            isCommitted: Boolean((source.actionChainState as Record<string, unknown>).isCommitted),
            alignedSignalCount: Math.max(
              0,
              Math.min(3, Math.floor(Number((source.actionChainState as Record<string, unknown>).alignedSignalCount ?? 0))),
            ),
            lastStepVerification:
              (source.actionChainState as Record<string, unknown>).lastStepVerification === "confirmed" ||
              (source.actionChainState as Record<string, unknown>).lastStepVerification === "falsified" ||
              (source.actionChainState as Record<string, unknown>).lastStepVerification === "inconclusive"
                ? ((source.actionChainState as Record<string, unknown>).lastStepVerification as FollowUpVerificationState)
                : undefined,
            lastStepWatchFor:
              typeof (source.actionChainState as Record<string, unknown>).lastStepWatchFor === "string"
                ? String((source.actionChainState as Record<string, unknown>).lastStepWatchFor).trim() || undefined
                : undefined,
            previousConfidenceLevel: normalizeStoredConfidenceLevel(
              (source.actionChainState as Record<string, unknown>).previousConfidenceLevel,
            ),
            confidenceHistory: normalizeStoredConfidenceHistory((source.actionChainState as Record<string, unknown>).confidenceHistory),
          }
        : undefined,
    sessionHistory: normalizeSessionHistory(source.sessionHistory),
    orchestrationState: normalizeExecutionOrchestrationState(source.orchestrationState),
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

  const blockedOrComplete =
    state?.orchestrationState?.currentStatus === "blocked" ||
    state?.orchestrationState?.currentStatus === "complete" ||
    state?.orchestrationState?.selfDirectionState.selfDirectionStatus === "blocked";

  return {
    goal: state?.input?.goal,
    currentStepIndex: state?.input?.stepIndex,
    diagnosis,
    previousOutcome: state?.previousOutcome,
    lastAttemptedStep: state?.lastAttemptedStep,
    lastClassification: getLoopTerminationLabel(state?.loopTerminationStatus),
    actionChainProgress: state?.actionChainState
      ? `${state.actionChainState.isCommitted ? "Confirmation mode" : state.actionChainState.lastStepIntent === "confirmation" ? "Confirmation mode (pending evidence)" : `Step ${state.actionChainState.currentStepIndex + 1} of ${state.actionChainState.totalSteps}`} (${state.actionChainState.lastStepIntent}${state.actionChainState.previousConfidenceLevel ? `, ${state.actionChainState.previousConfidenceLevel} confidence` : ""})`
      : undefined,
    orchestrationId: state?.orchestrationState?.orchestrationId,
    orchestrationStatus: state?.orchestrationState?.currentStatus,
    orchestrationPhase: state?.orchestrationState?.currentPhase,
    orchestrationCurrentAgent: state?.orchestrationState?.currentAgent,
    orchestrationProgress: state?.orchestrationState
      ? `${state.orchestrationState.currentPhase} (${state.orchestrationState.completedSteps.length} completed, ${state.orchestrationState.blockedSteps.length} blocked, current agent: ${state.orchestrationState.currentAgent}, self-direction: ${state.orchestrationState.selfDirectionState.selfDirectionStatus})`
      : undefined,
    lastHandoff: state?.orchestrationState?.lastHandoff
      ? `${state.orchestrationState.lastHandoff.handoffFrom ?? "none"} -> ${state.orchestrationState.lastHandoff.handoffTo ?? "none"}: ${state.orchestrationState.lastHandoff.payloadSummary}`
      : undefined,
    selfDirectionStatus: state?.orchestrationState?.selfDirectionState.selfDirectionStatus,
    currentSubgoal: state?.orchestrationState?.selfDirectionState.currentSubgoal?.title,
    queuedSubgoals: state?.orchestrationState?.selfDirectionState.subgoalQueue.map((subgoal) => subgoal.title).join(" | ") || undefined,
    nextBoundedAction: blockedOrComplete
      ? "No further bounded action is available."
      : state?.orchestrationState?.plannerState.proposedAction ||
          state?.orchestrationState?.executorState.pendingAction ||
          state?.result.proposedAction ||
          state?.result.what_to_do_next[0] ||
          state?.lastAttemptedStep,
  };
}

export function buildContinuationContextBlock(snapshot: ContinuationThreadSnapshot): string {
  const lines = [
    "Continuation context from the previous AI-E debugging turn:",
    ...(snapshot.goal ? [`- Goal: ${snapshot.goal}`] : []),
    ...(snapshot.currentStepIndex ? [`- Current step to approve: ${snapshot.currentStepIndex}`] : []),
    `- Last diagnosis: ${snapshot.diagnosis}`,
  ];

  if (snapshot.previousOutcome) {
    lines.push(`- Previous outcome: ${snapshot.previousOutcome}`);
  }

  if (snapshot.lastAttemptedStep) {
    lines.push(`- Last step attempted: ${snapshot.lastAttemptedStep}`);
  }

  if (snapshot.lastClassification) {
    lines.push(`- Last classification: ${snapshot.lastClassification}`);
  }

  if (snapshot.actionChainProgress) {
    lines.push(`- Last bounded chain position: ${snapshot.actionChainProgress}`);
  }

  if (snapshot.orchestrationId) {
    lines.push(`- Orchestration ID: ${snapshot.orchestrationId}`);
  }

  if (snapshot.orchestrationStatus) {
    lines.push(`- Orchestration status: ${snapshot.orchestrationStatus}`);
  }

  if (snapshot.orchestrationPhase) {
    lines.push(`- Orchestration phase: ${snapshot.orchestrationPhase}`);
  }

  if (snapshot.orchestrationCurrentAgent) {
    lines.push(`- Current orchestration agent: ${snapshot.orchestrationCurrentAgent}`);
  }

  if (snapshot.orchestrationProgress) {
    lines.push(`- Orchestration progress: ${snapshot.orchestrationProgress}`);
  }

  if (snapshot.lastHandoff) {
    lines.push(`- Last planner/executor handoff: ${snapshot.lastHandoff}`);
  }

  if (snapshot.selfDirectionStatus) {
    lines.push(`- Self-direction status: ${snapshot.selfDirectionStatus}`);
  }

  if (snapshot.currentSubgoal) {
    lines.push(`- Current self-directed subgoal: ${snapshot.currentSubgoal}`);
  }

  if (snapshot.queuedSubgoals) {
    lines.push(`- Remaining self-directed subgoals: ${snapshot.queuedSubgoals}`);
  }

  if (snapshot.nextBoundedAction) {
    lines.push(`- Next bounded action: ${snapshot.nextBoundedAction}`);
  }

  lines.push("Use this as the starting context for the new analysis instead of restarting from a fresh first pass.");
  return lines.join("\n");
}

type AnalysisFormProps = {
  initialMode?: AnalysisEntryMode;
};

export function AnalysisForm({ initialMode = "fresh" }: AnalysisFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<AnalysisInput>(initialForm);
  const [lightMode, setLightMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [storedState, setStoredState] = useState<StoredAnalysisState | null>(null);
  const [includeContinuationContext, setIncludeContinuationContext] = useState(initialMode === "continue");
  const problemDescriptionRef = useRef<HTMLTextAreaElement | null>(null);

  const descriptionLength = useMemo(() => form.problemDescription.trim().length, [form.problemDescription]);
  const continuationSnapshot = useMemo(() => getContinuationThreadSnapshot(storedState), [storedState]);
  const showStartHere = initialMode === "fresh" && descriptionLength === 0;

  useEffect(() => {
    if (initialMode !== "continue") {
      setStoredState(null);
      return;
    }

    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setStoredState(null);
      return;
    }

    try {
      setStoredState(normalizeStoredAnalysisState(JSON.parse(raw)));
    } catch {
      setStoredState(null);
    }
  }, [initialMode]);

  useEffect(() => {
    setIncludeContinuationContext(initialMode === "continue");
  }, [initialMode]);

  useEffect(() => {
    if (initialMode !== "continue" || !storedState?.input?.goal) {
      return;
    }

    setForm((current) => (current.goal ? current : { ...current, goal: storedState.input?.goal ?? "" }));
  }, [initialMode, storedState]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (descriptionLength < 24) {
      setErrorMessage("Please describe the Unity issue in a little more detail.");
      return;
    }

    setIsSubmitting(true);

    const sessionGoal = normalizeExecutionGoal(form.problemDescription, form.goal || storedState?.input?.goal);
    const sessionId = initialMode === "continue" ? storedState?.input?.sessionId || crypto.randomUUID() : crypto.randomUUID();
    const stepIndex = initialMode === "continue" ? Math.max(1, storedState?.input?.stepIndex ?? 1) : 1;
    const initialOrchestrationState =
      initialMode === "continue" && storedState?.orchestrationState
        ? storedState.orchestrationState
        : createExecutionOrchestrationState({ goal: sessionGoal });
    const sessionContext = buildExecutionSessionContextBlock({
      goal: sessionGoal,
      currentStepIndex: stepIndex,
      previousOutcome: initialMode === "continue" ? storedState?.previousOutcome : undefined,
      steps: initialMode === "continue" ? storedState?.sessionHistory : undefined,
    });

    const submittedInput = {
      ...form,
      goal: sessionGoal,
      sessionId,
      stepIndex,
      context: [
        (form.context ?? "").trim(),
        includeContinuationContext && continuationSnapshot ? buildContinuationContextBlock(continuationSnapshot) : "",
        buildRoutingHintBlock(lightMode),
        sessionContext,
        buildExecutionOrchestrationContextBlock({ orchestration: initialOrchestrationState }),
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

        setErrorMessage(apiErrorMessage);
        return;
      }

      if (!isFreeAnalysisResponse(payload)) {
        setErrorMessage("We couldn't generate an analysis right now. Please try again.");
        return;
      }

      const proposedAction = payload.proposedAction ?? payload.what_to_do_next[0] ?? "";
      const expectedOutcome = payload.expectedOutcome ?? payload.what_matters[0] ?? "";
      const primedOrchestrationState = {
        ...initialOrchestrationState,
        selfDirectionState: initializeExecutionSelfDirection({
          state: initialOrchestrationState.selfDirectionState,
          currentPhase: initialOrchestrationState.currentPhase,
          diagnosis: payload.what_happened,
          proposedAction,
          expectedOutcome,
        }),
      };
      const initialPlannerDecision =
        primedOrchestrationState.selfDirectionState.selfDirectionStatus === "blocked" || !proposedAction ? "block" : "continue";
      const orchestrationState = recordPlannerHandoff({
        state: primedOrchestrationState,
        stepNumber: stepIndex,
        diagnosis: payload.what_happened,
        proposedAction,
        expectedOutcome,
        plannerDecision: initialPlannerDecision,
        handoffTo: initialPlannerDecision === "continue" ? "executor" : null,
      }).state;

      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          input: submittedInput,
          result: payload,
          refinedFromObservation: false,
          lastObservation: undefined,
          previousOutcome: initialMode === "continue" ? storedState?.previousOutcome : undefined,
          verificationState: undefined,
          lastAttemptedStep: undefined,
          loopTerminationStatus: undefined,
          actionChainState: undefined,
          sessionHistory: initialMode === "continue" ? storedState?.sessionHistory ?? [] : [],
          orchestrationState,
        } satisfies StoredAnalysisState),
      );
      router.push("/result");
    } catch {
      setErrorMessage("We couldn't generate an analysis right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const applyExamplePrompt = (example: string) => {
    setForm((current) => ({ ...current, problemDescription: example }));
    problemDescriptionRef.current?.focus();
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      <div className="grid gap-6 rounded-[1.75rem] border border-ink/10 bg-white/55 p-6 shadow-float sm:p-7">
        <div>
          <p className="label-text">Response mode</p>
          <label className="mt-3 flex items-start gap-3 rounded-2xl border border-ink/10 bg-white/70 px-4 py-3 text-sm text-ink/85 shadow-soft">
            <input
              type="checkbox"
              checked={lightMode}
              onChange={(event) => setLightMode(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-ink/30 text-ocean focus:ring-ocean"
            />
            <span>
              <span className="block font-semibold text-ink">Use light mode</span>
              <span className="mt-1 block text-xs body-muted">
                Keeps the guided debugging loop intact but routes the request through the lighter model path for faster, cheaper first-pass analysis.
              </span>
            </span>
          </label>
        </div>

        {showStartHere ? (
          <section className="rounded-[1.5rem] border border-ink/10 bg-white/45 p-5">
            <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div>
                <p className="section-label">Start here</p>
                <p className="mt-2 text-sm leading-7 text-ink/85">
                  Type one issue, not a full backlog. Include when it happens, what you expected, and what actually occurs.
                </p>
              </div>
              <div className="grid gap-3 rounded-[1.25rem] border border-ink/10 bg-white/60 p-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">What to type</p>
                  <p className="mt-2 text-sm leading-7 text-ink/90">A short Unity bug report with the failure, trigger, and visible result.</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">What you get back</p>
                  <p className="mt-2 text-sm leading-7 text-ink/90">A diagnosis, the reasons it is likely, and one bounded action to try before the next follow-up.</p>
                </div>
              </div>
            </div>
            <div className="mt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Try one of these examples</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {START_HERE_EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => applyExamplePrompt(example)}
                    className="rounded-full border border-ink/10 bg-white/80 px-4 py-2 text-sm font-medium text-ink transition hover:-translate-y-0.5 hover:border-coral/30 hover:text-ember"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {initialMode === "continue" && continuationSnapshot ? (
          <div className="rounded-[1.5rem] border border-ocean/15 bg-ocean/5 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="section-label">Session threading</p>
                <p className="mt-2 text-sm leading-7 text-ink/90">
                  This analysis is intentionally continuing the previous debugging flow by reusing the last diagnosis, attempted step, and status from this browser session.
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
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-[1rem] border border-ink/10 bg-white/55 p-3 xl:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Active goal</p>
                <p className="mt-2 text-sm leading-7 text-ink/90">{continuationSnapshot.goal ?? "No explicit goal recorded."}</p>
              </div>
              <div className="rounded-[1rem] border border-ink/10 bg-white/55 p-3 xl:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Current subgoal</p>
                <p className="mt-2 text-sm leading-7 text-ink/90">{continuationSnapshot.currentSubgoal ?? "No active subgoal right now."}</p>
              </div>
              <div className="rounded-[1rem] border border-ink/10 bg-white/55 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Owner</p>
                <p className="mt-2 text-sm font-semibold leading-7 text-ink/90">{continuationSnapshot.orchestrationCurrentAgent ?? "Single analysis thread"}</p>
              </div>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="rounded-[1rem] border border-ink/10 bg-white/55 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Status</p>
                <p className="mt-2 text-sm font-semibold leading-7 text-ink/90">{continuationSnapshot.selfDirectionStatus ?? continuationSnapshot.orchestrationStatus ?? continuationSnapshot.lastClassification ?? "Ready to continue"}</p>
                {continuationSnapshot.orchestrationPhase ? (
                  <p className="mt-1 text-xs leading-6 body-muted">Phase: {continuationSnapshot.orchestrationPhase}</p>
                ) : null}
              </div>
              <div className="rounded-[1rem] border border-ocean/15 bg-white/55 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">Next bounded action</p>
                <p className="mt-2 text-sm leading-7 text-ink/90">{continuationSnapshot.nextBoundedAction ?? continuationSnapshot.lastAttemptedStep ?? "No next bounded action recorded."}</p>
              </div>
            </div>
            <details className="mt-3 rounded-[1rem] border border-ink/10 bg-white/45 p-3 text-xs leading-6 body-muted sm:text-sm">
              <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">Previous turn details</summary>
              <div className="mt-3 grid gap-2">
                <p>
                  <span className="font-semibold text-ink">Last diagnosis:</span> {continuationSnapshot.diagnosis}
                </p>
                {continuationSnapshot.lastAttemptedStep ? (
                  <p>
                    <span className="font-semibold text-ink">Last step attempted:</span> {continuationSnapshot.lastAttemptedStep}
                  </p>
                ) : null}
                {continuationSnapshot.actionChainProgress ? (
                  <p>
                    <span className="font-semibold text-ink">Last bounded chain:</span> {continuationSnapshot.actionChainProgress}
                  </p>
                ) : null}
                {continuationSnapshot.orchestrationProgress ? (
                  <p>
                    <span className="font-semibold text-ink">Orchestration:</span> {continuationSnapshot.orchestrationProgress}
                  </p>
                ) : null}
                {continuationSnapshot.lastHandoff ? (
                  <p>
                    <span className="font-semibold text-ink">Last handoff:</span> {continuationSnapshot.lastHandoff}
                  </p>
                ) : null}
              </div>
            </details>
          </div>
        ) : null}

        <label className="grid gap-2 text-sm font-medium text-ink">
          Goal
          <input
            type="text"
            value={form.goal ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, goal: event.target.value }))}
            placeholder="Optional: keep this session focused on one outcome."
            className="rounded-[1.5rem] border border-ink/10 bg-white/80 px-5 py-4 text-sm text-ink outline-none transition placeholder:text-slate focus:border-coral focus:ring-2 focus:ring-coral/20"
          />
          <span className="text-xs body-muted">Leave blank to derive the goal from the issue description.</span>
        </label>

        <label className="grid gap-2 text-sm font-medium text-ink">
          Problem description
          <textarea
            ref={problemDescriptionRef}
            required
            rows={6}
            value={form.problemDescription}
            onChange={(event) => {
              const nextProblemDescription = event.target.value;
              setForm((current) => ({ ...current, problemDescription: nextProblemDescription }));
            }}
            placeholder="Describe what’s going wrong in your Unity project..."
            className="min-h-[180px] rounded-[1.5rem] border border-ink/10 bg-white/80 px-5 py-4 text-sm text-ink outline-none transition placeholder:text-slate focus:border-coral focus:ring-2 focus:ring-coral/20"
          />
          <span className="text-xs body-muted">Include when it happens, what you expected, and what actually occurs.</span>
          <span className="text-xs body-muted">
            {descriptionLength >= 120
              ? "This has enough detail for a solid first pass."
              : "Aim for roughly one or two sentences so AI-E can see the trigger and the visible failure."}
          </span>
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