export type ConversationalCommandRoute = "clarify" | "plan" | "review" | "block";

export type OperatorDashboardChatMessageRole = "operator" | "ai-e" | "system";

export type OperatorDashboardChatMessageKind = "input" | "response" | "summary" | "notice";

export type OperatorDashboardChatMessage = {
  message_id: string;
  role: OperatorDashboardChatMessageRole;
  kind: OperatorDashboardChatMessageKind;
  content: string;
  created_at: string;
};

export type OperatorDashboardChatOption = {
  option_id: string;
  label: string;
  description: string;
  option_kind: "follow_up" | "summary" | "archive" | "proposal";
};

export type OperatorDashboardChatProposal = {
  proposal_id: string;
  title: string;
  summary: string;
  route: ConversationalCommandRoute;
  planner_ready_request: string | null;
  requires_operator_review: boolean;
  safe_to_execute: false;
};

export type OperatorDashboardConversationalSession = {
  session_id: string;
  status: "idle" | "awaiting_operator_input" | "awaiting_operator_choice" | "proposal_ready" | "archived";
  messages: OperatorDashboardChatMessage[];
  pending_options: OperatorDashboardChatOption[];
  latest_proposal: OperatorDashboardChatProposal | null;
  last_readiness_status: string | null;
  last_refinement_summary: string | null;
  last_summary: string | null;
  operator_notice: string;
  archived_at: string | null;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "chat";
}

export function createChatMessageId(sessionId: string, createdAt: string, seed: string): string {
  const timestamp = createdAt.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  return `chat-message-${sessionId}-${timestamp}-${slugify(seed)}`;
}

export function createChatOptionId(sessionId: string, index: number, label: string): string {
  return `chat-option-${sessionId}-${index + 1}-${slugify(label)}`;
}

export function createChatProposalId(sessionId: string, createdAt: string, route: ConversationalCommandRoute): string {
  const timestamp = createdAt.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  return `chat-proposal-${sessionId}-${route}-${timestamp}`;
}

export function createInitialConversationalSession(
  createdAt: string,
  sessionId = "operator-chat-session",
): OperatorDashboardConversationalSession {
  return {
    session_id: sessionId,
    status: "awaiting_operator_input",
    messages: [{
      message_id: createChatMessageId(sessionId, createdAt, "welcome"),
      role: "ai-e",
      kind: "notice",
      content: "AI-E Chat can clarify intent, propose a safe next route, and summarize bounded options. It does not execute work directly.",
      created_at: createdAt,
    }],
    pending_options: [],
    latest_proposal: null,
    last_readiness_status: null,
    last_refinement_summary: null,
    last_summary: null,
    operator_notice: "The chat layer is a receptionist, not the CEO.",
    archived_at: null,
  };
}