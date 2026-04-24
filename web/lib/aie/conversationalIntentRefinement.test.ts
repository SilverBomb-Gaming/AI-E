import assert from "node:assert/strict";
import test from "node:test";

import {
  convertRefinementToPlannerRequest,
  refineConversationalIntent,
} from "./conversationalIntentRefinement";

test("extremely vague request asks one simple narrowing question", () => {
  const result = refineConversationalIntent({
    rawRequest: "make the game better",
  });

  assert.equal(result.should_create_plan, false);
  assert.equal(result.should_ask_follow_up, true);
  assert.equal(result.next_action, "ask-follow-up");
  assert.equal(result.follow_up_questions.length, 1);
  assert.match(result.follow_up_questions[0] ?? "", /Which part should improve first/i);
  assert.ok(result.clarity_score < 60);
});

test("vague but directionally understandable enemy request asks one targeted follow-up", () => {
  const result = refineConversationalIntent({
    rawRequest: "make enemies smarter",
    projectName: "BABYLON Unity gameplay project",
  });

  assert.equal(result.should_create_plan, false);
  assert.equal(result.should_ask_follow_up, true);
  assert.ok(result.ambiguity_flags.includes("missing-behavior-detail"));
  assert.match(result.follow_up_questions[0] ?? "", /What should enemies do better first/i);
});

test("clear gameplay request proceeds directly to planning", () => {
  const source = {
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  };
  const result = refineConversationalIntent(source);

  assert.equal(result.should_create_plan, true);
  assert.equal(result.should_ask_follow_up, false);
  assert.equal(result.next_action, "create-plan");
  assert.match(result.interpreted_intent, /enemy AI reaction to grenade explosions/i);
  assert.equal(result.planner_ready_request, "Add enemy reaction behavior to grenade explosions in BABYLON.");

  const plannerRequest = convertRefinementToPlannerRequest(result, source);
  assert.ok(plannerRequest);
  assert.equal(plannerRequest?.rawRequest, result.planner_ready_request);
});

test("risky overnight autonomy request is blocked and narrowed", () => {
  const result = refineConversationalIntent({
    rawRequest: "do everything automatically overnight",
  });

  assert.equal(result.risk_level, "high");
  assert.equal(result.should_create_plan, false);
  assert.equal(result.next_action, "block");
  assert.equal(result.follow_up_questions.length, 1);
  assert.match(result.follow_up_questions[0] ?? "", /first safe bounded task/i);
});

test("low vocabulary uncertain wording is simplified and asks a focused question", () => {
  const result = refineConversationalIntent({
    rawRequest: "i dont know how to say it but make it feel less boring",
  });

  assert.equal(result.user_level_estimate, "plain-language");
  assert.equal(result.should_create_plan, false);
  assert.equal(result.next_action, "simplify");
  assert.match(result.simplified_rest_above_user_request, /feel less boring/i);
  assert.match(result.follow_up_questions[0] ?? "", /combat feel, enemy behavior, movement, visuals, or level pacing/i);
});

test("specific technical request is planner-ready without follow-up", () => {
  const result = refineConversationalIntent({
    rawRequest: "add unit tests for queue parsing and update the README example",
    repoName: "AI-E",
  });

  assert.equal(result.should_create_plan, true);
  assert.equal(result.should_ask_follow_up, false);
  assert.equal(result.risk_level, "low");
  assert.match(result.interpreted_intent, /documentation and test coverage/i);
  assert.ok(result.planner_ready_request);
});

test("playtest-sensitive gameplay feel request proceeds to planning", () => {
  const result = refineConversationalIntent({
    rawRequest: "make the jump feel tighter and checkpoints less frustrating",
    projectName: "OpenClaw platformer sandbox",
  });

  assert.equal(result.should_create_plan, true);
  assert.equal(result.should_ask_follow_up, false);
  assert.ok(result.ambiguity_flags.includes("playtest-sensitive"));
  assert.match(result.planner_ready_request ?? "", /required human playtesting/i);
});