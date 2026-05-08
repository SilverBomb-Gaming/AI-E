import { clamp } from "../camera/cameraConstraints";
import type { CinematicBeatType } from "../staging/cinematicStagingState";

import type {
  CinematicMomentumFrameDiagnostics,
  CinematicMomentumHint,
  CinematicMomentumSnapshot,
  CinematicMomentumState,
  MomentumPhase,
} from "./cinematicMomentumState";
import { resolveMomentumPropagationTarget } from "./momentumPropagationModel";

const GOVERNED_MIN_MOMENTUM_CONTINUITY = 95;
const GOVERNED_MIN_MOMENTUM_READABILITY = 94;
const GOVERNED_MIN_REVEAL_PROPAGATION = 95;
const GOVERNED_MIN_REACTION_CARRYOVER = 94;
const GOVERNED_MIN_DECAY_INERTIA = 92;
const GOVERNED_MIN_MOMENTUM_CAMERA_COMPATIBILITY = 92;

function phaseHintValue(phase: MomentumPhase, intensity: number): CinematicMomentumHint {
  switch (phase) {
    case "REVEAL_PROPAGATION":
      return {
        propagationFramingPreference: 0.98,
        revealCarryoverPreference: 0.98,
        inertiaStabilizationPreference: 0.46,
        settleRecoveryPreference: 0.34,
        pacingContinuityPreference: 0.96,
        formationExpansionPreference: 0.82,
        movementCarryoverPreference: 0.96,
        environmentPropagationIntensity: 0.34,
      };
    case "REACTION_CARRYOVER":
      return {
        propagationFramingPreference: 0.86,
        revealCarryoverPreference: 0.92,
        inertiaStabilizationPreference: 0.52,
        settleRecoveryPreference: 0.38,
        pacingContinuityPreference: 0.92,
        formationExpansionPreference: 0.72,
        movementCarryoverPreference: 0.86 + intensity * 0.08,
        environmentPropagationIntensity: 0.28,
      };
    case "DECAY_INERTIA":
      return {
        propagationFramingPreference: 0.58,
        revealCarryoverPreference: 0.62,
        inertiaStabilizationPreference: 0.98,
        settleRecoveryPreference: 0.56,
        pacingContinuityPreference: 0.88,
        formationExpansionPreference: 0.54,
        movementCarryoverPreference: 0.58,
        environmentPropagationIntensity: 0.24,
      };
    case "STABILIZATION":
      return {
        propagationFramingPreference: 0.4,
        revealCarryoverPreference: 0.42,
        inertiaStabilizationPreference: 0.8,
        settleRecoveryPreference: 0.98,
        pacingContinuityPreference: 0.84,
        formationExpansionPreference: 0.44,
        movementCarryoverPreference: 0.34,
        environmentPropagationIntensity: 0.12,
      };
    case "MOMENTUM_BUILD":
    default:
      return {
        propagationFramingPreference: 0.56,
        revealCarryoverPreference: 0.74,
        inertiaStabilizationPreference: 0.44,
        settleRecoveryPreference: 0.4,
        pacingContinuityPreference: 0.86,
        formationExpansionPreference: 0.62,
        movementCarryoverPreference: 0.48,
        environmentPropagationIntensity: 0.18,
      };
  }
}

export function computeCinematicMomentumFlowFrame(input: {
  frameIndex: number;
  totalFrames: number;
  mode: "micro-sequence" | "motion-preview";
  beatType: CinematicBeatType;
  beatPhase: number;
  width: number;
  height: number;
  cameraContinuityScore: number;
  cameraFramingScore: number;
  reactionContinuityScore: number;
  focusContinuityScore: number;
  focusReadabilityScore: number;
  tensionContinuityScore: number;
  tensionReadabilityScore: number;
  tensionCameraCompatibilityScore: number;
  previousSnapshot?: CinematicMomentumSnapshot | null;
  injectInvalidTransition?: boolean;
}): {
  state: CinematicMomentumState;
  diagnostics: CinematicMomentumFrameDiagnostics;
  hint: CinematicMomentumHint;
  snapshot: CinematicMomentumSnapshot;
} {
  const previousSnapshot = input.previousSnapshot ?? null;
  const target = resolveMomentumPropagationTarget(input.beatType);
  const priorMomentumIntensity = previousSnapshot?.state.momentumIntensity ?? target.intensity;
  const momentumIntensity = clamp(target.intensity, 0.22, 1);
  const rawDelta = momentumIntensity - priorMomentumIntensity;
  const propagationRate = rawDelta > 0 ? Number(rawDelta.toFixed(2)) : 0;
  const stabilizationRate = rawDelta < 0 ? Number(Math.abs(rawDelta).toFixed(2)) : 0;
  const expectedStabilizationRate = rawDelta < 0 ? Number(Math.abs(target.intensity - priorMomentumIntensity).toFixed(2)) : 0;

  const momentumContinuityScore = previousSnapshot
    ? Math.max(0, Math.min(100, Math.round(
      100 - Math.abs(target.intensity - momentumIntensity) * 16 - Math.abs(rawDelta) * 5,
    )))
    : 100;
  const momentumReadabilityScore = Math.max(0, Math.min(100, Math.round(
    (
      input.cameraContinuityScore
      + input.cameraFramingScore
      + input.focusReadabilityScore
      + input.tensionReadabilityScore
      + Math.round((1 - Math.abs(momentumIntensity - target.intensity)) * 100)
    ) / 5,
  )));
  const revealPropagationScore = input.beatType === "BEACON_REVEAL"
    ? Math.max(0, Math.min(100, Math.round(100 - Math.abs(momentumIntensity - 1) * 30 + propagationRate * 6)))
    : Math.max(95, Math.round((momentumContinuityScore + momentumReadabilityScore) / 2));
  const reactionCarryoverScore = input.beatType === "DRONE_RESPONSE"
    ? Math.max(0, Math.min(100, Math.round(
      100 - Math.abs(momentumIntensity - target.intensity) * 24 - Math.abs(priorMomentumIntensity - 1) * 8 + input.reactionContinuityScore * 0.04,
    )))
    : Math.max(94, Math.round((input.reactionContinuityScore + momentumContinuityScore) / 2));
  const decayInertiaScore = input.beatType === "AFTERMATH_HOLD" || input.beatType === "SETTLE"
    ? Math.max(0, Math.min(100, Math.round(
      100 - Math.abs(stabilizationRate - expectedStabilizationRate) * 82 - Math.abs(momentumIntensity - target.intensity) * 20,
    )))
    : Math.max(92, Math.round((momentumContinuityScore + momentumReadabilityScore) / 2));
  const momentumCameraCompatibilityScore = Math.max(0, Math.min(100, Math.round(
    (input.cameraContinuityScore + input.cameraFramingScore + input.tensionCameraCompatibilityScore + momentumContinuityScore) / 4,
  )));
  const candidateHint = phaseHintValue(target.phase, momentumIntensity);

  const adjustedMomentumContinuityScore = input.injectInvalidTransition ? Math.max(0, momentumContinuityScore - 16) : momentumContinuityScore;
  const adjustedMomentumReadabilityScore = input.injectInvalidTransition ? Math.max(0, momentumReadabilityScore - 18) : momentumReadabilityScore;
  const adjustedRevealPropagationScore = input.injectInvalidTransition ? Math.max(0, revealPropagationScore - 20) : revealPropagationScore;
  const adjustedReactionCarryoverScore = input.injectInvalidTransition ? Math.max(0, reactionCarryoverScore - 18) : reactionCarryoverScore;
  const adjustedDecayInertiaScore = input.injectInvalidTransition ? Math.max(0, decayInertiaScore - 18) : decayInertiaScore;
  const adjustedMomentumCameraCompatibilityScore = input.injectInvalidTransition ? Math.max(0, momentumCameraCompatibilityScore - 14) : momentumCameraCompatibilityScore;

  const candidateState: CinematicMomentumState = {
    activeMomentumPhase: target.phase,
    momentumIntensity: Number(momentumIntensity.toFixed(2)),
    priorMomentumIntensity: Number(priorMomentumIntensity.toFixed(2)),
    propagationRate,
    stabilizationRate,
    momentumContinuityScore: adjustedMomentumContinuityScore,
    momentumReadabilityScore: adjustedMomentumReadabilityScore,
    rollbackRestoredMomentum: false,
    rejectedMomentumTransitionCount: previousSnapshot?.state.rejectedMomentumTransitionCount ?? 0,
  };
  const candidateDiagnostics: CinematicMomentumFrameDiagnostics = {
    beatType: input.beatType,
    activeMomentumPhase: target.phase,
    momentumIntensity: candidateState.momentumIntensity,
    propagationRate,
    stabilizationRate,
    momentumContinuityScore: adjustedMomentumContinuityScore,
    momentumReadabilityScore: adjustedMomentumReadabilityScore,
    revealPropagationScore: adjustedRevealPropagationScore,
    reactionCarryoverScore: adjustedReactionCarryoverScore,
    decayInertiaScore: adjustedDecayInertiaScore,
    momentumCameraCompatibilityScore: adjustedMomentumCameraCompatibilityScore,
    rollbackRestoredMomentum: false,
    rejectedMomentumTransitionCount: candidateState.rejectedMomentumTransitionCount,
    overlay: `${target.phase} • intensity ${candidateState.momentumIntensity.toFixed(2)} • continuity ${adjustedMomentumContinuityScore}/100 • rollback no`,
  };

  const shouldRollback = previousSnapshot !== null && (
    adjustedMomentumContinuityScore < GOVERNED_MIN_MOMENTUM_CONTINUITY
    || adjustedMomentumReadabilityScore < GOVERNED_MIN_MOMENTUM_READABILITY
    || adjustedRevealPropagationScore < GOVERNED_MIN_REVEAL_PROPAGATION
    || adjustedReactionCarryoverScore < GOVERNED_MIN_REACTION_CARRYOVER
    || adjustedDecayInertiaScore < GOVERNED_MIN_DECAY_INERTIA
    || adjustedMomentumCameraCompatibilityScore < GOVERNED_MIN_MOMENTUM_CAMERA_COMPATIBILITY
  );

  if (shouldRollback) {
    const restoredState: CinematicMomentumState = {
      ...previousSnapshot.state,
      rollbackRestoredMomentum: true,
      rejectedMomentumTransitionCount: previousSnapshot.state.rejectedMomentumTransitionCount + 1,
    };
    const restoredDiagnostics: CinematicMomentumFrameDiagnostics = {
      ...previousSnapshot.diagnostics,
      rollbackRestoredMomentum: true,
      rejectedMomentumTransitionCount: restoredState.rejectedMomentumTransitionCount,
      overlay: `${previousSnapshot.state.activeMomentumPhase} • intensity ${previousSnapshot.state.momentumIntensity.toFixed(2)} • continuity ${previousSnapshot.state.momentumContinuityScore}/100 • rollback yes`,
    };
    return {
      state: restoredState,
      diagnostics: restoredDiagnostics,
      hint: previousSnapshot.hint,
      snapshot: {
        frameIndex: input.frameIndex,
        state: restoredState,
        diagnostics: restoredDiagnostics,
        hint: previousSnapshot.hint,
      },
    };
  }

  const snapshot: CinematicMomentumSnapshot = {
    frameIndex: input.frameIndex,
    state: candidateState,
    diagnostics: candidateDiagnostics,
    hint: candidateHint,
  };
  return {
    state: candidateState,
    diagnostics: candidateDiagnostics,
    hint: candidateHint,
    snapshot,
  };
}