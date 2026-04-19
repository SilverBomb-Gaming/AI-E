import type { DryRunActionType, ExecutionActionPreview, ExecutionActionScope, ExecutionActionType, FreeAnalysisResponse } from "./types";

export type DryRunActionProposal = {
  actionType: DryRunActionType;
  proposedAction: string;
  expectedOutcome: string;
};

type BuildExecutionActionParams = {
  proposedAction: string;
  actionType?: DryRunActionType;
  expectedOutcome?: string;
  context?: string;
};

function normalizeLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function trimSentence(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[.\s]+$/g, "");
}

function sentenceCase(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function createExecutionActionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `aie-execution-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildFallbackStep(response: FreeAnalysisResponse): string {
  return normalizeLine(response.what_to_do_next[0]) || "Run the next bounded check and compare the result.";
}

function inferActionType(response: FreeAnalysisResponse): DryRunActionType {
  const combined = `${buildFallbackStep(response)} ${normalizeLine(response.what_happened)}`.toLowerCase();

  if (/\b(?:log|logging|instrument|timestamp|trace|breakpoint|debug output)\b/.test(combined)) {
    return "instrumentation";
  }

  if (/\b(?:tune|tuning|retune|rebalance|balance|adjust|increase|decrease|curve|cooldown|window|damage|feedback)\b/.test(combined)) {
    return "tuning-pass";
  }

  if (/\b(?:prototype|iterate|iteration|flow|layout|telegraph|readability|feel pass|feedback loop)\b/.test(combined)) {
    return "design-iteration";
  }

  if (/\b(?:remove|replace|rewrite|move|switch|merge|pass directly|dedupe|route|fix|consolidate)\b/.test(combined)) {
    return "code-change";
  }

  if (/\b(?:confirm|validate|verify|re-run|rerun)\b/.test(combined)) {
    return "validation-check";
  }

  return "inspection";
}

function inferFocus(response: FreeAnalysisResponse): string {
  const candidate = normalizeLine(response.what_happened)
    .replace(/^this is (?:a |an )?/i, "")
    .replace(/^this looks like (?:a |an )?/i, "")
    .replace(/^this remains (?:a |an )?/i, "")
    .replace(/^the\s+/i, "")
    .replace(/\bmost likely cause\b.*$/i, "")
    .replace(/\bduplicate writer conflict\b.*/i, "the duplicate writer conflict")
    .replace(/\bownership\/reference handoff issue\b.*/i, "the ownership handoff")
    .replace(/\bis (?:now |still |the )?(?:clearly )?(?:leading |most likely )?cause of.*$/i, "")
    .replace(/\bremains the clearly leading cause of.*$/i, "")
    .replace(/\bcontinues to reproduce.*$/i, "")
    .replace(/\bconfirmed as the cause.*$/i, "")
    .replace(/\bissue\b.*$/i, "")
    .replace(/[,:;].*$/g, "")
    .trim();

  const trimmed = trimSentence(candidate).split(/\s+/).slice(0, 8).join(" ");
  return trimmed || "the targeted system";
}

function buildExpectedOutcome(actionType: DryRunActionType, focus: string): string {
  switch (actionType) {
    case "instrumentation":
      return sentenceCase(`the added instrumentation should show whether ${focus} is actually driving the observed behavior`);
    case "code-change":
      return sentenceCase(`the targeted change should remove the conflict around ${focus} without widening the failure surface`);
    case "tuning-pass":
      return sentenceCase(`the tuning pass should move the feel in the intended direction without creating a new balance regression`);
    case "design-iteration":
      return sentenceCase(`the revised loop should be clearer to evaluate in the next focused playtest`);
    case "validation-check":
      return sentenceCase(`the validation should confirm whether ${focus} is the right target before broader changes`);
    case "inspection":
    default:
      return sentenceCase(`the bounded check should show whether ${focus} is the source of the issue`);
  }
}

function classifyExecutionType(actionType: DryRunActionType | undefined): ExecutionActionType {
  switch (actionType) {
    case "inspection":
      return "inspect";
    case "instrumentation":
      return "write";
    case "code-change":
      return "write";
    case "validation-check":
      return "run";
    default:
      return "unknown";
  }
}

function classifyExecutionScope(actionType: DryRunActionType | undefined): ExecutionActionScope {
  switch (actionType) {
    case "inspection":
    case "validation-check":
      return "safe";
    case "instrumentation":
      return "caution";
    case "code-change":
      return "dangerous";
    default:
      return "safe";
  }
}

function buildSuggestedCommand(actionType: DryRunActionType | undefined, proposedAction: string): string | undefined {
  if (actionType === "validation-check") {
    return sentenceCase(`Run this bounded validation exactly as written: ${trimSentence(proposedAction)}`);
  }

  if (actionType === "inspection") {
    return sentenceCase(`Inspect only: ${trimSentence(proposedAction)}`);
  }

  return undefined;
}

export function buildExecutionAction(params: BuildExecutionActionParams): ExecutionActionPreview {
  const description = trimSentence(normalizeLine(params.proposedAction)) || "Review the next bounded action before taking any real-world step.";
  const expectedOutcome = sentenceCase(
    trimSentence(normalizeLine(params.expectedOutcome)) ||
      "The next bounded check should narrow the likely cause without widening the execution scope.",
  );
  const normalizedContext = normalizeLine(params.context);

  return {
    id: createExecutionActionId(),
    type: classifyExecutionType(params.actionType),
    scope: classifyExecutionScope(params.actionType),
    description,
    expectedOutcome,
    requiresApproval: true,
    suggestedCommand: buildSuggestedCommand(params.actionType, description),
    metadata: {
      sourceActionType: params.actionType ?? "unknown",
      context: normalizedContext || undefined,
    },
  };
}

export function deriveDryRunActionProposal(response: FreeAnalysisResponse): DryRunActionProposal {
  const actionType = response.actionType ?? inferActionType(response);
  const proposedAction = trimSentence(normalizeLine(response.proposedAction) || buildFallbackStep(response));
  const expectedOutcome = sentenceCase(
    trimSentence(normalizeLine(response.expectedOutcome) || buildExpectedOutcome(actionType, inferFocus(response))),
  );

  return {
    actionType,
    proposedAction,
    expectedOutcome,
  };
}

export function attachDryRunActionProposal(response: FreeAnalysisResponse): FreeAnalysisResponse {
  return {
    ...response,
    ...deriveDryRunActionProposal(response),
  };
}