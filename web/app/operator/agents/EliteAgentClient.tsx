"use client";

import { FormEvent, useState } from "react";
import type { LiteEliteRunResult } from "@/lib/aie/liteEliteAgentRuntime";
import {
  advanceEliteAgentWorkflow,
  buildEliteAgentWorkflowSession,
  listEliteAgentWorkflowStageDefinitions,
  resumeEliteAgentWorkflow,
  summarizeEliteAgentWorkflow,
  type EliteAgentWorkflowSession,
  type EliteAgentWorkflowStage,
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
  name: "AI-E Lite Operations Agent",
  role: "repo-maintainer",
  allowedPaths: ["runner_artifacts/lite_elite_agent"],
  blockedPaths: [".git", "node_modules", "web/node_modules", ".env", "web/.env", "package-lock.json"],
  allowedCommands: ["git diff --name-only"],
  maxSteps: 7,
};

const examplePrompts = [
  "inspect the inventory system",
  "prepare a movement patch",
  "verify latest gameplay patch",
];

const workflowStageDefinitions = listEliteAgentWorkflowStageDefinitions(sampleAgent.allowedPaths);

function statusClass(status: string): string {
  if (/completed|success|approved/.test(status)) {
    return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-300/40 dark:bg-emerald-400/10 dark:text-emerald-100";
  }
  if (/blocked|failed|interrupted|rejected/.test(status)) {
    return "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-300/40 dark:bg-rose-400/10 dark:text-rose-100";
  }
  if (/running|validating|resumable/.test(status)) {
    return "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-300/40 dark:bg-cyan-400/10 dark:text-cyan-100";
  }
  return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-300/40 dark:bg-amber-400/10 dark:text-amber-100";
}

function stageLabel(stageType: string | null): string {
  if (!stageType) {
    return "No active step";
  }
  const labels: Record<string, string> = {
    READ_REPO_CONTEXT: "Read project context",
    PREPARE_PATCH: "Prepare safe patch",
    VALIDATE_PATCH: "Validate patch",
    VERIFY_BUILD: "Verify build",
    GENERATE_REPORT: "Write report",
    REQUEST_APPROVAL: "Request approval",
    BLOCKED_EXTERNAL_DEPENDENCY: "Requires approval before execution",
  };
  return labels[stageType] ?? stageType.replace(/_/g, " ").toLowerCase();
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: "Waiting",
    RUNNING: "Running",
    PARTIALLY_COMPLETED: "In progress",
    COMPLETED: "Done",
    BLOCKED: "Needs attention",
    FAILED: "Failed",
    ROLLBACK_AVAILABLE: "Rollback available",
    PAUSED: "Paused",
    INTERRUPTED: "Interrupted",
    RESUMABLE: "Ready to resume",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

function currentStage(workflow: EliteAgentWorkflowSession): EliteAgentWorkflowStage | null {
  return workflow.stages.find((stage) => stage.stageId === workflow.currentStageId) ?? workflow.stages.find((stage) => stage.lifecycleState !== "COMPLETED") ?? null;
}

function buildWorkflow(prompt: string): EliteAgentWorkflowSession {
  return buildEliteAgentWorkflowSession({
    agentId: sampleAgent.agentId,
    prompt,
    allowedPaths: sampleAgent.allowedPaths,
    forbiddenPaths: sampleAgent.blockedPaths,
  });
}

function StageTimeline({ workflow }: { workflow: EliteAgentWorkflowSession }) {
  return (
    <ol className="mt-4 flex flex-wrap gap-2">
      {workflow.stages.map((stage) => (
        <li key={stage.stageId} className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(stage.lifecycleState.toLowerCase())}`}>
          {stageLabel(stage.type)}
        </li>
      ))}
    </ol>
  );
}

function ActionButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:border-cyan-400 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-[#111827] dark:text-zinc-100 dark:hover:border-cyan-300/60 dark:hover:bg-cyan-400/10"
    >
      {label}
    </button>
  );
}

export function EliteAgentClient() {
  const [result, setResult] = useState<LiteEliteRunResult | null>(null);
  const [workflows, setWorkflows] = useState<EliteAgentWorkflowSession[]>([]);
  const [historyStore, setHistoryStore] = useState<AgentWorkflowHistoryStore>(() => createAgentWorkflowHistoryStore());
  const [workflowPrompt, setWorkflowPrompt] = useState(examplePrompts[0] ?? "inspect the inventory system");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [summaryWorkflowId, setSummaryWorkflowId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState("Ask for a workflow and I will plan the next supervised steps without pretending to have unrestricted execution.");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function upsertWorkflow(workflow: EliteAgentWorkflowSession) {
    setWorkflows((current) => [workflow, ...current.filter((entry) => entry.workflowSessionId !== workflow.workflowSessionId)]);
    setHistoryStore((current) => recordAgentWorkflowHistory(current, workflow));
    setSelectedWorkflowId(workflow.workflowSessionId);
  }

  function submitWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = workflowPrompt.trim();
    if (!prompt) {
      return;
    }
    const workflow = buildWorkflow(prompt);
    upsertWorkflow(workflow);
    const summary = summarizeEliteAgentWorkflow(workflow);
    setAgentReply(`I created a step-by-step workflow for "${prompt}". Current step: ${stageLabel(summary.currentStage)}. Status: ${statusLabel(summary.status)}.`);
  }

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
      setAgentReply("The bounded sample task ran inside its scoped path and reported verification results. No broader execution authority was added.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Agent run failed.");
    } finally {
      setIsRunning(false);
    }
  }

  function runWorkflow(workflow: EliteAgentWorkflowSession) {
    const stage = currentStage(workflow);
    if (!stage) {
      setAgentReply("This workflow has no runnable stage left.");
      return;
    }
    try {
      const next = advanceEliteAgentWorkflow(workflow, { stageId: stage.stageId, action: "START_STAGE" });
      upsertWorkflow(next);
      setAgentReply(`${stageLabel(stage.type)} is now running under supervised workflow rules.`);
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "The workflow could not start safely.");
    }
  }

  function resumeWorkflow(workflow: EliteAgentWorkflowSession) {
    try {
      const next = resumeEliteAgentWorkflow(workflow);
      upsertWorkflow(next);
      setAgentReply(`Resumed from ${stageLabel(summarizeEliteAgentWorkflow(next).currentStage)}. Approval and validation rules still apply.`);
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "This workflow is not currently resumable.");
    }
  }

  function requestApproval(workflow: EliteAgentWorkflowSession) {
    const stage = workflow.stages.find((entry) => entry.approvalState === "PENDING") ?? currentStage(workflow);
    if (!stage) {
      return;
    }
    try {
      const next = advanceEliteAgentWorkflow(workflow, { stageId: stage.stageId, action: "APPROVE_STAGE", reason: "Operator requested approval from the workflow card." });
      upsertWorkflow(next);
      setAgentReply(`${stageLabel(stage.type)} is now approved. You can run the next supervised step.`);
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "Approval could not be recorded for this step.");
    }
  }

  const latestRun = result?.summary;
  const recentHistory = listRecentAgentWorkflows(historyStore, 4);
  const failedHistory = listFailedAgentWorkflows(historyStore);
  const resumableHistory = listResumableAgentWorkflows(historyStore);
  const selectedWorkflow = workflows.find((workflow) => workflow.workflowSessionId === selectedWorkflowId) ?? workflows[0] ?? null;

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-4 py-6 text-slate-950 dark:bg-[#070b12] dark:text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420] dark:shadow-black/30">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-200">AI-E Agents</p>
          <h1 className="mt-2 text-3xl font-semibold">Ask an AI-E Agent to manage a workflow</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-zinc-300">
            Start with a plain request. AI-E will turn it into a supervised workflow, show the next step, and keep advanced governance details available when you need them.
          </p>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
            <form onSubmit={submitWorkflow} className="space-y-4">
              <label className="block text-sm font-semibold" htmlFor="workflow-prompt">Ask an AI-E Agent to help with a workflow</label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="workflow-prompt"
                  value={workflowPrompt}
                  onChange={(event) => setWorkflowPrompt(event.target.value)}
                  placeholder="inspect the inventory system"
                  className="min-h-11 flex-1 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-white/10 dark:bg-[#070b12] dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
                <button type="submit" className="rounded-md bg-cyan-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-600 dark:bg-cyan-500 dark:text-[#061018] dark:hover:bg-cyan-400">Run Workflow</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {examplePrompts.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => setWorkflowPrompt(prompt)} className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-cyan-400 hover:bg-cyan-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-cyan-300/60">
                    {prompt}
                  </button>
                ))}
              </div>
            </form>
            <div className="mt-4 rounded-md border border-cyan-200 bg-cyan-50 p-4 text-sm leading-6 text-cyan-950 dark:border-cyan-300/20 dark:bg-cyan-400/10 dark:text-cyan-100">
              {agentReply}
            </div>
          </div>

          <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
            <h2 className="text-lg font-semibold">Control Center</h2>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Active</p><p className="text-2xl font-semibold">{workflows.length}</p></div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Resumable</p><p className="text-2xl font-semibold">{resumableHistory.length}</p></div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Blocked</p><p className="text-2xl font-semibold">{failedHistory.length}</p></div>
            </div>
            <button type="button" onClick={runSampleTask} disabled={isRunning} className="mt-4 w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-cyan-400 hover:bg-cyan-50 disabled:opacity-50 dark:border-white/10 dark:bg-[#111827] dark:text-zinc-100 dark:hover:border-cyan-300/60">
              {isRunning ? "Running bounded task..." : "Run Scoped Sample Task"}
            </button>
            {error && <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-300/30 dark:bg-rose-400/10 dark:text-rose-100">{error}</p>}
          </aside>
        </section>

        {workflows.length === 0 ? (
          <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm dark:border-white/15 dark:bg-[#0d1420]">
            <h2 className="text-xl font-semibold">No workflows yet.</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-zinc-300">Try one of these: inspect the inventory system, prepare a safe movement patch, verify latest gameplay patch.</p>
          </section>
        ) : (
          <section className="grid gap-4 lg:grid-cols-2">
            {workflows.map((workflow) => {
              const summary = summarizeEliteAgentWorkflow(workflow);
              const isSelected = selectedWorkflow?.workflowSessionId === workflow.workflowSessionId;
              const showSummary = summaryWorkflowId === workflow.workflowSessionId;
              const canResume = summary.resumeEligible;
              const needsApproval = summary.approvalCheckpoints.some((checkpoint) => checkpoint.approvalState === "PENDING");
              return (
                <article key={workflow.workflowSessionId} className={`rounded-lg border bg-white p-5 shadow-sm transition dark:bg-[#0d1420] ${isSelected ? "border-cyan-400 ring-2 ring-cyan-400/20 dark:border-cyan-300/60" : "border-slate-200 dark:border-white/10"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">{workflow.prompt}</h2>
                      <p className="mt-1 text-sm text-slate-600 dark:text-zinc-300">Current step: {stageLabel(summary.currentStage)}</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${statusClass(summary.status.toLowerCase())}`}>{statusLabel(summary.status)}</span>
                  </div>

                  <StageTimeline workflow={workflow} />

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Validation</p><p className="mt-1 text-sm font-semibold">{summary.validationCheckpoints[0]?.validationState.replace(/_/g, " ") ?? "Not required"}</p></div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Approval</p><p className="mt-1 text-sm font-semibold">{summary.approvalCheckpoints[0]?.approvalState.replace(/_/g, " ") ?? "Not required"}</p></div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Rollback</p><p className="mt-1 text-sm font-semibold">{summary.rollbackAvailable ? "Available" : "Not needed"}</p></div>
                  </div>

                  {summary.blockedStageReason && (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100">{summary.blockedStageReason}</p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <ActionButton label="Run" onClick={() => runWorkflow(workflow)} />
                    <ActionButton label="Resume" onClick={() => resumeWorkflow(workflow)} disabled={!canResume} />
                    <ActionButton label="Inspect" onClick={() => setSelectedWorkflowId(workflow.workflowSessionId)} />
                    <ActionButton label={showSummary ? "Hide Summary" : "Show Summary"} onClick={() => setSummaryWorkflowId(showSummary ? null : workflow.workflowSessionId)} />
                    {summary.blockedStageReason && <ActionButton label="Explain Blocker" onClick={() => setAgentReply(summary.blockedStageReason ?? "This workflow is blocked by policy.")} />}
                    {needsApproval && <ActionButton label="Request Approval" onClick={() => requestApproval(workflow)} />}
                  </div>

                  {showSummary && (
                    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-white/10 dark:bg-[#070b12] dark:text-zinc-300">
                      <p>{workflow.deterministicSelectionReason}</p>
                      <p className="mt-2">Completed {summary.completedStageCount} of {workflow.stages.length} steps. Remaining work stays inside supervised approval and validation rules.</p>
                    </div>
                  )}

                  <details className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-white/10 dark:bg-[#070b12]">
                    <summary className="cursor-pointer font-semibold">Show Technical Details</summary>
                    <div className="mt-3 space-y-3 text-xs leading-5 text-slate-600 dark:text-zinc-300">
                      <p>Workflow ID: {workflow.workflowSessionId}</p>
                      <p>Allowed path: {workflow.allowedPaths.join(", ")}</p>
                      <ol className="space-y-2">
                        {workflow.stages.map((item) => (
                          <li key={item.stageId} className="rounded border border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-white/5">
                            {item.type}: {item.lifecycleState}; approval {item.approvalState}; validation {item.validationState}; mutation {item.mutationPermission}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </details>
                </article>
              );
            })}
          </section>
        )}

        {recentHistory.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
            <h2 className="text-lg font-semibold">Recent Workflow History</h2>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {recentHistory.map((entry) => {
                const operationalSummary = summarizeAgentWorkflowHistory(entry);
                return (
                  <article key={entry.historyId} className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-semibold">{entry.purpose}</h3>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(entry.status.toLowerCase())}`}>{statusLabel(entry.status)}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-zinc-300">{operationalSummary.resumeGuidance}</p>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <details className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
          <summary className="cursor-pointer text-lg font-semibold">Advanced Governance Reference</summary>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {workflowStageDefinitions.map((definition) => (
              <article key={definition.type} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-white/10 dark:bg-white/5">
                <h3 className="font-semibold">{stageLabel(definition.type)}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-zinc-300">Mutation: {definition.mutationPermission}; Validation required: {String(definition.validationRequired)}; Rollback support: {String(definition.rollbackSupported)}; External dependency: {String(definition.externalDependencyRequired)}</p>
              </article>
            ))}
          </div>
        </details>

        {latestRun && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Latest Scoped Task Run</h2>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${statusClass(latestRun.status)}`}>{latestRun.status}</span>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div><h3 className="font-semibold">Changed Files</h3><p className="mt-1 text-sm text-slate-600 dark:text-zinc-300">{latestRun.filesChanged.length ? latestRun.filesChanged.join(", ") : "none"}</p></div>
              <div><h3 className="font-semibold">Verification</h3><p className="mt-1 text-sm text-slate-600 dark:text-zinc-300">{latestRun.commandsRun.map((command) => `${command.command}: ${command.skipped ? "skipped" : command.exitCode}`).join(", ") || "none"}</p></div>
            </div>
            <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700 dark:border-white/10 dark:bg-[#070b12] dark:text-zinc-300">{latestRun.truthfulCapabilityBoundary}</p>
          </section>
        )}
      </div>
    </main>
  );
}
