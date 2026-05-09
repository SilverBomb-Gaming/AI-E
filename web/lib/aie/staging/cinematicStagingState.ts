export type CinematicBeatType =
  | "BASELINE"
  | "ANTICIPATION"
  | "BEACON_REVEAL"
  | "DRONE_RESPONSE"
  | "AFTERMATH_HOLD"
  | "SETTLE";

export type StagingFocusSubject =
  | "CUBE"
  | "BEACON"
  | "DRONE_GROUP"
  | "FORMATION_CENTER"
  | "CHAMBER"
  | "CHARACTER_FACE"
  | "CHARACTER_SILHOUETTE";

export type CinematicStagingState = {
  activeBeatType: CinematicBeatType;
  beatPhase: number;
  stagingIntensity: number;
  focusSubject: StagingFocusSubject;
  emphasisScore: number;
  readabilityScore: number;
  rollbackRestoredStaging: boolean;
  rejectedStagingTransitionCount: number;
};

export type CinematicStagingHint = {
  focusCenterX: number;
  focusCenterY: number;
  focusRadius: number;
  revealPreference: number;
  compositionPriority: number;
  environmentEmphasis: number;
  formationEmphasis: number;
};

export type CinematicStagingFrameDiagnostics = {
  activeBeatType: CinematicBeatType;
  beatPhase: number;
  focusSubject: StagingFocusSubject;
  stagingIntensity: number;
  emphasisScore: number;
  beatReadabilityScore: number;
  focusPersistenceScore: number;
  eventFocusAlignmentScore: number;
  stagingCameraCompatibilityScore: number;
  rollbackRestoredStaging: boolean;
  rejectedStagingTransitionCount: number;
  overlay: string;
};

export type CinematicStagingSnapshot = {
  frameIndex: number;
  state: CinematicStagingState;
  diagnostics: CinematicStagingFrameDiagnostics;
  hint: CinematicStagingHint;
};