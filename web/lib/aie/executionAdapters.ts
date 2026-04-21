import { runInspection } from "./executionHandlers/runInspection";
import { runFileWrite } from "./executionHandlers/runFileWrite";
import { runTestExecution } from "./executionHandlers/runTestExecution";
import { runValidation } from "./executionHandlers/runValidation";
import type {
  DryRunActionType,
  ExecutableDryRunActionType,
  ExecutionActionPreview,
  ExecutionRuntimeResult,
} from "./types";

export type ExecutionAdapterId = "web-sandbox" | "repo-filesystem" | "repo-tests" | "headless-local";

export type ExecutionAdapterContext = {
  sessionId?: string;
  allowedRoots?: string[];
  allowedDirectories?: string[];
  cwd?: string;
  repoRoot?: string;
  adapterMetadata?: Record<string, string | string[] | boolean | undefined>;
  runtimeMode?: "web" | "headless" | "local";
};

export type ExecutionAdapter = {
  id: ExecutionAdapterId;
  canHandle: (action: ExecutionActionPreview, context: ExecutionAdapterContext) => boolean;
  execute: (action: ExecutionActionPreview, context: ExecutionAdapterContext) => Promise<ExecutionRuntimeResult>;
};

export type ExecutionAdapterExecution = {
  adapter: ExecutionAdapter;
  result: ExecutionRuntimeResult;
  contextSummary: string;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSourceActionType(value: unknown): DryRunActionType | null {
  const normalized = normalizeText(value);
  return normalized ? (normalized as DryRunActionType) : null;
}

export function getExecutableActionType(action: ExecutionActionPreview | null | undefined): ExecutableDryRunActionType | null {
  if (action?.type === "inspection" || action?.type === "validation-check" || action?.type === "file-write" || action?.type === "test-run") {
    return action.type;
  }

  const sourceActionType = normalizeSourceActionType(action?.metadata?.sourceActionType);

  if (sourceActionType === "inspection" || sourceActionType === "validation-check" || sourceActionType === "file-write" || sourceActionType === "test-run") {
    return sourceActionType;
  }

  return null;
}

export function isExecutableAction(action: ExecutionActionPreview | null | undefined): boolean {
  if (!action || action.requiresApproval !== true) {
    return false;
  }

  const executableActionType = getExecutableActionType(action);
  if (!executableActionType) {
    return false;
  }

  if (executableActionType === "file-write") {
    return action.scope === "safe" || action.scope === "caution";
  }

  return action.scope === "safe";
}

function buildUnsupportedAdapterResult(): ExecutionRuntimeResult {
  return {
    status: "blocked",
    error: "unsupported action type",
    output: "AI-E blocked this execution request because it is outside the safe bounded runtime.",
  };
}

function buildAdapterContextSummary(adapterId: ExecutionAdapterId, context: ExecutionAdapterContext): string {
  const parts = [
    `adapter=${adapterId}`,
    context.runtimeMode ? `mode=${context.runtimeMode}` : "mode=web",
    context.cwd ? `cwd=${normalizeText(context.cwd)}` : null,
    context.repoRoot ? `repoRoot=${normalizeText(context.repoRoot)}` : null,
    context.allowedRoots?.length ? `roots=${context.allowedRoots.join(",")}` : null,
    context.allowedDirectories?.length ? `dirs=${context.allowedDirectories.join(",")}` : null,
    context.adapterMetadata
      ? Object.entries(context.adapterMetadata)
          .filter(([, value]) => value !== undefined && `${value}`.trim() !== "")
          .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`)
          .join(" | ")
      : null,
  ].filter(Boolean);

  return parts.join(" | ");
}

export function summarizeExecutionAdapterContext(adapterId: ExecutionAdapterId, context: ExecutionAdapterContext): string {
  return buildAdapterContextSummary(adapterId, context);
}

export function getExecutionAdapters(_context: ExecutionAdapterContext = {}): ExecutionAdapter[] {
  return [
    {
      id: "headless-local",
      canHandle: (action, context) =>
        (context.runtimeMode === "headless" || context.runtimeMode === "local") &&
        (getExecutableActionType(action) === "inspection" || getExecutableActionType(action) === "validation-check"),
      execute: async (action) =>
        getExecutableActionType(action) === "validation-check"
          ? runValidation(action)
          : runInspection(action),
    },
    {
      id: "web-sandbox",
      canHandle: (action, context) =>
        context.runtimeMode !== "headless" &&
        (getExecutableActionType(action) === "inspection" || getExecutableActionType(action) === "validation-check"),
      execute: async (action) =>
        getExecutableActionType(action) === "validation-check"
          ? runValidation(action)
          : runInspection(action),
    },
    {
      id: "repo-filesystem",
      canHandle: (action) => getExecutableActionType(action) === "file-write",
      execute: async (action, context) =>
        runFileWrite(action, {
          allowedRoots: context.allowedRoots?.length ? context.allowedRoots : context.allowedDirectories,
        }),
    },
    {
      id: "repo-tests",
      canHandle: (action) => getExecutableActionType(action) === "test-run",
      execute: async (action, context) =>
        runTestExecution(action, {
          cwd: context.cwd,
          repoRoot: context.repoRoot,
        }),
    },
  ];
}

export function selectExecutionAdapter(
  action: ExecutionActionPreview,
  context: ExecutionAdapterContext = {},
): ExecutionAdapter | null {
  if (!isExecutableAction(action)) {
    return null;
  }

  return getExecutionAdapters(context).find((adapter) => adapter.canHandle(action, context)) ?? null;
}

export async function executeWithAdapter(
  action: ExecutionActionPreview,
  context: ExecutionAdapterContext = {},
): Promise<ExecutionAdapterExecution> {
  const adapter = selectExecutionAdapter(action, context);

  if (!adapter) {
    const fallbackAdapterId = context.runtimeMode === "headless" ? "headless-local" : "web-sandbox";
    return {
      adapter: {
        id: fallbackAdapterId,
        canHandle: () => false,
        execute: async () => buildUnsupportedAdapterResult(),
      },
      result: buildUnsupportedAdapterResult(),
      contextSummary: buildAdapterContextSummary(fallbackAdapterId, context),
    };
  }

  return {
    adapter,
    result: await adapter.execute(action, context),
    contextSummary: buildAdapterContextSummary(adapter.id, context),
  };
}