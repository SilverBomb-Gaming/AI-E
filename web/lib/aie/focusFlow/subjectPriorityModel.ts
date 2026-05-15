import type { CinematicBeatType } from "../staging/cinematicStagingState";

import type { FocusSubject } from "./cinematicFocusFlowState";

export type SubjectPriorityModel = {
  primary: FocusSubject;
  secondary: FocusSubject;
  tertiary: FocusSubject;
};

export function buildSubjectPriorityModel(beatType: CinematicBeatType): SubjectPriorityModel {
  switch (beatType) {
    case "ANTICIPATION":
      return { primary: "BEACON", secondary: "CUBE", tertiary: "FULL_SCENE" };
    case "BEACON_REVEAL":
      return { primary: "BEACON", secondary: "FORMATION_CENTER", tertiary: "ENVIRONMENT_RESIDUE" };
    case "DRONE_RESPONSE":
      return { primary: "DRONE_GROUP", secondary: "BEACON", tertiary: "FORMATION_CENTER" };
    case "AFTERMATH_HOLD":
      return { primary: "FORMATION_CENTER", secondary: "ENVIRONMENT_RESIDUE", tertiary: "BEACON" };
    case "SETTLE":
      return { primary: "FULL_SCENE", secondary: "DRONE_GROUP", tertiary: "CUBE" };
    case "BASELINE":
    default:
      return { primary: "CUBE", secondary: "BEACON", tertiary: "FULL_SCENE" };
  }
}

export function scoreFocusPriority(subject: FocusSubject, model: SubjectPriorityModel): number {
  if (subject === model.primary) {
    return 100;
  }
  if (subject === model.secondary) {
    return 97;
  }
  if (subject === model.tertiary) {
    return 94;
  }
  return 90;
}