import type { CinematicBeatType } from "../staging/cinematicStagingState";

import type { SceneIdentityType } from "./cinematicSceneCohesionState";

export type SceneIdentityTarget = {
  sceneIdentity: SceneIdentityType;
  cohesionWeight: number;
};

const SCENE_IDENTITY_BY_BEAT: Record<CinematicBeatType, SceneIdentityTarget> = {
  BASELINE: {
    sceneIdentity: "SCI_FI_BEACON_CHAMBER",
    cohesionWeight: 0.72,
  },
  ANTICIPATION: {
    sceneIdentity: "SCI_FI_BEACON_CHAMBER",
    cohesionWeight: 0.78,
  },
  BEACON_REVEAL: {
    sceneIdentity: "REACTIVE_ENVIRONMENT_REVEAL",
    cohesionWeight: 0.92,
  },
  DRONE_RESPONSE: {
    sceneIdentity: "MECHANICAL_DRONE_RITUAL",
    cohesionWeight: 0.86,
  },
  AFTERMATH_HOLD: {
    sceneIdentity: "ATMOSPHERIC_AFTERIMAGE",
    cohesionWeight: 0.8,
  },
  SETTLE: {
    sceneIdentity: "STABLE_FINAL_COMPOSITION",
    cohesionWeight: 0.88,
  },
};

export function resolveSceneIdentityTarget(beatType: CinematicBeatType): SceneIdentityTarget {
  return SCENE_IDENTITY_BY_BEAT[beatType] ?? SCENE_IDENTITY_BY_BEAT.BASELINE;
}