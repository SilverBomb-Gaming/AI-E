import type { ConversationalIntentRouteDecision } from "./conversationalIntentRouter";
import {
  createChatOptionId,
  createChatProposalId,
  type OperatorDashboardChatOption,
  type OperatorDashboardChatProposal,
} from "./conversationalSessionState";
import { deriveProductionPipelinePlan } from "./productionPipelineFoundation";

export type ConversationalResponse = {
  assistant_message: string;
  options: OperatorDashboardChatOption[];
  proposal: OperatorDashboardChatProposal | null;
};

export function buildConversationalResponse(
  decision: ConversationalIntentRouteDecision,
  sessionId: string,
  createdAt: string,
): ConversationalResponse {
  const { readiness, route } = decision;
  const requestText = readiness.planner_ready_request?.rawRequest ?? readiness.interpreted_intent;
  const productionPipelinePlan = deriveProductionPipelinePlan(requestText, route);
  const proposal = readiness.planner_ready_request
    ? {
      proposal_id: createChatProposalId(sessionId, createdAt, route),
      title: route === "plan"
        ? "Proposed safe planning intake"
        : route === "review"
          ? "Proposed operator review intake"
          : route === "clarify"
            ? "Clarification-first intake"
            : "Blocked unsafe intake",
      summary: readiness.explanation,
      route,
      planner_ready_request: readiness.planner_ready_request.rawRequest,
      requires_operator_review: route !== "plan",
      safe_to_execute: false,
      production_pipeline_plan: productionPipelinePlan,
    }
    : null;

  const followUpOptions = readiness.refinement_result.follow_up_questions.slice(0, 2).map((question, index) => ({
    option_id: createChatOptionId(sessionId, index, question),
    label: route === "clarify" ? `Clarify: ${index + 1}` : `Review: ${index + 1}`,
    description: question,
    option_kind: "follow_up" as const,
  }));

  const options: OperatorDashboardChatOption[] = [
    ...followUpOptions,
    {
      option_id: createChatOptionId(sessionId, followUpOptions.length, "Request summary"),
      label: "Request Summary",
      description: "Capture the current chat interpretation and bounded routing recommendation.",
      option_kind: "summary",
    },
    {
      option_id: createChatOptionId(sessionId, followUpOptions.length + 1, "Archive session"),
      label: "Archive Session",
      description: "Close the current chat session without executing any work.",
      option_kind: "archive",
    },
  ];

  const assistantMessage = route === "plan"
    ? `AI-E can route this toward planning: ${requestText}. ${productionPipelinePlan ? `Production domains: ${productionPipelinePlan.domains.join(", ")}. ` : ""}Operator approval is still required before any planning or execution step.`
    : route === "review"
      ? `AI-E has a bounded interpretation, but it still needs operator review: ${readiness.explanation}${productionPipelinePlan ? ` Production pipeline planning stays advisory for ${productionPipelinePlan.domains.join(", ")}.` : ""}`
      : route === "clarify"
        ? `AI-E needs one narrower detail before routing this safely: ${readiness.refinement_result.follow_up_questions[0] ?? readiness.explanation}`
        : `AI-E is blocking this request: ${readiness.explanation}`;

  return {
    assistant_message: assistantMessage,
    options,
    proposal,
  };
}