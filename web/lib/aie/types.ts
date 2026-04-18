export type AnalysisInput = {
  problemDescription: string;
  codeSnippet?: string;
  errorMessage?: string;
  context?: string;
  actionResult?: string;
  sessionId?: string;
  stepIndex?: number;
  goal?: string;
};

export type DryRunActionType =
  | "inspection"
  | "instrumentation"
  | "code-change"
  | "tuning-pass"
  | "design-iteration"
  | "validation-check";

export type FreeAnalysisResponse = {
  what_happened: string;
  what_matters: string[];
  what_to_do_next: string[];
  upgrade_hint: string;
  actionType?: DryRunActionType;
  proposedAction?: string;
  expectedOutcome?: string;
};