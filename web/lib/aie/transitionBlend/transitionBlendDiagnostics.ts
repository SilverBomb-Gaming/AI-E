import type { BlendPhase, CinematicTransitionBlendFrameDiagnostics } from "./cinematicTransitionBlendState";

function averagePreviewScore(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export type CinematicTransitionBlendSummary = {
  activeBlendPhase: BlendPhase;
  fromBeat: string;
  toBeat: string;
  blendProgress: number;
  blendWeight: number;
  transitionSmoothnessScore: number;
  visualContinuityScore: number;
  revealTransitionPreservationScore: number;
  responseToAftermathScore: number;
  settleBlendStabilityScore: number;
  blendCameraCompatibilityScore: number;
  rollbackRestoredBlend: boolean;
  rejectedBlendTransitionCount: number;
  rollbackIntegrityStatus: "PASS" | "WATCH";
  cinematicTransitionBlendSummary: string;
};

export function summarizeCinematicTransitionBlendDiagnostics(input: CinematicTransitionBlendFrameDiagnostics[]): CinematicTransitionBlendSummary {
  const latest = input[input.length - 1] ?? null;
  if (!latest) {
    return {
      activeBlendPhase: "SETTLED",
      fromBeat: "BASELINE",
      toBeat: "BASELINE",
      blendProgress: 0,
      blendWeight: 0,
      transitionSmoothnessScore: 0,
      visualContinuityScore: 0,
      revealTransitionPreservationScore: 0,
      responseToAftermathScore: 0,
      settleBlendStabilityScore: 0,
      blendCameraCompatibilityScore: 0,
      rollbackRestoredBlend: false,
      rejectedBlendTransitionCount: 0,
      rollbackIntegrityStatus: "WATCH",
      cinematicTransitionBlendSummary: "Transition blend diagnostics unavailable.",
    };
  }

  const transitionSmoothnessScore = averagePreviewScore(input.map((entry) => entry.transitionSmoothnessScore));
  const visualContinuityScore = averagePreviewScore(input.map((entry) => entry.visualContinuityScore));
  const revealTransitionPreservationScore = averagePreviewScore(input.map((entry) => entry.revealTransitionPreservationScore));
  const responseToAftermathScore = averagePreviewScore(input.map((entry) => entry.responseToAftermathScore));
  const settleBlendStabilityScore = averagePreviewScore(input.map((entry) => entry.settleBlendStabilityScore));
  const blendCameraCompatibilityScore = averagePreviewScore(input.map((entry) => entry.blendCameraCompatibilityScore));
  const rollbackRestoredBlend = input.some((entry) => entry.rollbackRestoredBlend);
  const rejectedBlendTransitionCount = Math.max(...input.map((entry) => entry.rejectedBlendTransitionCount));
  const rollbackIntegrityStatus = transitionSmoothnessScore >= 95
    && visualContinuityScore >= 94
    && revealTransitionPreservationScore >= 95
    && responseToAftermathScore >= 94
    && settleBlendStabilityScore >= 92
    && blendCameraCompatibilityScore >= 92
      ? "PASS"
      : "WATCH";

  return {
    activeBlendPhase: latest.activeBlendPhase,
    fromBeat: latest.fromBeat,
    toBeat: latest.toBeat,
    blendProgress: latest.blendProgress,
    blendWeight: latest.blendWeight,
    transitionSmoothnessScore,
    visualContinuityScore,
    revealTransitionPreservationScore,
    responseToAftermathScore,
    settleBlendStabilityScore,
    blendCameraCompatibilityScore,
    rollbackRestoredBlend,
    rejectedBlendTransitionCount,
    rollbackIntegrityStatus,
    cinematicTransitionBlendSummary: `${latest.activeBlendPhase} smooths ${latest.fromBeat} -> ${latest.toBeat} at blend ${latest.blendWeight.toFixed(2)} with ${transitionSmoothnessScore}/100 transition smoothness and ${visualContinuityScore}/100 visual continuity inside the bounded preview window.`,
  };
}