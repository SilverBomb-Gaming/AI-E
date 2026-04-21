"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { AutonomousSession } from "@/lib/aie/autonomousSession";

type RunState = "idle" | "running" | "failed";

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
  const [runState, setRunState] = useState<RunState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshRecentSessions();
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
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The autonomous session could not be loaded.");
    }
  }

  async function resumeSession(approved: boolean) {
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
        body: JSON.stringify({ approved }),
      });
      const payload = (await response.json()) as { error?: string; session?: AutonomousSession };

      if (!response.ok || !payload.session) {
        throw new Error(payload.error || "The autonomous session could not be resumed.");
      }

      setSession(payload.session);
      setSessionId(payload.session.sessionId);
      await refreshRecentSessions();
      setRunState("idle");
    } catch (nextError) {
      setRunState("failed");
      setError(nextError instanceof Error ? nextError.message : "The autonomous session could not be resumed.");
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
                <p><strong>Planning hints:</strong> {session.planningHintSummary || "No planning hints recorded yet."}</p>
                <p><strong>Adapter context:</strong> {session.adapterContextSummary || "No adapter context recorded yet."}</p>
                {session.latestCompletion ? <p><strong>Completion reason:</strong> {session.latestCompletion.reason}</p> : null}
                {session.pendingAction ? <p><strong>Pending action:</strong> {session.pendingAction.description}</p> : null}
                {session.pendingAction ? <p><strong>Pending action type:</strong> {session.pendingAction.type} ({session.pendingAction.scope})</p> : null}
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