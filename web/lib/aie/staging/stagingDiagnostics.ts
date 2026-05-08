import type { CinematicStagingFrameDiagnostics } from "./cinematicStagingState";

function average(values: number[]): number {
  return values.length > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

export function summarizeCinematicStagingDiagnostics(diagnostics: CinematicStagingFrameDiagnostics[]): {
  activeBeatType?: CinematicStagingFrameDiagnostics["activeBeatType"];
  beatPhase?: number;
  focusSubject?: CinematicStagingFrameDiagnostics["focusSubject"];
  stagingIntensity?: number;
  emphasisScore: number;
  beatReadabilityScore: number;
  focusPersistenceScore: number;
  eventFocusAlignmentScore: number;
  stagingCameraCompatibilityScore: number;
  rollbackRestoredStaging: boolean;
  rejectedStagingTransitionCount: number;
  rollbackIntegrityStatus: "PASS" | "WATCH";
  cinematicStagingSummary: string;
} {
  const last = diagnostics[diagnostics.length - 1];
  const emphasisScore = average(diagnostics.map((entry) => entry.emphasisScore));
  const beatReadabilityScore = average(diagnostics.map((entry) => entry.beatReadabilityScore));
  const focusPersistenceScore = average(diagnostics.map((entry) => entry.focusPersistenceScore));
  const eventFocusAlignmentScore = average(diagnostics.map((entry) => entry.eventFocusAlignmentScore));
  const stagingCameraCompatibilityScore = average(diagnostics.map((entry) => entry.stagingCameraCompatibilityScore));
  const rollbackRestoredStaging = diagnostics.some((entry) => entry.rollbackRestoredStaging);
  const rejectedStagingTransitionCount = Math.max(...diagnostics.map((entry) => entry.rejectedStagingTransitionCount), 0);
  const rollbackIntegrityStatus = emphasisScore >= 92
    && beatReadabilityScore >= 94
    && focusPersistenceScore >= 95
    && eventFocusAlignmentScore >= 94
    && stagingCameraCompatibilityScore >= 92
    ? "PASS"
    : "WATCH";

  return {
    activeBeatType: last?.activeBeatType,
    beatPhase: last?.beatPhase,
    focusSubject: last?.focusSubject,
    stagingIntensity: last?.stagingIntensity,
    emphasisScore,
    beatReadabilityScore,
    focusPersistenceScore,
    eventFocusAlignmentScore,
    stagingCameraCompatibilityScore,
    rollbackRestoredStaging,
    rejectedStagingTransitionCount,
    rollbackIntegrityStatus,
    cinematicStagingSummary: `${last?.activeBeatType ?? "BASELINE"} keeps focus on ${last?.focusSubject ?? "CUBE"} with ${emphasisScore}/100 emphasis and ${beatReadabilityScore}/100 readability inside the bounded preview window.`,
  };
}