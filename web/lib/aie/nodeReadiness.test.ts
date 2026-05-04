import assert from "node:assert/strict";
import test from "node:test";

import { type NodeHealthSnapshot } from "./nodeHealth";
import { evaluateNodeReadiness, evaluateNodeReadinessSet, renderNodeReadiness } from "./nodeReadiness";
import { type NodeRegistryEntry } from "./nodeRegistry";

function createNode(overrides: Partial<NodeRegistryEntry> = {}): NodeRegistryEntry {
  return {
    node_id: overrides.node_id ?? "node-01",
    hostname: overrides.hostname ?? "validator-01",
    platform: overrides.platform ?? "windows",
    status: overrides.status ?? "available",
    capabilities: overrides.capabilities ?? ["inspection", "validation-check", "repo-scan"],
    last_seen_at: overrides.last_seen_at ?? "2026-05-04T17:00:00.000Z",
  };
}

function createHealth(overrides: Partial<NodeHealthSnapshot> = {}): NodeHealthSnapshot {
  return {
    node_id: overrides.node_id ?? "node-01",
    checked_at: overrides.checked_at ?? "2026-05-04T17:01:00.000Z",
    status: overrides.status ?? "healthy",
    latency_ms: overrides.latency_ms,
    uptime_seconds: overrides.uptime_seconds,
    load_average: overrides.load_average,
    warnings: overrides.warnings ?? [],
    execution_ready: false,
  };
}

test("healthy available capable node becomes ready_candidate", () => {
  const evaluation = evaluateNodeReadiness(
    createNode(),
    createHealth(),
    ["inspection", "validation-check"],
    { evaluatedAt: "2026-05-04T17:02:00.000Z" },
  );

  assert.equal(evaluation.readiness_status, "ready_candidate");
  assert.deepEqual(evaluation.missing_capabilities, []);
});

test("ready_candidate still has execution_ready false", () => {
  const evaluation = evaluateNodeReadiness(createNode(), createHealth(), ["inspection"]);

  assert.equal(evaluation.readiness_status, "ready_candidate");
  assert.equal(evaluation.execution_ready, false);
});

test("offline node is not_ready", () => {
  const evaluation = evaluateNodeReadiness(
    createNode({ status: "offline" }),
    createHealth(),
    ["inspection"],
  );

  assert.equal(evaluation.readiness_status, "not_ready");
  assert.ok(evaluation.reasons.includes("registry status is offline"));
});

test("degraded node is not_ready", () => {
  const evaluation = evaluateNodeReadiness(
    createNode(),
    createHealth({ status: "degraded" }),
    ["inspection"],
  );

  assert.equal(evaluation.readiness_status, "not_ready");
  assert.ok(evaluation.reasons.includes("health status is degraded"));
});

test("unknown health produces unknown", () => {
  const evaluation = evaluateNodeReadiness(createNode(), null, ["inspection"]);

  assert.equal(evaluation.readiness_status, "unknown");
  assert.equal(evaluation.health_status, "unknown");
});

test("missing capability produces not_ready", () => {
  const evaluation = evaluateNodeReadiness(
    createNode({ capabilities: ["inspection"] }),
    createHealth(),
    ["inspection", "repo-scan"],
  );

  assert.equal(evaluation.readiness_status, "not_ready");
  assert.deepEqual(evaluation.missing_capabilities, ["repo-scan"]);
});

test("critical warning produces not_ready", () => {
  const evaluation = evaluateNodeReadiness(
    createNode(),
    createHealth({ warnings: ["critical thermal state"] }),
    ["inspection"],
  );

  assert.equal(evaluation.readiness_status, "not_ready");
  assert.ok(evaluation.reasons.includes("critical health warning present"));
});

test("evaluation does not mutate node or health input", () => {
  const node = createNode({ capabilities: ["inspection", "repo-scan"] });
  const health = createHealth({ warnings: ["watch cpu"] });
  const nodeBefore = JSON.stringify(node);
  const healthBefore = JSON.stringify(health);

  const evaluation = evaluateNodeReadiness(node, health, ["inspection"]);
  node.capabilities.push("validation-check");
  health.warnings.push("late mutation");

  assert.equal(JSON.stringify({ ...node, capabilities: ["inspection", "repo-scan"] }), nodeBefore);
  assert.equal(JSON.stringify({ ...health, warnings: ["watch cpu"] }), healthBefore);
  assert.equal(evaluation.execution_ready, false);
});

test("no routing or execution flags are introduced", () => {
  const evaluations = evaluateNodeReadinessSet(
    [createNode()],
    [createHealth()],
    ["inspection"],
    { evaluatedAt: "2026-05-04T17:03:00.000Z" },
  );
  const rendered = renderNodeReadiness(evaluations[0]);

  assert.equal(evaluations[0]?.execution_ready, false);
  assert.equal("execution_triggered" in (evaluations[0] ?? {}), false);
  assert.equal("routing_triggered" in (evaluations[0] ?? {}), false);
  assert.match(rendered, /Readiness status: ready_candidate/);
  assert.match(rendered, /Read-only readiness evaluation only/);
});