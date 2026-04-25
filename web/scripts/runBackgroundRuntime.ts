import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  loadRuntimeEntrypointConfig,
  runBackgroundRuntimeEntrypoint,
  type RuntimeEntrypointConfig,
} from "../lib/aie/runtimeEntrypoint";

function parseNumberArg(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseCliArgs(argv: string[]): RuntimeEntrypointConfig {
  const config: RuntimeEntrypointConfig = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--profile=")) {
      config.profile_name = arg.slice("--profile=".length);
      continue;
    }
    if (arg === "--profile") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --profile");
      }
      config.profile_name = value;
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      config.dry_run_mode = true;
      continue;
    }
    if (arg === "--no-dry-run") {
      config.dry_run_mode = false;
      continue;
    }
    if (arg === "--operator-away-mode") {
      config.operator_away_mode = true;
      continue;
    }
    if (arg === "--local-mode") {
      config.operator_away_mode = false;
      continue;
    }
    if (arg.startsWith("--tick-interval-ms=")) {
      config.tick_interval_ms = parseNumberArg(arg.slice("--tick-interval-ms=".length), "--tick-interval-ms");
      continue;
    }
    if (arg.startsWith("--max-ticks-per-run=")) {
      config.max_ticks_per_run = parseNumberArg(arg.slice("--max-ticks-per-run=".length), "--max-ticks-per-run");
      continue;
    }
    if (arg.startsWith("--max-runs-per-invocation=")) {
      config.max_runs_per_invocation = parseNumberArg(
        arg.slice("--max-runs-per-invocation=".length),
        "--max-runs-per-invocation",
      );
      continue;
    }
  }

  return config;
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const config = loadRuntimeEntrypointConfig(parseCliArgs(argv));
    const result = runBackgroundRuntimeEntrypoint(config);
    console.log(result.summary);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Runtime entrypoint failed: ${message}`);
    return 1;
  }
}

if (isDirectExecution()) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}