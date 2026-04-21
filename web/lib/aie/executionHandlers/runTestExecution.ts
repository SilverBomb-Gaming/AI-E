import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { ExecutionActionPreview, ExecutionRuntimeResult } from "../types";

const execFileAsync = promisify(execFile);
const TEST_COMMAND_TIMEOUT_MS = 120000;

type TestCommandConfig = {
  command: string;
  args: string[];
  label: string;
};

type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type RunTestExecutionDependencies = {
  execCommand: (config: TestCommandConfig) => Promise<ExecResult>;
  cwd?: string;
  repoRoot?: string;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function getNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function getTsxCommand(): string {
  return process.platform === "win32" ? "tsx.cmd" : "tsx";
}

function getNpxCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function normalizeTestPath(target: string): string {
  return target.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isSupportedTestFile(target: string): boolean {
  return /(?:^|\/)[^/]+\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/i.test(target);
}

async function resolveSpecificTestTarget(target: string, cwd: string, repoRoot?: string): Promise<string | null> {
  const normalizedTarget = normalizeTestPath(target);
  if (!isSupportedTestFile(normalizedTarget)) {
    return null;
  }

  const candidatePaths = [
    path.resolve(cwd, normalizedTarget),
    repoRoot ? path.resolve(repoRoot, normalizedTarget) : null,
    repoRoot && normalizedTarget.startsWith("web/") ? path.resolve(repoRoot, normalizedTarget.slice(4)) : null,
  ].filter((value): value is string => Boolean(value));

  for (const candidatePath of candidatePaths) {
    try {
      const fileStats = await stat(candidatePath);
      if (fileStats.isFile()) {
        return normalizeTestPath(path.relative(cwd, candidatePath));
      }
    } catch {
      // Ignore non-existent candidates and continue trying bounded alternatives.
    }
  }

  return null;
}

async function resolveTestCommand(
  action: ExecutionActionPreview,
  dependencies?: Partial<RunTestExecutionDependencies>,
): Promise<TestCommandConfig | null> {
  const target = normalizeText(action.metadata.testTarget).toLowerCase();
  const npmCommand = getNpmCommand();
  const cwd = dependencies?.cwd ?? process.cwd();

  switch (target) {
    case "core":
      return { command: npmCommand, args: ["test"], label: "npm test" };
    case "trace":
      return { command: npmCommand, args: ["run", "test:trace"], label: "npm run test:trace" };
    case "build":
      return { command: npmCommand, args: ["run", "build"], label: "npm run build" };
    default:
      break;
  }

  const specificTarget = await resolveSpecificTestTarget(target, cwd, dependencies?.repoRoot);
  if (!specificTarget) {
    return null;
  }

  return {
    command: process.execPath,
    args: ["--import", "tsx", "--test", specificTarget],
    label: `node --import tsx --test ${specificTarget}`,
  };
}

async function defaultExecCommand(config: TestCommandConfig, cwd = process.cwd()): Promise<ExecResult> {
  try {
    const result = await execFileAsync(config.command, config.args, {
      cwd,
      timeout: TEST_COMMAND_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error) {
    const source = error as Error & { stdout?: string; stderr?: string; code?: number | string | null };
    return {
      stdout: source.stdout ?? "",
      stderr: source.stderr ?? "",
      exitCode: typeof source.code === "number" ? source.code : 1,
    };
  }
}

export async function runTestExecution(
  action: ExecutionActionPreview,
  dependencies?: Partial<RunTestExecutionDependencies>,
): Promise<ExecutionRuntimeResult> {
  const commandConfig = await resolveTestCommand(action, dependencies);
  if (!commandConfig) {
    return {
      status: "blocked",
      error: "unsupported test target",
      output: "AI-E blocked this test run because the requested test target is not on the bounded whitelist.",
    };
  }

  const execCommand = dependencies?.execCommand ?? ((config) => defaultExecCommand(config, dependencies?.cwd ?? process.cwd()));
  const result = await execCommand(commandConfig);
  const output = [normalizeText(result.stdout), normalizeText(result.stderr)].filter(Boolean).join("\n\n");

  return {
    status: result.exitCode === 0 ? "success" : "failed",
    output: output || `${commandConfig.label} completed with exit code ${result.exitCode}.`,
    error: result.exitCode === 0 ? undefined : `${commandConfig.label} exited with code ${result.exitCode}.`,
    exitCode: result.exitCode,
    commandLabel: commandConfig.label,
  };
}

export { resolveTestCommand };