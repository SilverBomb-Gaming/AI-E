import assert from "node:assert/strict";
import test from "node:test";

import {
  getLatestNodeHealth,
  queryNodeHealthSnapshots,
  recordNodeHealthSnapshot,
  renderNodeHealthSnapshot,
  resetNodeHealthSnapshotsForTests,
  type NodeHealthSnapshot,
} from "./nodeHealth";

function createSnapshot(overrides: Partial<NodeHealthSnapshot> = {}): NodeHealthSnapshot {
  return {
    node_id: overrides.node_id ?? "node-01",
    checked_at: overrides.checked_at ?? "2026-05-04T16:00:00.000Z",
    status: overrides.status ?? "healthy",
    latency_ms: overrides.latency_ms,
    uptime_seconds: overrides.uptime_seconds,
    load_average: overrides.load_average,
    warnings: overrides.warnings ?? [],
    execution_ready: false,
  };
}

test.afterEach(() => {
  resetNodeHealthSnapshotsForTests();
});

test("health snapshot can be recorded", () => {
  const snapshot = recordNodeHealthSnapshot(createSnapshot({ latency_ms: 12 }));

  assert.equal(snapshot.node_id, "node-01");
  assert.equal(snapshot.latency_ms, 12);
  assert.deepEqual(queryNodeHealthSnapshots(), [snapshot]);
});

test("latest health can be queried by node_id", () => {
  recordNodeHealthSnapshot(createSnapshot({ node_id: "node-01", checked_at: "2026-05-04T16:00:00.000Z", status: "degraded" }));
  recordNodeHealthSnapshot(createSnapshot({ node_id: "node-01", checked_at: "2026-05-04T16:01:00.000Z", status: "healthy" }));

  const latest = getLatestNodeHealth("node-01");

  assert.equal(latest?.status, "healthy");
  assert.equal(latest?.checked_at, "2026-05-04T16:01:00.000Z");
});

test("degraded unreachable and unknown states render correctly", () => {
  const degraded = renderNodeHealthSnapshot(createSnapshot({ status: "degraded", warnings: ["high load"] }));
  const unreachable = renderNodeHealthSnapshot(createSnapshot({ status: "unreachable", warnings: ["heartbeat missing"] }));
  const unknown = renderNodeHealthSnapshot(createSnapshot({ status: "unknown" }));

  assert.match(degraded, /Status: degraded/);
  assert.match(degraded, /Warnings: high load/);
  assert.match(unreachable, /Status: unreachable/);
  assert.match(unknown, /Status: unknown/);
});

test("execution_ready defaults false", () => {
  const snapshot = recordNodeHealthSnapshot(createSnapshot({ execution_ready: false }));

  assert.equal(snapshot.execution_ready, false);
});

test("even healthy node does not become execution-ready", () => {
  const snapshot = recordNodeHealthSnapshot(createSnapshot({
    status: "healthy",
    latency_ms: 5,
    uptime_seconds: 5000,
    load_average: 0.2,
  }));

  assert.equal(snapshot.execution_ready, false);
  assert.match(renderNodeHealthSnapshot(snapshot), /Execution ready: false/);
});

test("input snapshot objects are not mutated", () => {
  const input = createSnapshot({ warnings: ["high load", "high load"] });
  const before = JSON.stringify(input);

  const recorded = recordNodeHealthSnapshot(input);
  input.warnings.push("late mutation");

  assert.equal(JSON.stringify({ ...input, warnings: ["high load", "high load"] }), before);
  assert.deepEqual(recorded.warnings, ["high load"]);
  assert.deepEqual(queryNodeHealthSnapshots()[0]?.warnings, ["high load"]);
});

test("no routing or execution flags are introduced", () => {
  const snapshot = recordNodeHealthSnapshot(createSnapshot({ status: "healthy" }));
  const rendered = renderNodeHealthSnapshot(snapshot);

  assert.match(rendered, /read-only health snapshot/i);
  assert.match(rendered, /No routing, execution, remote mutation, scheduling, or autonomy is triggered/);
  assert.equal("execution_triggered" in snapshot, false);
  assert.equal("routing_triggered" in snapshot, false);
});