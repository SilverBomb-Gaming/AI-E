"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { AutonomousOperatorSteeringAction, AutonomousSession } from "@/lib/aie/autonomousSession";
import type { TaskEnvelope } from "@/lib/aie/taskEnvelope";

type RunState = "idle" | "running" | "failed";

type TaskListResponse = {
  error?: string;
  tasks?: TaskEnvelope[];
  summary?: {
    total: number;
    pending: number;
    assigned: number;
    running: number;
    completed: number;
    failed: number;
    blocked: number;
    runnableSafe: number;
  };
};

type QueueRunPayload = {
  error?: string;
  summary?: {
    status: string;
    task?: TaskEnvelope | null;
    session?: AutonomousSession | null;
  };
};

type SteeringPayload = {
  action?: AutonomousOperatorSteeringAction;
  operatorNote?: string;
  overrideReason?: string;
  stopReason?: string;
  restartReason?: string;
  clear?: boolean;
};

function getStatusClassName(status: AutonomousSession["status"]): string {
  switch (status) {
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "paused":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "awaiting-approval":
      return "border-gold/30 bg-gold/10 text-gold-700";
    case "blocked":
    case "failed":
      return "border-coral/20 bg-coral/10 text-ember";
    case "max-step-limit":
      return "border-ocean/20 bg-ocean/10 text-ocean";
    default:
      return "border-ink/10 bg-white/70 text-ink/75";
  }
}

export default function AutonomousPage() {
  const [goal, setGoal] = useState("Confirm whether the safe validation path can reach a healthy bounded result.");
  const [maxSteps, setMaxSteps] = useState(4);
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState<AutonomousSession | null>(null);
  const [sessions, setSessions] = useState<AutonomousSession[]>([]);
  const [tasks, setTasks] = useState<TaskEnvelope[]>([]);
  const [taskSummary, setTaskSummary] = useState<TaskListResponse["summary"] | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [steeringAction, setSteeringAction] = useState<AutonomousOperatorSteeringAction | "">("");
  const [operatorNote, setOperatorNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  useEffect(() => {
    void refreshRecentSessions();
    void refreshTasks();
  }, []);

  async function refreshRecentSessions() {
    try {
      const response = await fetch("/api/autonomous/sessions", { cache: "no-store" });
      const payload = (await response.json()) as { error?: string; sessions?: AutonomousSession[] };
      if (!response.ok || !Array.isArray(payload.sessions)) {
        throw new Error(payload.error || "The autonomous sessions could not be loaded.");
      }

      setSessions(payload.sessions);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The autonomous sessions could not be loaded.");
    }
  }

  async function refreshTasks() {
    try {
      const response = await fetch("/api/autonomous/tasks", { cache: "no-store" });
      const payload = (await response.json()) as TaskListResponse;
      if (!response.ok || !Array.isArray(payload.tasks)) {
        throw new Error(payload.error || "The autonomous tasks could not be loaded.");
      }

      setTasks(payload.tasks);
      setTaskSummary(payload.summary ?? null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The autonomous tasks could not be loaded.");
    }
  }

  async function runSession() {
    setRunState("running");
    setError(null);

    try {
      const response = await fetch("/api/autonomous/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          goal,
          maxSteps,
          sessionId: sessionId.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string; session?: AutonomousSession };

      if (!response.ok || !payload.session) {
        throw new Error(payload.error || "The autonomous session could not be started.");
      }

      setSession(payload.session);
      setSessionId(payload.session.sessionId);
      await refreshRecentSessions();
      await refreshTasks();
      setRunState("idle");
    } catch (nextError) {
      setRunState("failed");
      setError(nextError instanceof Error ? nextError.message : "The autonomous session could not be started.");
    }
  }

  async function refreshSession() {
    if (!sessionId.trim()) {
      return;
    }

    setError(null);

    try {
      const response = await fetch(`/api/autonomous/session/${encodeURIComponent(sessionId.trim())}`);
      const payload = (await response.json()) as { error?: string; session?: AutonomousSession };

      if (!response.ok || !payload.session) {
        throw new Error(payload.error || "The autonomous session could not be loaded.");
      }

      setSession(payload.session);
      await refreshRecentSessions();
      await refreshTasks();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The autonomous session could not be loaded.");
    }
  }

  function buildSteeringPayload(): SteeringPayload | undefined {
    const trimmedNote = operatorNote.trim();
    const trimmedReason = overrideReason.trim();

    if (!steeringAction && !trimmedNote) {
      return undefined;
    }

    return {
      action: steeringAction || undefined,
      operatorNote: trimmedNote || undefined,
      overrideReason: trimmedReason || undefined,
      stopReason: steeringAction === "stop-loop" ? trimmedReason || undefined : undefined,
      restartReason: steeringAction === "restart-from-last-safe-boundary" ? trimmedReason || undefined : undefined,
    };
  }

  async function resumeSession(approved: boolean, steering?: SteeringPayload, clearSteering = false) {
    if (!sessionId.trim()) {
      return;
    }

    setRunState("running");
    setError(null);

    try {
      const response = await fetch(`/api/autonomous/resume/${encodeURIComponent(sessionId.trim())}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ approved, steering, clearSteering }),
      });
      const payload = (await response.json()) as { error?: string; session?: AutonomousSession };

      if (!response.ok || !payload.session) {
        throw new Error(payload.error || "The autonomous session could not be resumed.");
      }

      setSession(payload.session);
      setSessionId(payload.session.sessionId);
      setSteeringAction("");
      setOperatorNote("");
      setOverrideReason("");
      await refreshRecentSessions();
      await refreshTasks();
      setRunState("idle");
    } catch (nextError) {
      setRunState("failed");
      setError(nextError instanceof Error ? nextError.message : "The autonomous session could not be resumed.");
    }
  }

  async function applySteering(clear = false) {
    if (!sessionId.trim()) {
      return;
    }

    setRunState("running");
    setError(null);

    try {
      const response = await fetch(`/api/autonomous/steer/${encodeURIComponent(sessionId.trim())}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(clear ? { clear: true } : buildSteeringPayload()),
      });
      const payload = (await response.json()) as { error?: string; session?: AutonomousSession };

      if (!response.ok || !payload.session) {
        throw new Error(payload.error || "The autonomous steering request could not be stored.");
      }

      setSession(payload.session);
      setSessionId(payload.session.sessionId);
      if (clear) {
        setSteeringAction("");
        setOperatorNote("");
        setOverrideReason("");
      }
      await refreshRecentSessions();
      await refreshTasks();
      setRunState("idle");
    } catch (nextError) {
      setRunState("failed");
      setError(nextError instanceof Error ? nextError.message : "The autonomous steering request could not be stored.");
    }
  }

  async function runNextQueuedTask() {
    setRunState("running");
    setError(null);

    try {
      const response = await fetch("/api/autonomous/tasks/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ maxSteps: 1 }),
      });
      const payload = (await response.json()) as QueueRunPayload;
      if (!response.ok || !payload.summary) {
        throw new Error(payload.error || "The queued task could not be executed.");
      }

      if (payload.summary.session) {
        setSession(payload.summary.session);
        setSessionId(payload.summary.session.sessionId);
      }

      await refreshRecentSessions();
      await refreshTasks();
      setRunState("idle");
    } catch (nextError) {
      setRunState("failed");
      setError(nextError instanceof Error ? nextError.message : "The queued task could not be executed.");
    }
  }

  const canResume = session?.status === "paused" || session?.status === "awaiting-approval";

  return (
    <main className="page-shell mx-auto max-w-6xl px-6 py-10 lg:px-10 lg:py-14">
      <div className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
        <section className="glass-card rounded-[2rem] p-8 shadow-float">
          <p className="section-label">Bounded autonomous session</p>
          <h1 className="headline mt-3 text-4xl font-semibold">Run, pause, and resume a bounded multi-step session without losing the thread.</h1>
          <p className="mt-4 text-sm leading-7 body-muted">
            This surface reuses the same analysis input, dry-run action proposal, and safe execution bridge. It keeps a bounded step limit, persists session state, and surfaces approval-gated pending actions instead of collapsing them into a failure.
          </p>

          <label className="mt-8 block text-sm font-semibold text-ink">
            Top-level goal
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={5}
              className="mt-2 w-full rounded-[1.2rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm text-ink outline-none transition focus:border-ocean/40"
              placeholder="Describe the bounded outcome AI-E should try to confirm."
            />
          </label>

          <div className="mt-5 grid gap-4 sm:grid-cols-[0.45fr_0.55fr]">
            <label className="text-sm font-semibold text-ink">
              Max steps
              <input
                value={maxSteps}
                onChange={(event) => setMaxSteps(Number(event.target.value) || 1)}
                min={1}
                max={5}
                type="number"
                className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm text-ink outline-none transition focus:border-ocean/40"
              />
            </label>
            <label className="text-sm font-semibold text-ink">
              Existing session ID
              <input
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm text-ink outline-none transition focus:border-ocean/40"
                placeholder="Optional: resume or inspect a saved session"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={runSession}
              disabled={runState === "running"}
              className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runState === "running" ? "Running bounded loop..." : "Run autonomous session"}
            </button>
            <button
              type="button"
              onClick={runNextQueuedTask}
              disabled={runState === "running"}
              className="rounded-full border border-ocean/20 bg-ocean/10 px-5 py-3 text-sm font-semibold text-ocean disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runState === "running" ? "Executing queued task..." : "Run next queued task"}
            </button>
            <button
              type="button"
              onClick={refreshSession}
              disabled={!sessionId.trim()}
              className="rounded-full border border-ink/10 px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              Refresh session
            </button>
            <button
              type="button"
              onClick={() => resumeSession(false)}
              disabled={!canResume || runState === "running"}
              className="rounded-full border border-gold/30 px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              Resume paused session
            </button>
            <button
              type="button"
              onClick={() => resumeSession(true)}
              disabled={session?.status !== "awaiting-approval" || runState === "running"}
              className="rounded-full bg-gold px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              Approve and resume
            </button>
            <Link href="/result" className="rounded-full border border-ink/10 px-5 py-3 text-sm font-semibold text-ink">
              Back to result page
            </Link>
          </div>

          {error ? <p className="mt-4 text-sm font-medium text-ember">{error}</p> : null}

          <div className="mt-8 rounded-[1.3rem] border border-ink/10 bg-white/70 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ink/45">Recent sessions</p>
                <p className="mt-1 text-sm text-ink/65">Inspect persisted continuity without restarting from scratch.</p>
              </div>
              <button
                type="button"
                onClick={refreshRecentSessions}
                className="rounded-full border border-ink/10 px-3 py-2 text-xs font-semibold text-ink"
              >
                Refresh list
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {sessions.slice(0, 6).map((item) => (
                <button
                  key={item.sessionId}
                  type="button"
                  onClick={() => {
                    setSessionId(item.sessionId);
                    setSession(item);
                    setGoal(item.goal);
                    setMaxSteps(item.maxSteps);
                  }}
                  className="w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-left transition hover:border-ocean/30"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-semibold text-ink">{item.goal}</span>
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${getStatusClassName(item.status)}`}>
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-ink/55">{item.sessionId}</p>
                  <p className="mt-2 text-sm text-ink/70">{item.stateReason || item.completedReason || "No state reason recorded yet."}</p>
                </button>
              ))}
              {!sessions.length ? <p className="text-sm text-ink/60">No persisted autonomous sessions yet.</p> : null}
            </div>
          </div>

          <div className="mt-8 rounded-[1.3rem] border border-ink/10 bg-white/70 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ink/45">Queue state</p>
                <p className="mt-1 text-sm text-ink/65">Inspect claimed, running, and finalized task envelopes without leaving this page.</p>
              </div>
              <button
                type="button"
                onClick={refreshTasks}
                className="rounded-full border border-ink/10 px-3 py-2 text-xs font-semibold text-ink"
              >
                Refresh tasks
              </button>
            </div>

            {taskSummary ? (
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink/55">
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1">total {taskSummary.total}</span>
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1">pending {taskSummary.pending}</span>
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1">assigned {taskSummary.assigned}</span>
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1">running {taskSummary.running}</span>
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1">completed {taskSummary.completed}</span>
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1">failed {taskSummary.failed}</span>
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1">blocked {taskSummary.blocked}</span>
                <span className="rounded-full border border-ocean/20 bg-ocean/10 px-3 py-1 text-ocean">runnable safe {taskSummary.runnableSafe}</span>
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              {tasks.slice(0, 6).map((task) => (
                <article key={task.taskId} className="rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm text-ink/80">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold text-ink">{task.action.description}</p>
                      <p className="mt-1 text-xs text-ink/55">{task.taskId} · session {task.sessionId}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${task.status === "completed"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : task.status === "failed" || task.status === "blocked"
                        ? "border-coral/20 bg-coral/10 text-ember"
                        : task.status === "running"
                          ? "border-ocean/20 bg-ocean/10 text-ocean"
                          : task.status === "assigned"
                            ? "border-gold/30 bg-gold/10 text-gold-700"
                            : "border-ink/10 bg-white text-ink/65"
                    }`}>
                      {task.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-ink/75">Assigned node: {task.assignedNodeId || "unassigned"} · runner: {task.runnerMode || "unknown"}</p>
                  <p className="mt-2 text-sm text-ink/75">Claim token: {task.claimToken || "none"}</p>
                  <p className="mt-2 text-sm text-ink/75">Timeline: claimed {task.claimedAt || "-"} · started {task.startedAt || "-"} · completed {task.completedAt || "-"}</p>
                  {task.failedAt ? <p className="mt-2 text-sm text-ink/75">Failed at: {task.failedAt}</p> : null}
                  {task.blockedAt ? <p className="mt-2 text-sm text-ink/75">Blocked at: {task.blockedAt}</p> : null}
                  <p className="mt-2 text-sm text-ink/75">Reason: {task.statusReason || "No status reason recorded yet."}</p>
                </article>
              ))}
              {!tasks.length ? <p className="text-sm text-ink/60">No persisted autonomous tasks yet.</p> : null}
            </div>
          </div>
        </section>

        <section className="glass-card rounded-[2rem] p-8 shadow-float">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-label">Saved session state</p>
              <h2 className="headline mt-3 text-3xl font-semibold">Inspect each step and the stop reason.</h2>
            </div>
            {session ? (
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] ${getStatusClassName(session.status)}`}>
                {session.status}
              </span>
            ) : null}
          </div>

          {!session ? (
            <p className="mt-5 text-sm leading-7 body-muted">
              Start a bounded run or paste a known session ID to inspect a persisted autonomous session.
            </p>
          ) : (
            <div className="mt-5 space-y-5">
              <div className="rounded-[1.2rem] border border-ink/10 bg-white/70 p-4 text-sm leading-7 text-ink/80">
                <p><strong>Session ID:</strong> {session.sessionId}</p>
                <p><strong>Goal:</strong> {session.goal}</p>
                <p><strong>Next step index:</strong> {session.currentStepIndex}</p>
                <p><strong>Max steps:</strong> {session.maxSteps}</p>
                <p><strong>Last step index:</strong> {session.lastStepIndex ?? 0}</p>
                <p><strong>State reason:</strong> {session.stateReason || session.completedReason || "No state reason recorded yet."}</p>
                <p><strong>Terminal reason:</strong> {session.completedReason || "No terminal reason recorded yet."}</p>
                <p><strong>Completion:</strong> {session.latestCompletion ? `${session.latestCompletion.status} (${session.latestCompletion.confidence})` : "No completion state recorded yet."}</p>
                <p><strong>Latest adapter:</strong> {session.executionAdapterId || "No adapter recorded yet."}</p>
                <p><strong>Execution node:</strong> {session.executionNodeId ? `${session.executionNodeId} (${session.executionNodeMode || "unknown"})` : "No node recorded yet."}</p>
                <p><strong>Node capabilities:</strong> {session.nodeCapabilitySummary || "No node capabilities recorded yet."}</p>
                <p><strong>Latest task:</strong> {session.taskId || "No task recorded yet."}</p>
                <p><strong>Task status:</strong> {session.taskStatus || "No task status recorded yet."}</p>
                <p><strong>Assigned node:</strong> {session.assignedNodeId || "No node assignment recorded yet."}</p>
                <p><strong>Queue summary:</strong> {session.queueStateSummary || "No queue summary recorded yet."}</p>
                <p><strong>Planning hints:</strong> {session.planningHintSummary || "No planning hints recorded yet."}</p>
                <p><strong>Adapter context:</strong> {session.adapterContextSummary || "No adapter context recorded yet."}</p>
                <p><strong>Session mode:</strong> {session.sessionMode}</p>
                <p><strong>Coding loop phase:</strong> {session.workflowContinuity.coding.codingLoopPhase}</p>
                <p><strong>Coding target scope:</strong> {session.workflowContinuity.coding.targetScope || "No coding scope recorded yet."}</p>
                <p><strong>Current coding objective:</strong> {session.workflowContinuity.coding.currentCodingObjective || "No coding objective recorded yet."}</p>
                <p><strong>Current deliverable target:</strong> {session.workflowContinuity.coding.currentDeliverableTarget || "No deliverable target recorded yet."}</p>
                <p><strong>Expected output form:</strong> {session.workflowContinuity.coding.expectedOutputForm || "No expected output form recorded yet."}</p>
                <p><strong>Validation success target:</strong> {session.workflowContinuity.coding.validationSuccessTarget || "No validation success target recorded yet."}</p>
                <p><strong>Current acceptance target:</strong> {session.workflowContinuity.coding.currentAcceptanceTarget || "No acceptance target recorded yet."}</p>
                <p><strong>Current target status:</strong> {session.workflowContinuity.coding.currentTargetStatus}</p>
                <p><strong>Validation proves:</strong> {session.workflowContinuity.coding.validationProves || "No validation proof target recorded yet."}</p>
                <p><strong>Validation target matches deliverable:</strong> {session.workflowContinuity.coding.validationTargetMatchesDeliverable ? "Yes" : "No"}</p>
                <p><strong>Validation failure impact:</strong> {session.workflowContinuity.coding.validationFailureImpact || "No deliverable impact recorded yet."}</p>
                <p><strong>Correction maintains deliverable:</strong> {session.workflowContinuity.coding.correctionMaintainsDeliverable ? "Yes" : "No"}</p>
                <p><strong>Deliverable changed during correction or escalation:</strong> {session.workflowContinuity.coding.deliverableChangedDuringCorrectionOrEscalation ? "Yes" : "No"}</p>
                <p><strong>Deliverable accepted:</strong> {session.workflowContinuity.coding.deliverableAccepted ? "Yes" : "No"}</p>
                <p><strong>Acceptance confidence:</strong> {session.workflowContinuity.coding.acceptanceConfidence}</p>
                <p><strong>Completion state:</strong> {session.workflowContinuity.coding.completionState}</p>
                <p><strong>Operator confirmation required:</strong> {session.workflowContinuity.coding.operatorConfirmationRequired ? "Yes" : "No"}</p>
                <p><strong>Loop should terminate:</strong> {session.workflowContinuity.coding.shouldTerminateLoop ? "Yes" : "No"}</p>
                <p><strong>Acceptance reason:</strong> {session.workflowContinuity.coding.acceptanceReason || "No acceptance reason recorded yet."}</p>
                <p><strong>Acceptance summary:</strong> {session.workflowContinuity.coding.acceptanceSummary || "No acceptance summary recorded yet."}</p>
                <p><strong>Output linked to deliverable:</strong> {session.workflowContinuity.coding.outputLinkedToDeliverable ? "Yes" : "No"}</p>
                <p><strong>Files affected:</strong> {session.workflowContinuity.coding.outputArtifacts.length > 0 ? [...new Set(session.workflowContinuity.coding.outputArtifacts.map((artifact) => artifact.filePath))].join(", ") : "No output artifacts recorded yet."}</p>
                <p><strong>Last output summary:</strong> {session.workflowContinuity.coding.lastOutputSummary || "No output summary recorded yet."}</p>
                <p><strong>Output artifacts:</strong> {session.workflowContinuity.coding.outputArtifacts.length > 0 ? session.workflowContinuity.coding.outputArtifacts.map((artifact) => `step ${artifact.stepIndex}: ${artifact.filePath}${artifact.diffLikeSummary ? ` | diff=${artifact.diffLikeSummary}` : ""}${artifact.changeSummary ? ` | change=${artifact.changeSummary}` : ""}${artifact.linkedToDeliverable ? " | linked=true" : " | linked=false"}`).join(" ; ") : "No output artifacts recorded yet."}</p>
                <p><strong>Repo action summary:</strong> {session.workflowContinuity.coding.repoActionSummary || "No repo actions derived yet."}</p>
                <p><strong>Pending repo actions:</strong> {session.workflowContinuity.coding.pendingRepoActions.length > 0 ? session.workflowContinuity.coding.pendingRepoActions.map((action) => `${action.actionId}: ${action.artifactFilePaths.join(", ")} | status=${action.executionStatus}${action.changeSummary ? ` | change=${action.changeSummary}` : ""}`).join(" ; ") : "No pending repo actions."}</p>
                <p><strong>Approved repo actions:</strong> {session.workflowContinuity.coding.approvedRepoActions.length > 0 ? session.workflowContinuity.coding.approvedRepoActions.map((action) => `${action.actionId}: ${action.artifactFilePaths.join(", ")} | status=${action.executionStatus}${action.changeSummary ? ` | change=${action.changeSummary}` : ""}`).join(" ; ") : "No approved repo actions."}</p>
                <p><strong>Executed repo actions:</strong> {session.workflowContinuity.coding.executedRepoActions.length > 0 ? session.workflowContinuity.coding.executedRepoActions.map((action) => `${action.actionId}: ${action.artifactFilePaths.join(", ")} | status=${action.executionStatus}${action.changeSummary ? ` | change=${action.changeSummary}` : ""}`).join(" ; ") : "No executed repo actions."}</p>
                <p><strong>Validation target:</strong> {session.workflowContinuity.coding.validationTarget || "No validation target recorded yet."}</p>
                <p><strong>Current validation target:</strong> {session.workflowContinuity.coding.currentValidationTarget || "No current validation target recorded yet."}</p>
                <p><strong>Last code change summary:</strong> {session.workflowContinuity.coding.lastCodeChangeSummary || "No code change summary recorded yet."}</p>
                <p><strong>Last implementation summary:</strong> {session.workflowContinuity.coding.lastImplementationSummary || "No implementation summary recorded yet."}</p>
                <p><strong>Last validation summary:</strong> {session.workflowContinuity.coding.lastValidationSummary || "No validation summary recorded yet."}</p>
                <p><strong>Last validation result summary:</strong> {session.workflowContinuity.coding.lastValidationResultSummary || "No validation result summary recorded yet."}</p>
                <p><strong>Current correction target:</strong> {session.workflowContinuity.coding.currentCorrectionTarget || "No correction target recorded yet."}</p>
                <p><strong>Last correction summary:</strong> {session.workflowContinuity.coding.lastCorrectionSummary || "No correction summary recorded yet."}</p>
                <p><strong>Repeated validation outcome:</strong> {session.workflowContinuity.coding.repeatedValidationOutcome || "No repeated validation outcome recorded yet."}</p>
                <p><strong>Validation-first coding behavior:</strong> {session.workflowContinuity.coding.validationFirstActive ? "Active" : "Inactive"}</p>
                <p><strong>Repeated validation failure driving escalation:</strong> {session.workflowContinuity.coding.repeatedValidationFailureDrivingEscalation ? "Yes" : "No"}</p>
                <p><strong>Next intended coding action:</strong> {session.workflowContinuity.coding.nextIntendedCodingAction || "No coding action recorded yet."}</p>
                <p><strong>Coding escalation active:</strong> {session.workflowContinuity.coding.escalationActive ? "Yes" : "No"}</p>
                <p><strong>Coding supervised recovery active:</strong> {session.workflowContinuity.coding.supervisedRecoveryActive ? "Yes" : "No"}</p>
                <p><strong>Coding loop summary:</strong> {session.workflowContinuity.coding.codingSummary || "No coding loop summary recorded yet."}</p>
                <p><strong>System recommended next phase:</strong> {session.workflowContinuity.loopHealth.systemRecommendedNextPhase || "No system recommendation recorded yet."}</p>
                <p><strong>Recommended next phase:</strong> {session.workflowContinuity.loopHealth.recommendedNextPhase}</p>
                <p><strong>Recommendation confidence:</strong> {session.workflowContinuity.loopHealth.recommendationConfidence}</p>
                <p><strong>Likely needs operator input:</strong> {session.workflowContinuity.loopHealth.likelyNeedsOperatorInput ? "Yes" : "No"}</p>
                <p><strong>Recommendation rationale:</strong> {session.workflowContinuity.loopHealth.recommendationRationaleSummary || "No recommendation rationale recorded yet."}</p>
                <p><strong>Top recommendation signals:</strong> {session.workflowContinuity.loopHealth.topContributingSignals.length ? session.workflowContinuity.loopHealth.topContributingSignals.join(", ") : "No recommendation signals recorded yet."}</p>
                <p><strong>Recommendation review summary:</strong> {session.workflowContinuity.review.reviewSummary || "No recommendation review recorded yet."}</p>
                <p><strong>Last reviewed recommendation:</strong> {session.workflowContinuity.review.lastReviewedRecommendation || "No reviewed recommendation recorded yet."}</p>
                <p><strong>Last operator review response:</strong> {session.workflowContinuity.review.lastOperatorResponse || "No operator review response recorded yet."}</p>
                <p><strong>Last recommendation review outcome:</strong> {session.workflowContinuity.review.lastRecommendationOutcome || "No recommendation review outcome recorded yet."}</p>
                <p><strong>Last recommendation follow-through status:</strong> {session.workflowContinuity.review.lastFollowThroughStatus || "No follow-through status recorded yet."}</p>
                <p><strong>Last recommendation follow-through summary:</strong> {session.workflowContinuity.review.lastFollowThroughSummary || "No follow-through summary recorded yet."}</p>
                <p><strong>Last accepted recommendation outcome:</strong> {session.workflowContinuity.review.lastAcceptedRecommendationOutcome || "No accepted recommendation outcome recorded yet."}</p>
                <p><strong>Last redirected recommendation outcome:</strong> {session.workflowContinuity.review.lastRedirectedRecommendationOutcome || "No redirected recommendation outcome recorded yet."}</p>
                <p><strong>Last review improved progress:</strong> {session.workflowContinuity.review.lastReviewImprovedProgress ? "Yes" : "No"}</p>
                <p><strong>Last review needed correction:</strong> {session.workflowContinuity.review.lastRecommendationNeededCorrection ? "Yes" : "No"}</p>
                <p><strong>Follow-through helped:</strong> {session.workflowContinuity.review.followThroughLedUsefulProgress ? "Yes" : "No"}</p>
                <p><strong>Follow-through required correction:</strong> {session.workflowContinuity.review.followThroughRequiredCorrection ? "Yes" : "No"}</p>
                <p><strong>Returned to same recommendation again:</strong> {session.workflowContinuity.review.returnedToSameRecommendationAgain ? "Yes" : "No"}</p>
                <p><strong>Repeated review without progress:</strong> {session.workflowContinuity.review.repeatedReviewWithoutProgress ? "Yes" : "No"}</p>
                <p><strong>Recommendation frequently overridden:</strong> {session.workflowContinuity.review.frequentlyOverridden ? "Yes" : "No"}</p>
                <p><strong>Recommendation escalation status:</strong> {session.workflowContinuity.escalation.escalationStatus}</p>
                <p><strong>Recommendation recovery guidance:</strong> {session.workflowContinuity.escalation.recoveryRecommendation}</p>
                <p><strong>Likely needs operator intervention now:</strong> {session.workflowContinuity.escalation.likelyNeedsOperatorInterventionNow ? "Yes" : "No"}</p>
                <p><strong>Repeated ineffective review cycles:</strong> {session.workflowContinuity.escalation.repeatedIneffectiveReviewCycles ? "Yes" : "No"}</p>
                <p><strong>Accepted recommendations repeatedly requiring correction:</strong> {session.workflowContinuity.escalation.acceptedRecommendationsRepeatedlyRequiringCorrection ? "Yes" : "No"}</p>
                <p><strong>Redirected recommendations outperforming system:</strong> {session.workflowContinuity.escalation.redirectedRecommendationsOutperformSystem ? "Yes" : "No"}</p>
                <p><strong>Returned to same ineffective recommendation state:</strong> {session.workflowContinuity.escalation.returnedToSameIneffectiveState ? "Yes" : "No"}</p>
                <p><strong>Recommendation escalation summary:</strong> {session.workflowContinuity.escalation.escalationSummary || "No escalation summary recorded yet."}</p>
                <p><strong>Recommendation recovery summary:</strong> {session.workflowContinuity.escalation.recoverySummary || "No recovery summary recorded yet."}</p>
                <p><strong>Recommendation handoff status:</strong> {session.workflowContinuity.handoff.handoffStatus}</p>
                <p><strong>Waiting on operator recovery decision:</strong> {session.workflowContinuity.handoff.waitingOnOperatorDecision ? "Yes" : "No"}</p>
                <p><strong>Recovery execution in progress:</strong> {session.workflowContinuity.handoff.recoveryExecutionInProgress ? "Yes" : "No"}</p>
                <p><strong>Recovery execution completed:</strong> {session.workflowContinuity.handoff.recoveryExecutionCompleted ? "Yes" : "No"}</p>
                <p><strong>Recovery improved progress:</strong> {session.workflowContinuity.handoff.recoveryImprovedProgress ? "Yes" : "No"}</p>
                <p><strong>Second escalation needed:</strong> {session.workflowContinuity.handoff.secondEscalationNeeded ? "Yes" : "No"}</p>
                <p><strong>Selected recovery action:</strong> {session.workflowContinuity.handoff.selectedRecoveryAction || "No recovery action selected yet."}</p>
                <p><strong>Selected recovery mode:</strong> {session.workflowContinuity.handoff.selectedRecoveryMode || "No recovery mode selected yet."}</p>
                <p><strong>Selected recovery reason:</strong> {session.workflowContinuity.handoff.selectedRecoveryReason || "No recovery reason recorded yet."}</p>
                <p><strong>Recommendation handoff summary:</strong> {session.workflowContinuity.handoff.handoffSummary || "No handoff summary recorded yet."}</p>
                <p><strong>Recovery execution summary:</strong> {session.workflowContinuity.handoff.recoveryExecutionSummary || "No recovery execution summary recorded yet."}</p>
                <p><strong>Operator override status:</strong> {session.workflowContinuity.steering.status}</p>
                <p><strong>Operator override:</strong> {session.workflowContinuity.steering.requestedAction || "No operator override recorded yet."}</p>
                <p><strong>Operator override reason:</strong> {session.workflowContinuity.steering.overrideReason || "No override reason recorded yet."}</p>
                <p><strong>Operator note:</strong> {session.workflowContinuity.steering.operatorNote || "No operator note recorded yet."}</p>
                <p><strong>Override blocked reason:</strong> {session.workflowContinuity.steering.blockedReason || "No override block recorded yet."}</p>
                <p><strong>Last refinement note:</strong> {session.workflowContinuity.refinement.lastOperatorRefinementNote || "No refinement note recorded yet."}</p>
                <p><strong>Last override reason:</strong> {session.workflowContinuity.refinement.lastOverrideReason || "No override reason recorded yet."}</p>
                <p><strong>Recent overrides improved progress:</strong> {session.workflowContinuity.refinement.recentOverridesImprovedProgress ? "Yes" : "No"}</p>
                <p><strong>Similar future preference:</strong> {session.workflowContinuity.refinement.similarFuturePreference || "No preference recorded yet."}</p>
                <p><strong>Recommendation influenced by prior guidance:</strong> {session.workflowContinuity.refinement.recommendationInfluencedByRecentGuidance ? "Yes" : "No"}</p>
                <p><strong>Refinement influence reason:</strong> {session.workflowContinuity.refinement.influenceReason || "No refinement influence recorded yet."}</p>
                <p><strong>Refinement summary:</strong> {session.workflowContinuity.refinement.refinementSummary || "No refinement summary recorded yet."}</p>
                {session.latestCompletion ? <p><strong>Completion reason:</strong> {session.latestCompletion.reason}</p> : null}
                {session.pendingAction ? <p><strong>Pending action:</strong> {session.pendingAction.description}</p> : null}
                {session.pendingAction ? <p><strong>Pending action type:</strong> {session.pendingAction.type} ({session.pendingAction.scope})</p> : null}
              </div>

              <div className="rounded-[1.2rem] border border-ink/10 bg-white/70 p-4 text-sm leading-7 text-ink/80">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/45">Operator-assisted recommendation review</p>
                <div className="mt-3 rounded-[1rem] border border-ocean/10 bg-ocean/5 p-4">
                  <p><strong>Current system recommendation:</strong> {session.workflowContinuity.loopHealth.systemRecommendedNextPhase || "No system recommendation recorded yet."}</p>
                  <p><strong>Current recommended next phase:</strong> {session.workflowContinuity.loopHealth.recommendedNextPhase}</p>
                  <p><strong>Current recommendation confidence:</strong> {session.workflowContinuity.loopHealth.recommendationConfidence}</p>
                  <p><strong>Current rationale:</strong> {session.workflowContinuity.loopHealth.recommendationRationaleSummary || "No recommendation rationale recorded yet."}</p>
                  <p><strong>Current top signals:</strong> {session.workflowContinuity.loopHealth.topContributingSignals.length ? session.workflowContinuity.loopHealth.topContributingSignals.join(", ") : "No recommendation signals recorded yet."}</p>
                  <p><strong>Current follow-through:</strong> {session.workflowContinuity.review.lastFollowThroughSummary || "No follow-through summary recorded yet."}</p>
                  <p><strong>Current coding loop:</strong> {session.workflowContinuity.coding.codingSummary || "No coding loop summary recorded yet."}</p>
                  <p><strong>Current escalation:</strong> {session.workflowContinuity.escalation.escalationSummary || "No escalation summary recorded yet."}</p>
                  <p><strong>Current recovery guidance:</strong> {session.workflowContinuity.escalation.recoverySummary || "No recovery guidance recorded yet."}</p>
                  <p><strong>Current handoff:</strong> {session.workflowContinuity.handoff.handoffSummary || "No handoff summary recorded yet."}</p>
                  <p><strong>Current recovery execution:</strong> {session.workflowContinuity.handoff.recoveryExecutionSummary || "No recovery execution summary recorded yet."}</p>
                </div>
                <label className="mt-3 block text-sm font-semibold text-ink">
                  Review response
                  <select
                    value={steeringAction}
                    onChange={(event) => setSteeringAction(event.target.value as AutonomousOperatorSteeringAction | "")}
                    className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm text-ink outline-none transition focus:border-ocean/40"
                  >
                    <option value="">No override</option>
                    <option value="accept-current-recommendation">Accept current recommendation</option>
                    <option value="prefer-validation-next">Prefer validation next</option>
                    <option value="prefer-fix-next">Prefer fix next</option>
                    <option value="restart-from-last-safe-boundary">Restart from last safe boundary</option>
                    <option value="pause-and-wait">Pause and wait for operator input</option>
                    <option value="stop-loop">Stop loop because it is no longer useful</option>
                  </select>
                </label>
                <label className="mt-4 block text-sm font-semibold text-ink">
                  Operator note for next loop step
                  <textarea
                    value={operatorNote}
                    onChange={(event) => setOperatorNote(event.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm text-ink outline-none transition focus:border-ocean/40"
                    placeholder="Record what the next bounded step should pay attention to."
                  />
                </label>
                <label className="mt-4 block text-sm font-semibold text-ink">
                  Override reason
                  <input
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm text-ink outline-none transition focus:border-ocean/40"
                    placeholder="Explain why you are overriding the current recommendation or asking for a stop or restart."
                  />
                </label>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => applySteering(false)}
                    disabled={!sessionId.trim() || runState === "running" || (!steeringAction && !operatorNote.trim())}
                    className="rounded-full border border-ocean/20 bg-ocean/10 px-5 py-3 text-sm font-semibold text-ocean disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save review only
                  </button>
                  <button
                    type="button"
                    onClick={() => resumeSession(session?.status === "awaiting-approval", buildSteeringPayload())}
                    disabled={
                      !canResume
                      || runState === "running"
                      || steeringAction === "pause-and-wait"
                      || steeringAction === "stop-loop"
                    }
                    className="rounded-full border border-gold/30 px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save review and resume
                  </button>
                  <button
                    type="button"
                    onClick={() => applySteering(true)}
                    disabled={!sessionId.trim() || runState === "running"}
                    className="rounded-full border border-ink/10 px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Clear override
                  </button>
                </div>
              </div>

              {session.pendingAction ? (
                <div className="rounded-[1.2rem] border border-gold/30 bg-gold/10 p-4 text-sm leading-7 text-ink/80">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/45">Pending approval</p>
                  <p className="mt-2"><strong>Action:</strong> {session.pendingAction.description}</p>
                  <p><strong>Expected outcome:</strong> {session.pendingAction.expectedOutcome}</p>
                  <p><strong>Scope:</strong> {session.pendingAction.scope}</p>
                </div>
              ) : null}

              <div className="space-y-3">
                {session.steps.map((step) => (
                  <article key={`${step.index}-${step.timestamp}`} className="rounded-[1.2rem] border border-ink/10 bg-white/75 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-sm font-semibold text-ink">Step {step.index}</h3>
                      <span className="text-xs uppercase tracking-[0.22em] text-ink/45">{step.timestamp}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full border border-ink/10 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/65">
                        {step.actionFamily || "unknown lane"}
                      </span>
                      <span className="rounded-full border border-ocean/20 bg-ocean/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ocean">
                        {step.executionAdapterId || "no adapter"}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-ink/85"><strong>Action:</strong> {step.proposedAction || "No bounded action proposed."}</p>
                    <p className="mt-2 text-sm text-ink/80"><strong>Expected:</strong> {step.expectedOutcome || "No expected outcome recorded."}</p>
                    {step.planningHintSummary ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Planning hints:</strong> {step.planningHintSummary}</p>
                    ) : null}
                    {step.adapterContextSummary ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Adapter context:</strong> {step.adapterContextSummary}</p>
                    ) : null}
                    {step.executionNodeId ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Execution node:</strong> {step.executionNodeId} ({step.executionNodeMode || "unknown"})</p>
                    ) : null}
                    {step.nodeCapabilitySummary ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Node capabilities:</strong> {step.nodeCapabilitySummary}</p>
                    ) : null}
                    {step.taskId ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Task ID:</strong> {step.taskId}</p>
                    ) : null}
                    {step.taskStatus ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Task status:</strong> {step.taskStatus}</p>
                    ) : null}
                    {step.assignedNodeId ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Assigned node:</strong> {step.assignedNodeId}</p>
                    ) : null}
                    {step.queueStateSummary ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Queue summary:</strong> {step.queueStateSummary}</p>
                    ) : null}
                    <p className="mt-2 text-sm text-ink/80"><strong>Diagnosis:</strong> {step.diagnosis || "No diagnosis recorded."}</p>
                    <p className="mt-2 text-sm text-ink/80"><strong>Verification:</strong> {step.verificationState || "Unknown"}</p>
                    <p className="mt-2 text-sm text-ink/80"><strong>Decision:</strong> {step.nextDecision || "Unknown"}</p>
                    <p className="mt-2 text-sm text-ink/80"><strong>Goal status:</strong> {step.goalStatus || "Unknown"}</p>
                    <p className="mt-2 text-sm text-ink/80"><strong>Completion confidence:</strong> {step.completionConfidence || "Unknown"}</p>
                    <p className="mt-2 text-sm text-ink/80"><strong>Runtime:</strong> {step.executionResult?.status || "No execution result"}</p>
                    <p className="mt-2 text-sm text-ink/80"><strong>Output:</strong> {step.executionResult?.output || step.executionResult?.error || "No runtime output recorded."}</p>
                    {step.failureClassification ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Failure class:</strong> {step.failureClassification.kind} ({step.failureClassification.severity}) - {step.failureClassification.reason}</p>
                    ) : null}
                    {step.recoveryStrategy ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Recovery strategy:</strong> {step.recoveryStrategy}</p>
                    ) : null}
                    {typeof step.retryCount === "number" ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Retry count:</strong> {step.retryCount}</p>
                    ) : null}
                    {typeof step.repeatedAction === "boolean" ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Repeated action:</strong> {step.repeatedAction ? "Yes" : "No"}</p>
                    ) : null}
                    {typeof step.repeatedOutput === "boolean" ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Repeated output:</strong> {step.repeatedOutput ? "Yes" : "No"}</p>
                    ) : null}
                    {step.stallReason ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Stall reason:</strong> {step.stallReason}</p>
                    ) : null}
                    {step.executionResult?.changedPaths?.length ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Changed paths:</strong> {step.executionResult.changedPaths.join(" | ")}</p>
                    ) : null}
                    {step.executionResult?.diffSummary ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Diff summary:</strong> {step.executionResult.diffSummary}</p>
                    ) : null}
                    {step.executionResult?.commandLabel ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Command:</strong> {step.executionResult.commandLabel}</p>
                    ) : null}
                    {typeof step.executionResult?.exitCode === "number" ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Exit code:</strong> {step.executionResult.exitCode}</p>
                    ) : null}
                    {step.executionResult?.rollback ? (
                      <p className="mt-2 text-sm text-ink/80"><strong>Rollback snapshot:</strong> {step.executionResult.rollback.snapshotId} for {step.executionResult.rollback.targetPath}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}