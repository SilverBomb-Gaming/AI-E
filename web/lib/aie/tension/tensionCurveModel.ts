import type { CinematicBeatType } from "../staging/cinematicStagingState";

import type { TensionPhase } from "./cinematicTensionState";

export type TensionCurveTarget = {
  phase: TensionPhase;
  intensity: number;
};

const TENSION_CURVE_BY_BEAT: Record<CinematicBeatType, TensionCurveTarget> = {
  BASELINE: { phase: "LOW_BUILD", intensity: 0.2 },
  ANTICIPATION: { phase: "LOW_BUILD", intensity: 0.25 },
  BEACON_REVEAL: { phase: "PEAK_REVEAL", intensity: 1 },
  DRONE_RESPONSE: { phase: "ESCALATION", intensity: 0.78 },
  AFTERMATH_HOLD: { phase: "CONTROLLED_DECAY", intensity: 0.52 },
  SETTLE: { phase: "RESOLUTION", intensity: 0.2 },
};

export function resolveTensionCurveTarget(beatType: CinematicBeatType): TensionCurveTarget {
  return TENSION_CURVE_BY_BEAT[beatType] ?? TENSION_CURVE_BY_BEAT.BASELINE;
}