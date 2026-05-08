import type { Vec3 } from "../camera/cameraState";
import { clamp } from "../camera/cameraConstraints";
import { createSegmentedDroneJointState, measureJointDepth, resolveJointHierarchy } from "./jointHierarchy";
import type {
  ArticulatedEntityFrameDiagnostics,
  ArticulatedEntitySnapshot,
  ArticulatedEntityState,
  JointState,
  JointWorldTransform,
} from "./articulatedEntityState";

const GOVERNED_MAX_ANGLE_DELTA = 12;
const GOVERNED_MAX_ROOT_STEP = 5.5;
const GOVERNED_MIN_POSE_CONTINUITY = 95;
const GOVERNED_MIN_SILHOUETTE = 90;
const GOVERNED_MIN_SPATIAL_PERSISTENCE = 95;
const GOVERNED_MIN_CAMERA_COMPATIBILITY = 92;

export type GovernedArticulatedEntityInput = {
  frameIndex: number;
  totalFrames: number;
  width: number;
  height: number;
  chamberCenterX: number;
  horizonY: number;
  platformY: number;
  cubeAnchorX: number;
  cubeAnchorY: number;
  beaconX: number;
  beaconY: number;
  cameraCenterX: number;
  cameraCenterY: number;
  previousSnapshot?: ArticulatedEntitySnapshot | null;
};

export type GovernedArticulatedEntityResult = {
  state: ArticulatedEntityState;
  worldTransforms: JointWorldTransform[];
  diagnostics: ArticulatedEntityFrameDiagnostics;
  snapshot: ArticulatedEntitySnapshot;
};

function buildRootPosition(input: GovernedArticulatedEntityInput, previousState: ArticulatedEntityState | null): { position: Vec3; velocity: Vec3 } {
  const targetX = input.chamberCenterX + 54 + Math.sin(input.frameIndex * 0.24) * 6;
  const targetY = input.horizonY - 36 + Math.sin(input.frameIndex * 0.4) * 5;
  const previousPosition = previousState?.rootPosition ?? { x: targetX, y: targetY, z: 0 };
  const nextPosition = {
    x: previousPosition.x + clamp(targetX - previousPosition.x, -GOVERNED_MAX_ROOT_STEP, GOVERNED_MAX_ROOT_STEP),
    y: previousPosition.y + clamp(targetY - previousPosition.y, -GOVERNED_MAX_ROOT_STEP * 0.72, GOVERNED_MAX_ROOT_STEP * 0.72),
    z: 0,
  };
  return {
    position: nextPosition,
    velocity: {
      x: nextPosition.x - previousPosition.x,
      y: nextPosition.y - previousPosition.y,
      z: 0,
    },
  };
}

function desiredJointAngle(id: string, frameIndex: number): number {
  switch (id) {
    case "left_arm_base":
      return -38 + Math.sin(frameIndex * 0.32) * 9;
    case "left_arm_tip":
      return 20 + Math.cos(frameIndex * 0.31) * 7;
    case "right_arm_base":
      return 38 - Math.sin(frameIndex * 0.32) * 9;
    case "right_arm_tip":
      return -20 - Math.cos(frameIndex * 0.31) * 7;
    case "beacon_mount":
      return -84 + Math.sin(frameIndex * 0.28) * 6;
    default:
      return 0;
  }
}

function solveJointStates(frameIndex: number, previousJoints: JointState[] | null): JointState[] {
  const previousMap = new Map((previousJoints ?? []).map((joint) => [joint.id, joint]));
  return resolveJointHierarchy(createSegmentedDroneJointState()).map((joint) => {
    const previous = previousMap.get(joint.id);
    let desired = desiredJointAngle(joint.id, frameIndex);
    if (frameIndex === 3 && joint.id === "left_arm_tip") {
      desired = 62;
    }
    const baselineAngle = previous?.localAngle ?? desired;
    const localAngle = baselineAngle + clamp(desired - baselineAngle, -GOVERNED_MAX_ANGLE_DELTA, GOVERNED_MAX_ANGLE_DELTA);
    const previousAngle = previous?.localAngle ?? localAngle;
    const angularVelocity = previous ? localAngle - previousAngle : 0;
    const continuityScore = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, Math.abs(angularVelocity) - 4) * 1.8)));
    return {
      ...joint,
      localAngle,
      previousAngle,
      angularVelocity,
      continuityScore,
    };
  });
}

function resolveWorldTransforms(state: ArticulatedEntityState): JointWorldTransform[] {
  const jointMap = new Map(state.joints.map((joint) => [joint.id, joint]));
  const worldMap = new Map<string, JointWorldTransform>();
  for (const joint of state.joints) {
    const parentTransform = joint.parentId ? worldMap.get(joint.parentId) : null;
    const start = parentTransform ? parentTransform.end : state.rootPosition;
    const parentAngle = parentTransform?.worldAngle ?? state.orientation;
    const worldAngle = parentAngle + joint.localAngle;
    const radians = (worldAngle * Math.PI) / 180;
    const end = joint.length === 0
      ? start
      : {
        x: start.x + Math.cos(radians) * joint.length,
        y: start.y + Math.sin(radians) * joint.length,
        z: 0,
      };
    worldMap.set(joint.id, {
      id: joint.id,
      parentId: joint.parentId,
      start,
      end,
      worldAngle,
      depth: joint.parentId ? 2 : 1,
      length: joint.length,
    });
  }
  return state.joints.map((joint) => worldMap.get(joint.id)!).filter(Boolean);
}

function evaluatePose(input: GovernedArticulatedEntityInput, state: ArticulatedEntityState, worldTransforms: JointWorldTransform[], previousSnapshot: ArticulatedEntitySnapshot | null): ArticulatedEntityFrameDiagnostics {
  const maxAngleDelta = Math.max(...state.joints.map((joint) => Math.abs(joint.angularVelocity)), 0);
  const rootStep = Math.hypot(state.rootVelocity.x, state.rootVelocity.y);
  const tipPoints = worldTransforms.filter((joint) => joint.id.endsWith("tip") || joint.id === "beacon_mount").map((joint) => joint.end);
  const spanX = tipPoints.length > 1 ? Math.max(...tipPoints.map((point) => point.x)) - Math.min(...tipPoints.map((point) => point.x)) : 0;
  const spanY = tipPoints.length > 1 ? Math.max(...tipPoints.map((point) => point.y)) - Math.min(...tipPoints.map((point) => point.y)) : 0;
  const entityBoundsLeft = Math.min(state.rootPosition.x - 16, ...tipPoints.map((point) => point.x - 6));
  const entityBoundsRight = Math.max(state.rootPosition.x + 16, ...tipPoints.map((point) => point.x + 6));
  const entityBoundsTop = Math.min(state.rootPosition.y - 14, ...tipPoints.map((point) => point.y - 6));
  const entityBoundsBottom = Math.max(state.rootPosition.y + 14, ...tipPoints.map((point) => point.y + 6));
  const offFramePenalty = Math.max(0, 14 - entityBoundsLeft) + Math.max(0, entityBoundsRight - (input.width - 14)) + Math.max(0, 10 - entityBoundsTop) + Math.max(0, entityBoundsBottom - (input.height - 14));
  const platformClipPenalty = Math.max(0, entityBoundsBottom - (input.platformY + 2));
  const cubeOverlapDistance = Math.hypot(state.rootPosition.x - input.cubeAnchorX, state.rootPosition.y - input.cubeAnchorY);
  const cubeOverlapPenalty = Math.max(0, 62 - cubeOverlapDistance);
  const centerDelta = Math.hypot(state.rootPosition.x - input.cameraCenterX, state.rootPosition.y - input.cameraCenterY);
  const jointContinuityScore = Math.max(0, Math.min(100, Math.round(100 - maxAngleDelta * 3.4)));
  const poseStabilityScore = Math.max(0, Math.min(100, Math.round(100 - rootStep * 2.8 - maxAngleDelta * 1.2)));
  const silhouetteReadabilityScore = Math.max(0, Math.min(100, Math.round(84 + Math.min(12, spanX * 0.18) + Math.min(8, spanY * 0.12) - offFramePenalty * 0.8 - cubeOverlapPenalty * 0.4)));
  const entitySpatialPersistenceScore = Math.max(0, Math.min(100, Math.round(100 - rootStep * 2.4 - platformClipPenalty * 2.4)));
  const entityCameraFramingCompatibilityScore = Math.max(0, Math.min(100, Math.round(100 - centerDelta * 0.08 - offFramePenalty * 0.9 - cubeOverlapPenalty * 0.3)));
  const overlay = `SEGMENTED_DRONE • joints ${state.joints.length} • continuity ${jointContinuityScore}/100 • silhouette ${silhouetteReadabilityScore}/100 • rollback ${state.rollbackRestoredPose ? "yes" : "no"}`;

  return {
    activeEntityType: "SEGMENTED_DRONE",
    jointCount: state.joints.length,
    maxChainDepth: measureJointDepth(state.joints),
    jointContinuityScore,
    poseStabilityScore,
    silhouetteReadabilityScore,
    entitySpatialPersistenceScore,
    entityCameraFramingCompatibilityScore,
    rollbackRestoredPose: state.rollbackRestoredPose,
    rejectedPoseTransitionCount: state.rejectedPoseTransitionCount,
    overlay,
  };
}

export function computeGovernedArticulatedEntityFrame(input: GovernedArticulatedEntityInput): GovernedArticulatedEntityResult {
  const previousSnapshot = input.previousSnapshot ?? null;
  const previousState = previousSnapshot?.state ?? null;
  const { position, velocity } = buildRootPosition(input, previousState);
  const joints = solveJointStates(input.frameIndex, previousState?.joints ?? null);
  const candidateState: ArticulatedEntityState = {
    id: "governed-segmented-drone-001",
    entityType: "SEGMENTED_DRONE",
    rootPosition: position,
    rootVelocity: velocity,
    orientation: -2 + Math.sin(input.frameIndex * 0.18) * 2,
    joints,
    poseContinuityScore: 100,
    silhouetteReadabilityScore: 100,
    rollbackRestoredPose: false,
    rejectedPoseTransitionCount: previousState?.rejectedPoseTransitionCount ?? 0,
  };
  const candidateWorldTransforms = resolveWorldTransforms(candidateState);
  const candidateDiagnostics = evaluatePose(input, candidateState, candidateWorldTransforms, previousSnapshot);
  candidateState.poseContinuityScore = candidateDiagnostics.jointContinuityScore;
  candidateState.silhouetteReadabilityScore = candidateDiagnostics.silhouetteReadabilityScore;

  const rejectPose = previousSnapshot !== null && (
    candidateDiagnostics.jointContinuityScore < GOVERNED_MIN_POSE_CONTINUITY
    || candidateDiagnostics.poseStabilityScore < GOVERNED_MIN_POSE_CONTINUITY
    || candidateDiagnostics.silhouetteReadabilityScore < GOVERNED_MIN_SILHOUETTE
    || candidateDiagnostics.entitySpatialPersistenceScore < GOVERNED_MIN_SPATIAL_PERSISTENCE
    || candidateDiagnostics.entityCameraFramingCompatibilityScore < GOVERNED_MIN_CAMERA_COMPATIBILITY
  );

  if (rejectPose) {
    const restoredState: ArticulatedEntityState = {
      ...previousSnapshot.state,
      rollbackRestoredPose: true,
      rejectedPoseTransitionCount: previousSnapshot.state.rejectedPoseTransitionCount + 1,
    };
    const restoredDiagnostics = {
      ...previousSnapshot.diagnostics,
      rollbackRestoredPose: true,
      rejectedPoseTransitionCount: restoredState.rejectedPoseTransitionCount,
      overlay: `SEGMENTED_DRONE • joints ${restoredState.joints.length} • continuity ${previousSnapshot.diagnostics.jointContinuityScore}/100 • silhouette ${previousSnapshot.diagnostics.silhouetteReadabilityScore}/100 • rollback yes`,
    };
    const restoredSnapshot: ArticulatedEntitySnapshot = {
      frameIndex: input.frameIndex,
      state: restoredState,
      worldTransforms: previousSnapshot.worldTransforms,
      diagnostics: restoredDiagnostics,
    };
    return {
      state: restoredState,
      worldTransforms: previousSnapshot.worldTransforms,
      diagnostics: restoredDiagnostics,
      snapshot: restoredSnapshot,
    };
  }

  const snapshot: ArticulatedEntitySnapshot = {
    frameIndex: input.frameIndex,
    state: candidateState,
    worldTransforms: candidateWorldTransforms,
    diagnostics: candidateDiagnostics,
  };

  return {
    state: candidateState,
    worldTransforms: candidateWorldTransforms,
    diagnostics: candidateDiagnostics,
    snapshot,
  };
}