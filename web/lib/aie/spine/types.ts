export type ChatRole = "user" | "assistant";

export type PlanStatus =
  | "bounded_draft"
  | "supported_ready"
  | "supported_with_warnings"
  | "unsupported_target"
  | "blocked_unsafe";

export type PlannerIntent = {
  goal: string;
  engineTarget: string | null;
  platformTarget: string | null;
  features: string[];
  missingInputs: string[];
};

export type PlanStep = {
  id: string;
  title: string;
  detail: string;
};

export type BoundedPlan = {
  status: PlanStatus;
  summary: string;
  intent: PlannerIntent;
  steps: PlanStep[];
  blockedItems: string[];
  limitations: string[];
  reviewRequired: true;
  executed: false;
};

export type ToolName = "plan_bounded_request";

export type ToolCallRecord = {
  id: string;
  name: ToolName;
  arguments: Record<string, string>;
  result: BoundedPlan;
};

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatMode = "demo" | "live";

export type ChatResponse = {
  mode: ChatMode;
  reply: string;
  toolCalls: ToolCallRecord[];
};

export type DemoStatus = {
  ok: true;
  mode: ChatMode;
  llmConfigured: boolean;
  tools: ToolName[];
};
