import assert from "node:assert/strict";
import test from "node:test";

import {
  queryNodes,
  registerNode,
  renderNodeRegistry,
  resetNodeRegistryForTests,
  type NodeRegistryEntry,
} from "./nodeRegistry";

function createNode(overrides: Partial<NodeRegistryEntry> = {}): NodeRegistryEntry {
  return {
    node_id: overrides.node_id ?? "node-01",
    hostname: overrides.hostname ?? "validator-01",
    platform: overrides.platform ?? "windows",
    status: overrides.status ?? "available",
    capabilities: overrides.capabilities ?? ["inspection", "validation-check"],
    last_seen_at: Object.prototype.hasOwnProperty.call(overrides, "last_seen_at")
      ? overrides.last_seen_at
      : "2026-05-04T15:00:00.000Z",
  };
}

test.afterEach(() => {
  resetNodeRegistryForTests();
});

test("node can be registered", () => {
  const node = registerNode(createNode());

  assert.equal(node.node_id, "node-01");
  assert.deepEqual(queryNodes(), [node]);
});

test("nodes can be queried by status", () => {
  registerNode(createNode({ node_id: "node-available", status: "available" }));
  registerNode(createNode({ node_id: "node-offline", status: "offline" }));

  const nodes = queryNodes({ status: "offline" });

  assert.deepEqual(nodes.map((node) => node.node_id), ["node-offline"]);
});

test("nodes can be queried by capability", () => {
  registerNode(createNode({ node_id: "node-validate", capabilities: ["validation-check"] }));
  registerNode(createNode({ node_id: "node-repo", capabilities: ["repo-scan"] }));

  const nodes = queryNodes({ capability: "repo-scan" });

  assert.deepEqual(nodes.map((node) => node.node_id), ["node-repo"]);
});

test("offline and unknown states render correctly", () => {
  registerNode(createNode({ node_id: "node-offline", status: "offline" }));
  registerNode(createNode({ node_id: "node-unknown", status: "unknown", last_seen_at: undefined }));

  const rendered = renderNodeRegistry(queryNodes());

  assert.match(rendered, /node-offline \(offline\)/);
  assert.match(rendered, /node-unknown \(unknown\)/);
  assert.match(rendered, /Last seen: unknown/);
});

test("registry does not execute anything", () => {
  registerNode(createNode());
  const rendered = renderNodeRegistry(queryNodes());

  assert.match(rendered, /read-only/i);
  assert.match(rendered, /No routing, execution, remote mutation, scheduling, or autonomy is triggered/);
});

test("input node objects are not mutated", () => {
  const input = createNode({ capabilities: ["inspection", "inspection", "repo-scan"] });
  const before = JSON.stringify(input);

  const registered = registerNode(input);
  input.capabilities.push("test-run");

  assert.equal(JSON.stringify({ ...input, capabilities: ["inspection", "inspection", "repo-scan"] }), before);
  assert.deepEqual(registered.capabilities, ["inspection", "repo-scan"]);
  assert.deepEqual(queryNodes()[0]?.capabilities, ["inspection", "repo-scan"]);
});