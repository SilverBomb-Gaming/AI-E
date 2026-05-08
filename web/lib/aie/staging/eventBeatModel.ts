import { clamp } from "../camera/cameraConstraints";

import type { CinematicBeatType } from "./cinematicStagingState";

export type CinematicEventBeat = {
  beatType: CinematicBeatType;
  beatPhase: number;
  pulseIntensity: number;
  environmentResponse: number;
  formationEmphasis: number;
};

const MICRO_SEQUENCE_BEATS: CinematicBeatType[] = ["BASELINE", "ANTICIPATION", "BEACON_REVEAL"];
const MOTION_PREVIEW_BEATS: CinematicBeatType[] = ["BASELINE", "ANTICIPATION", "BEACON_REVEAL", "SETTLE"];

export function buildDeterministicEventBeat(input: {
  frameIndex: number;
  totalFrames: number;
  mode: "micro-sequence" | "motion-preview";
}): CinematicEventBeat {
  const plan = input.mode === "motion-preview" ? MOTION_PREVIEW_BEATS : MICRO_SEQUENCE_BEATS;
  const beatType = plan[Math.min(plan.length - 1, input.frameIndex)] ?? "BASELINE";
  const beatPhase = input.totalFrames > 1 ? clamp(input.frameIndex / (input.totalFrames - 1), 0, 1) : 0;

  switch (beatType) {
    case "ANTICIPATION":
      return { beatType, beatPhase, pulseIntensity: 0.72, environmentResponse: 0.68, formationEmphasis: 0.18 };
    case "BEACON_REVEAL":
      return { beatType, beatPhase, pulseIntensity: 1, environmentResponse: 1, formationEmphasis: 0.36 };
    case "DRONE_RESPONSE":
      return { beatType, beatPhase, pulseIntensity: 0.84, environmentResponse: 0.8, formationEmphasis: 0.3 };
    case "SETTLE":
      return { beatType, beatPhase, pulseIntensity: 0.62, environmentResponse: 0.58, formationEmphasis: 0.14 };
    case "BASELINE":
    default:
      return { beatType: "BASELINE", beatPhase, pulseIntensity: 0.52, environmentResponse: 0.44, formationEmphasis: 0 };
  }
}