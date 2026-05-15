import type { CinematicTensionFrameDiagnostics, TensionPhase } from "./cinematicTensionState";

function averagePreviewScore(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export type CinematicTensionSummary = {
  activeTensionPhase: TensionPhase;
  tensionIntensity: number;
  escalationRate: number;
  releaseRate: number;
  tensionContinuityScore: number;
  tensionReadabilityScore: number;
  revealPeakPreservationScore: number;
  decayStabilityScore: number;
  tensionFocusCompatibilityScore: number;
  tensionCameraCompatibilityScore: number;
  rollbackRestoredTension: boolean;
  rejectedTensionTransitionCount: number;
  rollbackIntegrityStatus: "PASS" | "WATCH";
  cinematicTensionCurveSummary: string;
};

export function summarizeCinematicTensionDiagnostics(input: CinematicTensionFrameDiagnostics[]): CinematicTensionSummary {
  const latest = input[input.length - 1] ?? null;
  if (!latest) {
    return {
      activeTensionPhase: "LOW_BUILD",
      tensionIntensity: 0,
      escalationRate: 0,
      releaseRate: 0,
      tensionContinuityScore: 0,
      tensionReadabilityScore: 0,
      revealPeakPreservationScore: 0,
      decayStabilityScore: 0,
      tensionFocusCompatibilityScore: 0,
      tensionCameraCompatibilityScore: 0,
      rollbackRestoredTension: false,
      rejectedTensionTransitionCount: 0,
      rollbackIntegrityStatus: "WATCH",
      cinematicTensionCurveSummary: "Tension curve diagnostics unavailable.",
    };
  }

  const tensionContinuityScore = averagePreviewScore(input.map((entry) => entry.tensionContinuityScore));
  const tensionReadabilityScore = averagePreviewScore(input.map((entry) => entry.tensionReadabilityScore));
  const revealPeakPreservationScore = averagePreviewScore(input.map((entry) => entry.revealPeakPreservationScore));
  const decayStabilityScore = averagePreviewScore(input.map((entry) => entry.decayStabilityScore));
  const tensionFocusCompatibilityScore = averagePreviewScore(input.map((entry) => entry.tensionFocusCompatibilityScore));
  const tensionCameraCompatibilityScore = averagePreviewScore(input.map((entry) => entry.tensionCameraCompatibilityScore));
  const rollbackRestoredTension = input.some((entry) => entry.rollbackRestoredTension);
  const rejectedTensionTransitionCount = Math.max(...input.map((entry) => entry.rejectedTensionTransitionCount));
  const rollbackIntegrityStatus = tensionContinuityScore >= 95
    && tensionReadabilityScore >= 94
    && revealPeakPreservationScore >= 95
    && decayStabilityScore >= 92
    && tensionFocusCompatibilityScore >= 94
    && tensionCameraCompatibilityScore >= 92
    ? "PASS"
    : "WATCH";

  return {
    activeTensionPhase: latest.activeTensionPhase,
    tensionIntensity: latest.tensionIntensity,
    escalationRate: latest.escalationRate,
    releaseRate: latest.releaseRate,
    tensionContinuityScore,
    tensionReadabilityScore,
    revealPeakPreservationScore,
    decayStabilityScore,
    tensionFocusCompatibilityScore,
    tensionCameraCompatibilityScore,
    rollbackRestoredTension,
    rejectedTensionTransitionCount,
    rollbackIntegrityStatus,
    cinematicTensionCurveSummary: `${latest.activeTensionPhase} holds ${latest.tensionIntensity.toFixed(2)} intensity with ${tensionContinuityScore}/100 continuity, ${tensionReadabilityScore}/100 readability, and ${decayStabilityScore}/100 decay stability inside the bounded preview window.`,
  };
}