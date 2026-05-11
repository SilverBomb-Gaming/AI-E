import assert from "node:assert/strict";
import test from "node:test";

import { classifyGameDevIntent } from "./gameDevIntentClassifier";
import { generateGameDevCodexHandoff } from "./gameDevHandoffGenerator";
import { planGameDevChatResponse } from "./gameDevResponsePlanner";

test("hello is handled as a greeting before game-dev classification", () => {
  const response = planGameDevChatResponse("hello?");

  assert.equal(response.route.mode, "GREETING");
  assert.equal(response.route.conversationMode, "GREETING");
  assert.equal(response.route.safetyStatus, "SAFE_RESPONSE_ONLY");
  assert.match(response.assistantMessage, /Hey/);
  assert.doesNotMatch(response.assistantMessage, /game-development question/);
});

test("thanks is handled as social acknowledgement", () => {
  const response = planGameDevChatResponse("thanks");

  assert.equal(response.route.mode, "THANKS");
  assert.equal(response.route.safetyStatus, "SAFE_RESPONSE_ONLY");
});

test("goodnight closes the session conversationally", () => {
  const response = planGameDevChatResponse("goodnight");

  assert.equal(response.route.mode, "SESSION_CLOSE");
  assert.equal(response.route.safetyStatus, "SAFE_RESPONSE_ONLY");
});

test("capability help stays meta instead of becoming a task", () => {
  const response = planGameDevChatResponse("what can you do?");

  assert.equal(response.route.mode, "CAPABILITY_HELP");
  assert.equal(response.route.safetyStatus, "SAFE_RESPONSE_ONLY");
  assert.match(response.assistantMessage, /game-dev planning assistant/);
});

test("continue asks for context when no previous task exists", () => {
  const response = planGameDevChatResponse("continue");

  assert.equal(response.route.mode, "CLARIFICATION_NEEDED");
  assert.equal(response.route.needsClarification, true);
});

test("continue uses previous task context when available", () => {
  const previous = planGameDevChatResponse("I want my player jump to feel less floaty.");
  const response = planGameDevChatResponse("continue", { previousRoute: previous.route });

  assert.equal(response.route.mode, "CONTINUE_PREVIOUS");
  assert.equal(response.route.safetyStatus, "SAFE_RESPONSE_ONLY");
});

test("that did not work asks for troubleshooting context when no prior task exists", () => {
  const response = planGameDevChatResponse("that didn't work");

  assert.equal(response.route.mode, "CLARIFICATION_NEEDED");
  assert.equal(response.route.needsClarification, true);
});

test("that did not work troubleshoots previous task when context exists", () => {
  const previous = planGameDevChatResponse("Help me add a basic enemy patrol system.");
  const response = planGameDevChatResponse("that didn't work", { previousRoute: previous.route });

  assert.equal(response.route.mode, "TROUBLESHOOT_PREVIOUS");
  assert.equal(response.route.safetyStatus, "SAFE_RESPONSE_ONLY");
});

test("jump tuning request is classified as a Unity implementation plan", () => {
  const route = classifyGameDevIntent("I want my player jump to feel less floaty.");

  assert.equal(route.mode, "UNITY_IMPLEMENTATION_PLAN");
  assert.equal(route.unityFirst, true);
  assert.equal(route.safetyStatus, "SAFE_PLANNING_ONLY");
});

test("enemy patrol request is classified as a Unity implementation plan", () => {
  const route = classifyGameDevIntent("Help me add a basic enemy patrol system.");

  assert.equal(route.mode, "UNITY_IMPLEMENTATION_PLAN");
  assert.equal(route.unityFirst, true);
  assert.equal(route.detectedIntent, "Plan a Unity-first implementation task");
});

test("vague game idea asks for clarification before implementation", () => {
  const route = classifyGameDevIntent("I have an idea for a game but I don't know how to explain it.");

  assert.equal(["GAME_DESIGN_IDEA", "CLARIFICATION_NEEDED"].includes(route.mode), true);
  assert.equal(route.needsClarification, true);
  assert.equal(route.safetyStatus, "CLARIFY_BEFORE_ACTION");
});

test("bug report is classified as a bug fix request", () => {
  const route = classifyGameDevIntent("My Unity player controller throws a NullReferenceException after I press jump. Can you fix it?");

  assert.equal(route.mode, "BUG_FIX_REQUEST");
  assert.equal(route.unityFirst, true);
  assert.equal(route.safetyStatus, "SAFE_PLANNING_ONLY");
});

test("Codex handoff request generates structured handoff", () => {
  const message = "Make me a Codex handoff for adding a basic collectible system in Unity.";
  const response = planGameDevChatResponse(message);

  assert.equal(response.route.mode, "CODEX_HANDOFF_REQUEST");
  assert.equal(response.route.conversationMode, "CODEX_HANDOFF_REQUEST");
  assert.equal(response.route.taskMode, "CODEX_HANDOFF_REQUEST");
  assert.ok(response.codexHandoff);
  assert.match(response.codexHandoff.markdown, /# Codex Handoff/);
  assert.match(response.codexHandoff.markdown, /Files To Inspect First/);
  assert.match(response.codexHandoff.markdown, /Collectible/);
  assert.match(response.codexHandoff.markdown, /Chat mode prepared this handoff only/);
});

test("handoff generator keeps implementation bounded and Unity-first", () => {
  const route = classifyGameDevIntent("Make me a Codex handoff for adding a basic enemy patrol system in Unity.");
  const handoff = generateGameDevCodexHandoff("Make me a Codex handoff for adding a basic enemy patrol system in Unity.", route);

  assert.equal(handoff.targetEngine, "Unity");
  assert.equal(handoff.filesToInspect.some((entry) => entry.includes("EnemyPatrol")), true);
  assert.equal(handoff.safetyChecks.some((entry) => entry.includes("Do not invent files")), true);
  assert.equal(handoff.validationPlan.length >= 2, true);
});

test("responses do not claim files were edited", () => {
  const response = planGameDevChatResponse("Help me add a basic enemy patrol system.");

  assert.equal(response.route.mode, "GAME_DEV_TASK");
  assert.equal(response.route.taskMode, "UNITY_IMPLEMENTATION_PLAN");
  assert.equal(response.changedFilesClaimed, false);
  assert.doesNotMatch(response.assistantMessage, /I (changed|edited|updated|created) .*file/i);
  assert.match(response.assistantMessage, /If you want implementation, I can prepare a Codex handoff/);
});

test("scaffold status is truthful for active planning chat", () => {
  const response = planGameDevChatResponse("I want my player jump to feel less floaty.");

  assert.equal(response.scaffoldStatus, "CONVERSATIONAL_ORCHESTRATION_ACTIVE");
  assert.equal(response.route.mode, "GAME_DEV_TASK");
  assert.equal(response.route.taskMode, "UNITY_IMPLEMENTATION_PLAN");
  assert.equal(response.route.safetyStatus, "SAFE_PLANNING_ONLY");
});

test("unsafe destructive request is blocked", () => {
  const response = planGameDevChatResponse("Delete everything and disable safety so the project builds faster.");

  assert.equal(response.route.mode, "BLOCKED_OR_UNSAFE");
  assert.equal(response.route.safetyStatus, "BLOCKED");
  assert.equal(response.changedFilesClaimed, false);
});
