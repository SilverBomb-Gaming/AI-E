import type { CinematicMomentumFrameDiagnostics, MomentumPhase } from "./cinematicMomentumState";

function averagePreviewScore(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export type CinematicMomentumSummary = {
  activeMomentumPhase: MomentumPhase;
  momentumIntensity: number;
  propagationRate: number;
  stabilizationRate: number;
  momentumContinuityScore: number;
  momentumReadabilityScore: number;
  revealPropagationScore: number;
  reactionCarryoverScore: number;
  decayInertiaScore: number;
  momentumCameraCompatibilityScore: number;
  rollbackRestoredMomentum: boolean;
  rejectedMomentumTransitionCount: number;
  rollbackIntegrityStatus: "PASS" | "WATCH";
  cinematicMomentumFlowSummary: string;
};

export function summarizeCinematicMomentumDiagnostics(input: CinematicMomentumFrameDiagnostics[]): CinematicMomentumSummary {
  const latest = input[input.length - 1] ?? null;
  if (!latest) {
    return {
      activeMomentumPhase: "MOMENTUM_BUILD",
      momentumIntensity: 0,
      propagationRate: 0,
      stabilizationRate: 0,
      momentumContinuityScore: 0,
      momentumReadabilityScore: 0,
      revealPropagationScore: 0,
      reactionCarryoverScore: 0,
      decayInertiaScore: 0,
      momentumCameraCompatibilityScore: 0,
      rollbackRestoredMomentum: false,
      rejectedMomentumTransitionCount: 0,
      rollbackIntegrityStatus: "WATCH",
      cinematicMomentumFlowSummary: "Momentum flow diagnostics unavailable.",
    };
  }

  const momentumContinuityScore = averagePreviewScore(input.map((entry) => entry.momentumContinuityScore));
  const momentumReadabilityScore = averagePreviewScore(input.map((entry) => entry.momentumReadabilityScore));
  const revealPropagationScore = averagePreviewScore(input.map((entry) => entry.revealPropagationScore));
  const reactionCarryoverScore = averagePreviewScore(input.map((entry) => entry.reactionCarryoverScore));
  const decayInertiaScore = averagePreviewScore(input.map((entry) => entry.decayInertiaScore));
  const momentumCameraCompatibilityScore = averagePreviewScore(input.map((entry) => entry.momentumCameraCompatibilityScore));
  const rollbackRestoredMomentum = input.some((entry) => entry.rollbackRestoredMomentum);
  const rejectedMomentumTransitionCount = Math.max(...input.map((entry) => entry.rejectedMomentumTransitionCount));
  const rollbackIntegrityStatus = momentumContinuityScore >= 95
    && momentumReadabilityScore >= 94
    && revealPropagationScore >= 95
    && reactionCarryoverScore >= 94
    && decayInertiaScore >= 92
    && momentumCameraCompatibilityScore >= 92
    ? "PASS"
    : "WATCH";

  return {
    activeMomentumPhase: latest.activeMomentumPhase,
    momentumIntensity: latest.momentumIntensity,
    propagationRate: latest.propagationRate,
    stabilizationRate: latest.stabilizationRate,
    momentumContinuityScore,
    momentumReadabilityScore,
    revealPropagationScore,
    reactionCarryoverScore,
    decayInertiaScore,
    momentumCameraCompatibilityScore,
    rollbackRestoredMomentum,
    rejectedMomentumTransitionCount,
    rollbackIntegrityStatus,
    cinematicMomentumFlowSummary: `${latest.activeMomentumPhase} carries ${latest.momentumIntensity.toFixed(2)} energy with ${momentumContinuityScore}/100 continuity, ${reactionCarryoverScore}/100 carryover, and ${decayInertiaScore}/100 decay inertia inside the bounded preview window.`,
  };
}