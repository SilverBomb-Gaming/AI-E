import assert from "node:assert/strict";
import test from "node:test";

import {
  createExecutionNodeDescriptor,
  createRuntimeExecutionNodeDescriptor,
  summarizeExecutionNodeCapabilities,
} from "./executionNode";

test("execution nodes create stable descriptors with normalized capabilities", () => {
  const node = createExecutionNodeDescriptor({
    mode: "local-node",
    label: "AI-E Local Node",
    capabilities: ["test-run", "inspection", "test-run", "repo-scan"],
    cwd: "E:/AI projects 2025/AI-E/web",
    allowedRoots: ["web/lib/aie", "web/lib/aie"],
  });

  assert.match(node.id, /^aie-node-local-node-/i);
  assert.deepEqual(node.capabilities, ["inspection", "test-run", "repo-scan"]);
  assert.equal(node.active, true);
  assert.equal(node.allowedRoots?.[0], "web/lib/aie");
  assert.equal(typeof node.createdAt, "string");
  assert.equal(typeof node.updatedAt, "string");
});

test("execution nodes summarize capabilities and preserve inactive state", () => {
  const node = createExecutionNodeDescriptor({
    mode: "headless",
    label: "AI-E Headless Node",
    capabilities: ["inspection", "validation-check"],
    active: false,
  });

  assert.equal(node.active, false);
  assert.equal(summarizeExecutionNodeCapabilities(node.capabilities), "inspection, validation-check");
});

test("runtime execution nodes derive labels and ids from the current mode", () => {
  const node = createRuntimeExecutionNodeDescriptor({
    runtimeMode: "web",
    cwd: "E:/AI projects 2025/AI-E/web",
  });

  assert.equal(node.mode, "web");
  assert.match(node.label, /Web Node/i);
  assert.ok(node.capabilities.length >= 4);
});