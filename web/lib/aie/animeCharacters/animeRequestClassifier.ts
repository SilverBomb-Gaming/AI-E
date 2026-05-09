export type AnimeRequestClassification = {
  isAnimeCharacterRequest: boolean;
  confidence: number;
  matchedSignals: string[];
};

const ANIME_CHARACTER_SIGNALS: Array<{ pattern: RegExp; signal: string; weight: number }> = [
  { pattern: /\banime[-\s]?style(?:d)?\b/i, signal: "anime-style", weight: 0.28 },
  { pattern: /\banime\s+(?:girl|woman|young woman|boy|man|hero|heroine|protagonist|character|portrait|face)\b/i, signal: "anime-character-phrase", weight: 0.34 },
  { pattern: /\b(?:character|protagonist|hero|heroine|portrait|face|humanoid|young woman|young man)\b/i, signal: "character-subject", weight: 0.22 },
  { pattern: /\b(?:large|bright|readable)\s+(?:eyes|eye)\b/i, signal: "anime-eye-readability", weight: 0.14 },
  { pattern: /\b(?:hair|silhouette|outfit|pose|expression)\b/i, signal: "character-visual-traits", weight: 0.12 },
  { pattern: /\b(?:primary subject|frames her|frames him|camera frames (?:her|him|the character))\b/i, signal: "character-primary-framing", weight: 0.16 },
  { pattern: /\b(?:cel shaded|cel-shaded|manga|anime look|anime cinematic)\b/i, signal: "anime-style-dominance", weight: 0.2 },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function classifyAnimeRequest(input: { prompt?: string | null; subject?: string | null; style?: string | null; motionIntent?: string | null }): AnimeRequestClassification {
  const text = normalize([
    input.prompt ?? "",
    input.subject ?? "",
    input.style ?? "",
    input.motionIntent ?? "",
  ].join(" "));
  const matchedSignals: string[] = [];
  let confidence = 0;

  for (const signal of ANIME_CHARACTER_SIGNALS) {
    if (signal.pattern.test(text)) {
      matchedSignals.push(signal.signal);
      confidence += signal.weight;
    }
  }

  const hasAnimeSignal = matchedSignals.some((signal) => signal.startsWith("anime"));
  const hasCharacterSignal = matchedSignals.some((signal) => signal.includes("character") || signal.includes("eye") || signal.includes("visual") || signal.includes("framing"));
  const boundedConfidence = Math.min(1, Number(confidence.toFixed(2)));

  return {
    isAnimeCharacterRequest: hasAnimeSignal && hasCharacterSignal && boundedConfidence >= 0.45,
    confidence: boundedConfidence,
    matchedSignals,
  };
}
