import { clamp } from "../camera/cameraConstraints";

import type { MultiEntityCameraHint } from "../entities/multiEntityState";
import type { CinematicEventBeat } from "./eventBeatModel";
import type { CinematicStagingHint, StagingFocusSubject } from "./cinematicStagingState";

export function buildEventFocusTargeting(input: {
  beat: CinematicEventBeat;
  focusSubject: StagingFocusSubject;
  cubeAnchorX: number;
  cubeAnchorY: number;
  beaconX: number;
  beaconY: number;
  groupHint: MultiEntityCameraHint;
  width: number;
  height: number;
}): CinematicStagingHint {
  const subjectCenter = input.focusSubject === "BEACON"
    ? { x: input.beaconX, y: input.beaconY }
    : input.focusSubject === "DRONE_GROUP" || input.focusSubject === "FORMATION_CENTER"
      ? { x: input.groupHint.groupCenterX, y: input.groupHint.groupCenterY }
      : input.focusSubject === "CHAMBER"
        ? { x: input.width * 0.5, y: input.height * 0.5 }
        : { x: input.cubeAnchorX, y: input.cubeAnchorY };

  const focusRadius = input.focusSubject === "BEACON"
    ? input.width * 0.14
    : input.focusSubject === "DRONE_GROUP" || input.focusSubject === "FORMATION_CENTER"
      ? clamp(input.groupHint.groupRadius * (1.05 + input.beat.formationEmphasis * 0.45), input.width * 0.12, input.width * 0.28)
      : input.width * 0.18;

  return {
    focusCenterX: subjectCenter.x,
    focusCenterY: subjectCenter.y,
    focusRadius,
    revealPreference: input.focusSubject === "BEACON" ? 1 : input.focusSubject === "DRONE_GROUP" ? 0.72 : 0.5,
    compositionPriority: input.focusSubject === "FORMATION_CENTER" ? 0.84 : input.focusSubject === "BEACON" ? 0.88 : 0.7,
    environmentEmphasis: clamp(input.beat.environmentResponse, 0.35, 1),
    formationEmphasis: clamp(input.beat.formationEmphasis, 0, 0.4),
  };
}