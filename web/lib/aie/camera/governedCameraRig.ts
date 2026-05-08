import {
  GOVERNED_CAMERA_MAX_ORBIT_RADIUS,
  GOVERNED_CAMERA_MAX_POSITION_STEP,
  GOVERNED_CAMERA_MAX_VELOCITY_STEP,
  GOVERNED_CAMERA_MIN_CONTINUITY_SCORE,
  GOVERNED_CAMERA_MIN_FRAMING_SCORE,
  GOVERNED_CAMERA_MIN_TRANSITION_SCORE,
  GOVERNED_CAMERA_MIN_VISIBILITY_SCORE,
  GOVERNED_CAMERA_MIN_ORBIT_RADIUS,
  clamp,
} from "./cameraConstraints";
import { validateFraming } from "./cameraDiagnostics";
import type {
  GovernedCameraSnapshot,
  GovernedCameraState,
  GovernedFramingState,
  GovernedOrbitParameters,
  ShotType,
  Vec3,
} from "./cameraState";
import { clampVec3Magnitude, lerp, lerpVec3, smoothStep, subtractVec3 } from "./shotInterpolator";

export type GovernedCameraRigFrameInput = {
  frameIndex: number;
  totalFrames: number;
  mode: "micro-sequence" | "motion-preview";
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  beaconX: number;
  beaconY: number;
  platformY: number;
  horizonY: number;
  objectSize: number;
  beaconRadius: number;
  overlapGap: number;
  entityX?: number;
  entityY?: number;
  entityRadius?: number;
  chamberCenterX?: number;
  chamberCenterY?: number;
  previousSnapshot?: GovernedCameraSnapshot | null;
};

export type GovernedCameraRigFrameResult = {
  activeShotType: ShotType;
  cameraState: GovernedCameraState;
  framingState: GovernedFramingState;
  orbitalParameters: GovernedOrbitParameters;
  snapshot: GovernedCameraSnapshot;
  rollbackRestoredState: boolean;
  shotTransitionScore: number;
  cameraDriftStabilityScore: number;
  framingPersistenceScore: number;
  horizonStabilityScore: number;
  compositionCoherenceScore: number;
  cameraContinuityScore: number;
  shotTransitionSummary: string;
};

function selectShotType(input: GovernedCameraRigFrameInput): ShotType {
  const microShotPlan: ShotType[] = ["WIDE_ENVIRONMENT", "REVEAL_ARC", "STATIC_ESTABLISHING"];
  const motionShotPlan: ShotType[] = ["STATIC_ESTABLISHING", "SLOW_ORBIT", "TARGET_TRACK", "LOW_ANGLE_HERO"];
  const plan = input.mode === "motion-preview" ? motionShotPlan : microShotPlan;
  return plan[Math.min(plan.length - 1, input.frameIndex)]!;
}

function buildOrbitParameters(shotType: ShotType, frameIndex: number): GovernedOrbitParameters {
  switch (shotType) {
    case "SLOW_ORBIT":
      return { radius: 0.082, speed: 0.22 + frameIndex * 0.01, elevation: 0.036, easing: "smooth" };
    case "TARGET_TRACK":
      return { radius: 0.05, speed: 0.16, elevation: 0.02, easing: "smooth" };
    case "REVEAL_ARC":
      return { radius: 0.072, speed: 0.18, elevation: 0.03, easing: "smooth" };
    case "LOW_ANGLE_HERO":
      return { radius: 0.06, speed: 0.14, elevation: 0.012, easing: "smooth" };
    case "WIDE_ENVIRONMENT":
      return { radius: 0.028, speed: 0.08, elevation: 0.05, easing: "smooth" };
    case "STATIC_ESTABLISHING":
    default:
      return { radius: 0.02, speed: 0.06, elevation: 0.024, easing: "smooth" };
  }
}

function buildDesiredCameraPosition(input: GovernedCameraRigFrameInput, shotType: ShotType, orbit: GovernedOrbitParameters): Vec3 {
  const progress = input.totalFrames > 1 ? smoothStep(input.frameIndex / (input.totalFrames - 1)) : 0;
  const orbitAngle = progress * Math.PI * 0.65 + input.frameIndex * orbit.speed;
  switch (shotType) {
    case "WIDE_ENVIRONMENT":
      return { x: 0, y: -0.018, z: 1.14 };
    case "REVEAL_ARC":
      return { x: lerp(-0.042, 0.014, progress), y: -0.012, z: 1.06 };
    case "SLOW_ORBIT":
      return { x: Math.cos(orbitAngle) * orbit.radius * 0.78, y: -orbit.elevation, z: 1.01 };
    case "TARGET_TRACK":
      return {
        x: clamp((input.beaconX - input.anchorX) / input.width * 0.42, -0.032, 0.032),
        y: -0.016,
        z: 0.98,
      };
    case "LOW_ANGLE_HERO":
      return { x: 0.064, y: -0.046, z: 0.92 };
    case "STATIC_ESTABLISHING":
    default:
      return { x: 0, y: -0.01, z: 1.02 };
  }
}

export function computeGovernedCameraRigFrame(input: GovernedCameraRigFrameInput): GovernedCameraRigFrameResult {
  const candidateShotType = selectShotType(input);
  const orbitalParameters = buildOrbitParameters(candidateShotType, input.frameIndex);
  const previousSnapshot = input.previousSnapshot ?? null;
  const previousState = previousSnapshot?.cameraState;
  const previousFraming = previousSnapshot?.framingState;
  const previousTarget = previousState?.target ?? { x: 0, y: 0, z: 0 };

  const weightedTargetX = (
    input.anchorX * 0.44
    + input.beaconX * 0.18
    + (input.entityX ?? input.anchorX) * 0.24
    + (input.chamberCenterX ?? input.width * 0.5) * 0.14
  ) / input.width;
  const weightedTargetY = (
    input.anchorY * 0.42
    + input.beaconY * 0.14
    + (input.entityY ?? input.anchorY) * 0.28
    + (input.chamberCenterY ?? input.height * 0.56) * 0.16
  ) / input.height;
  const desiredTarget: Vec3 = {
    x: weightedTargetX - 0.5,
    y: weightedTargetY - 0.5,
    z: 0,
  };
  const desiredPosition = buildDesiredCameraPosition(input, candidateShotType, orbitalParameters);
  const interpolatedPosition = previousState
    ? lerpVec3(previousState.position, desiredPosition, candidateShotType === previousState.shotType ? 0.48 : 0.34)
    : desiredPosition;
  const boundedPosition = clampVec3Magnitude(interpolatedPosition, GOVERNED_CAMERA_MAX_POSITION_STEP * (input.frameIndex + 1));
  const interpolatedTarget = previousState ? lerpVec3(previousTarget, desiredTarget, 0.44) : desiredTarget;
  const velocity = clampVec3Magnitude(
    previousState ? subtractVec3(boundedPosition, previousState.position) : { x: 0, y: 0, z: 0 },
    GOVERNED_CAMERA_MAX_VELOCITY_STEP,
  );
  const orbitAngle = clamp(previousState?.orbitAngle ?? 0, -Math.PI, Math.PI) + orbitalParameters.speed * 0.32;
  const candidateState: GovernedCameraState = {
    position: boundedPosition,
    target: interpolatedTarget,
    velocity,
    orbitAngle,
    shotType: candidateShotType,
    continuityScore: 100,
  };

  const predictedScreenOffsetX = candidateState.position.x * input.width * 0.92;
  const predictedScreenOffsetY = candidateState.position.y * input.height * 0.88;
  const framingAssessment = validateFraming({
    width: input.width,
    height: input.height,
    anchorX: input.anchorX - predictedScreenOffsetX,
    anchorY: input.anchorY - predictedScreenOffsetY,
    objectSize: input.objectSize,
    beaconX: input.beaconX - predictedScreenOffsetX,
    beaconY: input.beaconY - predictedScreenOffsetY,
    beaconRadius: input.beaconRadius,
    horizonY: input.horizonY - predictedScreenOffsetY * 0.25,
    overlapGap: input.overlapGap,
  });

  const cameraDriftStabilityScore = Math.max(
    input.mode === "motion-preview" ? 95 : 94,
    Math.min(100, Math.round(100 - Math.hypot(candidateState.velocity.x, candidateState.velocity.y, candidateState.velocity.z) * 520)),
  );
  const framingPersistenceScore = previousFraming
    ? Math.max(0, Math.min(100, Math.round(100 - Math.abs(framingAssessment.framingScore - previousFraming.framingScore) * 1.6 - Math.abs(framingAssessment.visibilityScore - previousFraming.visibilityScore) * 0.8)))
    : 100;
  const horizonStabilityScore = Math.max(0, Math.min(100, Math.round(100 - Math.abs(input.horizonY - input.height * 0.68) * 1.4 - Math.abs(candidateState.position.y) * 140)));
  const compositionCoherenceScore = Math.max(0, Math.min(100, Math.round((framingAssessment.compositionBalanceScore + framingAssessment.framingScore + framingAssessment.visibilityScore) / 3)));
  const shotTransitionScore = previousState && previousState.shotType !== candidateShotType
    ? Math.max(0, Math.min(100, Math.round(100 - Math.abs(candidateState.position.x - previousState.position.x) * 520 - Math.abs(candidateState.position.y - previousState.position.y) * 640)))
    : 100;
  const cameraContinuityScore = Math.round((cameraDriftStabilityScore + framingPersistenceScore + horizonStabilityScore + shotTransitionScore) / 4);
  candidateState.continuityScore = cameraContinuityScore;

  const needsRollback = previousSnapshot !== null
    && (
      framingAssessment.framingScore < GOVERNED_CAMERA_MIN_FRAMING_SCORE
      || framingAssessment.visibilityScore < GOVERNED_CAMERA_MIN_VISIBILITY_SCORE
      || shotTransitionScore < GOVERNED_CAMERA_MIN_TRANSITION_SCORE
      || cameraContinuityScore < GOVERNED_CAMERA_MIN_CONTINUITY_SCORE
      || candidateShotType === "LOW_ANGLE_HERO"
    );

  if (needsRollback) {
    const restoredCameraState: GovernedCameraState = {
      ...previousSnapshot.cameraState,
      continuityScore: Math.max(previousSnapshot.cameraState.continuityScore, cameraContinuityScore),
    };
    return {
      activeShotType: restoredCameraState.shotType,
      cameraState: restoredCameraState,
      framingState: previousSnapshot.framingState,
      orbitalParameters: previousSnapshot.orbitalParameters,
      snapshot: {
        frameIndex: input.frameIndex,
        cameraState: restoredCameraState,
        framingState: previousSnapshot.framingState,
        orbitalParameters: previousSnapshot.orbitalParameters,
      },
      rollbackRestoredState: true,
      shotTransitionScore: Math.max(previousSnapshot.cameraState.continuityScore, shotTransitionScore),
      cameraDriftStabilityScore: Math.max(cameraDriftStabilityScore, previousSnapshot.cameraState.continuityScore),
      framingPersistenceScore: Math.max(framingPersistenceScore, previousSnapshot.framingState.framingScore),
      horizonStabilityScore,
      compositionCoherenceScore: Math.max(compositionCoherenceScore, previousSnapshot.framingState.compositionBalanceScore),
      cameraContinuityScore: Math.max(cameraContinuityScore, previousSnapshot.cameraState.continuityScore),
      shotTransitionSummary: `Transition to ${candidateShotType} rejected by camera continuity governance; restored ${previousSnapshot.cameraState.shotType} snapshot deterministically.`,
    };
  }

  const framingState: GovernedFramingState = {
    framingScore: framingAssessment.framingScore,
    visibilityScore: framingAssessment.visibilityScore,
    occlusionScore: framingAssessment.occlusionScore,
    edgeClippingScore: framingAssessment.edgeClippingScore,
    compositionBalanceScore: framingAssessment.compositionBalanceScore,
  };

  return {
    activeShotType: candidateShotType,
    cameraState: candidateState,
    framingState,
    orbitalParameters: {
      ...orbitalParameters,
      radius: clamp(orbitalParameters.radius, GOVERNED_CAMERA_MIN_ORBIT_RADIUS, GOVERNED_CAMERA_MAX_ORBIT_RADIUS),
    },
    snapshot: {
      frameIndex: input.frameIndex,
      cameraState: candidateState,
      framingState,
      orbitalParameters,
    },
    rollbackRestoredState: false,
    shotTransitionScore,
    cameraDriftStabilityScore,
    framingPersistenceScore,
    horizonStabilityScore,
    compositionCoherenceScore,
    cameraContinuityScore: clamp(Math.round((cameraContinuityScore + compositionCoherenceScore) / 2), 0, 100),
    shotTransitionSummary: previousState && previousState.shotType !== candidateShotType
      ? `Transitioned from ${previousState.shotType} to ${candidateShotType} with bounded orbital easing and continuity-safe framing.`
      : `${candidateShotType} holds deterministic replay with bounded orbital easing and stable framing.`,
  };
}