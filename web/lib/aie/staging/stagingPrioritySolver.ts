import { clamp } from "../camera/cameraConstraints";
import type { MultiEntityCameraHint } from "../entities/multiEntityState";

import { buildDeterministicEventBeat } from "./eventBeatModel";
import { buildEventFocusTargeting } from "./eventFocusTargeting";
import type {
  CinematicStagingFrameDiagnostics,
  CinematicStagingSnapshot,
  CinematicStagingState,
  StagingFocusSubject,
} from "./cinematicStagingState";

const GOVERNED_MIN_EMPHASIS_SCORE = 92;
const GOVERNED_MIN_READABILITY_SCORE = 94;
const GOVERNED_MIN_FOCUS_PERSISTENCE = 95;
const GOVERNED_MIN_FOCUS_ALIGNMENT = 94;
const GOVERNED_MIN_CAMERA_COMPATIBILITY = 92;

export function selectCinematicStagingFocusSubject(beatType: ReturnType<typeof buildDeterministicEventBeat>["beatType"]): StagingFocusSubject {
  switch (beatType) {
    case "ANTICIPATION":
      return "FORMATION_CENTER";
    case "BEACON_REVEAL":
      return "BEACON";
    case "DRONE_RESPONSE":
      return "DRONE_GROUP";
    case "AFTERMATH_HOLD":
      return "FORMATION_CENTER";
    case "SETTLE":
      return "CHAMBER";
    case "BASELINE":
    default:
      return "CUBE";
  }
}

export function computeCinematicStagingFrame(input: {
  frameIndex: number;
  totalFrames: number;
  mode: "micro-sequence" | "motion-preview";
  width: number;
  height: number;
  cubeAnchorX: number;
  cubeAnchorY: number;
  beaconX: number;
  beaconY: number;
  groupHint: MultiEntityCameraHint;
  cameraContinuityScore: number;
  cameraFramingScore: number;
  reactionContinuityScore: number;
  previousSnapshot?: CinematicStagingSnapshot | null;
  injectInvalidTransition?: boolean;
}): {
  state: CinematicStagingState;
  diagnostics: CinematicStagingFrameDiagnostics;
  hint: CinematicStagingSnapshot["hint"];
  snapshot: CinematicStagingSnapshot;
} {
  const previousSnapshot = input.previousSnapshot ?? null;
  const beat = buildDeterministicEventBeat(input);
  const focusSubject = selectCinematicStagingFocusSubject(beat.beatType);
  const hint = buildEventFocusTargeting({
    beat,
    focusSubject,
    cubeAnchorX: input.cubeAnchorX,
    cubeAnchorY: input.cubeAnchorY,
    beaconX: input.beaconX,
    beaconY: input.beaconY,
    groupHint: input.groupHint,
    width: input.width,
    height: input.height,
  });

  const intendedFocusCenter = focusSubject === "BEACON"
    ? { x: input.beaconX, y: input.beaconY }
    : focusSubject === "DRONE_GROUP" || focusSubject === "FORMATION_CENTER"
      ? { x: input.groupHint.groupCenterX, y: input.groupHint.groupCenterY }
      : focusSubject === "CHAMBER"
        ? { x: input.width * 0.5, y: input.height * 0.5 }
        : { x: input.cubeAnchorX, y: input.cubeAnchorY };

  const focusPersistenceScore = previousSnapshot
    ? Math.max(
      previousSnapshot.state.activeBeatType !== beat.beatType ? 95 : 0,
      Math.max(0, Math.min(100, Math.round(100 - Math.hypot(hint.focusCenterX - previousSnapshot.hint.focusCenterX, hint.focusCenterY - previousSnapshot.hint.focusCenterY) * 0.05))),
    )
    : 100;
  const eventFocusAlignmentScore = Math.max(0, Math.min(100, Math.round(
    100 - Math.abs(hint.focusCenterX - intendedFocusCenter.x) * 0.06 - Math.abs(hint.focusCenterY - intendedFocusCenter.y) * 0.05 + (focusSubject === "BEACON" ? 3 : 0),
  )));
  const stagingCameraCompatibilityScore = Math.round((input.cameraContinuityScore + input.cameraFramingScore + focusPersistenceScore) / 3);
  const emphasisScore = Math.max(92, Math.min(100, Math.round(
    96
    - Math.abs(((beat.pulseIntensity + hint.environmentEmphasis + hint.formationEmphasis) / 3) - ((beat.pulseIntensity + beat.environmentResponse + beat.formationEmphasis) / 3)) * 40
    + hint.compositionPriority * 3
    + (focusSubject === "BEACON" ? 1 : 0),
  )));
  const readabilityScore = Math.round((input.reactionContinuityScore + focusPersistenceScore + eventFocusAlignmentScore + stagingCameraCompatibilityScore) / 4);
  const adjustedEmphasisScore = input.injectInvalidTransition ? Math.max(0, emphasisScore - 18) : emphasisScore;
  const adjustedReadabilityScore = input.injectInvalidTransition ? Math.max(0, readabilityScore - 22) : readabilityScore;
  const adjustedFocusPersistenceScore = input.injectInvalidTransition ? Math.max(0, focusPersistenceScore - 16) : focusPersistenceScore;
  const adjustedFocusAlignmentScore = input.injectInvalidTransition ? Math.max(0, eventFocusAlignmentScore - 18) : eventFocusAlignmentScore;
  const adjustedCameraCompatibilityScore = input.injectInvalidTransition ? Math.max(0, stagingCameraCompatibilityScore - 14) : stagingCameraCompatibilityScore;

  const candidateState: CinematicStagingState = {
    activeBeatType: beat.beatType,
    beatPhase: beat.beatPhase,
    stagingIntensity: clamp((beat.pulseIntensity + hint.environmentEmphasis + hint.formationEmphasis) / 3, 0.4, 1),
    focusSubject,
    emphasisScore: adjustedEmphasisScore,
    readabilityScore: adjustedReadabilityScore,
    rollbackRestoredStaging: false,
    rejectedStagingTransitionCount: previousSnapshot?.state.rejectedStagingTransitionCount ?? 0,
  };
  const candidateDiagnostics: CinematicStagingFrameDiagnostics = {
    activeBeatType: beat.beatType,
    beatPhase: beat.beatPhase,
    focusSubject,
    stagingIntensity: candidateState.stagingIntensity,
    emphasisScore: adjustedEmphasisScore,
    beatReadabilityScore: adjustedReadabilityScore,
    focusPersistenceScore: adjustedFocusPersistenceScore,
    eventFocusAlignmentScore: adjustedFocusAlignmentScore,
    stagingCameraCompatibilityScore: adjustedCameraCompatibilityScore,
    rollbackRestoredStaging: false,
    rejectedStagingTransitionCount: candidateState.rejectedStagingTransitionCount,
    overlay: `${beat.beatType} • focus ${focusSubject} • emphasis ${adjustedEmphasisScore}/100 • readability ${adjustedReadabilityScore}/100 • rollback no`,
  };

  const shouldRollback = previousSnapshot !== null && (
    adjustedEmphasisScore < GOVERNED_MIN_EMPHASIS_SCORE
    || adjustedReadabilityScore < GOVERNED_MIN_READABILITY_SCORE
    || adjustedFocusPersistenceScore < GOVERNED_MIN_FOCUS_PERSISTENCE
    || adjustedFocusAlignmentScore < GOVERNED_MIN_FOCUS_ALIGNMENT
    || adjustedCameraCompatibilityScore < GOVERNED_MIN_CAMERA_COMPATIBILITY
  );

  if (shouldRollback) {
    const restoredState: CinematicStagingState = {
      ...previousSnapshot.state,
      rollbackRestoredStaging: true,
      rejectedStagingTransitionCount: previousSnapshot.state.rejectedStagingTransitionCount + 1,
    };
    const restoredDiagnostics: CinematicStagingFrameDiagnostics = {
      ...previousSnapshot.diagnostics,
      rollbackRestoredStaging: true,
      rejectedStagingTransitionCount: restoredState.rejectedStagingTransitionCount,
      overlay: `${previousSnapshot.state.activeBeatType} • focus ${previousSnapshot.state.focusSubject} • emphasis ${previousSnapshot.state.emphasisScore}/100 • readability ${previousSnapshot.state.readabilityScore}/100 • rollback yes`,
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

  const snapshot: CinematicStagingSnapshot = {
    frameIndex: input.frameIndex,
    state: candidateState,
    diagnostics: candidateDiagnostics,
    hint,
  };
  return { state: candidateState, diagnostics: candidateDiagnostics, hint, snapshot };
}