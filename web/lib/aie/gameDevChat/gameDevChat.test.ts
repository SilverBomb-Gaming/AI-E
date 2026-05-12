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
  assert.match(response.assistantMessage, /Latest supervised brief/i);
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
  assert.match(response.assistantMessage, /latest supervised brief topic/i);
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

test("bounded work cycle prompt prepares an operator cycle without running it", () => {
  const response = planGameDevChatResponse("run the bounded work cycle");

  assert.equal(response.route.mode, "OPERATOR_WORK_CYCLE_REQUEST");
  assert.ok(response.workCycle);
  assert.equal(response.workCycle.request.approvalStatus, "pending");
  assert.equal(response.workCycle.request.cycleStatus, "prepared");
  assert.equal(response.workCycle.request.retryLimit, 1);
  assert.equal(response.workCycle.request.targetFiles[0], "runner_artifacts/operator_work_cycle/latest_cycle_request.txt");
  assert.match(response.assistantMessage, /no cycle ran from chat/i);
  assert.doesNotMatch(response.assistantMessage, /I executed|I mutated|I validated/i);
});

test("repo workflow prompt dynamically prepares visible supervised work", () => {
  const response = planGameDevChatResponse("inspect the interaction system");

  assert.equal(response.route.mode, "OPERATOR_WORK_CYCLE_REQUEST");
  assert.ok(response.workCycle);
  assert.match(response.workCycle.request.cycleIntent, /repo_inspection/);
  assert.deepEqual(response.workCycle.request.validationPlan.commands, ["git diff --name-only"]);
  assert.match(response.workCycle.request.proposedChanges[0]?.proposedContent ?? "", /requiredCapabilities=/);
  assert.match(response.assistantMessage, /Visible lifecycle: preparing, approval requested, executing, mutating, validating, checkpointing, completed or blocked/);
  assert.match(response.assistantMessage, /Reasoning summary:/);
  assert.equal(response.reasoning?.runtimeAwareness.runtimeAvailability, "available_supervised");
  assert.match(response.assistantMessage, /approval launches the trusted AI-E runtime API/);
  assert.doesNotMatch(response.assistantMessage, /I executed|I mutated|I validated|autonomous_real/i);
});

test("vague tension prompt receives dynamic decomposition instead of generic fallback", () => {
  const response = planGameDevChatResponse("make the game feel more tense");

  assert.ok(response.reasoning);
  assert.equal(response.reasoning.inferredFeedbackCategory, "tension_design");
  assert.match(response.assistantMessage, /What this probably means/);
  assert.match(response.assistantMessage, /Likely causes/);
  assert.match(response.assistantMessage, /Highest leverage fixes/);
  assert.match(response.assistantMessage, /Small validation loop/);
  assert.doesNotMatch(response.assistantMessage, /Keep the next step small and testable/);
});

test("combat lacks impact gets specific impact-stack reasoning", () => {
  const response = planGameDevChatResponse("the combat lacks impact");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "combat_impact");
  assert.match(response.assistantMessage, /What this probably means/);
  assert.match(response.assistantMessage, /hit-stop|hit stop/i);
  assert.match(response.assistantMessage, /screen shake/i);
  assert.match(response.assistantMessage, /enemy reaction/i);
  assert.match(response.assistantMessage, /animation anticipation/i);
  assert.match(response.assistantMessage, /sound transients/i);
  assert.match(response.assistantMessage, /controller vibration/i);
  assert.match(response.assistantMessage, /camera impulse/i);
  assert.match(response.assistantMessage, /VFX contact clarity/i);
  assert.doesNotMatch(response.assistantMessage, /Clarify the real target|Identify the smallest useful next step|Name the relevant capability boundary/);
});

test("players lose interest after 10 minutes gets retention pacing reasoning", () => {
  const response = planGameDevChatResponse("players lose interest after 10 minutes");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "player_interest_dropoff");
  assert.match(response.assistantMessage, /first meaningful reward|first reward/i);
  assert.match(response.assistantMessage, /novelty/i);
  assert.match(response.assistantMessage, /goal/i);
  assert.match(response.assistantMessage, /challenge/i);
  assert.match(response.assistantMessage, /dead traversal/i);
  assert.match(response.assistantMessage, /short-term objective/i);
});

test("pacing feels inconsistent gets rhythm decomposition", () => {
  const response = planGameDevChatResponse("the pacing feels inconsistent");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "pacing_inconsistency");
  assert.match(response.assistantMessage, /encounter spacing/i);
  assert.match(response.assistantMessage, /safe intervals|safe room/i);
  assert.match(response.assistantMessage, /tension\/release rhythm/i);
  assert.match(response.assistantMessage, /traversal dead zones/i);
  assert.match(response.assistantMessage, /dialogue|cutscene/i);
  assert.match(response.assistantMessage, /reward timing/i);
});

test("inventory cognitive overload gets usability decomposition", () => {
  const response = planGameDevChatResponse("the inventory flow creates cognitive overload");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "inventory_cognitive_load");
  assert.match(response.assistantMessage, /item categorization|group/i);
  assert.match(response.assistantMessage, /visual grouping|screen density/i);
  assert.match(response.assistantMessage, /decision frequency|parse, compare, and commit/i);
  assert.match(response.assistantMessage, /affordances/i);
  assert.match(response.assistantMessage, /sorting\/filtering/i);
  assert.match(response.assistantMessage, /controller\/mouse input burden|controller and mouse/i);
});

test("world does not feel believable gets environmental logic reasoning", () => {
  const response = planGameDevChatResponse("the world doesn't feel believable");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "world_believability");
  assert.match(response.assistantMessage, /environmental logic|world logic/i);
  assert.match(response.assistantMessage, /NPC|object placement/i);
  assert.match(response.assistantMessage, /cause\/effect/i);
  assert.match(response.assistantMessage, /readable history/i);
  assert.match(response.assistantMessage, /scale/i);
  assert.match(response.assistantMessage, /lived-in details/i);
});

test("world artificial instead of lived-in uses world believability alias", () => {
  const response = planGameDevChatResponse("the world feels artificial instead of lived-in");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "world_believability");
  assert.equal(response.reasoning?.categoryMatchKind, "alias");
  assert.match(response.reasoning?.matchedPhraseFamily ?? "", /artificial|lived-in/i);
  assert.ok(response.reasoning?.decompositionDimensions.includes("lived-in logic"));
  assert.match(response.assistantMessage, /What this probably means/);
  assert.match(response.assistantMessage, /lived-in|spatial purpose|off-screen life/i);
  assert.doesNotMatch(response.assistantMessage, /Clarify the real target|Identify the smallest useful next step|Name the relevant capability boundary|Keep the next step small and testable|I edited|I ran Unity/i);
});

test("UI pulls players out of immersion uses UI immersion category", () => {
  const response = planGameDevChatResponse("the UI constantly pulls players out of immersion");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "ui_immersion_break");
  assert.equal(response.reasoning?.categoryMatchKind, "alias");
  assert.ok(response.reasoning?.decompositionDimensions.includes("diegetic fit"));
  assert.match(response.assistantMessage, /attention|immersion|readability/i);
  assert.doesNotMatch(response.assistantMessage, /Keep the next step small and testable|I edited|I ran Unity/i);
});

test("psychologically unsafe safe rooms uses horror safety subversion category", () => {
  const response = planGameDevChatResponse("I want the player to feel psychologically unsafe even in safe rooms");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "psychological_safety_subversion");
  assert.equal(response.reasoning?.categoryMatchKind, "alias");
  assert.ok(response.reasoning?.decompositionDimensions.includes("unsafe safety"));
  assert.match(response.assistantMessage, /dread|paranoia|vulnerability|mechanical safety/i);
  assert.doesNotMatch(response.assistantMessage, /Clarify the real target|Name the relevant capability boundary|I edited|I ran Unity/i);
});

test("Silent Hill-like environmental storytelling gets implication reasoning", () => {
  const response = planGameDevChatResponse("how would Silent Hill-like environmental storytelling support this?");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "environmental_storytelling");
  assert.equal(response.reasoning?.categoryMatchKind, "alias");
  assert.ok(response.reasoning?.decompositionDimensions.includes("implied history"));
  assert.match(response.assistantMessage, /withheld explanation|motif|player inference/i);
  assert.doesNotMatch(response.assistantMessage, /Keep the next step small and testable|I edited|I ran Unity/i);
});

test("curiosity collapses gets curiosity decay reasoning", () => {
  const response = planGameDevChatResponse("the player's curiosity collapses too quickly");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "curiosity_decay");
  assert.equal(response.reasoning?.categoryMatchKind, "alias");
  assert.ok(response.reasoning?.decompositionDimensions.includes("mystery sustain"));
  assert.match(response.assistantMessage, /question cadence|discovery|hypothesis/i);
  assert.doesNotMatch(response.assistantMessage, /Identify the smallest useful next step|I edited|I ran Unity/i);
});

test("inventory decision fatigue gets fatigue-specific reasoning", () => {
  const response = planGameDevChatResponse("the inventory creates decision fatigue");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "inventory_decision_fatigue");
  assert.equal(response.reasoning?.categoryMatchKind, "alias");
  assert.ok(response.reasoning?.decompositionDimensions.includes("choice count"));
  assert.match(response.assistantMessage, /overthinking|regret|comparison burden|consequence/i);
  assert.doesNotMatch(response.assistantMessage, /Clarify the real target|I edited|I ran Unity/i);
});

test("exploration loop predictable gets exploration predictability reasoning", () => {
  const response = planGameDevChatResponse("the exploration loop becomes predictable");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "exploration_predictability");
  assert.equal(response.reasoning?.categoryMatchKind, "alias");
  assert.ok(response.reasoning?.decompositionDimensions.includes("room formula"));
  assert.match(response.assistantMessage, /formula|discovery pattern|surprise/i);
  assert.doesNotMatch(response.assistantMessage, /Keep the next step small and testable|I edited|I ran Unity/i);
});

test("smart fallback still decomposes unknown design feedback", () => {
  const response = planGameDevChatResponse("the onboarding emotion feels smeared across too many systems");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "smart_feedback_fallback");
  assert.equal(response.reasoning?.categoryMatchKind, "smart_fallback");
  assert.match(response.reasoning?.fallbackReason ?? "", /fallback lens/i);
  assert.ok(response.reasoning?.decompositionDimensions.includes("player symptom"));
  assert.match(response.assistantMessage, /What this probably means/);
  assert.match(response.assistantMessage, /Diagnostic questions/);
  assert.doesNotMatch(response.assistantMessage, /Clarify the real target|Identify the smallest useful next step|Name the relevant capability boundary|Keep the next step small and testable/i);
});

test("curiosity reward decay gets specific synthesis and next step", () => {
  const response = planGameDevChatResponse("the game slowly stops rewarding curiosity");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "curiosity_reward_decay");
  assert.equal(response.reasoning?.categoryMatchKind, "alias");
  assert.equal(response.reasoning?.gameplayFeedback?.synthesisVariant, "player_psychology_first");
  assert.match(response.reasoning?.nextUsefulStep ?? "", /Map the next three discoveries/i);
  assert.match(response.assistantMessage, /discovery promise|question carryover|player hypothesis/i);
  assert.match(response.assistantMessage, /Map the next three discoveries/i);
  assert.doesNotMatch(response.assistantMessage, /probable player experience|likely system area|cause category|I edited|I ran Unity/i);
});

test("consequence decay gets stakes-specific reasoning and next step", () => {
  const response = planGameDevChatResponse("the player stops fearing consequences");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "consequence_decay");
  assert.equal(response.reasoning?.gameplayFeedback?.synthesisVariant, "contrast_consequence_first");
  assert.match(response.reasoning?.nextUsefulStep ?? "", /failure stops changing player behavior/i);
  assert.match(response.assistantMessage, /failure memory|behavior change|world reaction/i);
  assert.match(response.assistantMessage, /Find the first decision where failure stops changing player behavior/i);
  assert.doesNotMatch(response.assistantMessage, /probable player experience|likely system area|I edited|I ran Unity/i);
});

test("mechanical emotional mismatch gets contrast-specific reasoning", () => {
  const response = planGameDevChatResponse("the game feels mechanically alive but emotionally dead");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "mechanical_emotional_mismatch");
  assert.match(response.reasoning?.nextUsefulStep ?? "", /emotional aftermath/i);
  assert.match(response.assistantMessage, /mechanical activity|emotional aftermath|world acknowledgement/i);
  assert.match(response.assistantMessage, /Choose one working mechanic/i);
  assert.doesNotMatch(response.assistantMessage, /probable player experience|likely system area|I edited|I ran Unity/i);
});

test("uncertainty predictability gets fair-disruption reasoning", () => {
  const response = planGameDevChatResponse("the uncertainty becomes predictable");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "uncertainty_predictability");
  assert.equal(response.reasoning?.gameplayFeedback?.synthesisVariant, "validation_first");
  assert.match(response.reasoning?.nextUsefulStep ?? "", /break only one part of it fairly/i);
  assert.match(response.assistantMessage, /learned pattern|fair rule break|warning cadence/i);
  assert.match(response.assistantMessage, /List the pattern players have learned/i);
  assert.doesNotMatch(response.assistantMessage, /probable player experience|likely system area|I edited|I ran Unity/i);
});

test("past safety doubt avoids over-triggered implementation routing", () => {
  const response = planGameDevChatResponse("how do I make players doubt whether a room was previously safe?");

  assert.notEqual(response.route.taskMode, "UNITY_IMPLEMENTATION_PLAN");
  assert.equal(response.route.taskMode, "PLAYTEST_FEEDBACK");
  assert.equal(response.reasoning?.inferredFeedbackCategory, "past_safety_doubt");
  assert.equal(response.reasoning?.gameplayFeedback?.synthesisVariant, "scene_beat_first");
  assert.match(response.reasoning?.nextUsefulStep ?? "", /safe room.*later-return clue/i);
  assert.match(response.assistantMessage, /retrospective unease|safety memory|environmental contradiction/i);
  assert.doesNotMatch(response.assistantMessage, /Unity implementation planning task|I edited|I ran Unity/i);
});

test("non-repetitive response synthesis avoids identical generic bodies", () => {
  const prompts = [
    "the game slowly stops rewarding curiosity",
    "the player stops fearing consequences",
    "the game feels mechanically alive but emotionally dead",
    "the uncertainty becomes predictable",
    "how do I make players doubt whether a room was previously safe?",
  ];
  const responses = prompts.map((prompt) => planGameDevChatResponse(prompt));
  const bodies = responses.map((response) => response.assistantMessage.replace(/^Reasoning summary:[\s\S]*?\n\n/, ""));
  const strategies = responses.map((response) => response.reasoning?.selectedResponseStrategy);
  const nextSteps = responses.map((response) => response.reasoning?.nextUsefulStep);

  assert.equal(new Set(bodies).size, prompts.length);
  assert.equal(new Set(strategies).size, prompts.length);
  assert.equal(new Set(nextSteps).size, prompts.length);
  for (const response of responses) {
    assert.doesNotMatch(response.assistantMessage, /probable player experience|likely system area|cause category|Clarify the real target|Identify the smallest useful next step|Name the relevant capability boundary|I edited|I ran Unity|autonomous_real/i);
  }
});

test("runtime capabilities prompt uses runtime self-explanation", () => {
  const response = planGameDevChatResponse("what runtime capabilities are actually real right now?");

  assert.ok(response.reasoning);
  assert.equal(response.route.mode, "CAPABILITY_HELP");
  assert.equal(response.codexHandoff, undefined);
  assert.equal(response.reasoning.runtimeIntrospection?.kind, "capability_status_query");
  assert.equal(response.reasoning.inferredIntent, "Runtime Introspection");
  assert.match(response.reasoning.routeRationale, /Runtime Introspection/i);
  assert.match(response.assistantMessage, /What is real/);
  assert.match(response.assistantMessage, /What is bounded\/supervised/);
  assert.match(response.assistantMessage, /What still depends on external tools/);
  assert.match(response.assistantMessage, /What is blocked/);
  assert.match(response.assistantMessage, /Safest next step/);
  assert.doesNotMatch(response.assistantMessage, /Reasoning summary:|Got it — I can help with that as a game-development question|Clarify the real target|I edited|I ran Unity/i);
});

test("Copilot Codex dependency prompt uses runtime self-explanation", () => {
  const response = planGameDevChatResponse("what still depends on Copilot or Codex?");

  assert.ok(response.reasoning);
  assert.equal(response.route.mode, "CAPABILITY_HELP");
  assert.equal(response.codexHandoff, undefined);
  assert.equal(response.sessionContext.latestCodexHandoffTopic, undefined);
  assert.equal(response.reasoning.runtimeIntrospection?.kind, "external_dependency_query");
  assert.equal(response.reasoning.executionOwnership.ownerLabel, "AI-E Supervised Runtime");
  assert.equal(response.reasoning.executionOwnership.kind, "external_dependency");
  assert.match(response.assistantMessage, /What still depends on external tools/);
  assert.match(response.assistantMessage, /approved AI-E supervised workflow lanes/i);
  assert.match(response.assistantMessage, /What is blocked/);
  assert.doesNotMatch(response.assistantMessage, /Reasoning summary:|General game-development help|Clarify the real target|I edited|I ran Unity/i);
});

test("blocked runtime prompt uses cleaned runtime introspection metadata", () => {
  const response = planGameDevChatResponse("what is still blocked?");

  assert.ok(response.reasoning);
  assert.equal(response.route.mode, "CAPABILITY_HELP");
  assert.equal(response.codexHandoff, undefined);
  assert.equal(response.reasoning.runtimeIntrospection?.kind, "blocked_capability_query");
  assert.equal(response.reasoning.inferredIntent, "Runtime Introspection");
  assert.match(response.reasoning.selectedResponseStrategy, /runtime introspection/i);
  assert.deepEqual(response.reasoning.decompositionDimensions, ["real capabilities", "bounded/supervised capabilities", "external tool dependencies", "blocked capabilities"]);
  assert.match(response.assistantMessage, /Runtime introspection: blocked capability query/);
  assert.match(response.assistantMessage, /What is blocked/);
  assert.doesNotMatch(response.assistantMessage, /Reasoning summary:|Clarify the real target|Identify the smallest useful next step|Name the relevant capability boundary|I edited|I ran Unity/i);
});

test("psychological horror context is preserved during world feedback", () => {
  const setup = planGameDevChatResponse("I am making a psychological horror game about being watched in an abandoned hospital.");
  const response = planGameDevChatResponse("the world doesn't feel believable", { previousRoute: setup.route, sessionContext: setup.sessionContext });

  assert.equal(response.sessionContext.currentProject, "psychological horror game project");
  assert.equal(response.sessionContext.activeGameplaySystem, "psychological horror atmosphere and tension");
  assert.match(response.assistantMessage, /psychological horror/i);
  assert.match(response.assistantMessage, /dread|uncertainty|vulnerability/i);
});

test("nuanced feedback does not use generic fallback language", () => {
  const prompts = [
    "the combat lacks impact",
    "players lose interest after 10 minutes",
    "the pacing feels inconsistent",
    "the inventory flow creates cognitive overload",
    "the world doesn't feel believable",
  ];

  for (const prompt of prompts) {
    const response = planGameDevChatResponse(prompt);
    assert.ok(response.reasoning?.inferredFeedbackCategory, prompt);
    assert.match(response.assistantMessage, /What this probably means/);
    assert.match(response.assistantMessage, /If you want AI-E to act/);
    assert.doesNotMatch(response.assistantMessage, /Clarify the real target|Identify the smallest useful next step|Name the relevant capability boundary|Keep the next step small and testable/);
  }
});

test("reasoning metadata includes feedback dimensions for visibility panel", () => {
  const response = planGameDevChatResponse("the combat lacks impact");

  assert.equal(response.reasoning?.inferredFeedbackCategory, "combat_impact");
  assert.equal(response.reasoning?.selectedResponseStrategy, "diagnose sensory impact stack before implementation");
  assert.ok(response.reasoning?.decompositionDimensions.includes("hit stop"));
  assert.ok(response.reasoning?.decompositionDimensions.includes("screen shake"));
  assert.equal(response.reasoning?.runtimeAwareness.runtimeAvailability, "not_applicable");
});

test("direct Unity runtime request gets blocked capability reasoning", () => {
  const response = planGameDevChatResponse("run Unity and playtest the scene");

  assert.equal(response.route.mode, "BLOCKED_OR_UNSAFE");
  assert.equal(response.reasoning?.runtimeAwareness.runtimeAvailability, "blocked_not_implemented");
  assert.match(response.assistantMessage, /Unity Editor control is not implemented/);
  assert.match(response.assistantMessage, /trusted editor automation bridge/);
  assert.doesNotMatch(response.assistantMessage, /I ran Unity|autonomous_real/);
});

test("blocked tangent does not overwrite active task context", () => {
  const previous = planGameDevChatResponse("I want my player jump to feel less floaty.");
  const blocked = planGameDevChatResponse("run Unity and playtest the scene", { previousRoute: previous.route, sessionContext: previous.sessionContext });

  assert.equal(blocked.sessionContext.activeGameplaySystem, "player movement and jump feel");
  assert.equal(blocked.reasoning?.shouldPreservePreviousTaskContext, true);
});

test("runtime introspection response exposes reasoning and capability status", () => {
  const response = planGameDevChatResponse("what is real and what is scaffolded in your runtime state?");

  assert.ok(response.reasoning);
  assert.match(response.assistantMessage, /truthful runtime picture/i);
  assert.match(response.assistantMessage, /What is real:/);
  assert.match(response.assistantMessage, /What is blocked:/);
});

test("UI atmosphere request routes to generalized repo workflow instead of hardcoded domain lane", () => {
  const response = planGameDevChatResponse("improve the UI atmosphere");

  assert.equal(response.route.mode, "OPERATOR_WORK_CYCLE_REQUEST");
  assert.ok(response.workCycle);
  assert.match(response.workCycle.request.cycleIntent, /experience_polish/);
  assert.match(response.workCycle.request.proposedChanges[0]?.proposedContent ?? "", /dynamic task routing|scoped mutation|diff preview|operator review/i);
  assert.equal(response.changedFilesClaimed, false);
});

test("durable continuity prompt prepares restore request without fake persistence claims", () => {
  const response = planGameDevChatResponse("resume previous campaign");

  assert.equal(response.route.mode, "DURABLE_RUNTIME_CONTINUITY_REQUEST");
  assert.ok(response.durableContinuity);
  assert.equal(response.durableContinuity.request.action, "restore_previous_campaign");
  assert.equal(response.durableContinuity.request.projectId, "AI-E");
  assert.equal(response.durableContinuity.request.requiresOperatorReview, true);
  assert.match(response.assistantMessage, /local JSON file-backed runtime state only/);
  assert.match(response.assistantMessage, /chat planner did not restore state itself/);
  assert.doesNotMatch(response.assistantMessage, /autonomous_real execution is available|unattended background agent is running/i);
});

test("restore last checkpoint prompt uses durable continuity route", () => {
  const response = planGameDevChatResponse("restore last checkpoint");

  assert.equal(response.route.mode, "DURABLE_RUNTIME_CONTINUITY_REQUEST");
  assert.equal(response.durableContinuity?.request.action, "restore_last_checkpoint");
  assert.equal(response.changedFilesClaimed, false);
});

test("meaningful long-run prompt prepares approved-server request without starting it", () => {
  const response = planGameDevChatResponse("start a 5 minute supervised run");

  assert.equal(response.route.mode, "MEANINGFUL_LONG_RUN_REQUEST");
  assert.ok(response.meaningfulLongRun);
  assert.equal(response.meaningfulLongRun.request.mode, "test_mode");
  assert.equal(response.meaningfulLongRun.request.targetRuntimeMs, 5 * 60 * 1000);
  assert.equal(response.meaningfulLongRun.request.requiresOperatorApproval, true);
  assert.match(response.assistantMessage, /chat planner did not start the run/i);
  assert.doesNotMatch(response.assistantMessage, /I ran|overnight|autonomous_real/i);
});

test("thirty minute prompt prepares supervised mode long-run request", () => {
  const response = planGameDevChatResponse("continue for 30 minutes");

  assert.equal(response.route.mode, "MEANINGFUL_LONG_RUN_REQUEST");
  assert.equal(response.meaningfulLongRun?.request.mode, "supervised_mode");
  assert.equal(response.meaningfulLongRun?.request.targetRuntimeMs, 30 * 60 * 1000);
});

test("test run prompt prepares an approved-runtime request rather than fake execution", () => {
  const response = planGameDevChatResponse("run the tests");

  assert.equal(response.route.mode, "SCOPED_EXECUTION_REQUEST");
  assert.ok(response.scopedExecution);
  assert.equal(response.scopedExecution.request.command, "npm test");
  assert.equal(response.scopedExecution.request.workingDirectory, "repo-root/web");
  assert.match(response.assistantMessage, /Approval status: pending/);
  assert.match(response.assistantMessage, /No command was executed from chat/);
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

test("supervised execution brief request generates structured brief", () => {
  const message = "Make me an AI-E supervised execution brief for adding a basic collectible system in Unity.";
  const response = planGameDevChatResponse(message);

  assert.equal(response.route.mode, "CODEX_HANDOFF_REQUEST");
  assert.equal(response.route.conversationMode, "CODEX_HANDOFF_REQUEST");
  assert.equal(response.route.taskMode, "CODEX_HANDOFF_REQUEST");
  assert.ok(response.codexHandoff);
  assert.equal(response.reasoning?.executionOwnership.ownerLabel, "AI-E Supervised Runtime");
  assert.equal(response.reasoning?.executionOwnership.workflowType, "execution_brief");
  assert.match(response.codexHandoff.markdown, /# AI-E Supervised Execution Brief/);
  assert.match(response.codexHandoff.markdown, /Files To Inspect First/);
  assert.match(response.codexHandoff.markdown, /Collectible/);
  assert.match(response.codexHandoff.markdown, /Chat mode prepared this supervised execution brief only/);
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
  assert.match(response.assistantMessage, /If you want implementation, I can prepare an AI-E supervised execution brief/);
});

test("AI-E repo execution prompt uses internal ownership metadata", () => {
  const response = planGameDevChatResponse("can AI-E execute repo work itself?");

  assert.ok(response.reasoning);
  assert.equal(response.reasoning.runtimeIntrospection?.kind, "capability_status_query");
  assert.equal(response.reasoning.executionOwnership.ownerLabel, "AI-E Supervised Runtime");
  assert.equal(response.reasoning.executionOwnership.kind, "bounded_internal_workflow");
  assert.match(response.assistantMessage, /Execution owner: AI-E Supervised Runtime/);
  assert.doesNotMatch(response.assistantMessage, /I edited|I ran Unity|autonomous_real is available/i);
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
