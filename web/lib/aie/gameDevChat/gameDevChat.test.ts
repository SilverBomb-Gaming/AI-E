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

test("session context starts session-only after a greeting without routing as game-dev help", () => {
  const response = planGameDevChatResponse("hello?");

  assert.equal(response.route.mode, "GREETING");
  assert.equal(response.sessionContext.memoryScope, "in-memory-session");
  assert.equal(response.sessionContext.scaffoldStatus, "SESSION_CONTEXT_MEMORY_PHASE1_SESSION_ONLY");
  assert.equal(response.changedFilesClaimed, false);
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
  const response = planGameDevChatResponse("continue", { previousRoute: previous.route, sessionContext: previous.sessionContext });

  assert.equal(response.route.mode, "CONTINUE_PREVIOUS");
  assert.equal(response.route.safetyStatus, "SAFE_RESPONSE_ONLY");
  assert.match(response.assistantMessage, /player movement and jump feel|jump/i);
  assert.match(response.assistantMessage, /session-scoped chat context only/);
});

test("continue after a Codex handoff resumes the same topic", () => {
  const handoff = planGameDevChatResponse("Make me a Codex handoff for adding collectibles in Unity.");
  const response = planGameDevChatResponse("continue", { previousRoute: handoff.route, sessionContext: handoff.sessionContext });

  assert.equal(response.route.mode, "CONTINUE_PREVIOUS");
  assert.match(response.assistantMessage, /collectible/i);
  assert.match(response.assistantMessage, /Latest handoff/i);
  assert.equal(response.sessionContext.latestCodexHandoffTopic?.includes("collectible"), true);
});

test("that did not work asks for troubleshooting context when no prior task exists", () => {
  const response = planGameDevChatResponse("that didn't work");

  assert.equal(response.route.mode, "CLARIFICATION_NEEDED");
  assert.equal(response.route.needsClarification, true);
});

test("that did not work troubleshoots previous task when context exists", () => {
  const previous = planGameDevChatResponse("Help me add a basic enemy patrol system.");
  const response = planGameDevChatResponse("that didn't work", { previousRoute: previous.route, sessionContext: previous.sessionContext });

  assert.equal(response.route.mode, "TROUBLESHOOT_PREVIOUS");
  assert.equal(response.route.safetyStatus, "SAFE_RESPONSE_ONLY");
  assert.match(response.assistantMessage, /enemy patrol/i);
  assert.match(response.assistantMessage, /Console error|log line/i);
});

test("make it more atmospheric refines the prior design prompt", () => {
  const design = planGameDevChatResponse("I have an idea for a small exploration game in Unity.");
  const response = planGameDevChatResponse("make it more atmospheric", { previousRoute: design.route, sessionContext: design.sessionContext });

  assert.equal(response.route.mode, "REFINE_PREVIOUS");
  assert.match(response.assistantMessage, /atmospheric/i);
  assert.match(response.assistantMessage, /planning only/i);
  assert.equal(response.sessionContext.activeGameplaySystem, "game atmosphere and tone");
});

test("use the last handoff references session handoff when available", () => {
  const handoff = planGameDevChatResponse("Make me a Codex handoff for adding a basic collectible system in Unity.");
  const response = planGameDevChatResponse("use the last handoff", { previousRoute: handoff.route, sessionContext: handoff.sessionContext });

  assert.equal(response.route.mode, "USE_LAST_HANDOFF");
  assert.match(response.assistantMessage, /latest handoff topic/i);
  assert.match(response.assistantMessage, /collectible/i);
});

test("what were we doing recaps session context", () => {
  const previous = planGameDevChatResponse("I want my player jump to feel less floaty.");
  const response = planGameDevChatResponse("what were we doing?", { previousRoute: previous.route, sessionContext: previous.sessionContext });

  assert.equal(response.route.mode, "SESSION_RECAP");
  assert.match(response.assistantMessage, /Here’s what I have in this chat session/);
  assert.match(response.assistantMessage, /jump|player movement/i);
});

test("no context available produces truthful clarification for vague follow-up", () => {
  const response = planGameDevChatResponse("make it more atmospheric");

  assert.equal(response.route.mode, "CLARIFICATION_NEEDED");
  assert.equal(response.route.needsClarification, true);
  assert.match(response.assistantMessage, /don’t have the earlier idea|session context/i);
  assert.match(response.assistantMessage, /session-scoped chat context only/);
});

test("development campaign prompt returns a campaign plan instead of fake execution", () => {
  const response = planGameDevChatResponse("what should AI-E build next to get closer to hands-off operation?");

  assert.equal(response.route.mode, "DEVELOPMENT_CAMPAIGN");
  assert.ok(response.developmentCampaign);
  assert.equal(response.developmentCampaign.plan.selectedLayer.layerId, "UNITY_WORKFLOW_AWARENESS_PHASE1");
  assert.equal(response.developmentCampaign.plan.claimsAutonomousExecution, false);
  assert.match(response.assistantMessage, /selected the next highest-impact unblocked development layer/i);
  assert.doesNotMatch(response.assistantMessage, /I edited|I ran Unity|I executed/i);
});

test("repo status prompt creates a scoped execution request without running it", () => {
  const response = planGameDevChatResponse("check repo status");

  assert.equal(response.route.mode, "SCOPED_EXECUTION_REQUEST");
  assert.ok(response.scopedExecution);
  assert.equal(response.scopedExecution.request.command, "git status --short");
  assert.equal(response.scopedExecution.request.approvalStatus, "pending");
  assert.equal(response.scopedExecution.log.executionStatus, "awaiting_approval");
  assert.equal(response.scopedExecution.log.truthfulnessLabel, "prepared_no_execution");
  assert.match(response.assistantMessage, /did not run the command/i);
  assert.doesNotMatch(response.assistantMessage, /I executed|I ran/i);
});

test("test run prompt prepares an approved-runtime request rather than fake execution", () => {
  const response = planGameDevChatResponse("run the tests");

  assert.equal(response.route.mode, "SCOPED_EXECUTION_REQUEST");
  assert.ok(response.scopedExecution);
  assert.equal(response.scopedExecution.request.command, "npm test");
  assert.equal(response.scopedExecution.request.workingDirectory, "repo-root/web");
  assert.match(response.assistantMessage, /Approval status: pending/);
  assert.match(response.assistantMessage, /No command was executed from the chat planner/);
});

test("build prompt prepares rollback-aware scoped execution request", () => {
  const response = planGameDevChatResponse("build the app");

  assert.equal(response.route.mode, "SCOPED_EXECUTION_REQUEST");
  assert.ok(response.scopedExecution);
  assert.equal(response.scopedExecution.request.command, "npm run build");
  assert.equal(response.scopedExecution.request.mutationPossible, true);
  assert.match(response.scopedExecution.request.rollbackPlan ?? "", /Remove generated .next/);
  assert.equal(response.scopedExecution.log.executionStatus, "awaiting_approval");
});

test("destructive execution prompt is blocked as scoped execution", () => {
  const response = planGameDevChatResponse("delete everything with git reset --hard");

  assert.equal(response.route.mode, "SCOPED_EXECUTION_REQUEST");
  assert.ok(response.scopedExecution);
  assert.equal(response.scopedExecution.request.riskLevel, "HIGH");
  assert.equal(response.scopedExecution.decision.executable, false);
  assert.match(response.scopedExecution.decision.blockedReason ?? "", /High-risk|blocked destructive/);
  assert.match(response.assistantMessage, /Execution status: blocked/);
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
  assert.doesNotMatch(response.assistantMessage, /I (changed|edited|updated|created|modified) .*file/i);
  assert.doesNotMatch(response.assistantMessage, /I ran Unity|I validated the scene|I executed/i);
  assert.match(response.assistantMessage, /If you want implementation, I can prepare a Codex handoff/);
});

test("scaffold status is truthful for active planning chat", () => {
  const response = planGameDevChatResponse("I want my player jump to feel less floaty.");

  assert.equal(response.scaffoldStatus, "SESSION_CONTEXT_AND_CONVERSATION_MEMORY_PHASE1");
  assert.equal(response.sessionContext.scaffoldStatus, "SESSION_CONTEXT_MEMORY_PHASE1_SESSION_ONLY");
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
