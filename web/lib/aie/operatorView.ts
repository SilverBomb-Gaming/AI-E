import type { NodeDispatchRecord } from "./nodeDispatch";
import type { NodeHealthSnapshot } from "./nodeHealth";
import type { NodeReadinessEvaluation } from "./nodeReadiness";
import type { NodeRegistryEntry } from "./nodeRegistry";
import type { NodeRoutingSimulationResult } from "./nodeRoutingSimulation";
import type { OperatorViewSnapshot } from "./operatorView.types";

export type OperatorViewState = {
  nodes: readonly NodeRegistryEntry[];
  healthSnapshots: readonly NodeHealthSnapshot[];
  readinessResults: readonly NodeReadinessEvaluation[];
  routingResults: readonly NodeRoutingSimulationResult[];
  dispatchResults: readonly NodeDispatchRecord[];
};

export type OperatorViewResult = OperatorViewSnapshot;

function normalizeTimestamp(value: string | undefined): string {
  if (typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value))) {
    return value.trim();
  }

  return new Date().toISOString();
}

function latestHealthByNode(healthSnapshots: readonly NodeHealthSnapshot[]): Map<string, NodeHealthSnapshot> {
  const latest = new Map<string, NodeHealthSnapshot>();

  for (const snapshot of [...healthSnapshots].sort((left, right) => left.checked_at.localeCompare(right.checked_at))) {
    latest.set(snapshot.node_id, {
      ...snapshot,
      warnings: [...snapshot.warnings],
    });
  }

  return latest;
}

function latestReadinessByNode(readinessResults: readonly NodeReadinessEvaluation[]): Map<string, NodeReadinessEvaluation> {
  const latest = new Map<string, NodeReadinessEvaluation>();

  for (const result of [...readinessResults].sort((left, right) => left.evaluated_at.localeCompare(right.evaluated_at))) {
    latest.set(result.node_id, {
      ...result,
      reasons: [...result.reasons],
      required_capabilities: [...result.required_capabilities],
      missing_capabilities: [...result.missing_capabilities],
    });
  }

  return latest;
}

function buildSnapshotTimestamp(
  nodes: readonly NodeRegistryEntry[],
  healthSnapshots: readonly NodeHealthSnapshot[],
  readinessResults: readonly NodeReadinessEvaluation[],
): string {
  const timestamps = [
    ...nodes.map((node) => node.last_seen_at).filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    ...healthSnapshots.map((snapshot) => snapshot.checked_at),
    ...readinessResults.map((result) => result.evaluated_at),
  ].filter((value) => !Number.isNaN(Date.parse(value)));

  return timestamps.sort().at(-1) ?? new Date().toISOString();
}

function readinessScore(result: NodeReadinessEvaluation | undefined): number {
  return result?.readiness_status === "ready_candidate" ? 1 : 0;
}

function healthStatus(snapshot: NodeHealthSnapshot | undefined): "healthy" | "unhealthy" {
  return snapshot?.status === "healthy" ? "healthy" : "unhealthy";
}

function routingScore(rank: number, totalCandidates: number): number {
  return Math.max(totalCandidates - rank, 1);
}

function renderNodeLine(node: OperatorViewSnapshot["nodes"][number]): string {
  return `- ${node.id} [${node.status}] readiness: ${node.readiness} lastHealthCheck: ${node.lastHealthCheck}`;
}

function renderHealthLine(node: OperatorViewSnapshot["nodes"][number]): string {
  return `- ${node.id} ${node.status} lastHealthCheck: ${node.lastHealthCheck}`;
}

function renderReadinessLine(node: OperatorViewSnapshot["nodes"][number]): string {
  return `- ${node.id} readiness: ${node.readiness}`;
}

function renderRoutingLine(result: OperatorViewSnapshot["routing"]["candidates"][number], selectedNode: string | null): string {
  return `- ${result.nodeId} score: ${result.score}${selectedNode === result.nodeId ? " selected" : ""}`;
}

function renderDispatchLine(result: OperatorViewSnapshot["dispatch"]["recent"][number]): string {
  return `- ${result.intent} -> ${result.targetNode} ${result.result}`;
}

function renderSection<T>(title: string, values: readonly T[], renderLine: (value: T) => string, emptyLine: string): string[] {
  const lines = [`${title}:`];

  if (values.length === 0) {
    lines.push(emptyLine);
    return lines;
  }

  for (const value of values) {
    lines.push(renderLine(value));
  }

  return lines;
}

export function renderOperatorView(state: OperatorViewState): OperatorViewResult {
  const latestHealth = latestHealthByNode(state.healthSnapshots);
  const latestReadiness = latestReadinessByNode(state.readinessResults);
  const timestamp = buildSnapshotTimestamp(state.nodes, state.healthSnapshots, state.readinessResults);
  const latestRouting = [...state.routingResults]
    .map((result) => ({
      ...result,
      required_capabilities: [...result.required_capabilities],
      candidate_nodes: [...result.candidate_nodes],
      blocked_nodes: result.blocked_nodes.map((node) => ({ ...node })),
    }))
    .sort((left, right) => left.task_id.localeCompare(right.task_id))
    .at(-1);

  const nodes = [...state.nodes]
    .sort((left, right) => left.node_id.localeCompare(right.node_id))
    .map((node) => {
      const health = latestHealth.get(node.node_id);
      const readiness = latestReadiness.get(node.node_id);

      return {
        id: node.node_id,
        status: healthStatus(health),
        readiness: readinessScore(readiness),
        lastHealthCheck: normalizeTimestamp(health?.checked_at ?? node.last_seen_at),
      };
    });

  const routingCandidates = (latestRouting?.candidate_nodes ?? []).map((nodeId, index, allCandidates) => ({
    nodeId,
    score: routingScore(index, allCandidates.length),
  }));

  const dispatchRecent = [...state.dispatchResults].map((result) => ({
    intent: result.reason ?? (result.dispatched ? "dispatch intent recorded" : "dispatch blocked"),
    targetNode: result.node_id,
    result: result.dispatched ? "simulated" : "blocked",
    timestamp,
  }));

  const unhealthyNodes = nodes.filter((node) => node.status === "unhealthy").length;
  const readyNodes = nodes.filter((node) => node.readiness > 0).length;

  return {
    timestamp,
    nodes,
    summary: {
      totalNodes: nodes.length,
      readyNodes,
      unhealthyNodes,
    },
    routing: {
      lastSimulation: latestRouting?.task_id ?? null,
      candidates: routingCandidates,
      selectedNode: latestRouting?.selected_node_id ?? null,
    },
    dispatch: {
      recent: dispatchRecent,
    },
    safety: {
      readOnly: true,
      executionEnabled: false,
    },
  };
}

export function renderOperatorViewSummary(view: OperatorViewResult): string {
  const lines = [
    "AI-E Operator View",
    "",
    ...renderSection("Nodes", view.nodes, renderNodeLine, "- none"),
    "",
    ...renderSection("Health", view.nodes, renderHealthLine, "- none"),
    "",
    ...renderSection("Readiness", view.nodes, renderReadinessLine, "- none"),
    "",
    "Routing Simulations:",
    `- lastSimulation: ${view.routing.lastSimulation ?? "none"}`,
    `- selectedNode: ${view.routing.selectedNode ?? "none"}`,
    ...(view.routing.candidates.length > 0 ? view.routing.candidates.map((candidate) => renderRoutingLine(candidate, view.routing.selectedNode)) : ["- none"]),
    "",
    ...renderSection("Dispatch Log", view.dispatch.recent, renderDispatchLine, "- none"),
    "",
    "Safety:",
    "- no execution performed",
    `- routing_allowed ${view.routing.selectedNode ? "false" : "false"}`,
    "- autonomy unchanged",
  ];

  return lines.join("\n");
}