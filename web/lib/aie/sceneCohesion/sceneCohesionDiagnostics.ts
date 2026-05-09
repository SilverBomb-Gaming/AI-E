import type { CinematicSceneCohesionFrameDiagnostics, SceneIdentityType } from "./cinematicSceneCohesionState";

function averagePreviewScore(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export type CinematicSceneCohesionSummary = {
  activeSceneIdentity: SceneIdentityType;
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
  rollbackIntegrityStatus: "PASS" | "WATCH";
  cinematicSceneCohesionSummary: string;
};

export function summarizeCinematicSceneCohesionDiagnostics(input: CinematicSceneCohesionFrameDiagnostics[]): CinematicSceneCohesionSummary {
  const latest = input[input.length - 1] ?? null;
  if (!latest) {
    return {
      activeSceneIdentity: "SCI_FI_BEACON_CHAMBER",
      cohesionWeight: 0,
      visualLanguageScore: 0,
      phraseContinuityScore: 0,
      sceneCohesionScore: 0,
      environmentIdentityScore: 0,
      formationIdentityScore: 0,
      finalCompositionScore: 0,
      cohesionCameraCompatibilityScore: 0,
      rollbackRestoredCohesion: false,
      rejectedCohesionTransitionCount: 0,
      rollbackIntegrityStatus: "WATCH",
      cinematicSceneCohesionSummary: "Scene cohesion diagnostics unavailable.",
    };
  }

  const visualLanguageScore = averagePreviewScore(input.map((entry) => entry.visualLanguageScore));
  const phraseContinuityScore = averagePreviewScore(input.map((entry) => entry.phraseContinuityScore));
  const sceneCohesionScore = averagePreviewScore(input.map((entry) => entry.sceneCohesionScore));
  const environmentIdentityScore = averagePreviewScore(input.map((entry) => entry.environmentIdentityScore));
  const formationIdentityScore = averagePreviewScore(input.map((entry) => entry.formationIdentityScore));
  const finalCompositionScore = averagePreviewScore(input.map((entry) => entry.finalCompositionScore));
  const cohesionCameraCompatibilityScore = averagePreviewScore(input.map((entry) => entry.cohesionCameraCompatibilityScore));
  const rollbackRestoredCohesion = input.some((entry) => entry.rollbackRestoredCohesion);
  const rejectedCohesionTransitionCount = Math.max(...input.map((entry) => entry.rejectedCohesionTransitionCount));
  const rollbackIntegrityStatus = visualLanguageScore >= 94
    && phraseContinuityScore >= 95
    && sceneCohesionScore >= 95
    && environmentIdentityScore >= 94
    && formationIdentityScore >= 92
    && finalCompositionScore >= 92
    && cohesionCameraCompatibilityScore >= 92
      ? "PASS"
      : "WATCH";

  return {
    activeSceneIdentity: latest.activeSceneIdentity,
    cohesionWeight: latest.cohesionWeight,
    visualLanguageScore,
    phraseContinuityScore,
    sceneCohesionScore,
    environmentIdentityScore,
    formationIdentityScore,
    finalCompositionScore,
    cohesionCameraCompatibilityScore,
    rollbackRestoredCohesion,
    rejectedCohesionTransitionCount,
    rollbackIntegrityStatus,
    cinematicSceneCohesionSummary: `${latest.activeSceneIdentity} holds scene cohesion ${sceneCohesionScore}/100 with ${visualLanguageScore}/100 visual language and ${phraseContinuityScore}/100 phrase continuity inside the bounded preview window.`,
  };
}