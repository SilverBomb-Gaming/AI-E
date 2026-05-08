import type { Vec3 } from "../camera/cameraState";

export type ArticulatedEntityType = "SEGMENTED_DRONE";

export type JointState = {
  id: string;
  parentId: string | null;
  localAngle: number;
  previousAngle: number;
  angularVelocity: number;
  length: number;
  continuityScore: number;
};

export type JointWorldTransform = {
  id: string;
  parentId: string | null;
  start: Vec3;
  end: Vec3;
  worldAngle: number;
  depth: number;
  length: number;
};

export type ArticulatedEntityState = {
  id: string;
  entityType: ArticulatedEntityType;
  rootPosition: Vec3;
  rootVelocity: Vec3;
  orientation: number;
  joints: JointState[];
  poseContinuityScore: number;
  silhouetteReadabilityScore: number;
  rollbackRestoredPose: boolean;
  rejectedPoseTransitionCount: number;
};

export type ArticulatedEntitySnapshot = {
  frameIndex: number;
  state: ArticulatedEntityState;
  worldTransforms: JointWorldTransform[];
  diagnostics: ArticulatedEntityFrameDiagnostics;
};

export type ArticulatedEntityFrameDiagnostics = {
  activeEntityType: ArticulatedEntityType;
  jointCount: number;
  maxChainDepth: number;
  jointContinuityScore: number;
  poseStabilityScore: number;
  silhouetteReadabilityScore: number;
  entitySpatialPersistenceScore: number;
  entityCameraFramingCompatibilityScore: number;
  rollbackRestoredPose: boolean;
  rejectedPoseTransitionCount: number;
  overlay: string;
};

export type SegmentRenderLine = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  red: number;
  green: number;
  blue: number;
  alpha?: number;
};

export type SegmentRenderCircle = {
  centerX: number;
  centerY: number;
  radius: number;
  red: number;
  green: number;
  blue: number;
  alpha?: number;
};

export type SegmentRenderPolygon = {
  points: Array<{ x: number; y: number }>;
  red: number;
  green: number;
  blue: number;
  alpha?: number;
};

export type SegmentedDroneRenderModel = {
  body: SegmentRenderPolygon[];
  segments: SegmentRenderLine[];
  joints: SegmentRenderCircle[];
  beacon: SegmentRenderCircle[];
};