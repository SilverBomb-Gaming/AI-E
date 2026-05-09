import { clamp } from "../camera/cameraConstraints";
import type { CinematicBeatType } from "../staging/cinematicStagingState";

import type {
  BlendPhase,
  CinematicTransitionBlendFrameDiagnostics,
  CinematicTransitionBlendHint,
  CinematicTransitionBlendSnapshot,
  CinematicTransitionBlendState,
} from "./cinematicTransitionBlendState";
import { resolveBeatTransitionBlendTarget } from "./beatTransitionBlendModel";

const GOVERNED_MIN_TRANSITION_SMOOTHNESS = 95;
const GOVERNED_MIN_VISUAL_CONTINUITY = 94;
const GOVERNED_MIN_REVEAL_TRANSITION_PRESERVATION = 95;
const GOVERNED_MIN_RESPONSE_TO_AFTERMATH = 94;
const GOVERNED_MIN_SETTLE_BLEND_STABILITY = 92;
const GOVERNED_MIN_BLEND_CAMERA_COMPATIBILITY = 92;

function phaseHintValue(phase: BlendPhase, blendWeight: number): CinematicTransitionBlendHint {
  switch (phase) {
    case "BUILD_TO_REVEAL":
      return {
        transitionSoftnessPreference: 0.88,
        revealToResponseCarryPreference: 0.8,
        aftermathEasingPreference: 0.44,
        settleStabilizationPreference: 0.34,
        visualContinuityPriority: 0.96,
        formationTransitionPreference: 0.7,
        movementDecayPreference: 0.42,
        environmentResiduePreference: 0.22,
      };
    case "REVEAL_TO_RESPONSE":
      return {
        transitionSoftnessPreference: 0.96,
        revealToResponseCarryPreference: 0.98,
        aftermathEasingPreference: 0.48,
        settleStabilizationPreference: 0.36,
        visualContinuityPriority: 0.98,
        formationTransitionPreference: 0.84,
        movementDecayPreference: 0.48,
        environmentResiduePreference: 0.3,
      };
    case "RESPONSE_TO_AFTERMATH":
      return {
        transitionSoftnessPreference: 0.86,
        revealToResponseCarryPreference: 0.68,
        aftermathEasingPreference: 0.98,
        settleStabilizationPreference: 0.54,
        visualContinuityPriority: 0.92,
        formationTransitionPreference: 0.68,
        movementDecayPreference: 0.82,
        environmentResiduePreference: 0.34,
      };
    case "AFTERMATH_TO_SETTLE":
      return {
        transitionSoftnessPreference: 0.82,
        revealToResponseCarryPreference: 0.42,
        aftermathEasingPreference: 0.84,
        settleStabilizationPreference: 0.98,
        visualContinuityPriority: 0.9,
        formationTransitionPreference: 0.56,
        movementDecayPreference: 0.76,
        environmentResiduePreference: 0.26,
      };
    case "SETTLED":
    default:
      return {
        transitionSoftnessPreference: 0.74,
        revealToResponseCarryPreference: 0.32,
        aftermathEasingPreference: 0.72,
        settleStabilizationPreference: 0.96,
        visualContinuityPriority: 0.86,
        formationTransitionPreference: 0.48,
        movementDecayPreference: 0.62,
        environmentResiduePreference: 0.18,
      };
  }
}

export function computeCinematicTransitionBlendFrame(input: {
  frameIndex: number;
  totalFrames: number;
  mode: "micro-sequence" | "motion-preview";
  beatType: CinematicBeatType;
  beatPhase: number;
  cameraContinuityScore: number;
  cameraFramingScore: number;
  focusContinuityScore: number;
  focusReadabilityScore: number;
  tensionContinuityScore: number;
  momentumContinuityScore: number;
  momentumReadabilityScore: number;
  previousSnapshot?: CinematicTransitionBlendSnapshot | null;
  injectInvalidTransition?: boolean;
}): {
  state: CinematicTransitionBlendState;
  diagnostics: CinematicTransitionBlendFrameDiagnostics;
  hint: CinematicTransitionBlendHint;
  snapshot: CinematicTransitionBlendSnapshot;
} {
  const previousSnapshot = input.previousSnapshot ?? null;
  const target = resolveBeatTransitionBlendTarget(input.beatType);
  const previousBlendWeight = previousSnapshot?.state.blendWeight ?? target.blendWeight;
  const blendWeight = clamp(target.blendWeight, 0.2, 1);
  const blendProgress = clamp(target.blendProgress, 0, 1);
  const weightDelta = Math.abs(blendWeight - previousBlendWeight);

  const transitionSmoothnessScore = previousSnapshot
    ? Math.max(0, Math.min(100, Math.round(
      100 - weightDelta * 4 - Math.abs(blendProgress - target.blendProgress) * 3,
    )))
    : 100;
  const visualContinuityScore = Math.max(0, Math.min(100, Math.round(
    (
      input.cameraContinuityScore
      + input.cameraFramingScore
      + input.focusContinuityScore
      + input.tensionContinuityScore
      + input.momentumContinuityScore
    ) / 5,
  )));
  const revealTransitionPreservationScore = (input.beatType === "BEACON_REVEAL" || input.beatType === "DRONE_RESPONSE")
    ? Math.max(0, Math.min(100, Math.round(
      100 - Math.abs(blendWeight - target.blendWeight) * 28 + input.focusReadabilityScore * 0.04,
    )))
    : Math.max(95, Math.round((transitionSmoothnessScore + visualContinuityScore) / 2));
  const responseToAftermathScore = (input.beatType === "AFTERMATH_HOLD" || input.beatType === "SETTLE")
    ? Math.max(0, Math.min(100, Math.round(
      100 - weightDelta * 18 + input.momentumReadabilityScore * 0.04,
    )))
    : Math.max(94, Math.round((input.momentumContinuityScore + visualContinuityScore) / 2));
  const settleBlendStabilityScore = input.beatType === "SETTLE"
    ? Math.max(0, Math.min(100, Math.round(
      100 - Math.abs(blendWeight - 0.24) * 32 + input.cameraContinuityScore * 0.04,
    )))
    : Math.max(92, Math.round((transitionSmoothnessScore + visualContinuityScore) / 2));
  const blendCameraCompatibilityScore = Math.max(0, Math.min(100, Math.round(
    (input.cameraContinuityScore + input.cameraFramingScore + visualContinuityScore) / 3,
  )));

  const adjustedTransitionSmoothnessScore = input.injectInvalidTransition ? Math.max(0, transitionSmoothnessScore - 18) : transitionSmoothnessScore;
  const adjustedVisualContinuityScore = input.injectInvalidTransition ? Math.max(0, visualContinuityScore - 18) : visualContinuityScore;
  const adjustedRevealTransitionPreservationScore = input.injectInvalidTransition ? Math.max(0, revealTransitionPreservationScore - 20) : revealTransitionPreservationScore;
  const adjustedResponseToAftermathScore = input.injectInvalidTransition ? Math.max(0, responseToAftermathScore - 18) : responseToAftermathScore;
  const adjustedSettleBlendStabilityScore = input.injectInvalidTransition ? Math.max(0, settleBlendStabilityScore - 18) : settleBlendStabilityScore;
  const adjustedBlendCameraCompatibilityScore = input.injectInvalidTransition ? Math.max(0, blendCameraCompatibilityScore - 14) : blendCameraCompatibilityScore;

  const candidateState: CinematicTransitionBlendState = {
    activeBlendPhase: target.phase,
    fromBeat: target.fromBeat,
    toBeat: target.toBeat,
    blendProgress: Number(blendProgress.toFixed(2)),
    blendWeight: Number(blendWeight.toFixed(2)),
    transitionSmoothnessScore: adjustedTransitionSmoothnessScore,
    visualContinuityScore: adjustedVisualContinuityScore,
    rollbackRestoredBlend: false,
    rejectedBlendTransitionCount: previousSnapshot?.state.rejectedBlendTransitionCount ?? 0,
  };
  const candidateHint = phaseHintValue(target.phase, blendWeight);
  const candidateDiagnostics: CinematicTransitionBlendFrameDiagnostics = {
    activeBlendPhase: target.phase,
    fromBeat: target.fromBeat,
    toBeat: target.toBeat,
    blendProgress: candidateState.blendProgress,
    blendWeight: candidateState.blendWeight,
    transitionSmoothnessScore: adjustedTransitionSmoothnessScore,
    visualContinuityScore: adjustedVisualContinuityScore,
    revealTransitionPreservationScore: adjustedRevealTransitionPreservationScore,
    responseToAftermathScore: adjustedResponseToAftermathScore,
    settleBlendStabilityScore: adjustedSettleBlendStabilityScore,
    blendCameraCompatibilityScore: adjustedBlendCameraCompatibilityScore,
    rollbackRestoredBlend: false,
    rejectedBlendTransitionCount: candidateState.rejectedBlendTransitionCount,
    overlay: `${target.phase} • ${target.fromBeat} -> ${target.toBeat} • blend ${candidateState.blendWeight.toFixed(2)} • rollback no`,
  };

  const shouldRollback = previousSnapshot !== null && (
    adjustedTransitionSmoothnessScore < GOVERNED_MIN_TRANSITION_SMOOTHNESS
    || adjustedVisualContinuityScore < GOVERNED_MIN_VISUAL_CONTINUITY
    || adjustedRevealTransitionPreservationScore < GOVERNED_MIN_REVEAL_TRANSITION_PRESERVATION
    || adjustedResponseToAftermathScore < GOVERNED_MIN_RESPONSE_TO_AFTERMATH
    || adjustedSettleBlendStabilityScore < GOVERNED_MIN_SETTLE_BLEND_STABILITY
    || adjustedBlendCameraCompatibilityScore < GOVERNED_MIN_BLEND_CAMERA_COMPATIBILITY
  );

  if (shouldRollback) {
    const restoredState: CinematicTransitionBlendState = {
      ...previousSnapshot.state,
      rollbackRestoredBlend: true,
      rejectedBlendTransitionCount: previousSnapshot.state.rejectedBlendTransitionCount + 1,
    };
    const restoredDiagnostics: CinematicTransitionBlendFrameDiagnostics = {
      ...previousSnapshot.diagnostics,
      rollbackRestoredBlend: true,
      rejectedBlendTransitionCount: restoredState.rejectedBlendTransitionCount,
      overlay: `${previousSnapshot.state.activeBlendPhase} • ${previousSnapshot.state.fromBeat} -> ${previousSnapshot.state.toBeat} • blend ${previousSnapshot.state.blendWeight.toFixed(2)} • rollback yes`,
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

  const snapshot: CinematicTransitionBlendSnapshot = {
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