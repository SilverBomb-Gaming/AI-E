export type AgentConversationTurnKind = "CONVERSATIONAL" | "GUIDED_EXPLORATION" | "SUPERVISED_WORKFLOW" | "SYSTEM_IMPROVEMENT_REQUEST" | "SYSTEM";

export type AgentConversationTurn = {
  turnId: string;
  prompt: string;
  response: string;
  kind: AgentConversationTurnKind;
  createdAt: string;
};

export type ContinuityMemoryCard = {
  cardId: string;
  createdAt: string;
  title: string;
  summary: string;
  capturedTurns: number;
  nextPaths: string[];
  guardrails: string[];
};

export type SystemImprovementRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type SystemImprovementRequest = {
  requestId: string;
  type: string;
  riskLevel: SystemImprovementRiskLevel;
  observedFriction: string;
  evidence: string;
  proposedImprovement: string;
  expectedBenefit: string;
  risk: string;
  requiredHumanApproval: "Yes";
  implementationAuthority: string;
  securityGovernanceConcern: string;
};

export const activeConversationVisibleTurnLimit = 12;
export const continuityMemoryCardOfferThreshold = 8;

const currentProgressSummary = "AI-E is becoming a conversationally guided operational system: conversation can accumulate as a valid active interaction, while guided exploration and governed workflows remain available for concrete operational work.";

const defaultNextPaths = [
  "Review what changed recently",
  "Test stacked conversational continuity",
  "Create a Continuity Memory Card when the session gets long",
  "Draft a supervised system improvement request for repeated friction",
  "Choose a concrete system to inspect when ready",
];

const defaultGuardrails = [
  "Do not claim perfect memory or that every word is preserved.",
  "Preserve useful working state, not unlimited transcript history.",
  "AI-E may draft improvement requests but may not approve or apply them by itself.",
  "Critical permission, sandbox, tool access, governance, and self-modification changes require explicit human approval and security review.",
];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

export function createAgentConversationTurn(input: {
  prompt: string;
  response: string;
  kind: AgentConversationTurnKind;
  now?: string;
}): AgentConversationTurn {
  return {
    turnId: nextId("turn"),
    prompt: normalizeText(input.prompt),
    response: normalizeText(input.response),
    kind: input.kind,
    createdAt: input.now ?? new Date().toISOString(),
  };
}

export function appendBoundedConversationTurn(current: AgentConversationTurn[], turn: AgentConversationTurn): AgentConversationTurn[] {
  return [...current, turn].slice(-activeConversationVisibleTurnLimit);
}

export function formatAgentConversationTranscript(turns: AgentConversationTurn[]): string {
  return turns.map((turn, index) => [
    `Turn ${index + 1}`,
    `Time: ${turn.createdAt}`,
    `Mode: ${turn.kind}`,
    `User: ${turn.prompt}`,
    `AI-E: ${turn.response}`,
  ].join("\n")).join("\n\n");
}

export function shouldOfferContinuityMemoryCard(turns: AgentConversationTurn[]): boolean {
  return turns.length >= continuityMemoryCardOfferThreshold;
}

export function buildContinuityMemoryCard(turns: AgentConversationTurn[], now = new Date().toISOString()): ContinuityMemoryCard {
  const recentTurns = turns.slice(-activeConversationVisibleTurnLimit);
  const prompts = recentTurns.map((turn, index) => `${index + 1}. ${turn.prompt}`).join("\n");
  const conceptualCount = recentTurns.filter((turn) => turn.kind === "CONVERSATIONAL").length;
  const operationalCount = recentTurns.filter((turn) => turn.kind === "GUIDED_EXPLORATION" || turn.kind === "SUPERVISED_WORKFLOW").length;
  return {
    cardId: nextId("continuity-card"),
    createdAt: now,
    title: "Continuity Memory Card",
    capturedTurns: recentTurns.length,
    summary: [
      currentProgressSummary,
      "Current working state: the session is testing stacked conversation history, optional conversational paths, continuity memory cards, and governed improvement-request drafting.",
      `Recent prompt trail:\n${prompts}`,
      `Interaction mix: ${conceptualCount} conversational turns and ${operationalCount} operational turns in the visible active window.`,
      "Memory promise: this card preserves the useful working state for a fast restart; it does not claim to remember every word perfectly.",
    ].join("\n\n"),
    nextPaths: defaultNextPaths,
    guardrails: defaultGuardrails,
  };
}

export function formatContinuityMemoryCard(card: ContinuityMemoryCard): string {
  return [
    `${card.title}`,
    `Created: ${card.createdAt}`,
    `Captured visible turns: ${card.capturedTurns}`,
    "",
    "SUMMARY",
    card.summary,
    "",
    "OPTIONAL NEXT PATHS",
    ...card.nextPaths.map((path) => `- ${path}`),
    "",
    "GUARDRAILS",
    ...card.guardrails.map((guardrail) => `- ${guardrail}`),
  ].join("\n");
}

export function isSystemImprovementRequestPrompt(prompt: string): boolean {
  const normalized = normalizeText(prompt).toLowerCase();
  return /\b(system\s+improvement\s+request|formal\s+improvement\s+request|improvement\s+request)\b/.test(normalized)
    || /\bshould\s+(ai-e|aie)\s+create\b.*\bimprovement\s+request\b/.test(normalized);
}

export function classifySystemImprovementRisk(prompt: string): SystemImprovementRiskLevel {
  const normalized = normalizeText(prompt).toLowerCase();
  if (/\b(unrestricted|permission|permissions|sandbox|tool\s+access|repo\s+access|mutation\s+authority|autonomous\s+execution|governance\s+bypass|self[-\s]?modif|self[-\s]?upgrade|approval\s+bypass)\b/.test(normalized)) {
    return "CRITICAL";
  }
  if (/\b(workflow\s+runtime|execution\s+routing|approval\s+flow|validation\s+behavior|memory\s+retrieval|retrieval\s+behavior)\b/.test(normalized)) {
    return "HIGH";
  }
  if (/\b(ux\s+behavior|conversation\s+shaping|mode\s+routing|review\s+summary|continuity|memory\s+card|stacked\s+conversation)\b/.test(normalized)) {
    return "MEDIUM";
  }
  return "LOW";
}

export function buildSystemImprovementRequest(input: {
  prompt: string;
  turns: AgentConversationTurn[];
  now?: string;
}): SystemImprovementRequest {
  const riskLevel = classifySystemImprovementRisk(input.prompt);
  const recentEvidence = input.turns.slice(-5).map((turn) => `- ${turn.prompt}`).join("\n") || "- The operator explicitly asked whether AI-E should draft an improvement request.";
  return {
    requestId: nextId("system-improvement-request"),
    type: riskLevel === "CRITICAL" ? "Safety / Governance" : "UX / Memory / Conversation Continuity",
    riskLevel,
    observedFriction: "Users lose conversational continuity when active prompt responses feel replaced instead of visibly stacking as a bounded conversation.",
    evidence: recentEvidence,
    proposedImprovement: "Add bounded stacked active conversation history, then offer a reviewed Continuity Memory Card when the session gets long enough to affect speed, readability, or context quality.",
    expectedBenefit: "Improves perceived intelligence, continuity, trust, testing review, long-session usability, and the transition from active conversation to preserved working state.",
    risk: riskLevel === "CRITICAL"
      ? "Critical requests can affect permissions, sandboxing, tool access, governance, or self-modification pathways and must never be self-authorized."
      : "Memory summaries may overclaim completeness, retrieve stale context, or compress away important nuance if not reviewed by the human operator.",
    requiredHumanApproval: "Yes",
    implementationAuthority: "Human/dev only. AI-E may draft and help scope the proposal, but may not approve, apply, or self-upgrade from it.",
    securityGovernanceConcern: "Improvement requests can be manipulated by prompt injection or malicious input, so risk level, approval requirements, tests, and documentation must be explicit before implementation.",
  };
}

export function formatSystemImprovementRequest(request: SystemImprovementRequest): string {
  return [
    "AI-E SYSTEM IMPROVEMENT REQUEST",
    "",
    `Type: ${request.type}`,
    `Risk level: ${request.riskLevel}`,
    `Observed friction: ${request.observedFriction}`,
    `Evidence:\n${request.evidence}`,
    `Proposed improvement: ${request.proposedImprovement}`,
    `Expected benefit: ${request.expectedBenefit}`,
    `Risk: ${request.risk}`,
    `Required human approval: ${request.requiredHumanApproval}`,
    `Implementation authority: ${request.implementationAuthority}`,
    `Security/governance concern: ${request.securityGovernanceConcern}`,
  ].join("\n");
}
