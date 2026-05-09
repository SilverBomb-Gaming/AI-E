import type { PromptVariationDomain } from "./promptVariationHarnessState";

export type PromptSafetyResult = {
  status: "APPROVED" | "REJECTED";
  reasons: string[];
  blockedTerms: string[];
  approvedTerms: string[];
  approvedDomain: PromptVariationDomain | null;
};

export const PROMPT_SAFETY_BLOCKED_TERMS = [
  "human",
  "humanoid",
  "person",
  "pilot",
  "character",
  "face",
  "dialogue",
  "spoken",
  "speech",
  "conversation",
  "story continuation",
  "long scene",
  "long sequence",
  "extended sequence",
  "autonomous",
  "armed",
  "battle",
  "combat",
  "weapon",
  "chase",
  "gore",
  "romance",
] as const;

export const PROMPT_SAFETY_APPROVED_TERMS = [
  "drone",
  "beacon",
  "chamber",
  "fog",
  "light",
  "reflection",
  "platform",
  "mechanical",
  "formation",
  "pulse",
  "reveal",
  "settle",
] as const;

function matchesTerm(prompt: string, term: string): boolean {
  const normalizedPrompt = prompt.toLowerCase();
  const normalizedTerm = term.toLowerCase();
  if (!normalizedTerm.includes(" ")) {
    return normalizedPrompt.includes(normalizedTerm);
  }

  const tokens = normalizedTerm.split(/\s+/).filter(Boolean);
  if (tokens.length === 2 && tokens[0] === "long" && tokens[1] === "scene") {
    return /\blong\b[\w\s-]{0,24}\bscene\b/i.test(prompt);
  }
  if (tokens.length === 2 && tokens[0] === "long" && tokens[1] === "sequence") {
    return /\blong\b[\w\s-]{0,24}\bsequence\b/i.test(prompt);
  }
  if (tokens.length === 2 && tokens[0] === "story" && tokens[1] === "continuation") {
    return /\bstory\b[\w\s-]{0,24}\bcontinuation\b/i.test(prompt);
  }

  return normalizedPrompt.includes(normalizedTerm);
}

function findMatchedTerms(prompt: string, terms: readonly string[]): string[] {
  const normalized = prompt.toLowerCase();
  return terms.filter((term) => matchesTerm(normalized, term));
}

export function inferPromptVariationDomain(prompt: string): PromptVariationDomain | null {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("mechanical") || normalized.includes("ritual")) {
    return "MECHANICAL_RITUAL_STAGING";
  }
  if (normalized.includes("formation") || normalized.includes("reveal") || normalized.includes("orbit")) {
    return "DRONE_FORMATION_REVEAL";
  }
  if (normalized.includes("pulse") || normalized.includes("light") || normalized.includes("reflection")) {
    return "ENVIRONMENTAL_PULSE_REACTION";
  }
  if (normalized.includes("beacon") || normalized.includes("chamber") || normalized.includes("drone") || normalized.includes("fog")) {
    return "SCI_FI_BEACON_CHAMBER";
  }
  return null;
}

export function classifyPromptSafety(prompt: string): PromptSafetyResult {
  const blockedTerms = findMatchedTerms(prompt, PROMPT_SAFETY_BLOCKED_TERMS);
  const approvedTerms = findMatchedTerms(prompt, PROMPT_SAFETY_APPROVED_TERMS);
  const approvedDomain = inferPromptVariationDomain(prompt);
  const reasons: string[] = [];

  if (blockedTerms.length > 0) {
    reasons.push(`Blocked terms detected: ${blockedTerms.join(", ")}.`);
  }
  if (approvedTerms.length === 0) {
    reasons.push("Prompt is outside the approved cinematic prompt domain for Phase 1.");
  }
  if (!approvedDomain) {
    reasons.push("Prompt does not resolve to an approved prompt variation domain.");
  }

  return {
    status: blockedTerms.length === 0 && approvedTerms.length > 0 && approvedDomain ? "APPROVED" : "REJECTED",
    reasons,
    blockedTerms,
    approvedTerms,
    approvedDomain,
  };
}