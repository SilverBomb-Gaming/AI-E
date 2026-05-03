import { readdir, readFile } from "node:fs/promises";
import path, { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderLearningRecommendations, generateLearningRecommendations, type LearningRecommendation } from "../lib/aie/learningRecommendationReview";
import type { PassiveLearningAudit } from "../lib/aie/passiveLearningAudit";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");
const DEFAULT_OUTPUT_DIRECTORY = path.join(REPO_ROOT, "data", "learning_audits");

type ShowLearningRecommendationsOptions = {
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

function parseArgs(argv: string[]): ShowLearningRecommendationsOptions {
  const options: ShowLearningRecommendationsOptions = {
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
    }
  }

  return options;
}

async function loadLatestAudit(outputDirectory: string): Promise<PassiveLearningAudit | null> {
  try {
    const entries = await readdir(outputDirectory, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name)
      .sort();
    const latest = files.at(-1);

    if (!latest) {
      return null;
    }

    const payload = await readFile(path.join(outputDirectory, latest), "utf-8");
    const lines = payload.trim().split(/\r?\n/);
    const lastLine = lines.at(-1);
    return lastLine ? JSON.parse(lastLine) as PassiveLearningAudit : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(argv);
    const audit = await loadLatestAudit(options.outputDirectory);

    if (!audit) {
      console.log(options.json ? "[]" : "No frozen learning audits found.");
      return 0;
    }

    const recommendations = generateLearningRecommendations(audit);

    if (options.json) {
      console.log(JSON.stringify(recommendations, null, 2));
      return 0;
    }

    console.log(renderLearningRecommendations(recommendations));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Learning recommendation display failed: ${message}`);
    return 1;
  }
}

if (isDirectExecution()) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}