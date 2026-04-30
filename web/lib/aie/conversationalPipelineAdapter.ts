import { processConversationalCommand } from "./conversationalCommand";
import type { ConversationalRefinementRequest } from "./conversationalIntentRefinement";
import {
  createChatMessageId,
  createInitialConversationalSession,
  type OperatorDashboardConversationalSession,
} from "./conversationalSessionState";

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

export type ApplyChatMessageInput = {
  session: OperatorDashboardConversationalSession | null | undefined;
  messageText: string;
  createdAt: string;
  requestContext?: Omit<ConversationalRefinementRequest, "rawRequest">;
};

export function applyChatMessageToSession(input: ApplyChatMessageInput): OperatorDashboardConversationalSession {
  const messageText = normalizeText(input.messageText);
  const baseSession = input.session
    ? {
      ...input.session,
      messages: [...input.session.messages],
      pending_options: [...input.session.pending_options],
      latest_proposal: input.session.latest_proposal ? { ...input.session.latest_proposal } : null,
    }
    : createInitialConversationalSession(input.createdAt);

  const nextSessionId = baseSession.session_id;
  const operatorMessage = {
    message_id: createChatMessageId(nextSessionId, input.createdAt, `operator-${messageText}`),
    role: "operator" as const,
    kind: "input" as const,
    content: messageText,
    created_at: input.createdAt,
  };

  const commandResult = processConversationalCommand({
    rawRequest: messageText,
    ...(input.requestContext ?? {}),
  }, nextSessionId, input.createdAt);

  const assistantMessage = {
    message_id: createChatMessageId(nextSessionId, input.createdAt, `aie-${commandResult.decision.route}`),
    role: "ai-e" as const,
    kind: "response" as const,
    content: commandResult.response.assistant_message,
    created_at: input.createdAt,
  };

  return {
    ...baseSession,
    status: commandResult.response.options.length > 0
      ? "awaiting_operator_choice"
      : commandResult.response.proposal
        ? "proposal_ready"
        : "awaiting_operator_input",
    messages: [...baseSession.messages, operatorMessage, assistantMessage],
    pending_options: commandResult.response.options,
    latest_proposal: commandResult.response.proposal,
    last_readiness_status: commandResult.decision.readiness.status,
    last_refinement_summary: commandResult.decision.readiness.explanation,
    operator_notice: commandResult.decision.operator_notice,
    archived_at: null,
  };
}

export function applyChatOptionSelection(
  session: OperatorDashboardConversationalSession,
  optionId: string,
  createdAt: string,
): OperatorDashboardConversationalSession | null {
  const selected = session.pending_options.find((option) => option.option_id === optionId) ?? null;
  if (!selected) {
    return null;
  }

  const notice = selected.option_kind === "summary"
    ? "Use Request Chat Summary to capture the current bounded routing result."
    : selected.option_kind === "archive"
      ? "Use Archive Session to close this chat lane explicitly."
      : `Selected option: ${selected.description}`;

  return {
    ...session,
    messages: [...session.messages, {
      message_id: createChatMessageId(session.session_id, createdAt, `option-${selected.option_id}`),
      role: "system",
      kind: "notice",
      content: notice,
      created_at: createdAt,
    }],
    operator_notice: notice,
    status: selected.option_kind === "archive" ? "awaiting_operator_choice" : session.status,
  };
}

export function summarizeChatSession(session: OperatorDashboardConversationalSession): string {
  const latestOperatorMessage = [...session.messages].reverse().find((message) => message.role === "operator")?.content ?? "No operator message recorded.";
  const latestAssistantMessage = [...session.messages].reverse().find((message) => message.role === "ai-e")?.content ?? "No AI-E response recorded.";
  const proposalLine = session.latest_proposal
    ? `Latest proposal: ${session.latest_proposal.title}. ${session.latest_proposal.summary}`
    : "No planner-ready proposal is currently recorded.";

  return [
    `Latest operator request: ${latestOperatorMessage}`,
    `Latest AI-E routing response: ${latestAssistantMessage}`,
    proposalLine,
    `Operator notice: ${session.operator_notice}`,
    "Chat remains advisory only and does not execute runtime work.",
  ].join(" ");
}