import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { captureTrainingScenarioTraces } from "./lib/aie/trainingTraceScenarios";

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

async function analyze(problemDescription: string) {
  const response = await fetch("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ problemDescription }),
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
  const capturedAt = new Date().toISOString();
  const traces = await captureTrainingScenarioTraces({ analyze, repeatCount, promptVariant });
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