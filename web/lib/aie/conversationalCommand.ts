import type { ConversationalRefinementRequest } from "./conversationalIntentRefinement";
import { buildConversationalResponse, type ConversationalResponse } from "./conversationalResponseBuilder";
import { routeConversationalIntent, type ConversationalIntentRouteDecision } from "./conversationalIntentRouter";

export type ConversationalCommandResult = {
  decision: ConversationalIntentRouteDecision;
  response: ConversationalResponse;
};

export function processConversationalCommand(
  request: ConversationalRefinementRequest,
  sessionId: string,
  createdAt: string,
): ConversationalCommandResult {
  const decision = routeConversationalIntent(request);
  const response = buildConversationalResponse(decision, sessionId, createdAt);

  return {
    decision,
    response,
  };
}