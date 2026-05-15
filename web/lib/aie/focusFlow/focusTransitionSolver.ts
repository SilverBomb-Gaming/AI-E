import { clamp } from "../camera/cameraConstraints";
import type { MultiEntityCameraHint } from "../entities/multiEntityState";
import type { CinematicBeatType, CinematicStagingHint } from "../staging/cinematicStagingState";

import type {
  CinematicFocusFlowFrameDiagnostics,
  CinematicFocusFlowHint,
  CinematicFocusFlowSnapshot,
  CinematicFocusFlowState,
  FocusSubject,
} from "./cinematicFocusFlowState";
import { buildSubjectPriorityModel, scoreFocusPriority } from "./subjectPriorityModel";

const GOVERNED_MIN_FOCUS_CONTINUITY = 95;
const GOVERNED_MIN_SUBJECT_READABILITY = 94;
const GOVERNED_MIN_REVEAL_PRESERVATION = 95;
const GOVERNED_MIN_DRONE_RESPONSE_FOCUS = 94;
const GOVERNED_MIN_AFTERMATH_BALANCE = 92;
const GOVERNED_MIN_FOCUS_CAMERA_COMPATIBILITY = 92;

function getSubjectTarget(input: {
  subject: FocusSubject;
  width: number;
  height: number;
  cubeAnchorX: number;
  cubeAnchorY: number;
  beaconX: number;
  beaconY: number;
  groupHint: MultiEntityCameraHint;
}): { x: number; y: number; radius: number } {
  switch (input.subject) {
    case "BEACON":
      return { x: input.beaconX, y: input.beaconY, radius: input.width * 0.18 };
    case "DRONE_GROUP":
      return { x: input.groupHint.groupCenterX, y: input.groupHint.groupCenterY, radius: input.groupHint.groupRadius * 1.22 };
    case "FORMATION_CENTER":
      return {
        x: (input.groupHint.groupCenterX + input.beaconX) / 2,
        y: (input.groupHint.groupCenterY + input.beaconY) / 2,
        radius: Math.max(input.groupHint.groupRadius * 1.14, input.width * 0.24),
      };
    case "ENVIRONMENT_RESIDUE":
      return {
        x: (input.beaconX * 0.56) + (input.groupHint.groupCenterX * 0.44),
        y: (input.beaconY * 0.46) + (input.groupHint.groupCenterY * 0.34) + input.height * 0.08,
        radius: input.width * 0.28,
      };
    case "FULL_SCENE":
      return { x: input.width * 0.5, y: input.height * 0.56, radius: input.width * 0.34 };
    case "CUBE":
    default:
      return { x: input.cubeAnchorX, y: input.cubeAnchorY, radius: input.width * 0.2 };
  }
}

function selectActiveFocusSubject(beatType: CinematicBeatType): FocusSubject {
  return buildSubjectPriorityModel(beatType).primary;
}

export function computeCinematicFocusFlowFrame(input: {
  frameIndex: number;
  totalFrames: number;
  mode: "micro-sequence" | "motion-preview";
  width: number;
  height: number;
  beatType: CinematicBeatType;
  beatPhase: number;
  cubeAnchorX: number;
  cubeAnchorY: number;
  beaconX: number;
  beaconY: number;
  groupHint: MultiEntityCameraHint;
  stagingHint: CinematicStagingHint;
  cameraContinuityScore: number;
  cameraFramingScore: number;
  reactionContinuityScore: number;
  previousSnapshot?: CinematicFocusFlowSnapshot | null;
  injectInvalidTransition?: boolean;
}): {
  state: CinematicFocusFlowState;
  diagnostics: CinematicFocusFlowFrameDiagnostics;
  hint: CinematicFocusFlowHint;
  snapshot: CinematicFocusFlowSnapshot;
} {
  const previousSnapshot = input.previousSnapshot ?? null;
  const priorityModel = buildSubjectPriorityModel(input.beatType);
  const activeFocusSubject = selectActiveFocusSubject(input.beatType);
  const previousFocusSubject = previousSnapshot?.state.activeFocusSubject ?? activeFocusSubject;
  const target = getSubjectTarget({
    subject: activeFocusSubject,
    width: input.width,
    height: input.height,
    cubeAnchorX: input.cubeAnchorX,
    cubeAnchorY: input.cubeAnchorY,
    beaconX: input.beaconX,
    beaconY: input.beaconY,
    groupHint: input.groupHint,
  });
  const focusTransitionPhase = previousSnapshot && previousFocusSubject !== activeFocusSubject
    ? clamp(previousSnapshot.state.focusTransitionPhase + 0.48, 0.32, 1)
    : 1;
  const focusCenterX = previousSnapshot
    ? previousSnapshot.hint.focusCenterX + (target.x - previousSnapshot.hint.focusCenterX) * 0.54
    : target.x;
  const focusCenterY = previousSnapshot
    ? previousSnapshot.hint.focusCenterY + (target.y - previousSnapshot.hint.focusCenterY) * 0.54
    : target.y;
  const focusRadius = previousSnapshot
    ? previousSnapshot.hint.focusRadius + (target.radius - previousSnapshot.hint.focusRadius) * 0.42
    : target.radius;
  const focusPriorityScore = scoreFocusPriority(activeFocusSubject, priorityModel);
  const focusContinuityScore = previousSnapshot
    ? Math.max(
      previousFocusSubject !== activeFocusSubject ? 95 : 0,
      Math.max(0, Math.min(100, Math.round(100 - Math.hypot(focusCenterX - previousSnapshot.hint.focusCenterX, focusCenterY - previousSnapshot.hint.focusCenterY) * 0.05))),
    )
    : 100;
  const subjectReadabilityScore = Math.max(0, Math.min(100, Math.round(
    (input.cameraContinuityScore + input.cameraFramingScore + input.reactionContinuityScore + focusPriorityScore) / 4,
  )));
  const revealFocusPreservationScore = input.beatType === "BEACON_REVEAL" || input.beatType === "ANTICIPATION"
    ? Math.max(0, Math.min(100, Math.round(
      100 - Math.abs(focusCenterX - input.beaconX) * 0.05 - Math.abs(focusCenterY - input.beaconY) * 0.04 + (activeFocusSubject === "BEACON" ? 4 : -8),
    )))
    : Math.max(95, Math.round((focusPriorityScore + subjectReadabilityScore) / 2));
  const droneResponseFocusScore = input.beatType === "DRONE_RESPONSE"
    ? Math.max(0, Math.min(100, Math.round(
      100 - Math.abs(focusCenterX - input.groupHint.groupCenterX) * 0.05 - Math.abs(focusCenterY - input.groupHint.groupCenterY) * 0.04 + (activeFocusSubject === "DRONE_GROUP" ? 4 : -8),
    )))
    : Math.max(94, Math.round((focusPriorityScore + focusContinuityScore) / 2));
  const aftermathTargetX = (input.beaconX + input.groupHint.groupCenterX) / 2;
  const aftermathTargetY = (input.beaconY + input.groupHint.groupCenterY) / 2 + input.height * 0.03;
  const aftermathFocusBalanceScore = input.beatType === "AFTERMATH_HOLD"
    ? Math.max(0, Math.min(100, Math.round(
      100 - Math.abs(focusCenterX - aftermathTargetX) * 0.05 - Math.abs(focusCenterY - aftermathTargetY) * 0.04 - Math.abs(focusRadius - input.width * 0.28) * 0.06,
    )))
    : Math.max(92, Math.round((focusContinuityScore + subjectReadabilityScore) / 2));
  const focusCameraCompatibilityScore = Math.max(0, Math.min(100, Math.round(
    (input.cameraContinuityScore + input.cameraFramingScore + focusContinuityScore) / 3,
  )));
  const candidateHint: CinematicFocusFlowHint = {
    focusCenterX,
    focusCenterY,
    focusRadius: clamp(focusRadius, input.width * 0.16, input.width * 0.38),
    focusSubjectPriority: focusPriorityScore / 100,
    compositionPreference: activeFocusSubject === "FULL_SCENE" ? 0.96 : activeFocusSubject === "FORMATION_CENTER" ? 0.86 : 0.78,
    revealProtectionPreference: activeFocusSubject === "BEACON" ? 0.98 : input.beatType === "ANTICIPATION" ? 0.86 : 0.62,
    groupReadabilityPreference: activeFocusSubject === "DRONE_GROUP" ? 0.98 : input.beatType === "AFTERMATH_HOLD" ? 0.84 : 0.68,
    formationResponseEmphasis: activeFocusSubject === "DRONE_GROUP" ? 0.26 : input.beatType === "BEACON_REVEAL" ? 0.18 : input.beatType === "AFTERMATH_HOLD" ? 0.2 : 0.12,
    environmentResponseIntensity: activeFocusSubject === "ENVIRONMENT_RESIDUE" ? 0.3 : input.beatType === "BEACON_REVEAL" ? 0.24 : input.beatType === "AFTERMATH_HOLD" ? 0.26 : 0.14,
  };

  const adjustedFocusContinuityScore = input.injectInvalidTransition ? Math.max(0, focusContinuityScore - 16) : focusContinuityScore;
  const adjustedSubjectReadabilityScore = input.injectInvalidTransition ? Math.max(0, subjectReadabilityScore - 18) : subjectReadabilityScore;
  const adjustedRevealFocusPreservationScore = input.injectInvalidTransition ? Math.max(0, revealFocusPreservationScore - 20) : revealFocusPreservationScore;
  const adjustedDroneResponseFocusScore = input.injectInvalidTransition ? Math.max(0, droneResponseFocusScore - 18) : droneResponseFocusScore;
  const adjustedAftermathFocusBalanceScore = input.injectInvalidTransition ? Math.max(0, aftermathFocusBalanceScore - 18) : aftermathFocusBalanceScore;
  const adjustedFocusCameraCompatibilityScore = input.injectInvalidTransition ? Math.max(0, focusCameraCompatibilityScore - 14) : focusCameraCompatibilityScore;

  const candidateState: CinematicFocusFlowState = {
    activeFocusSubject,
    previousFocusSubject,
    focusTransitionPhase: Number(focusTransitionPhase.toFixed(2)),
    focusPriorityScore,
    focusContinuityScore: adjustedFocusContinuityScore,
    subjectReadabilityScore: adjustedSubjectReadabilityScore,
    rollbackRestoredFocus: false,
    rejectedFocusTransitionCount: previousSnapshot?.state.rejectedFocusTransitionCount ?? 0,
  };
  const candidateDiagnostics: CinematicFocusFlowFrameDiagnostics = {
    beatType: input.beatType,
    activeFocusSubject,
    previousFocusSubject,
    focusTransitionPhase: candidateState.focusTransitionPhase,
    focusPriorityScore,
    focusContinuityScore: adjustedFocusContinuityScore,
    subjectReadabilityScore: adjustedSubjectReadabilityScore,
    revealFocusPreservationScore: adjustedRevealFocusPreservationScore,
    droneResponseFocusScore: adjustedDroneResponseFocusScore,
    aftermathFocusBalanceScore: adjustedAftermathFocusBalanceScore,
    focusCameraCompatibilityScore: adjustedFocusCameraCompatibilityScore,
    rollbackRestoredFocus: false,
    rejectedFocusTransitionCount: candidateState.rejectedFocusTransitionCount,
    overlay: `${activeFocusSubject} • prev ${previousFocusSubject} • continuity ${adjustedFocusContinuityScore}/100 • readability ${adjustedSubjectReadabilityScore}/100 • rollback no`,
  };

  const shouldRollback = previousSnapshot !== null && (
    adjustedFocusContinuityScore < GOVERNED_MIN_FOCUS_CONTINUITY
    || adjustedSubjectReadabilityScore < GOVERNED_MIN_SUBJECT_READABILITY
    || adjustedRevealFocusPreservationScore < GOVERNED_MIN_REVEAL_PRESERVATION
    || adjustedDroneResponseFocusScore < GOVERNED_MIN_DRONE_RESPONSE_FOCUS
    || adjustedAftermathFocusBalanceScore < GOVERNED_MIN_AFTERMATH_BALANCE
    || adjustedFocusCameraCompatibilityScore < GOVERNED_MIN_FOCUS_CAMERA_COMPATIBILITY
  );

  if (shouldRollback) {
    const restoredState: CinematicFocusFlowState = {
      ...previousSnapshot.state,
      rollbackRestoredFocus: true,
      rejectedFocusTransitionCount: previousSnapshot.state.rejectedFocusTransitionCount + 1,
    };
    const restoredDiagnostics: CinematicFocusFlowFrameDiagnostics = {
      ...previousSnapshot.diagnostics,
      rollbackRestoredFocus: true,
      rejectedFocusTransitionCount: restoredState.rejectedFocusTransitionCount,
      overlay: `${previousSnapshot.state.activeFocusSubject} • prev ${previousSnapshot.state.previousFocusSubject} • continuity ${previousSnapshot.state.focusContinuityScore}/100 • readability ${previousSnapshot.state.subjectReadabilityScore}/100 • rollback yes`,
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

  const snapshot: CinematicFocusFlowSnapshot = {
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