export type TaskDependencyStatus = "pending" | "active" | "completed" | "blocked" | "paused" | "failed";

export type TaskGraphNode = {
  id: string;
  description: string;
  priority: "high" | "medium" | "low";
  status: TaskDependencyStatus;
  created_at: string;
  last_updated_at: string;
};

export type TaskGraphEdgeType = "depends_on" | "blocks" | "conflicts_with" | "related_to";

export type TaskGraphEdge = {
  from_task_id: string;
  to_task_id: string;
  type: TaskGraphEdgeType;
  reason?: string;
};

export type TaskConflictReason = {
  task_id: string;
  conflicting_task_id: string;
  reason: string;
};

export type TaskRunnableEvaluation = {
  task_id: string;
  runnable: boolean;
  status: "runnable" | "dependency_blocked" | "conflict_blocked" | "status_blocked" | "circular_dependency_blocked" | "missing_task";
  incomplete_dependencies: string[];
  active_conflicts: TaskConflictReason[];
  circular_dependency_paths: string[][];
  explanation: string;
};

export type TaskDependencyGraph = {
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  node_map: Record<string, TaskGraphNode>;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function cloneNode(node: TaskGraphNode): TaskGraphNode {
  return { ...node };
}

function cloneEdge(edge: TaskGraphEdge): TaskGraphEdge {
  return { ...edge };
}

function isTerminalStatus(status: TaskDependencyStatus): boolean {
  return status === "completed" || status === "blocked" || status === "paused" || status === "failed";
}

function isIncompleteStatus(status: TaskDependencyStatus): boolean {
  return status !== "completed";
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right);
}

function getEdgesForTask(graph: TaskDependencyGraph, taskId: string, type?: TaskGraphEdgeType): TaskGraphEdge[] {
  return graph.edges.filter((edge) => {
    if (type && edge.type !== type) {
      return false;
    }

    if (edge.from_task_id === taskId) {
      return true;
    }

    if (edge.type === "conflicts_with" && edge.to_task_id === taskId) {
      return true;
    }

    return false;
  });
}

function getDependencyIds(graph: TaskDependencyGraph, taskId: string): string[] {
  return getEdgesForTask(graph, taskId)
    .flatMap((edge) => {
      if (edge.type === "depends_on") {
        return [edge.to_task_id];
      }
      if (edge.type === "blocks") {
        return [edge.from_task_id === taskId ? edge.to_task_id : edge.from_task_id];
      }
      return [];
    })
    .filter((dependencyId, index, values) => values.indexOf(dependencyId) === index)
    .sort(compareIds);
}

function getConflictTaskIds(graph: TaskDependencyGraph, taskId: string): string[] {
  return graph.edges
    .flatMap((edge) => {
      if (edge.type !== "conflicts_with") {
        return [];
      }
      if (edge.from_task_id === taskId) {
        return [edge.to_task_id];
      }
      if (edge.to_task_id === taskId) {
        return [edge.from_task_id];
      }
      return [];
    })
    .filter((conflictId, index, values) => values.indexOf(conflictId) === index)
    .sort(compareIds);
}

function detectCircularDependenciesFromTask(
  graph: TaskDependencyGraph,
  taskId: string,
  path: string[] = [],
  seen: Set<string> = new Set(),
): string[][] {
  if (path.includes(taskId)) {
    const startIndex = path.indexOf(taskId);
    return [[...path.slice(startIndex), taskId]];
  }

  if (seen.has(taskId)) {
    return [];
  }

  seen.add(taskId);
  const nextPath = [...path, taskId];
  const cycles = getDependencyIds(graph, taskId)
    .flatMap((dependencyId) => detectCircularDependenciesFromTask(graph, dependencyId, nextPath, new Set(seen)));

  return cycles.filter((cycle, index, values) => values.findIndex((candidate) => candidate.join("->") === cycle.join("->")) === index);
}

export function createTaskDependencyGraph(nodes: TaskGraphNode[], edges: TaskGraphEdge[]): TaskDependencyGraph {
  const clonedNodes = nodes.map((node) => cloneNode(node)).sort((left, right) => left.id.localeCompare(right.id));
  const nodeMap = Object.fromEntries(clonedNodes.map((node) => [node.id, node]));
  const filteredEdges = edges
    .filter((edge) => nodeMap[edge.from_task_id] && nodeMap[edge.to_task_id])
    .map((edge) => cloneEdge(edge))
    .sort((left, right) => {
      const leftKey = `${left.type}:${left.from_task_id}:${left.to_task_id}:${normalizeText(left.reason)}`;
      const rightKey = `${right.type}:${right.from_task_id}:${right.to_task_id}:${normalizeText(right.reason)}`;
      return leftKey.localeCompare(rightKey);
    });

  return {
    nodes: clonedNodes,
    edges: filteredEdges,
    node_map: nodeMap,
  };
}

export function detectTaskConflicts(graph: TaskDependencyGraph, taskId: string): TaskConflictReason[] {
  const task = graph.node_map[taskId];
  if (!task) {
    return [];
  }

  return getConflictTaskIds(graph, taskId)
    .map((conflictingTaskId) => {
      const conflictingTask = graph.node_map[conflictingTaskId];
      if (!conflictingTask || conflictingTask.status !== "active") {
        return null;
      }

      const matchingEdge = graph.edges.find((edge) => edge.type === "conflicts_with"
        && ((edge.from_task_id === taskId && edge.to_task_id === conflictingTaskId)
          || (edge.from_task_id === conflictingTaskId && edge.to_task_id === taskId)));

      return {
        task_id: taskId,
        conflicting_task_id: conflictingTaskId,
        reason: normalizeText(matchingEdge?.reason) || `${task.description} conflicts with active task ${conflictingTask.description}.`,
      } satisfies TaskConflictReason;
    })
    .filter((reason): reason is TaskConflictReason => reason !== null)
    .sort((left, right) => left.conflicting_task_id.localeCompare(right.conflicting_task_id));
}

export function detectCircularDependencies(graph: TaskDependencyGraph): string[][] {
  const cycles = graph.nodes.flatMap((node) => detectCircularDependenciesFromTask(graph, node.id));
  return cycles.filter((cycle, index, values) => values.findIndex((candidate) => candidate.join("->") === cycle.join("->")) === index);
}

export function explainTaskBlockers(graph: TaskDependencyGraph, taskId: string): string {
  const evaluation = evaluateTaskRunnable(graph, taskId);
  return evaluation.explanation;
}

export function evaluateTaskRunnable(graph: TaskDependencyGraph, taskId: string): TaskRunnableEvaluation {
  const task = graph.node_map[taskId];
  if (!task) {
    return {
      task_id: taskId,
      runnable: false,
      status: "missing_task",
      incomplete_dependencies: [],
      active_conflicts: [],
      circular_dependency_paths: [],
      explanation: `Task '${taskId}' is not present in the dependency graph.`,
    };
  }

  if (isTerminalStatus(task.status)) {
    return {
      task_id: taskId,
      runnable: false,
      status: "status_blocked",
      incomplete_dependencies: [],
      active_conflicts: [],
      circular_dependency_paths: [],
      explanation: `Task '${task.description}' is ${task.status} and is not runnable.`,
    };
  }

  const circularDependencyPaths = detectCircularDependenciesFromTask(graph, taskId);
  if (circularDependencyPaths.length > 0) {
    return {
      task_id: taskId,
      runnable: false,
      status: "circular_dependency_blocked",
      incomplete_dependencies: [],
      active_conflicts: [],
      circular_dependency_paths: circularDependencyPaths,
      explanation: `Task '${task.description}' is blocked by a circular dependency: ${circularDependencyPaths.map((path) => path.join(" -> ")).join(" | ")}.`,
    };
  }

  const incompleteDependencies = getDependencyIds(graph, taskId)
    .filter((dependencyId) => {
      const dependency = graph.node_map[dependencyId];
      return !dependency || isIncompleteStatus(dependency.status);
    })
    .sort(compareIds);

  if (incompleteDependencies.length > 0) {
    return {
      task_id: taskId,
      runnable: false,
      status: "dependency_blocked",
      incomplete_dependencies: incompleteDependencies,
      active_conflicts: [],
      circular_dependency_paths: [],
      explanation: `Task '${task.description}' is blocked by incomplete dependencies: ${incompleteDependencies.join(", ")}.`,
    };
  }

  const activeConflicts = detectTaskConflicts(graph, taskId);
  if (activeConflicts.length > 0) {
    return {
      task_id: taskId,
      runnable: false,
      status: "conflict_blocked",
      incomplete_dependencies: [],
      active_conflicts: activeConflicts,
      circular_dependency_paths: [],
      explanation: `Task '${task.description}' is blocked by active conflicts: ${activeConflicts.map((conflict) => conflict.conflicting_task_id).join(", ")}.`,
    };
  }

  return {
    task_id: taskId,
    runnable: true,
    status: "runnable",
    incomplete_dependencies: [],
    active_conflicts: [],
    circular_dependency_paths: [],
    explanation: `Task '${task.description}' is runnable.`,
  };
}

export function getRunnableTasks(graph: TaskDependencyGraph): TaskGraphNode[] {
  return graph.nodes
    .filter((node) => evaluateTaskRunnable(graph, node.id).runnable)
    .sort((left, right) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
      const leftPriority = priorityOrder[left.priority];
      const rightPriority = priorityOrder[right.priority];
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      const leftCreated = Date.parse(left.created_at);
      const rightCreated = Date.parse(right.created_at);
      if (!Number.isNaN(leftCreated) && !Number.isNaN(rightCreated) && leftCreated !== rightCreated) {
        return leftCreated - rightCreated;
      }

      return left.id.localeCompare(right.id);
    });
}

export function summarizeTaskDependencyGraph(graph: TaskDependencyGraph): string {
  const cycles = detectCircularDependencies(graph);
  const runnableTasks = getRunnableTasks(graph);
  return [
    `Task dependency graph nodes: ${graph.nodes.length}`,
    `Task dependency graph edges: ${graph.edges.length}`,
    `Runnable tasks: ${runnableTasks.length > 0 ? runnableTasks.map((task) => task.id).join(", ") : "none"}`,
    `Circular dependencies: ${cycles.length > 0 ? cycles.map((cycle) => cycle.join(" -> ")).join(" | ") : "none"}`,
  ].join("\n");
}