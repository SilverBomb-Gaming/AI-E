import { runInspection } from "./runInspection";
import type { ExecutionActionPreview, ExecutionRuntimeResult } from "../types";

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function runValidation(action: ExecutionActionPreview): Promise<ExecutionRuntimeResult> {
  const inspectionResult = await runInspection(action);
  const targetExpectation = normalizeText(action.expectedOutcome) || normalizeText(action.description);

  if (inspectionResult.status === "success") {
    return {
      status: "success",
      output: [
        "Validation passed in dry-run mode.",
        `Assumption checked: ${targetExpectation}`,
        inspectionResult.output ? `Evidence:\n${inspectionResult.output}` : "Evidence: bounded read-only inspection completed.",
        "No shell commands ran and no files were modified.",
      ].join("\n\n"),
    };
  }

  return {
    status: "failed",
    output: [
      "Validation failed in dry-run mode.",
      `Assumption checked: ${targetExpectation}`,
      inspectionResult.output ? `Evidence:\n${inspectionResult.output}` : "Evidence: no bounded read-only evidence was available.",
      "No shell commands ran and no files were modified.",
    ].join("\n\n"),
    error: inspectionResult.error || "No bounded validation evidence was available.",
  };
}