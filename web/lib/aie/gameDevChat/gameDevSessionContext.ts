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
  if (route.unityFirst || /\b(unity|c#|monobehaviour|prefab|scene|rigidbody|navmesh)\b/i.test(message)) {
    return "Unity game project";
  }
  if (/\b(game|player|enemy|collectible|level|mechanic|prototype)\b/i.test(message)) {
    return "Game project";
  }
  return undefined;
}

function inferGameplaySystem(message: string): string | undefined {
  const lower = message.toLowerCase();
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

function inferHandoffTopic(message: string, handoff?: GameDevCodexHandoff): string | undefined {
  if (handoff?.goal) {
    return handoff.goal;
  }
  if (/\b(codex|handoff)\b/i.test(message)) {
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
  const currentProject = preserveTaskContext ? base.currentProject : inferProject(message, route) ?? base.currentProject;
  const activeGameplaySystem = preserveTaskContext ? base.activeGameplaySystem : inferGameplaySystem(message) ?? base.activeGameplaySystem;
  const currentImplementationTask = preserveTaskContext ? base.currentImplementationTask : inferImplementationTask(message, route) ?? base.currentImplementationTask;
  const latestCodexHandoffTopic = inferHandoffTopic(message, codexHandoff) ?? base.latestCodexHandoffTopic;
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