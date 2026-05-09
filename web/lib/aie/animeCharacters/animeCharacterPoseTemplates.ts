import type {
  AnimeCharacterExpressionId,
  AnimeCharacterExpressionTemplate,
  AnimeCharacterPoseId,
  AnimeCharacterPoseTemplate,
} from "./governedAnimeCharacterState";

const POSE_TEMPLATES: readonly AnimeCharacterPoseTemplate[] = [
  { id: "NEUTRAL_HERO_STANCE", label: "Neutral hero stance", motionIntent: "Hold a balanced character-centered hero stance with readable face, hands, and silhouette", poseReadabilityPriority: 98, handReadabilityRequired: true, bodyBalanceRequired: true, uncontrolledLimbMotionAllowed: false, combatChoreographyAllowed: false },
  { id: "HALF_TURN_REVEAL_STANCE", label: "Half-turn reveal stance", motionIntent: "Turn slightly toward camera for a clear face and hair silhouette reveal", poseReadabilityPriority: 97, handReadabilityRequired: true, bodyBalanceRequired: true, uncontrolledLimbMotionAllowed: false, combatChoreographyAllowed: false },
  { id: "BEACON_FACING_CONTEMPLATIVE_STANCE", label: "Beacon-facing contemplative stance", motionIntent: "Face the beacon in a calm readable profile while keeping eyes and mouth visible", poseReadabilityPriority: 95, handReadabilityRequired: true, bodyBalanceRequired: true, uncontrolledLimbMotionAllowed: false, combatChoreographyAllowed: false },
  { id: "SUBTLE_ACTION_READY_STANCE", label: "Subtle action-ready stance", motionIntent: "Shift into a grounded ready pose with no combat choreography and clear limb separation", poseReadabilityPriority: 94, handReadabilityRequired: true, bodyBalanceRequired: true, uncontrolledLimbMotionAllowed: false, combatChoreographyAllowed: false },
  { id: "GENTLE_WALKING_APPROACH_STANCE", label: "Gentle walking approach stance", motionIntent: "Take one gentle approach step with stable hair flow and readable body balance", poseReadabilityPriority: 94, handReadabilityRequired: true, bodyBalanceRequired: true, uncontrolledLimbMotionAllowed: false, combatChoreographyAllowed: false },
  { id: "AFTERMATH_HOLD_STANCE", label: "Aftermath hold stance", motionIntent: "Settle into a quiet still pose after chamber light recedes, with clear face framing", poseReadabilityPriority: 96, handReadabilityRequired: true, bodyBalanceRequired: true, uncontrolledLimbMotionAllowed: false, combatChoreographyAllowed: false },
] as const;

const EXPRESSION_TEMPLATES: readonly AnimeCharacterExpressionTemplate[] = [
  { id: "NEUTRAL_CALM", label: "Neutral calm", facialReadabilityPriority: 97, mouthPerformanceAllowed: false, extremeEmotionAllowed: false, dialogueAllowed: false },
  { id: "FOCUSED_DETERMINATION", label: "Focused determination", facialReadabilityPriority: 98, mouthPerformanceAllowed: false, extremeEmotionAllowed: false, dialogueAllowed: false },
  { id: "MILD_WONDER", label: "Mild wonder", facialReadabilityPriority: 96, mouthPerformanceAllowed: false, extremeEmotionAllowed: false, dialogueAllowed: false },
  { id: "QUIET_RESOLVE", label: "Quiet resolve", facialReadabilityPriority: 97, mouthPerformanceAllowed: false, extremeEmotionAllowed: false, dialogueAllowed: false },
  { id: "SLIGHT_CONCERN", label: "Slight concern", facialReadabilityPriority: 95, mouthPerformanceAllowed: false, extremeEmotionAllowed: false, dialogueAllowed: false },
] as const;

export function listAnimeCharacterPoseTemplates(): AnimeCharacterPoseTemplate[] {
  return POSE_TEMPLATES.map((entry) => ({ ...entry }));
}

export function listAnimeCharacterExpressionTemplates(): AnimeCharacterExpressionTemplate[] {
  return EXPRESSION_TEMPLATES.map((entry) => ({ ...entry }));
}

export function getAnimeCharacterPoseTemplateById(poseId: string): AnimeCharacterPoseTemplate | null {
  const normalized = poseId.trim().toUpperCase() as AnimeCharacterPoseId;
  const entry = POSE_TEMPLATES.find((template) => template.id === normalized);
  return entry ? { ...entry } : null;
}

export function getAnimeCharacterExpressionTemplateById(expressionId: string): AnimeCharacterExpressionTemplate | null {
  const normalized = expressionId.trim().toUpperCase() as AnimeCharacterExpressionId;
  const entry = EXPRESSION_TEMPLATES.find((template) => template.id === normalized);
  return entry ? { ...entry } : null;
}

export function selectDefaultAnimeCharacterPose(profileDefault: AnimeCharacterPoseId): AnimeCharacterPoseTemplate {
  return getAnimeCharacterPoseTemplateById(profileDefault) ?? listAnimeCharacterPoseTemplates()[0];
}

export function selectDefaultAnimeCharacterExpression(profileDefault: AnimeCharacterExpressionId): AnimeCharacterExpressionTemplate {
  return getAnimeCharacterExpressionTemplateById(profileDefault) ?? listAnimeCharacterExpressionTemplates()[0];
}
