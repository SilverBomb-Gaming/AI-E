import type { CinematicBeatType } from "../staging/cinematicStagingState";

import type { MomentumPhase } from "./cinematicMomentumState";

export type MomentumPropagationTarget = {
  phase: MomentumPhase;
  intensity: number;
};

const MOMENTUM_PROPAGATION_BY_BEAT: Record<CinematicBeatType, MomentumPropagationTarget> = {
  BASELINE: { phase: "MOMENTUM_BUILD", intensity: 0.3 },
  ANTICIPATION: { phase: "MOMENTUM_BUILD", intensity: 0.3 },
  BEACON_REVEAL: { phase: "REVEAL_PROPAGATION", intensity: 1 },
  DRONE_RESPONSE: { phase: "REACTION_CARRYOVER", intensity: 0.82 },
  AFTERMATH_HOLD: { phase: "DECAY_INERTIA", intensity: 0.56 },
  SETTLE: { phase: "STABILIZATION", intensity: 0.24 },
};

export function resolveMomentumPropagationTarget(beatType: CinematicBeatType): MomentumPropagationTarget {
  return MOMENTUM_PROPAGATION_BY_BEAT[beatType] ?? MOMENTUM_PROPAGATION_BY_BEAT.BASELINE;
}