import type {
  BackgroundQueueResult,
  BackgroundQueuedSession,
} from "./backgroundSessionQueue";

export type DigestStatus =
  | "digest_empty"
  | "digest_ready"
  | "digest_needs_attention"
  | "digest_blocked";

export type DigestSection = {
  title: string;
  items: string[];
};

export type DigestRecommendation = {
  priority: "normal" | "attention" | "blocked";
  action: string;
};

export type BackgroundRunHistoryRecord = {
  record_id: string;
  created_at: string;
  queue_report_id: string;
  queue_status: BackgroundQueueResult["status"];
  sessions_considered: number;
  sessions_run: number;
  sessions_completed: number;
  sessions_paused: number;
  sessions_skipped: number;
  sessions_blocked: number;
  approvals_needed: string[];
  blockers: BackgroundQueueResult["blockers"];
  next_operator_action: string;
  safe_to_continue_later: boolean;
  completed_work_summary: string[];
  paused_work_summary: string[];
  skipped_work_summary: string[];
  blocked_work_summary: string[];
};

export type BackgroundRunHistory = {
  history_id: string;
  created_at: string;
  records: BackgroundRunHistoryRecord[];
};

export type OperatorAwayDigest = {
  digest_id: string;
  created_at: string;
  window_start: string | null;
  window_end: string | null;
  total_runs: number;
  total_sessions_considered: number;
  total_sessions_completed: number;
  total_sessions_paused: number;
  total_sessions_skipped: number;
  total_sessions_blocked: number;
  approvals_needed: string[];
  blockers: BackgroundRunHistoryRecord["blockers"];
  completed_work_summary: DigestSection;
  paused_work_summary: DigestSection;
  blocked_work_summary: DigestSection;
  recommended_next_actions: DigestRecommendation[];
  overall_status: DigestStatus;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function parseTimestamp(value: string | null | undefined): number | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => normalizeText(value).length > 0))];
}

function uniqueBlockers<T extends { code: string; message: string; approvals_needed?: string[] }>(blockers: T[]): T[] {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = `${blocker.code}:${blocker.message}:${(blocker.approvals_needed ?? []).join(",")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function summarizeQueuedGoals(
  sessions: BackgroundQueuedSession[],
  targetStatus: BackgroundQueuedSession["status"],
): string[] {
  return sessions
    .filter((session) => session.status === targetStatus)
    .map((session) => `${session.operator_goal} (${session.status})`);
}

function buildRecord(queueResult: BackgroundQueueResult): BackgroundRunHistoryRecord {
  const approvalsNeeded = unique(queueResult.run_results.flatMap((result) => result.approvals_needed));
  return {
    record_id: `background-run-history-record-${queueResult.report.report_id}`,
    created_at: queueResult.report.created_at,
    queue_report_id: queueResult.report.report_id,
    queue_status: queueResult.status,
    sessions_considered: queueResult.sessions_considered,
    sessions_run: queueResult.sessions_run,
    sessions_completed: queueResult.sessions_completed,
    sessions_paused: queueResult.sessions_paused,
    sessions_skipped: queueResult.sessions_skipped,
    sessions_blocked: queueResult.sessions_blocked,
    approvals_needed: approvalsNeeded,
    blockers: uniqueBlockers(queueResult.blockers),
    next_operator_action: queueResult.next_operator_action,
    safe_to_continue_later: queueResult.safe_to_continue_later,
    completed_work_summary: summarizeQueuedGoals(queueResult.queue.sessions, "completed"),
    paused_work_summary: summarizeQueuedGoals(queueResult.queue.sessions, "paused"),
    skipped_work_summary: summarizeQueuedGoals(queueResult.queue.sessions, "skipped"),
    blocked_work_summary: summarizeQueuedGoals(queueResult.queue.sessions, "blocked"),
  };
}

export function createBackgroundRunHistory(): BackgroundRunHistory {
  return {
    history_id: "background-run-history",
    created_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    records: [],
  };
}

export function appendBackgroundRunRecord(
  history: BackgroundRunHistory,
  queueResult: BackgroundQueueResult,
): BackgroundRunHistory {
  const record = buildRecord(queueResult);
  return {
    ...history,
    records: [...history.records, record],
  };
}

export function buildOperatorAwayDigest(
  history: BackgroundRunHistory,
  window?: { window_start?: string | null; window_end?: string | null },
): OperatorAwayDigest {
  const windowStart = normalizeText(window?.window_start) || null;
  const windowEnd = normalizeText(window?.window_end) || null;
  const startMs = parseTimestamp(windowStart);
  const endMs = parseTimestamp(windowEnd);
  const records = history.records.filter((record) => {
    const createdAt = parseTimestamp(record.created_at);
    if (createdAt === null) {
      return false;
    }
    if (startMs !== null && createdAt < startMs) {
      return false;
    }
    if (endMs !== null && createdAt > endMs) {
      return false;
    }
    return true;
  });

  const approvalsNeeded = unique(records.flatMap((record) => record.approvals_needed));
  const blockers = uniqueBlockers(records.flatMap((record) => record.blockers));
  const completedItems = records.flatMap((record) => record.completed_work_summary);
  const pausedItems = records.flatMap((record) => record.paused_work_summary);
  const blockedItems = records.flatMap((record) => [...record.blocked_work_summary, ...record.skipped_work_summary]);
  const recommendedNextActions = unique(records.map((record) => record.next_operator_action)).map((action) => ({
    priority: blockers.length > 0 ? "blocked" as const : approvalsNeeded.length > 0 || pausedItems.length > 0 ? "attention" as const : "normal" as const,
    action,
  }));

  const overallStatus: DigestStatus = records.length === 0
    ? "digest_empty"
    : blockers.length > 0 && records.some((record) => record.safe_to_continue_later === false)
      ? "digest_blocked"
      : approvalsNeeded.length > 0 || pausedItems.length > 0 || blockedItems.length > 0
        ? "digest_needs_attention"
        : "digest_ready";

  const createdAt = records.at(-1)?.created_at ?? history.created_at;
  return {
    digest_id: `operator-away-digest-${sanitizeTimestamp(createdAt)}`,
    created_at: createdAt,
    window_start: windowStart,
    window_end: windowEnd,
    total_runs: records.length,
    total_sessions_considered: records.reduce((sum, record) => sum + record.sessions_considered, 0),
    total_sessions_completed: records.reduce((sum, record) => sum + record.sessions_completed, 0),
    total_sessions_paused: records.reduce((sum, record) => sum + record.sessions_paused, 0),
    total_sessions_skipped: records.reduce((sum, record) => sum + record.sessions_skipped, 0),
    total_sessions_blocked: records.reduce((sum, record) => sum + record.sessions_blocked, 0),
    approvals_needed: approvalsNeeded,
    blockers,
    completed_work_summary: {
      title: "Completed work",
      items: completedItems,
    },
    paused_work_summary: {
      title: "Paused work",
      items: pausedItems,
    },
    blocked_work_summary: {
      title: "Blocked or skipped work",
      items: blockedItems,
    },
    recommended_next_actions: recommendedNextActions,
    overall_status: overallStatus,
  };
}

export function summarizeOperatorAwayDigest(digest: OperatorAwayDigest): string {
  return [
    `Operator-away digest status: ${digest.overall_status}`,
    `Total runs: ${digest.total_runs}`,
    `Total sessions considered: ${digest.total_sessions_considered}`,
    `Total sessions completed: ${digest.total_sessions_completed}`,
    `Total sessions paused: ${digest.total_sessions_paused}`,
    `Total sessions skipped: ${digest.total_sessions_skipped}`,
    `Total sessions blocked: ${digest.total_sessions_blocked}`,
    `Approvals needed: ${digest.approvals_needed.join(", ") || "none"}`,
    `Completed work: ${digest.completed_work_summary.items.join("; ") || "none"}`,
    `Paused work: ${digest.paused_work_summary.items.join("; ") || "none"}`,
    `Blocked work: ${digest.blocked_work_summary.items.join("; ") || "none"}`,
    `Recommended actions: ${digest.recommended_next_actions.map((item) => item.action).join("; ") || "none"}`,
  ].join("\n");
}