import {
  buildOutcomeSessionKey,
  recordOutcome,
  type RecordOutcomeResult,
  summarizeOutcomeLearning,
} from "./outcomeLearning";
import {
  autoEvaluateUnityRuntime,
  buildAutoOutcomeObservation,
} from "./runtimeSignals";

export type AutoRecordOutcomeBlockedResult = {
  status: "blocked";
  projectPath: string;
  reason: string;
};

export type AutoRecordOutcomeDuplicateResult = {
  status: "duplicate";
  projectPath: string;
  feature: string;
  message: string;
  evaluation: Awaited<ReturnType<typeof autoEvaluateUnityRuntime>>;
  recorded: RecordOutcomeResult;
  summary: Awaited<ReturnType<typeof summarizeOutcomeLearning>>;
};

export type AutoRecordOutcomeSuccessResult = {
  status: "recorded";
  projectPath: string;
  feature: string;
  evaluation: Awaited<ReturnType<typeof autoEvaluateUnityRuntime>>;
  recorded: RecordOutcomeResult;
  summary: Awaited<ReturnType<typeof summarizeOutcomeLearning>>;
};

export type AutoRecordOutcomeResult = AutoRecordOutcomeBlockedResult | AutoRecordOutcomeDuplicateResult | AutoRecordOutcomeSuccessResult;

function buildRuntimeAutoSessionKey(feature: string, evaluation: Awaited<ReturnType<typeof autoEvaluateUnityRuntime>>): string | undefined {
  if (!evaluation.session.startMarker || !evaluation.logPath || evaluation.evaluatedLineCount <= 0) {
    return undefined;
  }

  return buildOutcomeSessionKey({
    feature,
    selectedLogPath: evaluation.logPath,
    sessionStartMarker: evaluation.session.startMarker,
    evaluatedLineCount: evaluation.evaluatedLineCount,
  });
}

export async function autoRecordOutcomeForFeature(projectPath: string, feature?: string, runtimeLogPath?: string): Promise<AutoRecordOutcomeResult> {
  const normalizedProjectPath = projectPath.trim();
  if (!normalizedProjectPath) {
    return {
      status: "blocked",
      projectPath,
      reason: "Unity project path is required so the latest playtest session can be evaluated.",
    };
  }

  const normalizedFeature = feature?.trim() ?? "";
  if (!normalizedFeature) {
    return {
      status: "blocked",
      projectPath: normalizedProjectPath,
      reason: "--feature is required so the outcome can be tied to a specific game feature.",
    };
  }

  const evaluation = await autoEvaluateUnityRuntime(normalizedProjectPath, runtimeLogPath);
  const recorded = await recordOutcome(normalizedProjectPath, {
    feature: normalizedFeature,
    action: "runtime signal extraction",
    result: evaluation.parsedResult.inferredResult,
    inferredResult: evaluation.parsedResult.inferredResult,
    observation: buildAutoOutcomeObservation(evaluation),
    consoleSignals: [
      ...evaluation.parsedResult.errors,
      ...evaluation.parsedResult.warnings,
      ...evaluation.parsedResult.gameplayEvents,
    ],
    evaluationSource: "runtime-auto",
    sessionKey: buildRuntimeAutoSessionKey(normalizedFeature, evaluation),
    sessionMode: evaluation.session.mode,
    selectedLogPath: evaluation.logPath,
    evaluatedLineCount: evaluation.evaluatedLineCount,
    gameplayEvents: evaluation.parsedResult.gameplayEvents,
    errors: evaluation.parsedResult.errors,
  });
  const summary = await summarizeOutcomeLearning(normalizedProjectPath);

  if (recorded.duplicate) {
    return {
      status: "duplicate",
      projectPath: normalizedProjectPath,
      feature: normalizedFeature,
      message: "Outcome already recorded for this session.",
      evaluation,
      recorded,
      summary,
    };
  }

  return {
    status: "recorded",
    projectPath: normalizedProjectPath,
    feature: normalizedFeature,
    evaluation,
    recorded,
    summary,
  };
}

export function renderAutoRecordOutcome(result: AutoRecordOutcomeResult): string {
  if (result.status === "blocked") {
    return [
      "AUTO RECORD BLOCKED",
      `Reason: ${result.reason}`,
    ].join("\n");
  }

  const summaryLines = [
    `Total Outcomes: ${result.summary.totalOutcomes}`,
    `Pass Count: ${result.summary.passCount}`,
    `Fail Count: ${result.summary.failCount}`,
    `Partial Count: ${result.summary.partialCount}`,
  ];

  if (result.status === "duplicate") {
    return [
      "AUTO OUTCOME NOT RECORDED",
      result.message,
      "",
      `Feature: ${result.feature}`,
      `Result: ${result.evaluation.parsedResult.inferredResult}`,
      `Session Mode: ${result.evaluation.session.mode}`,
      `Evaluated Lines: ${result.evaluation.evaluatedLineCount}`,
      `Errors: ${result.evaluation.parsedResult.errors.length}`,
      `Gameplay Events: ${result.evaluation.parsedResult.gameplayEvents.length}`,
      "",
      "Learning Summary:",
      ...summaryLines,
    ].join("\n");
  }

  return [
    "AUTO OUTCOME RECORDED",
    "",
    `Feature: ${result.feature}`,
    `Result: ${result.evaluation.parsedResult.inferredResult}`,
    `Session Mode: ${result.evaluation.session.mode}`,
    `Evaluated Lines: ${result.evaluation.evaluatedLineCount}`,
    `Errors: ${result.evaluation.parsedResult.errors.length}`,
    `Gameplay Events: ${result.evaluation.parsedResult.gameplayEvents.length}`,
    "",
    "Learning Summary:",
    ...summaryLines,
  ].join("\n");
}