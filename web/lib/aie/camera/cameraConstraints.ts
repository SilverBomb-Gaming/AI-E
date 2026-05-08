export const GOVERNED_CAMERA_MAX_POSITION_STEP = 0.05;
export const GOVERNED_CAMERA_MAX_VELOCITY_STEP = 0.026;
export const GOVERNED_CAMERA_MIN_CONTINUITY_SCORE = 88;
export const GOVERNED_CAMERA_MIN_FRAMING_SCORE = 89;
export const GOVERNED_CAMERA_MIN_VISIBILITY_SCORE = 90;
export const GOVERNED_CAMERA_MIN_TRANSITION_SCORE = 88;
export const GOVERNED_CAMERA_MAX_ORBIT_RADIUS = 0.1;
export const GOVERNED_CAMERA_MIN_ORBIT_RADIUS = 0.02;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}