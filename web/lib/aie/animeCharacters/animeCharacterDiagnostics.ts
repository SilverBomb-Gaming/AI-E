import type { AnimeCharacterDiagnosticSummary, AnimeCharacterReport } from "./governedAnimeCharacterState";
import { averageAnimeCharacterMetric } from "./governedAnimeCharacterState";

function characterByCompatibility(reports: AnimeCharacterReport[], direction: "strongest" | "weakest"): string | null {
  const comparable = reports.filter((entry) => entry.compatibility);
  if (comparable.length === 0) {
    return null;
  }

  const sorted = [...comparable].sort((left, right) => {
    const delta = (left.compatibility?.compatibilityScore ?? 0) - (right.compatibility?.compatibilityScore ?? 0);
    if (delta !== 0) {
      return direction === "strongest" ? -delta : delta;
    }

    return direction === "strongest"
      ? left.characterProfileId.localeCompare(right.characterProfileId)
      : right.characterProfileId.localeCompare(left.characterProfileId);
  });

  return sorted[0]?.characterProfileId ?? null;
}

export function summarizeAnimeCharacterDiagnostics(reports: AnimeCharacterReport[]): AnimeCharacterDiagnosticSummary {
  const metricReports = reports.filter((entry) => entry.metrics);
  const failedReports = reports.filter((entry) => !entry.pass);
  const rollbackPasses = metricReports.filter((entry) => entry.metrics?.rollbackIntegrityStatus === "PASS").length;
  const blockedReports = reports.filter((entry) => entry.safetyStatus === "REJECTED").length;
  const fallbackPrimitiveDominanceCount = reports.filter((entry) => entry.truthCheck.fallback_primitive_dominance).length;
  const visualReviewReadyCount = reports.filter((entry) => entry.visualReviewPackage?.reviewLabel === "USER_VISUAL_CHECK_READY").length;
  const recommendedRuntimeLayer = failedReports.find((entry) => entry.recommendedRuntimeLayer)?.recommendedRuntimeLayer ?? null;
  const scaffoldStatus = reports.some((entry) => entry.scaffoldStatus === "SCAFFOLD_ACTIVE")
    ? "SCAFFOLD_ACTIVE"
    : reports.some((entry) => entry.scaffoldStatus === "PARTIAL_REAL_OUTPUT")
      ? "PARTIAL_REAL_OUTPUT"
      : reports.length > 0
        ? "REAL_OUTPUT_ACTIVE"
        : "SCAFFOLD_ACTIVE";

  let recommendedNextAction: AnimeCharacterDiagnosticSummary["recommendedNextAction"] = "CONTINUE_CHARACTER_RENDERS";
  if (blockedReports > 0 || fallbackPrimitiveDominanceCount > 0 || metricReports.some((entry) => entry.metrics?.rollbackIntegrityStatus !== "PASS")) {
    recommendedNextAction = "BLOCK_CHARACTER_RENDERING";
  } else if (failedReports.length > 0) {
    recommendedNextAction = "TUNE_CHARACTER_FRAMING";
  }

  return {
    testedCharacterCount: reports.length,
    passedCharacterCount: reports.filter((entry) => entry.pass).length,
    failedCharacterCount: failedReports.length,
    strongestCharacterProfileId: characterByCompatibility(reports, "strongest"),
    weakestCharacterProfileId: characterByCompatibility(reports, "weakest"),
    averageFaceReadability: averageAnimeCharacterMetric(reports, (report) => report.metrics?.characterFaceReadability ?? 0),
    averageSilhouetteClarity: averageAnimeCharacterMetric(reports, (report) => report.metrics?.characterSilhouette ?? 0),
    averagePoseReadability: averageAnimeCharacterMetric(reports, (report) => report.metrics?.characterPoseReadability ?? 0),
    averageAnimeStyleIdentity: averageAnimeCharacterMetric(reports, (report) => report.metrics?.animeStyleIdentity ?? 0),
    averageCharacterSceneIntegration: averageAnimeCharacterMetric(reports, (report) => report.metrics?.characterSceneIntegration ?? 0),
    averageCharacterFocusPriority: averageAnimeCharacterMetric(reports, (report) => report.metrics?.characterFocusPriority ?? 0),
    rollbackPassRate: metricReports.length === 0 ? 0 : Number((rollbackPasses / metricReports.length).toFixed(2)),
    scaffoldStatus,
    visualReviewReadyCount,
    fallbackPrimitiveDominanceCount,
    recommendedNextAction,
    recommendedRuntimeLayer,
  };
}
