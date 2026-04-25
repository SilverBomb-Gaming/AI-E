import assert from "node:assert/strict";
import test from "node:test";

import { refineConversationalIntent } from "./conversationalIntentRefinement";
import { startConversationalLoop } from "./multiTurnConversationalLoop";
import { normalizeUserInput } from "./intentNormalization";

test("slang input normalizes correctly", () => {
  const result = normalizeUserInput("AI dumb make better");

  assert.equal(result.normalized_input, "improve enemy ai behavior");
  assert.ok(result.normalization_flags.includes("slang-detected"));
});

test("broken grammar becomes structured intent", () => {
  const result = normalizeUserInput("enemy no react grenade");

  assert.equal(result.normalized_input, "improve enemy reaction to grenades");
  assert.ok(result.normalization_flags.includes("broken-grammar"));
});

test("vague input is flagged as low specificity", () => {
  const result = normalizeUserInput("make it better");

  assert.ok(result.normalization_flags.includes("low-specificity"));
});

test("indirect phrasing extracts engagement intent", () => {
  const result = normalizeUserInput("game boring idk why");

  assert.equal(result.normalized_input, "i don't know the exact area yet, but the game feels boring and should be more engaging");
  assert.ok(result.normalization_flags.includes("indirect-phrasing"));
});

test("mixed signals are ambiguity flagged", () => {
  const result = normalizeUserInput("enemy better and ui nicer");

  assert.ok(result.normalization_flags.includes("mixed-signals"));
});

test("normalization confidence is calculated", () => {
  const result = normalizeUserInput("enemy no react grenade");

  assert.ok(result.normalization_confidence.value > 0);
  assert.ok(result.normalization_confidence.value <= 1);
});

test("integration with conversational loop uses normalized input", () => {
  const result = startConversationalLoop({
    rawRequest: "enemy no react grenade",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });

  assert.equal(result.status, "planner_ready");
  assert.match(result.session.current_interpretation, /enemy ai reaction to grenade/i);
});

test("deterministic output for same input", () => {
  const first = normalizeUserInput("game boring idk why");
  const second = normalizeUserInput("game boring idk why");

  assert.deepEqual(second, first);
});

test("no over-normalization preserves meaning", () => {
  const result = normalizeUserInput("make enemies react to grenades");

  assert.equal(result.normalized_input, "improve enemy reaction to grenades");
});

test("works with existing refinement", () => {
  const normalized = normalizeUserInput("AI dumb make better");
  const refinement = refineConversationalIntent({ rawRequest: normalized.normalized_input });

  assert.match(refinement.interpreted_intent, /enemy behavior/i);
});