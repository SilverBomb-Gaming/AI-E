import type { AnimeCharacterApprovalSnapshot } from "./governedAnimeCharacterState";

export function buildAnimeCharacterApprovalSnapshot(input: {
  governanceApproval: boolean;
  characterApproval: boolean;
}): AnimeCharacterApprovalSnapshot {
  return {
    governanceApproval: input.governanceApproval,
    characterApproval: input.characterApproval,
    approvedCharacterExecution: input.governanceApproval === true && input.characterApproval === true,
    approvalRequired: true,
    approvalScope: "single-approved-anime-character-render",
    maxCastSize: 1,
    automaticRepeatAllowed: false,
    automaticCastExpansionAllowed: false,
    autonomousCharacterBehaviorAllowed: false,
    crossRunPersistenceAllowed: false,
  };
}

export function validateAnimeCharacterApproval(input: {
  governanceApproval: boolean;
  characterApproval: boolean;
}): {
  approved: boolean;
  failureReason: string | null;
  recommendedRuntimeLayer: string | null;
} {
  if (!input.governanceApproval) {
    return {
      approved: false,
      failureReason: "Manual preview governance approval is required before anime character rendering can execute.",
      recommendedRuntimeLayer: "operator governance approval",
    };
  }

  if (!input.characterApproval) {
    return {
      approved: false,
      failureReason: "Anime character rendering requires explicit operator character approval before preview execution.",
      recommendedRuntimeLayer: "operator anime character approval",
    };
  }

  return {
    approved: true,
    failureReason: null,
    recommendedRuntimeLayer: null,
  };
}
