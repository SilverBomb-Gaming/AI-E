import { captureTrainingScenarioTraces } from "./lib/aie/trainingTraceScenarios";
import { listMissingAnalysisTraceFields } from "./lib/aie/analysisTrace";

function getScenarioSet(rawValue: string | undefined): "baseline" | "complex" | "game-dev" {
  if (rawValue === "complex") {
    return "complex";
  }

  return rawValue === "game-dev" ? "game-dev" : "baseline";
}

function getRepeatCount(rawValue: string | undefined): number {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 2;
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
  const scenarioSet = getScenarioSet(process.argv[2]);
  const repeatCount = getRepeatCount(process.argv[3]);
  const promptVariant = getPromptVariant(process.argv[4]);
  const traces = await captureTrainingScenarioTraces({
    analyze,
    repeatCount,
    promptVariant,
    scenarioSet,
  });

  const traceReports = traces.map((trace) => ({
    scenario: trace.scenario,
    pass: trace.pass,
    missingFields: [
      ...listMissingAnalysisTraceFields(trace),
      ...(trace.sessionId ? [] : ["sessionId"]),
      ...(Number.isInteger(trace.stepIndex) ? [] : ["stepIndex"]),
      ...(trace.goal ? [] : ["goal"]),
    ],
    commitmentValidationState: trace.commitmentValidationState,
    verificationState: trace.verificationState,
    recommendedMode: trace.recommendedMode,
    loopStatus: trace.loop.status,
    actionChainState: trace.actionChain.state,
  }));

  const allMissingFields = new Set(traceReports.flatMap((trace) => trace.missingFields));
  const readiness = allMissingFields.size === 0 ? "READY FOR TRAINING MODE" : "ALMOST READY";

  console.log(
    JSON.stringify(
      {
        summary: {
          readiness,
          scenarioSet,
          promptVariant,
          traceCount: traces.length,
          completeTraceCount: traceReports.filter((trace) => trace.missingFields.length === 0).length,
        },
        missingFieldNames: [...allMissingFields],
        traces: traceReports,
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