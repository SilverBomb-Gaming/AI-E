import assert from "node:assert/strict";
import test from "node:test";

import type { FollowUpVerificationState, StoredActionChainState } from "./AnalysisForm";
import { deriveAnalysisResultSignals } from "./analysisResultLogic";
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
  assert.equal(signals.supervisedActionChainActiveStepIndex, 1);
  assert.equal(signals.supervisedActionChainStepIndicator, "Step 2 of 3");
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

  assert.equal(signals.supervisedActionChain?.length, 3);
  assert.equal(signals.supervisedActionChainActiveStepIndex, 0);
  assert.equal(signals.supervisedActionChainStepIndicator, "Step 1 of 3");
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