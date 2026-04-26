import assert from "node:assert/strict";
import test from "node:test";

import {
  createTaskDependencyGraph,
  detectCircularDependencies,
  detectTaskConflicts,
  evaluateTaskRunnable,
  explainTaskBlockers,
  getRunnableTasks,
  summarizeTaskDependencyGraph,
  type TaskGraphEdge,
  type TaskGraphNode,
} from "./taskDependencyGraph";

function createNode(input: Partial<TaskGraphNode> & { id: string; description: string }): TaskGraphNode {
  return {
    id: input.id,
    description: input.description,
    priority: input.priority ?? "medium",
    status: input.status ?? "pending",
    created_at: input.created_at ?? "2026-04-26T10:00:00.000Z",
    last_updated_at: input.last_updated_at ?? input.created_at ?? "2026-04-26T10:00:00.000Z",
  };
}

function createGraph(nodes: TaskGraphNode[], edges: TaskGraphEdge[] = []) {
  return createTaskDependencyGraph(nodes, edges);
}

test("task with no dependencies is runnable", () => {
  const graph = createGraph([createNode({ id: "a", description: "Task A" })]);
  const result = evaluateTaskRunnable(graph, "a");

  assert.equal(result.runnable, true);
  assert.equal(result.status, "runnable");
});

test("task with incomplete dependency is blocked", () => {
  const graph = createGraph([
    createNode({ id: "a", description: "Task A", status: "pending" }),
    createNode({ id: "b", description: "Task B", status: "pending" }),
  ], [
    { from_task_id: "b", to_task_id: "a", type: "depends_on" },
  ]);

  const result = evaluateTaskRunnable(graph, "b");

  assert.equal(result.runnable, false);
  assert.equal(result.status, "dependency_blocked");
  assert.deepEqual(result.incomplete_dependencies, ["a"]);
});

test("task becomes runnable after dependency completes", () => {
  const graph = createGraph([
    createNode({ id: "a", description: "Task A", status: "completed" }),
    createNode({ id: "b", description: "Task B", status: "pending" }),
  ], [
    { from_task_id: "b", to_task_id: "a", type: "depends_on" },
  ]);

  const result = evaluateTaskRunnable(graph, "b");

  assert.equal(result.runnable, true);
  assert.equal(result.status, "runnable");
});

test("conflicting active task blocks candidate", () => {
  const graph = createGraph([
    createNode({ id: "a", description: "Task A", status: "active" }),
    createNode({ id: "b", description: "Task B", status: "pending" }),
  ], [
    { from_task_id: "a", to_task_id: "b", type: "conflicts_with", reason: "Both goals change the same runtime path." },
  ]);

  const result = evaluateTaskRunnable(graph, "b");

  assert.equal(result.runnable, false);
  assert.equal(result.status, "conflict_blocked");
  assert.equal(result.active_conflicts[0]?.conflicting_task_id, "a");
});

test("completed conflicting task does not block candidate", () => {
  const graph = createGraph([
    createNode({ id: "a", description: "Task A", status: "completed" }),
    createNode({ id: "b", description: "Task B", status: "pending" }),
  ], [
    { from_task_id: "a", to_task_id: "b", type: "conflicts_with" },
  ]);

  const result = evaluateTaskRunnable(graph, "b");

  assert.equal(result.runnable, true);
});

test("circular dependency is detected", () => {
  const graph = createGraph([
    createNode({ id: "a", description: "Task A" }),
    createNode({ id: "b", description: "Task B" }),
  ], [
    { from_task_id: "a", to_task_id: "b", type: "depends_on" },
    { from_task_id: "b", to_task_id: "a", type: "depends_on" },
  ]);

  const cycles = detectCircularDependencies(graph);
  const result = evaluateTaskRunnable(graph, "a");

  assert.equal(cycles.length, 2);
  assert.equal(result.status, "circular_dependency_blocked");
});

test("runnable tasks preserve deterministic priority order", () => {
  const graph = createGraph([
    createNode({ id: "low", description: "Low", priority: "low", created_at: "2026-04-26T10:05:00.000Z" }),
    createNode({ id: "high", description: "High", priority: "high", created_at: "2026-04-26T10:10:00.000Z" }),
    createNode({ id: "medium", description: "Medium", priority: "medium", created_at: "2026-04-26T10:00:00.000Z" }),
  ]);

  assert.deepEqual(getRunnableTasks(graph).map((task) => task.id), ["high", "medium", "low"]);
});

test("readable blocker explanation is produced", () => {
  const graph = createGraph([
    createNode({ id: "a", description: "Fix KBM input", status: "pending" }),
    createNode({ id: "b", description: "Playtest grenade", status: "pending" }),
  ], [
    { from_task_id: "b", to_task_id: "a", type: "depends_on" },
  ]);

  const explanation = explainTaskBlockers(graph, "b");
  const summary = summarizeTaskDependencyGraph(graph);

  assert.match(explanation, /incomplete dependencies/i);
  assert.match(summary, /Task dependency graph nodes:/);
});

test("detectTaskConflicts returns active conflict metadata", () => {
  const graph = createGraph([
    createNode({ id: "a", description: "Task A", status: "active" }),
    createNode({ id: "b", description: "Task B", status: "pending" }),
  ], [
    { from_task_id: "a", to_task_id: "b", type: "conflicts_with", reason: "Shared target file." },
  ]);

  const conflicts = detectTaskConflicts(graph, "b");

  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0]?.reason ?? "", /Shared target file/);
});