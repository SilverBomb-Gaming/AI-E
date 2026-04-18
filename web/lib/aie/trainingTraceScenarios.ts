import type { FollowUpVerificationState, StoredActionChainState } from "../../components/AnalysisForm";
import {
  buildFalsifiedDiagnosis,
  buildFollowUpProblemDescription,
  buildGuidedStepStack,
  buildNextStepGuidance,
  classifyFollowUpResult,
  deriveAnalysisResultSignals,
} from "../../components/analysisResultLogic";
import type { AnalysisInput, FreeAnalysisResponse } from "./types";
import { buildAnalysisTraceRecord, type AnalysisTraceRecord } from "./analysisTrace";

type TrainingScenarioId =
  | "isolation"
  | "instrumentation"
  | "duplicate-writer"
  | "ownership"
  | "messy"
  | "falsification"
  | "pending"
  | "committed"
  | "resolved"
  | "stuck";

export type CapturedTrainingTrace = AnalysisTraceRecord & {
  scenario: TrainingScenarioId;
  pass: number;
  stage: "fresh" | "follow-up";
  observation: string | null;
};

export type CaptureTrainingScenarioTracesParams = {
  analyze: (problemDescription: string) => Promise<FreeAnalysisResponse>;
  repeatCount?: number;
  promptVariant?: "seed" | "paraphrased";
};

type PromptSet = {
  prompts: {
    isolation: string;
    instrumentation: string;
    duplicateWriter: string;
    ownership: string;
    messy: string;
    animator: string;
  };
  observations: {
    falsifies: string;
    resolves: string;
    stuck: string;
    pending: string;
    committed: string;
  };
};

const promptSets: Record<NonNullable<CaptureTrainingScenarioTracesParams["promptVariant"]>, PromptSet> = {
  seed: {
    prompts: {
      isolation:
        "After refactoring the wall-jump handoff, the player only sticks on shallow slopes right after a dash. The symptom appears immediately when that movement handoff runs, while the rest of movement feels normal.",
      instrumentation:
        "Enemies occasionally lose aggro after scene streaming, but there is no clear console error and the current checks are too sparse to tell whether the target reference is dropped before or after registration.",
      duplicateWriter:
        "Sprint speed flickers after I added a stamina limiter. The limiter writes run speed in Update, but the locomotion controller also writes speed later in the same frame, so movement keeps bouncing between two values.",
      ownership:
        "A homing missile prefab spawns correctly, but it sometimes has no target and flies straight ahead. The launcher stores the target on one object, while the spawned projectile reads from another reference, so this may be an ownership or reference handoff issue.",
      messy:
        "After one late-night pass I touched dash handling, slope friction, camera recenter, loading overlay, audio singleton, and scene bootstrap. Now the player sometimes snaps back, menus lag, music doubles, and some buttons stop responding. I'm not sure where to start because everything feels mixed together.",
      animator:
        "Player movement breaks after changing the Animator speed sync. The bad transition happens right when the Animator resume handoff runs, and the symptom seems tied to that handoff rather than the rest of movement.",
    },
    observations: {
      falsifies:
        "Disabling the stamina limiter changed nothing, but disabling the animator speed sync removes the slowdown completely.",
      resolves:
        "Passing the target reference directly into the spawned projectile fixes it and the homing works normally again.",
      stuck:
        "I tried a few different systems and nothing clearly fixed the issue, no obvious change, and it still all feels mixed together.",
      pending:
        "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
      committed:
        "The same Animator handoff still cleanly drives the symptom, and the confirm check keeps matching the expected path.",
    },
  },
  paraphrased: {
    prompts: {
      isolation:
        "After reworking the post-dash wall-jump handoff, the character only catches on shallow slopes right after a dash. The symptom appears immediately when that handoff runs, while the rest of movement still feels normal.",
      instrumentation:
        "Some enemies intermittently drop aggro after scene streaming, but there is still no clear console error. I do not have enough before-or-after registration logging to tell whether the target reference drops before registration or immediately after it.",
      duplicateWriter:
        "Ever since I added fatigue-based speed clamping, the run speed jitters between two values. One system clamps speed early in the frame, but another controller writes movement speed again later in the same frame, so I may have two writers fighting each other.",
      ownership:
        "A seeking rocket prefab spawns and launches correctly, but some shots still leave with no target and just cruise forward. The launcher stores the target on one object, while the spawned projectile reads from another reference, so this may be an ownership or reference handoff issue.",
      messy:
        "In one messy cleanup pass I changed movement blending, ground friction, pause-menu refresh, streaming UI, music startup, and bootstrap sequencing. Now inputs occasionally roll back, menus hitch, audio layers stack, and some UI clicks die. The failures feel scattered and I do not have a clean starting point.",
      animator:
        "Player movement started breaking after I changed Animator speed sync. The bad transition still appears right when the Animator resume handoff runs, and the symptom points at that handoff rather than the rest of movement.",
    },
    observations: {
      falsifies:
        "I turned off the fatigue clamp and nothing changed, but bypassing Animator speed sync removes the slowdown completely.",
      resolves:
        "Passing the target reference directly into the spawned projectile fixes it and the homing works normally again.",
      stuck:
        "I tried several different systems and nothing clearly fixed the issue, there was no obvious change, and it still all feels mixed together.",
      pending:
        "Turning off Animator speed sync now cleanly ties the symptom to the same handoff, and enabling it again brings the same bad transition back.",
      committed:
        "I repeated the same confirmation check, and the same Animator handoff still drives the symptom while the confirm result keeps matching the expected path.",
    },
  },
};

function buildInput(problemDescription: string): AnalysisInput {
  return { problemDescription };
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
  useFalsifiedDiagnosis?: boolean;
}): FreeAnalysisResponse {
  const whatHappened = params.useFalsifiedDiagnosis
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
    what_to_do_next: buildGuidedStepStack(nextStepGuidance, params.priorSteps),
  };
}

export async function captureTrainingScenarioTraces(
  params: CaptureTrainingScenarioTracesParams,
): Promise<CapturedTrainingTrace[]> {
  const repeatCount = Math.max(1, params.repeatCount ?? 1);
  const promptSet = promptSets[params.promptVariant ?? "seed"];
  const traces: CapturedTrainingTrace[] = [];

  for (let pass = 1; pass <= repeatCount; pass += 1) {
    const isolationInput = buildInput(promptSet.prompts.isolation);
    const isolationResult = await params.analyze(isolationInput.problemDescription);
    traces.push({
      scenario: "isolation",
      pass,
      stage: "fresh",
      observation: null,
      ...buildAnalysisTraceRecord({ input: isolationInput, result: isolationResult }),
    });

    const instrumentationInput = buildInput(promptSet.prompts.instrumentation);
    const instrumentationResult = await params.analyze(instrumentationInput.problemDescription);
    traces.push({
      scenario: "instrumentation",
      pass,
      stage: "fresh",
      observation: null,
      ...buildAnalysisTraceRecord({ input: instrumentationInput, result: instrumentationResult }),
    });

    const duplicateInput = buildInput(promptSet.prompts.duplicateWriter);
    const duplicateResult = await params.analyze(duplicateInput.problemDescription);
    const duplicateSignals = deriveAnalysisResultSignals({
      result: duplicateResult,
      problemDescription: duplicateInput.problemDescription,
      isRefined: false,
    });
    traces.push({
      scenario: "duplicate-writer",
      pass,
      stage: "fresh",
      observation: null,
      ...buildAnalysisTraceRecord({ input: duplicateInput, result: duplicateResult }),
    });

    const ownershipInput = buildInput(promptSet.prompts.ownership);
    const ownershipResult = await params.analyze(ownershipInput.problemDescription);
    traces.push({
      scenario: "ownership",
      pass,
      stage: "fresh",
      observation: null,
      ...buildAnalysisTraceRecord({ input: ownershipInput, result: ownershipResult }),
    });

    const ownershipSignals = deriveAnalysisResultSignals({
      result: ownershipResult,
      problemDescription: ownershipInput.problemDescription,
      isRefined: false,
    });

    const messyInput = buildInput(promptSet.prompts.messy);
    const messyResult = await params.analyze(messyInput.problemDescription);
    const messySignals = deriveAnalysisResultSignals({
      result: messyResult,
      problemDescription: messyInput.problemDescription,
      isRefined: false,
    });
    traces.push({
      scenario: "messy",
      pass,
      stage: "fresh",
      observation: null,
      ...buildAnalysisTraceRecord({ input: messyInput, result: messyResult }),
    });

    const falsifyPrompt = buildFollowUpProblemDescription(
      duplicateInput.problemDescription,
      promptSet.observations.falsifies,
      duplicateSignals.currentGuidedStep ?? undefined,
      duplicateSignals.currentGuidedStepNumber || undefined,
    );
    const falsifyRawResult = await params.analyze(falsifyPrompt);
    const falsifyVerification = classifyFollowUpResult({
      originalResult: duplicateResult,
      nextResult: falsifyRawResult,
      observation: promptSet.observations.falsifies,
    });
    const falsifyResult = buildRefinedResult({
      originalResult: duplicateResult,
      nextResult: falsifyRawResult,
      observation: promptSet.observations.falsifies,
      verificationState: falsifyVerification,
      priorSteps: duplicateSignals.guidedStepStack,
      useFalsifiedDiagnosis: true,
    });
    traces.push({
      scenario: "falsification",
      pass,
      stage: "follow-up",
      observation: promptSet.observations.falsifies,
      ...buildAnalysisTraceRecord({
        input: duplicateInput,
        result: falsifyResult,
        isRefined: true,
        lastObservation: promptSet.observations.falsifies,
        verificationState: falsifyVerification,
        previousActionChainState: toStoredActionChainState({
          signals: duplicateSignals,
          verificationState: "inconclusive",
        }),
      }),
    });

    const resolvePrompt = buildFollowUpProblemDescription(
      ownershipInput.problemDescription,
      promptSet.observations.resolves,
      ownershipSignals.currentGuidedStep ?? undefined,
      ownershipSignals.currentGuidedStepNumber || undefined,
    );
    const resolveRawResult = await params.analyze(resolvePrompt);
    const resolveVerification = classifyFollowUpResult({
      originalResult: ownershipResult,
      nextResult: resolveRawResult,
      observation: promptSet.observations.resolves,
    });
    const resolveResult = buildRefinedResult({
      originalResult: ownershipResult,
      nextResult: resolveRawResult,
      observation: promptSet.observations.resolves,
      verificationState: resolveVerification,
      priorSteps: ownershipSignals.guidedStepStack,
    });
    traces.push({
      scenario: "resolved",
      pass,
      stage: "follow-up",
      observation: promptSet.observations.resolves,
      ...buildAnalysisTraceRecord({
        input: ownershipInput,
        result: resolveResult,
        isRefined: true,
        lastObservation: promptSet.observations.resolves,
        verificationState: resolveVerification,
        previousActionChainState: toStoredActionChainState({
          signals: ownershipSignals,
          verificationState: "inconclusive",
        }),
      }),
    });

    const stuckPrompt = buildFollowUpProblemDescription(
      messyInput.problemDescription,
      promptSet.observations.stuck,
      messySignals.currentGuidedStep ?? undefined,
      messySignals.currentGuidedStepNumber || undefined,
    );
    const stuckRawResult = await params.analyze(stuckPrompt);
    const stuckVerification = classifyFollowUpResult({
      originalResult: messyResult,
      nextResult: stuckRawResult,
      observation: promptSet.observations.stuck,
    });
    const stuckResult = buildRefinedResult({
      originalResult: messyResult,
      nextResult: stuckRawResult,
      observation: promptSet.observations.stuck,
      verificationState: stuckVerification,
      priorSteps: messySignals.guidedStepStack,
    });
    traces.push({
      scenario: "stuck",
      pass,
      stage: "follow-up",
      observation: promptSet.observations.stuck,
      ...buildAnalysisTraceRecord({
        input: messyInput,
        result: stuckResult,
        isRefined: true,
        lastObservation: promptSet.observations.stuck,
        verificationState: stuckVerification,
        previousActionChainState: toStoredActionChainState({
          signals: messySignals,
          verificationState: "inconclusive",
        }),
      }),
    });

    const animatorInput = buildInput(promptSet.prompts.animator);
    const animatorResult = await params.analyze(animatorInput.problemDescription);
    const animatorSignals = deriveAnalysisResultSignals({
      result: animatorResult,
      problemDescription: animatorInput.problemDescription,
      isRefined: false,
    });

    const pendingPrompt = buildFollowUpProblemDescription(
      animatorInput.problemDescription,
      promptSet.observations.pending,
      animatorSignals.currentGuidedStep ?? undefined,
      animatorSignals.currentGuidedStepNumber || undefined,
    );
    const pendingRawResult = await params.analyze(pendingPrompt);
    const pendingVerification = classifyFollowUpResult({
      originalResult: animatorResult,
      nextResult: pendingRawResult,
      observation: promptSet.observations.pending,
    });
    const pendingResult = buildRefinedResult({
      originalResult: animatorResult,
      nextResult: pendingRawResult,
      observation: promptSet.observations.pending,
      verificationState: pendingVerification,
      priorSteps: animatorSignals.guidedStepStack,
    });
    const pendingPreviousState = toStoredActionChainState({
      signals: animatorSignals,
      verificationState: "inconclusive",
    });
    traces.push({
      scenario: "pending",
      pass,
      stage: "follow-up",
      observation: promptSet.observations.pending,
      ...buildAnalysisTraceRecord({
        input: animatorInput,
        result: pendingResult,
        isRefined: true,
        lastObservation: promptSet.observations.pending,
        verificationState: pendingVerification,
        previousActionChainState: pendingPreviousState,
      }),
    });

    const pendingSignals = deriveAnalysisResultSignals({
      result: pendingResult,
      problemDescription: animatorInput.problemDescription,
      isRefined: true,
      lastObservation: promptSet.observations.pending,
      verificationState: pendingVerification,
      previousActionChainState: pendingPreviousState,
    });
    const committedPrompt = buildFollowUpProblemDescription(
      animatorInput.problemDescription,
      promptSet.observations.committed,
      pendingSignals.currentGuidedStep ?? undefined,
      pendingSignals.currentGuidedStepNumber || undefined,
    );
    const committedRawResult = await params.analyze(committedPrompt);
    const committedVerification = classifyFollowUpResult({
      originalResult: pendingResult,
      nextResult: committedRawResult,
      observation: promptSet.observations.committed,
    });
    const committedResult = buildRefinedResult({
      originalResult: pendingResult,
      nextResult: committedRawResult,
      observation: promptSet.observations.committed,
      verificationState: committedVerification,
      priorSteps: pendingSignals.guidedStepStack,
    });
    traces.push({
      scenario: "committed",
      pass,
      stage: "follow-up",
      observation: promptSet.observations.committed,
      ...buildAnalysisTraceRecord({
        input: animatorInput,
        result: committedResult,
        isRefined: true,
        lastObservation: promptSet.observations.committed,
        verificationState: committedVerification,
        previousActionChainState: toStoredActionChainState({
          signals: pendingSignals,
          verificationState: pendingVerification,
        }),
      }),
    });
  }

  return traces;
}