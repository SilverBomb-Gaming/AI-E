import { readdir, readFile, stat } from "node:fs/promises";
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

export type UnityLogCandidate = {
  path: string;
  exists: boolean;
  size: number;
  modifiedTime: string | null;
  kind: "editor" | "player" | "project" | "unknown";
  containsGameplaySignals: boolean;
};

export type UnityLogDiscoveryResult = {
  projectPath: string;
  candidates: UnityLogCandidate[];
  searchedPaths: string[];
  selectedPath: string | null;
};

const GAMEPLAY_PATTERNS = [
  "enemy hit",
  "enemy defeated",
  "attack missed",
  "aie",
  "enemy_ai_demo",
];

const DEFAULT_COMPANY_NAME = "DefaultCompany";
const DEFAULT_PRODUCT_NAME = "EnemyAIDemoStandalone";

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
    process.env.USERPROFILE ?? os.homedir(),
    "AppData",
    "LocalLow",
    "DefaultCompany",
    "EnemyAIDemoStandalone",
    "Player.log",
  );
}

export function getDefaultUnityEditorLogPath(): string {
  return path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
    "Unity",
    "Editor",
    "Editor.log",
  );
}

function getProjectSpecificCandidatePaths(projectPath: string): string[] {
  return [
    path.join(projectPath, "Library", "Player.log"),
    path.join(projectPath, "Library", "Editor.log"),
  ];
}

async function listLogFiles(directoryPath: string): Promise<string[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".log"))
      .map((entry) => path.join(directoryPath, entry.name));
  } catch {
    return [];
  }
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths.map((item) => path.normalize(item)))];
}

function classifyLogKind(logPath: string): UnityLogCandidate["kind"] {
  const normalized = logPath.toLowerCase();

  if (normalized.endsWith(path.join("unity", "editor", "editor.log").toLowerCase()) || normalized.endsWith("editor.log")) {
    return "editor";
  }

  if (normalized.includes(path.join("locallow", DEFAULT_COMPANY_NAME.toLowerCase(), DEFAULT_PRODUCT_NAME.toLowerCase()).toLowerCase()) || normalized.endsWith("player.log")) {
    return "player";
  }

  if (normalized.includes(path.normalize("/logs/").replace(/\\/g, path.sep).toLowerCase()) || normalized.includes(path.join("library", "logs").toLowerCase()) || normalized.includes(path.join("library", "player.log").toLowerCase()) || normalized.includes(path.join("library", "editor.log").toLowerCase())) {
    return "project";
  }

  return "unknown";
}

function contentContainsGameplaySignals(content: string): boolean {
  const normalized = content.toLowerCase();
  return GAMEPLAY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

async function buildUnityLogCandidate(candidatePath: string): Promise<UnityLogCandidate> {
  try {
    const fileStat = await stat(candidatePath);
    const content = await readFile(candidatePath, "utf-8");

    return {
      path: candidatePath,
      exists: true,
      size: fileStat.size,
      modifiedTime: fileStat.mtime.toISOString(),
      kind: classifyLogKind(candidatePath),
      containsGameplaySignals: contentContainsGameplaySignals(content),
    };
  } catch {
    return {
      path: candidatePath,
      exists: false,
      size: 0,
      modifiedTime: null,
      kind: classifyLogKind(candidatePath),
      containsGameplaySignals: false,
    };
  }
}

function sortDiscoveryCandidates(candidates: UnityLogCandidate[]): UnityLogCandidate[] {
  return [...candidates].sort((left, right) => {
    if (Number(right.exists) !== Number(left.exists)) {
      return Number(right.exists) - Number(left.exists);
    }

    if (Number(right.containsGameplaySignals) !== Number(left.containsGameplaySignals)) {
      return Number(right.containsGameplaySignals) - Number(left.containsGameplaySignals);
    }

    const rightModified = right.modifiedTime ? new Date(right.modifiedTime).getTime() : 0;
    const leftModified = left.modifiedTime ? new Date(left.modifiedTime).getTime() : 0;
    if (rightModified !== leftModified) {
      return rightModified - leftModified;
    }

    return right.path.localeCompare(left.path);
  });
}

export async function discoverUnityLogCandidates(projectPath: string): Promise<UnityLogDiscoveryResult> {
  const projectLogsDirectory = path.join(projectPath, "Logs");
  const libraryLogsDirectory = path.join(projectPath, "Library", "Logs");
  const searchedPaths = [
    getDefaultUnityEditorLogPath(),
    getDefaultUnityPlayerLogPath(),
    ...getProjectSpecificCandidatePaths(projectPath),
    path.join(projectLogsDirectory, "*.log"),
    path.join(libraryLogsDirectory, "*.log"),
  ];

  const directoryMatches = await Promise.all([
    listLogFiles(projectLogsDirectory),
    listLogFiles(libraryLogsDirectory),
  ]);
  const candidatePaths = dedupePaths([
    getDefaultUnityEditorLogPath(),
    getDefaultUnityPlayerLogPath(),
    ...getProjectSpecificCandidatePaths(projectPath),
    ...directoryMatches.flat(),
  ]);
  const candidates = await Promise.all(candidatePaths.map((candidatePath) => buildUnityLogCandidate(candidatePath)));
  const sortedCandidates = sortDiscoveryCandidates(candidates);
  const selectedPath = sortedCandidates.find((candidate) => candidate.exists)?.path ?? null;

  return {
    projectPath,
    candidates: sortedCandidates,
    searchedPaths,
    selectedPath,
  };
}

export async function findBestUnityRuntimeLog(projectPath: string): Promise<UnityLogDiscoveryResult> {
  const discovery = await discoverUnityLogCandidates(projectPath);
  const existingCandidates = discovery.candidates.filter((candidate) => candidate.exists);
  const gameplayCandidates = existingCandidates.filter((candidate) => candidate.containsGameplaySignals);
  const selectedCandidate = gameplayCandidates[0] ?? existingCandidates[0] ?? null;

  return {
    ...discovery,
    selectedPath: selectedCandidate?.path ?? null,
  };
}

export async function readUnityRuntimeLog(projectPath: string, overrideLogPath?: string): Promise<{ logPath: string; content: string; discovery?: UnityLogDiscoveryResult; }> {
  let logPath = overrideLogPath?.trim() || "";
  let discovery: UnityLogDiscoveryResult | undefined;

  if (!logPath) {
    discovery = await findBestUnityRuntimeLog(projectPath);
    logPath = discovery.selectedPath ?? "";
  }

  if (!logPath) {
    const searched = discovery?.searchedPaths ?? [getDefaultUnityEditorLogPath(), getDefaultUnityPlayerLogPath()];
    throw new Error([
      "Unity runtime log discovery did not find a usable log.",
      "Searched paths:",
      ...searched.map((candidatePath) => `- ${candidatePath}`),
      "Unity may be writing to a different location; use --runtime-log to supply an override path.",
    ].join("\n"));
  }

  try {
    const content = await readFile(logPath, "utf-8");
    return { logPath, content, discovery };
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
  const { logPath, content } = await readUnityRuntimeLog(projectPath, overrideLogPath);
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

export function renderUnityLogDiscovery(result: UnityLogDiscoveryResult): string {
  const lines = [
    "UNITY LOG DISCOVERY",
    "",
    `Project: ${result.projectPath}`,
    "",
    "Candidates:",
  ];

  if (result.candidates.length === 0) {
    lines.push("- None discovered.");
  } else {
    result.candidates.forEach((candidate) => {
      lines.push(`- Path: ${candidate.path}`);
      lines.push(`  Exists: ${candidate.exists ? "YES" : "NO"}`);
      lines.push(`  Modified: ${candidate.modifiedTime ?? "n/a"}`);
      lines.push(`  Size: ${candidate.size}`);
      lines.push(`  Kind: ${candidate.kind}`);
      lines.push(`  Contains Gameplay Signals: ${candidate.containsGameplaySignals ? "YES" : "NO"}`);
    });
  }

  lines.push("", `Selected: ${result.selectedPath ?? "none"}`);

  if (!result.selectedPath) {
    lines.push("", "Searched Paths:", ...result.searchedPaths.map((candidatePath) => `- ${candidatePath}`));
  }

  return lines.join("\n");
}