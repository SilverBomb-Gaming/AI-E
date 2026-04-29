import type { AgentRuntimeId } from "./agentRuntimeRegistry";

export type AutonomousSessionType = "feature" | "bugfix" | "refactor" | "experiment";

export type AutonomousSessionPriority = "critical" | "high" | "medium" | "low";

export type AutonomousSessionRunStatus = "pending" | "running" | "paused" | "blocked" | "completed" | "failed";

export type AutonomousSessionAllocatedResources = {
  logical_cpu_units: number;
  tick_budget: number;
  chain_slots: number;
  agent_assignments_allowed: number;
};

export type AutonomousSessionRecord = {
  session_id: string;
  runtime_id: string | null;
  session_type: AutonomousSessionType;
  priority: AutonomousSessionPriority;
  status: AutonomousSessionRunStatus;
  allocated_resources: AutonomousSessionAllocatedResources;
  active_chain_ids: string[];
  queued_work_item_ids: string[];
  assigned_agent_ids: AgentRuntimeId[];
  start_time: string;
  last_tick: string | null;
  max_tick_budget: number;
  max_chain_budget: number;
  parent_session_id: string | null;
  coordination_group_id: string | null;
};

export type AutonomousSessionRegistry = {
  registry_id: string;
  runtime_id: string | null;
  created_at: string;
  updated_at: string;
  global_tick_budget: number;
  sessions: AutonomousSessionRecord[];
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function uniqueAgentIds(values: Array<AgentRuntimeId | null | undefined>): AgentRuntimeId[] {
  return [...new Set(values.filter((value): value is AgentRuntimeId => Boolean(value)))].sort((left, right) => left.localeCompare(right));
}

function clampInteger(value: number | null | undefined, fallback: number, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(minimum, Math.floor(value));
}

function cloneAllocatedResources(resources: AutonomousSessionAllocatedResources): AutonomousSessionAllocatedResources {
  return {
    logical_cpu_units: resources.logical_cpu_units,
    tick_budget: resources.tick_budget,
    chain_slots: resources.chain_slots,
    agent_assignments_allowed: resources.agent_assignments_allowed,
  };
}

function cloneSession(session: AutonomousSessionRecord): AutonomousSessionRecord {
  return {
    ...session,
    allocated_resources: cloneAllocatedResources(session.allocated_resources),
    active_chain_ids: [...session.active_chain_ids],
    queued_work_item_ids: [...session.queued_work_item_ids],
    assigned_agent_ids: [...session.assigned_agent_ids],
  };
}

function compareSessions(left: AutonomousSessionRecord, right: AutonomousSessionRecord): number {
  const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const statusDelta = statusRank(left.status) - statusRank(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  const leftTick = Date.parse(left.last_tick ?? left.start_time);
  const rightTick = Date.parse(right.last_tick ?? right.start_time);
  if (!Number.isNaN(leftTick) && !Number.isNaN(rightTick) && leftTick !== rightTick) {
    return leftTick - rightTick;
  }

  return left.session_id.localeCompare(right.session_id);
}

function statusRank(status: AutonomousSessionRunStatus): number {
  switch (status) {
    case "running":
      return 0;
    case "pending":
      return 1;
    case "paused":
      return 2;
    case "blocked":
      return 3;
    case "failed":
      return 4;
    case "completed":
      return 5;
  }
}

export function priorityRank(priority: AutonomousSessionPriority): number {
  switch (priority) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
  }
}

export function createAutonomousSessionRegistryId(now: string): string {
  const stamp = now.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  return `aie-session-registry-${stamp}`;
}

export function createAutonomousSessionId(input: {
  session_type: AutonomousSessionType;
  runtime_id?: string | null;
  now?: string;
}): string {
  const now = normalizeText(input.now) || new Date().toISOString();
  const runtimeId = normalizeText(input.runtime_id) || "runtime";
  const stamp = now.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  return `aie-session-${input.session_type}-${runtimeId.replace(/[^a-zA-Z0-9-]+/g, "-")}-${stamp}`;
}

export function createAutonomousSessionRecord(input: {
  session_id?: string;
  runtime_id?: string | null;
  session_type: AutonomousSessionType;
  priority?: AutonomousSessionPriority;
  status?: AutonomousSessionRunStatus;
  allocated_resources?: Partial<AutonomousSessionAllocatedResources>;
  active_chain_ids?: string[];
  queued_work_item_ids?: string[];
  assigned_agent_ids?: AgentRuntimeId[];
  start_time?: string;
  last_tick?: string | null;
  max_tick_budget?: number;
  max_chain_budget?: number;
  parent_session_id?: string | null;
  coordination_group_id?: string | null;
}): AutonomousSessionRecord {
  const startTime = normalizeText(input.start_time) || new Date().toISOString();
  const maxTickBudget = clampInteger(input.max_tick_budget, input.allocated_resources?.tick_budget ?? 8, 1);
  const maxChainBudget = clampInteger(input.max_chain_budget, input.allocated_resources?.chain_slots ?? 2, 1);

  return {
    session_id: normalizeText(input.session_id) || createAutonomousSessionId({
      session_type: input.session_type,
      runtime_id: input.runtime_id,
      now: startTime,
    }),
    runtime_id: normalizeText(input.runtime_id) || null,
    session_type: input.session_type,
    priority: input.priority ?? "medium",
    status: input.status ?? "pending",
    allocated_resources: {
      logical_cpu_units: clampInteger(input.allocated_resources?.logical_cpu_units, 1, 1),
      tick_budget: clampInteger(input.allocated_resources?.tick_budget, maxTickBudget, 1),
      chain_slots: clampInteger(input.allocated_resources?.chain_slots, maxChainBudget, 1),
      agent_assignments_allowed: clampInteger(input.allocated_resources?.agent_assignments_allowed, 1, 1),
    },
    active_chain_ids: uniqueStrings(input.active_chain_ids ?? []),
    queued_work_item_ids: uniqueStrings(input.queued_work_item_ids ?? []),
    assigned_agent_ids: uniqueAgentIds(input.assigned_agent_ids ?? []),
    start_time: startTime,
    last_tick: normalizeText(input.last_tick) || null,
    max_tick_budget: maxTickBudget,
    max_chain_budget: maxChainBudget,
    parent_session_id: normalizeText(input.parent_session_id) || null,
    coordination_group_id: normalizeText(input.coordination_group_id) || null,
  };
}

export function createAutonomousSessionRegistry(input?: {
  registry_id?: string;
  runtime_id?: string | null;
  created_at?: string;
  updated_at?: string;
  global_tick_budget?: number;
  sessions?: AutonomousSessionRecord[];
}): AutonomousSessionRegistry {
  const createdAt = normalizeText(input?.created_at) || new Date().toISOString();
  const updatedAt = normalizeText(input?.updated_at) || createdAt;

  return {
    registry_id: normalizeText(input?.registry_id) || createAutonomousSessionRegistryId(createdAt),
    runtime_id: normalizeText(input?.runtime_id) || null,
    created_at: createdAt,
    updated_at: updatedAt,
    global_tick_budget: clampInteger(input?.global_tick_budget, 12, 1),
    sessions: (input?.sessions ?? []).map((session) => cloneSession(session)).sort(compareSessions),
  };
}

export function upsertAutonomousSession(
  registry: AutonomousSessionRegistry,
  session: AutonomousSessionRecord,
  updatedAt?: string,
): AutonomousSessionRegistry {
  const nextSessions = registry.sessions.filter((candidate) => candidate.session_id !== session.session_id);
  nextSessions.push(cloneSession(session));

  return {
    ...registry,
    updated_at: normalizeText(updatedAt) || session.last_tick || registry.updated_at,
    sessions: nextSessions.sort(compareSessions),
  };
}

export function updateAutonomousSession(
  registry: AutonomousSessionRegistry,
  sessionId: string,
  updater: (session: AutonomousSessionRecord) => AutonomousSessionRecord,
  updatedAt?: string,
): AutonomousSessionRegistry {
  const normalizedSessionId = normalizeText(sessionId);
  const target = registry.sessions.find((session) => session.session_id === normalizedSessionId);
  if (!target) {
    throw new Error(`Autonomous session ${normalizedSessionId} was not found in the registry.`);
  }

  return upsertAutonomousSession(registry, updater(cloneSession(target)), updatedAt);
}

export function summarizeAutonomousSessionRegistry(registry: AutonomousSessionRegistry): string {
  const header = [
    `Autonomous session registry: ${registry.registry_id}`,
    `Runtime id: ${registry.runtime_id ?? "none"}`,
    `Global tick budget: ${registry.global_tick_budget}`,
    `Tracked sessions: ${registry.sessions.length}`,
  ];

  const sessions = registry.sessions.map((session) => {
    return `- ${session.session_type} ${session.session_id}: ${session.status}, ${session.priority}, chains ${session.active_chain_ids.length}/${session.max_chain_budget}, queued work ${session.queued_work_item_ids.length}`;
  });

  return [...header, ...sessions].join("\n");
}