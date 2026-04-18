import type { FreeAnalysisResponse } from "@/lib/aie/types";
import { attachDryRunActionProposal } from "@/lib/aie/executionBridge";

function normalizeLine(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeList(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) {
    return fallback;
  }

  const cleaned = values
    .map((entry) => normalizeLine(entry))
    .filter(Boolean)
    .slice(0, 5);

  return cleaned.length > 0 ? cleaned : fallback;
}

export function formatFreeAnalysis(payload: unknown): FreeAnalysisResponse {
  const source = (payload ?? {}) as Record<string, unknown>;

  return attachDryRunActionProposal({
    what_happened:
      normalizeLine(source.what_happened) ||
      "AI-E found enough signal to outline the issue, but the root cause needs a closer look.",
    what_matters: normalizeList(source.what_matters, [
      "The issue description contains enough signal to identify a likely failure area.",
      "A focused validation pass should happen before any broad refactor or retry.",
      "The next steps are ordered to reduce guesswork and isolate the blocker quickly.",
    ]),
    what_to_do_next: normalizeList(source.what_to_do_next, [
      "Reproduce the issue with the smallest scene or prefab setup that still fails.",
      "Check the first high-signal dependency, reference, or import mentioned in the error.",
      "Validate one bounded fix before changing adjacent systems.",
    ]),
    upgrade_hint:
      normalizeLine(source.upgrade_hint) ||
      "Upgrade for guided workflows, richer follow-up, and saved debugging history.",
    actionType: normalizeLine(source.actionType) || undefined,
    proposedAction: normalizeLine(source.proposedAction) || undefined,
    expectedOutcome: normalizeLine(source.expectedOutcome) || undefined,
  });
}