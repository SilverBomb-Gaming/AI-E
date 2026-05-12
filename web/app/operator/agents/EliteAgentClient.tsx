"use client";

import { useState } from "react";
import type { LiteEliteRunResult } from "@/lib/aie/liteEliteAgentRuntime";
import {
  advanceEliteAgentWorkflow,
  buildEliteAgentWorkflowSession,
  listEliteAgentWorkflowStageDefinitions,
  resumeEliteAgentWorkflow,
  summarizeEliteAgentWorkflow,
  type EliteAgentWorkflowSession,
} from "@/lib/aie/eliteAgentWorkflowEngine";
import {
  createAgentWorkflowHistoryStore,
  listFailedAgentWorkflows,
  listRecentAgentWorkflows,
  listResumableAgentWorkflows,
  recordAgentWorkflowHistory,
  summarizeAgentWorkflowHistory,
  type AgentWorkflowHistoryStore,
} from "@/lib/aie/agentWorkflowHistory";

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

const workflowPrompts = [
  "inspect the inventory system",
  "prepare a safe movement patch",
  "apply the patch automatically",
  "verify the latest gameplay patch",
];

const initialWorkflows = workflowPrompts.map((prompt, index) => buildEliteAgentWorkflowSession({
  agentId: sampleAgent.agentId,
  prompt,
  allowedPaths: sampleAgent.allowedPaths,
  forbiddenPaths: sampleAgent.blockedPaths,
  now: `2026-05-12T12:0${index}:00.000Z`,
}));

const workflowStageDefinitions = listEliteAgentWorkflowStageDefinitions(sampleAgent.allowedPaths);

function createInitialHistoryStore(workflows: EliteAgentWorkflowSession[]): AgentWorkflowHistoryStore {
  const inspection = workflows[0]!;
  const inspectionStage = inspection.stages[0]!;
  const resumableInspection = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(
      advanceEliteAgentWorkflow(inspection, { stageId: inspectionStage.stageId, action: "START_STAGE", now: "2026-05-12T12:10:00.000Z" }),
      { stageId: inspectionStage.stageId, action: "PAUSE_WORKFLOW", reason: "Operator paused inventory inspection for review.", now: "2026-05-12T12:11:00.000Z" },
    ),
    { stageId: inspectionStage.stageId, action: "MARK_RESUMABLE", reason: "This workflow can be resumed from the read context stage.", now: "2026-05-12T12:12:00.000Z" },
  );
  const verification = workflows[3]!;
  const verificationStage = verification.stages[0]!;
  const interruptedVerification = advanceEliteAgentWorkflow(
    advanceEliteAgentWorkflow(verification, { stageId: verificationStage.stageId, action: "START_STAGE", now: "2026-05-12T12:13:00.000Z" }),
    { stageId: verificationStage.stageId, action: "INTERRUPT_WORKFLOW", reason: "Validation terminal stopped before evidence was recorded.", now: "2026-05-12T12:14:00.000Z" },
  );

  return [resumableInspection, interruptedVerification, workflows[2]!].reduce(
    (store, workflow, index) => recordAgentWorkflowHistory(store, workflow, { now: `2026-05-12T12:1${index + 5}:00.000Z` }),
    createAgentWorkflowHistoryStore(),
  );
}

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
  const [workflows, setWorkflows] = useState<EliteAgentWorkflowSession[]>(initialWorkflows);
  const [historyStore, setHistoryStore] = useState<AgentWorkflowHistoryStore>(() => createInitialHistoryStore(initialWorkflows));
  const [workflowPrompt, setWorkflowPrompt] = useState(workflowPrompts[0] ?? "inspect the inventory system");
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

  function addWorkflow() {
    const workflow = buildEliteAgentWorkflowSession({
      agentId: sampleAgent.agentId,
      prompt: workflowPrompt,
      allowedPaths: sampleAgent.allowedPaths,
      forbiddenPaths: sampleAgent.blockedPaths,
    });
    setWorkflows((current) => [workflow, ...current]);
    setHistoryStore((current) => recordAgentWorkflowHistory(current, workflow));
  }

  function resumeFirstEligibleWorkflow() {
    const entry = listResumableAgentWorkflows(historyStore)[0];
    if (!entry) {
      return;
    }
    const resumed = resumeEliteAgentWorkflow(entry.session);
    setWorkflows((current) => [resumed, ...current.filter((workflow) => workflow.workflowSessionId !== resumed.workflowSessionId)]);
    setHistoryStore((current) => recordAgentWorkflowHistory(current, resumed));
  }

  const summary = result?.summary;
  const recentHistory = listRecentAgentWorkflows(historyStore, 5);
  const failedHistory = listFailedAgentWorkflows(historyStore);
  const resumableHistory = listResumableAgentWorkflows(historyStore);

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-6 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">AI-E-lite Elite Agent Phase 2</p>
          <h1 className="mt-2 text-3xl font-semibold">Supervised Workflow Runtime</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">AI-E-lite now tracks governed multi-step workflow sessions with ordered stages, approval checkpoints, validation checkpoints, blocked-stage reasons, and rollback preparation. It remains bounded, supervised, and operator-auditable.</p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700">Workflow Selection</p>
              <h2 className="mt-2 text-lg font-semibold">Deterministic Supervised Chains</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={workflowPrompt} onChange={(event) => setWorkflowPrompt(event.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                {workflowPrompts.map((prompt) => <option key={prompt} value={prompt}>{prompt}</option>)}
              </select>
              <button type="button" onClick={addWorkflow} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Generate Workflow</button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {workflowPrompts.map((prompt) => {
              const preview = summarizeEliteAgentWorkflow(buildEliteAgentWorkflowSession({
                agentId: sampleAgent.agentId,
                prompt,
                allowedPaths: sampleAgent.allowedPaths,
                forbiddenPaths: sampleAgent.blockedPaths,
                now: "2026-05-12T12:00:00.000Z",
              }));
              return (
                <article key={prompt} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <h3 className="text-sm font-semibold">{prompt}</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{preview.stageTypes.join(" -> ")}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700">Execution History</p>
              <h2 className="mt-2 text-lg font-semibold">Workflow Control Center</h2>
            </div>
            <button type="button" onClick={resumeFirstEligibleWorkflow} disabled={resumableHistory.length === 0} className="rounded-md bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Resume First Eligible</button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <article className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold">Recent Workflows</h3>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{recentHistory.length}</p>
            </article>
            <article className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold">Resumable Workflows</h3>
              <p className="mt-1 text-2xl font-semibold text-cyan-800">{resumableHistory.length}</p>
            </article>
            <article className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold">Failed or Blocked</h3>
              <p className="mt-1 text-2xl font-semibold text-rose-800">{failedHistory.length}</p>
            </article>
          </div>
          <div className="mt-4 space-y-3">
            {recentHistory.map((entry) => {
              const operationalSummary = summarizeAgentWorkflowHistory(entry);
              return (
                <article key={entry.historyId} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold">{entry.purpose}</h3>
                      <p className="mt-1 text-xs text-slate-500">{entry.workflowSessionId} updated {entry.updatedAt}</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${statusClass(entry.status.toLowerCase())}`}>{entry.status}</span>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Outcome</h4><p className="mt-1 text-sm text-slate-700">{entry.outcome}</p></div>
                    <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Completed</h4><p className="mt-1 text-sm text-slate-700">{operationalSummary.stagesCompleted}</p></div>
                    <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Resume</h4><p className="mt-1 text-sm text-slate-700">{operationalSummary.resumeGuidance}</p></div>
                    <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Rollback</h4><p className="mt-1 text-sm text-slate-700">{operationalSummary.rollbackAvailability}</p></div>
                  </div>
                  <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">{operationalSummary.blockedStages}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Active Workflows</h2>
            <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-800">{workflows.length} sessions</span>
          </div>
          <div className="mt-4 space-y-4">
            {workflows.map((workflow) => {
              const summary = summarizeEliteAgentWorkflow(workflow);
              return (
                <article key={workflow.workflowSessionId} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold">{workflow.prompt}</h3>
                      <p className="mt-1 text-xs text-slate-500">{workflow.workflowSessionId}</p>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{workflow.deterministicSelectionReason}</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${statusClass(summary.status.toLowerCase())}`}>{summary.status}</span>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Current Stage</h4><p className="mt-1 text-sm text-slate-700">{summary.currentStage ?? "none"}</p></div>
                    <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Validation</h4><p className="mt-1 text-sm text-slate-700">{summary.validationCheckpoints.map((checkpoint) => `${checkpoint.stageType}: ${checkpoint.validationState}`).join(", ") || "not required"}</p></div>
                    <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Approval</h4><p className="mt-1 text-sm text-slate-700">{summary.approvalCheckpoints.map((checkpoint) => `${checkpoint.stageType}: ${checkpoint.approvalState}`).join(", ") || "not required"}</p></div>
                    <div><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Rollback</h4><p className="mt-1 text-sm text-slate-700">{summary.rollbackAvailable ? "available" : summary.rollbackPrepared ? "prepared" : "not available"}</p></div>
                  </div>
                  {summary.blockedStageReason && <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{summary.blockedStageReason}</p>}
                  <ol className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {workflow.stages.map((stage) => (
                      <li key={stage.stageId} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{stage.type}</span>
                          <span className="text-xs text-slate-500">{stage.lifecycleState}</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-600">Mutation: {stage.mutationPermission}; Validation: {stage.validationState}; Approval: {stage.approvalState}</p>
                      </li>
                    ))}
                  </ol>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Stage Governance</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {workflowStageDefinitions.map((definition) => (
              <article key={definition.type} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                <h3 className="font-semibold">{definition.type}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-600">Mutation: {definition.mutationPermission}; Validation required: {String(definition.validationRequired)}; Rollback support: {String(definition.rollbackSupported)}; External dependency: {String(definition.externalDependencyRequired)}</p>
              </article>
            ))}
          </div>
        </section>

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
