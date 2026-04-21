import type { DryRunActionType, ExecutionActionMetadata, ExecutionActionPreview, ExecutionActionScope, ExecutionActionType, FreeAnalysisResponse } from "./types";

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
  metadata?: Partial<ExecutionActionMetadata>;
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

  if (/(?:\b(?:npm|jest|vitest|pytest|build)\b|\btest:trace\b|\brun build\b|\brun tests?\b|\bexecute tests?\b)/.test(combined)) {
    return "test-run";
  }

  if (/(?:\b(?:check|confirm|validate|verify)\b.*\b(?:exists?|presence|available|accessible)\b|\b(?:exists?|presence|available|accessible)\b.*\b(?:check|confirm|validate|verify)\b)/.test(combined)) {
    return "validation-check";
  }

  if (/(?:\b(?:confirm|validate|verify|check)\b.*\b(?:contains?|includes?|contract|signature|marker)\b|\b(?:contains?|includes?|contract|signature|marker)\b.*\b(?:confirm|validate|verify|check)\b)/.test(combined)) {
    return "validation-check";
  }

  if (/(?:\b(?:confirm|validate|verify)\b.*\b(?:before continuing|read-only|successful(?:ly)?|passed)\b|\b(?:before continuing|read-only)\b.*\b(?:confirm|validate|verify)\b)/.test(combined)) {
    return "validation-check";
  }

  if (/(?:\b(?:inspect|review|read|summarize|examine)\b.*\b(?:file|path|reference|module|shape|contents?)\b|\b(?:file|path|reference|module|shape|contents?)\b.*\b(?:inspect|review|read|summarize|examine)\b)/.test(combined)) {
    return "inspection";
  }

  if (/(?:\b(?:summarize|summarise)\b.*\b(?:shape|contents?|module|file)\b|\b(?:shape|contents?|module|file)\b.*\b(?:summarize|summarise)\b)/.test(combined)) {
    return "inspection";
  }

  if (/(?:\b(?:write|rewrite|create|update|replace|save)\b.*\b(?:file|readme|doc|docs|markdown|component|module|test)\b|\b[a-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|json|md|txt|css)\b)/.test(combined)) {
    return "file-write";
  }

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
      return "inspection";
    case "validation-check":
      return "validation-check";
    case "file-write":
      return "file-write";
    case "test-run":
      return "test-run";
    case "instrumentation":
      return "write";
    case "code-change":
      return "write";
    default:
      return "unknown";
  }
}

function classifyExecutionScope(actionType: DryRunActionType | undefined): ExecutionActionScope {
  switch (actionType) {
    case "inspection":
    case "validation-check":
    case "test-run":
      return "safe";
    case "file-write":
      return "caution";
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

  if (actionType === "test-run") {
    return sentenceCase(`Run only the mapped bounded test target for: ${trimSentence(proposedAction)}`);
  }

  if (actionType === "file-write") {
    return sentenceCase(`Review the bounded file write before execution: ${trimSentence(proposedAction)}`);
  }

  if (actionType === "inspection") {
    return sentenceCase(`Inspect only: ${trimSentence(proposedAction)}`);
  }

  return undefined;
}

function extractTargetPath(params: { proposedAction: string; context?: string; metadata?: Partial<ExecutionActionMetadata> }): string | undefined {
  const explicitTargetPath = normalizeLine(params.metadata?.targetPath);
  if (explicitTargetPath) {
    return explicitTargetPath;
  }

  const combined = [params.proposedAction, params.context]
    .map((value) => normalizeLine(value))
    .filter(Boolean)
    .join(" ");
  const match = combined.match(/(?:^|\s)(web\/[a-z0-9_./-]+|sandbox\/[a-z0-9_./-]+|app\/[a-z0-9_./-]+|components\/[a-z0-9_./-]+|lib\/[a-z0-9_./-]+|docs\/[a-z0-9_./-]+|tests\/[a-z0-9_./-]+|[a-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md|txt|css))(?:\s|$)/i);
  return match?.[1]?.trim();
}

function classifyAllowedRoot(targetPath: string | undefined): string | undefined {
  const normalizedTargetPath = normalizeLine(targetPath).replace(/\\/g, "/");
  if (!normalizedTargetPath) {
    return undefined;
  }

  if (normalizedTargetPath.startsWith("web/sandbox/") || normalizedTargetPath === "web/sandbox") {
    return "web/sandbox";
  }

  const rootMatch = normalizedTargetPath.match(/^(web\/(?:app|components|lib|tests|docs)|app|components|lib|tests|docs)(?:\/|$)/i);
  return rootMatch?.[1];
}

function isSpecificTestFileTarget(value: string): boolean {
  return /(?:^|\/).+\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(normalizeLine(value).replace(/\\/g, "/"));
}

function inferTestTarget(params: { proposedAction: string; expectedOutcome: string; metadata?: Partial<ExecutionActionMetadata> }): string | undefined {
  const explicitTarget = normalizeLine(params.metadata?.testTarget);
  const normalizedExplicitTarget = explicitTarget.toLowerCase();
  if (normalizedExplicitTarget === "core" || normalizedExplicitTarget === "trace" || normalizedExplicitTarget === "build") {
    return normalizedExplicitTarget;
  }

  if (isSpecificTestFileTarget(explicitTarget)) {
    return explicitTarget.replace(/\\/g, "/");
  }

  const combined = `${normalizeLine(params.proposedAction)} ${normalizeLine(params.expectedOutcome)}`.toLowerCase();
  if (/\btest:trace\b|\btrace tests?\b/.test(combined)) {
    return "trace";
  }
  if (/\bbuild\b|\bnext build\b/.test(combined)) {
    return "build";
  }
  if (/\bnpm test\b|\brun tests?\b|\bcore tests?\b/.test(combined)) {
    return "core";
  }

  return undefined;
}

function buildExecutionMetadata(params: BuildExecutionActionParams, description: string, expectedOutcome: string): ExecutionActionMetadata {
  const targetPath = extractTargetPath({
    proposedAction: description,
    context: params.context,
    metadata: params.metadata,
  });
  const allowedRoot = normalizeLine(params.metadata?.allowedRoot) || classifyAllowedRoot(targetPath);
  const testTarget = inferTestTarget({
    proposedAction: description,
    expectedOutcome,
    metadata: params.metadata,
  });

  return {
    sourceActionType: params.actionType ?? "unknown",
    context: normalizeLine(params.context) || undefined,
    targetPath,
    allowedRoot,
    patch: normalizeLine(params.metadata?.patch) || undefined,
    content: typeof params.metadata?.content === "string" ? params.metadata.content : undefined,
    command: normalizeLine(params.metadata?.command) || undefined,
    testTarget,
  };
}

export function buildExecutionAction(params: BuildExecutionActionParams): ExecutionActionPreview {
  const description = trimSentence(normalizeLine(params.proposedAction)) || "Review the next bounded action before taking any real-world step.";
  const expectedOutcome = sentenceCase(
    trimSentence(normalizeLine(params.expectedOutcome)) ||
      "The next bounded check should narrow the likely cause without widening the execution scope.",
  );
  const metadata = buildExecutionMetadata(params, description, expectedOutcome);
  const scope =
    params.actionType === "file-write" && metadata.allowedRoot === "web/sandbox"
      ? "safe"
      : classifyExecutionScope(params.actionType);

  return {
    id: createExecutionActionId(),
    type: classifyExecutionType(params.actionType),
    scope,
    description,
    expectedOutcome,
    requiresApproval: true,
    suggestedCommand: buildSuggestedCommand(params.actionType, description),
    metadata,
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