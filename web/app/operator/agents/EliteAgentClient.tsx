"use client";

import { useState } from "react";
import type { LiteEliteRunResult } from "@/lib/aie/liteEliteAgentRuntime";

const sampleTask = {
  taskId: "lite-agent-sample-task",
  title: "Prepare bounded local executor artifact",
  userGoal: "Write a scoped sample artifact and report verification truthfully.",
  repoScope: "runner_artifacts/lite_elite_agent",
  allowedPaths: ["runner_artifacts/lite_elite_agent"],
  forbiddenPaths: [".git", "node_modules", "web/node_modules", ".env", "web/.env"],
  expectedOutputs: ["runner_artifacts/lite_elite_agent/sample_agent_output.txt"],
  verificationCommands: ["git diff --name-only"],
  riskLevel: "low",
  requiresHumanApprovalBeforeWrite: false,
  approvedForWrite: true,
  filesToInspect: ["runner_artifacts/lite_elite_agent/sample_agent_output.txt"],
  requestedChanges: [{
    path: "runner_artifacts/lite_elite_agent/sample_agent_output.txt",
    content: "AI-E-lite bounded local executor sample output.\n",
    description: "Write a scoped sample artifact under the allowed runner_artifacts path.",
  }],
};

const sampleAgent = {
  agentId: "lite-elite-repo-maintainer-01",
  name: "AI-E Lite Elite Repo Maintainer",
  role: "repo-maintainer",
  allowedPaths: ["runner_artifacts/lite_elite_agent"],
  blockedPaths: [".git", "node_modules", "web/node_modules", ".env", "web/.env", "package-lock.json"],
  allowedCommands: ["git diff --name-only"],
  maxSteps: 7,
};

function statusClass(status: string): string {
  if (/completed/.test(status)) {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  if (/blocked|failed/.test(status)) {
    return "border-rose-300 bg-rose-50 text-rose-800";
  }
  return "border-amber-300 bg-amber-50 text-amber-800";
}

export function EliteAgentClient() {
  const [result, setResult] = useState<LiteEliteRunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSampleTask() {
    setIsRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/operator/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: sampleAgent, task: sampleTask }),
      });
      const payload = await response.json() as { ok: boolean; result?: LiteEliteRunResult; error?: string };
      if (!payload.ok || !payload.result) {
        throw new Error(payload.error ?? "Agent run failed.");
      }
      setResult(payload.result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Agent run failed.");
    } finally {
      setIsRunning(false);
    }
  }

  const summary = result?.summary;

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-6 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">AI-E-lite Elite Agent Phase 1</p>
          <h1 className="mt-2 text-3xl font-semibold">Bounded Local Executor</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">AI-E now has the foundation for bounded local elite agents that can execute scoped tasks with file-safety and verification reporting. This is not full autonomy, not AGI, and not unattended operation.</p>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Agent</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="font-semibold">Name</dt><dd className="text-slate-600">{sampleAgent.name}</dd></div>
              <div><dt className="font-semibold">Role</dt><dd className="text-slate-600">{sampleAgent.role}</dd></div>
              <div><dt className="font-semibold">Allowed Scope</dt><dd className="text-slate-600">{sampleAgent.allowedPaths.join(", ")}</dd></div>
              <div><dt className="font-semibold">Allowed Commands</dt><dd className="text-slate-600">{sampleAgent.allowedCommands.join(", ")}</dd></div>
              <div><dt className="font-semibold">Max Steps</dt><dd className="text-slate-600">{sampleAgent.maxSteps}</dd></div>
            </dl>
            <button type="button" onClick={runSampleTask} disabled={isRunning} className="mt-5 rounded-md bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {isRunning ? "Running..." : "Run Sample Bounded Task"}
            </button>
            {error && <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          </article>

          <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Task</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="font-semibold">Title</dt><dd className="text-slate-600">{sampleTask.title}</dd></div>
              <div><dt className="font-semibold">Risk</dt><dd className="text-slate-600">{sampleTask.riskLevel}</dd></div>
              <div><dt className="font-semibold">Approval Before Write</dt><dd className="text-slate-600">{String(sampleTask.requiresHumanApprovalBeforeWrite)}</dd></div>
              <div><dt className="font-semibold">Expected Output</dt><dd className="text-slate-600">{sampleTask.expectedOutputs.join(", ")}</dd></div>
            </dl>
          </article>
        </section>

        {summary && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Latest Run</h2>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${statusClass(summary.status)}`}>{summary.status}</span>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div><h3 className="font-semibold">Changed Files</h3><p className="mt-1 text-sm text-slate-600">{summary.filesChanged.length ? summary.filesChanged.join(", ") : "none"}</p></div>
              <div><h3 className="font-semibold">Verification Results</h3><p className="mt-1 text-sm text-slate-600">{summary.commandsRun.map((command) => `${command.command}: ${command.skipped ? "skipped" : command.exitCode}`).join(", ") || "none"}</p></div>
              <div><h3 className="font-semibold">Scaffold/Real Status</h3><p className="mt-1 text-sm text-slate-600">{summary.scaffoldStatus}</p></div>
              <div><h3 className="font-semibold">Next Recommended Task</h3><p className="mt-1 text-sm text-slate-600">{summary.nextRecommendedTask}</p></div>
            </div>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
              {summary.truthfulCapabilityBoundary}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
