import { clamp } from "./cameraConstraints";
import type { Vec3 } from "./cameraState";

export function lerp(start: number, end: number, factor: number): number {
  return start + (end - start) * factor;
}

export function smoothStep(factor: number): number {
  const bounded = clamp(factor, 0, 1);
  return bounded * bounded * (3 - 2 * bounded);
}

export function lerpVec3(start: Vec3, end: Vec3, factor: number): Vec3 {
  return {
    x: lerp(start.x, end.x, factor),
    y: lerp(start.y, end.y, factor),
    z: lerp(start.z, end.z, factor),
  };
}

export function subtractVec3(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

export function clampVec3Magnitude(input: Vec3, maximum: number): Vec3 {
  const magnitude = Math.hypot(input.x, input.y, input.z);
  if (magnitude <= maximum || magnitude === 0) {
    return input;
  }

  const scale = maximum / magnitude;
  return {
    x: input.x * scale,
    y: input.y * scale,
    z: input.z * scale,
  };
}