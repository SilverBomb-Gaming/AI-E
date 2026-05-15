import {
  createAutonomousSessionRegistry,
  type AutonomousSessionRegistry,
} from "./autonomousSessionRegistry";

export type SessionCoordinationDependencyStatus = "pending" | "ready" | "satisfied" | "blocked";

export type SessionCoordinationDependency = {
  source_session_id: string;
  target_session_id: string;
  relationship: "unlocks" | "triggers";
  status: SessionCoordinationDependencyStatus;
  reason: string;
};

export type SessionCoordinationGroup = {
  coordination_group_id: string;
  session_ids: string[];
  status: "active" | "blocked" | "completed";
  shared_goal: string | null;
};

export type SessionCoordinatorState = {
  groups: SessionCoordinationGroup[];
  dependencies: SessionCoordinationDependency[];
};

export type SessionCoordinationEvaluation = {
  groups: SessionCoordinationGroup[];
  dependencies: SessionCoordinationDependency[];
  ready_session_ids: string[];
  blocked_session_ids: string[];
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function createSessionCoordinatorState(input?: Partial<SessionCoordinatorState>): SessionCoordinatorState {
  return {
    groups: (input?.groups ?? []).map((group) => ({
      ...group,
      coordination_group_id: normalizeText(group.coordination_group_id),
      session_ids: unique(group.session_ids),
      shared_goal: normalizeText(group.shared_goal) || null,
    })),
    dependencies: (input?.dependencies ?? []).map((dependency) => ({
      ...dependency,
      source_session_id: normalizeText(dependency.source_session_id),
      target_session_id: normalizeText(dependency.target_session_id),
      reason: normalizeText(dependency.reason),
    })),
  };
}

export function evaluateSessionCoordination(input: {
  registry: AutonomousSessionRegistry;
  coordinator: SessionCoordinatorState;
}): SessionCoordinationEvaluation {
  const registry = createAutonomousSessionRegistry(input.registry);
  const coordinator = createSessionCoordinatorState(input.coordinator);
  const sessionMap = new Map(registry.sessions.map((session) => [session.session_id, session]));

  const dependencies = coordinator.dependencies.map((dependency) => {
    const source = sessionMap.get(dependency.source_session_id);
    const target = sessionMap.get(dependency.target_session_id);

    if (!source || !target) {
      return {
        ...dependency,
        status: "blocked" as const,
        reason: dependency.reason || "The coordination dependency references a missing session.",
      };
    }

    if (source.status === "completed") {
      return {
        ...dependency,
        status: target.status === "completed" ? "satisfied" as const : "ready" as const,
        reason: dependency.reason || `${source.session_id} completed and now unlocks ${target.session_id}.`,
      };
    }

    if (source.status === "failed" || source.status === "blocked") {
      return {
        ...dependency,
        status: "blocked" as const,
        reason: dependency.reason || `${source.session_id} is ${source.status}, so ${target.session_id} stays blocked.`,
      };
    }

    return {
      ...dependency,
      status: "pending" as const,
      reason: dependency.reason || `${target.session_id} is waiting for ${source.session_id}.`,
    };
  });

  const blockedSessionIds = unique(dependencies.filter((dependency) => dependency.status === "blocked" || dependency.status === "pending").map((dependency) => dependency.target_session_id));
  const readySessionIds = unique(dependencies.filter((dependency) => dependency.status === "ready").map((dependency) => dependency.target_session_id));

  const groups: SessionCoordinationGroup[] = coordinator.groups.map((group) => {
    const groupSessions = group.session_ids.map((sessionId) => sessionMap.get(sessionId)).filter(Boolean);
    const allCompleted = groupSessions.length > 0 && groupSessions.every((session) => session?.status === "completed");
    const anyBlocked = groupSessions.some((session) => session?.status === "blocked" || session?.status === "failed");

    return {
      ...group,
      status: allCompleted ? "completed" : anyBlocked ? "blocked" : "active",
    };
  });

  return {
    groups,
    dependencies,
    ready_session_ids: readySessionIds,
    blocked_session_ids: blockedSessionIds,
  };
}

export function summarizeSessionCoordination(evaluation: SessionCoordinationEvaluation): string {
  return [
    `Coordination groups: ${evaluation.groups.length}`,
    `Dependencies: ${evaluation.dependencies.length}`,
    `Ready sessions: ${evaluation.ready_session_ids.length > 0 ? evaluation.ready_session_ids.join(", ") : "none"}`,
    `Blocked sessions: ${evaluation.blocked_session_ids.length > 0 ? evaluation.blocked_session_ids.join(", ") : "none"}`,
  ].join("\n");
}