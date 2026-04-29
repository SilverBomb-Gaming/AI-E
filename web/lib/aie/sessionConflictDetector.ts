import {
  createAutonomousSessionRegistry,
  priorityRank,
  updateAutonomousSession,
  type AutonomousSessionRecord,
  type AutonomousSessionRegistry,
} from "./autonomousSessionRegistry";

export type SessionConflictKind = "shared_file" | "shared_goal" | "overlapping_chain" | "incompatible_scope";

export type SessionConflictResolution = "block_one_session" | "queue_work" | "request_operator_review" | "merge_scopes_if_safe";

export type SessionConflictRecord = {
  conflict_id: string;
  left_session_id: string;
  right_session_id: string;
  kind: SessionConflictKind;
  shared_targets: string[];
  resolution: SessionConflictResolution;
  explanation: string;
  blocking_session_id: string | null;
};

export type SessionConflictDetectionResult = {
  conflicts: SessionConflictRecord[];
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

function isActive(session: AutonomousSessionRecord): boolean {
  return session.status === "pending" || session.status === "running";
}

function compareByPriority(left: AutonomousSessionRecord, right: AutonomousSessionRecord): number {
  const delta = priorityRank(left.priority) - priorityRank(right.priority);
  if (delta !== 0) {
    return delta;
  }
  return left.session_id.localeCompare(right.session_id);
}

function conflictId(kind: SessionConflictKind, leftSessionId: string, rightSessionId: string): string {
  return `session-conflict-${kind}-${leftSessionId}-${rightSessionId}`;
}

function chooseBlockedSession(left: AutonomousSessionRecord, right: AutonomousSessionRecord): AutonomousSessionRecord {
  const ordered = [left, right].sort(compareByPriority);
  return ordered[1] ?? right;
}

function createConflictRecord(input: {
  kind: SessionConflictKind;
  left: AutonomousSessionRecord;
  right: AutonomousSessionRecord;
  shared_targets: string[];
}): SessionConflictRecord {
  const sharedTargets = unique(input.shared_targets);

  if (input.kind === "shared_file") {
    const blocked = chooseBlockedSession(input.left, input.right);
    return {
      conflict_id: conflictId(input.kind, input.left.session_id, input.right.session_id),
      left_session_id: input.left.session_id,
      right_session_id: input.right.session_id,
      kind: input.kind,
      shared_targets: sharedTargets,
      resolution: "block_one_session",
      explanation: `Sessions overlap on the same file targets: ${sharedTargets.join(", ")}.`,
      blocking_session_id: blocked.session_id,
    };
  }

  if (input.kind === "shared_goal") {
    const blocked = chooseBlockedSession(input.left, input.right);
    return {
      conflict_id: conflictId(input.kind, input.left.session_id, input.right.session_id),
      left_session_id: input.left.session_id,
      right_session_id: input.right.session_id,
      kind: input.kind,
      shared_targets: sharedTargets,
      resolution: "queue_work",
      explanation: `Sessions are targeting the same bounded goal scope: ${sharedTargets.join(", ")}.`,
      blocking_session_id: blocked.session_id,
    };
  }

  if (input.kind === "overlapping_chain") {
    return {
      conflict_id: conflictId(input.kind, input.left.session_id, input.right.session_id),
      left_session_id: input.left.session_id,
      right_session_id: input.right.session_id,
      kind: input.kind,
      shared_targets: sharedTargets,
      resolution: "request_operator_review",
      explanation: `Sessions are attached to overlapping execution chains: ${sharedTargets.join(", ")}.`,
      blocking_session_id: null,
    };
  }

  const sameCoordinationGroup = input.left.coordination_group_id
    && input.left.coordination_group_id === input.right.coordination_group_id;

  return {
    conflict_id: conflictId(input.kind, input.left.session_id, input.right.session_id),
    left_session_id: input.left.session_id,
    right_session_id: input.right.session_id,
    kind: input.kind,
    shared_targets: sharedTargets,
    resolution: sameCoordinationGroup ? "merge_scopes_if_safe" : "request_operator_review",
    explanation: `Sessions entered incompatible bounded scopes: ${sharedTargets.join(", ")}.`,
    blocking_session_id: sameCoordinationGroup ? null : chooseBlockedSession(input.left, input.right).session_id,
  };
}

export function detectSessionConflicts(input: {
  registry: AutonomousSessionRegistry;
  session_file_targets?: Record<string, string[]>;
  session_goal_targets?: Record<string, string[]>;
  incompatible_scope_pairs?: Array<[string, string]>;
}): SessionConflictDetectionResult {
  const registry = createAutonomousSessionRegistry(input.registry);
  const sessions = registry.sessions.filter((session) => isActive(session));
  const conflicts: SessionConflictRecord[] = [];

  for (let leftIndex = 0; leftIndex < sessions.length; leftIndex += 1) {
    const left = sessions[leftIndex];
    if (!left) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < sessions.length; rightIndex += 1) {
      const right = sessions[rightIndex];
      if (!right) {
        continue;
      }

      const sharedFiles = (input.session_file_targets?.[left.session_id] ?? []).filter((target) =>
        (input.session_file_targets?.[right.session_id] ?? []).includes(target));
      if (sharedFiles.length > 0) {
        conflicts.push(createConflictRecord({ kind: "shared_file", left, right, shared_targets: sharedFiles }));
      }

      const sharedGoals = (input.session_goal_targets?.[left.session_id] ?? []).filter((target) =>
        (input.session_goal_targets?.[right.session_id] ?? []).includes(target));
      if (sharedGoals.length > 0) {
        conflicts.push(createConflictRecord({ kind: "shared_goal", left, right, shared_targets: sharedGoals }));
      }

      const sharedChains = left.active_chain_ids.filter((chainId) => right.active_chain_ids.includes(chainId));
      if (sharedChains.length > 0) {
        conflicts.push(createConflictRecord({ kind: "overlapping_chain", left, right, shared_targets: sharedChains }));
      }

      const incompatibleScopes = (input.incompatible_scope_pairs ?? []).filter(([leftSessionId, rightSessionId]) => {
        return (leftSessionId === left.session_id && rightSessionId === right.session_id)
          || (leftSessionId === right.session_id && rightSessionId === left.session_id);
      });
      if (incompatibleScopes.length > 0) {
        conflicts.push(createConflictRecord({
          kind: "incompatible_scope",
          left,
          right,
          shared_targets: incompatibleScopes.map(([leftSessionId, rightSessionId]) => `${leftSessionId}<->${rightSessionId}`),
        }));
      }
    }
  }

  const blockedSessionIds = unique(conflicts.map((conflict) => conflict.blocking_session_id));

  return {
    conflicts: conflicts.sort((left, right) => left.conflict_id.localeCompare(right.conflict_id)),
    blocked_session_ids: blockedSessionIds,
  };
}

export function applySessionConflictBlocks(
  registry: AutonomousSessionRegistry,
  conflicts: SessionConflictDetectionResult,
): AutonomousSessionRegistry {
  let nextRegistry = createAutonomousSessionRegistry(registry);

  for (const sessionId of conflicts.blocked_session_ids) {
    nextRegistry = updateAutonomousSession(nextRegistry, sessionId, (session) => ({
      ...session,
      status: session.status === "completed" || session.status === "failed" ? session.status : "blocked",
    }));
  }

  return nextRegistry;
}