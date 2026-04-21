import type { ExecutionActionPreview } from "./types";
import {
  createExecutionNodeDescriptor,
  getExecutionNodeCapabilitiesForAction,
  normalizeExecutionNodeDescriptor,
  supportsExecutionNodeCapabilities,
  validateExecutionActionForNode,
  type ExecutionNodeCapability,
  type ExecutionNodeDescriptor,
  type ExecutionNodeStatus,
} from "./executionNode";
import {
  clearStoredExecutionNodes,
  listStoredExecutionNodes,
  removeStoredExecutionNode,
  writeStoredExecutionNode,
} from "./executionNodeStore";

type ExecutionNodeSelectionContext = {
  runtimeMode?: string;
  preferredNodeId?: string;
  cwd?: string;
};

type ListAvailableExecutionNodesOptions = {
  requestedCapabilities?: ExecutionNodeCapability[];
  includeBusy?: boolean;
  taskId?: string;
  heartbeatStaleAfterMs?: number;
};

export type ExecutionNodeEligibility = {
  eligible: boolean;
  reason: string;
  heartbeatAgeMs: number | null;
  stale: boolean;
};

type ExecutionNodeHeartbeatUpdate = {
  at?: string;
  trustState?: ExecutionNodeDescriptor["trustState"];
};

type ExecutionNodeActivityUpdate = {
  taskId?: string;
  sessionId?: string;
  busy?: boolean;
};

const executionNodeRegistry = new Map<string, ExecutionNodeDescriptor>();
const DEFAULT_STALE_HEARTBEAT_MS = 30_000;

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function supportsCapabilities(node: ExecutionNodeDescriptor, capabilities: ExecutionNodeCapability[]): boolean {
  return supportsExecutionNodeCapabilities(node, capabilities);
}

function normalizeHeartbeatThreshold(value: unknown): number {
  const numericValue = Number(value ?? DEFAULT_STALE_HEARTBEAT_MS);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_STALE_HEARTBEAT_MS;
  }

  return Math.max(1, Math.floor(numericValue));
}

function syncRegistryFromDisk(): ExecutionNodeDescriptor[] {
  executionNodeRegistry.clear();
  for (const node of listStoredExecutionNodes()) {
    executionNodeRegistry.set(node.id, node);
  }

  return [...executionNodeRegistry.values()];
}

function persistNode(node: ExecutionNodeDescriptor): ExecutionNodeDescriptor {
  const normalized = writeStoredExecutionNode(node);
  executionNodeRegistry.set(normalized.id, normalized);
  return normalized;
}

function sortExecutionNodes(nodes: ExecutionNodeDescriptor[]): ExecutionNodeDescriptor[] {
  return nodes.sort((left, right) => {
    if (left.status !== right.status) {
      if (left.status === "active") {
        return -1;
      }
      if (right.status === "active") {
        return 1;
      }
    }

    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }

    if (left.busy !== right.busy) {
      return left.busy ? 1 : -1;
    }

    if (left.mode !== right.mode) {
      if (left.mode === "local-node") {
        return -1;
      }
      if (right.mode === "local-node") {
        return 1;
      }
    }

    return left.id.localeCompare(right.id);
  });
}

function getCurrentNodes(): ExecutionNodeDescriptor[] {
  return sortExecutionNodes(syncRegistryFromDisk());
}

function buildNodeUpdate(existing: ExecutionNodeDescriptor, overrides: Partial<ExecutionNodeDescriptor>): ExecutionNodeDescriptor {
  return normalizeExecutionNodeDescriptor({
    ...existing,
    ...overrides,
    createdAt: existing.createdAt,
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  });
}

function mapStatusToActive(status: ExecutionNodeStatus): boolean {
  return status === "active";
}

export type ExecutionNodeDispatchValidation = {
  accepted: boolean;
  reason?: string;
  node?: ExecutionNodeDescriptor;
};

export function registerExecutionNode(node: ExecutionNodeDescriptor): ExecutionNodeDescriptor {
  const existing = getExecutionNode(node.id);
  const status = node.active === false && node.status === "active"
    ? "inactive"
    : node.status ?? (node.active === false ? "inactive" : existing?.status ?? "active");

  return persistNode(createExecutionNodeDescriptor({
    ...existing,
    ...node,
    createdAt: existing?.createdAt ?? node.createdAt,
    updatedAt: new Date().toISOString(),
    status,
    active: mapStatusToActive(status),
    heartbeatMissCount: node.heartbeatMissCount ?? existing?.heartbeatMissCount ?? 0,
    lastHeartbeatAt: node.lastHeartbeatAt ?? existing?.lastHeartbeatAt,
    trustState: node.trustState ?? existing?.trustState ?? "unknown",
    leaseEpoch: node.leaseEpoch ?? existing?.leaseEpoch ?? 0,
    activeTaskId: node.activeTaskId ?? existing?.activeTaskId,
    activeSessionIds: node.activeSessionIds ?? existing?.activeSessionIds ?? [],
  }));
}

export function unregisterExecutionNode(nodeId: string): boolean {
  const normalizedId = normalizeText(nodeId);
  const existed = getExecutionNode(normalizedId) !== null;
  executionNodeRegistry.delete(normalizedId);
  removeStoredExecutionNode(normalizedId);
  return existed;
}

export function getExecutionNodeEligibility(
  node: ExecutionNodeDescriptor,
  options: ListAvailableExecutionNodesOptions = {},
): ExecutionNodeEligibility {
  const heartbeatStaleAfterMs = normalizeHeartbeatThreshold(options.heartbeatStaleAfterMs);
  const heartbeatAgeMs = node.lastHeartbeatAt ? Math.max(0, Date.now() - Date.parse(node.lastHeartbeatAt)) : null;

  if (node.trustState === "blocked") {
    return {
      eligible: false,
      reason: `Execution node ${node.id} is blocked by trust state.`,
      heartbeatAgeMs,
      stale: false,
    };
  }

  if (node.status === "inactive") {
    return {
      eligible: false,
      reason: `Execution node ${node.id} is inactive.`,
      heartbeatAgeMs,
      stale: false,
    };
  }

  if (node.status === "draining") {
    return {
      eligible: false,
      reason: `Execution node ${node.id} is draining and not eligible for new dispatches.`,
      heartbeatAgeMs,
      stale: false,
    };
  }

  if (node.status === "stale") {
    return {
      eligible: false,
      reason: `Execution node ${node.id} is stale.`,
      heartbeatAgeMs,
      stale: true,
    };
  }

  if (heartbeatAgeMs !== null && heartbeatAgeMs > heartbeatStaleAfterMs) {
    return {
      eligible: false,
      reason: `Execution node ${node.id} heartbeat is stale.`,
      heartbeatAgeMs,
      stale: true,
    };
  }

  if (!options.includeBusy && node.busy && node.activeTaskId !== options.taskId) {
    return {
      eligible: false,
      reason: `Execution node ${node.id} is busy.`,
      heartbeatAgeMs,
      stale: false,
    };
  }

  if ((options.requestedCapabilities ?? []).length && !supportsCapabilities(node, options.requestedCapabilities ?? [])) {
    return {
      eligible: false,
      reason: `Execution node ${node.id} does not support ${(options.requestedCapabilities ?? []).join(",") || "the requested capabilities"}.`,
      heartbeatAgeMs,
      stale: false,
    };
  }

  return {
    eligible: true,
    reason: `Execution node ${node.id} is eligible for dispatch.`,
    heartbeatAgeMs,
    stale: false,
  };
}

export function updateExecutionNodeHeartbeat(
  nodeId: string,
  update: ExecutionNodeHeartbeatUpdate = {},
): ExecutionNodeDescriptor | null {
  const existing = getExecutionNode(nodeId);
  if (!existing) {
    return null;
  }

  const heartbeatAt = normalizeText(update.at) || new Date().toISOString();
  const nextStatus: ExecutionNodeStatus = existing.status === "inactive"
    ? "inactive"
    : existing.status === "draining"
      ? "draining"
      : "active";

  return persistNode(buildNodeUpdate(existing, {
    status: nextStatus,
    active: nextStatus === "active",
    lastHeartbeatAt: heartbeatAt,
    heartbeatMissCount: 0,
    trustState: update.trustState ?? existing.trustState,
    leaseEpoch: (existing.leaseEpoch ?? 0) + 1,
  }));
}

export function evaluateExecutionNodeLiveness(options: { heartbeatStaleAfterMs?: number } = {}): ExecutionNodeDescriptor[] {
  const heartbeatStaleAfterMs = normalizeHeartbeatThreshold(options.heartbeatStaleAfterMs);
  const nodes = syncRegistryFromDisk();
  const now = Date.now();

  for (const node of nodes) {
    if (node.status !== "active" || !node.lastHeartbeatAt) {
      continue;
    }

    if (now - Date.parse(node.lastHeartbeatAt) <= heartbeatStaleAfterMs) {
      continue;
    }

    persistNode(buildNodeUpdate(node, {
      status: "stale",
      active: false,
      heartbeatMissCount: (node.heartbeatMissCount ?? 0) + 1,
    }));
  }

  return getCurrentNodes();
}

export function updateExecutionNodeActivity(nodeId: string, update: ExecutionNodeActivityUpdate): ExecutionNodeDescriptor | null {
  const existing = getExecutionNode(nodeId);
  if (!existing) {
    return null;
  }

  const sessionIds = new Set(existing.activeSessionIds ?? []);
  if (normalizeText(update.sessionId)) {
    sessionIds.add(normalizeText(update.sessionId));
  }

  return persistNode(buildNodeUpdate(existing, {
    activeTaskId: normalizeText(update.taskId) || existing.activeTaskId,
    activeSessionIds: [...sessionIds],
    busy: update.busy ?? Boolean(normalizeText(update.taskId) || existing.activeTaskId),
  }));
}

export function clearExecutionNodeActivity(nodeId: string, update: ExecutionNodeActivityUpdate = {}): ExecutionNodeDescriptor | null {
  const existing = getExecutionNode(nodeId);
  if (!existing) {
    return null;
  }

  const targetTaskId = normalizeText(update.taskId);
  const targetSessionId = normalizeText(update.sessionId);
  const nextSessionIds = (existing.activeSessionIds ?? []).filter((sessionId) => sessionId !== targetSessionId);
  const nextTaskId = targetTaskId && existing.activeTaskId === targetTaskId ? undefined : existing.activeTaskId;

  return persistNode(buildNodeUpdate(existing, {
    activeTaskId: nextTaskId,
    activeSessionIds: nextSessionIds,
    busy: update.busy ?? Boolean(nextTaskId),
  }));
}

export function listExecutionNodes(): ExecutionNodeDescriptor[] {
  evaluateExecutionNodeLiveness();
  return getCurrentNodes();
}

export function listAvailableExecutionNodes(options: ListAvailableExecutionNodesOptions = {}): ExecutionNodeDescriptor[] {
  return evaluateExecutionNodeLiveness({ heartbeatStaleAfterMs: options.heartbeatStaleAfterMs }).filter((node) =>
    getExecutionNodeEligibility(node, options).eligible,
  );
}

export function getExecutionNode(nodeId: string): ExecutionNodeDescriptor | null {
  return syncRegistryFromDisk().find((node) => node.id === normalizeText(nodeId)) ?? null;
}

export function setExecutionNodeActive(nodeId: string, active: boolean): ExecutionNodeDescriptor | null {
  const existing = getExecutionNode(nodeId);
  if (!existing) {
    return null;
  }

  const status: ExecutionNodeStatus = active ? "active" : "inactive";
  return persistNode(buildNodeUpdate(existing, {
    active,
    status,
  }));
}

export function markExecutionNodeBusy(nodeId: string, busy = true): ExecutionNodeDescriptor | null {
  const existing = getExecutionNode(nodeId);
  if (!existing) {
    return null;
  }

  return persistNode(buildNodeUpdate(existing, { busy }));
}

export function validateExecutionNodeDispatch(
  nodeId: string,
  params: {
    requestedCapabilities: ExecutionNodeCapability[];
    action?: ExecutionActionPreview;
    taskId?: string;
  },
): ExecutionNodeDispatchValidation {
  const node = getExecutionNode(nodeId);
  if (!node) {
    return {
      accepted: false,
      reason: `Execution node ${normalizeText(nodeId) || "unknown"} is not registered.`,
    };
  }

  const eligibility = getExecutionNodeEligibility(node, {
    requestedCapabilities: params.requestedCapabilities,
    taskId: params.taskId,
  });
  if (!eligibility.eligible) {
    return {
      accepted: false,
      reason: eligibility.reason,
    };
  }

  const actionCheck = validateExecutionActionForNode(node, params.action);
  if (!actionCheck.allowed) {
    return {
      accepted: false,
      reason: actionCheck.reason,
      node,
    };
  }

  return {
    accepted: true,
    node,
  };
}

export function chooseExecutionNodeForAction(
  action: ExecutionActionPreview | undefined,
  context: ExecutionNodeSelectionContext = {},
): ExecutionNodeDescriptor | null {
  const requestedCapabilities = getExecutionNodeCapabilitiesForAction(action);
  const candidates = listAvailableExecutionNodes({
    requestedCapabilities,
  });

  if (!candidates.length) {
    return null;
  }

  const preferredNodeId = normalizeText(context.preferredNodeId);
  const preferred = preferredNodeId ? candidates.find((node) => node.id === preferredNodeId) : null;
  if (preferred) {
    return preferred;
  }

  const matchingMode = normalizeText(context.runtimeMode);
  const byMode = matchingMode
    ? candidates.find((node) => node.mode === (matchingMode === "local" ? "local-node" : matchingMode))
    : null;
  if (byMode) {
    return byMode;
  }

  const matchingCwd = normalizeText(context.cwd);
  const byCwd = matchingCwd ? candidates.find((node) => node.cwd === matchingCwd) : null;
  if (byCwd) {
    return byCwd;
  }

  return candidates[0] ?? null;
}

export function resetExecutionNodeRegistry(): void {
  executionNodeRegistry.clear();
  clearStoredExecutionNodes();
}