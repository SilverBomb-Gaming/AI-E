import { clamp } from "../camera/cameraConstraints";
import type { CinematicBeatType, CinematicStagingHint } from "../staging/cinematicStagingState";

import type {
  CinematicTensionFrameDiagnostics,
  CinematicTensionHint,
  CinematicTensionSnapshot,
  CinematicTensionState,
  TensionPhase,
} from "./cinematicTensionState";
import { resolveTensionCurveTarget } from "./tensionCurveModel";

const GOVERNED_MIN_TENSION_CONTINUITY = 95;
const GOVERNED_MIN_TENSION_READABILITY = 94;
const GOVERNED_MIN_REVEAL_PEAK_PRESERVATION = 95;
const GOVERNED_MIN_DECAY_STABILITY = 92;
const GOVERNED_MIN_TENSION_FOCUS_COMPATIBILITY = 94;
const GOVERNED_MIN_TENSION_CAMERA_COMPATIBILITY = 92;

function phaseHintValue(phase: TensionPhase, intensity: number): CinematicTensionHint {
  switch (phase) {
    case "PEAK_REVEAL":
      return {
        escalationFramingPreference: 0.96,
        revealProtectionPreference: 0.99,
        decayStabilizationPreference: 0.48,
        settleCompositionPreference: 0.42,
        pressureReadabilityPriority: 0.94,
        formationCompressionPreference: 0.32,
        reactionEnergyPreference: 0.98,
        environmentResponseIntensity: 0.34,
      };
    case "ESCALATION":
      return {
        escalationFramingPreference: 0.9,
        revealProtectionPreference: 0.78,
        decayStabilizationPreference: 0.52,
        settleCompositionPreference: 0.4,
        pressureReadabilityPriority: 0.9,
        formationCompressionPreference: 0.4,
        reactionEnergyPreference: 0.84 + intensity * 0.08,
        environmentResponseIntensity: 0.28,
      };
    case "CONTROLLED_DECAY":
      return {
        escalationFramingPreference: 0.56,
        revealProtectionPreference: 0.64,
        decayStabilizationPreference: 0.96,
        settleCompositionPreference: 0.66,
        pressureReadabilityPriority: 0.86,
        formationCompressionPreference: 0.58,
        reactionEnergyPreference: 0.54,
        environmentResponseIntensity: 0.24,
      };
    case "RESOLUTION":
      return {
        escalationFramingPreference: 0.38,
        revealProtectionPreference: 0.44,
        decayStabilizationPreference: 0.74,
        settleCompositionPreference: 0.98,
        pressureReadabilityPriority: 0.82,
        formationCompressionPreference: 0.72,
        reactionEnergyPreference: 0.34,
        environmentResponseIntensity: 0.12,
      };
    case "LOW_BUILD":
    default:
      return {
        escalationFramingPreference: 0.52,
        revealProtectionPreference: 0.72,
        decayStabilizationPreference: 0.44,
        settleCompositionPreference: 0.5,
        pressureReadabilityPriority: 0.84,
        formationCompressionPreference: 0.8,
        reactionEnergyPreference: 0.42,
        environmentResponseIntensity: 0.16,
      };
  }
}

export function computeCinematicTensionCurveFrame(input: {
  frameIndex: number;
  totalFrames: number;
  mode: "micro-sequence" | "motion-preview";
  beatType: CinematicBeatType;
  beatPhase: number;
  width: number;
  height: number;
  stagingHint: CinematicStagingHint;
  cameraContinuityScore: number;
  cameraFramingScore: number;
  reactionContinuityScore: number;
  focusContinuityScore: number;
  focusReadabilityScore: number;
  previousSnapshot?: CinematicTensionSnapshot | null;
  injectInvalidTransition?: boolean;
}): {
  state: CinematicTensionState;
  diagnostics: CinematicTensionFrameDiagnostics;
  hint: CinematicTensionHint;
  snapshot: CinematicTensionSnapshot;
} {
  const previousSnapshot = input.previousSnapshot ?? null;
  const target = resolveTensionCurveTarget(input.beatType);
  const priorTensionIntensity = previousSnapshot?.state.tensionIntensity ?? target.intensity;
  const blendedIntensity = clamp(target.intensity, 0.18, 1);
  const rawDelta = blendedIntensity - priorTensionIntensity;
  const escalationRate = rawDelta > 0 ? Number(rawDelta.toFixed(2)) : 0;
  const releaseRate = rawDelta < 0 ? Number(Math.abs(rawDelta).toFixed(2)) : 0;
  const expectedReleaseRate = rawDelta < 0 ? Number(Math.abs(target.intensity - priorTensionIntensity).toFixed(2)) : 0;
  const tensionContinuityScore = previousSnapshot
    ? Math.max(0, Math.min(100, Math.round(100 - Math.abs(target.intensity - blendedIntensity) * 18 - Math.abs(rawDelta) * 4)))
    : 100;
  const tensionReadabilityScore = Math.max(0, Math.min(100, Math.round(
    (input.cameraContinuityScore + input.cameraFramingScore + input.focusReadabilityScore + Math.round((1 - Math.abs(blendedIntensity - target.intensity)) * 100)) / 4,
  )));
  const revealPeakPreservationScore = input.beatType === "BEACON_REVEAL"
    ? Math.max(0, Math.min(100, Math.round(100 - Math.abs(blendedIntensity - 1) * 34 + input.stagingHint.revealPreference * 4)))
    : Math.max(95, Math.round((tensionReadabilityScore + input.focusContinuityScore) / 2));
  const decayStabilityScore = input.beatType === "AFTERMATH_HOLD" || input.beatType === "SETTLE"
    ? Math.max(0, Math.min(100, Math.round(100 - Math.abs(releaseRate - expectedReleaseRate) * 85 - Math.abs(blendedIntensity - target.intensity) * 22)))
    : Math.max(92, Math.round((tensionContinuityScore + tensionReadabilityScore) / 2));
  const tensionFocusCompatibilityScore = Math.max(0, Math.min(100, Math.round(
    (input.focusContinuityScore + input.focusReadabilityScore + tensionContinuityScore) / 3,
  )));
  const tensionCameraCompatibilityScore = Math.max(0, Math.min(100, Math.round(
    (input.cameraContinuityScore + input.cameraFramingScore + tensionContinuityScore) / 3,
  )));
  const candidateHint = phaseHintValue(target.phase, blendedIntensity);

  const adjustedTensionContinuityScore = input.injectInvalidTransition ? Math.max(0, tensionContinuityScore - 16) : tensionContinuityScore;
  const adjustedTensionReadabilityScore = input.injectInvalidTransition ? Math.max(0, tensionReadabilityScore - 18) : tensionReadabilityScore;
  const adjustedRevealPeakPreservationScore = input.injectInvalidTransition ? Math.max(0, revealPeakPreservationScore - 20) : revealPeakPreservationScore;
  const adjustedDecayStabilityScore = input.injectInvalidTransition ? Math.max(0, decayStabilityScore - 18) : decayStabilityScore;
  const adjustedTensionFocusCompatibilityScore = input.injectInvalidTransition ? Math.max(0, tensionFocusCompatibilityScore - 18) : tensionFocusCompatibilityScore;
  const adjustedTensionCameraCompatibilityScore = input.injectInvalidTransition ? Math.max(0, tensionCameraCompatibilityScore - 14) : tensionCameraCompatibilityScore;

  const candidateState: CinematicTensionState = {
    activeTensionPhase: target.phase,
    tensionIntensity: Number(blendedIntensity.toFixed(2)),
    priorTensionIntensity: Number(priorTensionIntensity.toFixed(2)),
    escalationRate,
    releaseRate,
    tensionContinuityScore: adjustedTensionContinuityScore,
    tensionReadabilityScore: adjustedTensionReadabilityScore,
    rollbackRestoredTension: false,
    rejectedTensionTransitionCount: previousSnapshot?.state.rejectedTensionTransitionCount ?? 0,
  };
  const candidateDiagnostics: CinematicTensionFrameDiagnostics = {
    beatType: input.beatType,
    activeTensionPhase: target.phase,
    tensionIntensity: candidateState.tensionIntensity,
    escalationRate,
    releaseRate,
    tensionContinuityScore: adjustedTensionContinuityScore,
    tensionReadabilityScore: adjustedTensionReadabilityScore,
    revealPeakPreservationScore: adjustedRevealPeakPreservationScore,
    decayStabilityScore: adjustedDecayStabilityScore,
    tensionFocusCompatibilityScore: adjustedTensionFocusCompatibilityScore,
    tensionCameraCompatibilityScore: adjustedTensionCameraCompatibilityScore,
    rollbackRestoredTension: false,
    rejectedTensionTransitionCount: candidateState.rejectedTensionTransitionCount,
    overlay: `${target.phase} • intensity ${candidateState.tensionIntensity.toFixed(2)} • continuity ${adjustedTensionContinuityScore}/100 • rollback no`,
  };

  const shouldRollback = previousSnapshot !== null && (
    adjustedTensionContinuityScore < GOVERNED_MIN_TENSION_CONTINUITY
    || adjustedTensionReadabilityScore < GOVERNED_MIN_TENSION_READABILITY
    || adjustedRevealPeakPreservationScore < GOVERNED_MIN_REVEAL_PEAK_PRESERVATION
    || adjustedDecayStabilityScore < GOVERNED_MIN_DECAY_STABILITY
    || adjustedTensionFocusCompatibilityScore < GOVERNED_MIN_TENSION_FOCUS_COMPATIBILITY
    || adjustedTensionCameraCompatibilityScore < GOVERNED_MIN_TENSION_CAMERA_COMPATIBILITY
  );

  if (shouldRollback) {
    const restoredState: CinematicTensionState = {
      ...previousSnapshot.state,
      rollbackRestoredTension: true,
      rejectedTensionTransitionCount: previousSnapshot.state.rejectedTensionTransitionCount + 1,
    };
    const restoredDiagnostics: CinematicTensionFrameDiagnostics = {
      ...previousSnapshot.diagnostics,
      rollbackRestoredTension: true,
      rejectedTensionTransitionCount: restoredState.rejectedTensionTransitionCount,
      overlay: `${previousSnapshot.state.activeTensionPhase} • intensity ${previousSnapshot.state.tensionIntensity.toFixed(2)} • continuity ${previousSnapshot.state.tensionContinuityScore}/100 • rollback yes`,
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

  const snapshot: CinematicTensionSnapshot = {
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