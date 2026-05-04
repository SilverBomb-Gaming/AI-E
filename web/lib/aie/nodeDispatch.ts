import { getLatestNodeHealth, queryNodeHealthSnapshots } from "./nodeHealth";
import { evaluateNodeReadiness } from "./nodeReadiness";
import { queryNodes } from "./nodeRegistry";
import { simulateNodeRouting, type NodeRoutingSimulationTask } from "./nodeRoutingSimulation";

export type NodeDispatchRecord = {
  dispatched: boolean;
  node_id: string;
  task_id: string;
  reason?: string;
};

export const CONTROLLED_NODE_DISPATCH_SAFETY_STACK = [
  "explicit invocation required",
  "single task only",
  "single node only",
  "routing simulation required",
  "node readiness required",
  "healthy node required",
  "dispatch intent only",
] as const;

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function blockedResult(taskId: string, nodeId: string, reason: string): NodeDispatchRecord {
  return {
    dispatched: false,
    node_id: nodeId,
    task_id: taskId,
    reason,
  };
}

export function dispatchTaskToNode(task: NodeRoutingSimulationTask, node_id: string): NodeDispatchRecord {
  const taskId = normalizeText(task.task_id);
  const selectedNodeId = normalizeText(node_id);
  const nodes = queryNodes();
  const selectedNode = nodes.find((node) => node.node_id === selectedNodeId);

  if (!selectedNode) {
    return blockedResult(taskId, selectedNodeId, "node not found");
  }

  const healthSnapshots = queryNodeHealthSnapshots();
  const routing = simulateNodeRouting(task, nodes, healthSnapshots);
  const blockedNode = routing.blocked_nodes.find((node) => node.node_id === selectedNodeId);

  if (blockedNode) {
    return blockedResult(taskId, selectedNodeId, blockedNode.reason);
  }

  if (routing.selected_node_id !== selectedNodeId) {
    return blockedResult(taskId, selectedNodeId, "selected node does not match routing simulation");
  }

  const latestHealth = getLatestNodeHealth(selectedNodeId);
  const readiness = evaluateNodeReadiness(selectedNode, latestHealth, task.required_capabilities);

  if (readiness.readiness_status !== "ready_candidate") {
    return blockedResult(taskId, selectedNodeId, readiness.reasons[0] ?? "node not ready for controlled dispatch");
  }

  if (!latestHealth || latestHealth.status !== "healthy") {
    return blockedResult(taskId, selectedNodeId, "health not healthy");
  }

  return {
    dispatched: true,
    node_id: selectedNodeId,
    task_id: taskId,
    reason: "dispatch intent recorded",
  };
}