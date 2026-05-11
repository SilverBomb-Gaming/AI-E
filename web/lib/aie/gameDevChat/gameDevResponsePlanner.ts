import { isDevelopmentCampaignRequest, runDevelopmentCampaignEngine } from "../developmentCampaign/developmentCampaignEngine";
import { createScopedExecutionLog, evaluateScopedExecutionRequest, type ScopedExecutionRequest } from "../scopedSupervisedExecutionRuntime";
import { generateGameDevCodexHandoff } from "./gameDevHandoffGenerator";
import { orchestrateGameDevChat, type GameDevConversationContext } from "./gameDevConversationalOrchestrator";
import { createInitialGameDevSessionContext, summarizeGameDevSessionContext, updateGameDevSessionContext } from "./gameDevSessionContext";
import type { GameDevChatResponse, GameDevChatRoute } from "./gameDevChatTypes";

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

function formatResponse(message: string, route: GameDevChatRoute, includeHandoff: boolean, context?: GameDevConversationContext): string {
  const conversationalResponse = formatConversationalResponse(route, context);
  if (conversationalResponse) {
    return conversationalResponse;
  }

  if (route.mode === "BLOCKED_OR_UNSAFE" || route.taskMode === "BLOCKED_OR_UNSAFE") {
    return `${openingFor(route)} I can still help reframe it as a safe Unity planning, debugging, or learning task.`;
  }

  const bullets = bulletsFor(message, route).map((entry) => `- ${entry}`).join("\n");
  const handoffLine = includeHandoff
    ? "I prepared a Codex handoff below. It is a handoff only; chat mode did not edit files, run Unity, or execute an agent."
    : "If you want implementation, I can prepare a Codex handoff that tells an implementation agent exactly what to inspect and how to validate it.";

  return [
    openingFor(route),
    "",
    bullets,
    "",
    clarificationFor(message, route),
    "",
    handoffLine,
  ].join("\n");
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
  const executionRequest = detectScopedExecutionRequest(message);
  if (executionRequest) {
    const decision = evaluateScopedExecutionRequest(executionRequest);
    const log = createScopedExecutionLog(executionRequest, decision, {
      executionStatus: decision.executable ? "prepared" : decision.blockedReason?.includes("approval") ? "awaiting_approval" : "blocked",
      truthfulnessLabel: decision.executable || decision.blockedReason?.includes("approval") ? "prepared_no_execution" : "blocked_no_execution",
    });
    const route = scopedExecutionRoute(executionRequest.intent, ["scoped-execution", executionRequest.command.split(" ")[0] ?? "command"]);
    const scopedExecution = { request: executionRequest, decision, log };
    const assistantMessage = formatScopedExecutionResponse(scopedExecution);
    const sessionContext = updateGameDevSessionContext(context?.sessionContext ?? createInitialGameDevSessionContext(), message, route, assistantMessage);

    return {
      route,
      assistantMessage,
      scopedExecution,
      sessionContext,
      scaffoldStatus: "SESSION_CONTEXT_AND_CONVERSATION_MEMORY_PHASE1",
      changedFilesClaimed: false,
    };
  }

  const campaign = isDevelopmentCampaignRequest(message) ? runDevelopmentCampaignEngine() : undefined;
  const route = campaign ? campaignRoute() : orchestrateGameDevChat(message, context);
  const shouldGenerateHandoff = route.mode === "CODEX_HANDOFF_REQUEST" || route.taskMode === "CODEX_HANDOFF_REQUEST";
  const codexHandoff = shouldGenerateHandoff ? generateGameDevCodexHandoff(message, route) : undefined;
  const assistantMessage = campaign ? formatCampaignResponse(campaign) : formatResponse(message, route, shouldGenerateHandoff, context);
  const sessionContext = updateGameDevSessionContext(context?.sessionContext ?? createInitialGameDevSessionContext(), message, route, assistantMessage, codexHandoff);
  const scaffoldStatus = route.safetyStatus === "BLOCKED" ? "PARTIAL_CHAT_MODE" : "SESSION_CONTEXT_AND_CONVERSATION_MEMORY_PHASE1";

  return {
    route,
    assistantMessage,
    codexHandoff,
    developmentCampaign: campaign,
    sessionContext,
    scaffoldStatus,
    changedFilesClaimed: false,
  };
}
