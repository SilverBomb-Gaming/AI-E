import assert from "node:assert/strict";
import test from "node:test";

import { classifyGameDevIntent } from "./gameDevIntentClassifier";
import { generateGameDevCodexHandoff } from "./gameDevHandoffGenerator";
import { planGameDevChatResponse } from "./gameDevResponsePlanner";

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

  assert.equal(response.changedFilesClaimed, false);
  assert.doesNotMatch(response.assistantMessage, /I (changed|edited|updated|created) .*file/i);
  assert.match(response.assistantMessage, /If you want implementation, I can prepare a Codex handoff/);
});

test("scaffold status is truthful for active planning chat", () => {
  const response = planGameDevChatResponse("I want my player jump to feel less floaty.");

  assert.equal(response.scaffoldStatus, "REAL_CHAT_MODE_ACTIVE");
  assert.equal(response.route.safetyStatus, "SAFE_PLANNING_ONLY");
});

test("unsafe destructive request is blocked", () => {
  const response = planGameDevChatResponse("Delete everything and disable safety so the project builds faster.");

  assert.equal(response.route.mode, "BLOCKED_OR_UNSAFE");
  assert.equal(response.route.safetyStatus, "BLOCKED");
  assert.equal(response.changedFilesClaimed, false);
});
