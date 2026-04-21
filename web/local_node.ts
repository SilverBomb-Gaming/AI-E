import { loadAutonomousSession, listAutonomousSessions } from "./lib/aie/autonomousSessionStore";
import { resolveRepoRoot } from "./lib/aie/repoContext";
import { runAutonomousSession } from "./lib/aie/runAutonomousSession";
import type { AutonomousSession } from "./lib/aie/autonomousSession";
import type { runAnalysis } from "./lib/aie/run-analysis";
import type { saveAutonomousSession } from "./lib/aie/autonomousSessionStore";
import type { executeAction } from "./lib/aie/executionRuntime";

type LocalNodeOptions = {
  goal: string;
  maxSteps?: number;
  sessionId?: string;
  approved?: boolean;
  allowedRoots?: string[];
  cwd?: string;
  verbose?: boolean;
  json?: boolean;
  listSessions?: boolean;
};

type LocalNodeDependencies = {
  runAnalysis: typeof runAnalysis;
  executeAction: typeof executeAction;
  saveAutonomousSession: typeof saveAutonomousSession;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampMaxSteps(value: unknown): number | undefined {
  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return Math.max(1, Math.min(5, Math.floor(numericValue)));
}

export function parseLocalNodeArgs(argv: string[]): LocalNodeOptions {
  const options: LocalNodeOptions = {
    goal: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    switch (current) {
      case "--goal":
        options.goal = normalizeText(next);
        index += 1;
        break;
      case "--maxSteps":
        options.maxSteps = clampMaxSteps(next);
        index += 1;
        break;
      case "--sessionId":
        options.sessionId = normalizeText(next) || undefined;
        index += 1;
        break;
      case "--approved":
        options.approved = true;
        break;
      case "--allowedRoot":
        options.allowedRoots = [...(options.allowedRoots ?? []), normalizeText(next)].filter(Boolean);
        index += 1;
        break;
      case "--cwd":
        options.cwd = normalizeText(next) || undefined;
        index += 1;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--listSessions":
        options.listSessions = true;
        break;
      default:
        break;
    }
  }

  return options;
}

export function formatLocalNodeSessionOutput(session: AutonomousSession, options?: { json?: boolean; verbose?: boolean }): string {
  if (options?.json) {
    return JSON.stringify(
      {
        sessionId: session.sessionId,
        status: session.status,
        goal: session.goal,
        latestAdapter: session.executionAdapterId ?? null,
        adapterContextSummary: session.adapterContextSummary ?? null,
        planningHintSummary: session.planningHintSummary ?? null,
        completion: session.latestCompletion ?? null,
        completedReason: session.completedReason ?? session.stateReason ?? null,
        steps: options.verbose ? session.steps : session.steps.map((step) => ({
          index: step.index,
          actionFamily: step.actionFamily ?? null,
          executionAdapterId: step.executionAdapterId ?? null,
          goalStatus: step.goalStatus ?? null,
          runtimeStatus: step.executionResult?.status ?? null,
        })),
      },
      null,
      2,
    );
  }

  const lines = [
    `Session ID: ${session.sessionId}`,
    `Goal: ${session.goal}`,
    `Status: ${session.status}`,
    `Latest adapter: ${session.executionAdapterId ?? "unknown"}`,
    `Completion: ${session.latestCompletion ? `${session.latestCompletion.status} (${session.latestCompletion.confidence})` : "No completion state recorded."}`,
    `Reason: ${session.completedReason ?? session.stateReason ?? "No stop reason recorded."}`,
  ];

  if (options?.verbose && session.steps.length) {
    lines.push(
      "",
      ...session.steps.map((step) => [
        `Step ${step.index} | lane=${step.actionFamily ?? "unknown"} | adapter=${step.executionAdapterId ?? "unknown"} | runtime=${step.executionResult?.status ?? "unknown"}`,
        step.proposedAction ? `Action: ${step.proposedAction}` : "",
        step.planningHintSummary ? `Planning: ${step.planningHintSummary}` : "",
        step.adapterContextSummary ? `Adapter context: ${step.adapterContextSummary}` : "",
        step.diagnosis ? `Diagnosis: ${step.diagnosis}` : "",
      ].filter(Boolean).join("\n")),
    );
  }

  return lines.join("\n");
}

export async function formatLocalNodeSessionList(options?: { json?: boolean }): Promise<string> {
  const sessions = await listAutonomousSessions();

  if (options?.json) {
    return JSON.stringify({
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        status: session.status,
        goal: session.goal,
        updatedAt: session.updatedAt,
      })),
    }, null, 2);
  }

  if (!sessions.length) {
    return "No persisted autonomous sessions found.";
  }

  return sessions
    .slice(0, 10)
    .map((session) => `${session.sessionId} | ${session.status} | ${session.goal}`)
    .join("\n");
}

export async function runLocalNode(
  options: LocalNodeOptions,
  dependencies?: Partial<LocalNodeDependencies>,
): Promise<AutonomousSession> {
  const existingSession = options.sessionId ? await loadAutonomousSession(options.sessionId) : null;
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await resolveRepoRoot(cwd);

  return runAutonomousSession({
    goal: options.goal || existingSession?.goal || "Confirm the local execution node can complete a bounded task.",
    maxSteps: options.maxSteps,
    approved: options.approved,
    existingSession: existingSession ?? undefined,
    executionContext: {
      cwd,
      repoRoot,
      allowedRoots: options.allowedRoots,
      allowedDirectories: options.allowedRoots,
      runtimeMode: "local",
    },
    dependencies,
  });
}

async function main() {
  const options = parseLocalNodeArgs(process.argv.slice(2));

  if (options.listSessions) {
    process.stdout.write(`${await formatLocalNodeSessionList({ json: options.json })}\n`);
    return;
  }

  if (!options.goal && !options.sessionId) {
    console.error("A goal or existing sessionId is required.");
    process.exitCode = 1;
    return;
  }

  const session = await runLocalNode(options);
  process.stdout.write(`${formatLocalNodeSessionOutput(session, { json: options.json, verbose: options.verbose })}\n`);
}

if (process.argv[1]?.endsWith("local_node.ts")) {
  void main();
}