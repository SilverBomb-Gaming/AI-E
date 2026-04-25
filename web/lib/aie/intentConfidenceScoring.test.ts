import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAmbiguityScore,
  computeCompletenessScore,
  computeConfidenceScore,
  determineConfidenceDecision,
  scoreIntentConfidence,
} from "./intentConfidenceScoring";
import { startConversationalLoop, answerConversationalLoopQuestion } from "./multiTurnConversationalLoop";

test("make game better has low completeness and high ambiguity", () => {
  const result = scoreIntentConfidence({
    original_request: "make game better",
    interpreted_intent: "Clarify and refine the rough request: make game better.",
    clarity_score: 32,
    follow_up_questions: ["Which part should improve first: enemies, weapons, controls, visuals, or level design?"],
    missing_information: ["The first area to improve is not named."],
    ambiguity_flags: ["missing-target-area", "low-vocabulary-uncertainty"],
    answers: [],
    questions: [],
    planner_ready_request: null,
    should_create_plan: false,
    risk_level: "medium",
  });

  assert.ok(result.completeness_score < 0.5);
  assert.ok(result.ambiguity_score > 0.5);
});

test("improve enemy AI reaction to grenades has high completeness", () => {
  const completeness = computeCompletenessScore({
    original_request: "improve enemy AI reaction to grenades",
    interpreted_intent: "Improve enemy AI reaction to grenade explosions.",
    clarity_score: 90,
    follow_up_questions: [],
    missing_information: [],
    ambiguity_flags: [],
    answers: [],
    questions: [],
    planner_ready_request: "Add enemy reaction behavior to grenade explosions in BABYLON.",
    should_create_plan: true,
    risk_level: "low",
  });

  assert.ok(completeness.value >= 0.8);
});

test("ambiguous and risky request is blocked or needs review", () => {
  const result = scoreIntentConfidence({
    original_request: "do everything automatically overnight",
    interpreted_intent: "Request broad autonomous execution across an unsafe or unbounded scope.",
    clarity_score: 20,
    follow_up_questions: ["What is the first safe bounded task AI-E should run overnight?"],
    missing_information: ["The first safe bounded task is not defined.", "Approval boundaries for overnight or autonomous execution are not specified."],
    ambiguity_flags: ["risky-autonomy", "broad-scope"],
    answers: [],
    questions: [],
    planner_ready_request: null,
    should_create_plan: false,
    risk_level: "high",
  });

  assert.ok(["block", "needs_review"].includes(result.decision.action));
});

test("confidence improves after user answers", () => {
  const started = startConversationalLoop({ rawRequest: "make game better", projectName: "BABYLON Unity gameplay project", repoName: "AI-E" });
  const afterFirst = answerConversationalLoopQuestion(started.session, { answer: "enemies first" });
  const openQuestion = afterFirst.session.questions.find((question) => !question.answered)?.question_id;
  assert.ok(openQuestion);
  const afterSecond = answerConversationalLoopQuestion(afterFirst.session, { question_id: openQuestion, answer: "when grenade blows up" });

  assert.ok(afterFirst.session.confidence_score > started.session.confidence_score);
  assert.ok(afterSecond.session.confidence_score > afterFirst.session.confidence_score);
});

test("conflicting signals reduce confidence", () => {
  const confidence = computeConfidenceScore({
    original_request: "improve enemies and update the readme visuals",
    interpreted_intent: "Implement a specific technical maintenance or tooling request.",
    clarity_score: 54,
    follow_up_questions: ["Which part should improve first?"],
    missing_information: ["The first area to improve is not named."],
    ambiguity_flags: ["missing-target-area"],
    answers: [],
    questions: [],
    planner_ready_request: null,
    should_create_plan: false,
    risk_level: "medium",
  });

  assert.ok(confidence < 0.8);
});

test("explanation output includes reasoning", () => {
  const result = scoreIntentConfidence({
    original_request: "make game better",
    interpreted_intent: "Clarify and refine the rough request: make game better.",
    clarity_score: 32,
    follow_up_questions: ["Which part should improve first: enemies, weapons, controls, visuals, or level design?"],
    missing_information: ["The first area to improve is not named."],
    ambiguity_flags: ["missing-target-area", "low-vocabulary-uncertainty"],
    answers: [],
    questions: [],
    planner_ready_request: null,
    should_create_plan: false,
    risk_level: "medium",
  });

  assert.match(result.decision_reason, /Confidence|ambiguity|question/i);
  assert.ok(result.breakdown.explanation.length > 0);
});

test("deterministic output for same input", () => {
  const input = {
    original_request: "improve enemy AI reaction to grenades",
    interpreted_intent: "Improve enemy AI reaction to grenade explosions.",
    clarity_score: 90,
    follow_up_questions: [],
    missing_information: [],
    ambiguity_flags: [],
    answers: [],
    questions: [],
    planner_ready_request: "Add enemy reaction behavior to grenade explosions in BABYLON.",
    should_create_plan: true,
    risk_level: "low" as const,
  };
  assert.deepEqual(scoreIntentConfidence(input), scoreIntentConfidence(input));
});

test("integration with conversational loop uses calibrated scores", () => {
  const result = startConversationalLoop({
    rawRequest: "make enemies react to grenades",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });

  assert.ok(typeof result.session.ambiguity_score === "number");
  assert.ok(typeof result.session.completeness_score === "number");
  assert.ok(result.session.decision_reason.length > 0);
});

test("no over-questioning beyond thresholds", () => {
  const decision = determineConfidenceDecision(scoreIntentConfidence({
    original_request: "make game better",
    interpreted_intent: "Clarify and refine the rough request: make game better.",
    clarity_score: 30,
    follow_up_questions: ["Which part should improve first?", "What system first?"],
    missing_information: ["The first area to improve is not named."],
    ambiguity_flags: ["missing-target-area"],
    answers: [],
    questions: [],
    planner_ready_request: null,
    should_create_plan: false,
    risk_level: "medium",
  }));

  assert.ok(decision.question_budget <= 2);
});

test("confidence thresholds are respected", () => {
  const high = scoreIntentConfidence({
    original_request: "make enemies react to grenades",
    interpreted_intent: "Improve enemy AI reaction to grenade explosions.",
    clarity_score: 92,
    follow_up_questions: [],
    missing_information: [],
    ambiguity_flags: [],
    answers: [],
    questions: [],
    planner_ready_request: "Add enemy reaction behavior to grenade explosions in BABYLON.",
    should_create_plan: true,
    risk_level: "low",
  });
  const medium = scoreIntentConfidence({
    original_request: "make enemies smarter",
    interpreted_intent: "Improve enemy behavior.",
    clarity_score: 58,
    follow_up_questions: ["What should enemies do better first?"],
    missing_information: ["The exact behavior change is not specified."],
    ambiguity_flags: ["missing-behavior-detail"],
    answers: [],
    questions: [],
    planner_ready_request: null,
    should_create_plan: false,
    risk_level: "medium",
  });

  assert.equal(high.decision.action, "proceed_to_planning");
  assert.equal(medium.decision.action, "ask_one_question");
});