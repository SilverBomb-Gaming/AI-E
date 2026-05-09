import type { CinematicBeatType } from "../staging/cinematicStagingState";

import type { BlendPhase } from "./cinematicTransitionBlendState";

export type BeatTransitionBlendTarget = {
  phase: BlendPhase;
  fromBeat: CinematicBeatType;
  toBeat: CinematicBeatType;
  blendWeight: number;
  blendProgress: number;
};

const BLEND_TARGET_BY_BEAT: Record<CinematicBeatType, BeatTransitionBlendTarget> = {
  BASELINE: {
    phase: "SETTLED",
    fromBeat: "BASELINE",
    toBeat: "BASELINE",
    blendWeight: 0.2,
    blendProgress: 1,
  },
  ANTICIPATION: {
    phase: "BUILD_TO_REVEAL",
    fromBeat: "ANTICIPATION",
    toBeat: "BEACON_REVEAL",
    blendWeight: 0.35,
    blendProgress: 0.35,
  },
  BEACON_REVEAL: {
    phase: "BUILD_TO_REVEAL",
    fromBeat: "ANTICIPATION",
    toBeat: "BEACON_REVEAL",
    blendWeight: 1,
    blendProgress: 1,
  },
  DRONE_RESPONSE: {
    phase: "REVEAL_TO_RESPONSE",
    fromBeat: "BEACON_REVEAL",
    toBeat: "DRONE_RESPONSE",
    blendWeight: 0.82,
    blendProgress: 0.82,
  },
  AFTERMATH_HOLD: {
    phase: "RESPONSE_TO_AFTERMATH",
    fromBeat: "DRONE_RESPONSE",
    toBeat: "AFTERMATH_HOLD",
    blendWeight: 0.56,
    blendProgress: 0.56,
  },
  SETTLE: {
    phase: "AFTERMATH_TO_SETTLE",
    fromBeat: "AFTERMATH_HOLD",
    toBeat: "SETTLE",
    blendWeight: 0.24,
    blendProgress: 0.24,
  },
};

export function resolveBeatTransitionBlendTarget(beatType: CinematicBeatType): BeatTransitionBlendTarget {
  return BLEND_TARGET_BY_BEAT[beatType] ?? BLEND_TARGET_BY_BEAT.BASELINE;
}