import assert from "node:assert/strict";
import test from "node:test";

import { refineConversationalIntent } from "./conversationalIntentRefinement";
import {
  answerConversationalLoopQuestion,
  startConversationalLoop,
  summarizeConversationalLoop,
} from "./multiTurnConversationalLoop";

test("make game better starts awaiting_clarification", () => {
  const result = startConversationalLoop({
    rawRequest: "make game better",
    projectName: "OpenClaw",
  });

  assert.equal(result.status, "awaiting_clarification");
  assert.equal(result.session.questions.length, 1);
  assert.match(result.session.questions[0]?.prompt ?? "", /Which part should improve first/i);
});

test("answering enemies first makes or moves toward planner_ready", () => {
  const started = startConversationalLoop({
    rawRequest: "make game better",
    projectName: "OpenClaw",
  });
  const result = answerConversationalLoopQuestion(started.session, {
    answer: "enemies first",
    answeredAt: "2026-04-24T10:05:00.000Z",
  });

  assert.ok(["awaiting_clarification", "planner_ready"].includes(result.status));
  assert.match(result.session.current_interpretation, /enemy/i);
});

test("make enemies smarter when grenade blows up becomes planner_ready quickly", () => {
  const result = startConversationalLoop({
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });

  assert.equal(result.status, "planner_ready");
  assert.equal(result.next_action, "create-plan");
  assert.equal(result.session.stop_reason, "confidence_sufficient");
  assert.equal(result.session.questions.length, 0);
  assert.equal(result.planner_ready_request?.rawRequest, "Add enemy reaction behavior to grenade explosions in BABYLON.");
});

test("do everything automatically overnight blocks", () => {
  const result = startConversationalLoop({
    rawRequest: "do everything automatically overnight",
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.session.blockers.some((blocker) => blocker.code === "risky_autonomy"));
});

test("low-vocabulary input gets simple follow-up question", () => {
  const result = startConversationalLoop({
    rawRequest: "i dont know how to say it but make it feel less boring",
  });

  assert.equal(result.session.user_level_estimate, "plain-language");
  assert.match(result.session.questions[0]?.prompt ?? "", /combat feel, enemy behavior, movement, visuals, or level pacing/i);
});

test("no more than 3 questions are asked at once", () => {
  const result = startConversationalLoop({
    rawRequest: "make game better and fix stuff",
  });

  assert.ok(result.session.questions.length <= 3);
});

test("transcript preserves original request and answers", () => {
  const started = startConversationalLoop({
    rawRequest: "make game better",
  });
  const answered = answerConversationalLoopQuestion(started.session, { answer: "enemies first" });

  assert.equal(answered.session.transcript[0]?.content, "make game better");
  assert.ok(answered.session.transcript.some((turn) => turn.kind === "answer" && /enemies first/i.test(turn.content)));
});

test("planner_ready_request updates after answers", () => {
  const started = startConversationalLoop({
    rawRequest: "make game better",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });
  const afterFirstAnswer = answerConversationalLoopQuestion(started.session, { answer: "enemies first" });
  const secondQuestionId = afterFirstAnswer.session.questions.find((question) => !question.answered)?.question_id;
  assert.ok(secondQuestionId);

  const afterSecondAnswer = answerConversationalLoopQuestion(afterFirstAnswer.session, {
    question_id: secondQuestionId,
    answer: "when grenade blows up",
  });

  assert.equal(afterSecondAnswer.status, "planner_ready");
  assert.equal(afterSecondAnswer.planner_ready_request?.rawRequest, "Add enemy reaction behavior to grenade explosions in BABYLON.");
});

test("summary is readable", () => {
  const result = startConversationalLoop({
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
  });
  const summary = summarizeConversationalLoop(result.session);

  assert.match(summary, /Conversation session:/i);
  assert.match(summary, /Status:/i);
  assert.match(summary, /Current interpretation:/i);
  assert.match(summary, /Question necessity:/i);
});

test("works with existing conversationalIntentRefinement output", () => {
  const existingRefinement = refineConversationalIntent({
    rawRequest: "make the game better",
    projectName: "OpenClaw",
  });
  const result = startConversationalLoop({
    rawRequest: "make the game better",
    projectName: "OpenClaw",
    existingRefinement,
  });

  assert.equal(result.session.current_interpretation, existingRefinement.interpreted_intent);
  assert.equal(result.session.questions[0]?.prompt, existingRefinement.follow_up_questions[0]);
});