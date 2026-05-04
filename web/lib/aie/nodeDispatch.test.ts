import assert from "node:assert/strict";
import test from "node:test";

import { recordNodeHealthSnapshot, resetNodeHealthSnapshotsForTests, type NodeHealthSnapshot } from "./nodeHealth";
import { dispatchTaskToNode } from "./nodeDispatch";
import { registerNode, resetNodeRegistryForTests, type NodeRegistryEntry } from "./nodeRegistry";
import type { NodeRoutingSimulationTask } from "./nodeRoutingSimulation";

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

test.beforeEach(() => {
  resetNodeRegistryForTests();
  resetNodeHealthSnapshotsForTests();
});

test("valid node receives dispatch intent record", () => {
  registerNode(createNode({ node_id: "node-01" }));
  recordNodeHealthSnapshot(createHealth({ node_id: "node-01", latency_ms: 10 }));

  const result = dispatchTaskToNode(createTask(), "node-01");

  assert.deepEqual(result, {
    dispatched: true,
    node_id: "node-01",
    task_id: "task-01",
    reason: "dispatch intent recorded",
  });
});

test("invalid node blocks dispatch", () => {
  registerNode(createNode({ node_id: "node-01" }));
  recordNodeHealthSnapshot(createHealth({ node_id: "node-01" }));

  const result = dispatchTaskToNode(createTask(), "node-missing");

  assert.deepEqual(result, {
    dispatched: false,
    node_id: "node-missing",
    task_id: "task-01",
    reason: "node not found",
  });
});

test("unhealthy node blocks dispatch", () => {
  registerNode(createNode({ node_id: "node-01" }));
  recordNodeHealthSnapshot(createHealth({ node_id: "node-01", status: "degraded" }));

  const result = dispatchTaskToNode(createTask(), "node-01");

  assert.deepEqual(result, {
    dispatched: false,
    node_id: "node-01",
    task_id: "task-01",
    reason: "health not healthy",
  });
});

test("missing capability blocks dispatch", () => {
  registerNode(createNode({ node_id: "node-01", capabilities: ["inspection"] }));
  recordNodeHealthSnapshot(createHealth({ node_id: "node-01" }));

  const result = dispatchTaskToNode(
    createTask({ required_capabilities: ["inspection", "repo-scan"] }),
    "node-01",
  );

  assert.deepEqual(result, {
    dispatched: false,
    node_id: "node-01",
    task_id: "task-01",
    reason: "missing capability: repo-scan",
  });
});

test("only one dispatch is allowed per explicit call", () => {
  registerNode(createNode({ node_id: "node-a" }));
  registerNode(createNode({ node_id: "node-b", hostname: "validator-02" }));
  recordNodeHealthSnapshot(createHealth({ node_id: "node-a", latency_ms: 10 }));
  recordNodeHealthSnapshot(createHealth({ node_id: "node-b", latency_ms: 25 }));

  const result = dispatchTaskToNode(createTask(), "node-a");

  assert.equal(result.dispatched, true);
  assert.equal(result.node_id, "node-a");
  assert.equal("dispatches" in result, false);
});

test("dispatch blocks when explicit node does not match routing simulation", () => {
  registerNode(createNode({ node_id: "node-a" }));
  registerNode(createNode({ node_id: "node-b", hostname: "validator-02" }));
  recordNodeHealthSnapshot(createHealth({ node_id: "node-a", latency_ms: 10 }));
  recordNodeHealthSnapshot(createHealth({ node_id: "node-b", latency_ms: 50 }));

  const result = dispatchTaskToNode(createTask(), "node-b");

  assert.deepEqual(result, {
    dispatched: false,
    node_id: "node-b",
    task_id: "task-01",
    reason: "selected node does not match routing simulation",
  });
});

test("no loop behavior or remote execution fields are introduced", () => {
  registerNode(createNode({ node_id: "node-01" }));
  recordNodeHealthSnapshot(createHealth({ node_id: "node-01", latency_ms: 10 }));

  const result = dispatchTaskToNode(createTask(), "node-01");

  assert.equal("execution_triggered" in result, false);
  assert.equal("scheduled" in result, false);
  assert.equal("autonomous" in result, false);
  assert.equal("loop_count" in result, false);
});