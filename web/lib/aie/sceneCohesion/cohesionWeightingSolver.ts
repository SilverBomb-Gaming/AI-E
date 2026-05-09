import { clamp } from "../camera/cameraConstraints";
import type { CinematicBeatType } from "../staging/cinematicStagingState";

import type {
  CinematicSceneCohesionFrameDiagnostics,
  CinematicSceneCohesionHint,
  CinematicSceneCohesionSnapshot,
  CinematicSceneCohesionState,
  SceneIdentityType,
} from "./cinematicSceneCohesionState";
import { resolveSceneIdentityTarget } from "./sceneIdentityModel";

const GOVERNED_MIN_VISUAL_LANGUAGE = 94;
const GOVERNED_MIN_PHRASE_CONTINUITY = 95;
const GOVERNED_MIN_SCENE_COHESION = 95;
const GOVERNED_MIN_ENVIRONMENT_IDENTITY = 94;
const GOVERNED_MIN_FORMATION_IDENTITY = 92;
const GOVERNED_MIN_FINAL_COMPOSITION = 92;
const GOVERNED_MIN_COHESION_CAMERA_COMPATIBILITY = 92;

function identityHintValue(identity: SceneIdentityType, cohesionWeight: number): CinematicSceneCohesionHint {
  switch (identity) {
    case "REACTIVE_ENVIRONMENT_REVEAL":
      return {
        sceneIdentityFramingPreference: 0.94,
        globalCompositionConsistencyPreference: 0.92,
        chamberReadabilityPreference: 0.9,
        finalCompositionStabilizationPreference: 0.5,
        phraseLevelContinuityPriority: 0.96,
        formationIdentityPreference: 0.74,
        environmentIdentityIntensity: 0.98,
        residueContinuityPreference: 0.66,
      };
    case "MECHANICAL_DRONE_RITUAL":
      return {
        sceneIdentityFramingPreference: 0.88,
        globalCompositionConsistencyPreference: 0.94,
        chamberReadabilityPreference: 0.88,
        finalCompositionStabilizationPreference: 0.54,
        phraseLevelContinuityPriority: 0.96,
        formationIdentityPreference: 0.98,
        environmentIdentityIntensity: 0.78,
        residueContinuityPreference: 0.72,
      };
    case "ATMOSPHERIC_AFTERIMAGE":
      return {
        sceneIdentityFramingPreference: 0.8,
        globalCompositionConsistencyPreference: 0.92,
        chamberReadabilityPreference: 0.92,
        finalCompositionStabilizationPreference: 0.78,
        phraseLevelContinuityPriority: 0.98,
        formationIdentityPreference: 0.78,
        environmentIdentityIntensity: 0.88,
        residueContinuityPreference: 0.98,
      };
    case "STABLE_FINAL_COMPOSITION":
      return {
        sceneIdentityFramingPreference: 0.84,
        globalCompositionConsistencyPreference: 0.98,
        chamberReadabilityPreference: 0.94,
        finalCompositionStabilizationPreference: 0.98,
        phraseLevelContinuityPriority: 0.96,
        formationIdentityPreference: 0.84,
        environmentIdentityIntensity: 0.8,
        residueContinuityPreference: 0.9,
      };
    case "SCI_FI_BEACON_CHAMBER":
    default:
      return {
        sceneIdentityFramingPreference: 0.86,
        globalCompositionConsistencyPreference: 0.88,
        chamberReadabilityPreference: 0.94,
        finalCompositionStabilizationPreference: 0.46,
        phraseLevelContinuityPriority: 0.92,
        formationIdentityPreference: 0.7,
        environmentIdentityIntensity: 0.84 + cohesionWeight * 0.08,
        residueContinuityPreference: 0.58,
      };
  }
}

export function computeCinematicSceneCohesionFrame(input: {
  frameIndex: number;
  totalFrames: number;
  mode: "micro-sequence" | "motion-preview";
  beatType: CinematicBeatType;
  beatPhase: number;
  cameraContinuityScore: number;
  cameraFramingScore: number;
  focusContinuityScore: number;
  focusReadabilityScore: number;
  tensionContinuityScore: number;
  tensionReadabilityScore: number;
  momentumContinuityScore: number;
  momentumReadabilityScore: number;
  blendTransitionSmoothnessScore: number;
  blendVisualContinuityScore: number;
  blendCameraCompatibilityScore: number;
  previousSnapshot?: CinematicSceneCohesionSnapshot | null;
  injectInvalidTransition?: boolean;
}): {
  state: CinematicSceneCohesionState;
  diagnostics: CinematicSceneCohesionFrameDiagnostics;
  hint: CinematicSceneCohesionHint;
  snapshot: CinematicSceneCohesionSnapshot;
} {
  const previousSnapshot = input.previousSnapshot ?? null;
  const target = resolveSceneIdentityTarget(input.beatType);
  const priorCohesionWeight = previousSnapshot?.state.cohesionWeight ?? target.cohesionWeight;
  const cohesionWeight = clamp(target.cohesionWeight, 0.72, 0.98);
  const weightDelta = Math.abs(cohesionWeight - priorCohesionWeight);

  const visualLanguageScore = Math.max(0, Math.min(100, Math.round(
    (
      input.cameraFramingScore
      + input.focusReadabilityScore
      + input.tensionReadabilityScore
      + input.momentumReadabilityScore
      + input.blendVisualContinuityScore
    ) / 5,
  )));
  const phraseContinuityScore = previousSnapshot
    ? Math.max(0, Math.min(100, Math.round(
      100 - weightDelta * 16 + (input.focusContinuityScore + input.tensionContinuityScore + input.momentumContinuityScore + input.blendTransitionSmoothnessScore) / 100,
    )))
    : 100;
  const environmentIdentityScore = Math.max(0, Math.min(100, Math.round(
    (visualLanguageScore + phraseContinuityScore + input.blendVisualContinuityScore + input.tensionReadabilityScore) / 4,
  )));
  const formationIdentityScore = Math.max(0, Math.min(100, Math.round(
    (phraseContinuityScore + input.momentumContinuityScore + input.focusContinuityScore + input.blendTransitionSmoothnessScore) / 4,
  )));
  const finalCompositionScore = input.beatType === "SETTLE"
    ? Math.max(0, Math.min(100, Math.round(
      (input.cameraContinuityScore + input.cameraFramingScore + phraseContinuityScore + environmentIdentityScore) / 4,
    )))
    : Math.max(92, Math.round((phraseContinuityScore + visualLanguageScore) / 2));
  const cohesionCameraCompatibilityScore = Math.max(0, Math.min(100, Math.round(
    (input.cameraContinuityScore + input.cameraFramingScore + input.blendCameraCompatibilityScore + phraseContinuityScore) / 4,
  )));
  const sceneCohesionScore = Math.max(0, Math.min(100, Math.round(
    (visualLanguageScore + phraseContinuityScore + environmentIdentityScore + formationIdentityScore + finalCompositionScore) / 5,
  )));

  const adjustedVisualLanguageScore = input.injectInvalidTransition ? Math.max(0, visualLanguageScore - 18) : visualLanguageScore;
  const adjustedPhraseContinuityScore = input.injectInvalidTransition ? Math.max(0, phraseContinuityScore - 18) : phraseContinuityScore;
  const adjustedEnvironmentIdentityScore = input.injectInvalidTransition ? Math.max(0, environmentIdentityScore - 20) : environmentIdentityScore;
  const adjustedFormationIdentityScore = input.injectInvalidTransition ? Math.max(0, formationIdentityScore - 18) : formationIdentityScore;
  const adjustedFinalCompositionScore = input.injectInvalidTransition ? Math.max(0, finalCompositionScore - 18) : finalCompositionScore;
  const adjustedCohesionCameraCompatibilityScore = input.injectInvalidTransition ? Math.max(0, cohesionCameraCompatibilityScore - 14) : cohesionCameraCompatibilityScore;
  const adjustedSceneCohesionScore = input.injectInvalidTransition ? Math.max(0, sceneCohesionScore - 18) : sceneCohesionScore;

  const candidateState: CinematicSceneCohesionState = {
    activeSceneIdentity: target.sceneIdentity,
    cohesionWeight: Number(cohesionWeight.toFixed(2)),
    priorCohesionWeight: Number(priorCohesionWeight.toFixed(2)),
    visualLanguageScore: adjustedVisualLanguageScore,
    phraseContinuityScore: adjustedPhraseContinuityScore,
    sceneCohesionScore: adjustedSceneCohesionScore,
    rollbackRestoredCohesion: false,
    rejectedCohesionTransitionCount: previousSnapshot?.state.rejectedCohesionTransitionCount ?? 0,
  };
  const candidateHint = identityHintValue(target.sceneIdentity, cohesionWeight);
  const candidateDiagnostics: CinematicSceneCohesionFrameDiagnostics = {
    activeSceneIdentity: target.sceneIdentity,
    beatType: input.beatType,
    cohesionWeight: candidateState.cohesionWeight,
    visualLanguageScore: adjustedVisualLanguageScore,
    phraseContinuityScore: adjustedPhraseContinuityScore,
    sceneCohesionScore: adjustedSceneCohesionScore,
    environmentIdentityScore: adjustedEnvironmentIdentityScore,
    formationIdentityScore: adjustedFormationIdentityScore,
    finalCompositionScore: adjustedFinalCompositionScore,
    cohesionCameraCompatibilityScore: adjustedCohesionCameraCompatibilityScore,
    rollbackRestoredCohesion: false,
    rejectedCohesionTransitionCount: candidateState.rejectedCohesionTransitionCount,
    overlay: `${target.sceneIdentity} • cohesion ${candidateState.cohesionWeight.toFixed(2)} • scene ${adjustedSceneCohesionScore}/100 • rollback no`,
  };

  const shouldRollback = previousSnapshot !== null && (
    adjustedVisualLanguageScore < GOVERNED_MIN_VISUAL_LANGUAGE
    || adjustedPhraseContinuityScore < GOVERNED_MIN_PHRASE_CONTINUITY
    || adjustedSceneCohesionScore < GOVERNED_MIN_SCENE_COHESION
    || adjustedEnvironmentIdentityScore < GOVERNED_MIN_ENVIRONMENT_IDENTITY
    || adjustedFormationIdentityScore < GOVERNED_MIN_FORMATION_IDENTITY
    || adjustedFinalCompositionScore < GOVERNED_MIN_FINAL_COMPOSITION
    || adjustedCohesionCameraCompatibilityScore < GOVERNED_MIN_COHESION_CAMERA_COMPATIBILITY
  );

  if (shouldRollback) {
    const restoredState: CinematicSceneCohesionState = {
      ...previousSnapshot.state,
      rollbackRestoredCohesion: true,
      rejectedCohesionTransitionCount: previousSnapshot.state.rejectedCohesionTransitionCount + 1,
    };
    const restoredDiagnostics: CinematicSceneCohesionFrameDiagnostics = {
      ...previousSnapshot.diagnostics,
      rollbackRestoredCohesion: true,
      rejectedCohesionTransitionCount: restoredState.rejectedCohesionTransitionCount,
      overlay: `${previousSnapshot.state.activeSceneIdentity} • cohesion ${previousSnapshot.state.cohesionWeight.toFixed(2)} • scene ${previousSnapshot.state.sceneCohesionScore}/100 • rollback yes`,
    };
    return {
      state: restoredState,
      diagnostics: restoredDiagnostics,
      hint: previousSnapshot.hint,
      snapshot: {
        frameIndex: input.frameIndex,
        state: restoredState,
        diagnostics: restoredDiagnostics,
        hint: previousSnapshot.hint,
      },
    };
  }

  const snapshot: CinematicSceneCohesionSnapshot = {
    frameIndex: input.frameIndex,
    state: candidateState,
    diagnostics: candidateDiagnostics,
    hint: candidateHint,
  };
  return {
    state: candidateState,
    diagnostics: candidateDiagnostics,
    hint: candidateHint,
    snapshot,
  };
}