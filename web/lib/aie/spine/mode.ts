import type { ChatMode } from "./types";

export function isLlmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function isDemoForced(): boolean {
  const raw = (process.env.AIE_FORCE_DEMO ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function resolveChatMode(): ChatMode {
  if (isDemoForced() || !isLlmConfigured()) {
    return "demo";
  }
  return "live";
}

export function defaultReasoningModel(): string {
  return process.env.AIE_REASONING_MODEL?.trim() || "gpt-4o-mini";
}
