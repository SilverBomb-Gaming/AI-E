export type NodeHealthStatus = "healthy" | "degraded" | "unreachable" | "unknown";

export type NodeHealthSnapshot = {
  node_id: string;
  checked_at: string;
  status: NodeHealthStatus;
  latency_ms?: number;
  uptime_seconds?: number;
  load_average?: number;
  warnings: string[];
  execution_ready: false;
};

const nodeHealthSnapshots: NodeHealthSnapshot[] = [];

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTimestamp(value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    return new Date().toISOString();
  }

  return normalized;
}

function normalizeStatus(value: unknown): NodeHealthStatus {
  return value === "healthy" || value === "degraded" || value === "unreachable" || value === "unknown"
    ? value
    : "unknown";
}

function normalizeOptionalNonNegativeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return undefined;
  }

  return Math.round(normalized * 1000) / 1000;
}

function normalizeWarnings(warnings: readonly string[]): string[] {
  return warnings
    .map((warning) => normalizeText(warning))
    .filter((warning, index, allWarnings) => warning.length > 0 && allWarnings.indexOf(warning) === index);
}

function cloneSnapshot(snapshot: NodeHealthSnapshot): NodeHealthSnapshot {
  return {
    ...snapshot,
    warnings: [...snapshot.warnings],
  };
}

function normalizeSnapshot(snapshot: NodeHealthSnapshot): NodeHealthSnapshot {
  return {
    node_id: normalizeText(snapshot.node_id),
    checked_at: normalizeTimestamp(snapshot.checked_at),
    status: normalizeStatus(snapshot.status),
    latency_ms: normalizeOptionalNonNegativeNumber(snapshot.latency_ms),
    uptime_seconds: normalizeOptionalNonNegativeNumber(snapshot.uptime_seconds),
    load_average: normalizeOptionalNonNegativeNumber(snapshot.load_average),
    warnings: normalizeWarnings(snapshot.warnings),
    execution_ready: false,
  };
}

export function recordNodeHealthSnapshot(snapshot: NodeHealthSnapshot): NodeHealthSnapshot {
  const normalized = normalizeSnapshot(snapshot);
  nodeHealthSnapshots.push(normalized);
  return cloneSnapshot(normalized);
}

export function queryNodeHealthSnapshots(filters?: {
  node_id?: string;
  status?: NodeHealthStatus;
}): NodeHealthSnapshot[] {
  return nodeHealthSnapshots
    .filter((snapshot) => {
      if (filters?.node_id && snapshot.node_id !== filters.node_id) {
        return false;
      }

      if (filters?.status && snapshot.status !== filters.status) {
        return false;
      }

      return true;
    })
    .sort((left, right) => left.checked_at.localeCompare(right.checked_at) || left.node_id.localeCompare(right.node_id))
    .map((snapshot) => cloneSnapshot(snapshot));
}

export function getLatestNodeHealth(node_id: string): NodeHealthSnapshot | null {
  const normalizedNodeId = normalizeText(node_id);
  const snapshots = queryNodeHealthSnapshots({ node_id: normalizedNodeId });
  return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
}

export function renderNodeHealthSnapshot(snapshot: NodeHealthSnapshot): string {
  const lines = [
    `Node health snapshot: ${snapshot.node_id}`,
    `Checked at: ${snapshot.checked_at}`,
    `Status: ${snapshot.status}`,
    `Latency ms: ${snapshot.latency_ms ?? "unknown"}`,
    `Uptime seconds: ${snapshot.uptime_seconds ?? "unknown"}`,
    `Load average: ${snapshot.load_average ?? "unknown"}`,
    `Warnings: ${snapshot.warnings.length ? snapshot.warnings.join(", ") : "none"}`,
    `Execution ready: ${snapshot.execution_ready ? "true" : "false"}`,
    "Read-only health snapshot only. No routing, execution, remote mutation, scheduling, or autonomy is triggered.",
  ];

  return lines.join("\n");
}

export function resetNodeHealthSnapshotsForTests(): void {
  nodeHealthSnapshots.length = 0;
}