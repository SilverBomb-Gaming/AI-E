import { planBoundedRequest } from "./planner";
import type { BoundedPlan, ToolCallRecord, ToolName } from "./types";

export const SPINE_TOOLS: ToolName[] = ["plan_bounded_request"];

export const PLAN_BOUNDED_REQUEST_SCHEMA = {
  type: "function" as const,
  function: {
    name: "plan_bounded_request" as const,
    description:
      "Parse a game-development request into a bounded AI-E plan. Use this whenever the user asks to make, add, build, plan, or change a game system. This tool plans only; it does not execute engine work.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["request"],
      properties: {
        request: {
          type: "string",
          description: "The user's request in their own words.",
        },
      },
    },
  },
};

export function executePlanBoundedRequest(request: string): BoundedPlan {
  return planBoundedRequest(request);
}

export function makeToolCallRecord(request: string, id?: string): ToolCallRecord {
  return {
    id: id ?? `tool_plan_${Date.now()}`,
    name: "plan_bounded_request",
    arguments: { request },
    result: executePlanBoundedRequest(request),
  };
}

export function looksLikePlanRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (normalized.length < 8) {
    return false;
  }

  return (
    /\b(plan|make|add|build|create|scaffold|implement|tune|change|design|prototype)\b/.test(normalized) ||
    /\b(unity|unreal|godot|controller|inventory|camera|movement|combat)\b/.test(normalized)
  );
}
