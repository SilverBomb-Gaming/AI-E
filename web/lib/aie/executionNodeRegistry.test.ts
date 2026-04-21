import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createExecutionNodeDescriptor } from "./executionNode";
import {
  chooseExecutionNodeForAction,
  evaluateExecutionNodeLiveness,
  getExecutionNode,
  getExecutionNodeEligibility,
  listExecutionNodes,
  listAvailableExecutionNodes,
  registerExecutionNode,
  resetExecutionNodeRegistry,
  updateExecutionNodeHeartbeat,
  unregisterExecutionNode,
} from "./executionNodeRegistry";
import type { ExecutionActionPreview } from "./types";

function makeAction(type: ExecutionActionPreview["type"], sourceActionType: string): ExecutionActionPreview {
  return {
    id: `${type}-action`,
    type,
    scope: "safe",
    description: `Run ${type}`,
    expectedOutcome: "The bounded action should complete successfully.",
    requiresApproval: true,
    metadata: {
      sourceActionType: sourceActionType as ExecutionActionPreview["metadata"]["sourceActionType"],
    },
  };
}

test("execution node registry supports register list get and unregister", () => {
  resetExecutionNodeRegistry();

  const node = registerExecutionNode(createExecutionNodeDescriptor({
    mode: "local-node",
    label: "AI-E Local Node",
    capabilities: ["inspection", "validation-check", "repo-scan"],
  }));

  assert.equal(listExecutionNodes().length, 1);
  assert.equal(getExecutionNode(node.id)?.label, "AI-E Local Node");
  assert.equal(unregisterExecutionNode(node.id), true);
  assert.equal(listExecutionNodes().length, 0);
});

test("execution node registry chooses nodes deterministically by capability and runtime mode", () => {
  resetExecutionNodeRegistry();

  const webNode = registerExecutionNode(createExecutionNodeDescriptor({
    mode: "web",
    label: "AI-E Web Node",
    capabilities: ["inspection", "validation-check", "test-run", "repo-scan"],
  }));
  registerExecutionNode(createExecutionNodeDescriptor({
    mode: "headless",
    label: "AI-E Headless Node",
    capabilities: ["inspection", "validation-check", "repo-scan"],
  }));

  const selected = chooseExecutionNodeForAction(makeAction("inspection", "inspection"), {
    runtimeMode: "web",
  });

  assert.equal(selected?.id, webNode.id);
});

test("execution node registry returns null when no node supports the requested capability", () => {
  resetExecutionNodeRegistry();
  registerExecutionNode(createExecutionNodeDescriptor({
    mode: "headless",
    label: "AI-E Headless Node",
    capabilities: ["inspection", "validation-check"],
  }));

  const selected = chooseExecutionNodeForAction(makeAction("test-run", "test-run"), {
    runtimeMode: "headless",
  });

  assert.equal(selected, null);
});

test("execution node registry marks stale nodes ineligible until heartbeat recovery", async () => {
  const registryDirectory = path.resolve(process.cwd(), "temp-execution-node-registry-test-1");
  resetExecutionNodeRegistry();
  process.env.AIE_EXECUTION_NODE_REGISTRY_DIR = registryDirectory;
  await mkdir(registryDirectory, { recursive: true });

  try {
    const staleHeartbeatAt = "2026-04-20T00:00:00.000Z";
    const node = registerExecutionNode(createExecutionNodeDescriptor({
      mode: "headless",
      label: "AI-E Headless Node",
      capabilities: ["inspection", "validation-check", "repo-scan"],
      lastHeartbeatAt: staleHeartbeatAt,
    }));

    const evaluated = evaluateExecutionNodeLiveness({
      heartbeatStaleAfterMs: 1,
    });
    const staleNode = evaluated.find((candidate) => candidate.id === node.id);
    const staleEligibility = staleNode ? getExecutionNodeEligibility(staleNode, { heartbeatStaleAfterMs: 1 }) : null;

    assert.equal(staleNode?.status, "stale");
    assert.equal(staleNode?.active, false);
    assert.equal(staleNode?.heartbeatMissCount, 1);
    assert.equal(staleEligibility?.eligible, false);
    assert.equal(listAvailableExecutionNodes({ heartbeatStaleAfterMs: 1 }).some((candidate) => candidate.id === node.id), false);

    const recovered = updateExecutionNodeHeartbeat(node.id, {
      at: new Date().toISOString(),
      trustState: "trusted",
    });

    assert.equal(recovered?.status, "active");
    assert.equal(recovered?.active, true);
    assert.equal(recovered?.heartbeatMissCount, 0);
    assert.equal(recovered?.trustState, "trusted");
    assert.equal(listAvailableExecutionNodes({ heartbeatStaleAfterMs: 60_000 }).some((candidate) => candidate.id === node.id), true);
  } finally {
    delete process.env.AIE_EXECUTION_NODE_REGISTRY_DIR;
    resetExecutionNodeRegistry();
    await rm(registryDirectory, { recursive: true, force: true });
  }
});

test("execution node registry keeps explicitly inactive nodes disabled after heartbeats", async () => {
  const registryDirectory = path.resolve(process.cwd(), "temp-execution-node-registry-test-2");
  resetExecutionNodeRegistry();
  process.env.AIE_EXECUTION_NODE_REGISTRY_DIR = registryDirectory;
  await mkdir(registryDirectory, { recursive: true });

  try {
    const node = registerExecutionNode(createExecutionNodeDescriptor({
      mode: "headless",
      label: "AI-E Disabled Node",
      capabilities: ["inspection", "validation-check", "repo-scan"],
      active: false,
    }));

    const heartbeated = updateExecutionNodeHeartbeat(node.id, {
      at: new Date().toISOString(),
      trustState: "trusted",
    });

    const eligibility = heartbeated ? getExecutionNodeEligibility(heartbeated) : null;

    assert.equal(heartbeated?.status, "inactive");
    assert.equal(heartbeated?.active, false);
    assert.equal(heartbeated?.trustState, "trusted");
    assert.equal(eligibility?.eligible, false);
    assert.match(eligibility?.reason ?? "", /inactive/i);
  } finally {
    delete process.env.AIE_EXECUTION_NODE_REGISTRY_DIR;
    resetExecutionNodeRegistry();
    await rm(registryDirectory, { recursive: true, force: true });
  }
});

test("execution node registry only treats busy state as reusable for the same task", async () => {
  const registryDirectory = path.resolve(process.cwd(), "temp-execution-node-registry-test-3");
  resetExecutionNodeRegistry();
  process.env.AIE_EXECUTION_NODE_REGISTRY_DIR = registryDirectory;
  await mkdir(registryDirectory, { recursive: true });

  try {
    const node = registerExecutionNode(createExecutionNodeDescriptor({
      mode: "headless",
      label: "AI-E Busy Node",
      capabilities: ["inspection", "validation-check", "repo-scan"],
      busy: true,
      activeTaskId: "task-current",
    }));

    const otherTaskEligibility = getExecutionNodeEligibility(node, { taskId: "task-other" });
    const sameTaskEligibility = getExecutionNodeEligibility(node, { taskId: "task-current" });

    assert.equal(otherTaskEligibility.eligible, false);
    assert.match(otherTaskEligibility.reason, /busy/i);
    assert.equal(sameTaskEligibility.eligible, true);
    assert.equal(sameTaskEligibility.stale, false);
  } finally {
    delete process.env.AIE_EXECUTION_NODE_REGISTRY_DIR;
    resetExecutionNodeRegistry();
    await rm(registryDirectory, { recursive: true, force: true });
  }
});