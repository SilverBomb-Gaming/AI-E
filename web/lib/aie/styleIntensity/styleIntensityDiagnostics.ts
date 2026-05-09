import type { StyleIntensityDiagnosticSummary, StyleIntensityLevel, StyleIntensityReport } from "./governedStyleIntensityState";
import { STYLE_INTENSITY_LEVELS } from "./styleIntensityPresets";

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function averageForIntensity(reports: StyleIntensityReport[], level: StyleIntensityLevel, selector: (report: StyleIntensityReport) => number): number {
  return average(reports.filter((entry) => entry.intensityLevel === level && entry.metrics).map(selector));
}

function rollbackPassRateForIntensity(reports: StyleIntensityReport[], level: StyleIntensityLevel): number {
  const metricReports = reports.filter((entry) => entry.intensityLevel === level && entry.metrics);
  if (metricReports.length === 0) {
    return 0;
  }

  return Number((metricReports.filter((entry) => entry.metrics?.rollbackIntegrityStatus === "PASS").length / metricReports.length).toFixed(2));
}

function strongestOrWeakestIntensityByStyle(reports: StyleIntensityReport[], direction: "strongest" | "weakest"): Record<string, StyleIntensityLevel> {
  const byStyle = new Map<string, StyleIntensityReport[]>();
  for (const report of reports) {
    if (!report.compatibility) {
      continue;
    }

    const current = byStyle.get(report.styleId) ?? [];
    current.push(report);
    byStyle.set(report.styleId, current);
  }

  const result: Record<string, StyleIntensityLevel> = {};
  for (const [styleId, styleReports] of byStyle.entries()) {
    const byIntensity = new Map<StyleIntensityLevel, number[]>();
    for (const report of styleReports) {
      const current = byIntensity.get(report.intensityLevel) ?? [];
      current.push(report.compatibility?.compatibilityScore ?? 0);
      byIntensity.set(report.intensityLevel, current);
    }

    const ranked = [...byIntensity.entries()].map(([level, values]) => ({
      level,
      average: average(values),
    }));
    ranked.sort((left, right) => direction === "strongest" ? right.average - left.average : left.average - right.average);
    const selected = ranked[0]?.level;
    if (selected) {
      result[styleId] = selected;
    }
  }

  return result;
}

function highIntensityStyleByRisk(reports: StyleIntensityReport[], direction: "safest" | "riskiest"): string | null {
  const highReports = reports.filter((entry) => entry.intensityLevel === "HIGH" && entry.compatibility);
  if (highReports.length === 0) {
    return null;
  }

  const ranked = [...highReports].sort((left, right) => {
    const delta = (left.compatibility?.compatibilityScore ?? 0) - (right.compatibility?.compatibilityScore ?? 0);
    return direction === "safest" ? -delta : delta;
  });

  return ranked[0]?.styleId ?? null;
}

function cellByCompatibility(reports: StyleIntensityReport[], direction: "strongest" | "weakest"): string | null {
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

function buildIntensityMetricRecord(reports: StyleIntensityReport[], selector: (report: StyleIntensityReport) => number): Record<StyleIntensityLevel, number> {
  return STYLE_INTENSITY_LEVELS.reduce((record, level) => ({
    ...record,
    [level]: averageForIntensity(reports, level, selector),
  }), {} as Record<StyleIntensityLevel, number>);
}

export function summarizeStyleIntensityDiagnostics(reports: StyleIntensityReport[]): StyleIntensityDiagnosticSummary {
  const metricReports = reports.filter((entry) => entry.metrics);
  const failedReports = reports.filter((entry) => !entry.pass);
  const highFailures = failedReports.filter((entry) => entry.intensityLevel === "HIGH");
  const rollbackPasses = metricReports.filter((entry) => entry.metrics?.rollbackIntegrityStatus === "PASS").length;
  const blockedReports = reports.filter((entry) => entry.safetyStatus === "REJECTED").length;
  const recommendedRuntimeLayer = failedReports.find((entry) => entry.recommendedRuntimeLayer)?.recommendedRuntimeLayer ?? null;

  let recommendedNextAction: StyleIntensityDiagnosticSummary["recommendedNextAction"] = "CONTINUE_INTENSITY_TESTING";
  if (blockedReports > 0 || highFailures.length > 0 || rollbackPasses < metricReports.length) {
    recommendedNextAction = "BLOCK_HIGH_INTENSITY";
  } else if (failedReports.length > 0) {
    recommendedNextAction = "TUNE_STYLE_INTENSITY";
  }

  return {
    testedIntensityCount: reports.length,
    passedIntensityCount: reports.filter((entry) => entry.pass).length,
    failedIntensityCount: failedReports.length,
    strongestIntensityLevelByStyle: strongestOrWeakestIntensityByStyle(reports, "strongest"),
    weakestIntensityLevelByStyle: strongestOrWeakestIntensityByStyle(reports, "weakest"),
    safestHighIntensityStyleId: highIntensityStyleByRisk(reports, "safest"),
    riskiestHighIntensityStyleId: highIntensityStyleByRisk(reports, "riskiest"),
    averageSceneCohesion: average(metricReports.map((entry) => entry.metrics?.sceneCohesion ?? 0)),
    averageStyleReadability: average(metricReports.map((entry) => entry.metrics?.styleReadability ?? 0)),
    averageLightingStability: average(metricReports.map((entry) => entry.metrics?.lightingStability ?? 0)),
    averageReflectionContinuity: average(metricReports.map((entry) => entry.metrics?.reflectionContinuity ?? 0)),
    rollbackPassRate: metricReports.length === 0 ? 0 : Number((rollbackPasses / metricReports.length).toFixed(2)),
    averageSceneCohesionByIntensity: buildIntensityMetricRecord(reports, (report) => report.metrics?.sceneCohesion ?? 0),
    averageStyleReadabilityByIntensity: buildIntensityMetricRecord(reports, (report) => report.metrics?.styleReadability ?? 0),
    averageLightingStabilityByIntensity: buildIntensityMetricRecord(reports, (report) => report.metrics?.lightingStability ?? 0),
    averageReflectionContinuityByIntensity: buildIntensityMetricRecord(reports, (report) => report.metrics?.reflectionContinuity ?? 0),
    rollbackPassRateByIntensity: STYLE_INTENSITY_LEVELS.reduce((record, level) => ({
      ...record,
      [level]: rollbackPassRateForIntensity(reports, level),
    }), {} as Record<StyleIntensityLevel, number>),
    strongestCellId: cellByCompatibility(reports, "strongest"),
    weakestCellId: cellByCompatibility(reports, "weakest"),
    recommendedNextAction,
    recommendedRuntimeLayer,
  };
}
