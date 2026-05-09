import type { CinematicBeatType } from "../staging/cinematicStagingState";

export type SceneIdentityType =
  | "SCI_FI_BEACON_CHAMBER"
  | "MECHANICAL_DRONE_RITUAL"
  | "REACTIVE_ENVIRONMENT_REVEAL"
  | "ATMOSPHERIC_AFTERIMAGE"
  | "STABLE_FINAL_COMPOSITION";

export type CinematicSceneCohesionState = {
  activeSceneIdentity: SceneIdentityType;
  cohesionWeight: number;
  priorCohesionWeight: number;
  visualLanguageScore: number;
  phraseContinuityScore: number;
  sceneCohesionScore: number;
  rollbackRestoredCohesion: boolean;
  rejectedCohesionTransitionCount: number;
};

export type CinematicSceneCohesionHint = {
  sceneIdentityFramingPreference: number;
  globalCompositionConsistencyPreference: number;
  chamberReadabilityPreference: number;
  finalCompositionStabilizationPreference: number;
  phraseLevelContinuityPriority: number;
  formationIdentityPreference: number;
  environmentIdentityIntensity: number;
  residueContinuityPreference: number;
};

export type CinematicSceneCohesionFrameDiagnostics = {
  activeSceneIdentity: SceneIdentityType;
  beatType: CinematicBeatType;
  cohesionWeight: number;
  visualLanguageScore: number;
  phraseContinuityScore: number;
  sceneCohesionScore: number;
  environmentIdentityScore: number;
  formationIdentityScore: number;
  finalCompositionScore: number;
  cohesionCameraCompatibilityScore: number;
  rollbackRestoredCohesion: boolean;
  rejectedCohesionTransitionCount: number;
  overlay: string;
};

export type CinematicSceneCohesionSnapshot = {
  frameIndex: number;
  state: CinematicSceneCohesionState;
  diagnostics: CinematicSceneCohesionFrameDiagnostics;
  hint: CinematicSceneCohesionHint;
};