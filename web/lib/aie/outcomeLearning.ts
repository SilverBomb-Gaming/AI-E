import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type OutcomeResult = "pass" | "fail" | "partial";

export type OutcomeEvaluationSource = "manual" | "runtime-auto";

export type OutcomeRecord = {
  id: string;
  timestamp: string;
  projectPath: string;
  feature: string;
  action: string;
  result: OutcomeResult;
  userObservation: string;
  consoleSignals: string[];
  filesChanged: string[];
  rollbackUsed: boolean;
  evaluationSource: OutcomeEvaluationSource;
  sessionKey?: string;
  sessionMode?: string;
  selectedLogPath?: string;
  evaluatedLineCount?: number;
  inferredResult?: OutcomeResult;
  gameplayEvents?: string[];
  errors?: string[];
  learnedPattern?: string;
};

export type OutcomeSummary = {
  projectPath: string;
  logPath: string;
  totalOutcomes: number;
  passCount: number;
  failCount: number;
  partialCount: number;
  rollbackCount: number;
  rollbackFrequency: number;
  runtimeAutoCount: number;
  manualCount: number;
  latestRuntimeAutoPattern: string | null;
  latestSuccessfulPatterns: string[];
  latestFailurePatterns: string[];
};

export type RecordOutcomeInput = {
  feature: string;
  action?: string;
  result: OutcomeResult;
  observation: string;
  consoleSignals?: string[];
  filesChanged?: string[];
  rollbackUsed?: boolean;
  timestamp?: string;
  evaluationSource?: OutcomeEvaluationSource;
  sessionKey?: string;
  sessionMode?: string;
  selectedLogPath?: string;
  evaluatedLineCount?: number;
  inferredResult?: OutcomeResult;
  gameplayEvents?: string[];
  errors?: string[];
};

export type RecordOutcomeResult = {
  record: OutcomeRecord;
  logPath: string;
  duplicate: boolean;
};

const OUTCOME_DIRECTORY = ".aie";
const OUTCOME_LOG_FILE = "outcomes.jsonl";
const DEFAULT_ACTION = "operator-recorded playtest validation";

function getOutcomeLogPath(projectPath: string): string {
  return path.join(projectPath, OUTCOME_DIRECTORY, OUTCOME_LOG_FILE);
}

function normalizeList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

export function buildOutcomeSessionKey(input: {
  feature: string;
  selectedLogPath: string;
  sessionStartMarker: string;
  evaluatedLineCount: number;
}): string {
  return [
    input.feature.trim().toLowerCase(),
    path.normalize(input.selectedLogPath.trim()).toLowerCase(),
    input.sessionStartMarker.trim(),
    String(input.evaluatedLineCount),
  ].join("|");
}

export function buildLearnedPattern(feature: string, action: string, result: OutcomeResult, observation: string): string {
  if (result === "pass") {
    return `Feature ${feature} worked with approach ${action}`;
  }

  if (result === "fail") {
    return `Feature ${feature} failed because observation ${observation}`;
  }

  return `Feature ${feature} partially worked; needs follow-up`;
}

export function serializeOutcomeRecord(record: OutcomeRecord): string {
  return JSON.stringify(record);
}

function parseOutcomeRecord(rawLine: string): OutcomeRecord | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as Partial<OutcomeRecord>;
  return {
    id: parsed.id ?? "",
    timestamp: parsed.timestamp ?? "",
    projectPath: parsed.projectPath ?? "",
    feature: parsed.feature ?? "",
    action: parsed.action ?? DEFAULT_ACTION,
    result: parsed.result ?? "partial",
    userObservation: parsed.userObservation ?? "",
    consoleSignals: normalizeList(parsed.consoleSignals),
    filesChanged: normalizeList(parsed.filesChanged),
    rollbackUsed: parsed.rollbackUsed ?? false,
    evaluationSource: parsed.evaluationSource === "runtime-auto" ? "runtime-auto" : "manual",
    sessionKey: typeof parsed.sessionKey === "string" ? parsed.sessionKey : undefined,
    sessionMode: typeof parsed.sessionMode === "string" ? parsed.sessionMode : undefined,
    selectedLogPath: typeof parsed.selectedLogPath === "string" ? parsed.selectedLogPath : undefined,
    evaluatedLineCount: typeof parsed.evaluatedLineCount === "number" ? parsed.evaluatedLineCount : undefined,
    inferredResult: parsed.inferredResult === "pass" || parsed.inferredResult === "fail" || parsed.inferredResult === "partial"
      ? parsed.inferredResult
      : undefined,
    gameplayEvents: normalizeList(parsed.gameplayEvents),
    errors: normalizeList(parsed.errors),
    learnedPattern: parsed.learnedPattern,
  };
}

export async function readOutcomeRecords(projectPath: string): Promise<OutcomeRecord[]> {
  const logPath = getOutcomeLogPath(projectPath);

  try {
    const source = await readFile(logPath, "utf-8");
    return source
      .split(/\r?\n/)
      .map((line) => parseOutcomeRecord(line))
      .filter((record): record is OutcomeRecord => record !== null);
  } catch (error) {
    const readError = error as NodeJS.ErrnoException;
    if (readError.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function recordOutcome(projectPath: string, input: RecordOutcomeInput): Promise<RecordOutcomeResult> {
  const outputDirectory = path.join(projectPath, OUTCOME_DIRECTORY);
  const logPath = getOutcomeLogPath(projectPath);
  const action = input.action?.trim() || DEFAULT_ACTION;
  const observation = input.observation.trim();

  await mkdir(outputDirectory, { recursive: true });

  const existingRecords = await readOutcomeRecords(projectPath);
  const normalizedSessionKey = input.sessionKey?.trim() || undefined;
  const duplicateRecord = normalizedSessionKey
    ? existingRecords.find((record) => record.sessionKey === normalizedSessionKey)
    : undefined;

  if (duplicateRecord) {
    return {
      record: duplicateRecord,
      logPath,
      duplicate: true,
    };
  }

  const record: OutcomeRecord = {
    id: randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    projectPath,
    feature: input.feature.trim(),
    action,
    result: input.result,
    userObservation: observation,
    consoleSignals: normalizeList(input.consoleSignals),
    filesChanged: normalizeList(input.filesChanged),
    rollbackUsed: input.rollbackUsed ?? false,
    evaluationSource: input.evaluationSource ?? "manual",
    sessionKey: normalizedSessionKey,
    sessionMode: input.sessionMode?.trim() || undefined,
    selectedLogPath: input.selectedLogPath?.trim() || undefined,
    evaluatedLineCount: typeof input.evaluatedLineCount === "number" ? input.evaluatedLineCount : undefined,
    inferredResult: input.inferredResult,
    gameplayEvents: normalizeList(input.gameplayEvents),
    errors: normalizeList(input.errors),
    learnedPattern: buildLearnedPattern(input.feature.trim(), action, input.result, observation),
  };

  await appendFile(logPath, `${serializeOutcomeRecord(record)}\n`, "utf-8");
  return { record, logPath, duplicate: false };
}

export async function summarizeOutcomeLearning(projectPath: string): Promise<OutcomeSummary> {
  const records = await readOutcomeRecords(projectPath);
  const passRecords = records.filter((record) => record.result === "pass");
  const failRecords = records.filter((record) => record.result === "fail");
  const partialRecords = records.filter((record) => record.result === "partial");
  const rollbackCount = records.filter((record) => record.rollbackUsed).length;
  const runtimeAutoRecords = records.filter((record) => record.evaluationSource === "runtime-auto");
  const manualRecords = records.filter((record) => record.evaluationSource === "manual");

  return {
    projectPath,
    logPath: getOutcomeLogPath(projectPath),
    totalOutcomes: records.length,
    passCount: passRecords.length,
    failCount: failRecords.length,
    partialCount: partialRecords.length,
    rollbackCount,
    rollbackFrequency: records.length === 0 ? 0 : rollbackCount / records.length,
    runtimeAutoCount: runtimeAutoRecords.length,
    manualCount: manualRecords.length,
    latestRuntimeAutoPattern: runtimeAutoRecords.slice(-1)[0]?.learnedPattern ?? null,
    latestSuccessfulPatterns: passRecords.slice(-3).reverse().map((record) => record.learnedPattern ?? "").filter((pattern) => pattern.length > 0),
    latestFailurePatterns: failRecords.slice(-3).reverse().map((record) => record.learnedPattern ?? "").filter((pattern) => pattern.length > 0),
  };
}

export function renderOutcomeRecord(result: RecordOutcomeResult): string {
  return [
    "OUTCOME RECORDED",
    "",
    `Project: ${result.record.projectPath}`,
    `Log Path: ${result.logPath}`,
    `Outcome ID: ${result.record.id}`,
    `Feature: ${result.record.feature}`,
    `Action: ${result.record.action}`,
    `Result: ${result.record.result}`,
    `Source: ${result.record.evaluationSource}`,
    `Session Key: ${result.record.sessionKey ?? "n/a"}`,
    `Session Mode: ${result.record.sessionMode ?? "n/a"}`,
    `Selected Log: ${result.record.selectedLogPath ?? "n/a"}`,
    `Evaluated Lines: ${typeof result.record.evaluatedLineCount === "number" ? result.record.evaluatedLineCount : "n/a"}`,
    `Inferred Result: ${result.record.inferredResult ?? "n/a"}`,
    `Errors: ${result.record.errors?.length ?? 0}`,
    `Gameplay Events: ${result.record.gameplayEvents?.length ?? 0}`,
    `Observation: ${result.record.userObservation}`,
    `Rollback Used: ${result.record.rollbackUsed ? "YES" : "NO"}`,
    `Learned Pattern: ${result.record.learnedPattern ?? "none"}`,
  ].join("\n");
}

export function renderOutcomeSummary(summary: OutcomeSummary): string {
  const rollbackPercent = summary.totalOutcomes === 0
    ? "0.0%"
    : `${(summary.rollbackFrequency * 100).toFixed(1)}%`;

  return [
    "OUTCOME LEARNING SUMMARY",
    "",
    `Project: ${summary.projectPath}`,
    `Log Path: ${summary.logPath}`,
    `Total Outcomes: ${summary.totalOutcomes}`,
    `Pass Count: ${summary.passCount}`,
    `Fail Count: ${summary.failCount}`,
    `Partial Count: ${summary.partialCount}`,
    `Runtime-Auto Count: ${summary.runtimeAutoCount}`,
    `Manual Count: ${summary.manualCount}`,
    `Rollback Frequency: ${rollbackPercent} (${summary.rollbackCount}/${summary.totalOutcomes})`,
    `Latest Runtime-Auto Pattern: ${summary.latestRuntimeAutoPattern ?? "none"}`,
    "",
    "Latest Successful Patterns:",
    ...(summary.latestSuccessfulPatterns.length > 0 ? summary.latestSuccessfulPatterns.map((pattern, index) => `${index + 1}. ${pattern}`) : ["1. None recorded yet."]),
    "",
    "Latest Failure Patterns:",
    ...(summary.latestFailurePatterns.length > 0 ? summary.latestFailurePatterns.map((pattern, index) => `${index + 1}. ${pattern}`) : ["1. None recorded yet."]),
  ].join("\n");
}