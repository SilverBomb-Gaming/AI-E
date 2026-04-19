import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { FollowUpVerificationState, StoredActionChainState, StoredAnalysisState } from "./components/AnalysisForm";
import { normalizeExecutionGoal, buildExecutionSessionContextBlock, advanceExecutionSession } from "./lib/aie/executionSession";
import {
  buildExecutionOrchestrationContextBlock,
  createExecutionOrchestrationState,
  deriveNextExecutionOrchestrationPhase,
  initializeExecutionSelfDirection,
  recordPlannerHandoff,
  recordExecutorOutcome,
  advanceExecutionOrchestration,
  advanceExecutionSelfDirection,
  type ExecutionOrchestrationState,
} from "./lib/aie/orchestrationSession";
import {
  buildAnalysisTraceRecord,
  listMissingAnalysisTraceFields,
  type AnalysisTraceRecord,
} from "./lib/aie/analysisTrace";
import {
  buildFollowUpProblemDescription,
  buildGuidedStepStack,
  buildNextStepGuidance,
  classifyFollowUpResult,
  classifyLoopTerminationStatus,
  deriveAnalysisResultSignals,
  buildFalsifiedDiagnosis,
  hasHardBlockerSignal,
  isSemanticallyRedundantStep,
} from "./components/analysisResultLogic";
import type { AnalysisInput, FreeAnalysisResponse } from "./lib/aie/types";

type StressScenarioId =
  | "contradictory-observations"
  | "partial-success-loop"
  | "repeated-failure-loop"
  | "ambiguous-messy-input"
  | "planner-executor-disagreement"
  | "blocked-orchestration"
  | "early-completion"
  | "self-direction-drift";

type StressScenarioCategory =
  | "A. Contradictory observations"
  | "B. Partial success loops"
  | "C. Repeated failure loops"
  | "D. Ambiguous / messy input"
  | "E. Planner vs executor disagreement"
  | "F. Blocked orchestration"
  | "G. Early completion"
  | "H. Self-direction drift";

type ScenarioObservation = {
  note: string;
  expectedCategory: "contradiction" | "partial" | "failure" | "blocked" | "resolved" | "drift";
};

type StressScenarioDefinition = {
  id: StressScenarioId;
  category: StressScenarioCategory;
  title: string;
  goal: string;
  prompt: string;
  observations: ScenarioObservation[];
};

type UIStateSnapshot = {
  topLevelGoal: string | null;
  currentSubgoal: string | null;
  owner: string | null;
  status: string | null;
  nextBoundedAction: string | null;
  confidence: string | null;
  recommendedMode: string | null;
  lastHandoff: string | null;
};

type StepRecord = {
  stepNumber: number;
  stage: "fresh" | "follow-up";
  observation: string | null;
  output: {
    whatHappened: string;
    whatMatters: string[];
    whatToDoNext: string[];
    proposedAction: string | null;
    expectedOutcome: string | null;
  };
  uiState: UIStateSnapshot;
  trace: AnalysisTraceRecord;
  traceMissingFields: string[];
  verificationState: FollowUpVerificationState | null;
  loopStatus: string | null;
  suggestedNextAction: string;
  plannerDecision: string | null;
  actionChainState: string;
  notes: string[];
};

type ScenarioRunRecord = {
  scenarioId: StressScenarioId;
  category: StressScenarioCategory;
  title: string;
  initialPrompt: string;
  goal: string;
  steps: StepRecord[];
  finalStatus: "resolved" | "blocked" | "stuck" | "incorrect" | "paused" | "active";
  confidenceBehavior: string[];
  subgoalBehavior: string[];
  plannerExecutorInteraction: string[];
  traceCompleteness: {
    allComplete: boolean;
    missingFieldNames: string[];
  };
  failurePatterns: string[];
};

const scenarios: StressScenarioDefinition[] = [
  {
    id: "contradictory-observations",
    category: "A. Contradictory observations",
    title: "Contradiction after earlier confirmation",
    goal: "Update the likely cause immediately when a previously confirmed lever stops affecting the issue.",
    prompt:
      "After changing Animator speed sync, movement used to break right when the Animator resume handoff ran. Earlier, disabling Animator speed sync fixed it, but now the freeze sometimes stays even when that same path is bypassed.",
    observations: [
      {
        note: "Disabling Animator speed sync changed nothing this time, but bypassing the pathfinding resume handoff removes the freeze immediately.",
        expectedCategory: "contradiction",
      },
    ],
  },
  {
    id: "partial-success-loop",
    category: "B. Partial success loops",
    title: "Partial progress without full resolution",
    goal: "Decide whether to continue or reroute after a partial improvement.",
    prompt:
      "After scene streaming, the inventory HUD sometimes opens empty the first time, but the rest of the menu flow works normally. The timing around the data-ready event and HUD subscription still looks suspicious.",
    observations: [
      {
        note: "Delaying the HUD hookup until after the data-ready callback makes the empty panel much rarer, but it still shows up on slow loads.",
        expectedCategory: "partial",
      },
      {
        note: "Extra timestamp logging still points at the same event-order mismatch, but the last change only reduced the issue instead of fully removing it.",
        expectedCategory: "partial",
      },
    ],
  },
  {
    id: "repeated-failure-loop",
    category: "C. Repeated failure loops",
    title: "Multiple failed steps in sequence",
    goal: "Stop or reroute cleanly after several bounded steps fail to move the signal.",
    prompt:
      "A combat input regression appeared after a pause-overlay refresh change, and now reticle lag, audio ducking flicker, and resume timing all feel mixed together around the same handoff.",
    observations: [
      {
        note: "Disabling the delayed overlay refresh changed nothing, and the reticle lag plus audio flicker still show up together.",
        expectedCategory: "failure",
      },
      {
        note: "Forcing the input restore order also changed nothing, and the same regression cluster still appears on every slow-motion exit.",
        expectedCategory: "failure",
      },
      {
        note: "The third bounded check still produced no obvious change, and nothing clearly shifted the signal.",
        expectedCategory: "failure",
      },
    ],
  },
  {
    id: "ambiguous-messy-input",
    category: "D. Ambiguous / messy input",
    title: "Messy multi-system prompt",
    goal: "Reduce a vague mixed prompt to one bounded subsystem without false certainty.",
    prompt:
      "In one late-night pass I changed dash handling, slope friction, pause-menu refresh, loading overlay, audio singleton, scene bootstrap, and camera recenter. Now the player snaps back, menus lag, music doubles, and some buttons stop responding. I cannot tell what is related anymore.",
    observations: [
      {
        note: "I tried a couple of the suggested checks and the signal is still all over the place, with no obvious change.",
        expectedCategory: "failure",
      },
    ],
  },
  {
    id: "planner-executor-disagreement",
    category: "E. Planner vs executor disagreement",
    title: "Strong planner prediction contradicted by executor result",
    goal: "Handle a sharp planner/executor mismatch without clinging to the original plan.",
    prompt:
      "A homing missile prefab sometimes launches with no target and flies straight ahead. The launcher stores the target on one object while the spawned projectile reads another reference path.",
    observations: [
      {
        note: "Passing the target reference directly into the projectile did not affect the issue, but delaying the spawn until after the target registry finishes initialization makes the failure disappear.",
        expectedCategory: "contradiction",
      },
    ],
  },
  {
    id: "blocked-orchestration",
    category: "F. Blocked orchestration",
    title: "No safe next action remains",
    goal: "Block cleanly when the bounded scope no longer has a safe next move.",
    prompt:
      "CLI startup now fails before the banner path, and the likely blocker looks tied to a missing controller import on this branch.",
    observations: [
      {
        note: "The suggested import fix failed because the module does not exist anywhere on this branch, and there is no equivalent fallback in the repo.",
        expectedCategory: "blocked",
      },
    ],
  },
  {
    id: "early-completion",
    category: "G. Early completion",
    title: "Goal already satisfied before full chain",
    goal: "Stop early once the approved goal is already satisfied.",
    prompt:
      "The HUD shows zero health on the first frame after scene load because the HUD seems to bind before PlayerStats finishes initializing.",
    observations: [
      {
        note: "Delaying the dependent binding until after PlayerStats initializes fixes it, and the HUD now behaves normally again on every load.",
        expectedCategory: "resolved",
      },
    ],
  },
  {
    id: "self-direction-drift",
    category: "H. Self-direction drift",
    title: "Self-direction under vague repeated partials",
    goal: "Keep self-directed subgoals concrete instead of drifting into redundant or vague queue entries.",
    prompt:
      "After respawn, the stamina ring and dodge gate disagree briefly right when the respawn restore handoff runs: the HUD shows full stamina, but gameplay still thinks it is empty. One path restores from a replicated snapshot while the other reads a cached local reference.",
    observations: [
      {
        note: "Making both systems read the same live snapshot weakens the mismatch, but reconnecting still brings back that same weaker mismatch.",
        expectedCategory: "partial",
      },
      {
        note: "A second bounded tweak still only weakens the same mismatch instead of resolving it, and the queue keeps suggesting another version of the same validation step.",
        expectedCategory: "drift",
      },
    ],
  },
];

async function analyze(input: AnalysisInput): Promise<FreeAnalysisResponse> {
  const response = await fetch("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`API failed with status ${response.status}`);
  }

  return response.json();
}

function toStoredActionChainState(params: {
  signals: ReturnType<typeof deriveAnalysisResultSignals>;
  verificationState?: FollowUpVerificationState;
}): StoredActionChainState | undefined {
  if (!params.signals.supervisedActionChain?.length || !params.signals.currentSupervisedActionChainStep) {
    return undefined;
  }

  return {
    currentStepIndex: params.signals.supervisedActionChainActiveStepIndex,
    totalSteps: params.signals.supervisedActionChain.length,
    lastStepIntent: params.signals.currentSupervisedActionChainStep.intent,
    isCommitted: params.signals.decisionCommitment === "committed",
    alignedSignalCount: params.signals.alignedSignalCount,
    lastStepVerification: params.verificationState,
    lastStepWatchFor: params.signals.currentSupervisedActionChainStep.watchFor,
    previousConfidenceLevel: params.signals.confidenceLevel,
    confidenceHistory: params.signals.confidenceLevel ? [params.signals.confidenceLevel] : undefined,
  };
}

function buildRefinedResult(params: {
  originalResult: FreeAnalysisResponse;
  nextResult: FreeAnalysisResponse;
  observation: string;
  verificationState: FollowUpVerificationState;
  priorSteps: string[];
}): FreeAnalysisResponse {
  const whatHappened =
    params.verificationState === "falsified"
      ? buildFalsifiedDiagnosis({
          originalResult: params.originalResult,
          nextResult: params.nextResult,
          observation: params.observation,
        })
      : params.nextResult.what_happened;

  const nextStepGuidance = buildNextStepGuidance({
    verificationState: params.verificationState,
    currentResult: params.nextResult,
    observation: params.observation,
    priorSteps: params.priorSteps,
  });

  return {
    ...params.nextResult,
    what_happened: whatHappened,
    what_to_do_next:
      params.verificationState === "confirmed"
        ? params.priorSteps
        : buildGuidedStepStack(nextStepGuidance, params.priorSteps),
  };
}

function getVisibleStatus(orchestrationState: ExecutionOrchestrationState | undefined): string | null {
  if (!orchestrationState) {
    return null;
  }

  const selfStatus = orchestrationState.selfDirectionState.selfDirectionStatus;
  if (selfStatus === "blocked" || orchestrationState.currentStatus === "blocked") {
    return "blocked";
  }
  if (selfStatus === "paused") {
    return "paused";
  }
  if (selfStatus === "complete" || orchestrationState.currentStatus === "complete") {
    return "complete";
  }
  if (selfStatus === "aborted" || orchestrationState.currentStatus === "aborted") {
    return "aborted";
  }

  return "active";
}

function buildUIStateSnapshot(params: {
  input: AnalysisInput;
  result: FreeAnalysisResponse;
  signals: ReturnType<typeof deriveAnalysisResultSignals>;
  orchestrationState?: ExecutionOrchestrationState;
}): UIStateSnapshot {
  const orchestrationState = params.orchestrationState;
  const visibleStatus = getVisibleStatus(orchestrationState);
  const nextBoundedAction =
    visibleStatus === "blocked" || visibleStatus === "complete"
      ? "No further bounded action is available."
      : orchestrationState?.plannerState.proposedAction ||
          orchestrationState?.executorState.pendingAction ||
          params.result.proposedAction ||
          params.signals.currentGuidedStep ||
          params.signals.nextStepGuidance ||
          params.result.what_to_do_next[0] ||
          null;

  return {
    topLevelGoal: params.input.goal?.trim() || orchestrationState?.goal || null,
    currentSubgoal: orchestrationState?.selfDirectionState.currentSubgoal?.title || null,
    owner: orchestrationState ? orchestrationState.currentAgent : "single-analysis",
    status: visibleStatus,
    nextBoundedAction,
    confidence: params.signals.confidenceLevel,
    recommendedMode: params.signals.recommendedDebuggingMode,
    lastHandoff: orchestrationState?.lastHandoff
      ? `${orchestrationState.lastHandoff.handoffFrom ?? "none"} -> ${orchestrationState.lastHandoff.handoffTo ?? "none"}: ${orchestrationState.lastHandoff.payloadSummary}`
      : null,
  };
}

function buildStepNotes(params: {
  scenario: StressScenarioDefinition;
  signals: ReturnType<typeof deriveAnalysisResultSignals>;
  orchestrationState?: ExecutionOrchestrationState;
  verificationState: FollowUpVerificationState | null;
}): string[] {
  const notes: string[] = [];
  if (params.signals.decisionCommitment === "committed" && params.verificationState !== "confirmed") {
    notes.push("High confidence commitment was reached without a fully confirmed outcome.");
  }
  if (params.signals.loopTerminationStatus === "converging" && params.signals.nextStepGuidance === null && params.verificationState !== "confirmed") {
    notes.push("Loop reported converging even though no next guided step remained.");
  }
  if (params.orchestrationState?.selfDirectionState.subgoalQueue.some((subgoal) => /continue|keep going|improve/i.test(subgoal.title))) {
    notes.push("Self-direction queue contains a vague subgoal title.");
  }
  if (params.orchestrationState?.currentAgent === "executor" && params.orchestrationState.currentStatus !== "active") {
    notes.push("Executor still owns the step even though orchestration is no longer active.");
  }
  return notes;
}

function collectFailurePatterns(run: ScenarioRunRecord): string[] {
  const patterns = new Set<string>();
  for (const step of run.steps) {
    if (/contradict/i.test(step.output.whatHappened) && step.verificationState !== "falsified") {
      patterns.add("Reasoning updated diagnosis text without a clean falsified state.");
    }
    if (step.notes.some((note) => note.includes("High confidence commitment"))) {
      patterns.add("Confidence may lock too early under ambiguous evidence.");
    }
    if (step.notes.some((note) => note.includes("no next guided step remained"))) {
      patterns.add("Loop can report progress while losing a concrete next action.");
    }
    if (step.notes.some((note) => note.includes("vague subgoal"))) {
      patterns.add("Self-direction can still drift into vague or weakly differentiated subgoals.");
    }
    if (step.uiState.status === "active" && step.suggestedNextAction === "stop") {
      patterns.add("UI-visible status can remain active while the guidance says to stop.");
    }
    if (step.uiState.owner === "planner" && step.uiState.nextBoundedAction && /No further bounded action/i.test(step.uiState.nextBoundedAction) === false && step.uiState.status === "blocked") {
      patterns.add("Blocked state can still surface a forward next action, increasing trust risk.");
    }
  }

  return [...patterns];
}

function finalStatusFromRun(run: ScenarioRunRecord): ScenarioRunRecord["finalStatus"] {
  const last = run.steps.at(-1);
  if (!last) {
    return "incorrect";
  }

  if (last.uiState.status === "complete" || last.verificationState === "confirmed") {
    return "resolved";
  }
  if (last.uiState.status === "blocked") {
    return "blocked";
  }
  if (last.uiState.status === "paused") {
    return "paused";
  }
  if (last.loopStatus === "stuck") {
    return "stuck";
  }
  if (last.notes.length > 0) {
    return "incorrect";
  }

  return "active";
}

async function runScenario(definition: StressScenarioDefinition): Promise<ScenarioRunRecord> {
  const sessionId = `edge-${definition.id}-${Date.now()}`;
  const sessionGoal = normalizeExecutionGoal(definition.prompt, definition.goal);
  const initialOrchestrationState = createExecutionOrchestrationState({ goal: sessionGoal });
  const initialInput: AnalysisInput = {
    problemDescription: definition.prompt,
    sessionId,
    stepIndex: 1,
    goal: sessionGoal,
    context: [
      buildExecutionSessionContextBlock({ goal: sessionGoal, currentStepIndex: 1 }),
      buildExecutionOrchestrationContextBlock({ orchestration: initialOrchestrationState }),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  const firstRawResult = await analyze(initialInput);
  const proposedAction = firstRawResult.proposedAction ?? firstRawResult.what_to_do_next[0] ?? "";
  const expectedOutcome = firstRawResult.expectedOutcome ?? firstRawResult.what_matters[0] ?? "";
  const primedOrchestrationState = {
    ...initialOrchestrationState,
    selfDirectionState: initializeExecutionSelfDirection({
      state: initialOrchestrationState.selfDirectionState,
      currentPhase: initialOrchestrationState.currentPhase,
      diagnosis: firstRawResult.what_happened,
      proposedAction,
      expectedOutcome,
    }),
  };
  const initialPlannerDecision =
    primedOrchestrationState.selfDirectionState.selfDirectionStatus === "blocked" || !proposedAction ? "block" : "continue";
  let orchestrationState = recordPlannerHandoff({
    state: primedOrchestrationState,
    stepNumber: 1,
    diagnosis: firstRawResult.what_happened,
    proposedAction,
    expectedOutcome,
    plannerDecision: initialPlannerDecision,
    handoffTo: initialPlannerDecision === "continue" ? "executor" : null,
  }).state;

  let storedState: StoredAnalysisState = {
    input: initialInput,
    result: firstRawResult,
    refinedFromObservation: false,
    sessionHistory: [],
    orchestrationState,
  };
  let signals = deriveAnalysisResultSignals({
    result: firstRawResult,
    problemDescription: initialInput.problemDescription,
    isRefined: false,
  });

  const steps: StepRecord[] = [];
  steps.push({
    stepNumber: 1,
    stage: "fresh",
    observation: null,
    output: {
      whatHappened: firstRawResult.what_happened,
      whatMatters: firstRawResult.what_matters,
      whatToDoNext: firstRawResult.what_to_do_next,
      proposedAction: firstRawResult.proposedAction ?? null,
      expectedOutcome: firstRawResult.expectedOutcome ?? null,
    },
    uiState: buildUIStateSnapshot({
      input: initialInput,
      result: firstRawResult,
      signals,
      orchestrationState,
    }),
    trace: buildAnalysisTraceRecord({
      input: initialInput,
      result: firstRawResult,
      orchestrationState,
    }),
    traceMissingFields: listMissingAnalysisTraceFields(
      buildAnalysisTraceRecord({ input: initialInput, result: firstRawResult, orchestrationState }),
    ),
    verificationState: null,
    loopStatus: signals.loopTerminationStatus,
    suggestedNextAction: signals.suggestedNextAction,
    plannerDecision: orchestrationState.plannerState.lastDecision,
    actionChainState: signals.supervisedActionChain ? (signals.decisionCommitment ? "confirmation" : "guided") : "none",
    notes: buildStepNotes({ scenario: definition, signals, orchestrationState, verificationState: null }),
  });

  for (const [index, observation] of definition.observations.entries()) {
    const currentGuidedStep = signals.currentGuidedStep ?? undefined;
    const currentGuidedStepNumber = signals.currentGuidedStepNumber || undefined;
    const followUpPrompt = buildFollowUpProblemDescription(
      storedState.input?.problemDescription ?? definition.prompt,
      observation.note,
      currentGuidedStep,
      currentGuidedStepNumber,
    );
    const sessionContext = buildExecutionSessionContextBlock({
      goal: sessionGoal,
      currentStepIndex: (storedState.input?.stepIndex ?? 1) + 1,
      previousOutcome: storedState.previousOutcome,
      steps: storedState.sessionHistory,
    });
    const followUpInput: AnalysisInput = {
      ...(storedState.input ?? initialInput),
      problemDescription: followUpPrompt,
      actionResult: observation.note,
      sessionId,
      stepIndex: (storedState.input?.stepIndex ?? 1) + 1,
      goal: sessionGoal,
      context: [
        sessionContext,
        buildExecutionOrchestrationContextBlock({ orchestration: orchestrationState }),
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
    const rawResult = await analyze(followUpInput);
    const verificationState = classifyFollowUpResult({
      originalResult: storedState.result,
      nextResult: rawResult,
      observation: observation.note,
    });
    const previousActionChainState = toStoredActionChainState({
      signals,
      verificationState: storedState.verificationState ?? "inconclusive",
    });
    const refinedResult = buildRefinedResult({
      originalResult: storedState.result,
      nextResult: rawResult,
      observation: observation.note,
      verificationState,
      priorSteps: signals.guidedStepStack,
    });
    const nextSignals = deriveAnalysisResultSignals({
      result: refinedResult,
      problemDescription: storedState.input?.problemDescription ?? definition.prompt,
      isRefined: true,
      lastObservation: observation.note,
      verificationState,
      previousActionChainState,
    });
    const nextSession = advanceExecutionSession({
      currentStepIndex: storedState.input?.stepIndex ?? 1,
      attemptedStep: signals.currentGuidedStep ?? undefined,
      actionResult: observation.note,
      verificationState,
      diagnosis: refinedResult.what_happened,
      loopTerminationStatus: nextSignals.loopTerminationStatus ?? null,
      steps: storedState.sessionHistory,
    });
    const nextPlannerAction = nextSignals.currentGuidedStep ?? refinedResult.proposedAction ?? refinedResult.what_to_do_next[0] ?? "";
    const redundantNextPlannerAction = isSemanticallyRedundantStep(nextPlannerAction, [
      signals.currentGuidedStep ?? "",
      storedState.result.proposedAction ?? "",
      storedState.result.what_to_do_next[0] ?? "",
    ]);
    const hardBlockerDetected = hasHardBlockerSignal(
      [observation.note, refinedResult.what_happened, nextPlannerAction, ...refinedResult.what_matters].filter(Boolean).join(" "),
    );
    const canRerouteSafely =
      verificationState === "falsified" && !hardBlockerDetected && Boolean(nextPlannerAction) && !redundantNextPlannerAction;
    const pauseForLowConfidence =
      !canRerouteSafely && nextSignals.suggestedNextAction === "restart-fresh" && nextSignals.confidenceLevel === "low";
    const statusOverride = pauseForLowConfidence ? "active" : undefined;
    const nextSafeAction =
      nextSignals.suggestedNextAction === "continue-thread" || pauseForLowConfidence || canRerouteSafely ? nextPlannerAction : "";
    const executorStepNumber = Math.max(1, storedState.input?.stepIndex ?? 1);
    const executorUpdated = recordExecutorOutcome({
      state: orchestrationState,
      stepNumber: executorStepNumber,
      executedAction: signals.currentGuidedStep ?? storedState.result.proposedAction ?? storedState.result.what_to_do_next[0],
      actionResult: observation.note,
      validationResult: verificationState,
      executionNotes: refinedResult.what_happened,
    });
    const advancedOrchestration = advanceExecutionOrchestration({
      state: executorUpdated.state,
      phase: executorUpdated.state.currentPhase,
      proposedAction: storedState.result.proposedAction ?? storedState.result.what_to_do_next[0],
      executedAction: signals.currentGuidedStep ?? storedState.result.proposedAction ?? storedState.result.what_to_do_next[0],
      actionResult: observation.note,
      verificationState,
      diagnosis: refinedResult.what_happened,
      loopTerminationStatus: nextSignals.loopTerminationStatus ?? null,
      nextSafeAction,
      statusOverride,
      nextPhase: deriveNextExecutionOrchestrationPhase({
        currentPhase: orchestrationState.currentPhase,
        verificationState,
        loopTerminationStatus: nextSignals.loopTerminationStatus ?? null,
        nextSafeAction,
        statusOverride,
      }),
    });
    const preliminaryPlannerDecision =
      advancedOrchestration.state.currentStatus === "complete" || nextSignals.suggestedNextAction === "stop"
        ? "complete"
        : hardBlockerDetected
          ? "block"
          : canRerouteSafely
            ? "reroute"
            : pauseForLowConfidence
              ? "continue"
              : advancedOrchestration.state.currentStatus === "blocked" || !nextSafeAction
                ? "block"
                : "continue";
    const nextSelfDirectionState = advanceExecutionSelfDirection({
      state: advancedOrchestration.state.selfDirectionState,
      verificationState,
      loopTerminationStatus: nextSignals.loopTerminationStatus ?? null,
      plannerDecision: preliminaryPlannerDecision,
      nextProposedAction: nextPlannerAction,
      nextExpectedOutcome: refinedResult.expectedOutcome ?? refinedResult.what_matters[0] ?? "",
      confidenceLevel: nextSignals.confidenceLevel,
      selectionReason:
        preliminaryPlannerDecision === "continue"
          ? "The latest executor result still supports continuing the bounded top-level goal, so AI-E selected the next queued subgoal."
          : preliminaryPlannerDecision === "reroute"
            ? "The latest executor result falsified the current subgoal, so AI-E inserted a bounded recovery subgoal."
            : preliminaryPlannerDecision === "complete"
              ? "The latest executor result satisfied the approved top-level goal, so AI-E stopped the self-directed run."
              : "The latest executor result leaves no safe next subgoal inside the bounded scope.",
      rerouteReason: verificationState === "falsified" ? refinedResult.what_happened : undefined,
      stopReason: nextSignals.suggestedNextAction === "stop" ? refinedResult.what_happened : undefined,
      blockReason: preliminaryPlannerDecision === "block" ? refinedResult.what_happened : undefined,
      pauseReason: pauseForLowConfidence
        ? "Confidence fell too low to continue the self-directed run without widening risk, so the planner paused the queue."
        : undefined,
    });
    const orchestrationWithSelfDirection = {
      ...advancedOrchestration.state,
      selfDirectionState: nextSelfDirectionState,
    };
    const plannerDecision =
      nextSelfDirectionState.selfDirectionStatus === "complete"
        ? "complete"
        : nextSelfDirectionState.selfDirectionStatus === "blocked" || nextSelfDirectionState.selfDirectionStatus === "aborted"
          ? "block"
          : preliminaryPlannerDecision;
    orchestrationState = recordPlannerHandoff({
      state: orchestrationWithSelfDirection,
      stepNumber:
        plannerDecision === "continue" || plannerDecision === "reroute"
          ? nextSession.nextStepIndex
          : executorStepNumber,
      diagnosis: refinedResult.what_happened,
      proposedAction: nextSafeAction || nextPlannerAction,
      expectedOutcome: refinedResult.expectedOutcome ?? refinedResult.what_matters[0] ?? "",
      plannerDecision,
      handoffTo: plannerDecision === "continue" || plannerDecision === "reroute" ? "executor" : null,
    }).state;

    storedState = {
      input: {
        ...(storedState.input ?? initialInput),
        actionResult: observation.note,
        stepIndex: nextSession.nextStepIndex,
        goal: sessionGoal,
      },
      result: refinedResult,
      refinedFromObservation: true,
      lastObservation: observation.note,
      previousOutcome: nextSession.previousOutcome,
      verificationState,
      lastAttemptedStep: signals.currentGuidedStep ?? undefined,
      loopTerminationStatus: nextSignals.loopTerminationStatus ?? undefined,
      actionChainState: previousActionChainState,
      sessionHistory: nextSession.steps,
      orchestrationState,
    };
    signals = nextSignals;

    const trace = buildAnalysisTraceRecord({
      input: followUpInput,
      result: refinedResult,
      isRefined: true,
      lastObservation: observation.note,
      verificationState,
      previousActionChainState,
      executedAction: signals.currentGuidedStep ?? undefined,
      orchestrationState,
    });

    steps.push({
      stepNumber: index + 2,
      stage: "follow-up",
      observation: observation.note,
      output: {
        whatHappened: refinedResult.what_happened,
        whatMatters: refinedResult.what_matters,
        whatToDoNext: refinedResult.what_to_do_next,
        proposedAction: refinedResult.proposedAction ?? null,
        expectedOutcome: refinedResult.expectedOutcome ?? null,
      },
      uiState: buildUIStateSnapshot({
        input: storedState.input ?? followUpInput,
        result: refinedResult,
        signals,
        orchestrationState,
      }),
      trace,
      traceMissingFields: listMissingAnalysisTraceFields(trace),
      verificationState,
      loopStatus: signals.loopTerminationStatus,
      suggestedNextAction: signals.suggestedNextAction,
      plannerDecision: orchestrationState.plannerState.lastDecision,
      actionChainState: signals.supervisedActionChain ? (signals.decisionCommitment ? "confirmation" : "guided") : "none",
      notes: buildStepNotes({ scenario: definition, signals, orchestrationState, verificationState }),
    });
  }

  const run: ScenarioRunRecord = {
    scenarioId: definition.id,
    category: definition.category,
    title: definition.title,
    initialPrompt: definition.prompt,
    goal: sessionGoal,
    steps,
    finalStatus: "active",
    confidenceBehavior: steps.map((step) => `${step.stepNumber}: ${step.uiState.confidence ?? "unknown"}`),
    subgoalBehavior: steps.map(
      (step) => `${step.stepNumber}: ${step.uiState.currentSubgoal ?? "none"}${step.uiState.status ? ` [${step.uiState.status}]` : ""}`,
    ),
    plannerExecutorInteraction: steps.map(
      (step) => `${step.stepNumber}: owner=${step.uiState.owner ?? "none"}; plannerDecision=${step.plannerDecision ?? "none"}; handoff=${step.uiState.lastHandoff ?? "none"}`,
    ),
    traceCompleteness: {
      allComplete: steps.every((step) => step.traceMissingFields.length === 0),
      missingFieldNames: [...new Set(steps.flatMap((step) => step.traceMissingFields))],
    },
    failurePatterns: [],
  };

  run.failurePatterns = collectFailurePatterns(run);
  run.finalStatus = finalStatusFromRun(run);
  return run;
}

function summarizeFailurePatterns(runs: ScenarioRunRecord[]) {
  const patterns = new Map<string, { count: number; scenarios: StressScenarioId[] }>();
  for (const run of runs) {
    for (const pattern of run.failurePatterns) {
      const current = patterns.get(pattern) ?? { count: 0, scenarios: [] };
      current.count += 1;
      if (!current.scenarios.includes(run.scenarioId)) {
        current.scenarios.push(run.scenarioId);
      }
      patterns.set(pattern, current);
    }
  }

  return [...patterns.entries()]
    .sort((left, right) => right[1].count - left[1].count)
    .map(([pattern, data]) => ({ pattern, reproducibility: data.count, scenarios: data.scenarios }));
}

async function main() {
  const runs: ScenarioRunRecord[] = [];
  for (const scenario of scenarios) {
    runs.push(await runScenario(scenario));
  }

  const summary = {
    scenarioCount: runs.length,
    runsByFinalStatus: runs.reduce<Record<string, number>>((accumulator, run) => {
      accumulator[run.finalStatus] = (accumulator[run.finalStatus] ?? 0) + 1;
      return accumulator;
    }, {}),
    traceCompleteRuns: runs.filter((run) => run.traceCompleteness.allComplete).length,
    topFailurePatterns: summarizeFailurePatterns(runs),
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    summary,
    runs,
  };

  const outputDirectory = resolve(process.cwd(), "..", "runner_artifacts");
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = resolve(outputDirectory, "edge_case_stress_results.json");
  writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});