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

  assert.equal(reasoning.phaseId, "NON_REPETITIVE_RESPONSE_SYNTHESIS_AND_ROUTING_PRECISION_PHASE1");
  assert.equal(reasoning.probableUserGoal, "analyze tension design feedback into causes, levers, questions, and validation");
  assert.ok(reasoning.dynamicDecomposition.some((entry) => /pacing pressure/i.test(entry)));
  assert.ok(reasoning.dynamicDecomposition.some((entry) => /audio pressure/i.test(entry)));
  assert.ok(reasoning.dynamicDecomposition.some((entry) => /enemy pressure/i.test(entry)));
});

test("deep gameplay feedback exposes category dimensions and strategy", () => {
  const reasoning = runConversationalReasoning({ message: "the combat lacks impact", route: baseRoute });

  assert.equal(reasoning.phaseId, "NON_REPETITIVE_RESPONSE_SYNTHESIS_AND_ROUTING_PRECISION_PHASE1");
  assert.equal(reasoning.inferredFeedbackCategory, "combat_impact");
  assert.equal(reasoning.categoryMatchKind, "exact");
  assert.equal(reasoning.selectedResponseStrategy, "diagnose sensory impact stack before implementation");
  assert.ok(reasoning.decompositionDimensions.includes("hit stop"));
  assert.ok(reasoning.decompositionDimensions.includes("VFX contact clarity"));
  assert.equal(reasoning.runtimeAwareness.runtimeAvailability, "not_applicable");
});

test("runtime-aware reasoning explains direct Unity control blocker", () => {
  const response = planGameDevChatResponse("run Unity and playtest this scene");

  assert.equal(response.route.mode, "BLOCKED_OR_UNSAFE");
  assert.ok(response.reasoning);
  assert.equal(response.reasoning.runtimeAwareness.runtimeAvailability, "blocked_not_implemented");
  assert.match(response.reasoning.runtimeAwareness.missingCapabilityExplanation ?? "", /Unity Editor control is not implemented/);
  assert.match(response.assistantMessage, /trusted editor automation bridge/);
  assert.equal(response.reasoning.executionOwnership.phaseId, "INTERNAL_EXECUTION_AND_OPERATOR_OWNERSHIP_PHASE1");
  assert.equal(response.reasoning.executionOwnership.ownerLabel, "AI-E Supervised Runtime");
  assert.equal(response.reasoning.executionOwnership.kind, "blocked_capability");
  assert.match(response.assistantMessage, /Closest supported AI-E workflow/);
  assert.doesNotMatch(response.assistantMessage, /I ran Unity|autonomous_real/);
});

test("repo workflow reasoning names selected route and supervised runtime boundary", () => {
  const response = planGameDevChatResponse("fix the failing tests");

  assert.equal(response.route.mode, "OPERATOR_WORK_CYCLE_REQUEST");
  assert.ok(response.reasoning);
  assert.equal(response.reasoning.selectedCapabilityRoute, "OPERATOR_WORK_CYCLE_REQUEST");
  assert.equal(response.reasoning.runtimeAwareness.runtimeAvailability, "available_supervised");
  assert.equal(response.reasoning.executionOwnership.phaseId, "INTERNAL_EXECUTION_AND_OPERATOR_OWNERSHIP_PHASE1");
  assert.equal(response.reasoning.executionOwnership.ownerLabel, "AI-E Supervised Runtime");
  assert.equal(response.reasoning.executionOwnership.workflowType, "supervised_repo_workflow");
  assert.match(response.assistantMessage, /Why this route:/);
  assert.match(response.assistantMessage, /Review the bounded plan, then approve or reject it/);
});

test("runtime introspection explains real and blocked capabilities", () => {
  const response = planGameDevChatResponse("what is real and what is scaffolded in your runtime state?");

  assert.ok(response.reasoning);
  assert.equal(response.reasoning.runtimeIntrospection?.kind, "capability_status_query");
  assert.equal(response.reasoning.executionOwnership.ownerLabel, "AI-E Supervised Runtime");
  assert.match(response.assistantMessage, /truthful runtime picture/i);
  assert.match(response.assistantMessage, /What is real:/);
  assert.match(response.assistantMessage, /What is blocked:/);
  assert.doesNotMatch(response.assistantMessage, /Reasoning summary:/);
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

test("external tooling prompts expose execution ownership dependency metadata", () => {
  const response = planGameDevChatResponse("what still requires external tooling?");

  assert.ok(response.reasoning);
  assert.equal(response.reasoning.runtimeIntrospection?.kind, "external_dependency_query");
  assert.equal(response.reasoning.executionOwnership.phaseId, "INTERNAL_EXECUTION_AND_OPERATOR_OWNERSHIP_PHASE1");
  assert.equal(response.reasoning.executionOwnership.ownerLabel, "AI-E Supervised Runtime");
  assert.equal(response.reasoning.executionOwnership.kind, "external_dependency");
  assert.equal(response.reasoning.executionOwnership.workflowType, "external_tooling_status");
  assert.ok(response.reasoning.executionOwnership.externalToolingRequired.length >= 2);
  assert.match(response.assistantMessage, /Execution owner: AI-E Supervised Runtime/);
  assert.match(response.assistantMessage, /Broad code-writing outside approved AI-E supervised workflow lanes/);
});
