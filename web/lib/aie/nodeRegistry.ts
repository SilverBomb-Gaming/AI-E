import type { ExecutionNodeCapability } from "./executionNode";

export type NodeRegistryStatus = "available" | "offline" | "unknown";

export type NodeRegistryEntry = {
  node_id: string;
  hostname: string;
  platform: string;
  status: NodeRegistryStatus;
  capabilities: ExecutionNodeCapability[];
  last_seen_at?: string;
};

const nodeRegistry = new Map<string, NodeRegistryEntry>();

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTimestamp(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    return undefined;
  }

  return normalized;
}

function normalizeStatus(value: unknown): NodeRegistryStatus {
  return value === "available" || value === "offline" || value === "unknown"
    ? value
    : "unknown";
}

function normalizeCapabilities(capabilities: readonly ExecutionNodeCapability[]): ExecutionNodeCapability[] {
  const seen = new Set<ExecutionNodeCapability>();

  for (const capability of capabilities) {
    if (
      capability === "inspection"
      || capability === "validation-check"
      || capability === "file-write"
      || capability === "test-run"
      || capability === "repo-scan"
    ) {
      seen.add(capability);
    }
  }

  return ["inspection", "validation-check", "file-write", "test-run", "repo-scan"]
    .filter((capability): capability is ExecutionNodeCapability => seen.has(capability));
}

function cloneNode(node: NodeRegistryEntry): NodeRegistryEntry {
  return {
    ...node,
    capabilities: [...node.capabilities],
  };
}

function normalizeNode(node: NodeRegistryEntry): NodeRegistryEntry {
  return {
    node_id: normalizeText(node.node_id),
    hostname: normalizeText(node.hostname),
    platform: normalizeText(node.platform),
    status: normalizeStatus(node.status),
    capabilities: normalizeCapabilities(node.capabilities),
    last_seen_at: normalizeTimestamp(node.last_seen_at),
  };
}

export function registerNode(node: NodeRegistryEntry): NodeRegistryEntry {
  const normalized = normalizeNode(node);
  nodeRegistry.set(normalized.node_id, normalized);
  return cloneNode(normalized);
}

export function queryNodes(filters?: {
  status?: NodeRegistryStatus;
  capability?: ExecutionNodeCapability;
}): NodeRegistryEntry[] {
  return Array.from(nodeRegistry.values())
    .filter((node) => {
      if (filters?.status && node.status !== filters.status) {
        return false;
      }

      if (filters?.capability && !node.capabilities.includes(filters.capability)) {
        return false;
      }

      return true;
    })
    .sort((left, right) => left.node_id.localeCompare(right.node_id))
    .map((node) => cloneNode(node));
}

export function renderNodeRegistry(nodes: readonly NodeRegistryEntry[]): string {
  const lines = ["Node capability registry is read-only.", ""];

  if (nodes.length === 0) {
    lines.push("- No nodes are currently registered.");
  } else {
    for (const node of nodes) {
      lines.push(`${node.node_id} (${node.status})`);
      lines.push(`- Hostname: ${node.hostname}`);
      lines.push(`- Platform: ${node.platform}`);
      lines.push(`- Capabilities: ${node.capabilities.length ? node.capabilities.join(", ") : "none"}`);
      lines.push(`- Last seen: ${node.last_seen_at ?? "unknown"}`);
      lines.push("");
    }
  }

  lines.push("Read-only registry only. No routing, execution, remote mutation, scheduling, or autonomy is triggered.");
  return lines.join("\n");
}

export function resetNodeRegistryForTests(): void {
  nodeRegistry.clear();
}