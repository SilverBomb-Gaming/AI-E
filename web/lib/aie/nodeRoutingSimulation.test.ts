import assert from "node:assert/strict";
import test from "node:test";

import type { NodeHealthSnapshot } from "./nodeHealth";
import type { NodeRegistryEntry } from "./nodeRegistry";
import { renderNodeRoutingSimulation, simulateNodeRouting, type NodeRoutingSimulationTask } from "./nodeRoutingSimulation";

function createNode(overrides: Partial<NodeRegistryEntry> = {}): NodeRegistryEntry {
  return {
    node_id: overrides.node_id ?? "node-01",
    hostname: overrides.hostname ?? "validator-01",
    platform: overrides.platform ?? "windows",
    status: overrides.status ?? "available",
    capabilities: overrides.capabilities ?? ["inspection", "validation-check", "repo-scan"],
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

function createTask(overrides: Partial<NodeRoutingSimulationTask> = {}): NodeRoutingSimulationTask {
  return {
    task_id: overrides.task_id ?? "task-01",
    required_capabilities: overrides.required_capabilities ?? ["inspection"],
  };
}

test("selects healthy available capable node as simulated candidate", () => {
  const result = simulateNodeRouting(
    createTask({ required_capabilities: ["inspection", "validation-check"] }),
    [createNode({ node_id: "node-01" })],
    [createHealth({ node_id: "node-01", latency_ms: 10 })],
  );

  assert.equal(result.selected_node_id, "node-01");
  assert.deepEqual(result.candidate_nodes, ["node-01"]);
});

test("routing_allowed remains false", () => {
  const result = simulateNodeRouting(
    createTask(),
    [createNode()],
    [createHealth()],
  );

  assert.equal(result.routing_allowed, false);
});

test("missing capability blocks node", () => {
  const result = simulateNodeRouting(
    createTask({ required_capabilities: ["inspection", "repo-scan"] }),
    [createNode({ node_id: "node-01", capabilities: ["inspection"] })],
    [createHealth({ node_id: "node-01" })],
  );

  assert.equal(result.selected_node_id, undefined);
  assert.deepEqual(result.blocked_nodes, [{ node_id: "node-01", reason: "missing capability: repo-scan" }]);
});

test("degraded and unreachable health blocks node", () => {
  const result = simulateNodeRouting(
    createTask(),
    [createNode({ node_id: "node-degraded" }), createNode({ node_id: "node-unreachable" })],
    [
      createHealth({ node_id: "node-degraded", status: "degraded" }),
      createHealth({ node_id: "node-unreachable", status: "unreachable" }),
    ],
  );

  assert.ok(result.blocked_nodes.some((node) => node.node_id === "node-degraded" && node.reason === "health not healthy"));
  assert.ok(result.blocked_nodes.some((node) => node.node_id === "node-unreachable" && node.reason === "health not healthy"));
});

test("offline node blocks node", () => {
  const result = simulateNodeRouting(
    createTask(),
    [createNode({ node_id: "node-offline", status: "offline" })],
    [createHealth({ node_id: "node-offline" })],
  );

  assert.deepEqual(result.blocked_nodes, [{ node_id: "node-offline", reason: "node unavailable" }]);
});

test("deterministic tie-break works", () => {
  const result = simulateNodeRouting(
    createTask(),
    [createNode({ node_id: "node-b" }), createNode({ node_id: "node-a" })],
    [
      createHealth({ node_id: "node-b", latency_ms: 20 }),
      createHealth({ node_id: "node-a", latency_ms: 20 }),
    ],
  );

  assert.equal(result.selected_node_id, "node-a");
  assert.deepEqual(result.candidate_nodes, ["node-a", "node-b"]);
});

test("input task nodes and health are not mutated", () => {
  const task = createTask({ required_capabilities: ["inspection", "inspection"] });
  const nodes = [createNode({ capabilities: ["inspection", "repo-scan"] })];
  const health = [createHealth({ warnings: ["watch cpu"] })];
  const taskBefore = JSON.stringify(task);
  const nodesBefore = JSON.stringify(nodes);
  const healthBefore = JSON.stringify(health);

  const result = simulateNodeRouting(task, nodes, health);
  task.required_capabilities.push("validation-check");
  nodes[0]?.capabilities.push("test-run");
  health[0]?.warnings.push("late mutation");

  assert.equal(JSON.stringify({ ...task, required_capabilities: ["inspection", "inspection"] }), taskBefore);
  assert.equal(JSON.stringify([{ ...nodes[0], capabilities: ["inspection", "repo-scan"] }]), nodesBefore);
  assert.equal(JSON.stringify([{ ...health[0], warnings: ["watch cpu"] }]), healthBefore);
  assert.equal(result.routing_allowed, false);
});

test("no routing or execution flags are introduced", () => {
  const result = simulateNodeRouting(
    createTask(),
    [createNode()],
    [createHealth()],
  );
  const rendered = renderNodeRoutingSimulation(result);

  assert.equal("execution_triggered" in result, false);
  assert.equal("routing_triggered" in result, false);
  assert.match(rendered, /Routing allowed: false/);
  assert.match(rendered, /Read-only routing simulation only/);
});