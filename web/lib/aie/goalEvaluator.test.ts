import assert from "node:assert/strict";
import test from "node:test";

import { evaluateGoalCompletion } from "./goalEvaluator";

test("goal evaluator completes when bounded output clearly resolves the requested goal", () => {
  const result = evaluateGoalCompletion({
    goal: "Confirm the validation path reports a healthy status.",
    latestDiagnosis: "The validation path is complete and the issue is resolved.",
    latestExpectedOutcome: "The validation path reports a healthy status.",
    latestExecutionResult: {
      status: "success",
      output: "Validation path complete. Healthy status confirmed and issue resolved.",
    },
  });

  assert.equal(result.isComplete, true);
  assert.equal(result.status, "complete");
  assert.equal(result.confidence, "high");
  assert.match(result.reason, /matches|strongly/i);
});

test("goal evaluator reports blocked for bounded approval walls", () => {
  const blocked = evaluateGoalCompletion({
    goal: "Confirm the validation path reports a healthy status.",
    latestExecutionResult: {
      status: "blocked",
      error: "manual approval required",
    },
  });

  assert.equal(blocked.isComplete, false);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.confidence, "low");
  assert.match(blocked.reason, /blocked/i);
});

test("goal evaluator marks successful writes as progressing instead of complete", () => {
  const progressing = evaluateGoalCompletion({
    goal: "Confirm the validation path reports a healthy status.",
    latestDiagnosis: "The safe sandbox file was updated.",
    latestExecutionResult: {
      status: "success",
      output: "Bounded file write applied.",
      changedPaths: ["web/sandbox/result.txt"],
      diffSummary: "Created new file with 1 lines.",
    },
  });

  assert.equal(progressing.isComplete, false);
  assert.equal(progressing.status, "progressing");
  assert.equal(progressing.confidence, "medium");
  assert.match(progressing.reason, /write alone does not prove/i);
});

test("goal evaluator uses needs-verification for promising but indirect success", () => {
  const ambiguous = evaluateGoalCompletion({
    goal: "Confirm the validation path reports a healthy status.",
    latestDiagnosis: "Validation passed and should be verified against the expected healthy output.",
    latestExpectedOutcome: "The validation path reports a healthy status.",
    latestExecutionResult: {
      status: "success",
      output: "Validation passed, but the final healthy status still needs verification.",
    },
  });

  assert.equal(ambiguous.isComplete, false);
  assert.equal(ambiguous.status, "needs-verification");
  assert.equal(ambiguous.confidence, "medium");
  assert.match(ambiguous.reason, /verification/i);
});

test("goal evaluator treats explicit unresolved wording as progress when evidence improved", () => {
  const progressing = evaluateGoalCompletion({
    goal: "Confirm the validation path reports a healthy status.",
    latestDiagnosis: "The bounded validation made progress, but the healthy result is not confirmed yet.",
    latestExecutionResult: {
      status: "success",
      output: "Closer to the expected result, but not verified yet.",
    },
  });

  assert.equal(progressing.isComplete, false);
  assert.equal(progressing.status, "progressing");
  assert.match(progressing.reason, /progress/i);
});

test("goal evaluator completes a safe read-only existence check when the output directly answers the goal", () => {
  const result = evaluateGoalCompletion({
    goal: "Validate whether web/lib/aie/types.ts exists before continuing.",
    latestDiagnosis: "The read-only validation completed successfully.",
    latestExpectedOutcome: "The file exists and the bounded goal is answered.",
    latestActionFamily: "validate",
    latestExecutionAdapterId: "headless-local",
    latestTargetPathSummary: "web/lib/aie/types.ts",
    latestWasReadOnly: true,
    latestExecutionResult: {
      status: "success",
      output: "Confirmed that web/lib/aie/types.ts exists and is available before continuing.",
    },
  });

  assert.equal(result.status, "complete");
  assert.equal(result.isComplete, true);
  assert.equal(result.safeEvidenceSufficient, true);
  assert.equal(result.followUpUnnecessary, true);
  assert.equal(result.outputDirectlyAnswersGoal, true);
});

test("goal evaluator keeps unresolved read-only wording open even when the command succeeded", () => {
  const result = evaluateGoalCompletion({
    goal: "Inspect web/lib/aie/types.ts and summarize the file shape in read-only mode.",
    latestDiagnosis: "The inspection ran successfully, but the final summary is not verified yet.",
    latestExpectedOutcome: "The file shape should be summarized directly.",
    latestActionFamily: "inspect",
    latestExecutionAdapterId: "headless-local",
    latestTargetPathSummary: "web/lib/aie/types.ts",
    latestWasReadOnly: true,
    latestExecutionResult: {
      status: "success",
      output: "Inspection completed, but the final module shape is not confirmed yet.",
    },
  });

  assert.equal(result.isComplete, false);
  assert.notEqual(result.status, "complete");
  assert.equal(result.safeEvidenceSufficient, false);
});

test("goal evaluator gives a high-confidence verification stop when safe evidence is sufficient but slightly indirect", () => {
  const result = evaluateGoalCompletion({
    goal: "Run npm test and confirm the bounded test command completes successfully.",
    latestDiagnosis: "The bounded test command completed successfully and no further read-only follow-up is required.",
    latestExpectedOutcome: "The bounded test command should pass.",
    latestActionFamily: "test",
    latestExecutionAdapterId: "repo-tests",
    latestWasReadOnly: true,
    latestExecutionResult: {
      status: "success",
      output: "npm test passed with exit code 0.",
      commandLabel: "npm test",
      exitCode: 0,
    },
  });

  assert.ok(result.status === "needs-verification" || result.status === "complete");
  assert.equal(result.confidence, "high");
  assert.equal(result.safeEvidenceSufficient, true);
  assert.equal(result.followUpUnnecessary, true);
});

test("goal evaluator treats Node test runner pass/fail output as a successful bounded test run", () => {
  const result = evaluateGoalCompletion({
    goal: "Locate a test file and verify it runs.",
    latestDiagnosis: "The bounded test file executed successfully.",
    latestExpectedOutcome: "The bounded test file should pass.",
    latestActionFamily: "test",
    latestExecutionAdapterId: "repo-tests",
    latestWasReadOnly: true,
    latestExecutionResult: {
      status: "success",
      output: "pass 1 fail 0 duration_ms 684.9128",
      commandLabel: "node --import tsx --test headless_autonomy.test.ts",
      exitCode: 0,
    },
  });

  assert.equal(result.status, "complete");
  assert.equal(result.isComplete, true);
  assert.equal(result.outputDirectlyAnswersGoal, true);
});

test("goal evaluator leaves partial read-only evidence open when the output does not directly answer the goal", () => {
  const result = evaluateGoalCompletion({
    goal: "Confirm web/lib/aie/types.ts contains the execution contract.",
    latestDiagnosis: "The inspection reached the right file, but only captured a partial note.",
    latestExpectedOutcome: "The output should confirm that the execution contract is present.",
    latestActionFamily: "inspect",
    latestExecutionAdapterId: "web-sandbox",
    latestTargetPathSummary: "web/lib/aie/types.ts",
    latestWasReadOnly: true,
    latestExecutionResult: {
      status: "success",
      output: "Inspection opened web/lib/aie/types.ts.",
    },
  });

  assert.equal(result.isComplete, false);
  assert.equal(result.safeEvidenceSufficient, false);
  assert.equal(result.followUpUnnecessary, false);
});

test("goal evaluator completes a read-only repo summary when the output names the target and exported types", () => {
  const result = evaluateGoalCompletion({
    goal: "Find and summarize types used in web/lib/aie.",
    latestDiagnosis: "The repo-aware fallback kept the step aligned to the requested codebase goal.",
    latestExpectedOutcome: "The bounded inspection should surface the relevant files and summary details for the requested repo goal.",
    latestActionFamily: "inspect",
    latestExecutionAdapterId: "headless-local",
    latestTargetPathSummary: "web/lib/aie/types.ts",
    latestWasReadOnly: true,
    latestExecutionResult: {
      status: "success",
      output: "Inspection completed in read-only mode. Summary: web/lib/aie/types.ts exports types including AnalysisInput and RunnerMode.",
    },
  });

  assert.equal(result.status, "complete");
  assert.equal(result.isComplete, true);
  assert.equal(result.outputDirectlyAnswersGoal, true);
});