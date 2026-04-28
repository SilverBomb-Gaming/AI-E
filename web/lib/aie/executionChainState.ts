import type { AgentRuntimeId } from "./agentRuntimeRegistry";

export type ExecutionChainStatus = "pending" | "active" | "completed" | "blocked";
export type ExecutionChainSafetyStatus = "safe" | "approval_required" | "blocked";

export type ExecutionChainRecord = {
  chain_id: string;
  parent_goal_id: string | null;
  current_step: number;
  total_steps: number;
  status: ExecutionChainStatus;
  agent_ids: AgentRuntimeId[];
  started_at: string;
  completed_at: string | null;
  failure_reason: string | null;
  last_transition: string;
  safety_status: ExecutionChainSafetyStatus;
};

export function createExecutionChainId(parentGoalId: string | null, timestamp: string): string {
  const safeGoalId = String(parentGoalId ?? "runtime").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "runtime";
  const stamp = timestamp.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  return `execution-chain-${safeGoalId}-${stamp}`;
}