import type { GameDevChatRoute, GameDevCodexHandoff, GameDevSessionContext } from "./gameDevChatTypes";
import type { ConversationalReasoningResult } from "./conversationalReasoningEngine";

export function createInitialGameDevSessionContext(): GameDevSessionContext {
  return {
    unresolvedBlockers: [],
    scaffoldStatus: "SESSION_CONTEXT_MEMORY_PHASE1_EMPTY",
    memoryScope: "in-memory-session",
  };
}

export function hasUsableGameDevSessionContext(context?: GameDevSessionContext): boolean {
  if (!context) {
    return false;
  }
  return Boolean(
    context.currentProject
      || context.activeUnityContext
      || context.activeGameplaySystem
      || context.currentImplementationTask
      || context.recentUserIntent
      || context.latestCodexHandoffTopic
      || context.latestAssistantResponseSummary
      || context.lastKnownRoute,
  );
}

function inferProject(message: string, route: GameDevChatRoute): string | undefined {
  if (/psychological horror|horror game|horror project/i.test(message)) {
    return "psychological horror game project";
  }
  if (route.unityFirst || /\b(unity|c#|monobehaviour|prefab|scene|rigidbody|navmesh)\b/i.test(message)) {
    return "Unity game project";
  }
  if (/\b(game|player|enemy|collectible|level|mechanic|prototype)\b/i.test(message)) {
    return "Game project";
  }
  return undefined;
}

function inferGameplaySystem(message: string, reasoning?: ConversationalReasoningResult): string | undefined {
  const lower = message.toLowerCase();
  if (/psychological horror|horror|dread|uncanny/.test(lower)) {
    return "psychological horror atmosphere and tension";
  }
  switch (reasoning?.gameplayFeedback?.category) {
    case "combat_impact":
      return "combat impact and hit feedback";
    case "pacing_retention":
    case "pacing_inconsistency":
      return "pacing and retention loop";
    case "inventory_cognitive_load":
      return "inventory usability and cognitive load";
    case "believability_world_design":
    case "world_believability":
      return "world believability and environmental logic";
    case "ui_atmosphere":
    case "ui_immersion_break":
      return "UI atmosphere and emotional tone";
    case "psychological_safety_subversion":
      return "psychological horror atmosphere and tension";
    case "environmental_storytelling":
      return "environmental storytelling and world implication";
    case "curiosity_decay":
      return "curiosity and discovery loop";
    case "inventory_decision_fatigue":
      return "inventory usability and cognitive load";
    case "exploration_predictability":
      return "exploration loop and discovery cadence";
    case "pacing_curve_inconsistency":
      return "pacing and emotional rhythm";
    case "player_interest_dropoff":
      return "pacing and retention loop";
    case "consequence_decay":
      return "stakes and consequence design";
    case "uncertainty_predictability":
      return "uncertainty and fair surprise design";
    case "mechanical_emotional_mismatch":
      return "mechanical-emotional payoff design";
    case "curiosity_reward_decay":
      return "curiosity and discovery loop";
    case "past_safety_doubt":
      return "psychological horror atmosphere and tension";
    case "emotional_numbness_over_time":
      return "emotional pacing and contrast";
    case "smart_feedback_fallback":
      return baseFeedbackSystemFromMessage(lower);
    case "emotional_flatness":
      return "emotional pacing and consequence";
    case "tension_design":
      return "tension and atmosphere design";
    case "interaction_feel":
      return "interaction feel and responsiveness";
  }
  if (lower.includes("collectible")) {
    return "collectible system";
  }
  if (lower.includes("enemy") || lower.includes("patrol")) {
    return "enemy patrol system";
  }
  if (lower.includes("jump") || lower.includes("floaty") || lower.includes("movement")) {
    return "player movement and jump feel";
  }
  if (lower.includes("atmospheric") || lower.includes("mood") || lower.includes("tone")) {
    return "game atmosphere and tone";
  }
  if (lower.includes("bug") || lower.includes("broken") || lower.includes("error") || lower.includes("work")) {
    return "debugging target";
  }
  return undefined;
}

function inferImplementationTask(message: string, route: GameDevChatRoute): string | undefined {
  if (route.conversationMode === "GAME_DEV_TASK" || route.conversationMode === "CODEX_HANDOFF_REQUEST" || route.taskMode) {
    return message.trim();
  }
  return undefined;
}

function inferHandoffTopic(message: string, route: GameDevChatRoute, handoff?: GameDevCodexHandoff): string | undefined {
  if (handoff?.goal) {
    return handoff.goal;
  }
  if ((route.mode === "CODEX_HANDOFF_REQUEST" || route.taskMode === "CODEX_HANDOFF_REQUEST" || route.conversationMode === "CODEX_HANDOFF_REQUEST") && /\b(codex|handoff)\b/i.test(message)) {
    return message.trim();
  }
  return undefined;
}

function latestSummary(message: string, route: GameDevChatRoute, handoff?: GameDevCodexHandoff): string {
  const mode = route.taskMode ?? route.mode;
  if (handoff) {
    return `Prepared a session-scoped Codex handoff plan for ${handoff.goal}`;
  }
  if (route.mode === "GREETING" || route.mode === "THANKS" || route.mode === "CAPABILITY_HELP") {
    return `Handled conversational mode ${route.mode.toLowerCase()}.`;
  }
  return `Handled ${mode} for: ${message.trim()}`;
}

function clarificationQuestion(message: string, route: GameDevChatRoute): string | undefined {
  if (!route.needsClarification) {
    return undefined;
  }
  if (route.mode === "CLARIFICATION_NEEDED" && route.detectedIntent.includes("Continue")) {
    return "What thread or game-dev task should I continue?";
  }
  if (route.mode === "CLARIFICATION_NEEDED" && route.detectedIntent.includes("Troubleshooting")) {
    return "What failed, what did you try, and did Unity show a Console error?";
  }
  if (/jump|floaty/i.test(message)) {
    return "Is the player moved with Rigidbody2D/Rigidbody, CharacterController, or a custom transform script?";
  }
  return "What game-dev target should I connect this to?";
}

export function updateGameDevSessionContext(
  previousContext: GameDevSessionContext | undefined,
  message: string,
  route: GameDevChatRoute,
  assistantMessage: string,
  codexHandoff?: GameDevCodexHandoff,
  reasoning?: ConversationalReasoningResult,
): GameDevSessionContext {
  const base = previousContext ?? createInitialGameDevSessionContext();
  const preserveTaskContext = reasoning?.shouldPreservePreviousTaskContext === true;
  const preserveProjectFlavor = Boolean(reasoning?.gameplayFeedback && /psychological horror/i.test([base.currentProject, base.activeGameplaySystem, base.currentImplementationTask].filter(Boolean).join(" ")));
  const preservedProject = preserveProjectFlavor && base.currentProject === "Unity game project" ? "psychological horror game project" : base.currentProject;
  const currentProject = preserveTaskContext ? base.currentProject : preserveProjectFlavor ? preservedProject : inferProject(message, route) ?? base.currentProject;
  const activeGameplaySystem = preserveTaskContext ? base.activeGameplaySystem : preserveProjectFlavor ? base.activeGameplaySystem ?? inferGameplaySystem(message, reasoning) : inferGameplaySystem(message, reasoning) ?? base.activeGameplaySystem;
  const currentImplementationTask = preserveTaskContext ? base.currentImplementationTask : inferImplementationTask(message, route) ?? base.currentImplementationTask;
  const latestCodexHandoffTopic = inferHandoffTopic(message, route, codexHandoff) ?? base.latestCodexHandoffTopic;
  const blocker = route.mode === "TROUBLESHOOT_PREVIOUS" || route.mode === "CLARIFICATION_NEEDED" ? route.detectedIntent : undefined;
  const unresolvedBlockers = blocker ? Array.from(new Set([...base.unresolvedBlockers, blocker])) : base.unresolvedBlockers;
  const hasContext = Boolean(currentProject || activeGameplaySystem || currentImplementationTask || latestCodexHandoffTopic || route);

  return {
    currentProject,
    activeUnityContext: route.unityFirst || currentProject === "Unity game project" ? "Unity-first planning context" : base.activeUnityContext,
    activeGameplaySystem,
    currentImplementationTask,
    recentUserIntent: route.detectedIntent,
    unresolvedBlockers,
    latestCodexHandoffTopic,
    latestAssistantResponseSummary: latestSummary(message, route, codexHandoff) || assistantMessage.slice(0, 180),
    lastClarificationQuestion: clarificationQuestion(message, route) ?? base.lastClarificationQuestion,
    lastKnownRoute: route,
    scaffoldStatus: hasContext ? "SESSION_CONTEXT_MEMORY_PHASE1_SESSION_ONLY" : "SESSION_CONTEXT_MEMORY_PHASE1_EMPTY",
    memoryScope: "in-memory-session",
    updatedAt: new Date().toISOString(),
  };
}

export function summarizeGameDevSessionContext(context?: GameDevSessionContext): string {
  if (!hasUsableGameDevSessionContext(context)) {
    return "No prior session context is available in this chat session.";
  }
  return [
    context?.currentProject ? `Project: ${context.currentProject}` : undefined,
    context?.activeGameplaySystem ? `System: ${context.activeGameplaySystem}` : undefined,
    context?.currentImplementationTask ? `Task: ${context.currentImplementationTask}` : undefined,
    context?.latestCodexHandoffTopic ? `Latest handoff: ${context.latestCodexHandoffTopic}` : undefined,
    context?.latestAssistantResponseSummary ? `Last response: ${context.latestAssistantResponseSummary}` : undefined,
  ].filter(Boolean).join("\n");
}

function baseFeedbackSystemFromMessage(lower: string): string {
  if (/ui|interface|hud|menu/.test(lower)) {
    return "UI atmosphere and emotional tone";
  }
  if (/inventory|item/.test(lower)) {
    return "inventory usability and cognitive load";
  }
  if (/world|environment|level|room|exploration/.test(lower)) {
    return "world and exploration experience";
  }
  if (/combat|enemy|hit|attack/.test(lower)) {
    return "combat impact and hit feedback";
  }
  return "player experience feedback";
}