import assert from "node:assert/strict";
import test from "node:test";

import type { NodeDispatchRecord } from "./nodeDispatch";
import type { NodeHealthSnapshot } from "./nodeHealth";
import { renderOperatorView, type OperatorViewState } from "./operatorView";
import type { NodeReadinessEvaluation } from "./nodeReadiness";
import type { NodeRegistryEntry } from "./nodeRegistry";
import type { NodeRoutingSimulationResult } from "./nodeRoutingSimulation";

function createNode(overrides: Partial<NodeRegistryEntry> = {}): NodeRegistryEntry {
  return {
    node_id: overrides.node_id ?? "node-01",
    hostname: overrides.hostname ?? "validator-01",
    platform: overrides.platform ?? "windows",
    status: overrides.status ?? "available",
    capabilities: overrides.capabilities ?? ["inspection", "validation-check"],
    last_seen_at: overrides.last_seen_at ?? "2026-05-04T18:00:00.000Z",
  };
}

function createHealth(overrides: Partial<NodeHealthSnapshot> = {}): NodeHealthSnapshot {
  return {
    node_id: overrides.node_id ?? "node-01",
    checked_at: overrides.checked_at ?? "2026-05-04T18:01:00.000Z",
    status: overrides.status ?? "healthy",
    latency_ms: overrides.latency_ms,
    uptime_seconds: overrides.uptime_seconds,
    load_average: overrides.load_average,
    warnings: overrides.warnings ?? [],
    execution_ready: false,
  };
}

function createReadiness(overrides: Partial<NodeReadinessEvaluation> = {}): NodeReadinessEvaluation {
  return {
    node_id: overrides.node_id ?? "node-01",
    evaluated_at: overrides.evaluated_at ?? "2026-05-04T18:02:00.000Z",
    readiness_status: overrides.readiness_status ?? "ready_candidate",
    reasons: overrides.reasons ?? [],
    required_capabilities: overrides.required_capabilities ?? ["inspection"],
    missing_capabilities: overrides.missing_capabilities ?? [],
    health_status: overrides.health_status ?? "healthy",
    execution_ready: false,
  };
}

function createRouting(overrides: Partial<NodeRoutingSimulationResult> = {}): NodeRoutingSimulationResult {
  return {
    simulated: true,
    task_id: overrides.task_id ?? "task-01",
    required_capabilities: overrides.required_capabilities ?? ["inspection"],
    selected_node_id: overrides.selected_node_id ?? "node-01",
    candidate_nodes: overrides.candidate_nodes ?? ["node-01"],
    blocked_nodes: overrides.blocked_nodes ?? [],
    routing_allowed: false,
  };
}

function createDispatch(overrides: Partial<NodeDispatchRecord> = {}): NodeDispatchRecord {
  return {
    dispatched: overrides.dispatched ?? true,
    node_id: overrides.node_id ?? "node-01",
    task_id: overrides.task_id ?? "task-01",
    reason: overrides.reason ?? "dispatch intent recorded",
  };
}

function createState(overrides: Partial<OperatorViewState> = {}): OperatorViewState {
  return {
    nodes: overrides.nodes ?? [createNode()],
    healthSnapshots: overrides.healthSnapshots ?? [createHealth()],
    readinessResults: overrides.readinessResults ?? [createReadiness()],
    routingResults: overrides.routingResults ?? [createRouting()],
    dispatchResults: overrides.dispatchResults ?? [createDispatch()],
  };
}

test("operator view renders all sections", () => {
  const result = renderOperatorView(createState());

  assert.equal(Array.isArray(result.nodes), true);
  assert.equal(Array.isArray(result.health), true);
  assert.equal(Array.isArray(result.readiness), true);
  assert.equal(Array.isArray(result.routing_simulations), true);
  assert.equal(Array.isArray(result.dispatch_log), true);
});

test("data is correctly aggregated", () => {
  const result = renderOperatorView(createState());

  assert.equal(result.nodes[0]?.node_id, "node-01");
  assert.equal(result.health[0]?.status, "healthy");
  assert.equal(result.readiness[0]?.readiness_status, "ready_candidate");
  assert.equal(result.routing_simulations[0]?.selected_node_id, "node-01");
  assert.equal(result.dispatch_log[0]?.reason, "dispatch intent recorded");
});

test("no mutation occurs", () => {
  const state = createState({
    nodes: [createNode({ capabilities: ["inspection"] })],
    healthSnapshots: [createHealth({ warnings: ["watch cpu"] })],
    readinessResults: [createReadiness({ reasons: ["ready"], required_capabilities: ["inspection"], missing_capabilities: [] })],
    routingResults: [createRouting({ candidate_nodes: ["node-01"], blocked_nodes: [{ node_id: "node-02", reason: "health not healthy" }] })],
    dispatchResults: [createDispatch()],
  });
  const stateBefore = JSON.stringify(state);
  const result = renderOperatorView(state);

  result.nodes[0]?.capabilities.push("validation-check");
  result.health[0]?.warnings.push("late mutation");
  result.readiness[0]?.reasons.push("late reason");
  result.routing_simulations[0]?.candidate_nodes.push("node-99");
  result.routing_simulations[0]?.blocked_nodes.push({ node_id: "node-03", reason: "node unavailable" });
  result.dispatch_log.push(createDispatch({ node_id: "node-02" }));

  assert.equal(JSON.stringify(state), stateBefore);
});

test("empty states handled safely", () => {
  const result = renderOperatorView(createState({
    nodes: [],
    healthSnapshots: [],
    readinessResults: [],
    routingResults: [],
    dispatchResults: [],
  }));

  assert.deepEqual(result, {
    nodes: [],
    health: [],
    readiness: [],
    routing_simulations: [],
    dispatch_log: [],
  });
});

test("no execution or routing flags are triggered", () => {
  const result = renderOperatorView(createState());

  assert.equal("execution_triggered" in result, false);
  assert.equal("routing_triggered" in result, false);
  assert.equal("scheduled" in result, false);
  assert.equal("autonomous" in result, false);
});