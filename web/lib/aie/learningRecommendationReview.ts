import path, { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PassiveLearningAudit } from "./passiveLearningAudit";

export type LearningRecommendationKind =
  | "ranking_adjustment_candidate"
  | "risk_weight_review"
  | "rollback_penalty_review"
  | "insufficient_data_warning";

export type LearningRecommendation = {
  recommendation_id: string;
  created_at: string;
  source_audit_id: string;
  recommendation_kind: LearningRecommendationKind;
  summary: string;
  rationale: string;
  confidence: number;
  proposed_change_preview: string;
  applied: false;
  requires_operator_review: true;
};

function roundToThree(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function buildRecommendation(
  audit: PassiveLearningAudit,
  kind: LearningRecommendationKind,
  summary: string,
  rationale: string,
  confidence: number,
  proposedChangePreview: string,
): LearningRecommendation {
  const normalizedConfidence = roundToThree(confidence);

  return {
    recommendation_id: `${kind}-${audit.created_at.replace(/[:.]/g, "-")}-${audit.checksum.slice(0, 8)}`,
    created_at: audit.created_at,
    source_audit_id: audit.audit_id,
    recommendation_kind: kind,
    summary,
    rationale,
    confidence: normalizedConfidence,
    proposed_change_preview: proposedChangePreview,
    applied: false,
    requires_operator_review: true,
  };
}

export function generateLearningRecommendations(audit: PassiveLearningAudit): LearningRecommendation[] {
  if (audit.frozen !== true) {
    throw new Error("Learning recommendations require a frozen passive learning audit.");
  }

  if (audit.applied !== false) {
    throw new Error("Learning recommendations require an unapplied passive learning audit.");
  }

  const recommendations: LearningRecommendation[] = [];
  const signals = audit.signal_snapshot;
  const simulations = audit.simulation_snapshot;
  const maximumDelta = simulations.reduce((max, simulation) => Math.max(max, Math.abs(simulation.delta)), 0);
  const rollbackSensitive = simulations.filter((simulation) => simulation.delta <= -0.02).length;

  if (audit.source_decision_record_count < 3) {
    recommendations.push(buildRecommendation(
      audit,
      "insufficient_data_warning",
      "Learning audit has limited decision history.",
      `Only ${audit.source_decision_record_count} decision records contributed to this frozen audit, which is below the threshold for confident review guidance.`,
      0.32,
      "Collect more operator-reviewed decision records before considering any learning-related change proposal.",
    ));
  }

  if (signals.recommendation_accuracy <= 0.6) {
    recommendations.push(buildRecommendation(
      audit,
      "ranking_adjustment_candidate",
      "Review ranking weights against operator selection history.",
      `Frozen learning signals show recommendation accuracy at ${(signals.recommendation_accuracy * 100).toFixed(0)}%, suggesting the current advisory ranking may not match operator preferences consistently.`,
      0.68,
      "Review ranking-weight assumptions in a future operator-approved design pass; do not apply automatically.",
    ));
  }

  if (signals.average_error_margin >= 0.05) {
    recommendations.push(buildRecommendation(
      audit,
      "risk_weight_review",
      "Review risk weighting assumptions.",
      `The frozen audit shows an average error margin of ${signals.average_error_margin.toFixed(3)}, indicating the advisory model may be under- or over-valuing risk-related factors.`,
      0.59,
      "Review risk weighting heuristics in a future manual analysis pass; keep current behavior unchanged.",
    ));
  }

  if (rollbackSensitive > 0 || maximumDelta >= 0.02) {
    recommendations.push(buildRecommendation(
      audit,
      "rollback_penalty_review",
      "Review rollback penalty assumptions.",
      `Frozen shadow simulations show ${rollbackSensitive} plans with notable negative adjustment pressure and a maximum delta of ${maximumDelta.toFixed(3)}, which may indicate rollback penalties deserve manual review.`,
      0.62,
      "Review rollback penalty weighting in a future operator-approved design discussion; do not apply automatically.",
    ));
  }

  return recommendations;
}

export function renderLearningRecommendations(recommendations: readonly LearningRecommendation[]): string {
  const lines = ["Learning recommendations are review-only.", ""];

  if (recommendations.length === 0) {
    lines.push("- No review recommendations generated from the frozen audit.");
  } else {
    for (const recommendation of recommendations) {
      lines.push(`${recommendation.recommendation_kind}: ${recommendation.summary}`);
      lines.push(`- Recommendation id: ${recommendation.recommendation_id}`);
      lines.push(`- Source audit: ${recommendation.source_audit_id}`);
      lines.push(`- Confidence: ${recommendation.confidence.toFixed(3)}`);
      lines.push(`- Rationale: ${recommendation.rationale}`);
      lines.push(`- Proposed change preview: ${recommendation.proposed_change_preview}`);
      lines.push(`- Applied: ${recommendation.applied ? "true" : "false"}`);
      lines.push(`- Requires operator review: ${recommendation.requires_operator_review ? "true" : "false"}`);
      lines.push("");
    }
  }

  lines.push("Review only. No learning is applied and no ranking, plan, selection, readiness, or execution behavior changes occur.");
  return lines.join("\n");
}

type ShowLearningRecommendationsOptions = {
  auditFile?: string;
  json: boolean;
};

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

function parseArgs(argv: string[]): ShowLearningRecommendationsOptions {
  const options: ShowLearningRecommendationsOptions = {
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg.startsWith("--audit-file=")) {
      options.auditFile = arg.slice("--audit-file=".length).trim() || undefined;
      continue;
    }

    if (arg === "--audit-file") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --audit-file");
      }
      options.auditFile = value.trim();
      index += 1;
    }
  }

  return options;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(argv);
    const modulePath = options.auditFile
      ? pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", options.auditFile)).href
      : undefined;
    const source = modulePath ? await import(modulePath) : null;
    const audit = (source?.default ?? source?.audit) as PassiveLearningAudit | undefined;

    if (!audit) {
      throw new Error("No audit was provided. Use --audit-file to supply a frozen audit export.");
    }

    const recommendations = generateLearningRecommendations(audit);

    if (options.json) {
      console.log(JSON.stringify(recommendations, null, 2));
      return 0;
    }

    console.log(renderLearningRecommendations(recommendations));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Learning recommendation display failed: ${message}`);
    return 1;
  }
}

if (isDirectExecution()) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}