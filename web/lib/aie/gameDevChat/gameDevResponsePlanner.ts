import { isDevelopmentCampaignRequest, runDevelopmentCampaignEngine } from "../developmentCampaign/developmentCampaignEngine";
import { createScopedExecutionLog, evaluateScopedExecutionRequest, type ScopedExecutionRequest } from "../scopedSupervisedExecutionRuntime";
import { generateGameDevCodexHandoff } from "./gameDevHandoffGenerator";
import { orchestrateGameDevChat, type GameDevConversationContext } from "./gameDevConversationalOrchestrator";
import { formatReasoningPreface, runConversationalReasoning, type ConversationalReasoningResult } from "./conversationalReasoningEngine";
import { createInitialGameDevSessionContext, summarizeGameDevSessionContext, updateGameDevSessionContext } from "./gameDevSessionContext";
import type { GameDevChatResponse, GameDevChatRoute } from "./gameDevChatTypes";
import type { OperatorWorkCycleRequest } from "../operatorWorkCycleLauncher";

function campaignRoute(): GameDevChatRoute {
  return {
    mode: "DEVELOPMENT_CAMPAIGN",
    conversationMode: "DEVELOPMENT_CAMPAIGN",
    detectedIntent: "Plan AI-E's next development layer",
    confidence: "HIGH",
    unityFirst: false,
    needsClarification: false,
    safetyStatus: "SAFE_PLANNING_ONLY",
    suggestedNextAction: "Review the selected layer and handoff before any implementation work.",
    keywords: ["development", "campaign", "capability", "handoff"],
  };
}

function scopedExecutionRoute(intent: string, keywords: string[]): GameDevChatRoute {
  return {
    mode: "SCOPED_EXECUTION_REQUEST",
    conversationMode: "SCOPED_EXECUTION_REQUEST",
    detectedIntent: intent,
    confidence: "HIGH",
    unityFirst: false,
    needsClarification: false,
    safetyStatus: "SAFE_RESPONSE_ONLY",
    suggestedNextAction: "Approve the prepared scoped execution request in a trusted runtime before running it.",
    keywords,
  };
}

function workCycleRoute(intent: string): GameDevChatRoute {
  return {
    mode: "OPERATOR_WORK_CYCLE_REQUEST",
    conversationMode: "OPERATOR_WORK_CYCLE_REQUEST",
    detectedIntent: intent,
    confidence: "HIGH",
    unityFirst: false,
    needsClarification: false,
    safetyStatus: "SAFE_RESPONSE_ONLY",
    suggestedNextAction: "Approve the bounded work cycle to launch it through the trusted operator runtime.",
    keywords: ["operator-work-cycle", "iterative-cycle", "supervised-runtime"],
  };
}

function durableContinuityRoute(intent: string): GameDevChatRoute {
  return {
    mode: "DURABLE_RUNTIME_CONTINUITY_REQUEST",
    conversationMode: "DURABLE_RUNTIME_CONTINUITY_REQUEST",
    detectedIntent: intent,
    confidence: "HIGH",
    unityFirst: false,
    needsClarification: false,
    safetyStatus: "SAFE_RESPONSE_ONLY",
    suggestedNextAction: "Restore local durable runtime state through the trusted server route before deciding whether to continue.",
    keywords: ["durable-runtime", "restore", "resume", "checkpoint"],
  };
}

function meaningfulLongRunRoute(intent: string): GameDevChatRoute {
  return {
    mode: "MEANINGFUL_LONG_RUN_REQUEST",
    conversationMode: "MEANINGFUL_LONG_RUN_REQUEST",
    detectedIntent: intent,
    confidence: "HIGH",
    unityFirst: false,
    needsClarification: false,
    safetyStatus: "SAFE_RESPONSE_ONLY",
    suggestedNextAction: "Review and approve the supervised long-run target before starting the trusted server runtime.",
    keywords: ["meaningful-long-run", "supervised-run", "checkpointed-runtime"],
  };
}

function detectMeaningfulLongRunRequest(message: string): NonNullable<GameDevChatResponse["meaningfulLongRun"]>["request"] | undefined {
  const lower = message.toLowerCase();
  if (!/\b(start a 5 minute supervised run|continue for 30 minutes|run until the next checkpoint|summarize active run status|meaningful long-run|long run supervised)\b/i.test(message)) {
    return undefined;
  }
  const targetRuntimeMs = lower.includes("30 minute") || lower.includes("30 minutes")
    ? 30 * 60 * 1000
    : lower.includes("next checkpoint")
      ? 60 * 1000
      : 5 * 60 * 1000;
  return {
    sessionId: `meaningful-long-run-${Math.abs(Array.from(lower).reduce((hash, char) => ((hash << 5) - hash) + char.charCodeAt(0), 0)).toString(16)}`,
    projectId: "AI-E",
    mode: targetRuntimeMs >= 30 * 60 * 1000 ? "supervised_mode" : "test_mode",
    targetRuntimeMs,
    checkpointIntervalMs: Math.min(60_000, Math.max(1_000, Math.floor(targetRuntimeMs / 5))),
    requiresOperatorApproval: true,
  };
}

function formatMeaningfulLongRunResponse(meaningfulLongRun: NonNullable<GameDevChatResponse["meaningfulLongRun"]>): string {
  const request = meaningfulLongRun.request;
  return [
    "I prepared a meaningful supervised long-run request.",
    "",
    `Session: ${request.sessionId}`,
    `Mode: ${request.mode}`,
    `Target runtime: ${request.targetRuntimeMs}ms`,
    `Checkpoint interval: ${request.checkpointIntervalMs}ms`,
    "Truthfulness: this chat planner did not start the run; the trusted server route must execute approved bounded cycles and report exact elapsed wall-clock runtime.",
  ].join("\n");
}

function withReasoning(assistantMessage: string, reasoning: ConversationalReasoningResult): string {
  return [formatReasoningPreface(reasoning), "", assistantMessage].join("\n");
}

function detectDurableContinuityRequest(message: string): NonNullable<GameDevChatResponse["durableContinuity"]>["request"] | undefined {
  if (/\b(resume previous campaign|continue yesterday's work|continue yesterdays work)\b/i.test(message)) {
    return { action: "restore_previous_campaign", projectId: "AI-E", requiresOperatorReview: true };
  }
  if (/\b(continue interrupted cycle|resume interrupted cycle)\b/i.test(message)) {
    return { action: "continue_interrupted_cycle", projectId: "AI-E", requiresOperatorReview: true };
  }
  if (/\b(restore last checkpoint|recover last checkpoint)\b/i.test(message)) {
    return { action: "restore_last_checkpoint", projectId: "AI-E", requiresOperatorReview: true };
  }
  if (/\b(what was ai-e working on|what was aie working on|what were you working on)\b/i.test(message)) {
    return { action: "summarize_prior_work", projectId: "AI-E", requiresOperatorReview: true };
  }
  return undefined;
}

function formatDurableContinuityResponse(durableContinuity: NonNullable<GameDevChatResponse["durableContinuity"]>): string {
  const request = durableContinuity.request;
  return [
    "I prepared a durable runtime continuity request.",
    "",
    `Action: ${request.action}`,
    `Project: ${request.projectId}`,
    "Persistence boundary: local JSON file-backed runtime state only.",
    "Truthfulness: this chat planner did not restore state itself; the trusted server route must load the local durable store and report whether restoration really occurred.",
  ].join("\n");
}

function formatRuntimeIntrospectionResponse(reasoning: ConversationalReasoningResult): string {
  return [
    "Here is the truthful runtime picture I can infer from the current chat surface.",
    "",
    "What is real:",
    ...reasoning.runtimeAwareness.realCapabilities.map((capability) => `- ${capability}`),
    "",
    "What is bounded/supervised:",
    "- Approved operator work cycles can run only through trusted server routes and explicit approval gates.",
    "- Scoped execution remains allowlisted, timeout-bounded, and rollback-aware when enabled.",
    "- Long-run and durable runtime flows report measured state; they do not imply unattended autonomy.",
    "",
    "What still depends on external tools:",
    "- Copilot/Codex or another implementation agent is still needed for broad code-writing beyond the bounded workflow artifact lane.",
    "- Unity Editor playmode/control still needs an approved trusted bridge and project-lock-safe validation hooks.",
    "- Browser/operator UI smoke checks still require a running local dev server and explicit operator interaction.",
    "",
    "What is blocked:",
    ...reasoning.runtimeAwareness.blockedCapabilities.map((capability) => `- ${capability}`),
    "- autonomous_real, unrestricted repo autonomy, arbitrary shell access, direct Unity control, and unattended overnight operation remain unavailable.",
    "",
    `Safest next step: ${reasoning.nextUsefulStep}`,
  ].join("\n");
}

function detectOperatorWorkCycleRequest(message: string): OperatorWorkCycleRequest | undefined {
  const repoTask = inferRepoWorkflowTask(message);
  if (!repoTask) {
    return undefined;
  }
  const normalized = message.toLowerCase();
  const cycleRequestId = `work-cycle-${Math.abs(Array.from(normalized).reduce((hash, char) => ((hash << 5) - hash) + char.charCodeAt(0), 0)).toString(16)}`;
  const filePath = "runner_artifacts/operator_work_cycle/latest_cycle_request.txt";
  const plannedLines = [
    `cycleRequestId=${cycleRequestId}`,
    `taskCategory=${repoTask.category}`,
    `operatorRequest=${message}`,
    `intendedActions=${repoTask.intendedActions.join(" | ")}`,
    `requiredCapabilities=${repoTask.requiredCapabilities.join(" | ")}`,
    "visibleLifecycle=preparing -> approval_requested -> executing -> mutating -> validating -> checkpointing -> completed_or_blocked",
    "truthfulness=bounded supervised repo workflow proof; no unrestricted repo control",
    "",
  ].join("\n");

  return {
    cycleRequestId,
    cycleIntent: `bounded supervised repo workflow: ${repoTask.category}`,
    targetFiles: [filePath],
    validationPlan: { commands: ["git diff --name-only"] },
    rollbackPlan: "Restore the pre-cycle artifact snapshot captured by the scoped patch runtime.",
    retryLimit: 1,
    mutationScope: {
      approvedDirectories: ["runner_artifacts/operator_work_cycle"],
      approvedFiles: [filePath],
    },
    requiresApproval: true,
    approvalStatus: "pending",
    cycleStatus: "prepared",
    proposedChanges: [{
      filePath,
      proposedContent: plannedLines,
    }],
    retryMode: "supervised_retry",
    rollbackOnValidationFailure: true,
    stageHistory: [],
    checkpointHistory: [],
  };
}

function inferRepoWorkflowTask(message: string): { category: string; intendedActions: string[]; requiredCapabilities: string[] } | undefined {
  const lower = message.toLowerCase();
  const candidates = [
    {
      category: "validation_repair",
      patterns: [/fix .*failing test/, /failing tests?/, /repair .*test/, /test failure/],
      intendedActions: ["inspect current repo state", "record bounded repair intent", "mutate only the approved workflow artifact", "run allowlisted validation evidence"],
      requiredCapabilities: ["scoped mutation", "rollback snapshot", "validation feed", "checkpoint persistence"],
    },
    {
      category: "approved_patch_application",
      patterns: [/apply .*approved patch/, /approved patch/, /continue .*approved repo work/, /continue .*repo work/],
      intendedActions: ["prepare approved patch application lane", "apply the bounded artifact mutation", "capture diff preview", "checkpoint result"],
      requiredCapabilities: ["operator approval", "scoped mutation", "diff preview", "checkpoint persistence"],
    },
    {
      category: "repo_inspection",
      patterns: [/inspect .*interaction system/, /inspect .*system/, /check .*interaction/, /review .*repo/],
      intendedActions: ["classify requested system", "record inspection target", "validate repo-visible diff evidence", "summarize blocked deeper inspection"],
      requiredCapabilities: ["dynamic task routing", "bounded execution", "validation feed", "truthful blockers"],
    },
    {
      category: "experience_polish",
      patterns: [/improve .*ui atmosphere/, /improve .*atmosphere/, /polish .*ui/],
      intendedActions: ["classify experience-polish request", "record bounded UI improvement intent", "capture diff preview", "surface next human-review step"],
      requiredCapabilities: ["dynamic task routing", "scoped mutation", "diff preview", "operator review"],
    },
    {
      category: "general_bounded_repo_work",
      patterns: [/run .*bounded work cycle/, /continue .*supervised cycle/, /repo task/, /bounded repo work/],
      intendedActions: ["prepare bounded supervised repo workflow", "apply approved artifact mutation", "validate observable change", "checkpoint final state"],
      requiredCapabilities: ["operator approval", "scoped mutation", "validation feed", "checkpoint persistence"],
    },
  ];
  const match = candidates.find((candidate) => candidate.patterns.some((pattern) => pattern.test(lower)));
  return match ? { category: match.category, intendedActions: match.intendedActions, requiredCapabilities: match.requiredCapabilities } : undefined;
}

function formatWorkCycleResponse(workCycle: NonNullable<GameDevChatResponse["workCycle"]>): string {
  const request = workCycle.request;
  return [
    "I prepared a bounded operator work-cycle request.",
    "",
    `Cycle request id: ${request.cycleRequestId}`,
    `Intent: ${request.cycleIntent}`,
    `Target files: ${request.targetFiles.join(", ")}`,
    `Retry limit: ${request.retryLimit}`,
    `Approval status: ${request.approvalStatus}`,
    `Cycle status: ${request.cycleStatus}`,
    `Validation plan: ${request.validationPlan.commands.join(", ") || "none"}`,
    "Visible lifecycle: preparing, approval requested, executing, mutating, validating, checkpointing, completed or blocked.",
    "Truthfulness: no cycle ran from the chat planner; approval launches the trusted operator runtime API.",
  ].join("\n");
}

function detectScopedExecutionRequest(message: string): ScopedExecutionRequest | undefined {
  const normalized = message.toLowerCase();
  const base = {
    executionRequestId: `scoped-exec-${Math.abs(Array.from(normalized).reduce((hash, char) => ((hash << 5) - hash) + char.charCodeAt(0), 0)).toString(16)}`,
    requestedBy: "operator-chat",
    workingDirectory: "repo-root",
    allowedScope: {
      scopeId: "ai-e-repo",
      allowedWorkingDirectories: ["repo-root", "repo-root/web"],
      allowNpmBuild: true,
      allowNpmTests: true,
      allowInspectionCommands: true,
    },
    requiresApproval: true,
    approvalStatus: "pending" as const,
    executionStatus: "prepared" as const,
  };

  if (/\b(git\s+status|repo\s+status|repository\s+status|check\s+(the\s+)?status)\b/i.test(message)) {
    return {
      ...base,
      intent: "check repository status",
      command: "git status --short",
      riskLevel: "LOW",
      timeoutMs: 10_000,
      expectedOutputs: ["short git status entries"],
    };
  }

  if (/\b(run|execute|start)\b.*\b(test|tests|test suite)\b/i.test(message)) {
    return {
      ...base,
      intent: "run web test suite",
      command: "npm test",
      workingDirectory: "repo-root/web",
      riskLevel: "LOW",
      timeoutMs: 120_000,
      expectedOutputs: ["test runner stdout", "test runner exit code"],
    };
  }

  if (/\b(build|compile)\b.*\b(app|web|project)\b/i.test(message)) {
    return {
      ...base,
      intent: "build web app",
      command: "npm run build",
      workingDirectory: "repo-root/web",
      riskLevel: "MEDIUM",
      mutationPossible: true,
      rollbackPlan: "Remove generated .next build output if the build leaves stale artifacts.",
      timeoutMs: 180_000,
      expectedOutputs: ["Next.js build output", "build exit code"],
    };
  }

  if (/\bexecute\b.*\b(next|approved|step)\b/i.test(message)) {
    return {
      ...base,
      intent: "prepare next approved supervised execution step",
      command: "git status --short",
      riskLevel: "LOW",
      timeoutMs: 10_000,
      expectedOutputs: ["current repo status before selecting a bounded step"],
    };
  }

  if (/\b(reset --hard|git clean|force push|remove-item|rm -rf)\b/i.test(message)) {
    return {
      ...base,
      intent: "blocked destructive execution request",
      command: message,
      riskLevel: "HIGH",
      timeoutMs: 10_000,
      expectedOutputs: ["blocked refusal report"],
    };
  }

  return undefined;
}

function formatScopedExecutionResponse(scopedExecution: NonNullable<GameDevChatResponse["scopedExecution"]>): string {
  const { request, decision, log } = scopedExecution;
  const approvalLine = request.approvalStatus === "approved" ? "Approval status: approved." : "Approval status: pending; this chat planner did not run the command.";
  const blockedLine = decision.blockedReason ? `Blocked reason: ${decision.blockedReason}` : "Blocked reason: none at preparation time.";

  return [
    "I prepared a scoped supervised execution request.",
    "",
    `Request id: ${request.executionRequestId}`,
    `Intent: ${request.intent}`,
    `Command: ${request.command}`,
    `Working directory: ${request.workingDirectory}`,
    `Risk: ${request.riskLevel}`,
    approvalLine,
    blockedLine,
    `Execution status: ${log.executionStatus}`,
    `Truthfulness: ${log.truthfulnessLabel}`,
    "",
    "No command was executed from the chat planner. A trusted server/runtime adapter must re-check this request, require approval, and then run only if it remains inside the allowlist.",
  ].join("\n");
}

function formatUnityRuntimeBlockedResponse(reasoning: ConversationalReasoningResult): string {
  return [
    "I can explain why that cannot run directly from this chat yet.",
    "",
    reasoning.runtimeAwareness.missingCapabilityExplanation ?? reasoning.limitationExplanation,
    "",
    "Closest supported workflow today:",
    "- prepare a bounded supervised repo workflow in /operator/chat",
    "- require operator approval",
    "- show diff/checkpoint/validation evidence when the trusted server runtime acts",
    "- keep Unity Editor control as a separate future bridge, not a hidden claim",
    "",
    `Next useful step: ${reasoning.nextUsefulStep}`,
  ].join("\n");
}

function formatDeepGameplayFeedbackResponse(reasoning: ConversationalReasoningResult): string | undefined {
  const feedback = reasoning.gameplayFeedback;
  if (!feedback) {
    return undefined;
  }
  return [
    `What this probably means: ${feedback.whatThisProbablyMeans}`,
    feedback.contextualLens ? `Context lens: ${feedback.contextualLens}` : undefined,
    "",
    "Decomposition dimensions:",
    ...feedback.dimensions.map((dimension) => `- ${dimension}`),
    "",
    "Likely causes:",
    ...feedback.likelyCauses.map((cause) => `- ${cause}`),
    "",
    "Highest leverage fixes:",
    ...feedback.highestLeverageFixes.map((fix) => `- ${fix}`),
    "",
    "Diagnostic questions:",
    ...feedback.diagnosticQuestions.map((question) => `- ${question}`),
    "",
    "Small validation loop:",
    ...feedback.smallValidationLoop.map((step) => `- ${step}`),
    "",
    `If you want AI-E to act: ${feedback.optionalBoundedWorkflowSuggestion}`,
  ].filter((entry): entry is string => Boolean(entry)).join("\n");
}

function openingFor(route: GameDevChatRoute): string {
  switch (route.taskMode ?? route.mode) {
    case "UNITY_IMPLEMENTATION_PLAN":
      return "Got it — this sounds like a Unity implementation planning task.";
    case "GAME_DESIGN_IDEA":
      return "Nice, this is a game-design shaping request.";
    case "BUG_FIX_REQUEST":
      return "Got it — this sounds like a bug-fix request, so I would start with reproduction before edits.";
    case "CODE_EXPLANATION":
      return "Sure — this is a code or concept explanation request.";
    case "PLAYTEST_FEEDBACK":
      return "That reads like playtest feedback, so the useful move is to turn the feeling into tuning levers.";
    case "CODEX_HANDOFF_REQUEST":
      return "Absolutely — I can prepare a safe Codex handoff for implementation.";
    case "CLARIFICATION_NEEDED":
      return "I can help, but I need one more detail before planning safely.";
    case "BLOCKED_OR_UNSAFE":
      return "I cannot help with that version of the request.";
    case "GENERAL_GAME_DEV_HELP":
    default:
      return "Got it — I can help with that as a game-development question.";
  }
}

function jumpAdvice(): string[] {
  return [
    "Check gravity or fall multiplier first; floaty jumps often need faster downward acceleration.",
    "Tune jump force after gravity so the apex height still feels intentional.",
    "Add coyote time and jump buffering for responsiveness without making the jump physically floaty.",
    "Validate in a tiny loop: idle jump, running jump, edge jump, and missed-input recovery.",
  ];
}

function enemyPatrolAdvice(): string[] {
  return [
    "Start with waypoint patrol before adding detection, chase, or attacks.",
    "Keep speed, wait time, waypoint radius, and loop mode serialized for Unity tuning.",
    "Use Rigidbody movement or CharacterController movement consistently with the project’s existing enemy setup.",
    "Validate patrol in an empty scene first, then on the real level geometry.",
  ];
}

function ideaAdvice(): string[] {
  return [
    "Pick the player fantasy first: survive, explore, build, escape, fight, or solve.",
    "Define a 10-minute prototype loop before naming features.",
    "Choose one controllable character, one pressure source, and one reward.",
    "Then turn that into a Unity-first first playable plan.",
  ];
}

function collectibleAdvice(): string[] {
  return [
    "Create a trigger-based Collectible component with an id/value and optional pickup effect hook.",
    "Update a score or inventory service through a small public method instead of hard-wiring UI inside the pickup.",
    "Disable or destroy the collectible only after the pickup state is recorded.",
    "Validate duplicate pickup prevention and scene reload behavior.",
  ];
}

function bulletsFor(message: string, route: GameDevChatRoute): string[] {
  const lower = message.toLowerCase();
  if (lower.includes("jump") || lower.includes("floaty")) {
    return jumpAdvice();
  }
  if (lower.includes("enemy") || lower.includes("patrol")) {
    return enemyPatrolAdvice();
  }
  if (lower.includes("collectible")) {
    return collectibleAdvice();
  }
  if (route.taskMode === "GAME_DESIGN_IDEA" || route.taskMode === "CLARIFICATION_NEEDED" || route.mode === "CLARIFICATION_NEEDED") {
    return ideaAdvice();
  }
  if (route.taskMode === "BUG_FIX_REQUEST" || route.mode === "BUG_FIX_REQUEST") {
    return [
      "Capture the exact symptom, when it started, and whether it reproduces from a clean scene load.",
      "Identify the smallest script or prefab likely involved before editing.",
      "Make one focused fix, then rerun the same reproduction steps.",
    ];
  }
  return [
    "Keep the next step small and testable.",
    "Prefer Unity project conventions over a new architecture.",
    "Ask for implementation only after the target script or system is clear.",
  ];
}

function dynamicReasoningBullets(message: string, route: GameDevChatRoute, reasoning: ConversationalReasoningResult): string[] {
  const lower = message.toLowerCase();
  if (reasoning.gameplayFeedback) {
    return reasoning.gameplayFeedback.highestLeverageFixes;
  }
  if (/tense|tension|suspense|atmosphere|atmospheric|mood/.test(lower)) {
    return reasoning.dynamicDecomposition;
  }
  if (reasoning.confidence === "LOW" || route.needsClarification) {
    return [
      `I am not fully confident because ${reasoning.ambiguity.join(" ") || "the target is underspecified"}`,
      "I would avoid pretending there is enough context to edit or execute.",
      reasoning.nextUsefulStep,
    ];
  }
  const generic = bulletsFor(message, route);
  return generic[0] === "Keep the next step small and testable." ? reasoning.dynamicDecomposition : generic;
}

function clarificationFor(message: string, route: GameDevChatRoute): string {
  const lower = message.toLowerCase();
  if (lower.includes("jump") || lower.includes("floaty")) {
    return "One useful question: is your player moved with Rigidbody2D/Rigidbody, CharacterController, or a custom transform script?";
  }
  if (lower.includes("enemy") || lower.includes("patrol")) {
    return "One useful question: should the enemy patrol fixed waypoints, a NavMesh path, or a simple left-right platform route?";
  }
  if (route.taskMode === "GAME_DESIGN_IDEA" || route.taskMode === "CLARIFICATION_NEEDED" || route.mode === "CLARIFICATION_NEEDED") {
    return "One useful question: what should the player do every 30 seconds in the first playable prototype?";
  }
  if (route.taskMode === "BUG_FIX_REQUEST" || route.mode === "BUG_FIX_REQUEST") {
    return "One useful question: what exact action reproduces the bug, and what error appears in the Unity Console?";
  }
  return "One useful question: are you working in Unity, and which script or scene should this connect to?";
}

function scopedMemoryLine(): string {
  return "I’m using session-scoped chat context only; I do not have durable long-term memory from this page.";
}

function formatConversationalResponse(route: GameDevChatRoute, context?: GameDevConversationContext): string | undefined {
  const sessionSummary = summarizeGameDevSessionContext(context?.sessionContext);
  switch (route.mode) {
    case "GREETING":
      return "Hey — I’m here. What are we working on today: game design, Unity implementation, debugging, or a Codex handoff?";
    case "THANKS":
      return "You’re welcome. When you’re ready, send the next game idea, Unity issue, bug report, or handoff request and I’ll route it safely.";
    case "SESSION_CLOSE":
      return "Goodnight — we can pick this back up later. I won’t claim any files changed or Unity validation happened from this chat alone.";
    case "CAPABILITY_HELP":
      return [
        "I can help as a game-dev planning assistant.",
        "",
        "- Shape game ideas into a first playable loop.",
        "- Plan Unity implementation steps without pretending to edit files.",
        "- Turn bugs or playtest feedback into reproduction and validation steps.",
        "- Prepare bounded Codex handoffs when you explicitly ask for implementation handoff.",
        "",
        "What do you want to work on first: design, Unity implementation, debugging, or a Codex handoff?",
      ].join("\n");
    case "CONTINUE_PREVIOUS":
      return [
        "Yes — I can continue from the current session context.",
        "",
        sessionSummary,
        "",
        "A good next step is to tighten the plan into one small validation loop, or ask me to prepare a Codex handoff for that same topic.",
        scopedMemoryLine(),
      ].join("\n");
    case "TROUBLESHOOT_PREVIOUS":
      return [
        "Got it — let’s troubleshoot the previous attempt in this session.",
        "",
        sessionSummary,
        "",
        "What did you expect, what happened instead, and did Unity show any Console error or log line? I’ll use that to narrow the fix plan before suggesting edits.",
        scopedMemoryLine(),
      ].join("\n");
    case "REFINE_PREVIOUS":
      return [
        "Yes — I can refine the previous direction using this session’s context.",
        "",
        sessionSummary,
        "",
        "For a more atmospheric pass, I would tune mood first: lighting language, pacing, ambient sound targets, environmental silhouettes, and one strong player-facing emotional goal. This is planning only; no assets, scenes, or files were changed.",
        scopedMemoryLine(),
      ].join("\n");
    case "RETRY_PREVIOUS":
      return [
        "Yes — I can try a different planning pass from the current session context.",
        "",
        sessionSummary,
        "",
        "I would change one lever at a time, preserve the original goal, and define a clearer validation check before any implementation handoff.",
        scopedMemoryLine(),
      ].join("\n");
    case "USE_LAST_HANDOFF":
      return [
        "Yes — I can reuse the latest handoff topic from this chat session.",
        "",
        sessionSummary,
        "",
        "I can turn that topic into a revised handoff, a validation checklist, or a safer implementation brief. This chat has not run Codex or edited files.",
        scopedMemoryLine(),
      ].join("\n");
    case "SESSION_RECAP":
      return [
        "Here’s what I have in this chat session:",
        "",
        sessionSummary,
        "",
        scopedMemoryLine(),
      ].join("\n");
    case "FRUSTRATION_OR_CONFUSION":
      return "No problem — let’s slow it down. Tell me the smallest visible symptom or the game feature you were trying to change, and I’ll help turn it into one safe next step.";
    case "CLARIFICATION_NEEDED":
      if (!route.taskMode) {
        if (route.detectedIntent.includes("Continue")) {
          return `I can continue, but I don’t have usable session context yet. Tell me what we were working on, or paste the last plan/result, and I’ll pick it up safely from there. ${scopedMemoryLine()}`;
        }
        if (route.detectedIntent.includes("Troubleshooting")) {
          return `I can troubleshoot that, but I don’t have the prior task in this session context yet. What did you try, what happened instead, and did Unity show any Console error? ${scopedMemoryLine()}`;
        }
        if (route.detectedIntent.includes("handoff")) {
          return `I don’t have a latest handoff stored in this chat session yet. Ask for a new Codex handoff or paste the handoff you want to reuse. ${scopedMemoryLine()}`;
        }
        if (route.detectedIntent.includes("Refinement")) {
          return `I can refine it, but I don’t have the earlier idea or plan in this session context yet. Send the idea, plan, or target feature and I’ll make a focused refinement pass. ${scopedMemoryLine()}`;
        }
        return `I’m here, but I need one more detail before routing this safely. Are we talking game design, Unity implementation, debugging, playtest feedback, or a Codex handoff? ${scopedMemoryLine()}`;
      }
      return undefined;
    default:
      return undefined;
  }
}

function formatResponse(message: string, route: GameDevChatRoute, includeHandoff: boolean, context: GameDevConversationContext | undefined, reasoning: ConversationalReasoningResult): string {
  const conversationalResponse = formatConversationalResponse(route, context);
  if (conversationalResponse) {
    return withReasoning(conversationalResponse, reasoning);
  }

  if (route.mode === "BLOCKED_OR_UNSAFE" || route.taskMode === "BLOCKED_OR_UNSAFE") {
    return withReasoning(`${openingFor(route)} ${reasoning.limitationExplanation} I can still help reframe it as a safe Unity planning, debugging, or supervised repo workflow task.`, reasoning);
  }

  const gameplayFeedbackResponse = formatDeepGameplayFeedbackResponse(reasoning);
  if (gameplayFeedbackResponse) {
    return withReasoning(gameplayFeedbackResponse, reasoning);
  }

  const bullets = dynamicReasoningBullets(message, route, reasoning).map((entry) => `- ${entry}`).join("\n");
  const handoffLine = includeHandoff
    ? "I prepared a Codex handoff below. It is a handoff only; chat mode did not edit files, run Unity, or execute an agent."
    : "If you want implementation, I can prepare a Codex handoff that tells an implementation agent exactly what to inspect and how to validate it.";

  return withReasoning([
    openingFor(route),
    "",
    bullets,
    "",
    clarificationFor(message, route),
    "",
    handoffLine,
  ].join("\n"), reasoning);
}

function isRuntimeIntrospectionRequest(message: string): boolean {
  return /\b(what is real|what can you actually do|what can you actually do right now|runtime capabilities.*real|runtime state|what is scaffolded|what still depends on (copilot|codex|external tools)|what is still blocked|what.*blocked|why did .*workflow|what subsystem|explain your runtime|capability is missing)\b/i.test(message);
}

function isUnityRuntimeBlockedRequest(message: string): boolean {
  return /\b(run unity|open unity|control unity|playtest in unity|unity editor)\b/i.test(message);
}

function formatCampaignResponse(campaign: ReturnType<typeof runDevelopmentCampaignEngine>): string {
  const { selectedLayer } = campaign.plan;
  return [
    "I reviewed AI-E’s current capability layer map and selected the next highest-impact unblocked development layer.",
    "",
    `Selected layer: ${selectedLayer.layerId}`,
    `Status: ${selectedLayer.status}`,
    `Risk: ${selectedLayer.riskLevel}`,
    `Why: ${campaign.plan.selectedReason}`,
    "",
    "Next bounded milestone:",
    ...campaign.plan.milestonePlan.map((step) => `- ${step}`),
    "",
    "Scaffold warnings:",
    ...campaign.plan.scaffoldWarnings.map((warning) => `- ${warning}`),
    "",
    campaign.truthfulnessSummary,
  ].join("\n");
}

export function planGameDevChatResponse(message: string, context?: GameDevConversationContext): GameDevChatResponse {
  if (isUnityRuntimeBlockedRequest(message)) {
    const route: GameDevChatRoute = {
      mode: "BLOCKED_OR_UNSAFE",
      conversationMode: "BLOCKED_OR_UNSAFE",
      detectedIntent: "Request direct Unity Editor runtime control",
      confidence: "HIGH",
      unityFirst: true,
      needsClarification: false,
      safetyStatus: "BLOCKED",
      suggestedNextAction: "Use a planning-only Unity handoff or a bounded supervised repo workflow instead.",
      keywords: ["unity", "runtime", "blocked-capability"],
    };
    const reasoning = runConversationalReasoning({ message, route, sessionContext: context?.sessionContext, subsystem: "conversation" });
    const assistantMessage = withReasoning(formatUnityRuntimeBlockedResponse(reasoning), reasoning);
    const sessionContext = updateGameDevSessionContext(context?.sessionContext ?? createInitialGameDevSessionContext(), message, route, assistantMessage, undefined, reasoning);
    return { route, assistantMessage, reasoning, sessionContext, scaffoldStatus: "PARTIAL_CHAT_MODE", changedFilesClaimed: false };
  }

  const meaningfulLongRunRequest = detectMeaningfulLongRunRequest(message);
  if (meaningfulLongRunRequest) {
    const route = meaningfulLongRunRoute("Prepare meaningful supervised long-run operation");
    const meaningfulLongRun = { request: meaningfulLongRunRequest };
    const reasoning = runConversationalReasoning({ message, route, sessionContext: context?.sessionContext, subsystem: "meaningful_long_run" });
    const assistantMessage = withReasoning(formatMeaningfulLongRunResponse(meaningfulLongRun), reasoning);
    const sessionContext = updateGameDevSessionContext(context?.sessionContext ?? createInitialGameDevSessionContext(), message, route, assistantMessage, undefined, reasoning);

    return {
      route,
      assistantMessage,
      reasoning,
      meaningfulLongRun,
      sessionContext,
      scaffoldStatus: "SESSION_CONTEXT_AND_CONVERSATION_MEMORY_PHASE1",
      changedFilesClaimed: false,
    };
  }

  const durableContinuityRequest = detectDurableContinuityRequest(message);
  if (durableContinuityRequest) {
    const route = durableContinuityRoute(durableContinuityRequest.action);
    const durableContinuity = { request: durableContinuityRequest };
    const reasoning = runConversationalReasoning({ message, route, sessionContext: context?.sessionContext, subsystem: "durable_runtime" });
    const assistantMessage = withReasoning(formatDurableContinuityResponse(durableContinuity), reasoning);
    const sessionContext = updateGameDevSessionContext(context?.sessionContext ?? createInitialGameDevSessionContext(), message, route, assistantMessage, undefined, reasoning);

    return {
      route,
      assistantMessage,
      reasoning,
      durableContinuity,
      sessionContext,
      scaffoldStatus: "SESSION_CONTEXT_AND_CONVERSATION_MEMORY_PHASE1",
      changedFilesClaimed: false,
    };
  }

  const workCycleRequest = detectOperatorWorkCycleRequest(message);
  if (workCycleRequest) {
    const route = workCycleRoute(workCycleRequest.cycleIntent);
    const workCycle = { request: workCycleRequest };
    const reasoning = runConversationalReasoning({ message, route, sessionContext: context?.sessionContext, subsystem: "operator_work_cycle" });
    const assistantMessage = withReasoning(formatWorkCycleResponse(workCycle), reasoning);
    const sessionContext = updateGameDevSessionContext(context?.sessionContext ?? createInitialGameDevSessionContext(), message, route, assistantMessage, undefined, reasoning);

    return {
      route,
      assistantMessage,
      reasoning,
      workCycle,
      sessionContext,
      scaffoldStatus: "SESSION_CONTEXT_AND_CONVERSATION_MEMORY_PHASE1",
      changedFilesClaimed: false,
    };
  }

  const executionRequest = detectScopedExecutionRequest(message);
  if (executionRequest) {
    const decision = evaluateScopedExecutionRequest(executionRequest);
    const log = createScopedExecutionLog(executionRequest, decision, {
      executionStatus: decision.executable ? "prepared" : decision.blockedReason?.includes("approval") ? "awaiting_approval" : "blocked",
      truthfulnessLabel: decision.executable || decision.blockedReason?.includes("approval") ? "prepared_no_execution" : "blocked_no_execution",
    });
    const route = scopedExecutionRoute(executionRequest.intent, ["scoped-execution", executionRequest.command.split(" ")[0] ?? "command"]);
    const scopedExecution = { request: executionRequest, decision, log };
    const reasoning = runConversationalReasoning({ message, route, sessionContext: context?.sessionContext, subsystem: "scoped_execution" });
    const assistantMessage = withReasoning(formatScopedExecutionResponse(scopedExecution), reasoning);
    const sessionContext = updateGameDevSessionContext(context?.sessionContext ?? createInitialGameDevSessionContext(), message, route, assistantMessage, undefined, reasoning);

    return {
      route,
      assistantMessage,
      reasoning,
      scopedExecution,
      sessionContext,
      scaffoldStatus: "SESSION_CONTEXT_AND_CONVERSATION_MEMORY_PHASE1",
      changedFilesClaimed: false,
    };
  }

  const campaign = isDevelopmentCampaignRequest(message) ? runDevelopmentCampaignEngine() : undefined;
  const route = campaign ? campaignRoute() : orchestrateGameDevChat(message, context);
  const reasoning = runConversationalReasoning({ message, route, sessionContext: context?.sessionContext, subsystem: campaign ? "development_campaign" : "conversation" });
  const shouldGenerateHandoff = route.mode === "CODEX_HANDOFF_REQUEST" || route.taskMode === "CODEX_HANDOFF_REQUEST";
  const codexHandoff = shouldGenerateHandoff ? generateGameDevCodexHandoff(message, route) : undefined;
  const baseMessage = isRuntimeIntrospectionRequest(message) ? formatRuntimeIntrospectionResponse(reasoning) : campaign ? formatCampaignResponse(campaign) : formatResponse(message, route, shouldGenerateHandoff, context, reasoning);
  const assistantMessage = isRuntimeIntrospectionRequest(message) ? withReasoning(baseMessage, reasoning) : campaign ? withReasoning(baseMessage, reasoning) : baseMessage;
  const sessionContext = updateGameDevSessionContext(context?.sessionContext ?? createInitialGameDevSessionContext(), message, route, assistantMessage, codexHandoff, reasoning);
  const scaffoldStatus = route.safetyStatus === "BLOCKED" ? "PARTIAL_CHAT_MODE" : "SESSION_CONTEXT_AND_CONVERSATION_MEMORY_PHASE1";

  return {
    route,
    assistantMessage,
    reasoning,
    codexHandoff,
    developmentCampaign: campaign,
    sessionContext,
    scaffoldStatus,
    changedFilesClaimed: false,
  };
}
