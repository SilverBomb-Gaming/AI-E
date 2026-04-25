import assert from "node:assert/strict";
import test from "node:test";

import { refineConversationalIntent } from "./conversationalIntentRefinement";
import { decomposeIntent, detectMultipleIntents, prioritizeIntents, recoverVagueIntent, summarizeDecomposition } from "./intentDecomposition";
import { normalizeUserInput } from "./intentNormalization";

test("multi-intent request splits correctly", () => {
  const result = decomposeIntent("fix docs and improve enemy reaction to grenades");

  assert.equal(result.multiple_intents_detected, true);
  assert.equal(result.sub_intents.length, 2);
  assert.match(result.sub_intents[0].summary, /enemy reaction to grenades|documentation/i);
  assert.ok(result.decomposition_flags.includes("multiple-intents-detected"));
});

test("vague input produces recovery candidates", () => {
  const result = decomposeIntent("make it better");

  assert.ok(result.recovery_candidates.length >= 1);
  assert.ok(result.recovery_candidates.length <= 3);
  assert.ok(result.decomposition_flags.includes("vague-intent-recovery"));
  assert.ok(result.decomposition_confidence.value < 0.8);
});

test("conflicting input triggers ambiguity flag", () => {
  const result = decomposeIntent("make enemies faster and slower");

  assert.equal(result.conflicting_signals_detected, true);
  assert.equal(result.should_route_to_clarification, true);
  assert.ok(result.decomposition_flags.includes("conflicting-signals"));
});

test("prioritization orders intents correctly", () => {
  const prioritized = prioritizeIntents([
    {
      intent_id: "intent-1",
      order: 1,
      source_text: "make game better",
      summary: "improve gameplay feel",
      target: null,
      action: "improve",
      scope: null,
      priority: "deferred",
    },
    {
      intent_id: "intent-2",
      order: 2,
      source_text: "make enemies react to grenades",
      summary: "improve enemy reaction to grenades",
      target: "enemies",
      action: "react",
      scope: "narrow",
      priority: "deferred",
    },
  ]);

  assert.equal(prioritized[0].intent_id, "intent-2");
  assert.equal(prioritized[0].priority, "primary");
});

test("deterministic output", () => {
  const first = decomposeIntent("fix docs and improve enemy reaction to grenades");
  const second = decomposeIntent("fix docs and improve enemy reaction to grenades");

  assert.deepEqual(second, first);
});

test("integrates with normalization and refinement", () => {
  const decomposition = decomposeIntent("AI dumb and game boring idk why");
  const normalized = normalizeUserInput(decomposition.primary_intent?.summary ?? decomposition.normalized_input);
  const refinement = refineConversationalIntent({ rawRequest: normalized.normalized_input });

  assert.ok(decomposition.sub_intents.length >= 1);
  assert.ok(normalized.normalized_input.length > 0);
  assert.ok(refinement.interpreted_intent.length > 0);
});

test("no hallucinated intent", () => {
  const result = decomposeIntent("make enemies react to grenades");

  assert.equal(result.recovery_candidates.length, 0);
  assert.match(result.primary_intent?.summary ?? "", /enemy reaction to grenades/i);
  assert.ok(!result.sub_intents.some((intent) => /documentation|inventory|audio/i.test(intent.summary)));
});

test("summary readable", () => {
  const result = decomposeIntent("make it better");
  const summary = summarizeDecomposition(result);

  assert.match(summary, /Original input:/i);
  assert.match(summary, /Primary intent:/i);
  assert.match(summary, /Clarification required:/i);
});

test("detectMultipleIntents returns ordered clause list", () => {
  const clauses = detectMultipleIntents("fix docs and improve enemy reaction to grenades");

  assert.deepEqual(clauses, ["fix docs", "improve enemy reaction to grenades"]);
});

test("recoverVagueIntent stays bounded", () => {
  const candidates = recoverVagueIntent("make it better");

  assert.ok(candidates.length >= 1);
  assert.ok(candidates.length <= 3);
  assert.ok(candidates.every((candidate) => candidate.length > 0));
});