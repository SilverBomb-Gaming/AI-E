import assert from "node:assert/strict";
import test from "node:test";

import {
  computeConfidenceScore,
  determineNextAction,
  selectBestFollowUpQuestion,
  shouldStopAsking,
} from "./adaptiveConversationalLogic";
import {
  answerConversationalLoopQuestion,
  startConversationalLoop,
} from "./multiTurnConversationalLoop";

test("high-confidence request skips questions and becomes planner_ready", () => {
  const result = startConversationalLoop({
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });

  assert.equal(result.status, "planner_ready");
  assert.equal(result.session.questions.length, 0);
  assert.ok(result.session.confidence_score >= 75);
});

test("medium-confidence request asks one question then proceeds", () => {
  const started = startConversationalLoop({
    rawRequest: "make enemies smarter",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });
  assert.equal(started.session.questions.length, 1);

  const answered = answerConversationalLoopQuestion(started.session, {
    answer: "when grenade blows up",
  });

  assert.equal(answered.status, "planner_ready");
  assert.equal(answered.next_action, "create-plan");
});

test("low-confidence request asks up to 2 to 3 questions", () => {
  const started = startConversationalLoop({
    rawRequest: "make game better",
    projectName: "OpenClaw",
  });
  const afterFirst = answerConversationalLoopQuestion(started.session, { answer: "enemies first" });

  assert.ok(afterFirst.session.questions.length <= 3);
  assert.ok(afterFirst.session.questions.length >= 2);
});

test("repetitive vague answers stop asking and proceed with assumptions", () => {
  const started = startConversationalLoop({
    rawRequest: "make game better",
    projectName: "OpenClaw",
    repoName: "AI-E",
  });
  const afterFirst = answerConversationalLoopQuestion(started.session, { answer: "better" });
  const openQuestion = afterFirst.session.questions.find((question) => !question.answered)?.question_id;
  assert.ok(openQuestion);

  const afterSecond = answerConversationalLoopQuestion(afterFirst.session, {
    question_id: openQuestion,
    answer: "better",
  });

  assert.equal(afterSecond.status, "planner_ready");
  assert.equal(afterSecond.session.stop_reason, "repetitive_vague_answers");
  assert.ok(afterSecond.planner_ready_request);
});

test("high-risk request is blocked", () => {
  const result = startConversationalLoop({
    rawRequest: "do everything automatically overnight",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.session.stop_reason, "high_risk_request");
});

test("confidence improves after each answer", () => {
  const started = startConversationalLoop({
    rawRequest: "make game better",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });
  const afterFirst = answerConversationalLoopQuestion(started.session, { answer: "enemies first" });
  const openQuestion = afterFirst.session.questions.find((question) => !question.answered)?.question_id;
  assert.ok(openQuestion);
  const afterSecond = answerConversationalLoopQuestion(afterFirst.session, {
    question_id: openQuestion,
    answer: "when grenade blows up",
  });

  assert.ok(afterFirst.session.confidence_score > started.session.confidence_score);
  assert.ok(afterSecond.session.confidence_score >= afterFirst.session.confidence_score);
});

test("question prioritization selects better question first", () => {
  const best = selectBestFollowUpQuestion({
    clarity_score: 42,
    confidence_score: 40,
    missing_information: ["The first area to improve is not named."],
    answers: [],
    questions: [],
    latest_refinement: {
      risk_level: "medium",
      follow_up_questions: [
        "Should we validate with playtest or tests?",
        "Which part should improve first: enemies, weapons, or controls?",
      ],
      planner_ready_request: null,
      should_create_plan: false,
      ambiguity_flags: ["missing-target-area"],
      missing_information: ["The first area to improve is not named."],
      clarity_score: 42,
      confidence_score: 40,
    },
  });

  assert.match(best.question ?? "", /Which part should improve first/i);
  assert.equal(best.priority, "scope-defining");
});

test("no more than 3 total follow-ups are asked", () => {
  const started = startConversationalLoop({
    rawRequest: "make game better",
  });
  const afterFirst = answerConversationalLoopQuestion(started.session, { answer: "better" });
  const firstOpen = afterFirst.session.questions.find((question) => !question.answered)?.question_id;
  assert.ok(firstOpen);
  const afterSecond = answerConversationalLoopQuestion(afterFirst.session, { question_id: firstOpen, answer: "better" });

  assert.ok(afterSecond.session.questions.length <= 3);
});

test("stop condition triggers correctly for diminishing returns", () => {
  const decision = shouldStopAsking({
    clarity_score: 48,
    confidence_score: 46,
    missing_information: ["The exact behavior change is not specified."],
    answers: [{ answer: "enemies" }, { answer: "enemy" }],
    questions: [{ prompt: "Which part should improve first?", answered: true }],
    latest_refinement: {
      risk_level: "medium",
      follow_up_questions: ["What should enemies do better first?"],
      planner_ready_request: null,
      should_create_plan: false,
      ambiguity_flags: ["missing-behavior-detail"],
      missing_information: ["The exact behavior change is not specified."],
      clarity_score: 50,
      confidence_score: 44,
    },
  }, 47);

  assert.equal(decision.should_stop, true);
  assert.equal(decision.reason, "diminishing_returns");
});

test("planner-ready request is still produced deterministically", () => {
  const started = startConversationalLoop({
    rawRequest: "make enemies smarter",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });
  const answered = answerConversationalLoopQuestion(started.session, {
    answer: "when grenade blows up",
  });

  assert.equal(answered.planner_ready_request?.rawRequest, "Add enemy reaction behavior to grenade explosions in BABYLON.");
});

test("determineNextAction proceeds when confidence is high enough", () => {
  const decision = determineNextAction({
    clarity_score: 90,
    confidence_score: 88,
    missing_information: [],
    answers: [],
    questions: [],
    latest_refinement: {
      risk_level: "low",
      follow_up_questions: [],
      planner_ready_request: "Add enemy reaction behavior to grenade explosions in BABYLON.",
      should_create_plan: true,
      ambiguity_flags: [],
      missing_information: [],
      clarity_score: 90,
      confidence_score: 88,
    },
  });

  assert.equal(decision.proceed_to_planning, true);
  assert.equal(decision.should_ask_follow_up, false);
});

test("computeConfidenceScore penalizes critical ambiguity and rewards answers", () => {
  const base = computeConfidenceScore({
    clarity_score: 42,
    confidence_score: 40,
    missing_information: ["The first area to improve is not named."],
    answers: [],
    questions: [],
    latest_refinement: {
      risk_level: "medium",
      follow_up_questions: ["Which part should improve first?"],
      planner_ready_request: null,
      should_create_plan: false,
      ambiguity_flags: ["missing-target-area"],
      missing_information: ["The first area to improve is not named."],
      clarity_score: 42,
      confidence_score: 40,
    },
  });
  const withAnswer = computeConfidenceScore({
    clarity_score: 55,
    confidence_score: 52,
    missing_information: ["The exact behavior change is not specified."],
    answers: [{ answer: "enemies first" }],
    questions: [{ prompt: "Which part should improve first?", answered: true }],
    latest_refinement: {
      risk_level: "medium",
      follow_up_questions: ["What should enemies do better first?"],
      planner_ready_request: null,
      should_create_plan: false,
      ambiguity_flags: ["missing-behavior-detail"],
      missing_information: ["The exact behavior change is not specified."],
      clarity_score: 55,
      confidence_score: 52,
    },
  });

  assert.ok(withAnswer > base);
});