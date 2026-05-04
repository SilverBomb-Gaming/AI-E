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