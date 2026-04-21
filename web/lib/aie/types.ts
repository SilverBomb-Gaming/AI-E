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
  | "validation-check"
  | "file-write"
  | "test-run";

export type ExecutableDryRunActionType = Extract<DryRunActionType, "inspection" | "validation-check" | "file-write" | "test-run">;

export type ExecutionActionType =
  | "read"
  | "write"
  | "inspect"
  | "run"
  | "inspection"
  | "validation-check"
  | "file-write"
  | "test-run"
  | "unknown";
export type ExecutionActionScope = "safe" | "caution" | "dangerous";

export type ExecutionRollback = {
  type: "restore-file";
  targetPath: string;
  previousContent: string;
  snapshotId: string;
  createdAt: string;
};

export type ExecutionActionMetadata = {
  sourceActionType?: DryRunActionType | "unknown";
  context?: string;
  targetPath?: string;
  allowedRoot?: string;
  patch?: string;
  content?: string;
  command?: string;
  testTarget?: string;
};

export type ExecutionRuntimeResult = {
  status: "success" | "failed" | "blocked";
  output?: string;
  error?: string;
  changedPaths?: string[];
  diffSummary?: string;
  exitCode?: number;
  commandLabel?: string;
  rollback?: ExecutionRollback;
};

export type ExecutionActionPreview = {
  id: string;
  type: ExecutionActionType;
  scope: ExecutionActionScope;
  description: string;
  expectedOutcome: string;
  requiresApproval: true;
  suggestedCommand?: string;
  metadata: ExecutionActionMetadata;
};

export type FreeAnalysisResponse = {
  what_happened: string;
  what_matters: string[];
  what_to_do_next: string[];
  upgrade_hint: string;
  actionType?: DryRunActionType;
  proposedAction?: string;
  expectedOutcome?: string;
  execution?: ExecutionActionPreview;
};