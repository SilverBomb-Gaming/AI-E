import type { GameDevChatRoute, GameDevSessionContext } from "./gameDevChatTypes";

export type ConversationalReasoningConfidence = "LOW" | "MEDIUM" | "HIGH";
export type RuntimeAvailabilityStatus = "available_supervised" | "available_read_only" | "disabled_or_requires_approval" | "blocked_not_implemented" | "not_applicable";
export type ContextImportance = "primary_task" | "runtime_request" | "blocked_request" | "tangent" | "clarification" | "recap";

export type ConversationalReasoningResult = {
  phaseId: "CONVERSATIONAL_INTELLIGENCE_AND_DYNAMIC_REASONING_PHASE1";
  inferredIntent: string;
  probableUserGoal: string;
  confidence: ConversationalReasoningConfidence;
  contextImportance: ContextImportance;
  selectedCapabilityRoute: string;
  routeRationale: string;
  ambiguity: string[];
  reasoningPath: string[];
  dynamicDecomposition: string[];
  runtimeAwareness: {
    runtimeAvailability: RuntimeAvailabilityStatus;
    realCapabilities: string[];
    blockedCapabilities: string[];
    missingCapabilityExplanation?: string;
  };
  limitationExplanation: string;
  nextUsefulStep: string;
  shouldPreservePreviousTaskContext: boolean;
  truthfulnessWarnings: string[];
};

type ReasoningInput = {
  message: string;
  route: GameDevChatRoute;
  sessionContext?: GameDevSessionContext;
  subsystem?: "conversation" | "scoped_execution" | "operator_work_cycle" | "durable_runtime" | "meaningful_long_run" | "development_campaign";
};

function compact(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function includesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

function inferContextImportance(message: string, route: GameDevChatRoute): ContextImportance {
  const lower = message.toLowerCase();
  if (route.safetyStatus === "BLOCKED" || route.mode === "BLOCKED_OR_UNSAFE") {
    return "blocked_request";
  }
  if (route.needsClarification || route.mode === "CLARIFICATION_NEEDED") {
    return "clarification";
  }
  if (route.mode === "SESSION_RECAP" || /what (were|are) we/i.test(message)) {
    return "recap";
  }
  if (route.conversationMode === "SCOPED_EXECUTION_REQUEST" || route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST" || route.conversationMode === "DURABLE_RUNTIME_CONTINUITY_REQUEST" || route.conversationMode === "MEANINGFUL_LONG_RUN_REQUEST") {
    return "runtime_request";
  }
  if (/^(thanks|thank you|ok|okay|cool|nice|goodnight|hello|hi)\b/i.test(lower)) {
    return "tangent";
  }
  return "primary_task";
}

function runtimeStatusFor(message: string, route: GameDevChatRoute, subsystem?: ReasoningInput["subsystem"]): RuntimeAvailabilityStatus {
  const lower = message.toLowerCase();
  if (includesAny(lower, [/run unity/, /open unity/, /control unity/, /playtest in unity/, /unity editor/])) {
    return "blocked_not_implemented";
  }
  if (includesAny(lower, [/autonomous_real/, /overnight/, /unattended/, /hands[- ]off/, /do everything/])) {
    return "blocked_not_implemented";
  }
  if (subsystem === "operator_work_cycle") {
    return "available_supervised";
  }
  if (subsystem === "scoped_execution" || route.conversationMode === "SCOPED_EXECUTION_REQUEST") {
    return "disabled_or_requires_approval";
  }
  if (subsystem === "durable_runtime" || subsystem === "meaningful_long_run") {
    return "disabled_or_requires_approval";
  }
  return "not_applicable";
}

function decompositionFor(message: string, route: GameDevChatRoute): string[] {
  const lower = message.toLowerCase();
  if (/tense|tension|suspense|atmosphere|atmospheric|mood/.test(lower)) {
    return [
      "Pacing pressure: shorten safe intervals, delay relief, or make consequences feel closer.",
      "Audio pressure: use silence, distant cues, heartbeat-like rhythm, or warning layers carefully.",
      "Visibility pressure: reduce certainty with occlusion, limited sightlines, contrast, or readable darkness.",
      "Enemy pressure: make patrol timing, pursuit commitment, and recovery windows create anticipation.",
      "Resource pressure: limit time, health, ammo, light, inventory, or retry comfort without making the game unfair.",
      "UI pressure: expose urgent information clearly, but avoid noisy overlays that fight the intended mood.",
      "Environmental storytelling: imply risk before showing it so the player starts predicting danger.",
    ];
  }
  if (/jump|floaty|movement/.test(lower)) {
    return ["Physics feel", "Input buffering", "Apex timing", "Fall acceleration", "Ground/edge forgiveness", "Tiny repeatable test scene"];
  }
  if (/enemy|patrol|combat/.test(lower)) {
    return ["State ownership", "Movement route", "Detection rule", "Chase/return behavior", "Tuning variables", "Scene validation"];
  }
  if (route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST") {
    return ["Infer repo task category", "Prepare bounded plan", "Request approval", "Run scoped mutation", "Capture diff/checkpoint/validation evidence", "Report blocked capabilities"];
  }
  if (route.conversationMode === "SCOPED_EXECUTION_REQUEST") {
    return ["Classify command intent", "Check allowlist and working directory", "Require approval", "Run only through trusted adapter", "Report stdout/stderr and truthfulness labels"];
  }
  return ["Clarify the real target", "Identify the smallest useful next step", "Name the relevant capability boundary", "Keep the response truthful about execution"];
}

function blockedCapabilitiesFor(message: string, route: GameDevChatRoute): string[] {
  const lower = message.toLowerCase();
  const blocked = new Set<string>();
  if (/unity|editor|playtest/.test(lower)) {
    blocked.add("direct Unity Editor control from operator chat");
  }
  if (/overnight|unattended|hands[- ]off|autonomous_real|do everything/.test(lower)) {
    blocked.add("unattended autonomous operation");
    blocked.add("autonomous_real status");
  }
  if (/delete everything|reset --hard|force push|rm -rf|remove-item/.test(lower) || route.safetyStatus === "BLOCKED") {
    blocked.add("destructive or unrestricted shell execution");
  }
  if (route.conversationMode !== "OPERATOR_WORK_CYCLE_REQUEST") {
    blocked.add("unrestricted arbitrary repo mutation");
  }
  return Array.from(blocked);
}

function realCapabilitiesFor(route: GameDevChatRoute, subsystem?: ReasoningInput["subsystem"]): string[] {
  const capabilities = ["session-scoped conversational context", "deterministic route classification", "truthful no-execution labeling"];
  if (subsystem === "operator_work_cycle" || route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST") {
    capabilities.push("bounded supervised repo workflow", "approved scoped mutation", "checkpoint/diff/validation visibility");
  }
  if (subsystem === "scoped_execution" || route.conversationMode === "SCOPED_EXECUTION_REQUEST") {
    capabilities.push("approved allowlisted command execution when trusted runtime is enabled");
  }
  if (subsystem === "durable_runtime" || route.conversationMode === "DURABLE_RUNTIME_CONTINUITY_REQUEST") {
    capabilities.push("local JSON file-backed durable runtime restore reporting");
  }
  if (subsystem === "meaningful_long_run" || route.conversationMode === "MEANINGFUL_LONG_RUN_REQUEST") {
    capabilities.push("approved supervised long-run test/supervised session controller");
  }
  return capabilities;
}

function missingCapabilityExplanation(message: string, runtimeAvailability: RuntimeAvailabilityStatus, blockedCapabilities: string[]): string | undefined {
  const lower = message.toLowerCase();
  if (/run unity|open unity|control unity|playtest in unity|unity editor/.test(lower)) {
    return "Unity Editor control is not implemented in this operator chat workflow. Making it real would require a trusted editor automation bridge, project-lock handling, scene/playmode validation hooks, and explicit operator approval gates.";
  }
  if (/overnight|unattended|hands[- ]off|autonomous_real|do everything/.test(lower)) {
    return "Unattended or autonomous_real operation is intentionally unavailable. Current execution remains bounded, supervised, and approval-gated, so long-running or overnight claims require measured runs and explicit operator supervision.";
  }
  if (blockedCapabilities.length > 0 || runtimeAvailability === "blocked_not_implemented") {
    return `The missing piece is ${blockedCapabilities.join(", ")}. The closest supported workflow is a bounded supervised repo request with visible approval, diff, checkpoint, and validation evidence.`;
  }
  return undefined;
}

function probableGoalFor(message: string, route: GameDevChatRoute): string {
  const lower = message.toLowerCase();
  if (/why|what happened|failed|blocked|cannot|can't|didn't work/.test(lower)) {
    return "understand why a workflow failed or could not proceed";
  }
  if (/what is real|what can you do|runtime state|scaffold|implemented/.test(lower)) {
    return "inspect AI-E's current runtime capabilities and limits";
  }
  if (/tense|tension|atmosphere|atmospheric/.test(lower)) {
    return "turn a vague mood request into actionable game-feel levers";
  }
  if (route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST") {
    return "prepare a visible supervised repo workflow the operator can approve";
  }
  return route.detectedIntent;
}

export function runConversationalReasoning(input: ReasoningInput): ConversationalReasoningResult {
  const message = compact(input.message);
  const route = input.route;
  const contextImportance = inferContextImportance(message, route);
  const runtimeAvailability = runtimeStatusFor(message, route, input.subsystem);
  const blockedCapabilities = blockedCapabilitiesFor(message, route);
  const realCapabilities = realCapabilitiesFor(route, input.subsystem);
  const ambiguity = [
    route.confidence === "LOW" ? "Route confidence is low; the user may need to name the target system or desired action." : undefined,
    route.needsClarification ? "The request lacks enough detail to safely choose an implementation path." : undefined,
    /it|that|this|continue|again/i.test(message) && !input.sessionContext?.currentImplementationTask ? "The message depends on prior context that is not fully available in this session." : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  const selectedCapabilityRoute = route.conversationMode ?? route.taskMode ?? route.mode;
  const missing = missingCapabilityExplanation(message, runtimeAvailability, blockedCapabilities);
  const routeRationale = `Selected ${selectedCapabilityRoute} because the message matched ${route.detectedIntent} with ${route.confidence.toLowerCase()} confidence and safety status ${route.safetyStatus}.`;
  const nextUsefulStep = route.needsClarification
    ? "Ask one precise clarification before planning or execution."
    : runtimeAvailability === "blocked_not_implemented"
      ? "Use the closest supported supervised repo workflow or ask for a planning-only Unity handoff."
      : route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST"
        ? "Review the bounded plan, then approve or reject it in the operator UI."
        : route.conversationMode === "SCOPED_EXECUTION_REQUEST"
          ? "Approve only if the command, working directory, timeout, and rollback boundary are acceptable."
          : "Continue with the most specific target system, symptom, or desired player-facing outcome.";

  return {
    phaseId: "CONVERSATIONAL_INTELLIGENCE_AND_DYNAMIC_REASONING_PHASE1",
    inferredIntent: route.detectedIntent,
    probableUserGoal: probableGoalFor(message, route),
    confidence: route.confidence,
    contextImportance,
    selectedCapabilityRoute,
    routeRationale,
    ambiguity,
    reasoningPath: [
      `Read the user message as: ${probableGoalFor(message, route)}.`,
      routeRationale,
      `Context importance: ${contextImportance}.`,
      `Runtime availability: ${runtimeAvailability}.`,
      missing ?? "No missing runtime capability was required for the prepared response.",
    ],
    dynamicDecomposition: decompositionFor(message, route),
    runtimeAwareness: {
      runtimeAvailability,
      realCapabilities,
      blockedCapabilities,
      missingCapabilityExplanation: missing,
    },
    limitationExplanation: missing ?? "The response stays inside the current supervised runtime boundary and does not claim hidden execution.",
    nextUsefulStep,
    shouldPreservePreviousTaskContext: contextImportance === "tangent" || contextImportance === "blocked_request" || contextImportance === "clarification" || contextImportance === "recap",
    truthfulnessWarnings: [
      "This is deterministic runtime-aware reasoning over known chat state and route metadata, not generalized AGI reasoning.",
      "Prepared, blocked, or clarification responses must not be described as file edits or runtime execution.",
      "autonomous_real, unrestricted repo autonomy, and unattended overnight operation remain unavailable.",
    ],
  };
}

export function formatReasoningPreface(reasoning: ConversationalReasoningResult): string {
  return [
    `Reasoning summary: I read this as ${reasoning.probableUserGoal}.`,
    `Why this route: ${reasoning.routeRationale}`,
    reasoning.ambiguity.length > 0 ? `Uncertainty: ${reasoning.ambiguity.join(" ")}` : undefined,
    `Runtime note: ${reasoning.limitationExplanation}`,
    `Next useful step: ${reasoning.nextUsefulStep}`,
  ].filter(Boolean).join("\n");
}
