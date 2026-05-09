import type { VisualStyleDiagnosticSummary, VisualStyleReport } from "./governedVisualStyleRegistry";

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function sortByCompatibility(reports: VisualStyleReport[], direction: "strongest" | "weakest"): string | null {
  const comparable = reports.filter((entry) => entry.compatibility && entry.metrics);
  if (comparable.length === 0) {
    return null;
  }

  const sorted = [...comparable].sort((left, right) => {
    const delta = (left.compatibility?.compatibilityScore ?? 0) - (right.compatibility?.compatibilityScore ?? 0);
    return direction === "strongest" ? -delta : delta;
  });

  return sorted[0]?.styleLabel ?? null;
}

export function summarizeVisualStyleDiagnostics(reports: VisualStyleReport[]): VisualStyleDiagnosticSummary {
  const metricReports = reports.filter((entry) => entry.metrics);
  const rejectedStyleCount = reports.filter((entry) => entry.safetyStatus === "REJECTED").length;
  const rollbackPasses = metricReports.filter((entry) => entry.metrics?.rollbackIntegrityStatus === "PASS").length;
  const failedReports = reports.filter((entry) => !entry.pass);
  const recommendedRuntimeLayer = failedReports.find((entry) => entry.recommendedRuntimeLayer)?.recommendedRuntimeLayer ?? null;

  let recommendedNextAction: VisualStyleDiagnosticSummary["recommendedNextAction"] = "CONTINUE_STYLE_EXPANSION";
  if (rejectedStyleCount > 0 || rollbackPasses < metricReports.length) {
    recommendedNextAction = "BLOCK_ESCALATION";
  } else if (failedReports.length > 0) {
    recommendedNextAction = "TUNE_VISUAL_LAYERS";
  }

  return {
    testedStyleCount: reports.length,
    passedStyleCount: reports.filter((entry) => entry.pass).length,
    rejectedStyleCount,
    strongestStyle: sortByCompatibility(reports, "strongest"),
    weakestStyle: sortByCompatibility(reports, "weakest"),
    averageSceneCohesion: average(metricReports.map((entry) => entry.metrics?.sceneCohesion ?? 0)),
    averageTransitionSmoothness: average(metricReports.map((entry) => entry.metrics?.transitionSmoothness ?? 0)),
    averageLightingStability: average(metricReports.map((entry) => entry.metrics?.lightingStability ?? 0)),
    averageReflectionContinuity: average(metricReports.map((entry) => entry.metrics?.reflectionContinuity ?? 0)),
    averageSilhouetteReadability: average(metricReports.map((entry) => entry.metrics?.silhouetteReadability ?? 0)),
    averagePreviewReadability: average(metricReports.map((entry) => entry.metrics?.previewReadability ?? 0)),
    rollbackPassRate: metricReports.length === 0 ? 0 : Number((rollbackPasses / metricReports.length).toFixed(2)),
    recommendedNextAction,
    recommendedRuntimeLayer,
  };
}