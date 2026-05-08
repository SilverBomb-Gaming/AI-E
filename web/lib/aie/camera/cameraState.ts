export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type ShotType =
  | "STATIC_ESTABLISHING"
  | "SLOW_ORBIT"
  | "TARGET_TRACK"
  | "REVEAL_ARC"
  | "LOW_ANGLE_HERO"
  | "WIDE_ENVIRONMENT";

export type GovernedCameraState = {
  position: Vec3;
  target: Vec3;
  velocity: Vec3;
  orbitAngle: number;
  shotType: ShotType;
  continuityScore: number;
};

export type GovernedOrbitParameters = {
  radius: number;
  speed: number;
  elevation: number;
  easing: "smooth";
};

export type GovernedFramingState = {
  framingScore: number;
  visibilityScore: number;
  occlusionScore: number;
  edgeClippingScore: number;
  compositionBalanceScore: number;
};

export type GovernedCameraSnapshot = {
  frameIndex: number;
  cameraState: GovernedCameraState;
  framingState: GovernedFramingState;
  orbitalParameters: GovernedOrbitParameters;
};