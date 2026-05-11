import type { GameDevChatRoute } from "./gameDevChatTypes";

const unsafePattern = /\b(delete\s+everything|wipe\s+project|steal|malware|bypass\s+license|crack\s+asset|disable\s+safety)\b/i;
const codexPattern = /\b(codex|handoff|implementation\s+brief|give\s+me\s+a\s+task|make\s+me\s+a\s+handoff)\b/i;
const bugPattern = /\b(bug|broken|error|exception|crash|doesn'?t\s+work|not\s+working|nullreference|null\s+reference|stack\s+trace|fix)\b/i;
const explanationPattern = /\b(explain|what\s+does|how\s+does|walk\s+me\s+through|why\s+does)\b/i;
const playtestPattern = /\b(playtest|feedback|feel|floaty|too\s+slow|too\s+fast|clunky|juice|game\s+feel|tuning)\b/i;
const implementationPattern = /\b(add|implement|create|build|make|system|controller|patrol|enemy|collectible|inventory|jump|movement|camera|health|damage|unity|script)\b/i;
const designReasoningQuestionPattern = /\b(how\s+do\s+i\s+make\s+players?|make\s+players?\s+(feel|doubt|fear|trust|wonder|notice|care|hesitate)|players?\s+(doubt|fear|trust|wonder|stop|lose)|room\s+was\s+previously\s+safe|previously\s+safe|uncertainty|curiosity|consequences?|emotionally\s+dead|mechanically\s+alive)\b/i;
const vagueIdeaPattern = /\b(idea|concept|don'?t\s+know|not\s+sure|small\s+game|survival\s+game|what\s+should\s+i\s+make)\b/i;
const unityPattern = /\b(unity|c#|monobehaviour|rigidbody|character\s*controller|animator|collider|scene|prefab|navmesh|patrol|jump|player|enemy|collectible)\b/i;

function compactKeywords(message: string): string[] {
  const lower = message.toLowerCase();
  return [
    "unity",
    "jump",
    "player",
    "enemy",
    "patrol",
    "collectible",
    "bug",
    "explain",
    "playtest",
    "floaty",
    "survival",
    "codex",
    "handoff",
  ].filter((keyword) => lower.includes(keyword));
}

export function classifyGameDevIntent(message: string): GameDevChatRoute {
  const trimmed = message.trim();
  const keywords = compactKeywords(trimmed);

  if (!trimmed) {
    return {
      mode: "CLARIFICATION_NEEDED",
      detectedIntent: "No message yet",
      confidence: "LOW",
      unityFirst: true,
      needsClarification: true,
      safetyStatus: "CLARIFY_BEFORE_ACTION",
      suggestedNextAction: "Type a game-development goal, bug, idea, or implementation request.",
      keywords,
    };
  }

  if (unsafePattern.test(trimmed)) {
    return {
      mode: "BLOCKED_OR_UNSAFE",
      detectedIntent: "Unsafe or destructive request",
      confidence: "HIGH",
      unityFirst: false,
      needsClarification: false,
      safetyStatus: "BLOCKED",
      suggestedNextAction: "Reframe the request as a safe game-development planning task.",
      keywords,
    };
  }

  if (codexPattern.test(trimmed)) {
    return {
      mode: "CODEX_HANDOFF_REQUEST",
      detectedIntent: "Prepare a safe implementation handoff",
      confidence: "HIGH",
      unityFirst: unityPattern.test(trimmed) || implementationPattern.test(trimmed),
      needsClarification: false,
      safetyStatus: "SAFE_PLANNING_ONLY",
      suggestedNextAction: "Review the handoff, then run implementation only with explicit approval.",
      keywords,
    };
  }

  if (bugPattern.test(trimmed)) {
    return {
      mode: "BUG_FIX_REQUEST",
      detectedIntent: "Diagnose and plan a bug fix",
      confidence: "HIGH",
      unityFirst: unityPattern.test(trimmed),
      needsClarification: !/\b(error|crash|null|stack|when|after|before)\b/i.test(trimmed),
      safetyStatus: "SAFE_PLANNING_ONLY",
      suggestedNextAction: "Collect reproduction steps, affected script names, and the exact error before editing.",
      keywords,
    };
  }

  if (vagueIdeaPattern.test(trimmed)) {
    return {
      mode: trimmed.length < 80 ? "CLARIFICATION_NEEDED" : "GAME_DESIGN_IDEA",
      detectedIntent: "Shape an early game idea",
      confidence: "MEDIUM",
      unityFirst: true,
      needsClarification: trimmed.length < 80,
      safetyStatus: "CLARIFY_BEFORE_ACTION",
      suggestedNextAction: "Answer one design question about genre, player fantasy, or first playable prototype.",
      keywords,
    };
  }

  if (designReasoningQuestionPattern.test(trimmed)) {
    return {
      mode: "PLAYTEST_FEEDBACK",
      detectedIntent: "Analyze nuanced player-experience design feedback",
      confidence: "HIGH",
      unityFirst: false,
      needsClarification: false,
      safetyStatus: "SAFE_PLANNING_ONLY",
      suggestedNextAction: "Decompose the intended player experience before choosing any implementation path.",
      keywords,
    };
  }

  if (explanationPattern.test(trimmed)) {
    return {
      mode: "CODE_EXPLANATION",
      detectedIntent: "Explain game code or a game-development concept",
      confidence: "HIGH",
      unityFirst: unityPattern.test(trimmed),
      needsClarification: trimmed.length < 24,
      safetyStatus: "SAFE_PLANNING_ONLY",
      suggestedNextAction: "Share the code or concept to explain if it is not already named.",
      keywords,
    };
  }

  if (implementationPattern.test(trimmed) && (unityPattern.test(trimmed) || /\b(add|implement|create|build|make)\b/i.test(trimmed))) {
    return {
      mode: "UNITY_IMPLEMENTATION_PLAN",
      detectedIntent: "Plan a Unity-first implementation task",
      confidence: unityPattern.test(trimmed) ? "HIGH" : "MEDIUM",
      unityFirst: true,
      needsClarification: false,
      safetyStatus: "SAFE_PLANNING_ONLY",
      suggestedNextAction: "Prepare a bounded plan or Codex handoff before any code changes.",
      keywords,
    };
  }

  if (playtestPattern.test(trimmed)) {
    return {
      mode: "PLAYTEST_FEEDBACK",
      detectedIntent: "Turn playtest feedback into tuning steps",
      confidence: "MEDIUM",
      unityFirst: true,
      needsClarification: false,
      safetyStatus: "SAFE_PLANNING_ONLY",
      suggestedNextAction: "Identify the feel issue, likely tuning levers, and a small validation loop.",
      keywords,
    };
  }

  return {
    mode: "GENERAL_GAME_DEV_HELP",
    detectedIntent: "General game-development help",
    confidence: "MEDIUM",
    unityFirst: unityPattern.test(trimmed),
    needsClarification: trimmed.length < 18,
    safetyStatus: trimmed.length < 18 ? "CLARIFY_BEFORE_ACTION" : "SAFE_PLANNING_ONLY",
    suggestedNextAction: trimmed.length < 18 ? "Add one more detail about the game, engine, or problem." : "Give a practical next-step answer without claiming execution.",
    keywords,
  };
}
