import type {
  PromptDomainDiagnosticSummary,
  PromptDomainReport,
} from "./governedPromptDomainRegistry";

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function byAverageDomainScore(reports: PromptDomainReport[], direction: "strongest" | "weakest"): string | null {
  const comparable = reports.filter((entry) => entry.compatibility && entry.metrics);
  if (comparable.length === 0) {
    return null;
  }

  const sorted = [...comparable].sort((left, right) => {
    const delta = (left.compatibility?.compatibilityScore ?? 0) - (right.compatibility?.compatibilityScore ?? 0);
    return direction === "strongest" ? -delta : delta;
  });

  return sorted[0]?.domainLabel ?? null;
}

export function summarizePromptDomainDiagnostics(reports: PromptDomainReport[]): PromptDomainDiagnosticSummary {
  const metricReports = reports.filter((entry) => entry.metrics);
  const rejectedDomainCount = reports.filter((entry) => entry.safetyStatus === "REJECTED").length;
  const rollbackPasses = metricReports.filter((entry) => entry.metrics?.rollbackIntegrityStatus === "PASS").length;
  const failedReports = reports.filter((entry) => !entry.pass);
  const recommendedRuntimeLayer = failedReports.find((entry) => entry.recommendedRuntimeLayer)?.recommendedRuntimeLayer ?? null;

  let recommendedNextAction: PromptDomainDiagnosticSummary["recommendedNextAction"] = "CONTINUE_DOMAIN_EXPANSION";
  if (rejectedDomainCount > 0 || rollbackPasses < metricReports.length) {
    recommendedNextAction = "BLOCK_ESCALATION";
  } else if (failedReports.length > 0) {
    recommendedNextAction = "TUNE_COHESION_LAYER";
  }

  return {
    testedDomainCount: reports.length,
    passedDomainCount: reports.filter((entry) => entry.pass).length,
    rejectedDomainCount,
    strongestDomain: byAverageDomainScore(reports, "strongest"),
    weakestDomain: byAverageDomainScore(reports, "weakest"),
    averageSceneCohesion: average(metricReports.map((entry) => entry.metrics?.sceneCohesion ?? 0)),
    averageTransitionSmoothness: average(metricReports.map((entry) => entry.metrics?.transitionSmoothness ?? 0)),
    averageTensionContinuity: average(metricReports.map((entry) => entry.metrics?.tensionContinuity ?? 0)),
    averageMomentumContinuity: average(metricReports.map((entry) => entry.metrics?.momentumContinuity ?? 0)),
    averagePreviewReadability: average(metricReports.map((entry) => entry.metrics?.previewReadability ?? 0)),
    rollbackPassRate: metricReports.length === 0 ? 0 : Number((rollbackPasses / metricReports.length).toFixed(2)),
    recommendedNextAction,
    recommendedRuntimeLayer,
  };
}