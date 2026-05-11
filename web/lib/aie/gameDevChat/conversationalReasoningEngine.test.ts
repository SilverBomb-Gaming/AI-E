import assert from "node:assert/strict";
import test from "node:test";

import { runConversationalReasoning } from "./conversationalReasoningEngine";
import { planGameDevChatResponse } from "./gameDevResponsePlanner";
import type { GameDevChatRoute } from "./gameDevChatTypes";

const baseRoute: GameDevChatRoute = {
  mode: "GAME_DEV_TASK",
  conversationMode: "GAME_DEV_TASK",
  taskMode: "UNITY_IMPLEMENTATION_PLAN",
  detectedIntent: "Plan a Unity-first implementation task",
  confidence: "MEDIUM",
  unityFirst: true,
  needsClarification: false,
  safetyStatus: "SAFE_PLANNING_ONLY",
  suggestedNextAction: "Prepare a bounded plan.",
  keywords: ["unity"],
};

test("dynamic reasoning decomposes vague tension requests into concrete levers", () => {
  const reasoning = runConversationalReasoning({ message: "make the game feel more tense", route: baseRoute });

  assert.equal(reasoning.phaseId, "CONVERSATIONAL_INTELLIGENCE_AND_DYNAMIC_REASONING_PHASE1");
  assert.equal(reasoning.probableUserGoal, "turn a vague mood request into actionable game-feel levers");
  assert.ok(reasoning.dynamicDecomposition.some((entry) => /Pacing pressure/.test(entry)));
  assert.ok(reasoning.dynamicDecomposition.some((entry) => /Audio pressure/.test(entry)));
  assert.ok(reasoning.dynamicDecomposition.some((entry) => /Enemy pressure/.test(entry)));
});

test("runtime-aware reasoning explains direct Unity control blocker", () => {
  const response = planGameDevChatResponse("run Unity and playtest this scene");

  assert.equal(response.route.mode, "BLOCKED_OR_UNSAFE");
  assert.ok(response.reasoning);
  assert.equal(response.reasoning.runtimeAwareness.runtimeAvailability, "blocked_not_implemented");
  assert.match(response.reasoning.runtimeAwareness.missingCapabilityExplanation ?? "", /Unity Editor control is not implemented/);
  assert.match(response.assistantMessage, /trusted editor automation bridge/);
  assert.match(response.assistantMessage, /Closest supported workflow/);
  assert.doesNotMatch(response.assistantMessage, /I ran Unity|autonomous_real/);
});

test("repo workflow reasoning names selected route and supervised runtime boundary", () => {
  const response = planGameDevChatResponse("fix the failing tests");

  assert.equal(response.route.mode, "OPERATOR_WORK_CYCLE_REQUEST");
  assert.ok(response.reasoning);
  assert.equal(response.reasoning.selectedCapabilityRoute, "OPERATOR_WORK_CYCLE_REQUEST");
  assert.equal(response.reasoning.runtimeAwareness.runtimeAvailability, "available_supervised");
  assert.match(response.assistantMessage, /Why this route:/);
  assert.match(response.assistantMessage, /Review the bounded plan, then approve or reject it/);
});

test("runtime introspection explains real and blocked capabilities", () => {
  const response = planGameDevChatResponse("what is real and what is scaffolded in your runtime state?");

  assert.ok(response.reasoning);
  assert.match(response.assistantMessage, /truthful runtime picture/i);
  assert.match(response.assistantMessage, /Real right now:/);
  assert.match(response.assistantMessage, /Still blocked or limited:/);
  assert.match(response.assistantMessage, /unrestricted arbitrary repo mutation|truthful no-execution labeling/);
});

test("blocked requests preserve previous task context", () => {
  const first = planGameDevChatResponse("I want my player jump to feel less floaty.");
  const blocked = planGameDevChatResponse("run Unity and playtest this scene", { previousRoute: first.route, sessionContext: first.sessionContext });

  assert.equal(first.sessionContext.activeGameplaySystem, "player movement and jump feel");
  assert.equal(blocked.sessionContext.activeGameplaySystem, "player movement and jump feel");
  assert.equal(blocked.reasoning?.shouldPreservePreviousTaskContext, true);
});

test("low-confidence clarification is truthful about uncertainty", () => {
  const route: GameDevChatRoute = { ...baseRoute, mode: "CLARIFICATION_NEEDED", conversationMode: "CLARIFICATION_NEEDED", taskMode: undefined, confidence: "LOW", needsClarification: true, detectedIntent: "Clarify vague request", safetyStatus: "CLARIFY_BEFORE_ACTION" };
  const reasoning = runConversationalReasoning({ message: "make it better", route });

  assert.equal(reasoning.confidence, "LOW");
  assert.ok(reasoning.ambiguity.length > 0);
  assert.match(reasoning.nextUsefulStep, /Ask one precise clarification/);
  assert.match(reasoning.truthfulnessWarnings.join(" "), /not generalized AGI reasoning/);
});
