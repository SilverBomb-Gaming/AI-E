import type { AnimeCharacterProfile, AnimeCharacterProfileId } from "./governedAnimeCharacterState";

const APPROVED_ANIME_CHARACTER_PROFILES: readonly AnimeCharacterProfile[] = [
  {
    id: "CHARACTER_001",
    label: "CELESTIAL_APPRENTICE",
    archetype: "calm sci-fi fantasy apprentice",
    genderPresentation: "young-adult heroine",
    eyeDescription: "large readable bright teal anime eyes",
    hairDescription: "long silver-blue hair with a memorable flowing silhouette",
    outfitDescription: "fitted sci-fi fantasy jacket with clean stylized futuristic details",
    expressionDefault: "FOCUSED_DETERMINATION",
    poseDefault: "NEUTRAL_HERO_STANCE",
    promptSubject: "A clearly anime-style young-adult heroine with long silver-blue hair and bright teal eyes",
    visualIdentity: ["large teal anime eyes", "long silver-blue hair shape", "clean face proportions", "fitted sci-fi fantasy jacket"],
    safetyNotes: ["single young-adult character", "no dialogue", "no sexualization", "no combat choreography"],
    maxCastSize: 1,
    dialogueAllowed: false,
    combatChoreographyAllowed: false,
    explicitSexualizationAllowed: false,
    unrestrictedCostumeGenerationAllowed: false,
  },
  {
    id: "CHARACTER_002",
    label: "NEON_COURIER",
    archetype: "alert neon urban courier",
    genderPresentation: "young-adult heroine",
    eyeDescription: "large readable anime eyes with alert focus",
    hairDescription: "short magenta hair with crisp graphic silhouette",
    outfitDescription: "neon-accent urban jacket with bounded futuristic trim",
    expressionDefault: "FOCUSED_DETERMINATION",
    poseDefault: "SUBTLE_ACTION_READY_STANCE",
    promptSubject: "A clearly anime-style young-adult heroine with short magenta hair and alert focused eyes",
    visualIdentity: ["short magenta anime hair", "large focused eyes", "neon urban jacket", "action-ready silhouette"],
    safetyNotes: ["single young-adult character", "no dialogue", "no combat choreography", "no unrestricted costume generation"],
    maxCastSize: 1,
    dialogueAllowed: false,
    combatChoreographyAllowed: false,
    explicitSexualizationAllowed: false,
    unrestrictedCostumeGenerationAllowed: false,
  },
  {
    id: "CHARACTER_003",
    label: "RITUAL_TECH_ADEPT",
    archetype: "composed ritual technology adept",
    genderPresentation: "young-adult heroine",
    eyeDescription: "large readable anime eyes with quiet resolve",
    hairDescription: "dark violet hair with clean ceremonial silhouette",
    outfitDescription: "glowing accessory motifs with controlled ceremonial techwear",
    expressionDefault: "QUIET_RESOLVE",
    poseDefault: "BEACON_FACING_CONTEMPLATIVE_STANCE",
    promptSubject: "A clearly anime-style young-adult heroine with dark violet hair and glowing accessory motifs",
    visualIdentity: ["dark violet anime hair", "readable calm eyes", "glowing accessory motifs", "composed ceremonial stance"],
    safetyNotes: ["single young-adult character", "no dialogue", "no extreme emotional acting", "no autonomous behavior"],
    maxCastSize: 1,
    dialogueAllowed: false,
    combatChoreographyAllowed: false,
    explicitSexualizationAllowed: false,
    unrestrictedCostumeGenerationAllowed: false,
  },
  {
    id: "CHARACTER_004",
    label: "INDUSTRIAL_SENTINEL",
    archetype: "reserved industrial sentinel",
    genderPresentation: "young-adult hero",
    eyeDescription: "large readable anime eyes with reserved stoic focus",
    hairDescription: "dark ash hair with practical angular silhouette",
    outfitDescription: "practical techwear silhouette with grounded industrial details",
    expressionDefault: "NEUTRAL_CALM",
    poseDefault: "AFTERMATH_HOLD_STANCE",
    promptSubject: "A clearly anime-style young-adult hero with dark ash hair and a reserved stoic expression",
    visualIdentity: ["dark ash anime hair", "stoic readable face", "practical techwear silhouette", "grounded industrial profile"],
    safetyNotes: ["single young-adult character", "no dialogue", "no combat choreography", "no unrestricted realism escalation"],
    maxCastSize: 1,
    dialogueAllowed: false,
    combatChoreographyAllowed: false,
    explicitSexualizationAllowed: false,
    unrestrictedCostumeGenerationAllowed: false,
  },
] as const;

export function listApprovedAnimeCharacterProfiles(): AnimeCharacterProfile[] {
  return APPROVED_ANIME_CHARACTER_PROFILES.map((entry) => ({
    ...entry,
    visualIdentity: [...entry.visualIdentity],
    safetyNotes: [...entry.safetyNotes],
  }));
}

export function getApprovedAnimeCharacterProfileById(profileId: string): AnimeCharacterProfile | null {
  const normalized = profileId.trim().toUpperCase() as AnimeCharacterProfileId;
  const entry = APPROVED_ANIME_CHARACTER_PROFILES.find((profile) => profile.id === normalized);
  return entry
    ? { ...entry, visualIdentity: [...entry.visualIdentity], safetyNotes: [...entry.safetyNotes] }
    : null;
}
