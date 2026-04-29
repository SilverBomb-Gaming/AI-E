import {
  createAutonomousSessionRegistry,
  type AutonomousSessionRecord,
  type AutonomousSessionRegistry,
} from "./autonomousSessionRegistry";

export type SessionResourceAllocatorConfig = {
  max_logical_cpu_units: number;
  max_concurrent_chains: number;
  max_chains_per_session: number;
  allow_agent_double_assignment: boolean;
};

export type SessionResourceUsageSnapshot = {
  total_logical_cpu_units: number;
  total_active_chains: number;
  assigned_agent_ids: string[];
};

export type SessionResourceAllocatorResult = {
  status: "allocation_granted" | "allocation_blocked";
  session_id: string;
  usage: SessionResourceUsageSnapshot;
  reason: string;
  overload_reasons: string[];
};

function clampInteger(value: number | null | undefined, fallback: number, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(minimum, Math.floor(value));
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function cloneSession(session: AutonomousSessionRecord): AutonomousSessionRecord {
  return {
    ...session,
    allocated_resources: { ...session.allocated_resources },
    active_chain_ids: [...session.active_chain_ids],
    queued_work_item_ids: [...session.queued_work_item_ids],
    assigned_agent_ids: [...session.assigned_agent_ids],
  };
}

function isActiveSession(session: AutonomousSessionRecord): boolean {
  return session.status === "running" || session.status === "pending";
}

export function createSessionResourceAllocatorConfig(
  input?: Partial<SessionResourceAllocatorConfig>,
): SessionResourceAllocatorConfig {
  return {
    max_logical_cpu_units: clampInteger(input?.max_logical_cpu_units, 8, 1),
    max_concurrent_chains: clampInteger(input?.max_concurrent_chains, 8, 1),
    max_chains_per_session: clampInteger(input?.max_chains_per_session, 3, 1),
    allow_agent_double_assignment: input?.allow_agent_double_assignment === true,
  };
}

export function summarizeSessionResourceUsage(registry: AutonomousSessionRegistry): SessionResourceUsageSnapshot {
  const normalizedRegistry = createAutonomousSessionRegistry(registry);
  const activeSessions = normalizedRegistry.sessions.filter((session) => isActiveSession(session));

  return {
    total_logical_cpu_units: activeSessions.reduce((total, session) => total + session.allocated_resources.logical_cpu_units, 0),
    total_active_chains: activeSessions.reduce((total, session) => total + session.active_chain_ids.length, 0),
    assigned_agent_ids: [...new Set(activeSessions.flatMap((session) => session.assigned_agent_ids))].sort((left, right) => left.localeCompare(right)),
  };
}

export function evaluateSessionResourceAllocation(input: {
  registry: AutonomousSessionRegistry;
  session_id: string;
  config?: Partial<SessionResourceAllocatorConfig>;
}): SessionResourceAllocatorResult {
  const registry = createAutonomousSessionRegistry(input.registry);
  const config = createSessionResourceAllocatorConfig(input.config);
  const sessionId = normalizeText(input.session_id);
  const session = registry.sessions.find((candidate) => candidate.session_id === sessionId);

  if (!session) {
    throw new Error(`Autonomous session ${sessionId} was not found for resource allocation.`);
  }

  const activePeers = registry.sessions.filter((candidate) => candidate.session_id !== sessionId && isActiveSession(candidate));
  const currentUsage = summarizeSessionResourceUsage({
    ...registry,
    sessions: activePeers.map((candidate) => cloneSession(candidate)),
  });

  const overloadReasons: string[] = [];
  const requestedCpuUnits = session.allocated_resources.logical_cpu_units;
  const requestedChains = session.active_chain_ids.length;
  const requestedAgents = session.assigned_agent_ids;

  if (requestedChains > config.max_chains_per_session) {
    overloadReasons.push(`Session ${sessionId} exceeds the configured per-session chain limit of ${config.max_chains_per_session}.`);
  }

  if (requestedChains > session.max_chain_budget) {
    overloadReasons.push(`Session ${sessionId} exceeds its bounded chain budget of ${session.max_chain_budget}.`);
  }

  if (currentUsage.total_active_chains + requestedChains > config.max_concurrent_chains) {
    overloadReasons.push(`Granting ${sessionId} would exceed the global chain limit of ${config.max_concurrent_chains}.`);
  }

  if (currentUsage.total_logical_cpu_units + requestedCpuUnits > config.max_logical_cpu_units) {
    overloadReasons.push(`Granting ${sessionId} would exceed the logical CPU budget of ${config.max_logical_cpu_units}.`);
  }

  if (!config.allow_agent_double_assignment) {
    const busyAgents = new Set(currentUsage.assigned_agent_ids);
    const duplicatedAgents = requestedAgents.filter((agentId) => busyAgents.has(agentId));
    if (duplicatedAgents.length > 0) {
      overloadReasons.push(`Granting ${sessionId} would double-assign bounded agents: ${duplicatedAgents.join(", ")}.`);
    }
  }

  const usage: SessionResourceUsageSnapshot = {
    total_logical_cpu_units: currentUsage.total_logical_cpu_units + requestedCpuUnits,
    total_active_chains: currentUsage.total_active_chains + requestedChains,
    assigned_agent_ids: [...new Set([...currentUsage.assigned_agent_ids, ...requestedAgents])].sort((left, right) => left.localeCompare(right)),
  };

  return {
    status: overloadReasons.length > 0 ? "allocation_blocked" : "allocation_granted",
    session_id: sessionId,
    usage,
    reason: overloadReasons.length > 0
      ? overloadReasons[0] ?? "The session exceeds bounded resource limits."
      : `Session ${sessionId} fits within bounded logical CPU, chain, and agent limits.`,
    overload_reasons: overloadReasons,
  };
}