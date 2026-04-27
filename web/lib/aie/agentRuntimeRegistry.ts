import {
  EXECUTOR_AGENT_ID,
  PLANNER_AGENT_ID,
  createExecutionMultiAgentSessionId,
  type ExecutionOrchestrationAgentId,
  type ExecutionOrchestrationAgentRole,
} from "./orchestrationSession";

export type AgentRuntimeStatus = "idle" | "assigned" | "paused";
export type AgentRuntimeSafetyScope = "bounded_execution_only";

export type AgentRuntimeNode = {
  agent_id: ExecutionOrchestrationAgentId;
  agent_role: ExecutionOrchestrationAgentRole;
  status: AgentRuntimeStatus;
  assigned_goal_id: string | null;
  assigned_goal_label: string | null;
  last_heartbeat_at: string | null;
  last_transition_at: string | null;
  safety_scope: AgentRuntimeSafetyScope;
  can_spawn_agents: false;
  max_concurrent_goals: 1;
};

export type AgentRuntimeRegistry = {
  registry_id: string;
  runtime_id: string | null;
  orchestration_id: string | null;
  multi_agent_session_id: string;
  recursion_guard_enabled: true;
  max_agents: 2;
  agents: AgentRuntimeNode[];
};

const KNOWN_AGENTS: Array<{
  agent_id: ExecutionOrchestrationAgentId;
  agent_role: ExecutionOrchestrationAgentRole;
}> = [
  {
    agent_id: PLANNER_AGENT_ID,
    agent_role: "planner",
  },
  {
    agent_id: EXECUTOR_AGENT_ID,
    agent_role: "executor",
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
  agentId: ExecutionOrchestrationAgentId,
  agentRole: ExecutionOrchestrationAgentRole,
  timestamp: string | null,
): AgentRuntimeNode {
  return {
    agent_id: agentId,
    agent_role: agentRole,
    status: "idle",
    assigned_goal_id: null,
    assigned_goal_label: null,
    last_heartbeat_at: timestamp,
    last_transition_at: timestamp,
    safety_scope: "bounded_execution_only",
    can_spawn_agents: false,
    max_concurrent_goals: 1,
  };
}

function cloneRegistry(registry: AgentRuntimeRegistry): AgentRuntimeRegistry {
  return JSON.parse(JSON.stringify(registry)) as AgentRuntimeRegistry;
}

function resolveKnownAgent(
  agentId: ExecutionOrchestrationAgentId,
  agentRole?: ExecutionOrchestrationAgentRole,
): { agent_id: ExecutionOrchestrationAgentId; agent_role: ExecutionOrchestrationAgentRole } {
  const knownAgent = KNOWN_AGENTS.find((agent) => agent.agent_id === agentId);
  if (!knownAgent) {
    throw new Error(`Unknown agent runtime id: ${agentId}`);
  }

  if (agentRole && knownAgent.agent_role !== agentRole) {
    throw new Error(`Agent ${agentId} must use the ${knownAgent.agent_role} role.`);
  }

  return knownAgent;
}

function updateAgent(
  registry: AgentRuntimeRegistry,
  agentId: ExecutionOrchestrationAgentId,
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
    max_agents: 2,
    agents: includeDefaultAgents
      ? KNOWN_AGENTS.map((agent) => createAgentNode(agent.agent_id, agent.agent_role, now))
      : [],
  };
}

export function registerAgentRuntime(
  registry: AgentRuntimeRegistry,
  params: {
    agent_id: ExecutionOrchestrationAgentId;
    agent_role?: ExecutionOrchestrationAgentRole;
    timestamp: string;
  },
): AgentRuntimeRegistry {
  const knownAgent = resolveKnownAgent(params.agent_id, params.agent_role);
  const existing = registry.agents.find((agent) => agent.agent_id === params.agent_id);
  if (existing) {
    return updateAgent(registry, params.agent_id, (agent) => ({
      ...agent,
      last_heartbeat_at: params.timestamp,
      last_transition_at: agent.last_transition_at ?? params.timestamp,
    }));
  }

  if (registry.agents.length >= registry.max_agents) {
    throw new Error("Agent runtime registry cannot exceed the bounded two-agent planner/executor scaffold.");
  }

  const nextRegistry = cloneRegistry(registry);
  nextRegistry.agents.push(createAgentNode(knownAgent.agent_id, knownAgent.agent_role, params.timestamp));
  return nextRegistry;
}

export function assignGoalToAgentRuntime(
  registry: AgentRuntimeRegistry,
  params: {
    agent_id: ExecutionOrchestrationAgentId;
    goal_id: string;
    goal_label: string;
    timestamp: string;
  },
): AgentRuntimeRegistry {
  const goalId = normalizeText(params.goal_id);
  const goalLabel = normalizeText(params.goal_label);
  if (!goalId || !goalLabel) {
    throw new Error("A bounded goal id and goal label are required before assigning agent runtime work.");
  }

  return updateAgent(registry, params.agent_id, (agent) => {
    if (agent.status === "paused") {
      throw new Error(`Agent ${params.agent_id} is paused and cannot accept a bounded goal assignment.`);
    }

    return {
      ...agent,
      status: "assigned",
      assigned_goal_id: goalId,
      assigned_goal_label: goalLabel,
      last_heartbeat_at: params.timestamp,
      last_transition_at: params.timestamp,
    };
  });
}

export function pauseAgentRuntime(
  registry: AgentRuntimeRegistry,
  params: {
    agent_id: ExecutionOrchestrationAgentId;
    timestamp: string;
  },
): AgentRuntimeRegistry {
  return updateAgent(registry, params.agent_id, (agent) => ({
    ...agent,
    status: "paused",
    last_heartbeat_at: params.timestamp,
    last_transition_at: params.timestamp,
  }));
}

export function resumeAgentRuntime(
  registry: AgentRuntimeRegistry,
  params: {
    agent_id: ExecutionOrchestrationAgentId;
    timestamp: string;
  },
): AgentRuntimeRegistry {
  return updateAgent(registry, params.agent_id, (agent) => ({
    ...agent,
    status: agent.assigned_goal_id ? "assigned" : "idle",
    last_heartbeat_at: params.timestamp,
    last_transition_at: params.timestamp,
  }));
}

export function clearAgentGoalAssignment(
  registry: AgentRuntimeRegistry,
  params: {
    agent_id: ExecutionOrchestrationAgentId;
    timestamp: string;
  },
): AgentRuntimeRegistry {
  return updateAgent(registry, params.agent_id, (agent) => ({
    ...agent,
    status: "idle",
    assigned_goal_id: null,
    assigned_goal_label: null,
    last_heartbeat_at: params.timestamp,
    last_transition_at: params.timestamp,
  }));
}

export function summarizeAgentRuntimeRegistry(registry: AgentRuntimeRegistry): string {
  const header = [
    `Agent runtime registry: ${registry.registry_id}`,
    `Multi-agent session: ${registry.multi_agent_session_id}`,
    `Runtime id: ${registry.runtime_id ?? "none"}`,
    `Recursion guard enabled: ${registry.recursion_guard_enabled ? "yes" : "no"}`,
  ];

  const agents = registry.agents.map((agent) => {
    const assignment = agent.assigned_goal_label ? ` -> ${agent.assigned_goal_label}` : "";
    return `- ${agent.agent_role} (${agent.agent_id}): ${agent.status}${assignment}`;
  });

  return [...header, ...agents].join("\n");
}