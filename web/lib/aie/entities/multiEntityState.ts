import type { Vec3 } from "../camera/cameraState";
import type { ArticulatedEntitySnapshot, ArticulatedEntityState } from "./articulatedEntityState";

export type FormationType =
  | "DUAL_ORBIT"
  | "MIRRORED_SENTRIES"
  | "BEACON_TRIANGULATION"
  | "STAGGERED_PASS";

export type MultiEntityCameraHint = {
  groupCenterX: number;
  groupCenterY: number;
  groupRadius: number;
};

export type MultiEntitySceneState = {
  entities: ArticulatedEntityState[];
  formationType: FormationType;
  choreographyPhase: number;
  spacingScore: number;
  interactionPersistenceScore: number;
  rollbackRestoredFormation: boolean;
  rejectedFormationTransitionCount: number;
  entityIds: string[];
  groupCenter: Vec3;
  groupRadius: number;
};

export type MultiEntitySceneFrameDiagnostics = {
  activeFormationType: FormationType;
  entityCount: number;
  entityIds: string[];
  rollbackRestoredPose: boolean;
  rejectedPoseTransitionCount: number;
  entitySeparationScore: number;
  formationStabilityScore: number;
  multiEntitySilhouetteScore: number;
  choreographyContinuityScore: number;
  groupSpatialPersistenceScore: number;
  interactionPersistenceScore: number;
  rollbackRestoredFormation: boolean;
  rejectedFormationTransitionCount: number;
  overlay: string;
};

export type MultiEntitySceneSnapshot = {
  frameIndex: number;
  state: MultiEntitySceneState;
  entitySnapshots: ArticulatedEntitySnapshot[];
  diagnostics: MultiEntitySceneFrameDiagnostics;
  cameraHint: MultiEntityCameraHint;
};
