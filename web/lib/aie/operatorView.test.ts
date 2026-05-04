import assert from "node:assert/strict";
import test from "node:test";

import type { NodeDispatchRecord } from "./nodeDispatch";
import type { NodeHealthSnapshot } from "./nodeHealth";
import { renderOperatorView, renderOperatorViewSummary, type OperatorViewState } from "./operatorView";
import type { OperatorViewSnapshot } from "./operatorView.types";
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
  const selectedNodeId = Object.prototype.hasOwnProperty.call(overrides, "selected_node_id")
    ? overrides.selected_node_id
    : "node-01";

  return {
    simulated: true,
    task_id: overrides.task_id ?? "task-01",
    required_capabilities: overrides.required_capabilities ?? ["inspection"],
    selected_node_id: selectedNodeId,
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

  assert.equal(typeof result.timestamp, "string");
  assert.equal(Array.isArray(result.nodes), true);
  assert.equal(typeof result.summary, "object");
  assert.equal(typeof result.routing, "object");
  assert.equal(typeof result.dispatch, "object");
  assert.equal(typeof result.safety, "object");
});

test("summary renderer includes nodes health readiness routing and dispatch sections", () => {
  const summary = renderOperatorViewSummary(renderOperatorView(createState()));

  assert.match(summary, /^AI-E Operator View/m);
  assert.match(summary, /^Nodes:/m);
  assert.match(summary, /^Health:/m);
  assert.match(summary, /^Readiness:/m);
  assert.match(summary, /^Routing Simulations:/m);
  assert.match(summary, /^Dispatch Log:/m);
});

test("summary renderer includes safety markers", () => {
  const summary = renderOperatorViewSummary(renderOperatorView(createState()));

  assert.match(summary, /- no execution performed/);
  assert.match(summary, /- routing_allowed false/);
  assert.match(summary, /- autonomy unchanged/);
});

test("data is correctly aggregated", () => {
  const result = renderOperatorView(createState());

  assert.equal(result.nodes[0]?.id, "node-01");
  assert.equal(result.nodes[0]?.status, "healthy");
  assert.equal(result.nodes[0]?.readiness, 1);
  assert.equal(result.routing.selectedNode, "node-01");
  assert.equal(result.dispatch.recent[0]?.intent, "dispatch intent recorded");
  assert.equal(result.summary.totalNodes, 1);
  assert.equal(result.summary.readyNodes, 1);
  assert.equal(result.summary.unhealthyNodes, 0);
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

  result.nodes[0]!.status = "unhealthy";
  result.routing.candidates.push({ nodeId: "node-99", score: 1 });
  result.dispatch.recent.push({ intent: "late", targetNode: "node-02", result: "blocked", timestamp: result.timestamp });

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
  const summary = renderOperatorViewSummary(result);

  assert.deepEqual(result, {
    timestamp: result.timestamp,
    nodes: [],
    summary: {
      totalNodes: 0,
      readyNodes: 0,
      unhealthyNodes: 0,
    },
    routing: {
      lastSimulation: null,
      candidates: [],
      selectedNode: null,
    },
    dispatch: {
      recent: [],
    },
    safety: {
      readOnly: true,
      executionEnabled: false,
    },
  });
  assert.match(summary, /^Nodes:\n- none/m);
  assert.match(summary, /^Dispatch Log:\n- none/m);
});

test("required fields and safety flags are always present", () => {
  const result = renderOperatorView(createState());

  assert.deepEqual(Object.keys(result).sort(), ["dispatch", "nodes", "routing", "safety", "summary", "timestamp"]);
  assert.equal(result.safety.readOnly, true);
  assert.equal(result.safety.executionEnabled, false);
  assert.equal("execution_triggered" in result, false);
  assert.equal("routing_triggered" in result, false);
});

test("schema shape validation matches OperatorViewSnapshot contract", () => {
  const result: OperatorViewSnapshot = renderOperatorView(createState());

  assert.equal(JSON.stringify(result, null, 2), `{
  "timestamp": "2026-05-04T18:02:00.000Z",
  "nodes": [
    {
      "id": "node-01",
      "status": "healthy",
      "readiness": 1,
      "lastHealthCheck": "2026-05-04T18:01:00.000Z"
    }
  ],
  "summary": {
    "totalNodes": 1,
    "readyNodes": 1,
    "unhealthyNodes": 0
  },
  "routing": {
    "lastSimulation": "task-01",
    "candidates": [
      {
        "nodeId": "node-01",
        "score": 1
      }
    ],
    "selectedNode": "node-01"
  },
  "dispatch": {
    "recent": [
      {
        "intent": "dispatch intent recorded",
        "targetNode": "node-01",
        "result": "simulated",
        "timestamp": "2026-05-04T18:02:00.000Z"
      }
    ]
  },
  "safety": {
    "readOnly": true,
    "executionEnabled": false
  }
}`);
});

test("unhealthy and blocked values are reflected in contract fields", () => {
  const result = renderOperatorView(createState({
    nodes: [createNode({ node_id: "node-02", status: "offline" })],
    healthSnapshots: [createHealth({ node_id: "node-02", status: "degraded", checked_at: "2026-05-04T18:03:00.000Z" })],
    readinessResults: [createReadiness({ node_id: "node-02", readiness_status: "not_ready", evaluated_at: "2026-05-04T18:04:00.000Z" })],
    routingResults: [createRouting({ task_id: "task-02", selected_node_id: undefined, candidate_nodes: [] })],
    dispatchResults: [createDispatch({ dispatched: false, node_id: "node-02", reason: "dispatch blocked" })],
  }));

  assert.equal(result.nodes[0]?.status, "unhealthy");
  assert.equal(result.nodes[0]?.readiness, 0);
  assert.equal(result.summary.unhealthyNodes, 1);
  assert.equal(result.routing.selectedNode, null);
  assert.equal(result.dispatch.recent[0]?.result, "blocked");
  assert.equal(result.safety.readOnly, true);
  assert.equal(result.safety.executionEnabled, false);
});
