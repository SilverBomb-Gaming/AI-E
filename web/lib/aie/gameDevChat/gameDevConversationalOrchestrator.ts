import { classifyGameDevIntent } from "./gameDevIntentClassifier";
import type { GameDevChatRoute, GameDevConversationMode, GameDevTaskIntentMode } from "./gameDevChatTypes";

export type GameDevConversationContext = {
  previousRoute?: GameDevChatRoute;
};

const greetingPattern = /^(hi|hello|hey|yo|hiya|howdy|hello\?|hey\?|hi\?|you\s+there\??|are\s+you\s+there\??)\s*[!.?]*$/i;
const thanksPattern = /^(thanks|thank\s+you|ty|appreciate\s+it|nice\s+thanks|got\s+it\s+thanks)\s*[!.?]*$/i;
const sessionClosePattern = /\b(goodnight|good\s+night|bye|goodbye|see\s+you|talk\s+later|done\s+for\s+now|end\s+session)\b/i;
const capabilityPattern = /^(help\??|what\s+can\s+you\s+do\??|what\s+do\s+you\s+do\??|how\s+can\s+you\s+help\??|what\s+are\s+you\s+for\??|show\s+me\s+your\s+capabilities\.?|capabilities\??)$/i;
const continuePattern = /^(continue|keep\s+going|go\s+on|next|proceed|carry\s+on)\s*[!.?]*$/i;
const troubleshootPreviousPattern = /\b(that\s+didn(?:'|’)t\s+work|didn(?:'|’)t\s+work|still\s+broken|same\s+problem|that\s+failed|it\s+failed|no\s+change)\b/i;
const frustrationPattern = /\b(i\s+am\s+lost|i\s+don't\s+know|i\s+don(?:'|’)t\s+know|confused|stuck|frustrated|ugh|what\s+now|not\s+sure\s+what\s+to\s+do)\b/i;

function routeFor(mode: GameDevConversationMode, detectedIntent: string, suggestedNextAction: string, needsClarification = false): GameDevChatRoute {
  return {
    mode,
    conversationMode: mode,
    detectedIntent,
    confidence: "HIGH",
    unityFirst: false,
    needsClarification,
    safetyStatus: needsClarification ? "CLARIFY_BEFORE_ACTION" : "SAFE_RESPONSE_ONLY",
    suggestedNextAction,
    keywords: [],
  };
}

function hasPreviousTask(context?: GameDevConversationContext): boolean {
  const previous = context?.previousRoute;
  return Boolean(previous && (previous.conversationMode === "GAME_DEV_TASK" || previous.taskMode || previous.mode === "CODEX_HANDOFF_REQUEST"));
}

function taskRouteFor(message: string): GameDevChatRoute {
  const taskRoute = classifyGameDevIntent(message);
  if (taskRoute.mode === "CODEX_HANDOFF_REQUEST") {
    return {
      ...taskRoute,
      conversationMode: "CODEX_HANDOFF_REQUEST",
      taskMode: "CODEX_HANDOFF_REQUEST",
    };
  }
  if (taskRoute.mode === "CLARIFICATION_NEEDED") {
    return {
      ...taskRoute,
      conversationMode: "CLARIFICATION_NEEDED",
      taskMode: "CLARIFICATION_NEEDED",
    };
  }
  if (taskRoute.mode === "BLOCKED_OR_UNSAFE") {
    return {
      ...taskRoute,
      conversationMode: "BLOCKED_OR_UNSAFE",
      taskMode: "BLOCKED_OR_UNSAFE",
    };
  }
  return {
    ...taskRoute,
    mode: "GAME_DEV_TASK",
    conversationMode: "GAME_DEV_TASK",
    taskMode: taskRoute.mode as GameDevTaskIntentMode,
  };
}

export function orchestrateGameDevChat(message: string, context?: GameDevConversationContext): GameDevChatRoute {
  const trimmed = message.trim();
  if (!trimmed) {
    return routeFor("CLARIFICATION_NEEDED", "No message yet", "Type a greeting, question, game-development goal, bug, idea, or Codex handoff request.", true);
  }

  if (greetingPattern.test(trimmed)) {
    return routeFor("GREETING", "Social greeting", "Choose game design, Unity implementation, debugging, or a Codex handoff.");
  }
  if (thanksPattern.test(trimmed)) {
    return routeFor("THANKS", "User acknowledgement or thanks", "Continue with a game-dev request when ready.");
  }
  if (sessionClosePattern.test(trimmed)) {
    return routeFor("SESSION_CLOSE", "Session close", "Return when you want to continue planning or debugging.");
  }
  if (capabilityPattern.test(trimmed)) {
    return routeFor("CAPABILITY_HELP", "Capability help request", "Pick a mode: design, Unity implementation planning, debugging, playtest feedback, or Codex handoff.");
  }
  if (continuePattern.test(trimmed)) {
    if (hasPreviousTask(context)) {
      return routeFor("CONTINUE_PREVIOUS", "Continue the previous thread", "Continue from the last safe plan without claiming execution.");
    }
    return routeFor("CLARIFICATION_NEEDED", "Continue requested without prior task context", "Tell me what thread or game-dev task you want to continue.", true);
  }
  if (troubleshootPreviousPattern.test(trimmed)) {
    if (hasPreviousTask(context)) {
      return routeFor("TROUBLESHOOT_PREVIOUS", "Troubleshoot the previous attempt", "Share what happened, what you expected, and any Unity Console errors.");
    }
    return routeFor("CLARIFICATION_NEEDED", "Troubleshooting requested without prior task context", "Tell me what failed and what you tried last.", true);
  }
  if (frustrationPattern.test(trimmed)) {
    return routeFor("FRUSTRATION_OR_CONFUSION", "Vague frustration or confusion", "Name the game, feature, or symptom and I will help narrow the next step.", true);
  }

  return taskRouteFor(trimmed);
}