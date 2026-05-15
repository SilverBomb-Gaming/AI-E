import type { CinematicFocusFlowFrameDiagnostics } from "./cinematicFocusFlowState";

function averagePreviewScore(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export type CinematicFocusFlowSummary = {
  activeFocusSubject: CinematicFocusFlowFrameDiagnostics["activeFocusSubject"];
  previousFocusSubject: CinematicFocusFlowFrameDiagnostics["previousFocusSubject"];
  focusTransitionPhase: number;
  focusPriorityScore: number;
  focusContinuityScore: number;
  subjectReadabilityScore: number;
  revealFocusPreservationScore: number;
  droneResponseFocusScore: number;
  aftermathFocusBalanceScore: number;
  focusCameraCompatibilityScore: number;
  rollbackRestoredFocus: boolean;
  rejectedFocusTransitionCount: number;
  rollbackIntegrityStatus: "PASS" | "WATCH";
  cinematicFocusFlowSummary: string;
};

export function summarizeCinematicFocusFlowDiagnostics(input: CinematicFocusFlowFrameDiagnostics[]): CinematicFocusFlowSummary {
  const latest = input[input.length - 1] ?? null;
  if (!latest) {
    return {
      activeFocusSubject: "FULL_SCENE",
      previousFocusSubject: "FULL_SCENE",
      focusTransitionPhase: 0,
      focusPriorityScore: 0,
      focusContinuityScore: 0,
      subjectReadabilityScore: 0,
      revealFocusPreservationScore: 0,
      droneResponseFocusScore: 0,
      aftermathFocusBalanceScore: 0,
      focusCameraCompatibilityScore: 0,
      rollbackRestoredFocus: false,
      rejectedFocusTransitionCount: 0,
      rollbackIntegrityStatus: "WATCH",
      cinematicFocusFlowSummary: "Focus flow diagnostics unavailable.",
    };
  }

  const focusContinuityScore = averagePreviewScore(input.map((entry) => entry.focusContinuityScore));
  const subjectReadabilityScore = averagePreviewScore(input.map((entry) => entry.subjectReadabilityScore));
  const revealFocusPreservationScore = averagePreviewScore(input.map((entry) => entry.revealFocusPreservationScore));
  const droneResponseFocusScore = averagePreviewScore(input.map((entry) => entry.droneResponseFocusScore));
  const aftermathFocusBalanceScore = averagePreviewScore(input.map((entry) => entry.aftermathFocusBalanceScore));
  const focusCameraCompatibilityScore = averagePreviewScore(input.map((entry) => entry.focusCameraCompatibilityScore));
  const rollbackRestoredFocus = input.some((entry) => entry.rollbackRestoredFocus);
  const rejectedFocusTransitionCount = Math.max(...input.map((entry) => entry.rejectedFocusTransitionCount));
  const rollbackIntegrityStatus = focusContinuityScore >= 95
    && subjectReadabilityScore >= 94
    && revealFocusPreservationScore >= 95
    && droneResponseFocusScore >= 94
    && aftermathFocusBalanceScore >= 92
    && focusCameraCompatibilityScore >= 92
    ? "PASS"
    : "WATCH";

  return {
    activeFocusSubject: latest.activeFocusSubject,
    previousFocusSubject: latest.previousFocusSubject,
    focusTransitionPhase: latest.focusTransitionPhase,
    focusPriorityScore: latest.focusPriorityScore,
    focusContinuityScore,
    subjectReadabilityScore,
    revealFocusPreservationScore,
    droneResponseFocusScore,
    aftermathFocusBalanceScore,
    focusCameraCompatibilityScore,
    rollbackRestoredFocus,
    rejectedFocusTransitionCount,
    rollbackIntegrityStatus,
    cinematicFocusFlowSummary: `${latest.activeFocusSubject} guides attention with ${focusContinuityScore}/100 continuity, ${subjectReadabilityScore}/100 readability, and ${focusCameraCompatibilityScore}/100 camera compatibility inside the bounded preview window.`,
  };
}