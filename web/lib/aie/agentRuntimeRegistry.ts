import { createExecutionMultiAgentSessionId } from "./orchestrationSession";

export type AgentRuntimeRole = "planner" | "executor" | "validator" | "reporter";
export type AgentRuntimeId = "planner-agent" | "executor-agent" | "validator-agent" | "reporter-agent";
export type AgentRuntimeStatus = "idle" | "assigned" | "paused" | "blocked";
export type AgentRuntimeSafetyScope = "planning_only" | "bounded_execution_only" | "validation_only" | "reporting_only";
export type AgentRuntimeApprovalState = "not_required" | "approval_pending" | "approved" | "rejected";

export const PLANNER_AGENT_ID: AgentRuntimeId = "planner-agent";
export const EXECUTOR_AGENT_ID: AgentRuntimeId = "executor-agent";
export const VALIDATOR_AGENT_ID: AgentRuntimeId = "validator-agent";
export const REPORTER_AGENT_ID: AgentRuntimeId = "reporter-agent";

export type AgentRuntimeNode = {
  agent_id: AgentRuntimeId;
  role: AgentRuntimeRole;
  status: AgentRuntimeStatus;
  assigned_goal_ids: string[];
  current_goal_id: string | null;
  last_tick_at: string | null;
  last_event_id: string | null;
  last_event_summary: string | null;
  safety_scope: AgentRuntimeSafetyScope;
  approval_state: AgentRuntimeApprovalState;
  failure_count: number;
  can_spawn_agents: false;
  max_concurrent_goals: 1;
};

export type AgentRuntimeRegistry = {
  registry_id: string;
  runtime_id: string | null;
  orchestration_id: string | null;
  multi_agent_session_id: string;
  recursion_guard_enabled: true;
  max_agents: 4;
  agents: AgentRuntimeNode[];
};

const KNOWN_AGENTS: Array<{
  agent_id: AgentRuntimeId;
  role: AgentRuntimeRole;
  safety_scope: AgentRuntimeSafetyScope;
  approval_state: AgentRuntimeApprovalState;
}> = [
  {
    agent_id: PLANNER_AGENT_ID,
    role: "planner",
    safety_scope: "planning_only",
    approval_state: "not_required",
  },
  {
    agent_id: EXECUTOR_AGENT_ID,
    role: "executor",
    safety_scope: "bounded_execution_only",
    approval_state: "approval_pending",
  },
  {
    agent_id: VALIDATOR_AGENT_ID,
    role: "validator",
    safety_scope: "validation_only",
    approval_state: "not_required",
  },
  {
    agent_id: REPORTER_AGENT_ID,
    role: "reporter",
    safety_scope: "reporting_only",
    approval_state: "not_required",
  },
];

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function createRegistryId(now: string): string {
  const stamp = now.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  return `aie-agent-registry-${stamp}`;
}

function createAgentNode(
  agentId: AgentRuntimeId,
  agentRole: AgentRuntimeRole,
  safetyScope: AgentRuntimeSafetyScope,
  approvalState: AgentRuntimeApprovalState,
  timestamp: string | null,
): AgentRuntimeNode {
  return {
    agent_id: agentId,
    role: agentRole,
    status: "idle",
    assigned_goal_ids: [],
    current_goal_id: null,
    last_tick_at: timestamp,
    last_event_id: null,
    last_event_summary: null,
    safety_scope: safetyScope,
    approval_state: approvalState,
    failure_count: 0,
    can_spawn_agents: false,
    max_concurrent_goals: 1,
  };
}

function cloneRegistry(registry: AgentRuntimeRegistry): AgentRuntimeRegistry {
  return JSON.parse(JSON.stringify(registry)) as AgentRuntimeRegistry;
}

function resolveKnownAgent(
  agentId: AgentRuntimeId,
  agentRole?: AgentRuntimeRole,
): {
  agent_id: AgentRuntimeId;
  role: AgentRuntimeRole;
  safety_scope: AgentRuntimeSafetyScope;
  approval_state: AgentRuntimeApprovalState;
} {
  const knownAgent = KNOWN_AGENTS.find((agent) => agent.agent_id === agentId);
  if (!knownAgent) {
    throw new Error(`Unknown agent runtime id: ${agentId}`);
  }

  if (agentRole && knownAgent.role !== agentRole) {
    throw new Error(`Agent ${agentId} must use the ${knownAgent.role} role.`);
  }

  return knownAgent;
}

function updateAgent(
  registry: AgentRuntimeRegistry,
  agentId: AgentRuntimeId,
  updater: (agent: AgentRuntimeNode) => AgentRuntimeNode,
): AgentRuntimeRegistry {
  const nextRegistry = cloneRegistry(registry);
  const index = nextRegistry.agents.findIndex((agent) => agent.agent_id === agentId);
  if (index < 0) {
    throw new Error(`Unknown agent runtime id: ${agentId}`);
  }

  nextRegistry.agents[index] = updater(nextRegistry.agents[index]!);
  return nextRegistry;
}

export function createAgentRuntimeRegistry(params?: {
  runtime_id?: string | null;
  orchestration_id?: string | null;
  multi_agent_session_id?: string | null;
  now?: string;
  include_default_agents?: boolean;
}): AgentRuntimeRegistry {
  const now = normalizeText(params?.now) || new Date().toISOString();
  const includeDefaultAgents = params?.include_default_agents !== false;

  return {
    registry_id: createRegistryId(now),
    runtime_id: normalizeText(params?.runtime_id) || null,
    orchestration_id: normalizeText(params?.orchestration_id) || null,
    multi_agent_session_id: normalizeText(params?.multi_agent_session_id) || createExecutionMultiAgentSessionId(),
    recursion_guard_enabled: true,
    max_agents: 4,
    agents: includeDefaultAgents
      ? KNOWN_AGENTS.map((agent) => createAgentNode(agent.agent_id, agent.role, agent.safety_scope, agent.approval_state, now))
      : [],
  };
}

export function registerAgentRuntime(
  registry: AgentRuntimeRegistry,
  params: {
    agent_id: AgentRuntimeId;
    role?: AgentRuntimeRole;
    timestamp: string;
  },
): AgentRuntimeRegistry {
  const knownAgent = resolveKnownAgent(params.agent_id, params.role);
  const existing = registry.agents.find((agent) => agent.agent_id === params.agent_id);
  if (existing) {
    throw new Error(`Agent ${params.agent_id} is already registered in the bounded runtime registry.`);
  }

  if (registry.agents.length >= registry.max_agents) {
    throw new Error("Agent runtime registry cannot exceed the bounded four-agent planner/executor/validator/reporter scaffold.");
  }

  const nextRegistry = cloneRegistry(registry);
  nextRegistry.agents.push(createAgentNode(
    knownAgent.agent_id,
    knownAgent.role,
    knownAgent.safety_scope,
    knownAgent.approval_state,
    params.timestamp,
  ));
  return nextRegistry;
}

export function assignGoalToAgentRuntime(
  registry: AgentRuntimeRegistry,
  params: {
    agent_id: AgentRuntimeId;
    goal_id: string;
    timestamp: string;
    event_id?: string | null;
    event_summary?: string | null;
  },
): AgentRuntimeRegistry {
  const goalId = normalizeText(params.goal_id);
  if (!goalId) {
    throw new Error("A bounded goal id is required before assigning agent runtime work.");
  }

  return updateAgent(registry, params.agent_id, (agent) => {
    if (agent.status === "paused") {
      throw new Error(`Agent ${params.agent_id} is paused and cannot accept a bounded goal assignment.`);
    }

    if (agent.status === "blocked") {
      throw new Error(`Agent ${params.agent_id} is blocked and cannot accept new bounded work.`);
    }

    if (agent.can_spawn_agents !== false) {
      throw new Error(`Agent ${params.agent_id} cannot enable recursive agent spawning.`);
    }

    if (agent.current_goal_id && agent.current_goal_id !== goalId) {
      throw new Error(`Agent ${params.agent_id} already owns a bounded goal assignment.`);
    }

    if (agent.assigned_goal_ids.length >= agent.max_concurrent_goals && !agent.assigned_goal_ids.includes(goalId)) {
      throw new Error(`Agent ${params.agent_id} cannot exceed its bounded goal capacity.`);
    }

    return {
      ...agent,
      status: "assigned",
      assigned_goal_ids: agent.assigned_goal_ids.includes(goalId) ? [...agent.assigned_goal_ids] : [...agent.assigned_goal_ids, goalId],
      current_goal_id: goalId,
      last_tick_at: params.timestamp,
      last_event_id: normalizeText(params.event_id) || agent.last_event_id,
      last_event_summary: normalizeText(params.event_summary) || agent.last_event_summary,
      approval_state: agent.role === "executor" ? "approved" : agent.approval_state,
    };
  });
}

export function pauseAgentRuntime(
  registry: AgentRuntimeRegistry,
  params: {
    agent_id: AgentRuntimeId;
    timestamp: string;
    event_id?: string | null;
    event_summary?: string | null;
  },
): AgentRuntimeRegistry {
  return updateAgent(registry, params.agent_id, (agent) => ({
    ...agent,
    status: "paused",
    last_tick_at: params.timestamp,
    last_event_id: normalizeText(params.event_id) || agent.last_event_id,
    last_event_summary: normalizeText(params.event_summary) || agent.last_event_summary,
  }));
}

export function resumeAgentRuntime(
  registry: AgentRuntimeRegistry,
  params: {
    agent_id: AgentRuntimeId;
    timestamp: string;
    event_id?: string | null;
    event_summary?: string | null;
  },
): AgentRuntimeRegistry {
  return updateAgent(registry, params.agent_id, (agent) => ({
    ...agent,
    status: agent.current_goal_id ? "assigned" : "idle",
    last_tick_at: params.timestamp,
    last_event_id: normalizeText(params.event_id) || agent.last_event_id,
    last_event_summary: normalizeText(params.event_summary) || agent.last_event_summary,
  }));
}

export function markAgentBlocked(
  registry: AgentRuntimeRegistry,
  params: {
    agent_id: AgentRuntimeId;
    timestamp: string;
    event_id?: string | null;
    event_summary?: string | null;
  },
): AgentRuntimeRegistry {
  return updateAgent(registry, params.agent_id, (agent) => ({
    ...agent,
    status: "blocked",
    last_tick_at: params.timestamp,
    last_event_id: normalizeText(params.event_id) || agent.last_event_id,
    last_event_summary: normalizeText(params.event_summary) || agent.last_event_summary,
    failure_count: agent.failure_count + 1,
  }));
}

export function markAgentIdle(
  registry: AgentRuntimeRegistry,
  params: {
    agent_id: AgentRuntimeId;
    timestamp: string;
    event_id?: string | null;
    event_summary?: string | null;
  },
): AgentRuntimeRegistry {
  return updateAgent(registry, params.agent_id, (agent) => ({
    ...agent,
    status: "idle",
    assigned_goal_ids: [],
    current_goal_id: null,
    last_tick_at: params.timestamp,
    last_event_id: normalizeText(params.event_id) || agent.last_event_id,
    last_event_summary: normalizeText(params.event_summary) || agent.last_event_summary,
  }));
}

export function clearAgentGoalAssignment(
  registry: AgentRuntimeRegistry,
  params: {
    agent_id: AgentRuntimeId;
    timestamp: string;
    event_id?: string | null;
  },
): AgentRuntimeRegistry {
  return markAgentIdle(registry, params);
}

export function summarizeAgentRuntimeRegistry(registry: AgentRuntimeRegistry): string {
  const header = [
    `Agent runtime registry: ${registry.registry_id}`,
    `Multi-agent session: ${registry.multi_agent_session_id}`,
    `Runtime id: ${registry.runtime_id ?? "none"}`,
    `Recursion guard enabled: ${registry.recursion_guard_enabled ? "yes" : "no"}`,
  ];

  const agents = registry.agents.map((agent) => {
    const assignment = agent.current_goal_id ? ` -> ${agent.current_goal_id}` : "";
    return `- ${agent.role} (${agent.agent_id}): ${agent.status}${assignment}`;
  });

  return [...header, ...agents].join("\n");
}