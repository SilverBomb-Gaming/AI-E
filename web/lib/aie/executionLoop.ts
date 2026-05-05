import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { autoRecordOutcomeForFeature } from "./autoOutcomeRecording";
import {
  buildAutoRetryTask,
  buildRetrySuggestionFromRecords,
  type AutoRetryTask,
} from "./retryEngine";
import {
  readOutcomeRecords,
  type OutcomeRecord,
  type OutcomeResult,
} from "./outcomeLearning";

export type ExecutionLoopState = {
  feature: string;
  iteration: number;
  maxIterations: number;
  lastResult: "pass" | "fail" | "partial";
  active: boolean;
};

export type ExecutionLoopIterationAction = "retry" | "stop";

export type ExecutionLoopIteration = {
  iteration: number;
  result: OutcomeResult;
  action: ExecutionLoopIterationAction;
  adjustment?: string;
  reason: string;
  task?: AutoRetryTask;
  simulated: boolean;
};

export type ExecutionLoopRecord = {
  id: string;
  timestamp: string;
  projectPath: string;
  feature: string;
  dryRun: true;
  iterations: number;
  outcomes: OutcomeResult[];
  adjustmentsUsed: string[];
  finalAction: ExecutionLoopIterationAction;
};

export type AutonomousExecutionLoopResult = {
  status: "completed" | "blocked";
  projectPath: string;
  feature?: string;
  dryRun: true;
  state?: ExecutionLoopState;
  iterations: ExecutionLoopIteration[];
  reason?: string;
  logPath?: string;
};

const LOOP_DIRECTORY = ".aie";
const LOOP_LOG_FILE = "loops.jsonl";
const MAX_LOOP_ITERATIONS = 3;

function getLoopLogPath(projectPath: string): string {
  return path.join(projectPath, LOOP_DIRECTORY, LOOP_LOG_FILE);
}

function normalizeFeatureKey(feature: string): string {
  return feature.trim().toLowerCase();
}

function normalizeList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

function parseLoopRecord(rawLine: string): ExecutionLoopRecord | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as Partial<ExecutionLoopRecord>;
  return {
    id: typeof parsed.id === "string" ? parsed.id : "",
    timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
    projectPath: typeof parsed.projectPath === "string" ? parsed.projectPath : "",
    feature: typeof parsed.feature === "string" ? parsed.feature : "",
    dryRun: true,
    iterations: typeof parsed.iterations === "number" ? parsed.iterations : 0,
    outcomes: (parsed.outcomes ?? []).filter((value): value is OutcomeResult => value === "pass" || value === "fail" || value === "partial"),
    adjustmentsUsed: normalizeList(parsed.adjustmentsUsed),
    finalAction: parsed.finalAction === "retry" ? "retry" : "stop",
  };
}

export async function readExecutionLoopRecords(projectPath: string): Promise<ExecutionLoopRecord[]> {
  const logPath = getLoopLogPath(projectPath);

  try {
    const source = await readFile(logPath, "utf-8");
    return source
      .split(/\r?\n/)
      .map((line) => parseLoopRecord(line))
      .filter((record): record is ExecutionLoopRecord => record !== null);
  } catch (error) {
    const readError = error as NodeJS.ErrnoException;
    if (readError.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function recordExecutionLoopSummary(projectPath: string, summary: Omit<ExecutionLoopRecord, "id" | "timestamp" | "projectPath">): Promise<ExecutionLoopRecord> {
  const outputDirectory = path.join(projectPath, LOOP_DIRECTORY);
  const logPath = getLoopLogPath(projectPath);
  await mkdir(outputDirectory, { recursive: true });

  const record: ExecutionLoopRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    projectPath,
    feature: summary.feature,
    dryRun: true,
    iterations: summary.iterations,
    outcomes: summary.outcomes,
    adjustmentsUsed: summary.adjustmentsUsed,
    finalAction: summary.finalAction,
  };

  await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf-8");
  return record;
}

function buildSyntheticOutcomeRecord(feature: string, result: OutcomeResult, adjustment: string, retryCount: number): OutcomeRecord {
  return {
    id: `synthetic-${retryCount}-${normalizeFeatureKey(feature)}`,
    timestamp: new Date().toISOString(),
    projectPath: "",
    feature,
    action: adjustment,
    result,
    userObservation: `dry-run simulated ${result} after ${adjustment}`,
    consoleSignals: [],
    filesChanged: [],
    rollbackUsed: false,
    evaluationSource: "runtime-auto",
    retryCount,
    gameplayEvents: result === "partial" ? ["dry-run gameplay follow-up required"] : [],
    errors: result === "fail" ? ["dry-run runtime issue persists"] : [],
    learnedPattern: `Dry-run ${feature} ${result} using ${adjustment}`,
  };
}

function getFeatureLoopHistory(loopRecords: ExecutionLoopRecord[], feature: string): ExecutionLoopRecord[] {
  const normalizedFeature = normalizeFeatureKey(feature);
  return loopRecords.filter((record) => normalizeFeatureKey(record.feature) === normalizedFeature);
}

export function selectLoopAdjustment(feature: string, baseAdjustment: string | undefined, loopRecords: ExecutionLoopRecord[], attemptedAdjustments: string[]): string | undefined {
  if (!baseAdjustment) {
    return undefined;
  }

  const featureHistory = getFeatureLoopHistory(loopRecords, feature);
  const successfulAdjustments = featureHistory
    .filter((record) => record.outcomes.at(-1) === "pass")
    .flatMap((record) => record.adjustmentsUsed)
    .filter((adjustment, index, values) => values.indexOf(adjustment) === index);
  const failedAdjustments = featureHistory
    .flatMap((record) => record.outcomes.at(-1) === "fail" ? record.adjustmentsUsed : [])
    .filter((adjustment, index, values) => values.indexOf(adjustment) === index);

  const untriedSuccessfulAdjustment = successfulAdjustments.find((adjustment) => !attemptedAdjustments.includes(adjustment));
  if (untriedSuccessfulAdjustment) {
    return untriedSuccessfulAdjustment;
  }

  if (attemptedAdjustments.includes(baseAdjustment) || failedAdjustments.includes(baseAdjustment)) {
    return "Change implementation approach";
  }

  return baseAdjustment;
}

function predictNextResult(currentResult: OutcomeResult, adjustment: string | undefined): OutcomeResult {
  if (!adjustment) {
    return currentResult;
  }

  if (adjustment === "Fix runtime errors before retry") {
    return currentResult === "fail" ? "partial" : "pass";
  }

  if (adjustment === "Refine feature behavior, not structure") {
    return "pass";
  }

  if (adjustment === "Change implementation approach") {
    return currentResult === "fail" ? "partial" : "pass";
  }

  if (adjustment === "Retry with a smaller guarded change") {
    return "partial";
  }

  return currentResult === "partial" ? "pass" : "partial";
}

function resolveLoopFeature(feature: string | undefined, records: OutcomeRecord[]): string | undefined {
  const normalizedFeature = feature?.trim();
  if (normalizedFeature) {
    return normalizedFeature;
  }

  return records.at(-1)?.feature;
}

async function resolveRuntimeLogPath(projectPath: string, runtimeLogPath?: string): Promise<string | undefined> {
  if (runtimeLogPath) {
    return runtimeLogPath;
  }

  const localEditorLogPath = path.join(projectPath, "Editor.log");

  try {
    const details = await stat(localEditorLogPath);
    return details.isFile() ? localEditorLogPath : undefined;
  } catch {
    return undefined;
  }
}

export async function runAutonomousExecutionLoop(projectPath: string, feature?: string, runtimeLogPath?: string): Promise<AutonomousExecutionLoopResult> {
  const existingOutcomeRecords = await readOutcomeRecords(projectPath);
  const resolvedFeature = resolveLoopFeature(feature, existingOutcomeRecords);

  if (!resolvedFeature) {
    return {
      status: "blocked",
      projectPath,
      dryRun: true,
      iterations: [],
      reason: "A feature is required for the autonomous loop. Provide --feature or record at least one outcome first.",
    };
  }

  const loopRecords = await readExecutionLoopRecords(projectPath);
  const selectedRuntimeLogPath = await resolveRuntimeLogPath(projectPath, runtimeLogPath);
  const autoRecorded = await autoRecordOutcomeForFeature(projectPath, resolvedFeature, selectedRuntimeLogPath);

  if (autoRecorded.status === "blocked") {
    return {
      status: "blocked",
      projectPath,
      feature: resolvedFeature,
      dryRun: true,
      iterations: [],
      reason: autoRecorded.reason,
    };
  }

  const featureRecords = (await readOutcomeRecords(projectPath)).filter((record) => normalizeFeatureKey(record.feature) === normalizeFeatureKey(resolvedFeature));
  const iterations: ExecutionLoopIteration[] = [];
  const adjustmentsUsed: string[] = [];
  let simulatedRecords = [...featureRecords];
  let currentResult = autoRecorded.evaluation.parsedResult.inferredResult;
  let state: ExecutionLoopState = {
    feature: resolvedFeature,
    iteration: 1,
    maxIterations: MAX_LOOP_ITERATIONS,
    lastResult: currentResult,
    active: true,
  };

  while (state.active) {
    const suggestion = buildRetrySuggestionFromRecords(projectPath, simulatedRecords);
    const baseAdjustment = suggestion.decision?.strategyAdjustment;
    const chosenAdjustment = selectLoopAdjustment(resolvedFeature, baseAdjustment, loopRecords, adjustmentsUsed);
    const task = suggestion.decision?.retryRecommended
      ? buildAutoRetryTask({
        ...suggestion,
        decision: suggestion.decision
          ? {
            ...suggestion.decision,
            strategyAdjustment: chosenAdjustment,
          }
          : undefined,
      })
      : undefined;

    const shouldStop = currentResult === "pass"
      || !suggestion.decision?.retryRecommended
      || state.iteration >= state.maxIterations;
    const action: ExecutionLoopIterationAction = shouldStop ? "stop" : "retry";

    iterations.push({
      iteration: state.iteration,
      result: currentResult,
      action,
      adjustment: action === "retry" ? chosenAdjustment : undefined,
      reason: suggestion.decision?.reason ?? suggestion.reason,
      task,
      simulated: state.iteration > 1,
    });

    if (action === "stop") {
      state = {
        ...state,
        lastResult: currentResult,
        active: false,
      };
      break;
    }

    if (chosenAdjustment) {
      adjustmentsUsed.push(chosenAdjustment);
    }

    currentResult = predictNextResult(currentResult, chosenAdjustment);
    simulatedRecords = [
      ...simulatedRecords,
      buildSyntheticOutcomeRecord(resolvedFeature, currentResult, chosenAdjustment ?? "Retry with guarded follow-up validation", state.iteration + 1),
    ];

    state = {
      ...state,
      iteration: state.iteration + 1,
      lastResult: currentResult,
      active: state.iteration + 1 <= state.maxIterations,
    };
  }

  await recordExecutionLoopSummary(projectPath, {
    feature: resolvedFeature,
    dryRun: true,
    iterations: iterations.length,
    outcomes: iterations.map((iteration) => iteration.result),
    adjustmentsUsed,
    finalAction: iterations.at(-1)?.action ?? "stop",
  });

  return {
    status: "completed",
    projectPath,
    feature: resolvedFeature,
    dryRun: true,
    state,
    iterations,
    logPath: getLoopLogPath(projectPath),
  };
}

export function renderAutonomousExecutionLoop(result: AutonomousExecutionLoopResult): string {
  if (result.status === "blocked") {
    return [
      "AUTONOMOUS LOOP BLOCKED",
      `Reason: ${result.reason}`,
    ].join("\n");
  }

  const lines = [
    "AUTONOMOUS LOOP",
    "",
    `Feature: ${result.feature}`,
    "DRY-RUN ONLY (v1)",
  ];

  for (const iteration of result.iterations) {
    lines.push(
      "",
      `Iteration: ${iteration.iteration}`,
      `Result: ${iteration.result}`,
      `Action: ${iteration.action}`,
    );

    if (iteration.adjustment) {
      lines.push(`Adjustment: ${iteration.adjustment}`);
    }
  }

  lines.push("", `Loop Log: ${result.logPath ?? "n/a"}`);
  return lines.join("\n");
}
