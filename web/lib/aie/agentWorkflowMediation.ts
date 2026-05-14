import { orchestrateGameDevChat } from "./gameDevChat/gameDevConversationalOrchestrator";
import type { GameDevChatRoute } from "./gameDevChat/gameDevChatTypes";

export type AgentWorkflowInteractionLevel =
  | "CONVERSATIONAL_ONLY"
  | "CONVERSATIONAL_GUIDANCE"
  | "GUIDED_EXPLORATION_OFFER"
  | "LIGHTWEIGHT_GUIDED_WORKFLOW"
  | "FULL_SUPERVISED_OPERATIONAL";

export type AgentWorkflowVisibility = "hidden" | "minimal" | "full";

export type AgentWorkflowMediationDecision = {
  prompt: string;
  interactionLevel: AgentWorkflowInteractionLevel;
  workflowVisibility: AgentWorkflowVisibility;
  shouldCreateWorkflow: boolean;
  route: GameDevChatRoute;
  assistantMessage: string;
  suggestedActions: string[];
  escalationReason: string;
  governanceBoundary: string;
};

const currentProgressSummary = "AI-E is becoming a conversationally guided operational system: natural discussion first, governed operational work when there is concrete intent.";

const conversationalOptionalPaths = [
  "Learn the current milestone",
  "Review what changed recently",
  "Explore a safe system area when ready",
  "Prepare a governed workflow for a concrete task",
  "Ask a follow-up in plain language",
];

const onboardingOptionalPaths = [
  "Learn the current milestone",
  "Tour the main AI-E screens",
  "Understand approvals and safe workflows",
  "Choose a safe first exploration when ready",
  "Ask a follow-up in plain language",
];

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isConversationFirstRoute(route: GameDevChatRoute): boolean {
  return route.conversationMode === "GREETING"
    || route.conversationMode === "CAPABILITY_HELP"
    || route.conversationMode === "FRUSTRATION_OR_CONFUSION"
    || (route.conversationMode === "CLARIFICATION_NEEDED" && !route.taskMode);
}

function isOperationalRoute(route: GameDevChatRoute): boolean {
  return route.conversationMode === "SCOPED_EXECUTION_REQUEST"
    || route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST"
    || route.conversationMode === "DURABLE_RUNTIME_CONTINUITY_REQUEST"
    || route.conversationMode === "MEANINGFUL_LONG_RUN_REQUEST"
    || route.conversationMode === "CODEX_HANDOFF_REQUEST"
    || route.taskMode === "CODEX_HANDOFF_REQUEST"
    || route.taskMode === "BLOCKED_OR_UNSAFE";
}

function hasOperationalWorkflowSignals(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  return /\b(patch|repo|repository|validate|validation|verify|build|execute|execution|apply|mutation|rollback|runtime|handoff|supervised|implement|implementation|modify|change|fix|generate\s+(a\s+)?proposed|prepare\s+(a\s+)?safe|prepare\s+(a\s+)?rollback)\b/.test(normalized);
}

function hasExplicitSupervisedWorkflowIntent(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  return /\b(prepare|generate|implement|modify|change|apply|validate|verify|run|execute|fix|patch|rollback|build)\b/.test(normalized)
    && /\b(patch|fix|implementation|improvement|change|repo|repository|validation|verify|build|rollback|apply|execute|run|movement|combat|code|files?)\b/.test(normalized);
}

function hasExplicitGuidedExplorationCreateIntent(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  const asksToInvestigate = /\b(inspect|review|analy[sz]e|look\s+into|investigate|explore)\b/.test(normalized)
    || /\bhelp\s+me\s+(inspect|review|analy[sz]e|look\s+into|investigate|explore|understand)\b/.test(normalized);
  const hasConcreteTarget = /\b(system|combat|inventory|enemy\s+ai|ai\s+behavior|balance|movement|responsiveness|project|code|scene|workflow|runtime|approval|feature|mechanic|bug|problem|issues?)\b/.test(normalized);
  const isOnlyAskingForSuggestions = /\b(what|where|which|recommend|suggest|should\s+i|could\s+i)\b.*\b(explore|inspect|start|look\s+at|learn)\b/.test(normalized)
    && !/^\s*(inspect|review|analy[sz]e|look\s+into|investigate|explore|help\s+me\s+(inspect|review|analy[sz]e|look\s+into|investigate|explore|understand))\b/i.test(normalized);
  return asksToInvestigate && hasConcreteTarget && !isOnlyAskingForSuggestions;
}

function isGuidedExplorationOfferPrompt(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  return /\b(what|where|which|recommend|suggest|should\s+i|could\s+i)\b.*\b(explore|inspect|start|look\s+at|learn|understand)\b/.test(normalized)
    || /\bwhat\s+would\s+you\s+recommend\s+i\s+explore\s+first\b/.test(normalized)
    || /\bwhat\s+should\s+beginners?\s+understand\s+first\b/.test(normalized);
}

function isConversationalDiscussionPrompt(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  const asksForExplanation = /^(what|why|how|where|do\s+you\s+think|should|can\s+you\s+explain|explain|tell\s+me|what\s+problems|what\s+makes)\b/.test(normalized);
  const discussionDomain = /\b(ai-e|aie|approval|approvals|workflow|workflows|agi|autonomous\s+coding|autonomy|guardrails?|governance|trust|different|problems|trying\s+to\s+solve|beginner|beginners|new|framing|philosophy|ethics|should\s+ai-e|development|milestone|handoff|changed|latest|options|learning|testing|test\s+next|currently|current)\b/.test(normalized);
  const operationalRequest = hasExplicitSupervisedWorkflowIntent(normalized) || hasExplicitGuidedExplorationCreateIntent(normalized);
  return asksForExplanation && discussionDomain && !operationalRequest;
}

function conversationalGuidanceMessage(): string {
  return [
    "Welcome. We can start simply.",
    "Ask what AI-E is, what changed recently, what to test next, or which area is safe to inspect when you are ready.",
    "If the conversation turns into concrete operational work, I will keep the boundaries visible.",
  ].join(" ");
}

function conversationalDiscussionMessage(prompt: string): string {
  const normalized = normalizeText(prompt).toLowerCase();
  if (/\b(currently|current|where\s+are\s+we|milestone|just\s+reach|latest\s+handoff|changed|options|from\s+here|testing\s+more|test\s+next|keep\s+learning)\b/.test(normalized)) {
    return `${currentProgressSummary} The latest milestone is active conversational continuity: turns now stack visibly, workflow cards stay separate, and long sessions can be preserved with a reviewed Continuity Memory Card.`;
  }
  if (/\bwhy\b.*\b(move|moved|away)\b.*\bagi\b|\bagi\s+framing\b/.test(normalized)) {
    return "AI-E moved away from AGI framing because the project became more grounded around supervised operational workflows instead of unrestricted autonomy. The focus is now on bounded execution, human approval, workflow continuity, recovery guidance, and operator trust. In simpler terms: AI-E is not trying to be an all-powerful autonomous coder. It is trying to be a safe operational assistant that helps humans understand, inspect, and manage complex work.";
  }
  if (/\bautonomous\s+coding\b|\ballow\s+autonomous\b/.test(normalized)) {
    return "AI-E should be cautious about autonomous coding. The useful direction is not unrestricted agents changing a project on their own; it is supervised operational help with clear scope, approval gates, validation evidence, recovery paths, and human control. Autonomy can be useful only when it is bounded, reviewable, and easy to stop.";
  }
  if (/\bwhat\s+makes\b.*\b(ai-e|aie)\b.*\bdifferent\b|\bdifferent\b.*\b(ai-e|aie)\b/.test(normalized)) {
    return "AI-E is different because it is designed around operational trust, not just chat. It can explain, guide, and prepare governed workflows, but it keeps boundaries visible: approvals matter, validation matters, blocked states are honest, and workflow controls appear only when they help the task.";
  }
  if (/\bphilosophy\b|\bbuilt\s+around\b/.test(normalized)) {
    return `${currentProgressSummary} Its philosophy is that operational AI should be supervised, understandable, and trust-aware instead of pretending to be unrestricted AGI. The center of gravity is helping a human understand complex work, choose safe next moves, and keep real execution reviewable.`;
  }
  if (/\bapprovals?\b/.test(normalized)) {
    return "Approvals are AI-E's way of separating guidance from sensitive action. A workflow can explain or prepare a safe path, but mutation-capable work should stop until the operator can review the scope, risk, next step, and validation expectation. Approval is stage-scoped; it is not unlimited permission.";
  }
  if (/\bworkflows?\b/.test(normalized)) {
    return "Workflows are governed task paths that make operational work visible. They show the current step, approval needs, validation state, blockers, and recovery options. They are useful when there is a real task to inspect, patch, validate, or resume, but ordinary product discussion does not need to become a workflow.";
  }
  if (/\bbeginners?\b|\blike\s+i'?m\s+new\b|\bi'?m\s+new\b/.test(normalized)) {
    return "Beginners should understand three things first: AI-E is supervised, workflows are optional tools for operational tasks, and governance is a safety feature rather than a failure. You can ask questions conversationally first; workflow controls appear when they help the task.";
  }
  if (/\bproblems?\b.*\btrying\s+to\s+solve\b|\bwhat\s+problems?\b/.test(normalized)) {
    return "AI-E is trying to solve the trust gap between helpful AI guidance and real operational work. It aims to make complex work understandable, bounded, reviewable, resumable, and safe enough for a human operator to stay in control.";
  }
  return `${currentProgressSummary} Some moments call for explanation, judgment, or product thinking; others call for governed work with approval, validation, and recovery paths. The useful discipline is restraint: do not turn a question into machinery unless the user is asking to inspect, change, validate, or execute something.`;
}

function guidedExplorationOfferMessage(): string {
  return "Useful places to start are approvals, workflow history, or one concrete gameplay system such as combat, inventory, enemy AI, or movement. Pick a specific area when you want a safe read-only inspection.";
}

function lightweightWorkflowMessage(prompt: string): string {
  return `I prepared a safe read-only exploration for "${prompt}" so you can learn without making changes. The workflow details are minimized first; open them when you want to see the runtime mechanics.`;
}

function fullWorkflowMessage(prompt: string): string {
  return `I routed "${prompt}" into the supervised operational workflow because it may involve implementation, repo work, validation, approval, recovery, or execution boundaries.`;
}

export function mediateAgentWorkflowPrompt(prompt: string): AgentWorkflowMediationDecision {
  const normalizedPrompt = normalizeText(prompt);
  const route = orchestrateGameDevChat(normalizedPrompt);
  const governanceBoundary = "Mediation chooses how much workflow UI to show. It does not execute commands, apply patches, run Unity, bypass approval, or create unrestricted autonomy.";

  if (isConversationalDiscussionPrompt(normalizedPrompt)) {
    return {
      prompt: normalizedPrompt,
      interactionLevel: "CONVERSATIONAL_ONLY",
      workflowVisibility: "hidden",
      shouldCreateWorkflow: false,
      route,
      assistantMessage: conversationalDiscussionMessage(normalizedPrompt),
      suggestedActions: conversationalOptionalPaths,
      escalationReason: "The prompt asks for conceptual discussion or product explanation, so conversation is the completed interaction state.",
      governanceBoundary,
    };
  }

  if (isConversationFirstRoute(route)) {
    return {
      prompt: normalizedPrompt,
      interactionLevel: "CONVERSATIONAL_GUIDANCE",
      workflowVisibility: "hidden",
      shouldCreateWorkflow: false,
      route,
      assistantMessage: conversationalGuidanceMessage(),
      suggestedActions: onboardingOptionalPaths,
      escalationReason: "Existing conversational routing identified this as orientation, capability help, or clarification rather than operational work.",
      governanceBoundary,
    };
  }

  if (isGuidedExplorationOfferPrompt(normalizedPrompt) && !hasExplicitGuidedExplorationCreateIntent(normalizedPrompt)) {
    return {
      prompt: normalizedPrompt,
      interactionLevel: "GUIDED_EXPLORATION_OFFER",
      workflowVisibility: "hidden",
      shouldCreateWorkflow: false,
      route,
      assistantMessage: guidedExplorationOfferMessage(),
      suggestedActions: [
        "Inspect the combat system",
        "Review enemy AI behavior",
        "Explain approvals and safe workflows",
      ],
      escalationReason: "The prompt asks for recommendations before choosing a specific operational target, so AI-E should offer options without creating runtime state.",
      governanceBoundary,
    };
  }

  if (isOperationalRoute(route) || hasExplicitSupervisedWorkflowIntent(normalizedPrompt) || hasOperationalWorkflowSignals(normalizedPrompt)) {
    return {
      prompt: normalizedPrompt,
      interactionLevel: "FULL_SUPERVISED_OPERATIONAL",
      workflowVisibility: "full",
      shouldCreateWorkflow: true,
      route,
      assistantMessage: fullWorkflowMessage(normalizedPrompt),
      suggestedActions: [
        "Review the active workflow step",
        "Check approval and validation requirements",
        "Inspect technical details only when needed",
      ],
      escalationReason: "The request has operational signals that warrant visible supervised workflow state.",
      governanceBoundary,
    };
  }

  if (hasExplicitGuidedExplorationCreateIntent(normalizedPrompt)) {
    return {
      prompt: normalizedPrompt,
      interactionLevel: "LIGHTWEIGHT_GUIDED_WORKFLOW",
      workflowVisibility: "minimal",
      shouldCreateWorkflow: true,
      route,
      assistantMessage: lightweightWorkflowMessage(normalizedPrompt),
      suggestedActions: [
        "Read the short guidance first",
        "Run the read-only step when useful",
        "Open workflow details if you want the runtime trace",
      ],
      escalationReason: "The request asks AI-E to inspect or analyze a concrete operational target, so a minimized read-only workflow is appropriate.",
      governanceBoundary,
    };
  }

  return {
    prompt: normalizedPrompt,
    interactionLevel: "CONVERSATIONAL_ONLY",
    workflowVisibility: "hidden",
    shouldCreateWorkflow: false,
    route,
    assistantMessage: conversationalDiscussionMessage(normalizedPrompt),
    suggestedActions: conversationalOptionalPaths,
    escalationReason: "No explicit operational inspection or supervised work request was detected, so the prompt remains conversational-only.",
    governanceBoundary,
  };
}
