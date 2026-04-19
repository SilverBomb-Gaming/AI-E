import assert from "node:assert/strict";
import test from "node:test";

import type { AnalysisInput, FreeAnalysisResponse } from "@/lib/aie/types";
import { shapeFreeAnalysisResponse } from "./run-analysis";

function makeInput(problemDescription: string, overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    problemDescription,
    errorMessage: "",
    context: "",
    codeSnippet: "",
    actionResult: "",
    ...overrides,
  };
}

function makeResponse(overrides: Partial<FreeAnalysisResponse> = {}): FreeAnalysisResponse {
  return {
    what_happened: "The current subsystem is the most likely cause of the symptom.",
    what_matters: ["The report has enough signal to keep the next pass bounded."],
    what_to_do_next: ["Temporarily disable the current subsystem and compare the behavior before and after."],
    upgrade_hint: "",
    ...overrides,
  };
}

test("shapes duplicate-writer output into stable duplicate writer language", () => {
  const shaped = shapeFreeAnalysisResponse({
    input: makeInput(
      "Sprint speed flickers after I added a stamina limiter. The limiter writes run speed in Update, but the locomotion controller also writes speed later in the same frame, so movement keeps bouncing between two values.",
    ),
    response: makeResponse(),
  });

  assert.match(shaped.what_happened, /duplicate writer conflict/i);
  assert.match(shaped.what_happened, /two systems are writing the same value/i);
  assert.match(shaped.what_to_do_next[0] ?? "", /disable one writer at a time/i);
  assert.equal(shaped.actionType, "inspection");
  assert.match(shaped.proposedAction ?? "", /disable one writer at a time/i);
  assert.match(shaped.expectedOutcome ?? "", /source of the issue|conflict/i);
});

test("shapes ownership output into stable ownership handoff language", () => {
  const shaped = shapeFreeAnalysisResponse({
    input: makeInput(
      "A homing missile prefab spawns correctly, but it sometimes has no target and flies straight ahead. The launcher stores the target on one object, while the spawned projectile reads from another reference.",
    ),
    response: makeResponse(),
  });

  assert.match(shaped.what_happened, /ownership\/reference handoff issue/i);
  assert.doesNotMatch(shaped.what_happened, /missing reference/i);
  assert.match(shaped.what_to_do_next[0] ?? "", /reference handoff/i);
});

test("prefers instrumentation shaping over ownership when the prompt is explicitly about sparse before-or-after registration signal", () => {
  const shaped = shapeFreeAnalysisResponse({
    input: makeInput(
      "Enemies occasionally lose aggro after scene streaming, but there is no clear console error and the current checks are too sparse to tell whether the target reference is dropped before or after registration.",
    ),
    response: makeResponse(),
  });

  assert.match(shaped.what_happened, /instrument/i);
  assert.match(shaped.what_happened, /before or after the failing boundary/i);
  assert.match(shaped.what_to_do_next[0] ?? "", /focused logging/i);
});

test("prefers input evidence over generic model prose when selecting the mode", () => {
  const shaped = shapeFreeAnalysisResponse({
    input: makeInput(
      "After refactoring the wall-jump handoff, the player only sticks on shallow slopes right after a dash. The symptom appears immediately when that movement handoff runs, while the rest of movement feels normal.",
    ),
    response: makeResponse({
      what_happened: "This looks like a generic handoff issue.",
    }),
  });

  assert.match(shaped.what_happened, /single-subsystem isolation case/i);
  assert.match(shaped.what_happened, /wall-jump handoff/i);
  assert.doesNotMatch(shaped.what_happened, /ownership\/reference/i);
});

test("rewrites hard falsification follow-ups into explicit contradiction language", () => {
  const shaped = shapeFreeAnalysisResponse({
    input: makeInput(
      "Sprint speed flickers after I added a stamina limiter. The limiter writes run speed in Update, but the locomotion controller also writes speed later in the same frame. After trying step 1 (Temporarily comment out the speed assignment in the stamina limiter's Update method to see if the flickering stops): Disabling the stamina limiter changed nothing, but disabling the animator speed sync removes the slowdown completely.",
    ),
    response: makeResponse({
      what_happened: "The stamina limiter is still the most likely cause.",
    }),
  });

  assert.match(shaped.what_happened, /contradicted/i);
  assert.match(shaped.what_happened, /animator speed sync/i);
  assert.match(shaped.what_to_do_next[0] ?? "", /isolate only animator speed sync/i);
});

test("rewrites strong confirmation follow-ups into stable commitment language", () => {
  const shaped = shapeFreeAnalysisResponse({
    input: makeInput(
      "Player movement breaks after changing the Animator speed sync. The bad transition happens right when the Animator resume handoff runs. After trying step 1 (Temporarily disable the Animator speed sync override and compare the behavior before and after): Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
    ),
    response: makeResponse({
      what_happened: "The Animator path is still the most likely cause.",
    }),
  });

  assert.match(shaped.what_happened, /confirmed as the cause/i);
  assert.match(shaped.what_happened, /Animator speed sync/i);
  assert.doesNotMatch(shaped.what_happened, /cause:\s+Animator speed sync/i);
  assert.match(shaped.what_happened, /consistently reproduces/i);
  assert.match(shaped.what_to_do_next[0] ?? "", /Temporarily disable Animator speed sync handoff/i);
  assert.doesNotMatch(shaped.what_to_do_next[0] ?? "", /cleanly tracks/i);
});

test("rewrites repeated confirmation follow-ups into stable repeated-validation language", () => {
  const shaped = shapeFreeAnalysisResponse({
    input: makeInput(
      "Player movement breaks after changing the Animator speed sync. The bad transition happens right when the Animator resume handoff runs. After trying step 2 (Temporarily disable only Animator speed sync handoff again and compare whether the same symptom changes immediately before and after): The same Animator handoff still cleanly drives the symptom, and the confirm check keeps matching the expected path.",
    ),
    response: makeResponse({
      what_happened: "The Animator path is still the most likely cause.",
    }),
  });

  assert.match(shaped.what_happened, /remains the confirmed cause(?: under repeated validation)?/i);
  assert.match(shaped.what_happened, /Animator speed sync handoff/i);
  assert.match(shaped.what_to_do_next[0] ?? "", /Temporarily disable Animator speed sync handoff/i);
});

test("keeps cutscene zoom duplicate-writer confirmation stable under repeated validation", () => {
  const shaped = shapeFreeAnalysisResponse({
    input: makeInput(
      "Camera motion jitters during the cutscene transition because the cutscene zoom script and another camera zoom path are both writing the same zoom value during the same state change.",
      {
        actionResult:
          "Disabling the cutscene zoom script consistently removes the jitter, and re-enabling it consistently brings the jitter back. This strongly suggests the cutscene zoom writer is part of the duplicate-writer conflict.",
      },
    ),
    response: makeResponse({
      what_happened: "The camera zoom path is still the most likely cause.",
    }),
  });

  assert.match(shaped.what_happened, /duplicate[- ]writer (?:cause|conflict)/i);
  assert.match(shaped.what_happened, /cutscene zoom (?:writer|script)/i);
  assert.match(shaped.what_happened, /writer (?:cause|conflict)/i);
  assert.match(shaped.what_to_do_next[0] ?? "", /disable cutscene zoom (?:writer|script)/i);
  assert.doesNotMatch(shaped.what_to_do_next[0] ?? "", /consistently removes the jitter/i);
});

test("treats explicit actionResult input as the same follow-up observation loop", () => {
  const shaped = shapeFreeAnalysisResponse({
    input: makeInput("Player movement breaks after changing the Animator speed sync.", {
      actionResult:
        "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
    }),
    response: makeResponse({
      what_happened: "The Animator path is still the most likely cause.",
    }),
  });

  assert.match(shaped.what_happened, /confirmed as the cause/i);
  assert.match(shaped.what_happened, /Animator speed sync/i);
});

test("prevents approved-action observation text from leaking into duplicate-writer diagnosis", () => {
  const shaped = shapeFreeAnalysisResponse({
    input: makeInput(
      "Camera motion jitters during the cutscene transition because the cutscene zoom script and another camera zoom path are both writing the same zoom value during the same state change.",
      {
        actionResult:
          "I disabled the cutscene zoom writer in the combat camera coordinator, and the jitter disappeared completely. Re-enabling it brought the jitter back immediately.",
      },
    ),
    response: makeResponse({
      what_happened: "The camera zoom path is still the most likely cause.",
    }),
  });

  assert.match(shaped.what_happened, /duplicate[- ]writer/i);
  assert.match(shaped.what_happened, /cutscene zoom writer/i);
  assert.doesNotMatch(shaped.what_happened, /I disabled the cutscene zoom writer/i);
  assert.doesNotMatch(shaped.what_happened, /combat camera coordinator/i);
});

test("shapes initialization-order output into stable timing language", () => {
  const shaped = shapeFreeAnalysisResponse({
    input: makeInput(
      "The HUD shows zero health on the first frame after scene load because the HUD binds before PlayerStats finishes initializing.",
    ),
    response: makeResponse(),
  });

  assert.match(shaped.what_happened, /initialization-order issue/i);
  assert.match(shaped.what_happened, /before the upstream state is ready/i);
  assert.match(shaped.what_to_do_next.join(" "), /Awake, OnEnable, and Start|delay the dependent binding/i);
});

test("removes overlapping repeated confirmation steps from shaped output", () => {
  const shaped = shapeFreeAnalysisResponse({
    input: makeInput(
      "Player movement breaks after changing the Animator speed sync. The bad transition happens right when the Animator resume handoff runs. After trying step 1 (Temporarily disable the Animator speed sync override and compare the behavior before and after): Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
    ),
    response: makeResponse({
      what_to_do_next: [
        "Temporarily disable Animator speed sync handoff and compare whether the same symptom changes immediately before and after.",
        "Temporarily disable Animator speed sync handoff once and compare the behavior immediately before and after.",
        "Restore Animator speed sync handoff immediately after that check and confirm the same symptom comes back on that same path.",
      ],
    }),
  });

  assert.equal(shaped.what_to_do_next.filter((step) => /disable Animator speed sync handoff/i.test(step)).length, 1);
  assert.doesNotMatch(shaped.what_to_do_next.join(" "), /compare whether the same symptom changes immediately before and after/i);
});