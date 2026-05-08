import { clamp } from "./cameraConstraints";

export type GovernedFramingAssessmentInput = {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  objectSize: number;
  beaconX: number;
  beaconY: number;
  beaconRadius: number;
  horizonY: number;
  overlapGap: number;
};

export type GovernedFramingAssessment = {
  visibilityScore: number;
  occlusionScore: number;
  edgeClippingScore: number;
  compositionBalanceScore: number;
  framingScore: number;
};

export function validateFraming(input: GovernedFramingAssessmentInput): GovernedFramingAssessment {
  const safeLeft = input.anchorX - input.objectSize * 0.64;
  const safeRight = input.anchorX + input.objectSize * 0.64;
  const safeTop = input.anchorY - input.objectSize * 0.72;
  const safeBottom = input.anchorY + input.objectSize * 0.9;
  const horizontalPadding = Math.min(safeLeft, input.width - safeRight);
  const verticalPadding = Math.min(safeTop, input.height - safeBottom);
  const edgeClippingScore = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, 18 - horizontalPadding) * 1.9 - Math.max(0, 14 - verticalPadding) * 2.2)));
  const beaconVisible = input.beaconX - input.beaconRadius >= 0
    && input.beaconX + input.beaconRadius <= input.width
    && input.beaconY - input.beaconRadius >= 0
    && input.beaconY + input.beaconRadius <= input.height;
  const groundedPlaneReadable = input.horizonY > input.height * 0.58 && input.horizonY < input.height * 0.75;
  const visibilityScore = Math.max(0, Math.min(100, Math.round(90 + (beaconVisible ? 5 : -8) + (groundedPlaneReadable ? 4 : -6))));
  const occlusionScore = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, 6 - input.overlapGap) * 4.4)));
  const centeredDelta = Math.abs(input.anchorX - input.width * 0.5);
  const headroomDelta = Math.abs(input.anchorY - input.height * 0.56);
  const compositionBalanceScore = Math.max(0, Math.min(100, Math.round(100 - centeredDelta * 0.42 - headroomDelta * 0.46)));
  const framingScore = Math.round((visibilityScore + occlusionScore + edgeClippingScore + compositionBalanceScore) / 4);
  return {
    visibilityScore: clamp(visibilityScore, 0, 100),
    occlusionScore: clamp(occlusionScore, 0, 100),
    edgeClippingScore: clamp(edgeClippingScore, 0, 100),
    compositionBalanceScore: clamp(compositionBalanceScore, 0, 100),
    framingScore: clamp(framingScore, 0, 100),
  };
}