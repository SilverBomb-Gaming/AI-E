import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PassiveLearningSignals } from "./passiveLearningSignals";
import type { SimulatedRankingAdjustment } from "./passiveLearningSimulation";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_LEARNING_AUDIT_DIRECTORY = path.join(REPO_ROOT, "data", "learning_audits");

export type PassiveLearningAudit = {
  audit_id: string;
  created_at: string;
  source_decision_record_count: number;
  signal_snapshot: PassiveLearningSignals;
  simulation_snapshot: SimulatedRankingAdjustment[];
  checksum: string;
  frozen: true;
  applied: false;
};

export type PassiveLearningAuditWriteResult = {
  status: "recorded";
  audit: PassiveLearningAudit;
  output_path: string;
  append_only: true;
  frozen: true;
  applied: false;
  execution_triggered: false;
  autonomy_triggered: false;
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function cloneSignals(signals: PassiveLearningSignals): PassiveLearningSignals {
  return {
    ...signals,
    misalignment_patterns: signals.misalignment_patterns.map((pattern) => ({ ...pattern })),
  };
}

function cloneSimulation(adjustment: SimulatedRankingAdjustment): SimulatedRankingAdjustment {
  return {
    plan_id: adjustment.plan_id,
    current_score: adjustment.current_score,
    simulated_adjusted_score: adjustment.simulated_adjusted_score,
    delta: adjustment.delta,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function buildChecksumPayload(audit: Omit<PassiveLearningAudit, "checksum" | "audit_id">): string {
  return stableStringify({
    created_at: audit.created_at,
    source_decision_record_count: audit.source_decision_record_count,
    signal_snapshot: audit.signal_snapshot,
    simulation_snapshot: audit.simulation_snapshot,
    frozen: audit.frozen,
    applied: audit.applied,
  });
}

function buildChecksum(audit: Omit<PassiveLearningAudit, "checksum" | "audit_id">): string {
  return createHash("sha256").update(buildChecksumPayload(audit)).digest("hex");
}

export function buildPassiveLearningAudit(input: {
  signals: PassiveLearningSignals;
  simulations: readonly SimulatedRankingAdjustment[];
  source_decision_record_count: number;
  createdAt?: string;
}): PassiveLearningAudit {
  const createdAt = hasNonEmptyString(input.createdAt) ? input.createdAt.trim() : new Date().toISOString();
  const baseAudit = {
    created_at: createdAt,
    source_decision_record_count: Math.max(0, Math.trunc(input.source_decision_record_count)),
    signal_snapshot: cloneSignals(input.signals),
    simulation_snapshot: input.simulations.map(cloneSimulation),
    frozen: true as const,
    applied: false as const,
  };
  const checksum = buildChecksum(baseAudit);

  return {
    audit_id: `learning-audit-${createdAt.replace(/[:.]/g, "-")}-${checksum.slice(0, 12)}`,
    ...baseAudit,
    checksum,
  };
}

export async function recordPassiveLearningAudit(
  audit: PassiveLearningAudit,
  options?: { outputDirectory?: string },
): Promise<PassiveLearningAuditWriteResult> {
  const normalizedAudit = buildPassiveLearningAudit({
    signals: audit.signal_snapshot,
    simulations: audit.simulation_snapshot,
    source_decision_record_count: audit.source_decision_record_count,
    createdAt: audit.created_at,
  });
  const outputDirectory = options?.outputDirectory?.trim() || DEFAULT_LEARNING_AUDIT_DIRECTORY;
  const outputPath = path.join(outputDirectory, `${normalizedAudit.created_at.slice(0, 10) || "unknown-date"}.jsonl`);

  await mkdir(outputDirectory, { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(normalizedAudit)}\n`, "utf-8");

  return {
    status: "recorded",
    audit: normalizedAudit,
    output_path: outputPath,
    append_only: true,
    frozen: true,
    applied: false,
    execution_triggered: false,
    autonomy_triggered: false,
  };
}

export function renderPassiveLearningAudit(audit: PassiveLearningAudit): string {
  const lines = [
    `Passive learning audit: ${audit.audit_id}`,
    `Created at: ${audit.created_at}`,
    `Source decision record count: ${audit.source_decision_record_count}`,
    `Checksum: ${audit.checksum}`,
    `Frozen: ${audit.frozen ? "true" : "false"}`,
    `Applied: ${audit.applied ? "true" : "false"}`,
    "",
    "Signal snapshot:",
    `- Recommendation accuracy: ${audit.signal_snapshot.recommendation_accuracy.toFixed(3)}`,
    `- Average error margin: ${audit.signal_snapshot.average_error_margin.toFixed(3)}`,
    `- Misalignment patterns: ${audit.signal_snapshot.misalignment_patterns.length}`,
    "",
    "Simulation snapshot:",
    `- Simulated plans: ${audit.simulation_snapshot.length}`,
  ];

  for (const adjustment of audit.simulation_snapshot) {
    lines.push(`- ${adjustment.plan_id}: current ${adjustment.current_score.toFixed(3)}, simulated ${adjustment.simulated_adjusted_score.toFixed(3)}, delta ${adjustment.delta >= 0 ? "+" : ""}${adjustment.delta.toFixed(3)}`);
  }

  lines.push("");
  lines.push("Frozen audit only. No learning was applied, and no ranking, planning, selection, readiness, or execution behavior changed.");
  return lines.join("\n");
}