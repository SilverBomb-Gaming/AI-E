import assert from "node:assert/strict";
import test from "node:test";

import { createExecutionNodeDescriptor } from "./executionNode";
import {
  chooseExecutionNodeForAction,
  getExecutionNode,
  listExecutionNodes,
  registerExecutionNode,
  resetExecutionNodeRegistry,
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