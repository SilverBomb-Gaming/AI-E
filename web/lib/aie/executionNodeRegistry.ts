import type { ExecutionActionPreview } from "./types";
import {
  createExecutionNodeDescriptor,
  getExecutionNodeCapabilitiesForAction,
  type ExecutionNodeCapability,
  type ExecutionNodeDescriptor,
} from "./executionNode";

type ExecutionNodeSelectionContext = {
  runtimeMode?: string;
  preferredNodeId?: string;
  cwd?: string;
};

const executionNodeRegistry = new Map<string, ExecutionNodeDescriptor>();

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function supportsCapabilities(node: ExecutionNodeDescriptor, capabilities: ExecutionNodeCapability[]): boolean {
  return capabilities.every((capability) => node.capabilities.includes(capability));
}

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

    return left.id.localeCompare(right.id);
  });
}

export function getExecutionNode(nodeId: string): ExecutionNodeDescriptor | null {
  return executionNodeRegistry.get(normalizeText(nodeId)) ?? null;
}

export function chooseExecutionNodeForAction(
  action: ExecutionActionPreview | undefined,
  context: ExecutionNodeSelectionContext = {},
): ExecutionNodeDescriptor | null {
  const requestedCapabilities = getExecutionNodeCapabilitiesForAction(action);
  const nodes = listExecutionNodes().filter((node) => node.active);
  const candidates = requestedCapabilities.length
    ? nodes.filter((node) => supportsCapabilities(node, requestedCapabilities))
    : nodes;

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