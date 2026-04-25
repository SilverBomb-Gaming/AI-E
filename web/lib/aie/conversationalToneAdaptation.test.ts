import assert from "node:assert/strict";
import test from "node:test";

import { normalizeUserInput } from "./intentNormalization";
import {
  buildToneAdaptationGuidance,
  detectUserSkillSignals,
  selectResponseMode,
  summarizeToneAdaptation,
} from "./conversationalToneAdaptation";
import { startConversationalLoop } from "./multiTurnConversationalLoop";

test("beginner wording selects beginner_friendly", () => {
  const result = buildToneAdaptationGuidance({
    rawRequest: "idk make enemy less dumb",
    confidence_score: 0.52,
  });

  assert.equal(result.response_mode, "beginner_friendly");
  assert.equal(result.should_use_plain_language, true);
  assert.equal(result.should_include_examples, true);
});

test("technical wording selects technical", () => {
  const result = buildToneAdaptationGuidance({
    rawRequest: "Add deterministic artifact eligibility gate with tests",
    confidence_score: 0.84,
  });

  assert.equal(result.response_mode, "technical");
  assert.equal(result.should_include_technical_terms, true);
  assert.equal(result.should_use_plain_language, false);
});

test("handoff please selects handoff_only", () => {
  const result = buildToneAdaptationGuidance({
    rawRequest: "next handoff please",
    confidence_score: 0.81,
  });

  assert.equal(selectResponseMode({ rawRequest: "next handoff please", confidence_score: 0.81 }), "handoff_only");
  assert.equal(result.should_use_handoff_format, true);
});

test("vague input selects clarification_minimal or beginner_friendly", () => {
  const result = buildToneAdaptationGuidance({
    rawRequest: "make it better",
    confidence_score: 0.31,
    ambiguity_flags: ["too-vague", "missing-target-area", "low-vocabulary-uncertainty"],
  });

  assert.ok(["clarification_minimal", "beginner_friendly"].includes(result.response_mode));
  assert.equal(result.should_minimize_questions, true);
});

test("risky autonomy request selects safety_review", () => {
  const result = buildToneAdaptationGuidance({
    rawRequest: "do everything automatically overnight",
    confidence_score: 0.34,
    ambiguity_flags: ["risky-autonomy", "broad-scope"],
    risk_level: "blocked",
  });

  assert.equal(result.response_mode, "safety_review");
  assert.equal(result.safety_tone_required, true);
});

test("tone guidance includes reasons", () => {
  const result = buildToneAdaptationGuidance({
    rawRequest: "idk make enemy less dumb",
    confidence_score: 0.52,
  });

  assert.ok(result.reasons.length > 0);
  assert.match(result.reasons[0]?.message ?? "", /plain-language|simple|wording/i);
});

test("deterministic output", () => {
  const first = buildToneAdaptationGuidance({
    rawRequest: "Add deterministic artifact eligibility gate with tests",
    confidence_score: 0.84,
  });
  const second = buildToneAdaptationGuidance({
    rawRequest: "Add deterministic artifact eligibility gate with tests",
    confidence_score: 0.84,
  });

  assert.deepEqual(second, first);
});

test("does not alter planner-ready request", () => {
  const result = startConversationalLoop({
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });

  assert.equal(result.planner_ready_request?.rawRequest, "Add enemy reaction behavior to grenade explosions in BABYLON.");
  assert.equal(result.session.tone_adaptation?.response_mode, "beginner_friendly");
});

test("works with normalized input", () => {
  const normalized = normalizeUserInput("idk make enemy less dumb");
  const result = buildToneAdaptationGuidance({
    rawRequest: "idk make enemy less dumb",
    normalizedInput: normalized.normalized_input,
    confidence_score: normalized.normalization_confidence.value,
  });

  assert.ok(detectUserSkillSignals({
    rawRequest: "idk make enemy less dumb",
    normalizedInput: normalized.normalized_input,
    confidence_score: normalized.normalization_confidence.value,
  }).some((signal) => signal.signal === "normalized-request"));
  assert.equal(result.response_mode, "beginner_friendly");
});

test("summary is readable", () => {
  const result = buildToneAdaptationGuidance({
    rawRequest: "next handoff please",
    confidence_score: 0.81,
  });
  const summary = summarizeToneAdaptation(result);

  assert.match(summary, /Response mode:/i);
  assert.match(summary, /User level:/i);
  assert.match(summary, /Reasons:/i);
  assert.match(summary, /Guidance:/i);
});