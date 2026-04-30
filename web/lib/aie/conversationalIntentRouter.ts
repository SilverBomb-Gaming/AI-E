import {
  evaluateConversationalReadiness,
  type ConversationalReadinessResult,
} from "./conversationalReadinessOrchestrator";
import type { ConversationalRefinementRequest } from "./conversationalIntentRefinement";
import type { ConversationalCommandRoute } from "./conversationalSessionState";

export type ConversationalIntentRouteDecision = {
  route: ConversationalCommandRoute;
  readiness: ConversationalReadinessResult;
  operator_notice: string;
};

export function routeConversationalIntent(
  request: ConversationalRefinementRequest,
): ConversationalIntentRouteDecision {
  const readiness = evaluateConversationalReadiness(request);
  const route: ConversationalCommandRoute = readiness.status === "blocked"
    ? "block"
    : readiness.status === "needs_clarification"
      ? "clarify"
      : readiness.status === "needs_review"
        ? "review"
        : "plan";

  const operatorNotice = route === "plan"
    ? "Planner-ready routing can be proposed, but no plan or execution starts until the operator chooses the next safe step."
    : route === "clarify"
      ? "The request needs one narrower detail before AI-E can route it into planning safely."
      : route === "review"
        ? "The request is directionally usable but still needs explicit operator review before it can move deeper into the pipeline."
        : "The request is blocked because it exceeds safe bounded autonomy or lacks a first safe task.";

  return {
    route,
    readiness,
    operator_notice: operatorNotice,
  };
}