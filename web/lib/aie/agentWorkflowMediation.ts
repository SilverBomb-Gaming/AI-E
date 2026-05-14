import { orchestrateGameDevChat } from "./gameDevChat/gameDevConversationalOrchestrator";
import type { GameDevChatRoute } from "./gameDevChat/gameDevChatTypes";
import { buildSemanticGroundedConversationFrame } from "./semanticGrounding";

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

export type AgentWorkflowMediationContextTurn = {
  prompt: string;
  response: string;
  kind?: string;
};

export type AgentWorkflowMediationContext = {
  recentTurns?: AgentWorkflowMediationContextTurn[];
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
  return /\b(patch|repo|repository|validate|validation|verify|build|execute|execution|apply|mutation|rollback|runtime|handoff|supervised|implement|implementation|modify|change|fix|increase|spawn|update|adjust|configure|generate\s+(a\s+)?proposed|prepare\s+(a\s+)?safe|prepare\s+(a\s+)?rollback)\b/.test(normalized)
    || hasConcreteGameDevTaskIntent(normalized);
}

function hasConcreteGameDevTaskIntent(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  const gameDomain = /\b(babylon|game|gameplay|gameplay\s+loop|game\s+loop|rounds?|waves?|zombies?|enemies?|enemy|spawner|spawn|health|combat|inventory|movement|player|level|boss|npc)\b/.test(normalized);
  const changeIntent = /\b(i\s+need\s+you\s+to|take\s+a\s+look|have\s+the\s+gameplay\s+loop|modify|update|fix|implement|increase|spawn|make|adjust|configure|change|prepare\s+a\s+patch|reach\s+round|creates?\s+\d+|set\s+.*\bto\s+\d+)\b/.test(normalized);
  const numericGameplayTarget = /\b(round|wave|spawn|zombies?|health)\b.{0,30}\b\d+\b|\b\d+\b.{0,30}\b(round|wave|spawn|zombies?|health)\b/.test(normalized);
  return gameDomain && changeIntent && (numericGameplayTarget || /\b(modify|update|fix|implement|increase|spawn|adjust|configure|change|patch)\b/.test(normalized));
}

function hasExplicitSupervisedWorkflowIntent(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  const conceptualSemanticQuestion = /^\s*(what|why|how|do|does|is|are)\b/.test(normalized)
    && /\b(semantic|grounding|conversation|conversational|ontology|wordnet|second\s+brain|lexical)\b/.test(normalized);
  if (conceptualSemanticQuestion) {
    return false;
  }
  return /\b(prepare|generate|implement|modify|change|apply|validate|verify|run|execute|fix|patch|rollback|build)\b/.test(normalized)
    && /\b(patch|fix|implementation|improvement|change|repo|repository|validation|verify|build|rollback|apply|execute|run|movement|combat|code|files?|game|gameplay|zombies?|spawn|health|rounds?)\b/.test(normalized)
    || hasConcreteGameDevTaskIntent(normalized);
}

function hasExplicitGuidedExplorationCreateIntent(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  const asksToInvestigate = /\b(inspect|review|analy[sz]e|look\s+into|investigate|explore)\b/.test(normalized)
    || /\bhelp\s+me\s+(inspect|review|analy[sz]e|look\s+into|investigate|explore|understand)\b/.test(normalized);
  const hasConcreteTarget = /\b(system|combat|inventory|enemy\s+ai|ai\s+behavior|balance|movement|responsiveness|project|code|scene|workflow|runtime|approval|feature|mechanic|bug|problem|issues?|game|gameplay|gameplay\s+loop|rounds?|waves?|zombies?|spawner|spawn|health)\b/.test(normalized);
  const isOnlyAskingForSuggestions = /\b(what|where|which|recommend|suggest|should\s+i|could\s+i)\b.*\b(explore|inspect|start|look\s+at|learn)\b/.test(normalized)
    && !/^\s*(inspect|review|analy[sz]e|look\s+into|investigate|explore|help\s+me\s+(inspect|review|analy[sz]e|look\s+into|investigate|explore|understand))\b/i.test(normalized);
  return asksToInvestigate && hasConcreteTarget && !isOnlyAskingForSuggestions;
}

function hasConcreteGameDevExplorationIntent(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  const asksForReadOnlyUnderstanding = /\b(show\s+me\s+where|help\s+me\s+understand|help\s+me\s+inspect|inspect|review|look\s+at|look\s+into|find|locate)\b/.test(normalized);
  const gameTarget = /\b(gameplay\s+loop|game\s+loop|zombie\s+spawning|zombies?|enemy\s+spawner|spawner|round\s+system|combat\s+system|inventory\s+system|movement\s+system|babylon\s+game)\b/.test(normalized);
  return asksForReadOnlyUnderstanding && gameTarget && !hasConcreteGameDevTaskIntent(normalized);
}

function isWorkflowSimulationPrompt(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  return /\b(dummy|demo|simulate|simulated|simulation|tutorial)\b.*\b(workflow|progress|completion|lifecycle)\b|\b(progress\s+bar|completion\s+state|ux\s+test)\b/.test(normalized);
}

function isGuidedExplorationOfferPrompt(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  return /\b(what|where|which|recommend|suggest|should\s+i|could\s+i)\b.*\b(explore|inspect|start|look\s+at|learn|understand)\b/.test(normalized)
    || /\bwhat\s+would\s+you\s+recommend\s+i\s+explore\s+first\b/.test(normalized)
    || /\bwhat\s+should\s+beginners?\s+understand\s+first\b/.test(normalized);
}

function isConversationalDiscussionPrompt(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  const asksForExplanation = /^(what|why|how|where|do|does|is|are|should|can\s+you\s+explain|explain|tell\s+me|what\s+problems|what\s+makes)\b/.test(normalized);
  const discussionDomain = /\b(ai-e|aie|ai\s+agents?|agents?|developers?|approval|approvals|workflow|workflows|conversation|conversational|semantic|grounding|second\s+brain|ontology|wordnet|lexical|agi|autonomous\s+coding|autonomy|automate|automation|guardrails?|governance|trust|different|fake|overhyped|hype|anthropomorphi[sz]e|branding|innovation|problems|trying\s+to\s+solve|beginner|beginners|new|framing|philosophy|ethics|should\s+ai-e|development|milestone|handoff|changed|latest|options|learning|testing|test\s+next|currently|current)\b/.test(normalized);
  const operationalRequest = hasExplicitSupervisedWorkflowIntent(normalized) || hasExplicitGuidedExplorationCreateIntent(normalized);
  return asksForExplanation && discussionDomain && !operationalRequest;
}

function isConversationalAuthenticityPrompt(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  return /\b(worries?|worry|trust|fake|overhyped|hype|anthropomorphi[sz]e|hardest\s+design\s+problem|damaged\s+trust|approvals?\s+slow\s+innovation|never\s+automate)\b/.test(normalized)
    && /\b(ai|agents?|developers?|people|agi|approvals?|automate|automation|design|trust|innovation|branding)\b/.test(normalized);
}

function recentConversationText(context?: AgentWorkflowMediationContext): string {
  return (context?.recentTurns ?? [])
    .slice(-4)
    .map((turn) => `${turn.prompt} ${turn.response}`)
    .join(" ")
    .toLowerCase();
}

function isContextualContinuationPrompt(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  return /\b(where\s+should\s+the\s+balance\s+(actually\s+)?be|what\s+is\s+the\s+right\s+balance|what\s+should\s+the\s+balance\s+be|what\s+do\s+you\s+actually\s+think|what'?s\s+your\s+actual\s+take|so\s+where\s+do\s+you\s+land|given\s+that|given\s+all\s+that)\b/.test(normalized);
}

function buildContextualProgressionMessage(prompt: string, context?: AgentWorkflowMediationContext): string | null {
  if (!isContextualContinuationPrompt(prompt)) {
    return null;
  }
  const recentText = recentConversationText(context);
  if (!recentText) {
    return null;
  }
  if (/\b(semantic\s+grounding|operational\s+ontology|contextual\s+retrieval|lexical|fallback\s+loop|doctrine\s+loop|semantic\s+stability|conceptual\s+branch)/.test(recentText)) {
    return "The balance should be that semantic grounding stays mostly infrastructural, not theatrical. It should quietly give the conversation better concepts, cleaner vocabulary, and more ways to continue a thought, while the assistant still has to synthesize, judge, and answer the user's actual follow-up. If the layer keeps announcing semantic grounding, it has failed conversationally; if it disappears into better progression, it is working. The practical center is: enough ontology to prevent drift and repetition, enough retrieval to recover the thread, and enough restraint that the conversation keeps moving forward instead of reciting its own architecture.";
  }
  if (/\b(visual\s+continuity|stacked\s+history|auto-scroll|bottom\s+input|timeline|conversation\s+continuity|active\s+conversation)/.test(recentText)) {
    return "The balance should be visual continuity first, intellectual continuity next. The timeline should make the user feel the thread is still present, but the response itself has to prove it by synthesizing the prior exchange, taking a position, and moving the idea forward. A stacked chat log is only the container; progression is the conversation doing new work inside that container.";
  }
  return "The balance should be to treat the previous turn as context, not as a script to repeat. A good follow-up answer should compress what was already established, take a clearer position, and open the next useful angle instead of restating the same frame with slightly different words.";
}

function conversationalAuthenticityMessage(prompt: string): string {
  const normalized = normalizeText(prompt).toLowerCase();
  const semanticFrame = buildSemanticGroundedConversationFrame(normalized);
  if (/\bfake\b/.test(normalized)) {
    return `Most AI agents feel fake when their performance is too smooth for their actual understanding. They sound certain before they have earned certainty, act cheerful when the situation needs judgment, and imply continuity they do not really have. The fakest moment is usually not a factual mistake; it is when the agent performs agency without showing the limits, memory, stakes, or hesitation that would make the interaction feel inhabited. ${semanticFrame.sentence}`;
  }
  if (/\bworries?|worry\b/.test(normalized)) {
    return "What worries me most is not that AI agents will be useless or magical. It is that they can become convincing enough to absorb responsibility without being accountable enough to deserve it. A system can sound calm, decisive, and helpful while quietly losing the thread, flattening uncertainty, or nudging a human to trust momentum instead of evidence.";
  }
  if (/\bdevelopers?\b.*\btrust\b|\btrust\b.*\btoo\s+quickly\b/.test(normalized)) {
    return "Yes, sometimes developers trust AI too quickly, but usually for understandable reasons: the first answer is fast, plausible, and shaped like progress. The danger is that plausibility feels like verification when you are tired or moving quickly. Healthy trust should build from small checks: does it understand the codebase, preserve constraints, admit uncertainty, and survive validation?";
  }
  if (/\boperational\s+trust\b|\btrust\b.*\bdifficult\b/.test(normalized)) {
    return "Operational trust is difficult because it is not just about whether an answer sounds smart. It is about whether the system behaves predictably under pressure: when context is incomplete, when a task is risky, when the user is impatient, when evidence conflicts, and when stopping is the responsible move. Trust is built in those awkward moments, not in the polished demo path.";
  }
  if (/\bhardest\s+design\s+problem\b|\bdesign\s+problem\b/.test(normalized)) {
    return "The hardest design problem is making the system feel present without pretending to be more than it is. Too little personality feels like a form. Too much personality feels theatrical. The sweet spot is an assistant that can reason, remember the working thread, push back gently, and still make its limits feel ordinary instead of dramatic.";
  }
  if (/\boverhyped|hype\b/.test(normalized)) {
    return "The most overhyped AI trend is the idea that more autonomy automatically means more value. In practice, the valuable part is often judgment: knowing what to ask, what to verify, what not to touch, and when to slow down. Autonomy without taste and restraint mostly creates faster messes.";
  }
  if (/\banthropomorphi[sz]e\b/.test(normalized)) {
    return "People anthropomorphize AI because conversation is an intimacy-shaped interface. When something answers with timing, memory-like references, confidence, and warmth, our social instincts fill in the rest. That does not mean the system is secretly humanlike; it means language is powerful enough to trigger human expectations before the evidence catches up.";
  }
  if (/\bnever\s+automate\b|\bintentionally\s+never\b/.test(normalized)) {
    return "AI-E should probably never automate judgment that belongs to the operator: approving risky changes, deciding acceptable harm, hiding uncertainty for convenience, or turning a vague goal into irreversible action. The interesting boundary is not can this be automated, but should a human still have to mean it?";
  }
  if (/\bagi\b.*\btrust\b|\bbranding\b.*\btrust\b/.test(normalized)) {
    return "AGI branding probably did damage trust because it trained people to listen for grand capability claims instead of asking what the system can reliably do today. It also made ordinary useful AI feel less impressive than it is. A grounded tool that knows its lane can be more trustworthy than a system marketed as almost-everything.";
  }
  if (/\bapprovals?\b.*\bslow\b.*\binnovation\b/.test(normalized)) {
    return "Approvals can slow innovation when they become ritual instead of judgment. But the better question is where friction belongs. If approval prevents reversible learning, it is probably too heavy. If it prevents silent risky action, it is part of the creative infrastructure, because people can explore more boldly when the dangerous edges are explicit.";
  }
  return "The interesting part is the tension between fluency and groundedness. AI can sound like it understands before it has done the slower work of tracking context, uncertainty, consequence, and responsibility. Better agent design has to make that slower work visible in the rhythm of the conversation, not just in policy language around it.";
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
  if (isConversationalAuthenticityPrompt(normalized)) {
    return conversationalAuthenticityMessage(normalized);
  }
  if (/\b(currently|current|where\s+are\s+we|milestone|just\s+reach|latest\s+handoff|changed|options|from\s+here|testing\s+more|test\s+next|keep\s+learning|trying\s+to\s+become|kind\s+of\s+ai\s+system)\b/.test(normalized)) {
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
  const semanticFrame = buildSemanticGroundedConversationFrame(normalized);
  return `${semanticFrame.sentence} ${semanticFrame.boundary}`;
}

function conversationalDiscussionActions(prompt: string): string[] {
  const semanticFrame = buildSemanticGroundedConversationFrame(prompt);
  return semanticFrame.followUpDirections.length > 0 ? semanticFrame.followUpDirections : conversationalOptionalPaths;
}

function guidedExplorationOfferMessage(): string {
  return "Useful places to start are approvals, workflow history, or one concrete gameplay system such as combat, inventory, enemy AI, or movement. Pick a specific area when you want a safe read-only inspection.";
}

function lightweightWorkflowMessage(prompt: string): string {
  return `I prepared a safe read-only exploration for "${prompt}" so you can learn without making changes. The workflow details are minimized first; open them when you want to see the runtime mechanics.`;
}

function fullWorkflowMessage(prompt: string): string {
  if (isWorkflowSimulationPrompt(prompt)) {
    return `I prepared "${prompt}" as a simulated demo workflow so the progress bar, pacing, and completion state can be tested without treating it like production execution.`;
  }
  if (hasConcreteGameDevTaskIntent(prompt)) {
    return `I will treat "${prompt}" as a supervised game-dev workflow: inspect the relevant gameplay files, identify the loop/spawn/health logic, prepare a scoped change plan, and keep validation evidence explicit before claiming success.`;
  }
  return `I routed "${prompt}" into the supervised operational workflow because it may involve implementation, repo work, validation, approval, recovery, or execution boundaries.`;
}

export function mediateAgentWorkflowPrompt(prompt: string, context: AgentWorkflowMediationContext = {}): AgentWorkflowMediationDecision {
  const normalizedPrompt = normalizeText(prompt);
  const route = orchestrateGameDevChat(normalizedPrompt);
  const governanceBoundary = "Mediation chooses how much workflow UI to show. It does not execute commands, apply patches, run Unity, bypass approval, or create unrestricted autonomy.";
  const contextualProgressionMessage = buildContextualProgressionMessage(normalizedPrompt, context);

  if (contextualProgressionMessage) {
    return {
      prompt: normalizedPrompt,
      interactionLevel: "CONVERSATIONAL_ONLY",
      workflowVisibility: "hidden",
      shouldCreateWorkflow: false,
      route,
      assistantMessage: contextualProgressionMessage,
      suggestedActions: [
        "Test another follow-up",
        "Ask for the strongest counterpoint",
        "Apply this to AI-E behavior",
        "Turn the insight into an improvement request",
      ],
      escalationReason: "The prompt is an implicit continuation of the active conversation, so AI-E should synthesize the prior thread instead of restarting a generic conceptual frame.",
      governanceBoundary,
    };
  }

  if (isConversationalDiscussionPrompt(normalizedPrompt)) {
    const isAuthenticityDiscussion = isConversationalAuthenticityPrompt(normalizedPrompt);
    return {
      prompt: normalizedPrompt,
      interactionLevel: "CONVERSATIONAL_ONLY",
      workflowVisibility: "hidden",
      shouldCreateWorkflow: false,
      route,
      assistantMessage: conversationalDiscussionMessage(normalizedPrompt),
      suggestedActions: isAuthenticityDiscussion ? conversationalDiscussionActions(normalizedPrompt) : conversationalOptionalPaths,
      escalationReason: "The prompt asks for conceptual discussion or product explanation, so conversation is the completed interaction state.",
      governanceBoundary,
    };
  }

  if (hasConcreteGameDevExplorationIntent(normalizedPrompt)) {
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
      escalationReason: "The request asks to locate or understand a concrete game-development system, so AI-E should create a minimized read-only exploration instead of answering as product philosophy.",
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
    const isSimulation = isWorkflowSimulationPrompt(normalizedPrompt);
    return {
      prompt: normalizedPrompt,
      interactionLevel: "FULL_SUPERVISED_OPERATIONAL",
      workflowVisibility: "full",
      shouldCreateWorkflow: true,
      route,
      assistantMessage: fullWorkflowMessage(normalizedPrompt),
      suggestedActions: isSimulation
        ? [
          "Watch simulated progress",
          "Confirm completion state",
          "Ask what felt static",
        ]
        : [
          "Review the active workflow step",
          "Check approval and validation requirements",
          "Inspect technical details only when needed",
        ],
      escalationReason: isSimulation
        ? "The request asks for a harmless workflow demo, so AI-E should create visible workflow state with simulated progression rather than real execution authority."
        : "The request has operational signals that warrant visible supervised workflow state.",
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
    suggestedActions: isConversationalAuthenticityPrompt(normalizedPrompt) ? conversationalDiscussionActions(normalizedPrompt) : conversationalOptionalPaths,
    escalationReason: "No explicit operational inspection or supervised work request was detected, so the prompt remains conversational-only.",
    governanceBoundary,
  };
}
