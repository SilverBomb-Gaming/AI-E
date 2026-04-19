import assert from "node:assert/strict";
import test from "node:test";

import type { FollowUpVerificationState, StoredActionChainState } from "./AnalysisForm";
import {
  buildFalsifiedDiagnosis,
  buildFollowUpProblemDescription,
  buildGuidedStepStack,
  buildNextStepGuidance,
  classifyFollowUpResult,
  deriveAnalysisResultSignals,
} from "./analysisResultLogic";
import type { FreeAnalysisResponse } from "../lib/aie/types";

function makeResult(overrides: Partial<FreeAnalysisResponse> = {}): FreeAnalysisResponse {
  return {
    what_happened: "The Animator state transition is the most likely cause of the symptom.",
    what_matters: ["Animator speed values are changing during the failing transition."],
    what_to_do_next: [
      "Temporarily disable the Animator transition override and compare the behavior before and after.",
    ],
    upgrade_hint: "",
    ...overrides,
  };
}

function derive(params: {
  result: FreeAnalysisResponse;
  problemDescription?: string;
  isRefined?: boolean;
  lastObservation?: string;
  verificationState?: FollowUpVerificationState;
  previousActionChainState?: StoredActionChainState;
}) {
  return deriveAnalysisResultSignals(params);
}

test("maps isolate diagnoses to isolate-one-subsystem", () => {
  const signals = derive({
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override is the most likely cause of the symptom.",
      what_to_do_next: [
        "Temporarily disable the Animator speed sync override and compare the behavior before and after.",
      ],
    }),
  });

  assert.equal(signals.recommendedDebuggingMode, "isolate-one-subsystem");
});

test("shows a bounded supervised chain for strong isolation cases", () => {
  const signals = derive({
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override is the most likely cause of the symptom.",
      what_to_do_next: [
        "Temporarily disable the Animator speed sync override and compare the behavior before and after.",
      ],
    }),
  });

  assert.equal(signals.suggestedNextAction, "continue-thread");
  assert.equal(signals.supervisedActionChain?.length, 3);
  assert.equal(signals.supervisedActionChain?.[0]?.label, "Isolate the suspected subsystem");
  assert.equal(signals.supervisedActionChain?.[2]?.label, "Decide continue vs escalate");
  assert.equal(signals.supervisedActionChainStepIndicator, "Step 1 of 3");
});

test("maps logging-oriented diagnoses to instrument-with-logging", () => {
  const signals = derive({
    problemDescription: "The state transition flicker happens during the Animator handoff.",
    result: makeResult({
      what_happened: "The Animator transition event flow is the most likely cause, so add focused logging around the state transition.",
      what_to_do_next: [
        "Add focused debug logs around the Animator transition event flow and compare the values during the handoff.",
      ],
    }),
  });

  assert.equal(signals.recommendedDebuggingMode, "instrument-with-logging");
});

test("prefers instrumentation over ownership when the signal is explicitly about before-or-after registration logging", () => {
  const signals = derive({
    problemDescription:
      "Enemies occasionally lose aggro after scene streaming, but there is no clear console error and the current checks are too sparse to tell whether the target reference is dropped before or after registration.",
    result: makeResult({
      what_happened:
        "The enemies are likely losing aggro because the target reference is being dropped somewhere around scene streaming registration.",
      what_to_do_next: [
        "Add logging to the enemy AI script to track the target reference before and after scene streaming, confirming whether it is being lost during the transition.",
      ],
    }),
  });

  assert.equal(signals.recommendedDebuggingMode, "instrument-with-logging");
  assert.equal(signals.supervisedActionChain?.[0]?.intent, "instrumentation");
});
test("shows a bounded supervised chain for strong instrumentation cases", () => {
  const signals = derive({
    problemDescription: "The state transition flicker happens during the Animator handoff.",
    result: makeResult({
      what_happened: "The Animator transition event flow is the most likely cause, so add focused logging around the state transition.",
      what_to_do_next: [
        "Add focused debug logs around the Animator transition event flow and compare the values during the handoff.",
      ],
    }),
  });

  assert.equal(signals.recommendedDebuggingMode, "instrument-with-logging");
  assert.equal(signals.supervisedActionChain?.length, 3);
  assert.equal(signals.supervisedActionChain?.[0]?.label, "Inspect the signal with logging");
  assert.match(signals.supervisedActionChain?.[1]?.watchFor ?? "", /branch|value|event/i);
});

test("advances chain continuity from step 1 to step 2 when the observation matches the prior watch-for", () => {
  const initialSignals = derive({
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override is the most likely cause of the symptom.",
      what_to_do_next: [
        "Temporarily disable the Animator speed sync override and compare the behavior before and after.",
      ],
    }),
  });

  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation: "Disabling the Animator speed sync weakened the symptom, but it still appears during the handoff.",
    previousActionChainState: {
      currentStepIndex: 0,
      totalSteps: initialSignals.supervisedActionChain?.length ?? 3,
      lastStepIntent: initialSignals.currentSupervisedActionChainStep?.intent ?? "isolation",
      lastStepVerification: "inconclusive",
      lastStepWatchFor: initialSignals.currentSupervisedActionChainStep?.watchFor,
      previousConfidenceLevel: "low",
      confidenceHistory: ["low"],
    },
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override is still the most likely cause of the symptom.",
      what_to_do_next: [
        "Temporarily isolate only the Animator resume handoff and one related variable, then compare whether the symptom changes immediately.",
        "Temporarily force the resume state to a known-safe value and compare the behavior immediately before and after.",
      ],
    }),
  });

  assert.equal(signals.supervisedActionChain?.length, 3);
  assert.equal(signals.confidenceLevel, "medium");
  assert.equal(signals.confidenceAlignment, "increasing");
  assert.equal(signals.supervisedActionChainActiveStepIndex, 1);
  assert.equal(signals.supervisedActionChainStepIndicator, "Step 2 of 3");
});

test("holds the current chain step when confidence stays flat across a converging follow-up", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation: "Disabling the Animator speed sync still narrows the issue to the same handoff, but the symptom is only partly reduced.",
    previousActionChainState: {
      currentStepIndex: 0,
      totalSteps: 3,
      lastStepIntent: "isolation",
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for whether isolating animator speed sync makes the symptom disappear, weaken, or stay exactly the same.",
      previousConfidenceLevel: "medium",
      confidenceHistory: ["low", "medium"],
    },
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override is still the most likely cause of the symptom.",
      what_to_do_next: [
        "Temporarily isolate only the Animator resume handoff and one related variable, then compare whether the symptom changes immediately.",
        "Temporarily force the resume state to a known-safe value and compare the behavior immediately before and after.",
      ],
    }),
  });

  assert.equal(signals.confidenceLevel, "medium");
  assert.equal(signals.confidenceAlignment, "unstable");
  assert.equal(signals.supervisedActionChain?.length, 3);
  assert.equal(signals.supervisedActionChainActiveStepIndex, 0);
  assert.equal(signals.supervisedActionChainStepIndicator, "Step 1 of 3");
});

test("drops the chain when confidence decreases across a converging follow-up", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation: "The isolated handoff is still involved, but the result is much noisier now and the signal is less trustworthy than the last step.",
    previousActionChainState: {
      currentStepIndex: 1,
      totalSteps: 3,
      lastStepIntent: "isolation",
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for whether changing animator resume handoff shifts the symptom immediately instead of only producing later side effects.",
      previousConfidenceLevel: "high",
      confidenceHistory: ["medium", "high"],
    },
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override is still the most likely cause of the symptom.",
      what_to_do_next: [
        "Temporarily isolate only the Animator resume handoff and one related variable, then compare whether the symptom changes immediately.",
        "Temporarily force the resume state to a known-safe value and compare the behavior immediately before and after.",
      ],
    }),
  });

  assert.equal(signals.confidenceLevel, "medium");
  assert.equal(signals.confidenceAlignment, "decreasing");
  assert.equal(signals.supervisedActionChain, null);
  assert.equal(signals.supervisedActionChainStepIndicator, null);
});

test("holds in confirmation mode when a first strong signal still needs validation", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation: "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
    previousActionChainState: {
      currentStepIndex: 1,
      totalSteps: 3,
      lastStepIntent: "isolation",
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for whether changing animator resume handoff shifts the symptom immediately instead of only producing later side effects.",
      previousConfidenceLevel: "medium",
      confidenceHistory: ["low", "medium"],
    },
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override is now the clearly leading cause of the symptom.",
      what_to_do_next: [
        "Temporarily isolate only the Animator resume handoff and one related variable, then compare whether the symptom changes immediately.",
        "Temporarily force the resume state to a known-safe value and compare the behavior immediately before and after.",
      ],
    }),
  });

  assert.equal(signals.confidenceLevel, "high");
  assert.equal(signals.confidenceAlignment, "increasing");
  assert.equal(signals.decisionCommitment, "pending");
  assert.equal(signals.alignedSignalCount, 1);
  assert.equal(signals.supervisedActionChain?.[0]?.intent, "confirmation");
  assert.match(signals.supervisedActionChain?.[0]?.label ?? "", /confirm/i);
  assert.equal(signals.supervisedActionChainStepIndicator, "Confirmation mode");
});

test("promotes a strong first confirmation to pending even when prior chain history is sparse", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
    problemDescription:
      "Player movement breaks after changing the Animator speed sync. The bad transition happens right when the Animator resume handoff runs, and the symptom seems tied to that handoff rather than the rest of movement.",
    result: makeResult({
      what_happened:
        "The player's Animator speed sync setting is causing an improper transition during the Animator resume handoff.",
      what_to_do_next: [
        "Temporarily force the Animator speed sync setting to a known-safe value and compare the behavior immediately before and after.",
      ],
    }),
  });

  assert.equal(signals.confidenceLevel, "high");
  assert.equal(signals.decisionCommitment, "pending");
  assert.equal(signals.alignedSignalCount, 1);
  assert.equal(signals.supervisedActionChain?.[0]?.intent, "confirmation");
});

test("promotes repeated confirmation phrasing to committed when the same path keeps matching", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "The same Animator handoff still cleanly drives the symptom, and the confirm check keeps matching the expected path.",
    problemDescription:
      "Player movement breaks after changing the Animator speed sync. The bad transition happens right when the Animator resume handoff runs, and the symptom seems tied to that handoff rather than the rest of movement.",
    result: makeResult({
      what_happened:
        "The Animator's speed sync setting is likely causing the player movement to break due to an improper handoff during the Animator transition phase.",
      what_to_do_next: [
        "Temporarily force the Animator speed sync setting to a known-safe value and compare the behavior immediately before and after.",
      ],
    }),
  });

  assert.equal(signals.confidenceLevel, "high");
  assert.equal(signals.decisionCommitment, "committed");
  assert.equal(signals.alignedSignalCount, 2);
  assert.equal(signals.supervisedActionChain?.[0]?.intent, "confirmation");
});

test("keeps duplicate-writer repeated confirmation out of low-confidence stuck escalation", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "Disabling the cutscene zoom script consistently removes the jitter, and re-enabling it consistently brings the jitter back. This strongly suggests the cutscene zoom writer is part of the duplicate-writer conflict.",
    previousActionChainState: {
      currentStepIndex: 1,
      totalSteps: 3,
      lastStepIntent: "duplicate-writer",
      lastStepVerification: "inconclusive",
      lastStepWatchFor:
        "Watch for the bad state to track the same cutscene zoom writer overwrite path instead of drifting to a different writer.",
      previousConfidenceLevel: "high",
      confidenceHistory: ["medium", "high"],
    },
    problemDescription:
      "Camera motion jitters during the cutscene transition because the cutscene zoom script and another camera zoom path are both writing the same zoom value during the same state change.",
    result: makeResult({
      what_happened:
        "The cutscene zoom writer continues to reproduce the same confirmed behavior under repeated validation. The same overwrite path keeps matching the expected duplicate-writer conflict.",
      what_to_do_next: [
        "Temporarily disable cutscene zoom writer and compare whether the same jitter changes immediately before and after.",
      ],
    }),
  });

  assert.equal(signals.confidenceLevel, "high");
  assert.equal(signals.loopTerminationStatus, "converging");
  assert.equal(signals.suggestedNextAction, "continue-thread");
  assert.equal(signals.recommendedDebuggingMode, "check-duplicate-writers");
  assert.equal(signals.decisionCommitment, "committed");
  assert.equal(signals.supervisedActionChainStepIndicator, "Confirmation mode");
  assert.equal(signals.currentSupervisedActionChainStep?.intent, "confirmation");
  assert.equal(signals.suggestedEscalationStrategy, null);
  assert.match(signals.nextStepGuidance ?? "", /cutscene zoom/i);
  assert.doesNotMatch(signals.nextStepGuidance ?? "", /escalat|stuck|inconclusive/i);
});

test("keeps a true positive commitment once confirmation stays consistent across consecutive steps", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation: "The same Animator handoff still cleanly drives the symptom, and the confirm check keeps matching the expected path.",
    previousActionChainState: {
      currentStepIndex: 0,
      totalSteps: 2,
      lastStepIntent: "confirmation",
      isCommitted: false,
      alignedSignalCount: 1,
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for a clean confirm-or-contradict result around animator speed sync: the symptom should track this subsystem directly, not stay unchanged or move to a different cause.",
      previousConfidenceLevel: "high",
      confidenceHistory: ["medium", "high"],
    },
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override remains the clearly leading cause of the symptom.",
      what_to_do_next: [
        "Temporarily isolate only the Animator resume handoff and one related variable, then compare whether the symptom changes immediately.",
      ],
    }),
  });

  assert.equal(signals.confidenceLevel, "high");
  assert.equal(signals.decisionCommitment, "committed");
  assert.equal(signals.alignedSignalCount, 2);
  assert.equal(signals.supervisedActionChain?.[0]?.intent, "confirmation");
  assert.equal(signals.supervisedActionChainStepIndicator, "Confirmation mode");
});

test("prefers canonical analyzer focus over noisy confirmation phrasing when building the next step", () => {
  const nextStep = buildNextStepGuidance({
    verificationState: "inconclusive",
    observation:
      "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
    priorSteps: [
      "Temporarily disable only Animator speed sync handoff and compare the behavior immediately before and after.",
    ],
    currentResult: makeResult({
      what_happened:
        "Animator speed sync handoff is now confirmed as the cause: the same path cleanly tracks the symptom, consistently reproduces the issue, and the repeated check keeps matching the expected path.",
      what_to_do_next: [
        "Temporarily disable Animator speed sync handoff and compare whether the same symptom changes immediately before and after.",
        "Restore Animator speed sync handoff immediately after that check and confirm the same symptom comes back on that same path.",
      ],
    }),
  });

  assert.match(nextStep ?? "", /Animator speed sync handoff/i);
  assert.doesNotMatch(nextStep ?? "", /now cleanly tracks/i);
});

test("does not add a third exploratory step once repeated confirmation is already strong", () => {
  const nextStep = buildNextStepGuidance({
    verificationState: "inconclusive",
    observation: "The same Animator handoff still cleanly drives the symptom, and the confirm check keeps matching the expected path.",
    priorSteps: [
      "Temporarily force the Animator speed sync handoff to a known-safe value and compare the behavior immediately before and after.",
      "Temporarily disable only Animator speed sync handoff and compare the behavior immediately before and after.",
    ],
    currentResult: makeResult({
      what_happened:
        "Animator speed sync handoff continues to reproduce the same confirmed behavior under repeated validation. The same path cleanly tracks the symptom, consistently reproduces the issue, and the repeated check keeps matching the expected path.",
      what_to_do_next: [
        "Temporarily disable Animator speed sync handoff and compare whether the same symptom changes immediately before and after.",
        "Restore Animator speed sync handoff immediately after that check and confirm the same symptom comes back on that same path.",
      ],
    }),
  });

  assert.equal(nextStep, null);
});

test("stays in commitment mode when confidence remains stable and high", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation: "The same Animator handoff still cleanly drives the symptom, and the confirm check keeps matching the expected path.",
    previousActionChainState: {
      currentStepIndex: 0,
      totalSteps: 2,
      lastStepIntent: "confirmation",
      isCommitted: true,
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for a clean confirm-or-contradict result around animator speed sync: the symptom should track this subsystem directly, not stay unchanged or move to a different cause.",
      previousConfidenceLevel: "high",
      confidenceHistory: ["medium", "high"],
    },
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override remains the clearly leading cause of the symptom.",
      what_to_do_next: [
        "Temporarily isolate only the Animator resume handoff and one related variable, then compare whether the symptom changes immediately.",
      ],
    }),
  });

  assert.equal(signals.confidenceLevel, "high");
  assert.equal(signals.confidenceAlignment, "unstable");
  assert.equal(signals.decisionCommitment, "committed");
  assert.equal(signals.supervisedActionChainActiveStepIndex, 0);
  assert.equal(signals.supervisedActionChainStepIndicator, "Confirmation mode");
});

test("exits commitment mode when confidence drops after a committed hypothesis", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation: "The signal is noisier now, the same handoff no longer tracks the symptom cleanly, and confidence is slipping.",
    previousActionChainState: {
      currentStepIndex: 0,
      totalSteps: 2,
      lastStepIntent: "confirmation",
      isCommitted: true,
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for a clean confirm-or-contradict result around animator speed sync: the symptom should track this subsystem directly, not stay unchanged or move to a different cause.",
      previousConfidenceLevel: "high",
      confidenceHistory: ["medium", "high"],
    },
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override is still the most likely cause of the symptom.",
      what_to_do_next: [
        "Temporarily isolate only the Animator resume handoff and one related variable, then compare whether the symptom changes immediately.",
      ],
    }),
  });

  assert.equal(signals.confidenceLevel, "medium");
  assert.equal(signals.decisionCommitment, null);
  assert.equal(signals.supervisedActionChain, null);
});

test("avoids commitment when the evidence is noisy or ambiguous", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation: "Disabling the Animator speed sync kind of helped, but the symptom is mixed now and the same handoff is only partly involved.",
    previousActionChainState: {
      currentStepIndex: 1,
      totalSteps: 3,
      lastStepIntent: "isolation",
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for whether changing animator resume handoff shifts the symptom immediately instead of only producing later side effects.",
      previousConfidenceLevel: "medium",
      confidenceHistory: ["low", "medium"],
    },
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override is now the clearly leading cause of the symptom.",
      what_to_do_next: [
        "Temporarily isolate only the Animator resume handoff and one related variable, then compare whether the symptom changes immediately.",
      ],
    }),
  });

  assert.equal(signals.confidenceLevel, "medium");
  assert.equal(signals.decisionCommitment, null);
  assert.equal(signals.alignedSignalCount, 0);
  assert.equal(signals.supervisedActionChain?.[0]?.intent, "isolation");
});

test("resets commitment mode when a contradiction falsifies the current hypothesis", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "falsified",
    lastObservation: "The confirm check changed nothing, but isolating the pathfinding resume handoff immediately changed the freeze.",
    previousActionChainState: {
      currentStepIndex: 0,
      totalSteps: 2,
      lastStepIntent: "confirmation",
      isCommitted: true,
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for a clean confirm-or-contradict result around animator speed sync: the symptom should track this subsystem directly, not stay unchanged or move to a different cause.",
      previousConfidenceLevel: "high",
      confidenceHistory: ["medium", "high"],
    },
    problemDescription: "The enemy freezing issue changed after the pathfinding resume handoff.",
    result: makeResult({
      what_happened: "The pathfinding resume handoff is the more likely cause of the freezing issue.",
      what_to_do_next: [
        "Temporarily disable the pathfinding resume handoff and compare the freezing before and after.",
      ],
    }),
  });

  assert.equal(signals.decisionCommitment, null);
  assert.equal(signals.suggestedNextAction, "restart-fresh");
  assert.equal(signals.supervisedActionChain, null);
  assert.equal(signals.supervisedActionChainActiveStepIndex, 0);
  assert.equal(signals.supervisedActionChainStepIndicator, null);
});

test("terminates a stalled partial-success loop when no distinct bounded next step remains", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "Disabling the HUD hookup reduced the empty panel issue slightly, but the same mismatch still appears and confidence is no better than the last two checks.",
    previousActionChainState: {
      currentStepIndex: 1,
      totalSteps: 3,
      lastStepIntent: "isolation",
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for whether delaying the HUD hookup makes the empty panel disappear or keep showing on the same load path.",
      previousConfidenceLevel: "medium",
      confidenceHistory: ["medium", "medium"],
    },
    problemDescription: "The inventory HUD sometimes opens empty on slow scene loads.",
    result: makeResult({
      what_happened: "The HUD hookup timing is still the most likely cause of the empty first-open panel.",
      what_to_do_next: [
        "Temporarily delay the HUD hookup until after the data-ready callback and compare the first open before and after.",
      ],
    }),
  });

  assert.equal(signals.loopTerminationStatus, "stuck");
  assert.notEqual(signals.suggestedNextAction, "continue-thread");
});

test("forces a directional change after a contradiction falsifies the current hypothesis", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "falsified",
    lastObservation:
      "Disabling the Animator speed sync changed nothing this time, but bypassing the pathfinding resume handoff removes the freeze immediately.",
    previousActionChainState: {
      currentStepIndex: 0,
      totalSteps: 3,
      lastStepIntent: "confirmation",
      isCommitted: true,
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for a clean confirm-or-contradict result around animator speed sync: the symptom should track this subsystem directly, not stay unchanged or move to a different cause.",
      previousConfidenceLevel: "high",
      confidenceHistory: ["medium", "high"],
    },
    problemDescription: "An enemy freeze appears during the resume handoff after scene streaming.",
    result: makeResult({
      what_happened: "The pathfinding resume handoff is the more likely cause of the freeze.",
      what_to_do_next: [
        "Temporarily disable the pathfinding resume handoff and compare the freezing before and after.",
      ],
    }),
  });

  assert.equal(signals.suggestedNextAction, "restart-fresh");
  assert.equal(signals.decisionCommitment, null);
});

test("treats hard missing-dependency cases as blockers instead of forward progress", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "falsified",
    lastObservation:
      "The suggested import fix failed because the module does not exist anywhere on this branch and there is no equivalent fallback in the repo.",
    problemDescription: "CLI startup now fails before the banner path.",
    result: makeResult({
      what_happened: "The startup path is blocked by a missing controller module that does not exist on this branch and has no valid fallback.",
      what_to_do_next: ["Escalate the blocker instead of proposing another import patch."],
    }),
  });

  assert.equal(signals.loopTerminationStatus, "stuck");
  assert.equal(signals.suggestedNextAction, "escalate");
});

test("terminates a stalled partial-success loop when no distinct bounded next step remains", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "Disabling the HUD hookup reduced the empty panel issue slightly, but the same mismatch still appears and confidence is no better than the last two checks.",
    previousActionChainState: {
      currentStepIndex: 1,
      totalSteps: 3,
      lastStepIntent: "isolation",
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for whether delaying the HUD hookup makes the empty panel disappear or keep showing on the same load path.",
      previousConfidenceLevel: "medium",
      confidenceHistory: ["medium", "medium"],
    },
    problemDescription: "The inventory HUD sometimes opens empty on slow scene loads.",
    result: makeResult({
      what_happened: "The HUD hookup timing is still the most likely cause of the empty first-open panel.",
      what_to_do_next: [
        "Temporarily delay the HUD hookup until after the data-ready callback and compare the first open before and after.",
      ],
    }),
  });

  assert.equal(signals.loopTerminationStatus, "stuck");
  assert.notEqual(signals.suggestedNextAction, "continue-thread");
});

test("forces a directional change after a contradiction falsifies the current hypothesis", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "falsified",
    lastObservation:
      "Disabling the Animator speed sync changed nothing this time, but bypassing the pathfinding resume handoff removes the freeze immediately.",
    previousActionChainState: {
      currentStepIndex: 0,
      totalSteps: 3,
      lastStepIntent: "confirmation",
      isCommitted: true,
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for a clean confirm-or-contradict result around animator speed sync: the symptom should track this subsystem directly, not stay unchanged or move to a different cause.",
      previousConfidenceLevel: "high",
      confidenceHistory: ["medium", "high"],
    },
    problemDescription: "An enemy freeze appears during the resume handoff after scene streaming.",
    result: makeResult({
      what_happened: "The pathfinding resume handoff is the more likely cause of the freeze.",
      what_to_do_next: [
        "Temporarily disable the pathfinding resume handoff and compare the freezing before and after.",
      ],
    }),
  });

  assert.equal(signals.suggestedNextAction, "restart-fresh");
  assert.equal(signals.decisionCommitment, null);
});

test("treats hard missing-dependency cases as blockers instead of forward progress", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "falsified",
    lastObservation:
      "The suggested import fix failed because the module does not exist anywhere on this branch and there is no equivalent fallback in the repo.",
    problemDescription: "CLI startup now fails before the banner path.",
    result: makeResult({
      what_happened: "The startup path is blocked by a missing controller module that does not exist on this branch and has no valid fallback.",
      what_to_do_next: ["Escalate the blocker instead of proposing another import patch."],
    }),
  });

  assert.equal(signals.loopTerminationStatus, "stuck");
  assert.equal(signals.suggestedNextAction, "escalate");
});

test("does not continue a refined partial loop after the next guided step disappears", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "A second bounded tweak still only weakens the same mismatch instead of resolving it, and the queue keeps suggesting another version of the same validation step.",
    previousActionChainState: {
      currentStepIndex: 1,
      totalSteps: 3,
      lastStepIntent: "ownership",
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for whether the active owner or reference goes stale, null, or points at the wrong object.",
      previousConfidenceLevel: "medium",
      confidenceHistory: ["medium", "medium"],
    },
    problemDescription:
      "After respawn, the stamina ring and dodge gate disagree briefly while one path restores from a replicated snapshot and the other reads a cached local reference.",
    result: makeResult({
      what_happened:
        "This is an ownership/reference handoff issue. One object stores the needed target, but target reference handoff reads the wrong or stale target path, so the spawned behavior runs without the intended target.",
      what_to_do_next: [
        "Temporarily force needed target to a known-safe value and compare the behavior immediately before and after. If the behavior changes right away, keep the investigation on that branch.",
      ],
    }),
  });

  assert.equal(signals.nextStepGuidance, null);
  assert.equal(signals.loopTerminationStatus, "stuck");
  assert.notEqual(signals.suggestedNextAction, "continue-thread");
});

test("resets chain continuity to step 1 when the previous step was falsified", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "falsified",
    lastObservation: "Disabling the Animator speed sync changed nothing, but isolating the pathfinding resume handoff immediately changed the freeze.",
    previousActionChainState: {
      currentStepIndex: 0,
      totalSteps: 3,
      lastStepIntent: "isolation",
      lastStepVerification: "falsified",
      lastStepWatchFor: "Watch for whether isolating animator speed sync makes the symptom disappear, weaken, or stay exactly the same.",
    },
    problemDescription: "The enemy freezing issue changed after the pathfinding resume handoff.",
    result: makeResult({
      what_happened: "The pathfinding resume handoff is the more likely cause of the freezing issue.",
      what_to_do_next: [
        "Temporarily disable the pathfinding resume handoff and compare the freezing before and after.",
      ],
    }),
  });

  assert.equal(signals.suggestedNextAction, "restart-fresh");
  assert.equal(signals.supervisedActionChain, null);
  assert.equal(signals.supervisedActionChainActiveStepIndex, 0);
  assert.equal(signals.supervisedActionChainStepIndicator, null);
});

test("maps initialization-order diagnoses to check-initialization-order", () => {
  const signals = derive({
    problemDescription: "The camera target is wrong right after scene load.",
    result: makeResult({
      what_happened: "Scene bootstrap initialization order is the most likely cause of the wrong initial camera target.",
      what_to_do_next: [
        "Check whether the camera target is assigned during Awake before the player spawn finishes.",
      ],
    }),
  });

  assert.equal(signals.recommendedDebuggingMode, "check-initialization-order");
});

test("maps duplicate-writer diagnoses to check-duplicate-writers", () => {
  const signals = derive({
    problemDescription: "The UI alpha snaps twice when the pause menu opens.",
    result: makeResult({
      what_happened: "Two scripts writing the same CanvasGroup alpha are the most likely cause of the duplicate fade.",
      what_to_do_next: [
        "Temporarily disable one of the CanvasGroup alpha writers and compare the fade before and after.",
      ],
    }),
  });

  assert.equal(signals.recommendedDebuggingMode, "check-duplicate-writers");
});

test("maps same-frame conflicting speed writes to duplicate-writer mode", () => {
  const signals = derive({
    problemDescription:
      "Sprint speed flickers after I added a stamina limiter. The limiter writes run speed in Update, but the locomotion controller also writes speed later in the same frame, so movement keeps bouncing between two values.",
    result: makeResult({
      what_happened:
        "The sprint speed flickers because the stamina limiter conflicts with the locomotion controller, which also modifies speed later in the same frame.",
      what_to_do_next: [
        "Log the values of the speed variable from both the stamina limiter and the locomotion controller to identify which is being set last during the frame.",
      ],
    }),
  });

  assert.equal(signals.recommendedDebuggingMode, "check-duplicate-writers");
  assert.equal(signals.supervisedActionChain?.[0]?.intent, "duplicate-writer");
});
test("maps ownership and reference diagnoses to validate-ownership-references", () => {
  const signals = derive({
    problemDescription: "The button stops responding after the menu handoff.",
    result: makeResult({
      what_happened: "A stale ownership handoff and missing Button reference are the most likely cause of the dead menu input.",
      what_to_do_next: [
        "Validate the Button ownership handoff and the cached reference before the menu becomes active.",
      ],
    }),
  });

  assert.equal(signals.recommendedDebuggingMode, "validate-ownership-references");
});

test("suppresses recommended mode for messy fresh prompts with weak evidence", () => {
  const signals = derive({
    problemDescription:
      "I changed a bunch of systems at once: slopes, dash, friction, camera, audio, and UI, and now everything feels broken and I am not sure where to start.",
    result: makeResult({
      what_happened: "The most likely cause is a general misconfiguration across the recent changes.",
      what_matters: ["There are no obvious console errors and no clear concrete anchor yet."],
      what_to_do_next: ["Check the recent changes and see what looks wrong."],
    }),
  });

  assert.equal(signals.showLowEvidenceCue, true);
  assert.equal(signals.recommendedDebuggingMode, null);
  assert.equal(signals.supervisedActionChain, null);
});

test("suppresses recommended mode when a refined follow-up is resolved", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "confirmed",
    lastObservation: "Disabling the Animator speed sync fixed it and movement works normally again.",
    problemDescription: "Movement broke after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override is the most likely cause of the symptom.",
      what_to_do_next: [
        "Temporarily disable the Animator speed sync override and compare the behavior before and after.",
      ],
    }),
  });

  assert.equal(signals.loopTerminationStatus, "resolved");
  assert.equal(signals.suggestedNextAction, "stop");
  assert.equal(signals.recommendedDebuggingMode, null);
  assert.equal(signals.supervisedActionChain, null);
  assert.equal(signals.supervisedActionChainStepIndicator, null);
});

test("preserves clean-scene routing for stuck follow-up loops", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "Tried several systems and nothing clearly fixed the issue. The problem still appears during the scene bootstrap transition.",
    problemDescription: "The failure appears only during scene bootstrap after loading the menu scene.",
    result: makeResult({
      what_happened: "Scene bootstrap state is the most likely cause of the transition failure.",
      what_to_do_next: [
        "Temporarily disable the Animator speed sync override and compare the behavior before and after.",
        "Temporarily isolate only the SceneManager handoff and one related variable, then compare whether the symptom changes immediately.",
      ],
    }),
  });

  assert.equal(signals.loopTerminationStatus, "stuck");
  assert.equal(signals.suggestedEscalationStrategy, "clean-environment");
  assert.equal(signals.suggestedNextAction, "escalate");
  assert.equal(signals.recommendedDebuggingMode, "reproduce-in-clean-scene");
  assert.equal(signals.supervisedActionChain, null);
  assert.equal(signals.supervisedActionChainStepIndicator, null);
});

test("suppresses chain continuity when a refined follow-up becomes too messy to trust", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation: "It is still all over the place now and I cannot tell what is related to what anymore.",
    previousActionChainState: {
      currentStepIndex: 0,
      totalSteps: 3,
      lastStepIntent: "isolation",
      lastStepVerification: "inconclusive",
      lastStepWatchFor: "Watch for whether isolating the animator speed sync makes the symptom disappear, weaken, or stay exactly the same.",
    },
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The most likely cause is a general misconfiguration across several recent changes.",
      what_matters: ["There are no obvious console errors and the signal is mixed again."],
      what_to_do_next: ["Check the recent changes and see what looks wrong."],
    }),
  });

  assert.equal(signals.suggestedNextAction, "restart-fresh");
  assert.equal(signals.supervisedActionChain, null);
  assert.equal(signals.supervisedActionChainStepIndicator, null);
});

test("suppresses recommended mode for mixed-signal fresh prompts unless confidence reaches the clean high-signal path", () => {
  const signals = derive({
    problemDescription:
      "I changed a bunch of systems this pass, including the camera, HUD, and Animator, and the bug feels mixed, but the dash only breaks right after the Animator speed sync change.",
    result: makeResult({
      what_happened: "The Animator speed sync override is the most likely cause of the dash timing break.",
      what_matters: [
        "The dash starts failing only after the Animator speed sync change.",
        "The symptom is anchored to the Animator handoff rather than the HUD or camera updates.",
      ],
      what_to_do_next: [
        "Temporarily disable the Animator speed sync override and compare the dash timing before and after.",
      ],
    }),
  });

  assert.equal(signals.showLowEvidenceCue, false);
  assert.equal(signals.confidenceLevel, "medium");
  assert.equal(signals.suggestedNextAction, "continue-thread");
  assert.equal(signals.recommendedDebuggingMode, null);
});

test("keeps a specific subsystem recommendation even when confidence is low from weak evidence", () => {
  const signals = derive({
    problemDescription: "Player movement breaks after changing the Animator speed sync.",
    result: makeResult({
      what_happened: "The Animator speed sync override is the most likely cause of the symptom.",
      what_matters: [
        "There are no obvious console errors.",
        "The issue still lines up with the Animator speed sync change.",
      ],
      what_to_do_next: [
        "Temporarily disable the Animator speed sync override and compare the behavior before and after.",
      ],
    }),
  });

  assert.equal(signals.showLowEvidenceCue, true);
  assert.equal(signals.confidenceLevel, "low");
  assert.equal(signals.recommendedDebuggingMode, "isolate-one-subsystem");
});

test("does not treat a bounded isolation prompt as a messy fresh prompt", () => {
  const signals = derive({
    problemDescription:
      "After refactoring the wall-jump handoff, the player only sticks on shallow slopes right after a dash. The symptom appears immediately when that movement handoff runs, while the rest of movement feels normal.",
    result: makeResult({
      what_happened:
        "The refactoring of the wall-jump handoff likely introduced a logic error that improperly handles the player's grounded state immediately after a dash, causing the player to stick to shallow slopes.",
      what_matters: [
        "The issue appears immediately after the wall-jump handoff runs, indicating a direct link between the refactor and the symptom.",
        "The rest of movement feels normal, which keeps the failure bounded to the wall-jump path.",
      ],
      what_to_do_next: [
        "Inspect the wall-jump handoff code to verify how the grounded state is being set or reset immediately after a dash.",
        "Add debug logs to track the player's grounded state during the transition from dash to wall-jump.",
        "Temporarily revert the wall-jump handoff refactor to confirm if the sticking issue resolves.",
      ],
    }),
  });

  assert.equal(signals.suggestedNextAction, "continue-thread");
  assert.equal(signals.recommendedDebuggingMode, "isolate-one-subsystem");
  assert.equal(signals.showLowEvidenceCue, false);
});

test("keeps ownership follow-ups out of low-evidence fallback when the diagnosis names a concrete handoff", () => {
  const signals = derive({
    problemDescription:
      "A homing missile prefab spawns correctly, but it sometimes has no target and flies straight ahead. The launcher stores the target on one object, while the spawned projectile reads from another reference.",
    result: makeResult({
      what_happened:
        "The homing missile prefab sometimes flies straight ahead because the spawned projectile reads a stale target reference from a different handoff than the launcher uses.",
      what_matters: [
        "The launcher stores the target on one object while the spawned projectile reads another reference.",
      ],
      what_to_do_next: [
        "Inspect the missile prefab's script to verify which object it is referencing for its target upon spawn.",
        "Check the launcher script to ensure it passes the target reference into the projectile on spawn.",
      ],
    }),
  });

  assert.equal(signals.showLowEvidenceCue, false);
  assert.equal(signals.confidenceLevel, "medium");
  assert.equal(signals.suggestedNextAction, "continue-thread");
  assert.equal(signals.recommendedDebuggingMode, "validate-ownership-references");
});

test("classifies changed nothing follow-ups as falsified when an alternate lever clearly fixes the symptom", () => {
  const verification = classifyFollowUpResult({
    originalResult: makeResult({
      what_happened: "The stamina limiter is the most likely cause of the flicker.",
      what_to_do_next: [
        "Temporarily disable the stamina limiter's speed assignment in Update to see if the flickering stops.",
      ],
    }),
    nextResult: makeResult({
      what_happened: "The animator speed sync is now the more likely cause.",
      what_to_do_next: [
        "Temporarily isolate only animator speed sync and compare whether the symptom changes immediately before and after that step.",
      ],
    }),
    observation:
      "Disabling the stamina limiter changed nothing, but disabling the animator speed sync removes the slowdown completely.",
  });

  assert.equal(verification, "falsified");
});

test("marks a formerly guided follow-up as stuck when the latest observation becomes a dead end", () => {
  const signals = derive({
    isRefined: true,
    verificationState: "inconclusive",
    lastObservation:
      "The first two checks reduced the issue, but after the latest step there is no obvious change and nothing clearly fixed the issue.",
    problemDescription: "The enemy freezing issue improved after narrowing the Animator speed sync and pathfinding checks.",
    result: makeResult({
      what_happened: "The Animator speed sync handoff is the most likely cause of the freezing issue.",
      what_to_do_next: [
        "Temporarily disable the Animator speed sync override and compare the freezing before and after.",
        "Temporarily isolate only the pathfinding resume handoff and one related variable, then compare whether the symptom changes immediately.",
        "Temporarily force the resume state to a known-safe value and compare the behavior immediately before and after.",
      ],
    }),
  });

  assert.equal(signals.guidedStepStack.length, 3);
  assert.equal(signals.loopTerminationStatus, "stuck");
  assert.equal(signals.suggestedNextAction, "escalate");
  assert.equal(signals.suggestedEscalationStrategy, "single-system-rebuild");
  assert.equal(signals.recommendedDebuggingMode, "isolate-one-subsystem");
});

test("builds canonical contradiction diagnosis text without stitched phrasing", () => {
  const diagnosis = buildFalsifiedDiagnosis({
    originalResult: makeResult({
      what_happened: "The stamina limiter is the most likely cause of the flicker.",
      what_to_do_next: [
        "Temporarily disable the stamina limiter's speed assignment and compare the behavior before and after.",
      ],
    }),
    nextResult: makeResult({
      what_happened: "The animator speed sync is now the more likely cause.",
    }),
    observation:
      "Disabling the stamina limiter changed nothing, but disabling the animator speed sync removes the slowdown completely.",
  });

  assert.match(diagnosis, /This contradicts the previous hypothesis\./i);
  assert.match(diagnosis, /animator speed sync is now the more likely cause/i);
  assert.doesNotMatch(diagnosis, /^Since\s/i);
});

test("removes near-identical guided steps from the stack", () => {
  const stack = buildGuidedStepStack(
    "Temporarily disable Animator speed sync handoff and compare whether the same symptom changes immediately before and after.",
    [
      "Temporarily disable Animator speed sync handoff once and compare the behavior immediately before and after.",
      "Restore Animator speed sync handoff immediately after that check and confirm the same symptom comes back on that same path.",
    ],
  );

  assert.equal(stack.filter((step) => /disable Animator speed sync handoff/i.test(step)).length, 1);
  assert.equal(stack.length, 1);
  assert.doesNotMatch(stack[0] ?? "", /compare whether the same symptom changes immediately before and after/i);
});

test("keeps approved-action follow-up phrasing short and readable", () => {
  const description = buildFollowUpProblemDescription(
    "Camera motion jitters during the cutscene transition.",
    "Disabling the cutscene zoom writer removes the jitter, and restoring it brings the jitter back immediately.",
    "Temporarily disable the cutscene zoom writer and compare whether the same jitter changes immediately before and after.",
    1,
  );

  assert.match(description, /After trying step 1 \(Temporarily disable the cutscene zoom writer and compare the behavior immediately before and after\):/i);
  assert.doesNotMatch(description, /compare whether the same jitter changes immediately before and after/i);
});