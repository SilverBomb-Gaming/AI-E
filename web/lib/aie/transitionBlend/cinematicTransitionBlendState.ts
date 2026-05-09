import type { CinematicBeatType } from "../staging/cinematicStagingState";

export type BlendPhase =
  | "BUILD_TO_REVEAL"
  | "REVEAL_TO_RESPONSE"
  | "RESPONSE_TO_AFTERMATH"
  | "AFTERMATH_TO_SETTLE"
  | "SETTLED";

export type CinematicTransitionBlendState = {
  activeBlendPhase: BlendPhase;
  fromBeat: CinematicBeatType;
  toBeat: CinematicBeatType;
  blendProgress: number;
  blendWeight: number;
  transitionSmoothnessScore: number;
  visualContinuityScore: number;
  rollbackRestoredBlend: boolean;
  rejectedBlendTransitionCount: number;
};

export type CinematicTransitionBlendHint = {
  transitionSoftnessPreference: number;
  revealToResponseCarryPreference: number;
  aftermathEasingPreference: number;
  settleStabilizationPreference: number;
  visualContinuityPriority: number;
  formationTransitionPreference: number;
  movementDecayPreference: number;
  environmentResiduePreference: number;
};

export type CinematicTransitionBlendFrameDiagnostics = {
  activeBlendPhase: BlendPhase;
  fromBeat: CinematicBeatType;
  toBeat: CinematicBeatType;
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
  overlay: string;
};

export type CinematicTransitionBlendSnapshot = {
  frameIndex: number;
  state: CinematicTransitionBlendState;
  diagnostics: CinematicTransitionBlendFrameDiagnostics;
  hint: CinematicTransitionBlendHint;
};