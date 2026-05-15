import type { ExecutionNodeCapability } from "./executionNode";
import type { NodeHealthSnapshot, NodeHealthStatus } from "./nodeHealth";
import type { NodeRegistryEntry } from "./nodeRegistry";

export type NodeReadinessStatus = "ready_candidate" | "not_ready" | "unknown";

export type NodeReadinessEvaluation = {
  node_id: string;
  evaluated_at: string;
  readiness_status: NodeReadinessStatus;
  reasons: string[];
  required_capabilities: ExecutionNodeCapability[];
  missing_capabilities: ExecutionNodeCapability[];
  health_status: NodeHealthStatus;
  execution_ready: false;
};

function normalizeTimestamp(value: string | undefined): string {
  if (typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value))) {
    return value.trim();
  }

  return new Date().toISOString();
}

function normalizeCapabilities(capabilities: readonly ExecutionNodeCapability[]): ExecutionNodeCapability[] {
  const seen = new Set<ExecutionNodeCapability>();
  const supportedCapabilities: ExecutionNodeCapability[] = ["inspection", "validation-check", "file-write", "test-run", "repo-scan"];

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

  return supportedCapabilities
    .filter((capability): capability is ExecutionNodeCapability => seen.has(capability));
}

function hasCriticalWarning(warnings: readonly string[]): boolean {
  return warnings.some((warning) => /critical|fatal|blocked|unreachable/i.test(warning));
}

function latestHealthForNode(nodeId: string, healthSnapshots: readonly NodeHealthSnapshot[]): NodeHealthSnapshot | null {
  const matches = healthSnapshots
    .filter((snapshot) => snapshot.node_id === nodeId)
    .sort((left, right) => left.checked_at.localeCompare(right.checked_at));

  return matches.length > 0
    ? {
      ...matches[matches.length - 1],
      warnings: [...matches[matches.length - 1].warnings],
    }
    : null;
}

export function evaluateNodeReadiness(
  node: NodeRegistryEntry,
  latestHealth: NodeHealthSnapshot | null,
  requiredCapabilities: readonly ExecutionNodeCapability[],
  options?: { evaluatedAt?: string },
): NodeReadinessEvaluation {
  const reasons: string[] = [];
  const normalizedRequiredCapabilities = normalizeCapabilities(requiredCapabilities);
  const missingCapabilities = normalizedRequiredCapabilities.filter((capability) => !node.capabilities.includes(capability));
  const healthStatus = latestHealth?.status ?? "unknown";
  let readinessStatus: NodeReadinessStatus = "ready_candidate";

  if (node.status !== "available") {
    readinessStatus = "not_ready";
    reasons.push(`registry status is ${node.status}`);
  }

  if (!latestHealth) {
    readinessStatus = "unknown";
    reasons.push("latest health snapshot is unavailable");
  } else {
    if (latestHealth.status === "unknown") {
      readinessStatus = "unknown";
      reasons.push("health status is unknown");
    } else if (latestHealth.status !== "healthy") {
      readinessStatus = "not_ready";
      reasons.push(`health status is ${latestHealth.status}`);
    }

    if (hasCriticalWarning(latestHealth.warnings)) {
      readinessStatus = "not_ready";
      reasons.push("critical health warning present");
    }
  }

  if (missingCapabilities.length > 0) {
    readinessStatus = "not_ready";
    reasons.push(`missing capabilities: ${missingCapabilities.join(", ")}`);
  }

  return {
    node_id: node.node_id,
    evaluated_at: normalizeTimestamp(options?.evaluatedAt),
    readiness_status: readinessStatus,
    reasons,
    required_capabilities: [...normalizedRequiredCapabilities],
    missing_capabilities: [...missingCapabilities],
    health_status: healthStatus,
    execution_ready: false,
  };
}

export function evaluateNodeReadinessSet(
  nodes: readonly NodeRegistryEntry[],
  healthSnapshots: readonly NodeHealthSnapshot[],
  requiredCapabilities: readonly ExecutionNodeCapability[],
  options?: { evaluatedAt?: string },
): NodeReadinessEvaluation[] {
  return [...nodes]
    .sort((left, right) => left.node_id.localeCompare(right.node_id))
    .map((node) => evaluateNodeReadiness(
      {
        ...node,
        capabilities: [...node.capabilities],
      },
      latestHealthForNode(node.node_id, healthSnapshots),
      requiredCapabilities,
      options,
    ));
}

export function renderNodeReadiness(evaluation: NodeReadinessEvaluation): string {
  const lines = [
    `Node readiness evaluation: ${evaluation.node_id}`,
    `Evaluated at: ${evaluation.evaluated_at}`,
    `Readiness status: ${evaluation.readiness_status}`,
    `Health status: ${evaluation.health_status}`,
    `Required capabilities: ${evaluation.required_capabilities.length ? evaluation.required_capabilities.join(", ") : "none"}`,
    `Missing capabilities: ${evaluation.missing_capabilities.length ? evaluation.missing_capabilities.join(", ") : "none"}`,
    `Execution ready: ${evaluation.execution_ready ? "true" : "false"}`,
    `Reasons: ${evaluation.reasons.length ? evaluation.reasons.join("; ") : "none"}`,
    "Read-only readiness evaluation only. No routing, execution, remote mutation, scheduling, or autonomy is triggered.",
  ];

  return lines.join("\n");
}