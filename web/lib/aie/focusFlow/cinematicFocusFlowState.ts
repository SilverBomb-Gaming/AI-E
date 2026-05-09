import type { CinematicBeatType } from "../staging/cinematicStagingState";

export type FocusSubject =
  | "CUBE"
  | "BEACON"
  | "DRONE_GROUP"
  | "FORMATION_CENTER"
  | "ENVIRONMENT_RESIDUE"
  | "FULL_SCENE"
  | "CHARACTER_FACE"
  | "CHARACTER_SILHOUETTE";

export type CinematicFocusFlowState = {
  activeFocusSubject: FocusSubject;
  previousFocusSubject: FocusSubject;
  focusTransitionPhase: number;
  focusPriorityScore: number;
  focusContinuityScore: number;
  subjectReadabilityScore: number;
  rollbackRestoredFocus: boolean;
  rejectedFocusTransitionCount: number;
};

export type CinematicFocusFlowHint = {
  focusCenterX: number;
  focusCenterY: number;
  focusRadius: number;
  focusSubjectPriority: number;
  compositionPreference: number;
  revealProtectionPreference: number;
  groupReadabilityPreference: number;
  formationResponseEmphasis: number;
  environmentResponseIntensity: number;
};

export type CinematicFocusFlowFrameDiagnostics = {
  beatType: CinematicBeatType;
  activeFocusSubject: FocusSubject;
  previousFocusSubject: FocusSubject;
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
  overlay: string;
};

export type CinematicFocusFlowSnapshot = {
  frameIndex: number;
  state: CinematicFocusFlowState;
  diagnostics: CinematicFocusFlowFrameDiagnostics;
  hint: CinematicFocusFlowHint;
};