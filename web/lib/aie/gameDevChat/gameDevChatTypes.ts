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
  | "REFINE_PREVIOUS"
  | "RETRY_PREVIOUS"
  | "USE_LAST_HANDOFF"
  | "SESSION_RECAP"
  | "DEVELOPMENT_CAMPAIGN"
  | "SCOPED_EXECUTION_REQUEST"
  | "OPERATOR_WORK_CYCLE_REQUEST"
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

export type GameDevSessionScaffoldStatus =
  | "SESSION_CONTEXT_MEMORY_PHASE1_SESSION_ONLY"
  | "LOCAL_BROWSER_PROJECT_MEMORY_PHASE1"
  | "SESSION_CONTEXT_MEMORY_PHASE1_EMPTY"
  | "DURABLE_SESSION_MEMORY_NOT_IMPLEMENTED";

export type GameDevSessionContext = {
  currentProject?: string;
  activeUnityContext?: string;
  activeGameplaySystem?: string;
  currentImplementationTask?: string;
  recentUserIntent?: string;
  unresolvedBlockers: string[];
  latestCodexHandoffTopic?: string;
  latestAssistantResponseSummary?: string;
  lastClarificationQuestion?: string;
  lastKnownRoute?: GameDevChatRoute;
  scaffoldStatus: GameDevSessionScaffoldStatus;
  memoryScope: "in-memory-session" | "local-browser-storage";
  updatedAt?: string;
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
  developmentCampaign?: import("../developmentCampaign/developmentCampaignTypes").DevelopmentCampaignEngineResult;
  scopedExecution?: {
    request: import("../scopedSupervisedExecutionRuntime").ScopedExecutionRequest;
    decision: import("../scopedSupervisedExecutionRuntime").ScopedExecutionDecision;
    log: import("../scopedSupervisedExecutionRuntime").ScopedExecutionLog;
    report?: import("../approvedExecutionPipeline").ApprovedExecutionReport;
  };
  workCycle?: {
    request: import("../operatorWorkCycleLauncher").OperatorWorkCycleRequest;
    summaryReport?: import("../operatorWorkCycleLauncher").OperatorWorkCycleSummaryReport;
  };
  sessionContext: GameDevSessionContext;
  scaffoldStatus: "SESSION_CONTEXT_AND_CONVERSATION_MEMORY_PHASE1" | "CONVERSATIONAL_ORCHESTRATION_ACTIVE" | "REAL_CHAT_MODE_ACTIVE" | "PARTIAL_CHAT_MODE" | "CHAT_UI_SCAFFOLD_ACTIVE";
  changedFilesClaimed: false;
};

export type GameDevChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  route?: GameDevChatRoute;
  codexHandoff?: GameDevCodexHandoff;
  developmentCampaign?: import("../developmentCampaign/developmentCampaignTypes").DevelopmentCampaignEngineResult;
  scopedExecution?: GameDevChatResponse["scopedExecution"];
  workCycle?: GameDevChatResponse["workCycle"];
  sessionContext?: GameDevSessionContext;
  createdAt: string;
};
