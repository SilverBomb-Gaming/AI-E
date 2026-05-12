import { NextResponse } from "next/server";

import { createLiteEliteAgent, runLiteEliteAgentTask, type LiteEliteAgent, type LiteEliteTaskContract } from "@/lib/aie/liteEliteAgentRuntime";

export const runtime = "nodejs";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean) : [];
}

function normalizeRiskLevel(value: unknown): LiteEliteTaskContract["riskLevel"] {
  return value === "medium" || value === "high" ? value : "low";
}

function normalizeAgent(value: unknown): LiteEliteAgent {
  if (!value || typeof value !== "object") {
    return createLiteEliteAgent();
  }
  const candidate = value as Record<string, unknown>;
  return createLiteEliteAgent({
    agentId: typeof candidate.agentId === "string" ? candidate.agentId : undefined,
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    role: candidate.role === "test-runner" || candidate.role === "unity-task-planner" || candidate.role === "documentation-updater" || candidate.role === "qa-verifier" || candidate.role === "repo-maintainer" ? candidate.role : undefined,
    allowedPaths: asStringArray(candidate.allowedPaths).length > 0 ? asStringArray(candidate.allowedPaths) : undefined,
    blockedPaths: asStringArray(candidate.blockedPaths).length > 0 ? asStringArray(candidate.blockedPaths) : undefined,
    allowedCommands: asStringArray(candidate.allowedCommands).length > 0 ? asStringArray(candidate.allowedCommands) : undefined,
    maxSteps: typeof candidate.maxSteps === "number" ? candidate.maxSteps : undefined,
  });
}

function normalizeTask(value: unknown): LiteEliteTaskContract {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const taskId = typeof candidate.taskId === "string" && candidate.taskId.trim() ? candidate.taskId.trim() : `lite-task-${Date.now()}`;
  const requestedChanges = Array.isArray(candidate.requestedChanges)
    ? candidate.requestedChanges
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        path: typeof entry.path === "string" ? entry.path : "",
        content: typeof entry.content === "string" ? entry.content : "",
        description: typeof entry.description === "string" ? entry.description : undefined,
      }))
      .filter((entry) => entry.path)
    : [];

  return {
    taskId,
    title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim() : "Bounded AI-E-lite task",
    userGoal: typeof candidate.userGoal === "string" && candidate.userGoal.trim() ? candidate.userGoal.trim() : "Run a bounded local executor task safely.",
    repoScope: typeof candidate.repoScope === "string" && candidate.repoScope.trim() ? candidate.repoScope.trim() : "runner_artifacts/lite_elite_agent",
    allowedPaths: asStringArray(candidate.allowedPaths).length > 0 ? asStringArray(candidate.allowedPaths) : ["runner_artifacts/lite_elite_agent"],
    forbiddenPaths: asStringArray(candidate.forbiddenPaths).length > 0 ? asStringArray(candidate.forbiddenPaths) : [".git", "node_modules", "web/node_modules", ".env", "web/.env"],
    expectedOutputs: asStringArray(candidate.expectedOutputs),
    verificationCommands: asStringArray(candidate.verificationCommands),
    riskLevel: normalizeRiskLevel(candidate.riskLevel),
    requiresHumanApprovalBeforeWrite: typeof candidate.requiresHumanApprovalBeforeWrite === "boolean" ? candidate.requiresHumanApprovalBeforeWrite : true,
    approvedForWrite: candidate.approvedForWrite === true,
    filesToInspect: asStringArray(candidate.filesToInspect),
    requestedChanges,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const agent = normalizeAgent((body as Record<string, unknown>).agent);
    const task = normalizeTask((body as Record<string, unknown>).task);
    const result = await runLiteEliteAgentTask(agent, task, { repoRoot: process.cwd() });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown bounded agent runtime failure.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
