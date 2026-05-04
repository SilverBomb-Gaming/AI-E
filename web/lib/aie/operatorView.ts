import type { NodeDispatchRecord } from "./nodeDispatch";
import type { NodeHealthSnapshot } from "./nodeHealth";
import type { NodeReadinessEvaluation } from "./nodeReadiness";
import type { NodeRegistryEntry } from "./nodeRegistry";
import type { NodeRoutingSimulationResult } from "./nodeRoutingSimulation";

export type OperatorViewState = {
  nodes: readonly NodeRegistryEntry[];
  healthSnapshots: readonly NodeHealthSnapshot[];
  readinessResults: readonly NodeReadinessEvaluation[];
  routingResults: readonly NodeRoutingSimulationResult[];
  dispatchResults: readonly NodeDispatchRecord[];
};

export type OperatorViewResult = {
  nodes: NodeRegistryEntry[];
  health: NodeHealthSnapshot[];
  readiness: NodeReadinessEvaluation[];
  routing_simulations: NodeRoutingSimulationResult[];
  dispatch_log: NodeDispatchRecord[];
};

function renderNodeLine(node: NodeRegistryEntry): string {
  return `- ${node.node_id} [${node.status}] ${node.platform} capabilities: ${node.capabilities.length ? node.capabilities.join(", ") : "none"}`;
}

function renderHealthLine(snapshot: NodeHealthSnapshot): string {
  return `- ${snapshot.node_id} ${snapshot.status} latency: ${snapshot.latency_ms ?? "unknown"}${typeof snapshot.latency_ms === "number" ? "ms" : ""} warnings: ${snapshot.warnings.length ? snapshot.warnings.join(", ") : "none"}`;
}

function renderReadinessLine(result: NodeReadinessEvaluation): string {
  return `- ${result.node_id} ${result.readiness_status} execution_ready: ${result.execution_ready ? "true" : "false"}`;
}

function renderRoutingLine(result: NodeRoutingSimulationResult): string {
  return `- ${result.task_id} -> ${result.selected_node_id ?? "none"} simulated only routing_allowed: ${result.routing_allowed ? "true" : "false"}`;
}

function renderDispatchLine(result: NodeDispatchRecord): string {
  return `- ${result.task_id} -> ${result.node_id} ${result.reason ?? (result.dispatched ? "dispatch intent recorded" : "dispatch blocked")}`;
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

function cloneNodes(nodes: readonly NodeRegistryEntry[]): NodeRegistryEntry[] {
  return nodes.map((node) => ({
    ...node,
    capabilities: [...node.capabilities],
  }));
}

function cloneHealthSnapshots(healthSnapshots: readonly NodeHealthSnapshot[]): NodeHealthSnapshot[] {
  return healthSnapshots.map((snapshot) => ({
    ...snapshot,
    warnings: [...snapshot.warnings],
  }));
}

function cloneReadinessResults(readinessResults: readonly NodeReadinessEvaluation[]): NodeReadinessEvaluation[] {
  return readinessResults.map((result) => ({
    ...result,
    reasons: [...result.reasons],
    required_capabilities: [...result.required_capabilities],
    missing_capabilities: [...result.missing_capabilities],
  }));
}

function cloneRoutingResults(routingResults: readonly NodeRoutingSimulationResult[]): NodeRoutingSimulationResult[] {
  return routingResults.map((result) => ({
    ...result,
    required_capabilities: [...result.required_capabilities],
    candidate_nodes: [...result.candidate_nodes],
    blocked_nodes: result.blocked_nodes.map((node) => ({ ...node })),
  }));
}

function cloneDispatchResults(dispatchResults: readonly NodeDispatchRecord[]): NodeDispatchRecord[] {
  return dispatchResults.map((result) => ({ ...result }));
}

export function renderOperatorView(state: OperatorViewState): OperatorViewResult {
  return {
    nodes: cloneNodes(state.nodes),
    health: cloneHealthSnapshots(state.healthSnapshots),
    readiness: cloneReadinessResults(state.readinessResults),
    routing_simulations: cloneRoutingResults(state.routingResults),
    dispatch_log: cloneDispatchResults(state.dispatchResults),
  };
}

export function renderOperatorViewSummary(view: OperatorViewResult): string {
  const lines = [
    "AI-E Operator View",
    "",
    ...renderSection("Nodes", view.nodes, renderNodeLine, "- none"),
    "",
    ...renderSection("Health", view.health, renderHealthLine, "- none"),
    "",
    ...renderSection("Readiness", view.readiness, renderReadinessLine, "- none"),
    "",
    ...renderSection("Routing Simulations", view.routing_simulations, renderRoutingLine, "- none"),
    "",
    ...renderSection("Dispatch Log", view.dispatch_log, renderDispatchLine, "- none"),
    "",
    "Safety:",
    "- no execution performed",
    "- routing_allowed false",
    "- autonomy unchanged",
  ];

  return lines.join("\n");
}