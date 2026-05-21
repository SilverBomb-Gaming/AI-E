"use client";

import Link from "next/link";
import { useState } from "react";

type ApprovalGateState = "pending" | "approved" | "rejected";

const SEEDED_AFFECTED_FILES = [
  { path: "Assets/Scripts/BasicEnemy.cs", change: "Patch — update patrol AI behavior within bounded scope" },
  { path: "Assets/Scripts/FallRecovery.cs", change: "Patch — fix fall-off recovery logic" },
  { path: "ProjectSettings/ProjectVersion.txt", change: "Read-only — inspected for version validation only" },
];

const SEEDED_COMMAND_POLICY = [
  { rule: "Shell execution",             status: "blocked" as const },
  { rule: "Network requests",            status: "blocked" as const },
  { rule: "File write outside sandbox",  status: "blocked" as const },
  { rule: "Git commits",                 status: "blocked" as const },
  { rule: "Recursive agent invocation",  status: "blocked" as const },
  { rule: "File read in sandbox",        status: "allowed" as const },
  { rule: "Patch preview generation",    status: "allowed" as const },
  { rule: "Lint validation (read-only)", status: "allowed" as const },
];

export function GovernedExecutionPreviewClient() {
  const [approvalState, setApprovalState] = useState<ApprovalGateState>("pending");

  return (
    <main className="page-shell min-h-screen px-6 py-10 lg:px-10 lg:py-14">
      <div className="relative z-10 mx-auto flex max-w-4xl flex-col gap-6">

        {/* Header */}
        <section className="glass-card rounded-[2rem] p-8 shadow-float">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl space-y-4">
              <p className="section-label">AI-E Governed Execution Preview</p>
              <h1 className="headline text-4xl font-semibold text-ink lg:text-5xl">Preview before any execution.</h1>
              <p className="max-w-xl text-base leading-8 body-muted">
                This page shows what a governed operation would do — proposed scope, affected files, command policy, and snapshot state — before any execution is permitted.
                Operator approval gates every step. No runtime has been invoked.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/operator" className="rounded-full border border-ink/10 bg-white/70 px-5 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5">
                Operator Console
              </Link>
            </div>
          </div>
          <div className="mt-6 rounded-[1.5rem] border border-ocean/15 bg-ocean/5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full border border-ocean/20 bg-ocean/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-ocean">
                GOVERNED PREVIEW
              </span>
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-700">
                SEEDED
              </span>
            </div>
            <p className="mt-3 text-sm leading-7 body-muted">
              No execution has occurred. This surface shows governance preview state only. All execution is blocked until the operator explicitly approves and a live runtime is connected.
            </p>
          </div>
        </section>

        {/* Proposed Operation */}
        <section className="glass-card rounded-[2rem] p-6 shadow-float">
          <p className="section-label">Proposed Operation</p>
          <h2 className="headline mt-3 text-2xl font-semibold text-ink">What would be executed?</h2>
          <div className="mt-5 space-y-4">
            <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate">Operation</p>
              <p className="mt-2 text-sm font-semibold text-ink">EnemyAI patrol fix — bounded patch to BasicEnemy.cs</p>
              <p className="mt-1 text-xs text-slate">Proposed by AI-E governance layer. Awaiting operator approval before any execution proceeds.</p>
            </article>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Type</p>
                <p className="mt-2 text-sm font-semibold text-ink">Patch Preview</p>
              </div>
              <div className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Sandbox</p>
                <p className="mt-2 font-mono text-sm text-ink">sandbox-preview-001</p>
              </div>
              <div className="rounded-[1.25rem] border border-coral/15 bg-coral/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Execution</p>
                <p className="mt-2 text-sm font-bold text-ember">BLOCKED</p>
              </div>
            </div>
          </div>
        </section>

        {/* Affected Files */}
        <section className="glass-card rounded-[2rem] p-6 shadow-float">
          <p className="section-label">Affected Files</p>
          <h2 className="headline mt-3 text-2xl font-semibold text-ink">Scope of changes</h2>
          <p className="mt-2 text-sm leading-7 body-muted">
            These files would be modified or read if this operation were approved and executed. No changes have been applied.
          </p>
          <div className="mt-5 space-y-3">
            {SEEDED_AFFECTED_FILES.map((file) => (
              <article key={file.path} className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <p className="font-mono text-sm text-ink">{file.path}</p>
                <p className="mt-1 text-xs text-slate">{file.change}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Command Policy */}
        <section className="glass-card rounded-[2rem] p-6 shadow-float">
          <p className="section-label">Command Policy</p>
          <h2 className="headline mt-3 text-2xl font-semibold text-ink">What is and is not permitted</h2>
          <p className="mt-2 text-sm leading-7 body-muted">
            AI-E enforces a governance boundary for every operation. These rules apply to this preview lane regardless of approval state.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {SEEDED_COMMAND_POLICY.map((item) => (
              <div
                key={item.rule}
                className={`rounded-[1.25rem] border px-4 py-3 ${item.status === "blocked" ? "border-coral/15 bg-coral/5" : "border-emerald-200 bg-emerald-50/70"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-ink">{item.rule}</p>
                  <span className={`text-xs font-bold uppercase tracking-[0.12em] ${item.status === "blocked" ? "text-ember" : "text-emerald-700"}`}>
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Snapshot & Receipt */}
        <section className="glass-card rounded-[2rem] p-6 shadow-float">
          <p className="section-label">Snapshot & Receipt</p>
          <h2 className="headline mt-3 text-2xl font-semibold text-ink">Pre-execution state</h2>
          <p className="mt-2 text-sm leading-7 body-muted">
            A snapshot would be taken before any bounded operation proceeds. This allows full rollback if the operation is later rejected or fails.
          </p>
          <div className="mt-5 space-y-3">
            <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate">Pre-execution Snapshot</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <p className="text-xs text-slate">Snapshot ID: snap-preview-001 <span className="text-amber-600">(seeded)</span></p>
                <p className="text-xs text-slate">Taken at: 2026-05-21T00:00:00Z</p>
                <p className="text-xs text-slate">Files hashed: {SEEDED_AFFECTED_FILES.length}</p>
                <p className="text-xs text-slate">Rollback state: ready</p>
              </div>
            </article>
            <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate">Execution Receipt</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <p className="text-xs text-slate">Receipt ID: receipt-preview-001 <span className="text-amber-600">(seeded)</span></p>
                <p className="text-xs text-slate">Status: pre-execution</p>
                <p className="text-xs text-slate">Execution: not started</p>
                <p className="text-xs text-slate">Outcome: pending operator approval</p>
              </div>
            </article>
          </div>
        </section>

        {/* Approval Gate */}
        <section className="glass-card rounded-[2rem] p-6 shadow-float">
          <p className="section-label">Approval Gate</p>
          <h2 className="headline mt-3 text-2xl font-semibold text-ink">Operator authority required</h2>
          <p className="mt-2 text-sm leading-7 body-muted">
            No execution proceeds without explicit operator approval. The gate shown here is a governance preview demonstration only — in a connected live runtime, approval would be enforced by the AI-E governance layer.
          </p>
          <div className="mt-5 space-y-4">
            <article className={`rounded-[1.5rem] border p-4 ${approvalState === "pending" ? "border-amber-200 bg-amber-50/70" : approvalState === "approved" ? "border-emerald-200 bg-emerald-50/70" : "border-coral/20 bg-coral/10"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${approvalState === "pending" ? "border-amber-200 bg-amber-50 text-amber-700" : approvalState === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-coral/20 bg-coral/10 text-ember"}`}>
                  {approvalState}
                </span>
                <span className="text-xs uppercase tracking-[0.18em] text-slate">Approval Gate</span>
              </div>
              <p className="mt-3 text-sm leading-7 body-muted">
                {approvalState === "pending"
                  ? "This governed operation is awaiting explicit operator approval. No execution will proceed without it."
                  : approvalState === "approved"
                    ? "Operator approval granted for this preview demonstration. In a live runtime, this would permit the bounded operation to proceed within governance constraints."
                    : "Operator rejected this proposed operation. No execution will occur."}
              </p>
            </article>

            {approvalState === "pending" ? (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => { setApprovalState("approved"); }}
                  className="rounded-full border border-emerald-200 bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
                >
                  Grant Approval
                </button>
                <button
                  type="button"
                  onClick={() => { setApprovalState("rejected"); }}
                  className="rounded-full border border-coral/20 bg-coral px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
                >
                  Reject
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setApprovalState("pending"); }}
                className="rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
              >
                Reset Gate
              </button>
            )}
          </div>
        </section>

        {/* Footer */}
        <p className="text-center text-xs text-slate">
          AI-E Governed Execution Preview · No execution has occurred · All operations require operator approval · Data shown is seeded demo state
        </p>

      </div>
    </main>
  );
}
