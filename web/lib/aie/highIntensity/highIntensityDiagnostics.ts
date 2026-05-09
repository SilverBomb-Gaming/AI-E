import type { HighIntensityDiagnosticSummary, HighIntensityReport } from "./governedHighIntensityState";
import { averageHighIntensityMetric } from "./governedHighIntensityState";

function highStyleByRisk(reports: HighIntensityReport[], direction: "safest" | "riskiest"): string | null {
  const comparable = reports.filter((entry) => entry.compatibility);
  if (comparable.length === 0) {
    return null;
  }

  const sorted = [...comparable].sort((left, right) => {
    const delta = (left.compatibility?.compatibilityScore ?? 0) - (right.compatibility?.compatibilityScore ?? 0);
    if (delta !== 0) {
      return direction === "safest" ? -delta : delta;
    }

    return direction === "safest"
      ? left.styleId.localeCompare(right.styleId)
      : right.styleId.localeCompare(left.styleId);
  });

  return sorted[0]?.styleId ?? null;
}

function probeByCompatibility(reports: HighIntensityReport[], direction: "strongest" | "weakest"): string | null {
  const comparable = reports.filter((entry) => entry.compatibility);
  if (comparable.length === 0) {
    return null;
  }

  const sorted = [...comparable].sort((left, right) => {
    const delta = (left.compatibility?.compatibilityScore ?? 0) - (right.compatibility?.compatibilityScore ?? 0);
    return direction === "strongest" ? -delta : delta;
  });

  return sorted[0]?.probeId ?? null;
}

export function summarizeHighIntensityDiagnostics(reports: HighIntensityReport[]): HighIntensityDiagnosticSummary {
  const metricReports = reports.filter((entry) => entry.metrics);
  const failedReports = reports.filter((entry) => !entry.pass);
  const rollbackPasses = metricReports.filter((entry) => entry.metrics?.rollbackIntegrityStatus === "PASS").length;
  const blockedReports = reports.filter((entry) => entry.safetyStatus === "REJECTED").length;
  const recommendedRuntimeLayer = failedReports.find((entry) => entry.recommendedRuntimeLayer)?.recommendedRuntimeLayer ?? null;

  let recommendedNextAction: HighIntensityDiagnosticSummary["recommendedNextAction"] = "CONTINUE_HIGH_PROBES";
  if (blockedReports > 0 || metricReports.some((entry) => entry.metrics?.rollbackIntegrityStatus !== "PASS")) {
    recommendedNextAction = "BLOCK_HIGH_ESCALATION";
  } else if (failedReports.length > 0) {
    recommendedNextAction = "TUNE_VISUAL_CAPS";
  }

  return {
    testedHighProbeCount: reports.length,
    passedHighProbeCount: reports.filter((entry) => entry.pass).length,
    failedHighProbeCount: failedReports.length,
    safestHighStyleId: highStyleByRisk(reports, "safest"),
    riskiestHighStyleId: highStyleByRisk(reports, "riskiest"),
    averageHighReadability: averageHighIntensityMetric(reports, (report) => report.metrics?.highReadabilityScore ?? 0),
    averageHighLightingStability: averageHighIntensityMetric(reports, (report) => report.metrics?.lightingStability ?? 0),
    averageHighReflectionContinuity: averageHighIntensityMetric(reports, (report) => report.metrics?.reflectionContinuity ?? 0),
    averageHighSilhouettePreservation: averageHighIntensityMetric(reports, (report) => report.metrics?.silhouettePreservation ?? 0),
    averageHighEnvironmentalIdentity: averageHighIntensityMetric(reports, (report) => report.metrics?.environmentalIdentity ?? 0),
    averageHighTransitionContinuity: averageHighIntensityMetric(reports, (report) => report.metrics?.transitionContinuity ?? 0),
    averageHighCompositionReadability: averageHighIntensityMetric(reports, (report) => report.metrics?.compositionReadability ?? 0),
    rollbackPassRate: metricReports.length === 0 ? 0 : Number((rollbackPasses / metricReports.length).toFixed(2)),
    strongestProbeId: probeByCompatibility(reports, "strongest"),
    weakestProbeId: probeByCompatibility(reports, "weakest"),
    recommendedNextAction,
    recommendedRuntimeLayer,
  };
}
