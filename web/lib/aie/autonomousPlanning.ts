import path from "node:path";

import type { AutonomousSession } from "./autonomousSession";
import {
  clusterPaths,
  detectEntryPoints,
  findRelevantFiles,
  summarizeDirectoryStructure,
} from "./repoContext";

export type AutonomousActionFamily = "write" | "test" | "validate" | "inspect" | "other";

export type AutonomousPlanningHints = {
  recentActionSummary: string;
  preferredNextActionFamily: AutonomousActionFamily;
  recentActionFamily: AutonomousActionFamily;
  shouldAvoidBroadShift: boolean;
  recentChangeClusters: string[];
  likelyImpactZones: string[];
  relatedTestFiles: string[];
  entryPoints: string[];
  repoContextSummary: string;
  hintSummary: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimSentence(value: string, maxLength = 140): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3).trim()}...` : value;
}

export function inferActionFamily(actionText: string): AutonomousActionFamily {
  const normalized = actionText.toLowerCase();
  if (/\b(write|create|update|patch|modify|edit)\b/.test(normalized)) {
    return "write";
  }
  if (/\b(test|build|trace|npm)\b/.test(normalized)) {
    return "test";
  }
  if (/\b(validate|validation|verify|verification|confirm)\b/.test(normalized)) {
    return "validate";
  }
  if (/\b(inspect|review|check|observe|read)\b/.test(normalized)) {
    return "inspect";
  }

  return "other";
}

export function buildRecentActionSummary(session: AutonomousSession, limit = 4): string {
  const recentSteps = session.steps.slice(-Math.max(1, limit));

  if (!recentSteps.length) {
    return "No prior autonomous steps are available yet.";
  }

  return recentSteps
    .map((step) => {
      const family = step.actionFamily ?? inferActionFamily(normalizeText(step.proposedAction));
      const outcome = normalizeText(step.executionResult?.output) || normalizeText(step.executionResult?.error) || "no recorded output";
      return `${family}:${trimSentence(outcome, 96)}`;
    })
    .join(" | ");
}

export function choosePreferredNextActionFamily(session: AutonomousSession): AutonomousActionFamily {
  const lastStep = session.steps.at(-1);
  const lastFamily = lastStep?.actionFamily ?? inferActionFamily(normalizeText(lastStep?.proposedAction));
  const changedPaths = lastStep?.executionResult?.changedPaths ?? [];
  const recentFailures = session.steps.slice(-2).filter((step) => step.executionResult?.status === "failed").length;

  if (lastFamily === "write" && changedPaths.length) {
    return "test";
  }

  if (lastFamily === "test" && lastStep?.executionResult?.status === "success") {
    return "validate";
  }

  if (recentFailures >= 2) {
    return "inspect";
  }

  if (lastFamily === "inspect") {
    return "validate";
  }

  return lastFamily === "other" ? "inspect" : lastFamily;
}

export function detectOverlyBroadPlanShift(
  session: AutonomousSession,
  nextActionText: string | null | undefined,
): boolean {
  const priorSteps = session.steps.slice(-2);
  if (!priorSteps.length) {
    return false;
  }

  const nextFamily = inferActionFamily(normalizeText(nextActionText));
  const recentFamily = priorSteps.at(-1)?.actionFamily ?? inferActionFamily(normalizeText(priorSteps.at(-1)?.proposedAction));
  const recentFailures = priorSteps.filter((step) => step.executionResult?.status === "failed" || step.nextDecision === "reroute").length;
  const recentChangedPaths = priorSteps.flatMap((step) => step.executionResult?.changedPaths ?? []);

  if (recentFailures === 0) {
    return false;
  }

  if (recentChangedPaths.length && recentFamily === "write" && nextFamily !== "test" && nextFamily !== "validate") {
    return true;
  }

  return recentFamily !== "other" && nextFamily !== recentFamily && nextFamily !== "inspect";
}

export function derivePlanningHintsFromSession(
  session: AutonomousSession,
  nextActionText?: string | null,
): AutonomousPlanningHints {
  const recentActionSummary = buildRecentActionSummary(session);
  const recentActionFamily = session.steps.length
    ? session.steps.at(-1)?.actionFamily ?? inferActionFamily(normalizeText(session.steps.at(-1)?.proposedAction))
    : "other";
  const preferredNextActionFamily = choosePreferredNextActionFamily(session);
  const shouldAvoidBroadShift = detectOverlyBroadPlanShift(session, nextActionText);

  return {
    recentActionSummary,
    recentActionFamily,
    preferredNextActionFamily,
    shouldAvoidBroadShift,
    recentChangeClusters: [],
    likelyImpactZones: [],
    relatedTestFiles: [],
    entryPoints: [],
    repoContextSummary: "",
    hintSummary: [
      `Recent lane summary: ${recentActionSummary}`,
      `Preferred next lane: ${preferredNextActionFamily}`,
      shouldAvoidBroadShift
        ? "Avoid broad subsystem switching until the current lane is validated."
        : "Finish the current lane before broadening scope.",
    ].join(" "),
  };
}

function extractLikelyImpactZones(relevantFiles: Awaited<ReturnType<typeof findRelevantFiles>>): string[] {
  return [...new Set(
    relevantFiles
      .map((file) => path.posix.dirname(file.path))
      .filter((directory) => directory && directory !== ".")
  )].slice(0, 4);
}

export async function deriveRepoAwarePlanningHintsFromSession(
  session: AutonomousSession,
  options?: {
    nextActionText?: string | null;
    repoRoot?: string;
    goal?: string;
  },
): Promise<AutonomousPlanningHints> {
  const baseHints = derivePlanningHintsFromSession(session, options?.nextActionText);
  const repoRoot = options?.repoRoot;

  if (!repoRoot) {
    return baseHints;
  }

  const recentChangedPaths = session.steps.flatMap((step) => step.executionResult?.changedPaths ?? []);
  const relevantFiles = await findRelevantFiles(options?.goal ?? options?.nextActionText ?? session.goal, repoRoot, {
    recentChangedPaths,
  });
  const directorySummary = await summarizeDirectoryStructure(repoRoot);
  const likelyImpactZones = extractLikelyImpactZones(relevantFiles);
  const relatedTestFiles = [...new Set(relevantFiles.flatMap((file) => file.pairedTestFiles))].slice(0, 4);
  const recentChangeClusters = clusterPaths(recentChangedPaths);
  const entryPoints = await detectEntryPoints(repoRoot);

  const repoSummaryParts = [
    directorySummary.summary,
    likelyImpactZones.length ? `Likely impact zones: ${likelyImpactZones.join(", ")}.` : "",
    relatedTestFiles.length ? `Related tests: ${relatedTestFiles.join(", ")}.` : "",
    recentChangeClusters.length ? `Recent change clusters: ${recentChangeClusters.join(", ")}.` : "",
    entryPoints.length ? `Entry points: ${entryPoints.slice(0, 4).join(", ")}.` : "",
  ].filter(Boolean);

  return {
    ...baseHints,
    recentChangeClusters,
    likelyImpactZones,
    relatedTestFiles,
    entryPoints,
    repoContextSummary: repoSummaryParts.join(" "),
    hintSummary: [
      baseHints.hintSummary,
      likelyImpactZones.length ? `Impact zones: ${likelyImpactZones.join(", ")}.` : "",
      relatedTestFiles.length ? `Pair with tests: ${relatedTestFiles.join(", ")}.` : "",
      recentChangeClusters.length ? `Change clusters: ${recentChangeClusters.join(", ")}.` : "",
    ].filter(Boolean).join(" "),
  };
}

export function buildAutonomousPlanningContext(session: AutonomousSession, limit = 4): string {
  const recentSteps = session.steps.slice(-Math.max(1, limit));
  const lines: string[] = ["Long-horizon planning memory:"];
  const planningHints = derivePlanningHintsFromSession(session);

  if (!recentSteps.length) {
    lines.push("- No prior autonomous steps are available yet.");
    return lines.join("\n");
  }

  const recentDiagnoses = recentSteps
    .map((step) => normalizeText(step.diagnosis))
    .filter(Boolean)
    .slice(-3)
    .map((item) => trimSentence(item));
  const recentActionFamilies = recentSteps.map((step) => step.actionFamily ?? inferActionFamily(normalizeText(step.proposedAction))).filter(Boolean);
  const recentRecoveries = recentSteps
    .map((step) => step.recoveryStrategy ? `${step.recoveryStrategy}${step.failureClassification ? ` after ${step.failureClassification.kind}` : ""}` : "")
    .filter(Boolean)
    .slice(-3);
  const recentChangedPaths = recentSteps.flatMap((step) => step.executionResult?.changedPaths ?? []).slice(-5);
  const recentTestOutcomes = recentSteps
    .filter((step) => {
      const family = step.actionFamily ?? inferActionFamily(normalizeText(step.proposedAction));
      return family === "test" || family === "validate";
    })
    .map((step) => `${step.executionResult?.status ?? "unknown"}: ${trimSentence(normalizeText(step.executionResult?.output) || normalizeText(step.executionResult?.error) || "no test output")}`)
    .slice(-3);

  lines.push(`- ${planningHints.hintSummary}`);

  if (recentDiagnoses.length) {
    lines.push(`- Recent diagnoses: ${recentDiagnoses.join(" | ")}`);
  }

  if (recentActionFamilies.length) {
    lines.push(`- Recent action families: ${recentActionFamilies.join(" -> ")}`);
  }

  if (recentRecoveries.length) {
    lines.push(`- Recent failures/recoveries: ${recentRecoveries.join(" | ")}`);
  }

  if (recentChangedPaths.length) {
    lines.push(`- Recent changed paths: ${recentChangedPaths.join(" | ")}`);
    lines.push("- Bias: prefer validating recently changed files before broadening scope again.");
  }

  if (recentTestOutcomes.length) {
    lines.push(`- Recent test outcomes: ${recentTestOutcomes.join(" | ")}`);
  }

  if (recentActionFamilies.at(-1) === "write") {
    lines.push("- Bias: after a write, prefer a bounded test or validation step before another write.");
  }

  if (recentRecoveries.some((item) => /reroute-analysis|narrow-scope/.test(item))) {
    lines.push("- Bias: keep scope narrow until a bounded verification step confirms forward progress.");
  }

  if (recentActionFamilies.slice(-2).every((item) => item === recentActionFamilies.at(-1))) {
    lines.push("- Bias: avoid repeating the same action family unless the latest evidence materially changed.");
  }

  if (planningHints.shouldAvoidBroadShift) {
    lines.push("- Bias: avoid broad plan shifts until the current subsystem lane has a bounded verification result.");
  }

  return lines.join("\n");
}

export async function buildRepoAwareAutonomousPlanningContext(
  session: AutonomousSession,
  options?: {
    repoRoot?: string;
    limit?: number;
  },
): Promise<string> {
  const baseContext = buildAutonomousPlanningContext(session, options?.limit);
  if (!options?.repoRoot) {
    return baseContext;
  }

  const repoAwareHints = await deriveRepoAwarePlanningHintsFromSession(session, {
    repoRoot: options.repoRoot,
    goal: session.goal,
  });
  const lines = [baseContext];

  if (repoAwareHints.repoContextSummary) {
    lines.push(`Repo-aware context:\n- ${repoAwareHints.repoContextSummary}`);
  }

  return lines.join("\n");
}