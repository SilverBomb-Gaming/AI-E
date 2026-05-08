import type { CinematicBeatType } from "../staging/cinematicStagingState";

export type MomentumPhase =
  | "MOMENTUM_BUILD"
  | "REVEAL_PROPAGATION"
  | "REACTION_CARRYOVER"
  | "DECAY_INERTIA"
  | "STABILIZATION";

export type CinematicMomentumState = {
  activeMomentumPhase: MomentumPhase;
  momentumIntensity: number;
  priorMomentumIntensity: number;
  propagationRate: number;
  stabilizationRate: number;
  momentumContinuityScore: number;
  momentumReadabilityScore: number;
  rollbackRestoredMomentum: boolean;
  rejectedMomentumTransitionCount: number;
};

export type CinematicMomentumHint = {
  propagationFramingPreference: number;
  revealCarryoverPreference: number;
  inertiaStabilizationPreference: number;
  settleRecoveryPreference: number;
  pacingContinuityPreference: number;
  formationExpansionPreference: number;
  movementCarryoverPreference: number;
  environmentPropagationIntensity: number;
};

export type CinematicMomentumFrameDiagnostics = {
  beatType: CinematicBeatType;
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
  overlay: string;
};

export type CinematicMomentumSnapshot = {
  frameIndex: number;
  state: CinematicMomentumState;
  diagnostics: CinematicMomentumFrameDiagnostics;
  hint: CinematicMomentumHint;
};