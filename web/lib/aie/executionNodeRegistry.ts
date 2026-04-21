import type { ExecutionActionPreview } from "./types";
import {
  createExecutionNodeDescriptor,
  getExecutionNodeCapabilitiesForAction,
  supportsExecutionNodeCapabilities,
  validateExecutionActionForNode,
  type ExecutionNodeCapability,
  type ExecutionNodeDescriptor,
} from "./executionNode";

type ExecutionNodeSelectionContext = {
  runtimeMode?: string;
  preferredNodeId?: string;
  cwd?: string;
};

type ListAvailableExecutionNodesOptions = {
  requestedCapabilities?: ExecutionNodeCapability[];
  includeBusy?: boolean;
};

const executionNodeRegistry = new Map<string, ExecutionNodeDescriptor>();

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function supportsCapabilities(node: ExecutionNodeDescriptor, capabilities: ExecutionNodeCapability[]): boolean {
  return supportsExecutionNodeCapabilities(node, capabilities);
}

export type ExecutionNodeDispatchValidation = {
  accepted: boolean;
  reason?: string;
  node?: ExecutionNodeDescriptor;
};

export function registerExecutionNode(node: ExecutionNodeDescriptor): ExecutionNodeDescriptor {
  const existing = executionNodeRegistry.get(node.id);
  const normalized = createExecutionNodeDescriptor({
    ...node,
    createdAt: existing?.createdAt ?? node.createdAt,
    updatedAt: new Date().toISOString(),
    active: node.active,
  });
  executionNodeRegistry.set(normalized.id, normalized);
  return normalized;
}

export function unregisterExecutionNode(nodeId: string): boolean {
  return executionNodeRegistry.delete(normalizeText(nodeId));
}

export function listExecutionNodes(): ExecutionNodeDescriptor[] {
  return [...executionNodeRegistry.values()].sort((left, right) => {
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

export function listAvailableExecutionNodes(options: ListAvailableExecutionNodesOptions = {}): ExecutionNodeDescriptor[] {
  const requestedCapabilities = options.requestedCapabilities ?? [];

  return listExecutionNodes().filter((node) => {
    if (!node.active) {
      return false;
    }

    if (!options.includeBusy && node.busy) {
      return false;
    }

    if (requestedCapabilities.length && !supportsCapabilities(node, requestedCapabilities)) {
      return false;
    }

    return true;
  });
}

export function getExecutionNode(nodeId: string): ExecutionNodeDescriptor | null {
  return executionNodeRegistry.get(normalizeText(nodeId)) ?? null;
}

export function setExecutionNodeActive(nodeId: string, active: boolean): ExecutionNodeDescriptor | null {
  const existing = getExecutionNode(nodeId);
  if (!existing) {
    return null;
  }

  return registerExecutionNode({
    ...existing,
    active,
  });
}

export function markExecutionNodeBusy(nodeId: string, busy = true): ExecutionNodeDescriptor | null {
  const existing = getExecutionNode(nodeId);
  if (!existing) {
    return null;
  }

  return registerExecutionNode({
    ...existing,
    busy,
  });
}

export function validateExecutionNodeDispatch(
  nodeId: string,
  params: {
    requestedCapabilities: ExecutionNodeCapability[];
    action?: ExecutionActionPreview;
  },
): ExecutionNodeDispatchValidation {
  const node = getExecutionNode(nodeId);
  if (!node) {
    return {
      accepted: false,
      reason: `Execution node ${normalizeText(nodeId) || "unknown"} is not registered.`,
    };
  }

  if (!node.active) {
    return {
      accepted: false,
      reason: `Execution node ${node.id} is inactive.`,
    };
  }

  if (node.busy) {
    return {
      accepted: false,
      reason: `Execution node ${node.id} is busy.`,
    };
  }

  if (!supportsCapabilities(node, params.requestedCapabilities)) {
    return {
      accepted: false,
      reason: `Execution node ${node.id} does not support ${params.requestedCapabilities.join(",") || "the requested capabilities"}.`,
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
}