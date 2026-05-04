import type { ExecutionNodeCapability } from "./executionNode";
import type { NodeHealthSnapshot } from "./nodeHealth";
import { evaluateNodeReadinessSet, type NodeReadinessEvaluation } from "./nodeReadiness";
import type { NodeRegistryEntry } from "./nodeRegistry";

export type NodeRoutingSimulationTask = {
  task_id: string;
  required_capabilities: ExecutionNodeCapability[];
};

export type NodeRoutingSimulationBlockedNode = {
  node_id: string;
  reason: string;
};

export type NodeRoutingSimulationResult = {
  simulated: true;
  task_id: string;
  required_capabilities: ExecutionNodeCapability[];
  selected_node_id?: string;
  candidate_nodes: string[];
  blocked_nodes: NodeRoutingSimulationBlockedNode[];
  routing_allowed: false;
};

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

function latestLatencyByNode(healthSnapshots: readonly NodeHealthSnapshot[]): Map<string, number | undefined> {
  const latest = new Map<string, NodeHealthSnapshot>();

  for (const snapshot of [...healthSnapshots].sort((left, right) => left.checked_at.localeCompare(right.checked_at))) {
    latest.set(snapshot.node_id, {
      ...snapshot,
      warnings: [...snapshot.warnings],
    });
  }

  return new Map(
    Array.from(latest.entries()).map(([nodeId, snapshot]) => [nodeId, snapshot.latency_ms]),
  );
}

function reasonFromEvaluation(evaluation: NodeReadinessEvaluation): string {
  if (evaluation.readiness_status === "unknown") {
    return "readiness unknown";
  }

  if (evaluation.missing_capabilities.length > 0) {
    return `missing capability: ${evaluation.missing_capabilities.join(", ")}`;
  }

  if (evaluation.reasons.some((reason) => reason.includes("registry status is"))) {
    return "node unavailable";
  }

  if (evaluation.reasons.some((reason) => reason.includes("health status is")) || evaluation.reasons.includes("critical health warning present")) {
    return "health not healthy";
  }

  return evaluation.reasons[0] ?? "not eligible for routing simulation";
}

export function simulateNodeRouting(
  task: NodeRoutingSimulationTask,
  nodes: readonly NodeRegistryEntry[],
  healthSnapshots: readonly NodeHealthSnapshot[],
): NodeRoutingSimulationResult {
  const requiredCapabilities = normalizeCapabilities(task.required_capabilities);
  const evaluations = evaluateNodeReadinessSet(nodes, healthSnapshots, requiredCapabilities);
  const latencyByNode = latestLatencyByNode(healthSnapshots);

  const candidateEvaluations = evaluations
    .filter((evaluation) => evaluation.readiness_status === "ready_candidate")
    .sort((left, right) => {
      const leftLatency = latencyByNode.get(left.node_id) ?? Number.POSITIVE_INFINITY;
      const rightLatency = latencyByNode.get(right.node_id) ?? Number.POSITIVE_INFINITY;

      if (leftLatency !== rightLatency) {
        return leftLatency - rightLatency;
      }

      return left.node_id.localeCompare(right.node_id);
    });

  return {
    simulated: true,
    task_id: task.task_id,
    required_capabilities: [...requiredCapabilities],
    selected_node_id: candidateEvaluations[0]?.node_id,
    candidate_nodes: candidateEvaluations.map((evaluation) => evaluation.node_id),
    blocked_nodes: evaluations
      .filter((evaluation) => evaluation.readiness_status !== "ready_candidate")
      .map((evaluation) => ({
        node_id: evaluation.node_id,
        reason: reasonFromEvaluation(evaluation),
      })),
    routing_allowed: false,
  };
}

export function renderNodeRoutingSimulation(result: NodeRoutingSimulationResult): string {
  const lines = [
    `Node routing simulation: ${result.task_id}`,
    `Required capabilities: ${result.required_capabilities.length ? result.required_capabilities.join(", ") : "none"}`,
    `Selected node id: ${result.selected_node_id ?? "none"}`,
    `Candidate nodes: ${result.candidate_nodes.length ? result.candidate_nodes.join(", ") : "none"}`,
    `Routing allowed: ${result.routing_allowed ? "true" : "false"}`,
    `Blocked nodes: ${result.blocked_nodes.length ? result.blocked_nodes.map((node) => `${node.node_id} (${node.reason})`).join("; ") : "none"}`,
    "Read-only routing simulation only. No routing, execution, remote mutation, scheduling, or autonomy is triggered.",
  ];

  return lines.join("\n");
}