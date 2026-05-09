import type { StyleStressDiagnosticSummary, StyleStressReport } from "./governedStyleStressState";

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function averageCompatibilityByDimension(reports: StyleStressReport[], dimension: "styleId" | "domainId", direction: "strongest" | "weakest"): string | null {
  const grouped = new Map<string, number[]>();
  for (const report of reports) {
    if (!report.compatibility) {
      continue;
    }

    const current = grouped.get(report[dimension]) ?? [];
    current.push(report.compatibility.compatibilityScore);
    grouped.set(report[dimension], current);
  }

  if (grouped.size === 0) {
    return null;
  }

  const ranked = [...grouped.entries()].map(([key, values]) => ({
    key,
    average: average(values),
  }));
  ranked.sort((left, right) => direction === "strongest" ? right.average - left.average : left.average - right.average);
  return ranked[0]?.key ?? null;
}

function cellByCompatibility(reports: StyleStressReport[], direction: "strongest" | "weakest"): string | null {
  const comparable = reports.filter((entry) => entry.compatibility);
  if (comparable.length === 0) {
    return null;
  }

  const sorted = [...comparable].sort((left, right) => {
    const delta = (left.compatibility?.compatibilityScore ?? 0) - (right.compatibility?.compatibilityScore ?? 0);
    return direction === "strongest" ? -delta : delta;
  });

  return sorted[0]?.cellId ?? null;
}

export function summarizeStyleStressDiagnostics(reports: StyleStressReport[]): StyleStressDiagnosticSummary {
  const metricReports = reports.filter((entry) => entry.metrics);
  const failedReports = reports.filter((entry) => !entry.pass);
  const rollbackPasses = metricReports.filter((entry) => entry.metrics?.rollbackIntegrityStatus === "PASS").length;
  const blockedReports = reports.filter((entry) => entry.safetyStatus === "REJECTED").length;
  const recommendedRuntimeLayer = failedReports.find((entry) => entry.recommendedRuntimeLayer)?.recommendedRuntimeLayer ?? null;

  let recommendedNextAction: StyleStressDiagnosticSummary["recommendedNextAction"] = "CONTINUE_STYLE_TESTING";
  if (blockedReports > 0 || rollbackPasses < metricReports.length) {
    recommendedNextAction = "BLOCK_STYLE_ESCALATION";
  } else if (failedReports.length > 0) {
    recommendedNextAction = "TUNE_STYLE_PROFILE";
  }

  return {
    testedCellCount: reports.length,
    passedCellCount: reports.filter((entry) => entry.pass).length,
    failedCellCount: failedReports.length,
    strongestStyleId: averageCompatibilityByDimension(reports, "styleId", "strongest"),
    weakestStyleId: averageCompatibilityByDimension(reports, "styleId", "weakest"),
    strongestDomainId: averageCompatibilityByDimension(reports, "domainId", "strongest"),
    weakestDomainId: averageCompatibilityByDimension(reports, "domainId", "weakest"),
    styleDomainPassRate: reports.length === 0 ? 0 : Number((reports.filter((entry) => entry.pass).length / reports.length).toFixed(2)),
    averageSceneCohesion: average(metricReports.map((entry) => entry.metrics?.sceneCohesion ?? 0)),
    averageStyleReadability: average(metricReports.map((entry) => entry.metrics?.previewReadability ?? 0)),
    averageLightingStability: average(metricReports.map((entry) => entry.metrics?.lightingStability ?? 0)),
    averageReflectionContinuity: average(metricReports.map((entry) => entry.metrics?.reflectionContinuity ?? 0)),
    rollbackPassRate: metricReports.length === 0 ? 0 : Number((rollbackPasses / metricReports.length).toFixed(2)),
    strongestCellId: cellByCompatibility(reports, "strongest"),
    weakestCellId: cellByCompatibility(reports, "weakest"),
    recommendedNextAction,
    recommendedRuntimeLayer,
  };
}