"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import {
  GOVERNED_PREVIEW_RESOLUTION,
  type GovernedPreviewFormInput,
  type GovernedPreviewRequest,
} from "@/lib/aie/governedPreviewGenerationContract";
import type {
  GovernedPreviewExecutionResult,
  GovernedPreviewMicroSequenceResult,
  GovernedPreviewPrerequisiteState,
  GovernedPreviewRollbackResult,
} from "@/lib/aie/governedPreviewGeneration";

const DEFAULT_FORM: GovernedPreviewFormInput = {
  prompt: "",
  subject: "",
  motion_intent: "",
  style: "",
  duration_seconds: 2,
  resolution: GOVERNED_PREVIEW_RESOLUTION,
  continuity_priority: "medium",
  governance_approval: false,
};

function FieldLabel({ children }: { children: string }) {
  return <span className="text-xs uppercase tracking-[0.18em] text-slate">{children}</span>;
}

function StatusPill({ label, tone }: { label: string; tone: "ok" | "warn" | "blocked" | "default" }) {
  const toneClassName = tone === "ok"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : tone === "blocked"
        ? "border-coral/20 bg-coral/10 text-ember"
        : "border-ink/10 bg-white text-ink/75";

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${toneClassName}`}>{label}</span>;
}

export function PreviewGenerationClient() {
  const [form, setForm] = useState<GovernedPreviewFormInput>(DEFAULT_FORM);
  const [compiledRequest, setCompiledRequest] = useState<GovernedPreviewRequest | null>(null);
  const [execution, setExecution] = useState<GovernedPreviewExecutionResult | null>(null);
  const [microSequence, setMicroSequence] = useState<GovernedPreviewMicroSequenceResult | null>(null);
  const [prerequisiteState, setPrerequisiteState] = useState<GovernedPreviewPrerequisiteState | null>(null);
  const [rollback, setRollback] = useState<GovernedPreviewRollbackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("Governed preview interface ready. Manual approval remains required.");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/operator/preview-generation", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as {
          error?: string;
          prerequisiteState?: GovernedPreviewPrerequisiteState;
        };

        if (!response.ok || !payload.prerequisiteState) {
          throw new Error(payload.error ?? "We couldn't load the governed preview prerequisite state.");
        }

        if (cancelled) {
          return;
        }

        setPrerequisiteState(payload.prerequisiteState);
        setMessage(payload.prerequisiteState.motion_preview_ready
          ? "Governed micro-sequence prerequisite satisfied. Motion preview generation is available."
          : "Governed motion preview is blocked until the micro-sequence continuity prerequisite is satisfied.");
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "We couldn't load the governed preview prerequisite state.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function updateField<Key extends keyof GovernedPreviewFormInput>(key: Key, value: GovernedPreviewFormInput[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleGenerate() {
    setError(null);
    setRollback(null);
    startTransition(() => {
      void fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "generate", input: form }),
      })
        .then(async (response) => {
          const payload = await response.json() as {
            error?: string;
            compiledRequest?: GovernedPreviewRequest;
            execution?: GovernedPreviewExecutionResult;
            prerequisiteState?: GovernedPreviewPrerequisiteState;
          };

          if (!response.ok || !payload.compiledRequest || !payload.execution) {
            throw new Error(payload.error ?? "Governed preview generation failed.");
          }

          setCompiledRequest(payload.compiledRequest);
          setExecution(payload.execution);
          setMicroSequence(null);
          setPrerequisiteState(payload.prerequisiteState ?? payload.execution.prerequisite_state);
          setMessage(payload.execution.status === "accepted"
            ? "Governed preview request accepted inside the low-duration sandbox."
            : payload.execution.blockers.includes("micro-sequence-prerequisite")
              ? "Governed motion preview is blocked until the micro-sequence continuity prerequisite is satisfied."
              : "Governed preview request blocked by approval or compile-time safety checks.");
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Governed preview generation failed.");
        });
    });
  }

  function handleGenerateMicroSequence() {
    setError(null);
    setRollback(null);
    startTransition(() => {
      void fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "generate-micro-sequence", input: form }),
      })
        .then(async (response) => {
          const payload = await response.json() as {
            error?: string;
            compiledRequest?: GovernedPreviewRequest;
            microSequence?: GovernedPreviewMicroSequenceResult;
            prerequisiteState?: GovernedPreviewPrerequisiteState;
          };

          if (!response.ok || !payload.compiledRequest || !payload.microSequence) {
            throw new Error(payload.error ?? "Governed micro-sequence generation failed.");
          }

          setCompiledRequest(payload.compiledRequest);
          setExecution(null);
          setMicroSequence(payload.microSequence);
          setPrerequisiteState(payload.prerequisiteState ?? payload.microSequence.prerequisite_state);
          setMessage(payload.microSequence.status === "generated"
            ? "Governed micro-sequence continuity preview generated. Motion preview can be retried once continuity remains green."
            : payload.microSequence.request.blockers.length > 0
              ? "Governed micro-sequence generation remains blocked by approval or compile-time safety checks."
              : `Governed micro-sequence continuity preview ran, but motion preview remains blocked by ${payload.microSequence.blockers.join(", ") || "continuity validation blockers"}.`);
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Governed micro-sequence generation failed.");
        });
    });
  }

  function handleRollback() {
    setError(null);
    startTransition(() => {
      void fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "rollback" }),
      })
        .then(async (response) => {
          const payload = await response.json() as {
            error?: string;
            rollback?: GovernedPreviewRollbackResult;
          };
          if (!response.ok || !payload.rollback) {
            throw new Error(payload.error ?? "Governed preview rollback failed.");
          }
          setRollback(payload.rollback);
          setMessage(payload.rollback.status === "rolled_back"
            ? "Governed preview sandbox rollback completed."
            : "No governed preview sandbox outputs were present to clear.");
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Governed preview rollback failed.");
        });
    });
  }

  const statusTone = execution?.status === "accepted"
    ? "ok"
    : execution?.status === "blocked"
      ? "blocked"
      : "default";
  const motionPreviewReady = prerequisiteState?.motion_preview_ready === true;
  const latestMicroSequenceFrameReferences = microSequence?.generated_frame_references.length
    ? microSequence.generated_frame_references
    : (prerequisiteState?.generated_frame_references ?? []);
  const showGenerateMicroSequenceCta = !motionPreviewReady
    || execution?.blockers.includes("micro-sequence-prerequisite")
    || microSequence?.status === "blocked";

  return (
    <main className="page-shell min-h-screen bg-mist/80">
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-12 lg:px-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-label">Operator Surface</p>
            <h1 className="headline mt-3 text-4xl font-semibold text-ink">Governed Preview Generation</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 body-muted">
              Low-duration preview only. Low-resolution only. Manual approval required. No autonomous rendering. No long-form video yet. Rollback enabled.
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/operator" className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:-translate-y-0.5">
              Operator Dashboard
            </Link>
            <Link href="/" className="rounded-full border border-ocean/20 bg-ocean px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5">
              Front Door
            </Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <section className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Request Form</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 md:col-span-2">
                <FieldLabel>Prompt</FieldLabel>
                <textarea
                  value={form.prompt}
                  onChange={(event) => updateField("prompt", event.target.value)}
                  rows={6}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-3 text-sm text-ink outline-none"
                  placeholder="Describe the governed preview clip you want to sandbox."
                />
              </label>

              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <FieldLabel>Subject</FieldLabel>
                <input
                  value={form.subject}
                  onChange={(event) => updateField("subject", event.target.value)}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none"
                  placeholder="Primary subject"
                />
              </label>

              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <FieldLabel>Motion</FieldLabel>
                <input
                  value={form.motion_intent}
                  onChange={(event) => updateField("motion_intent", event.target.value)}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none"
                  placeholder="Bounded motion intent"
                />
              </label>

              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <FieldLabel>Style</FieldLabel>
                <input
                  value={form.style}
                  onChange={(event) => updateField("style", event.target.value)}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none"
                  placeholder="Visual style"
                />
              </label>

              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <FieldLabel>Continuity Priority</FieldLabel>
                <select
                  value={form.continuity_priority}
                  onChange={(event) => updateField("continuity_priority", event.target.value as GovernedPreviewFormInput["continuity_priority"])}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>

              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <FieldLabel>Resolution</FieldLabel>
                <select
                  value={form.resolution}
                  onChange={(event) => updateField("resolution", event.target.value)}
                  disabled
                  className="rounded-xl border border-ink/10 bg-sand px-3 py-2 text-sm text-ink outline-none disabled:cursor-not-allowed"
                >
                  <option value={GOVERNED_PREVIEW_RESOLUTION}>{GOVERNED_PREVIEW_RESOLUTION}</option>
                </select>
              </label>

              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <FieldLabel>Duration</FieldLabel>
                <select
                  value={String(form.duration_seconds)}
                  onChange={(event) => updateField("duration_seconds", Number(event.target.value))}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none"
                >
                  <option value="1">1 second</option>
                  <option value="2">2 seconds</option>
                </select>
              </label>

              <label className="flex items-start gap-3 rounded-[1.25rem] border border-coral/20 bg-white/80 p-4 md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.governance_approval}
                  onChange={(event) => updateField("governance_approval", event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border border-ink/10"
                />
                <div>
                  <FieldLabel>Manual Approval</FieldLabel>
                  <p className="mt-2 text-sm leading-7 body-muted">I confirm this request should trigger only the governed low-duration preview sandbox with rollback available and no autonomous continuation.</p>
                </div>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isPending || !motionPreviewReady}
                className="rounded-full border border-ocean/20 bg-ocean px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate Preview
              </button>
              <button
                type="button"
                onClick={handleGenerateMicroSequence}
                disabled={isPending}
                className="rounded-full border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-700 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate Micro-Sequence First
              </button>
              <button
                type="button"
                onClick={handleRollback}
                disabled={isPending}
                className="rounded-full border border-coral/20 bg-coral px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear Preview Sandbox
              </button>
            </div>
            {!motionPreviewReady ? (
              <p className="mt-4 rounded-[1.25rem] border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-700">
                Motion preview generation stays disabled until the governed micro-sequence exists and frame-to-frame continuity validation passes.
              </p>
            ) : null}
          </section>

          <section className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Execution Status</p>
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill label={execution?.status ?? "idle"} tone={statusTone} />
                <StatusPill label={isPending ? "pending" : "ready"} tone={isPending ? "warn" : "default"} />
                <StatusPill label={motionPreviewReady ? "prerequisite-ready" : "prerequisite-required"} tone={motionPreviewReady ? "ok" : "warn"} />
              </div>
              <p className="text-sm leading-7 body-muted">{message}</p>
              {error ? <p className="rounded-[1.25rem] border border-coral/20 bg-coral/10 p-4 text-sm text-ember">{error}</p> : null}
              {compiledRequest ? (
                <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Governance status:</strong> {execution?.governance_status ?? (compiledRequest.manual_approval_granted ? "Approved" : "Approval missing")}</p>
                  <p><strong className="text-ink">Compiled request:</strong> {compiledRequest.request_id}</p>
                  <p><strong className="text-ink">Duration:</strong> {compiledRequest.duration_seconds}s</p>
                  <p><strong className="text-ink">Resolution:</strong> {compiledRequest.resolution}</p>
                  <p><strong className="text-ink">No autonomous continuation:</strong> {compiledRequest.autonomous_continuation_allowed ? "no" : "yes"}</p>
                </article>
              ) : null}
              {prerequisiteState ? (
                <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Micro-sequence exists:</strong> {prerequisiteState.micro_sequence_exists ? "yes" : "no"}</p>
                  <p><strong className="text-ink">Motion preview ready:</strong> {prerequisiteState.motion_preview_ready ? "yes" : "no"}</p>
                  <p><strong className="text-ink">Continuity validation:</strong> {prerequisiteState.continuity_validation.valid ? "passed" : "blocked"}</p>
                  <p><strong className="text-ink">Continuity summary:</strong> {prerequisiteState.continuity_validation.summary}</p>
                </article>
              ) : null}
              {showGenerateMicroSequenceCta ? (
                <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-700">
                  <p className="font-semibold text-amber-800">Next step required before motion preview</p>
                  <p className="mt-2">Use the governed micro-sequence continuity preview to satisfy the prerequisite before generating a motion preview clip.</p>
                  <button
                    type="button"
                    onClick={handleGenerateMicroSequence}
                    disabled={isPending}
                    className="mt-4 rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-700 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Generate Micro-Sequence First
                  </button>
                </div>
              ) : null}
              {execution ? (
                <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Sandbox path:</strong> {execution.sandbox_path ?? "not created"}</p>
                  <p><strong className="text-ink">Sandbox root:</strong> {execution.sandbox_output_root ?? "not created"}</p>
                  <p><strong className="text-ink">Manifest:</strong> {execution.manifest_file_path ?? "not created"}</p>
                  <p><strong className="text-ink">Rollback:</strong> {execution.rollback_status}</p>
                  <p><strong className="text-ink">Execution ledger:</strong> {execution.execution_ledger_state.ledger_id ?? "no ledger"} | attempts={execution.execution_ledger_state.attempt_count}</p>
                  <p><strong className="text-ink">Live workspace blocked output:</strong> {execution.live_workspace_blocked_output ? "yes" : "no"}</p>
                  <p><strong className="text-ink">Continuity validation:</strong> {execution.continuity_validation.valid ? "passed" : "blocked"}</p>
                  <p><strong className="text-ink">Continuity summary:</strong> {execution.continuity_validation.summary}</p>
                </article>
              ) : null}
              {microSequence ? (
                <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Micro-sequence sandbox:</strong> {microSequence.sandbox_path ?? "not created"}</p>
                  <p><strong className="text-ink">Sandbox root:</strong> {microSequence.sandbox_output_root ?? "not created"}</p>
                  <p><strong className="text-ink">Continuity validation:</strong> {microSequence.continuity_validation.valid ? "passed" : "blocked"}</p>
                  <p><strong className="text-ink">Continuity summary:</strong> {microSequence.continuity_validation.summary}</p>
                  <p><strong className="text-ink">Preview cleanup after prerequisite run:</strong> {microSequence.rollback_status || "No preview cleanup actions were required."}</p>
                </article>
              ) : null}
              {rollback ? (
                <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Rollback status:</strong> {rollback.rollback_status}</p>
                  <p><strong className="text-ink">Sandbox-only cleanup:</strong> {rollback.sandbox_limited ? "yes" : "no"}</p>
                  <p><strong className="text-ink">Clip directory:</strong> {rollback.sandbox_path ?? "none"}</p>
                </article>
              ) : null}
            </div>
          </section>
        </div>

        <section className="mt-6 grid gap-6 lg:grid-cols-3">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Micro-Sequence Frames</p>
            <div className="mt-5 space-y-3 text-sm leading-7 body-muted">
              {latestMicroSequenceFrameReferences.length ? (
                <ul className="space-y-2">
                  {latestMicroSequenceFrameReferences.map((reference) => (
                    <li key={reference} className="rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3">{reference}</li>
                  ))}
                </ul>
              ) : (
                <p>{microSequence?.sandbox_path ? "No governed micro-sequence frame files were produced for the latest prerequisite run." : "No governed micro-sequence frames are available yet."}</p>
              )}
            </div>
          </article>

          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Preview Outputs</p>
            <div className="mt-5 space-y-3 text-sm leading-7 body-muted">
              {execution?.generated_preview_references.length ? (
                <ul className="space-y-2">
                  {execution.generated_preview_references.map((reference) => (
                    <li key={reference} className="rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3">{reference}</li>
                  ))}
                </ul>
              ) : (
                <p>No governed preview files are available yet.</p>
              )}
            </div>
          </article>

          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Blockers And Rollback</p>
            <div className="mt-5 space-y-3 text-sm leading-7 body-muted">
              {prerequisiteState?.continuity_validation.blockers.length ? (
                <ul className="space-y-2">
                  {prerequisiteState.continuity_validation.blockers.map((blocker) => (
                    <li key={`continuity-${blocker}`} className="rounded-[1rem] border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">{blocker}</li>
                  ))}
                </ul>
              ) : null}
              {execution?.blockers.length ? (
                <ul className="space-y-2">
                  {execution.blockers.map((blocker) => (
                    <li key={blocker} className="rounded-[1rem] border border-coral/20 bg-coral/10 px-4 py-3 text-ember">{blocker}</li>
                  ))}
                </ul>
              ) : (
                <p>No active preview blockers are recorded.</p>
              )}
              {rollback?.deleted_output_targets.length ? (
                <ul className="space-y-2">
                  {rollback.deleted_output_targets.map((target) => (
                    <li key={target} className="rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3">{target}</li>
                  ))}
                </ul>
              ) : (
                <p>Rollback stays limited to preview sandbox outputs only.</p>
              )}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}