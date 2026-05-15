import type { CinematicBeatType } from "../staging/cinematicStagingState";

export type TensionPhase =
  | "LOW_BUILD"
  | "ESCALATION"
  | "PEAK_REVEAL"
  | "CONTROLLED_DECAY"
  | "RESOLUTION";

export type CinematicTensionState = {
  activeTensionPhase: TensionPhase;
  tensionIntensity: number;
  priorTensionIntensity: number;
  escalationRate: number;
  releaseRate: number;
  tensionContinuityScore: number;
  tensionReadabilityScore: number;
  rollbackRestoredTension: boolean;
  rejectedTensionTransitionCount: number;
};

export type CinematicTensionHint = {
  escalationFramingPreference: number;
  revealProtectionPreference: number;
  decayStabilizationPreference: number;
  settleCompositionPreference: number;
  pressureReadabilityPriority: number;
  formationCompressionPreference: number;
  reactionEnergyPreference: number;
  environmentResponseIntensity: number;
};

export type CinematicTensionFrameDiagnostics = {
  beatType: CinematicBeatType;
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
  overlay: string;
};

export type CinematicTensionSnapshot = {
  frameIndex: number;
  state: CinematicTensionState;
  diagnostics: CinematicTensionFrameDiagnostics;
  hint: CinematicTensionHint;
};