export type GameDevTaskIntentMode =
  | "GENERAL_GAME_DEV_HELP"
  | "UNITY_IMPLEMENTATION_PLAN"
  | "GAME_DESIGN_IDEA"
  | "BUG_FIX_REQUEST"
  | "CODE_EXPLANATION"
  | "PLAYTEST_FEEDBACK"
  | "CODEX_HANDOFF_REQUEST"
  | "CLARIFICATION_NEEDED"
  | "BLOCKED_OR_UNSAFE";

export type GameDevConversationMode =
  | "GREETING"
  | "THANKS"
  | "SESSION_CLOSE"
  | "CAPABILITY_HELP"
  | "CONTINUE_PREVIOUS"
  | "TROUBLESHOOT_PREVIOUS"
  | "FRUSTRATION_OR_CONFUSION"
  | "GAME_DEV_TASK"
  | "CODEX_HANDOFF_REQUEST"
  | "CLARIFICATION_NEEDED"
  | "BLOCKED_OR_UNSAFE";

export type GameDevChatIntentMode = GameDevTaskIntentMode | GameDevConversationMode;

export type GameDevChatRoute = {
  mode: GameDevChatIntentMode;
  conversationMode?: GameDevConversationMode;
  taskMode?: GameDevTaskIntentMode;
  detectedIntent: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  unityFirst: boolean;
  needsClarification: boolean;
  safetyStatus: "SAFE_RESPONSE_ONLY" | "SAFE_PLANNING_ONLY" | "CLARIFY_BEFORE_ACTION" | "BLOCKED";
  suggestedNextAction: string;
  keywords: string[];
};

export type GameDevCodexHandoff = {
  title: string;
  summary: string;
  targetEngine: "Unity" | "Unspecified";
  goal: string;
  filesToInspect: string[];
  implementationSteps: string[];
  safetyChecks: string[];
  validationPlan: string[];
  markdown: string;
};

export type GameDevChatResponse = {
  route: GameDevChatRoute;
  assistantMessage: string;
  codexHandoff?: GameDevCodexHandoff;
  scaffoldStatus: "CONVERSATIONAL_ORCHESTRATION_ACTIVE" | "REAL_CHAT_MODE_ACTIVE" | "PARTIAL_CHAT_MODE" | "CHAT_UI_SCAFFOLD_ACTIVE";
  changedFilesClaimed: false;
};

export type GameDevChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  route?: GameDevChatRoute;
  codexHandoff?: GameDevCodexHandoff;
  createdAt: string;
};
