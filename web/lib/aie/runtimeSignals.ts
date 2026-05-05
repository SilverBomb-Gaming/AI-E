import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type RuntimeSignal = {
  timestamp: string;
  type: "info" | "warning" | "error" | "gameplay";
  message: string;
};

export type ParsedRuntimeResult = {
  errors: string[];
  warnings: string[];
  gameplayEvents: string[];
  inferredResult: "pass" | "fail" | "partial";
};

export type AutoEvaluationResult = {
  projectPath: string;
  logPath: string;
  signals: RuntimeSignal[];
  parsedResult: ParsedRuntimeResult;
  reason: string[];
};

const GAMEPLAY_PATTERNS = [
  "enemy hit",
  "enemy defeated",
  "attack missed",
];

function extractTimestamp(line: string): string {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+|\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\])/);
  return match?.[1] ?? "";
}

function classifySignal(line: string): RuntimeSignal["type"] {
  const normalized = line.toLowerCase();

  if (/exception/i.test(line) || /\berror\b/i.test(line)) {
    return "error";
  }

  if (/\bwarning\b/i.test(line)) {
    return "warning";
  }

  if (GAMEPLAY_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return "gameplay";
  }

  return "info";
}

export function getDefaultUnityPlayerLogPath(): string {
  return path.join(
    os.homedir(),
    "AppData",
    "LocalLow",
    "DefaultCompany",
    "EnemyAIDemoStandalone",
    "Player.log",
  );
}

export async function readUnityRuntimeLog(overrideLogPath?: string): Promise<{ logPath: string; content: string; }> {
  const logPath = overrideLogPath?.trim() || getDefaultUnityPlayerLogPath();

  try {
    const content = await readFile(logPath, "utf-8");
    return { logPath, content };
  } catch (error) {
    const readError = error as NodeJS.ErrnoException;
    if (readError.code === "ENOENT") {
      throw new Error(`Unity runtime log not found at ${logPath}. Run a local Unity playtest first or use --runtime-log to supply an override path.`);
    }
    throw error;
  }
}

export function parseRuntimeSignals(content: string): RuntimeSignal[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({
      timestamp: extractTimestamp(line),
      type: classifySignal(line),
      message: line,
    }));
}

export function inferRuntimeResult(signals: RuntimeSignal[]): ParsedRuntimeResult {
  const errors = signals.filter((signal) => signal.type === "error").map((signal) => signal.message);
  const warnings = signals.filter((signal) => signal.type === "warning").map((signal) => signal.message);
  const gameplayEvents = signals.filter((signal) => signal.type === "gameplay").map((signal) => signal.message);
  const hasErrors = errors.length > 0;
  const hasGameplayEvents = gameplayEvents.length > 0;

  let inferredResult: ParsedRuntimeResult["inferredResult"] = "partial";
  if (hasErrors && hasGameplayEvents) {
    inferredResult = "partial";
  } else if (hasErrors) {
    inferredResult = "fail";
  } else if (hasGameplayEvents) {
    inferredResult = "pass";
  }

  return {
    errors,
    warnings,
    gameplayEvents,
    inferredResult,
  };
}

export function buildRuntimeEvaluationReason(parsedResult: ParsedRuntimeResult): string[] {
  const reason: string[] = [];
  const uniqueGameplayEvents = [...new Set(parsedResult.gameplayEvents)];

  if (parsedResult.errors.length > 0 && parsedResult.gameplayEvents.length > 0) {
    reason.push("detected gameplay events alongside runtime errors");
  }

  uniqueGameplayEvents.slice(0, 3).forEach((event) => {
    reason.push(`detected \"${event}\"`);
  });

  if (parsedResult.errors.length === 0) {
    reason.push("no runtime errors");
  } else {
    reason.push(`runtime errors detected: ${parsedResult.errors.length}`);
  }

  if (parsedResult.warnings.length > 0) {
    reason.push(`warnings detected: ${parsedResult.warnings.length}`);
  }

  if (reason.length === 0) {
    reason.push("no recognized gameplay events or runtime errors were detected");
  }

  return reason;
}

export async function autoEvaluateUnityRuntime(projectPath: string, overrideLogPath?: string): Promise<AutoEvaluationResult> {
  const { logPath, content } = await readUnityRuntimeLog(overrideLogPath);
  const signals = parseRuntimeSignals(content);
  const parsedResult = inferRuntimeResult(signals);

  return {
    projectPath,
    logPath,
    signals,
    parsedResult,
    reason: buildRuntimeEvaluationReason(parsedResult),
  };
}

export function buildAutoOutcomeObservation(result: AutoEvaluationResult): string {
  return result.reason.join("; ");
}

export function renderAutoEvaluation(result: AutoEvaluationResult): string {
  return [
    "AUTO EVALUATION",
    "",
    `Project: ${result.projectPath}`,
    `Log Path: ${result.logPath}`,
    `Errors: ${result.parsedResult.errors.length}`,
    `Gameplay Events: ${result.parsedResult.gameplayEvents.length}`,
    `Result: ${result.parsedResult.inferredResult}`,
    "Reason:",
    ...result.reason.map((reason) => `- ${reason}`),
  ].join("\n");
}