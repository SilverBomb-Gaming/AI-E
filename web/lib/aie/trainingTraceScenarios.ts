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
  | "stuck"
  | "complex-async-race-fresh"
  | "complex-async-race-converging"
  | "complex-async-race-pending"
  | "complex-async-race-committed"
  | "complex-state-desync-fresh"
  | "complex-state-desync-converging"
  | "complex-state-desync-pending"
  | "complex-state-desync-committed"
  | "complex-regression-fresh"
  | "complex-regression-converging"
  | "complex-regression-pending"
  | "complex-regression-committed"
  | "game-mechanic-tuning-hypothesis"
  | "game-mechanic-tuning-action"
  | "game-mechanic-tuning-validation"
  | "game-player-feedback-hypothesis"
  | "game-player-feedback-action"
  | "game-player-feedback-validation"
  | "game-balance-hypothesis"
  | "game-balance-action"
  | "game-balance-validation"
  | "game-system-design-hypothesis"
  | "game-system-design-action"
  | "game-system-design-validation"
  | "game-feature-refinement-hypothesis"
  | "game-feature-refinement-action"
  | "game-feature-refinement-validation";

type TrainingScenarioSet = "baseline" | "complex" | "game-dev";

export type CapturedTrainingTrace = AnalysisTraceRecord & {
  scenario: TrainingScenarioId;
  pass: number;
  stage: "fresh" | "follow-up";
  observation: string | null;
  sessionId: string;
  stepIndex: number;
  goal: string;
};

export type CaptureTrainingScenarioTracesParams = {
  analyze: (problemDescription: string) => Promise<FreeAnalysisResponse>;
  repeatCount?: number;
  promptVariant?: "seed" | "paraphrased";
  scenarioSet?: TrainingScenarioSet;
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

type ComplexPromptSet = {
  asyncRace: {
    prompt: string;
    observations: {
      converges: string;
      pending: string;
      committed: string;
    };
  };
  stateDesync: {
    prompt: string;
    observations: {
      converges: string;
      pending: string;
      committed: string;
    };
  };
  regression: {
    prompt: string;
    observations: {
      converges: string;
      pending: string;
      committed: string;
    };
  };
};

type GameDevPromptSet = {
  mechanicTuning: {
    goal: string;
    prompt: string;
    observations: {
      action: string;
      validation: string;
    };
  };
  playerFeedback: {
    goal: string;
    prompt: string;
    observations: {
      action: string;
      validation: string;
    };
  };
  balancing: {
    goal: string;
    prompt: string;
    observations: {
      action: string;
      validation: string;
    };
  };
  systemDesign: {
    goal: string;
    prompt: string;
    observations: {
      action: string;
      validation: string;
    };
  };
  featureRefinement: {
    goal: string;
    prompt: string;
    observations: {
      action: string;
      validation: string;
    };
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

const complexPromptSets: Record<NonNullable<CaptureTrainingScenarioTracesParams["promptVariant"]>, ComplexPromptSet> = {
  seed: {
    asyncRace: {
      prompt:
        "During scene streaming, the inventory HUD intermittently opens empty on the first try after loading into combat, but if I close and reopen it the items appear. There is no clear console error, and the current timing checks are too sparse to tell whether the data-ready event arrives before the HUD subscribes or whether the subscription itself is late, so this looks like an async ordering issue rather than a broad inventory failure.",
      observations: {
        converges:
          "I isolated the subscription timing by delaying the HUD hookup until after the data-ready callback, and the empty panel is much rarer now, but it still shows up on slower loads, so the same timing path still looks implicated.",
        pending:
          "Timestamp logging now cleanly shows the empty panel only on loads where the data-ready event fires before the HUD subscribes, and when I force the subscription to happen first the symptom disappears.",
        committed:
          "I repeated the same timestamp check across several slow loads, and the same event-order mismatch keeps matching the empty-panel symptom every time.",
      },
    },
    stateDesync: {
      prompt:
        "After respawn, the stamina ring and dodge gate sometimes disagree for a second or two right as the respawn restore handoff runs: the HUD shows full stamina, but gameplay still thinks stamina is empty, while the rest of stamina behavior feels normal. One system restores from a replicated snapshot while another reads a cached local state reference, so this looks like a state desynchronization problem across two systems instead of a broad stamina failure.",
      observations: {
        converges:
          "When I isolate the cached-versus-live handoff by forcing both systems to read the same live stamina snapshot, the mismatch gets much weaker, but reconnecting still brings back that same weaker mismatch, so the same split still looks involved.",
        pending:
          "Switching the dodge gate back to the cached snapshot now cleanly brings the mismatch back, and when both the HUD and gate read the same live stamina reference the bad state clears.",
        committed:
          "I repeated that same snapshot toggle on multiple respawns, and the same split between cached and live stamina keeps matching the mismatch every time.",
      },
    },
    regression: {
      prompt:
        "After a partial fix that moved the pause-overlay refresh later, combat input feels better, but now the aim reticle sometimes lags and audio ducking flickers when slow-motion exits. The regression clusters around the resume handoff between overlay teardown, input restore, and audio recovery, so this looks like a multi-system interaction around one transition.",
      observations: {
        converges:
          "Disabling the delayed overlay refresh removes most of the reticle lag, but the audio ducking flicker still shows up on some slow-motion exits.",
        pending:
          "If I leave the partial overlay fix in place and only bypass that same resume handoff, both the reticle lag and the audio ducking flicker disappear together, and restoring that handoff brings both regressions back.",
        committed:
          "I repeated the same resume-handoff check across several slow-motion exits, and that same transition still drives both regressions while the confirm result keeps matching the expected path.",
      },
    },
  },
  paraphrased: {
    asyncRace: {
      prompt:
        "After combat scenes stream in, the inventory UI sometimes comes up blank the first time it opens, but the items appear if I close it and open it again. There is no clear console error, and the current timing checks are too sparse to tell whether the data-ready event beats the HUD subscription or whether the HUD subscribes late, so this looks like an async event-ordering race instead of a general inventory bug.",
      observations: {
        converges:
          "I isolated the subscription timing by moving the HUD hookup to happen after the data-ready callback, and the blank panel is much less common now, but it still appears on slow loads, so the same timing path still looks involved.",
        pending:
          "The timestamp logs now cleanly show the blank panel only when the data-ready event arrives before the HUD subscription, and forcing the subscription to happen first clears the symptom.",
        committed:
          "I reran the same timestamp check across several slow loads, and the same event-order mismatch keeps lining up with the blank-panel failure.",
      },
    },
    stateDesync: {
      prompt:
        "Right after respawn, the stamina meter and the dodge gate sometimes disagree for a moment right as the respawn restore handoff runs: the HUD says stamina is full, but gameplay still behaves like it is empty, while the rest of stamina behavior feels normal. One side restores from a replicated snapshot while the other reads a cached local state reference, so this looks like state desync between two systems instead of a broad stamina failure.",
      observations: {
        converges:
          "I isolated the cached-versus-live handoff by making both systems read the same live stamina snapshot, and the mismatch gets much weaker, but reconnecting still brings back that same weaker mismatch, so the same split still looks involved.",
        pending:
          "Putting the dodge gate back on the cached snapshot cleanly brings the mismatch back, and when both the HUD and gate read the same live stamina reference the bad state disappears.",
        committed:
          "I repeated that same cached-versus-live snapshot toggle on several respawns, and the same split keeps matching the mismatch every time.",
      },
    },
    regression: {
      prompt:
        "A partial fix moved the pause-overlay refresh later and improved combat input, but now the aim reticle occasionally drags and audio ducking flickers when slow-motion ends. Both regressions cluster around the resume handoff between overlay teardown, input recovery, and audio recovery, so this looks like a multi-system transition issue.",
      observations: {
        converges:
          "Turning off the delayed overlay refresh removes most of the reticle drag, but the audio ducking flicker still returns on some slow-motion exits.",
        pending:
          "Keeping the partial overlay fix but bypassing that same resume handoff removes both the reticle drag and the audio ducking flicker together, and restoring that handoff brings both regressions back.",
        committed:
          "I repeated the same resume-handoff confirmation across several slow-motion exits, and that same transition keeps matching both regressions while the confirm result stays consistent.",
      },
    },
  },
};

const gameDevPromptSets: Record<NonNullable<CaptureTrainingScenarioTracesParams["promptVariant"]>, GameDevPromptSet> = {
  seed: {
    mechanicTuning: {
      goal: "Tune ledge-jump forgiveness so the platformer feels responsive without making takeoff sticky.",
      prompt:
        "After widening jump buffer and coyote time together, the platformer jump now feels sticky at ledges. Players still clear the same gaps, but the character leaves the ground a beat later than intended, so this looks like a mechanic tuning overlap rather than a broken jump system.",
      observations: {
        action:
          "Reducing only the coyote window immediately makes takeoff timing feel cleaner, while the wider jump buffer still preserves missed-input forgiveness.",
        validation:
          "I reran the same ledge-gap sequence with the smaller coyote window, and the takeoff now feels consistent without reintroducing missed jumps.",
      },
    },
    playerFeedback: {
      goal: "Tighten the parry feedback loop so players can reliably read the success timing in combat.",
      prompt:
        "During combat playtests, players keep missing perfect-parry timing because the flash cue, hit-stop, and audio ping land slightly out of sync. The mechanic works, but the feedback loop is hard to read, so this looks like clarity iteration rather than a broken input path.",
      observations: {
        action:
          "Aligning the screen flash to the same frame as the audio ping makes the timing much easier to read, even before touching the hit-stop amount.",
        validation:
          "With the flash and audio synced, three repeated parry tests now feel readable and players stop guessing on the cue timing.",
      },
    },
    balancing: {
      goal: "Restore weapon-role balance so the shotgun stays strong without erasing the sidearm's purpose.",
      prompt:
        "After boosting shotgun pellet damage and ammo drops together, close-range encounters collapse too fast and players ignore the sidearm. The weapons still function, but the balance pass now over-rewards one loadout, so this looks like a tuning issue across damage and economy.",
      observations: {
        action:
          "Rolling back only the bonus ammo drops restores some weapon rotation, while the higher pellet damage still keeps the shotgun attractive in close quarters.",
        validation:
          "A second combat pass with lower ammo drops keeps the shotgun strong without erasing the sidearm's role in longer encounters.",
      },
    },
    systemDesign: {
      goal: "Reinforce the intended explore-plan-craft loop around the mod bench without blocking progression.",
      prompt:
        "The crafting bench now unlocks weapon mods as soon as parts are collected, but players no longer understand when exploration, crafting, or upgrade planning should happen. The feature works, yet the system loop feels flattened, so this looks like a system design iteration problem.",
      observations: {
        action:
          "Gating mod previews behind the bench while leaving part collection in the field makes the loop easier to read: exploration finds parts, the bench reveals choices, then crafting commits the build.",
        validation:
          "A repeated onboarding run with the gated preview restores the intended explore-then-plan rhythm without blocking progression.",
      },
    },
    featureRefinement: {
      goal: "Refine the companion command wheel so fast access does not create accidental command misfires.",
      prompt:
        "The companion command wheel now opens faster, but players keep issuing the wrong order because the cursor snaps to the previous slot and the confirm pulse is too subtle. The feature is present, but the refinement pass introduced friction in the selection feel.",
      observations: {
        action:
          "Resetting the cursor to the neutral slot on open removes most misfires, even before increasing the confirm pulse.",
        validation:
          "After resetting the cursor and replaying the same encounter setup, command selection feels deliberate and the wrong-order misfires stop showing up.",
      },
    },
  },
  paraphrased: {
    mechanicTuning: {
      goal: "Tune ledge-jump forgiveness so the platformer feels responsive without making takeoff sticky.",
      prompt:
        "After increasing jump buffer and coyote time in the same pass, ledge takeoff now feels sticky. Players can still clear the target gaps, but the jump leaves the ground slightly later than intended, so this reads like a mechanic tuning overlap rather than a broken jump path.",
      observations: {
        action:
          "Shrinking only the coyote window immediately cleans up takeoff timing, while the wider jump buffer still preserves the missed-input safety net.",
        validation:
          "I repeated the same ledge-gap route with the smaller coyote window, and jump timing now feels consistent without bringing back missed jumps.",
      },
    },
    playerFeedback: {
      goal: "Tighten the parry feedback loop so players can reliably read the success timing in combat.",
      prompt:
        "In combat playtests, players keep missing the perfect-parry window because the flash cue, hit-stop, and audio ping are slightly out of sync. The parry still functions, but the feedback loop is hard to read, so this looks like clarity iteration rather than a broken input route.",
      observations: {
        action:
          "Snapping the screen flash to the same frame as the audio ping makes the timing much easier to read, even before changing the hit-stop amount.",
        validation:
          "With flash and audio now synced, repeated parry checks feel readable and players stop guessing on the timing cue.",
      },
    },
    balancing: {
      goal: "Restore weapon-role balance so the shotgun stays strong without erasing the sidearm's purpose.",
      prompt:
        "A balance pass increased both shotgun pellet damage and ammo drops, and now close-range encounters end too quickly while players ignore the sidearm. The weapons still work, but one loadout is over-rewarded, so this looks like a tuning issue across damage and economy.",
      observations: {
        action:
          "Rolling back only the extra ammo drops restores weapon rotation, while the higher pellet damage still keeps the shotgun appealing in close quarters.",
        validation:
          "A second combat pass with fewer ammo drops keeps the shotgun strong without erasing the sidearm's longer-encounter role.",
      },
    },
    systemDesign: {
      goal: "Reinforce the intended explore-plan-craft loop around the mod bench without blocking progression.",
      prompt:
        "The crafting bench now exposes weapon mods as soon as parts are picked up, but players no longer understand when exploration, planning, or crafting is supposed to happen. The feature works, yet the system loop feels flattened, so this looks like a system design iteration problem.",
      observations: {
        action:
          "Keeping part collection in the field but moving mod previews back to the bench makes the loop clearer: explore first, review options at the bench, then commit the craft.",
        validation:
          "A repeated onboarding route with the gated preview restores the intended explore-then-plan rhythm without blocking progression.",
      },
    },
    featureRefinement: {
      goal: "Refine the companion command wheel so fast access does not create accidental command misfires.",
      prompt:
        "The companion command wheel opens faster now, but players keep issuing the wrong order because the cursor snaps to the previous slot and the confirm pulse is too subtle. The feature exists, but the refinement pass introduced friction in the selection feel.",
      observations: {
        action:
          "Resetting the cursor to the neutral slot each time the wheel opens removes most misfires, even before increasing the confirm pulse.",
        validation:
          "After resetting the cursor and replaying the same encounter setup, command selection feels deliberate and the wrong-order misfires stop appearing.",
      },
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

function buildSessionMetadata(sessionId: string, stepIndex: number, goal: string) {
  return {
    sessionId,
    stepIndex,
    goal,
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
  const promptVariant = params.promptVariant ?? "seed";
  const promptSet = promptSets[promptVariant];
  const complexPromptSet = complexPromptSets[promptVariant];
  const gameDevPromptSet = gameDevPromptSets[promptVariant];
  const scenarioSet = params.scenarioSet ?? "baseline";
  const traces: CapturedTrainingTrace[] = [];

  async function captureFreshScenario(paramsForFresh: {
    scenario: TrainingScenarioId;
    pass: number;
    prompt: string;
    sessionId: string;
    stepIndex: number;
    goal: string;
  }) {
    const input = buildInput(paramsForFresh.prompt);
    const result = await params.analyze(input.problemDescription);
    const signals = deriveAnalysisResultSignals({
      result,
      problemDescription: input.problemDescription,
      isRefined: false,
    });

    traces.push({
      scenario: paramsForFresh.scenario,
      pass: paramsForFresh.pass,
      stage: "fresh",
      observation: null,
      ...buildSessionMetadata(paramsForFresh.sessionId, paramsForFresh.stepIndex, paramsForFresh.goal),
      ...buildAnalysisTraceRecord({ input, result }),
    });

    return { input, result, signals, verificationState: undefined as FollowUpVerificationState | undefined };
  }

  async function captureFollowUpScenario(paramsForFollowUp: {
    scenario: TrainingScenarioId;
    pass: number;
    context: {
      input: AnalysisInput;
      result: FreeAnalysisResponse;
      signals: ReturnType<typeof deriveAnalysisResultSignals>;
      verificationState?: FollowUpVerificationState;
    };
    observation: string;
    useFalsifiedDiagnosis?: boolean;
    sessionId: string;
    stepIndex: number;
    goal: string;
  }) {
    const previousActionChainState = toStoredActionChainState({
      signals: paramsForFollowUp.context.signals,
      verificationState: paramsForFollowUp.context.verificationState ?? "inconclusive",
    });
    const followUpPrompt = buildFollowUpProblemDescription(
      paramsForFollowUp.context.input.problemDescription,
      paramsForFollowUp.observation,
      paramsForFollowUp.context.signals.currentGuidedStep ?? undefined,
      paramsForFollowUp.context.signals.currentGuidedStepNumber || undefined,
    );
    const rawResult = await params.analyze(followUpPrompt);
    const verificationState = classifyFollowUpResult({
      originalResult: paramsForFollowUp.context.result,
      nextResult: rawResult,
      observation: paramsForFollowUp.observation,
    });
    const result = buildRefinedResult({
      originalResult: paramsForFollowUp.context.result,
      nextResult: rawResult,
      observation: paramsForFollowUp.observation,
      verificationState,
      priorSteps: paramsForFollowUp.context.signals.guidedStepStack,
      useFalsifiedDiagnosis: paramsForFollowUp.useFalsifiedDiagnosis,
    });

    traces.push({
      scenario: paramsForFollowUp.scenario,
      pass: paramsForFollowUp.pass,
      stage: "follow-up",
      observation: paramsForFollowUp.observation,
      ...buildSessionMetadata(paramsForFollowUp.sessionId, paramsForFollowUp.stepIndex, paramsForFollowUp.goal),
      ...buildAnalysisTraceRecord({
        input: paramsForFollowUp.context.input,
        result,
        isRefined: true,
        lastObservation: paramsForFollowUp.observation,
        verificationState,
        previousActionChainState,
      }),
    });

    const signals = deriveAnalysisResultSignals({
      result,
      problemDescription: paramsForFollowUp.context.input.problemDescription,
      isRefined: true,
      lastObservation: paramsForFollowUp.observation,
      verificationState,
      previousActionChainState,
    });

    return {
      input: paramsForFollowUp.context.input,
      result,
      signals,
      verificationState,
    };
  }

  for (let pass = 1; pass <= repeatCount; pass += 1) {
    if (scenarioSet === "complex") {
      const asyncRaceSessionId = `complex-async-race-pass-${pass}`;
      const asyncRaceFresh = await captureFreshScenario({
        scenario: "complex-async-race-fresh",
        pass,
        prompt: complexPromptSet.asyncRace.prompt,
        sessionId: asyncRaceSessionId,
        stepIndex: 1,
        goal: "Confirm whether HUD subscription timing is causing the blank inventory panel.",
      });
      const asyncRaceConverging = await captureFollowUpScenario({
        scenario: "complex-async-race-converging",
        pass,
        context: asyncRaceFresh,
        observation: complexPromptSet.asyncRace.observations.converges,
        sessionId: asyncRaceSessionId,
        stepIndex: 2,
        goal: "Confirm whether HUD subscription timing is causing the blank inventory panel.",
      });
      const asyncRacePending = await captureFollowUpScenario({
        scenario: "complex-async-race-pending",
        pass,
        context: asyncRaceConverging,
        observation: complexPromptSet.asyncRace.observations.pending,
        sessionId: asyncRaceSessionId,
        stepIndex: 3,
        goal: "Confirm whether HUD subscription timing is causing the blank inventory panel.",
      });
      await captureFollowUpScenario({
        scenario: "complex-async-race-committed",
        pass,
        context: asyncRacePending,
        observation: complexPromptSet.asyncRace.observations.committed,
        sessionId: asyncRaceSessionId,
        stepIndex: 4,
        goal: "Confirm whether HUD subscription timing is causing the blank inventory panel.",
      });

      const stateDesyncSessionId = `complex-state-desync-pass-${pass}`;
      const stateDesyncFresh = await captureFreshScenario({
        scenario: "complex-state-desync-fresh",
        pass,
        prompt: complexPromptSet.stateDesync.prompt,
        sessionId: stateDesyncSessionId,
        stepIndex: 1,
        goal: "Unify stamina state handoff so HUD and gameplay resolve the same snapshot after respawn.",
      });
      const stateDesyncConverging = await captureFollowUpScenario({
        scenario: "complex-state-desync-converging",
        pass,
        context: stateDesyncFresh,
        observation: complexPromptSet.stateDesync.observations.converges,
        sessionId: stateDesyncSessionId,
        stepIndex: 2,
        goal: "Unify stamina state handoff so HUD and gameplay resolve the same snapshot after respawn.",
      });
      const stateDesyncPending = await captureFollowUpScenario({
        scenario: "complex-state-desync-pending",
        pass,
        context: stateDesyncConverging,
        observation: complexPromptSet.stateDesync.observations.pending,
        sessionId: stateDesyncSessionId,
        stepIndex: 3,
        goal: "Unify stamina state handoff so HUD and gameplay resolve the same snapshot after respawn.",
      });
      await captureFollowUpScenario({
        scenario: "complex-state-desync-committed",
        pass,
        context: stateDesyncPending,
        observation: complexPromptSet.stateDesync.observations.committed,
        sessionId: stateDesyncSessionId,
        stepIndex: 4,
        goal: "Unify stamina state handoff so HUD and gameplay resolve the same snapshot after respawn.",
      });

      const regressionSessionId = `complex-regression-pass-${pass}`;
      const regressionFresh = await captureFreshScenario({
        scenario: "complex-regression-fresh",
        pass,
        prompt: complexPromptSet.regression.prompt,
        sessionId: regressionSessionId,
        stepIndex: 1,
        goal: "Stabilize the pause-resume handoff so the partial fix stops causing cross-system regressions.",
      });
      const regressionConverging = await captureFollowUpScenario({
        scenario: "complex-regression-converging",
        pass,
        context: regressionFresh,
        observation: complexPromptSet.regression.observations.converges,
        sessionId: regressionSessionId,
        stepIndex: 2,
        goal: "Stabilize the pause-resume handoff so the partial fix stops causing cross-system regressions.",
      });
      const regressionPending = await captureFollowUpScenario({
        scenario: "complex-regression-pending",
        pass,
        context: regressionConverging,
        observation: complexPromptSet.regression.observations.pending,
        sessionId: regressionSessionId,
        stepIndex: 3,
        goal: "Stabilize the pause-resume handoff so the partial fix stops causing cross-system regressions.",
      });
      await captureFollowUpScenario({
        scenario: "complex-regression-committed",
        pass,
        context: regressionPending,
        observation: complexPromptSet.regression.observations.committed,
        sessionId: regressionSessionId,
        stepIndex: 4,
        goal: "Stabilize the pause-resume handoff so the partial fix stops causing cross-system regressions.",
      });

      continue;
    }

    if (scenarioSet === "game-dev") {
      const mechanicSessionId = `game-mechanic-tuning-pass-${pass}`;
      const mechanicFresh = await captureFreshScenario({
        scenario: "game-mechanic-tuning-hypothesis",
        pass,
        prompt: gameDevPromptSet.mechanicTuning.prompt,
        sessionId: mechanicSessionId,
        stepIndex: 1,
        goal: gameDevPromptSet.mechanicTuning.goal,
      });
      const mechanicAction = await captureFollowUpScenario({
        scenario: "game-mechanic-tuning-action",
        pass,
        context: mechanicFresh,
        observation: gameDevPromptSet.mechanicTuning.observations.action,
        sessionId: mechanicSessionId,
        stepIndex: 2,
        goal: gameDevPromptSet.mechanicTuning.goal,
      });
      await captureFollowUpScenario({
        scenario: "game-mechanic-tuning-validation",
        pass,
        context: mechanicAction,
        observation: gameDevPromptSet.mechanicTuning.observations.validation,
        sessionId: mechanicSessionId,
        stepIndex: 3,
        goal: gameDevPromptSet.mechanicTuning.goal,
      });

      const feedbackSessionId = `game-player-feedback-pass-${pass}`;
      const feedbackFresh = await captureFreshScenario({
        scenario: "game-player-feedback-hypothesis",
        pass,
        prompt: gameDevPromptSet.playerFeedback.prompt,
        sessionId: feedbackSessionId,
        stepIndex: 1,
        goal: gameDevPromptSet.playerFeedback.goal,
      });
      const feedbackAction = await captureFollowUpScenario({
        scenario: "game-player-feedback-action",
        pass,
        context: feedbackFresh,
        observation: gameDevPromptSet.playerFeedback.observations.action,
        sessionId: feedbackSessionId,
        stepIndex: 2,
        goal: gameDevPromptSet.playerFeedback.goal,
      });
      await captureFollowUpScenario({
        scenario: "game-player-feedback-validation",
        pass,
        context: feedbackAction,
        observation: gameDevPromptSet.playerFeedback.observations.validation,
        sessionId: feedbackSessionId,
        stepIndex: 3,
        goal: gameDevPromptSet.playerFeedback.goal,
      });

      const balanceSessionId = `game-balance-pass-${pass}`;
      const balanceFresh = await captureFreshScenario({
        scenario: "game-balance-hypothesis",
        pass,
        prompt: gameDevPromptSet.balancing.prompt,
        sessionId: balanceSessionId,
        stepIndex: 1,
        goal: gameDevPromptSet.balancing.goal,
      });
      const balanceAction = await captureFollowUpScenario({
        scenario: "game-balance-action",
        pass,
        context: balanceFresh,
        observation: gameDevPromptSet.balancing.observations.action,
        sessionId: balanceSessionId,
        stepIndex: 2,
        goal: gameDevPromptSet.balancing.goal,
      });
      await captureFollowUpScenario({
        scenario: "game-balance-validation",
        pass,
        context: balanceAction,
        observation: gameDevPromptSet.balancing.observations.validation,
        sessionId: balanceSessionId,
        stepIndex: 3,
        goal: gameDevPromptSet.balancing.goal,
      });

      const systemDesignSessionId = `game-system-design-pass-${pass}`;
      const systemDesignFresh = await captureFreshScenario({
        scenario: "game-system-design-hypothesis",
        pass,
        prompt: gameDevPromptSet.systemDesign.prompt,
        sessionId: systemDesignSessionId,
        stepIndex: 1,
        goal: gameDevPromptSet.systemDesign.goal,
      });
      const systemDesignAction = await captureFollowUpScenario({
        scenario: "game-system-design-action",
        pass,
        context: systemDesignFresh,
        observation: gameDevPromptSet.systemDesign.observations.action,
        sessionId: systemDesignSessionId,
        stepIndex: 2,
        goal: gameDevPromptSet.systemDesign.goal,
      });
      await captureFollowUpScenario({
        scenario: "game-system-design-validation",
        pass,
        context: systemDesignAction,
        observation: gameDevPromptSet.systemDesign.observations.validation,
        sessionId: systemDesignSessionId,
        stepIndex: 3,
        goal: gameDevPromptSet.systemDesign.goal,
      });

      const featureSessionId = `game-feature-refinement-pass-${pass}`;
      const featureFresh = await captureFreshScenario({
        scenario: "game-feature-refinement-hypothesis",
        pass,
        prompt: gameDevPromptSet.featureRefinement.prompt,
        sessionId: featureSessionId,
        stepIndex: 1,
        goal: gameDevPromptSet.featureRefinement.goal,
      });
      const featureAction = await captureFollowUpScenario({
        scenario: "game-feature-refinement-action",
        pass,
        context: featureFresh,
        observation: gameDevPromptSet.featureRefinement.observations.action,
        sessionId: featureSessionId,
        stepIndex: 2,
        goal: gameDevPromptSet.featureRefinement.goal,
      });
      await captureFollowUpScenario({
        scenario: "game-feature-refinement-validation",
        pass,
        context: featureAction,
        observation: gameDevPromptSet.featureRefinement.observations.validation,
        sessionId: featureSessionId,
        stepIndex: 3,
        goal: gameDevPromptSet.featureRefinement.goal,
      });

      continue;
    }

    const isolationInput = buildInput(promptSet.prompts.isolation);
    const isolationResult = await params.analyze(isolationInput.problemDescription);
    traces.push({
      scenario: "isolation",
      pass,
      stage: "fresh",
      observation: null,
      ...buildSessionMetadata(
        `baseline-isolation-pass-${pass}`,
        1,
        "Isolate the wall-jump handoff without widening the investigation to unrelated movement systems.",
      ),
      ...buildAnalysisTraceRecord({ input: isolationInput, result: isolationResult }),
    });

    const instrumentationInput = buildInput(promptSet.prompts.instrumentation);
    const instrumentationResult = await params.analyze(instrumentationInput.problemDescription);
    traces.push({
      scenario: "instrumentation",
      pass,
      stage: "fresh",
      observation: null,
      ...buildSessionMetadata(
        `baseline-instrumentation-pass-${pass}`,
        1,
        "Add enough evidence around scene-streaming registration to locate the aggro drop boundary.",
      ),
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
      ...buildSessionMetadata(
        `baseline-duplicate-writer-pass-${pass}`,
        1,
        "Resolve the sprint-speed ownership conflict without widening the scope beyond the two active writers.",
      ),
      ...buildAnalysisTraceRecord({ input: duplicateInput, result: duplicateResult }),
    });

    const ownershipInput = buildInput(promptSet.prompts.ownership);
    const ownershipResult = await params.analyze(ownershipInput.problemDescription);
    traces.push({
      scenario: "ownership",
      pass,
      stage: "fresh",
      observation: null,
      ...buildSessionMetadata(
        `baseline-ownership-pass-${pass}`,
        1,
        "Keep target ownership on a single reference handoff so spawned projectiles read the same source.",
      ),
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
      ...buildSessionMetadata(
        `baseline-messy-pass-${pass}`,
        1,
        "Reduce the investigation to one recoverable subsystem before touching the rest of the mixed regression set.",
      ),
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
      ...buildSessionMetadata(
        `baseline-duplicate-writer-pass-${pass}`,
        2,
        "Resolve the sprint-speed ownership conflict without widening the scope beyond the two active writers.",
      ),
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
      ...buildSessionMetadata(
        `baseline-ownership-pass-${pass}`,
        2,
        "Keep target ownership on a single reference handoff so spawned projectiles read the same source.",
      ),
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
      ...buildSessionMetadata(
        `baseline-messy-pass-${pass}`,
        2,
        "Reduce the investigation to one recoverable subsystem before touching the rest of the mixed regression set.",
      ),
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
      ...buildSessionMetadata(
        `baseline-animator-pass-${pass}`,
        1,
        "Confirm whether the Animator speed sync handoff is stable enough to treat as the leading cause.",
      ),
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
      ...buildSessionMetadata(
        `baseline-animator-pass-${pass}`,
        2,
        "Confirm whether the Animator speed sync handoff is stable enough to treat as the leading cause.",
      ),
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