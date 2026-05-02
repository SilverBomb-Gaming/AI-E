import { readdir, readFile } from "node:fs/promises";
import path, { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  generateExecutionInsights,
  type ExecutionInsight,
} from "../lib/aie/executionInsight";
import { renderExecutionInsights } from "../lib/aie/executionInsightOutput";
import {
  validateExecutionOutcomeRecord,
  type ExecutionOutcomeRecord,
} from "../lib/aie/executionOutcome";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");
const DEFAULT_OUTPUT_DIRECTORY = path.join(REPO_ROOT, "data", "execution_outcomes");

type ShowInsightsOptions = {
  outputDirectory: string;
  json: boolean;
};

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

function parseArgs(argv: string[]): ShowInsightsOptions {
  const options: ShowInsightsOptions = {
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg.startsWith("--output-dir=")) {
      options.outputDirectory = arg.slice("--output-dir=".length).trim() || DEFAULT_OUTPUT_DIRECTORY;
      continue;
    }

    if (arg === "--output-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --output-dir");
      }
      options.outputDirectory = value.trim();
      index += 1;
      continue;
    }
  }

  return options;
}

async function loadExecutionOutcomes(outputDirectory: string): Promise<ExecutionOutcomeRecord[]> {
  try {
    const entries = await readdir(outputDirectory, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name)
      .sort();
    const outcomes: ExecutionOutcomeRecord[] = [];

    for (const fileName of files) {
      const payload = await readFile(path.join(outputDirectory, fileName), "utf-8");
      for (const line of payload.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }

        const parsed = JSON.parse(line) as unknown;
        const validation = validateExecutionOutcomeRecord(parsed);
        if (validation.ok && validation.record) {
          outcomes.push(validation.record);
        }
      }
    }

    return outcomes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(argv);
    const outcomes = await loadExecutionOutcomes(options.outputDirectory);
    const insights = generateExecutionInsights(outcomes);
    const rendered = renderExecutionInsights(insights);

    if (options.json) {
      const payload: { output_directory: string; outcome_count: number; insight_count: number; insights: ExecutionInsight[]; summary: string } = {
        output_directory: options.outputDirectory,
        outcome_count: outcomes.length,
        insight_count: insights.length,
        insights,
        summary: rendered.summary,
      };
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    console.log(rendered.console_output);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Execution insights display failed: ${message}`);
    return 1;
  }
}

if (isDirectExecution()) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}