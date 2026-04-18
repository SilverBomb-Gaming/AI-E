import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { captureTrainingScenarioTraces } from "./lib/aie/trainingTraceScenarios";
import type { AnalysisInput } from "./lib/aie/types";

function getTimestampToken(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getOutputPath(explicitPath?: string): string {
  if (explicitPath) {
    return resolve(process.cwd(), explicitPath);
  }

  return resolve(process.cwd(), "..", "data", "raw", `aie-training-traces-${getTimestampToken()}.jsonl`);
}

function getRepeatCount(rawValue: string | undefined): number {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function getPromptVariant(rawValue: string | undefined): "seed" | "paraphrased" {
  return rawValue === "paraphrased" ? "paraphrased" : "seed";
}

function getScenarioSet(rawValue: string | undefined): "baseline" | "complex" | "game-dev" {
  if (rawValue === "complex") {
    return "complex";
  }

  return rawValue === "game-dev" ? "game-dev" : "baseline";
}

async function analyze(input: AnalysisInput) {
  const response = await fetch("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`API failed with status ${response.status}`);
  }

  return response.json();
}

async function main() {
  const outputPath = getOutputPath(process.argv[2]);
  const repeatCount = getRepeatCount(process.argv[3]);
  const promptVariant = getPromptVariant(process.argv[4]);
  const scenarioSet = getScenarioSet(process.argv[5]);
  const capturedAt = new Date().toISOString();
  const traces = await captureTrainingScenarioTraces({ analyze, repeatCount, promptVariant, scenarioSet });
  const lines = traces.map((trace) => JSON.stringify({ capturedAt, ...trace }));

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outputPath,
        traceCount: traces.length,
        repeatCount,
        promptVariant,
        scenarioSet,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});