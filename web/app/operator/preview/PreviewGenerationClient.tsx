"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import {
  GOVERNED_PREVIEW_RESOLUTION,
  type GovernedPreviewFormInput,
  type GovernedPreviewRequest,
} from "@/lib/aie/governedPreviewGenerationContract";
import type {
  CinematicGovernedPreviewDiagnostics,
  CinematicGovernedPreviewFrameDiagnostic,
  CinematicGovernedPreviewQualityIndicator,
} from "@/lib/aie/cinematicProductionMemory";
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
  package_gif_preview: true,
};

type PreviewGalleryCard = {
  id: string;
  label: string;
  source: "micro-sequence" | "motion-preview";
  format: "png" | "gif";
  assetPath: string;
  assetUrl: string;
  frameIndex: number | null;
  diagnostic: CinematicGovernedPreviewFrameDiagnostic | null;
};

function buildSandboxAssetUrl(assetPath: string): string {
  return `/api/operator/preview-generation/asset?path=${encodeURIComponent(assetPath)}`;
}

function extractFrameIndex(assetPath: string): number | null {
  const match = assetPath.match(/_(\d{3})\.(ppm|png)$/i);
  return match ? Number(match[1]) : null;
}

function buildFrameDiagnosticMap(diagnostics: CinematicGovernedPreviewDiagnostics | null | undefined): Map<number, CinematicGovernedPreviewFrameDiagnostic> {
  return new Map((diagnostics?.frame_diagnostics ?? []).map((entry) => [entry.frame_index, entry]));
}

function buildGalleryCards(
  assetPaths: string[],
  source: PreviewGalleryCard["source"],
  diagnostics?: CinematicGovernedPreviewDiagnostics | null,
): PreviewGalleryCard[] {
  const diagnosticMap = buildFrameDiagnosticMap(diagnostics);
  return assetPaths
    .filter((assetPath) => assetPath.endsWith(".png") || assetPath.endsWith(".gif"))
    .map((assetPath) => {
      const frameIndex = extractFrameIndex(assetPath);
      const format = assetPath.endsWith(".gif") ? "gif" : "png";
      const label = format === "gif"
        ? source === "motion-preview"
          ? "Governed motion preview GIF"
          : "Governed micro-sequence GIF"
        : frameIndex !== null
          ? `${source === "motion-preview" ? "Preview" : "Sequence"} frame ${String(frameIndex).padStart(3, "0")}`
          : `${source} preview asset`;

      return {
        id: `${source}-${assetPath}`,
        label,
        source,
        format,
        assetPath,
        assetUrl: buildSandboxAssetUrl(assetPath),
        frameIndex,
        diagnostic: frameIndex !== null ? (diagnosticMap.get(frameIndex) ?? null) : null,
      };
    });
}

function indicatorTone(score: number): "ok" | "warn" | "blocked" {
  if (score >= 88) {
    return "ok";
  }
  if (score >= 76) {
    return "warn";
  }
  return "blocked";
}

function DiagnosticIndicatorCard({ indicator }: { indicator: CinematicGovernedPreviewQualityIndicator }) {
  return (
    <article className="rounded-[1.25rem] border border-ink/10 bg-white/90 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{indicator.label}</p>
        <StatusPill label={`${indicator.score}/100`} tone={indicatorTone(indicator.score)} />
      </div>
      <p className="mt-3 text-sm leading-7 body-muted">{indicator.summary}</p>
    </article>
  );
}

function DiagnosticsOverview({ diagnostics }: { diagnostics: CinematicGovernedPreviewDiagnostics }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {diagnostics.continuity_quality_indicators.map((indicator) => (
          <DiagnosticIndicatorCard key={indicator.id} indicator={indicator} />
        ))}
      </div>
      <div className="rounded-[1.25rem] border border-ink/10 bg-white/90 p-4 text-sm leading-7 body-muted">
        <p><strong className="text-ink">Recognizable object:</strong> {diagnostics.recognizable_object}</p>
        <p><strong className="text-ink">Relationships:</strong> {diagnostics.object_relationship_summary}</p>
        <p><strong className="text-ink">Environment:</strong> {diagnostics.environment_profile}</p>
        <p><strong className="text-ink">Lighting:</strong> {diagnostics.lighting_profile}</p>
        <p><strong className="text-ink">Beacon influence:</strong> {diagnostics.beacon_influence_summary}</p>
        <p><strong className="text-ink">Environmental response:</strong> {diagnostics.environmental_response_summary}</p>
        <p><strong className="text-ink">Reflection and shadow:</strong> {diagnostics.reflection_shadow_summary}</p>
        <p><strong className="text-ink">Believability:</strong> {diagnostics.scene_believability_summary}</p>
        {diagnostics.shot_engine_summary ? <p><strong className="text-ink">Shot engine:</strong> {diagnostics.shot_engine_summary}</p> : null}
        {diagnostics.camera_governance_summary ? <p><strong className="text-ink">Camera governance:</strong> {diagnostics.camera_governance_summary}</p> : null}
        {diagnostics.articulated_entity_summary ? <p><strong className="text-ink">Articulated entity:</strong> {diagnostics.articulated_entity_summary}</p> : null}
        {diagnostics.pose_governance_summary ? <p><strong className="text-ink">Pose governance:</strong> {diagnostics.pose_governance_summary}</p> : null}
        {diagnostics.active_entity_type ? <p><strong className="text-ink">Entity type:</strong> {diagnostics.active_entity_type}</p> : null}
        {typeof diagnostics.joint_count === "number" ? <p><strong className="text-ink">Joint count:</strong> {diagnostics.joint_count}</p> : null}
        {typeof diagnostics.max_chain_depth === "number" ? <p><strong className="text-ink">Max chain depth:</strong> {diagnostics.max_chain_depth}</p> : null}
        {typeof diagnostics.joint_continuity_score === "number" ? <p><strong className="text-ink">Joint continuity:</strong> {diagnostics.joint_continuity_score}/100</p> : null}
        {typeof diagnostics.pose_stability_score === "number" ? <p><strong className="text-ink">Pose stability:</strong> {diagnostics.pose_stability_score}/100</p> : null}
        {typeof diagnostics.silhouette_readability_score === "number" ? <p><strong className="text-ink">Silhouette readability:</strong> {diagnostics.silhouette_readability_score}/100</p> : null}
        {typeof diagnostics.entity_spatial_persistence_score === "number" ? <p><strong className="text-ink">Entity spatial persistence:</strong> {diagnostics.entity_spatial_persistence_score}/100</p> : null}
        {typeof diagnostics.entity_camera_framing_compatibility_score === "number" ? <p><strong className="text-ink">Entity-camera framing:</strong> {diagnostics.entity_camera_framing_compatibility_score}/100</p> : null}
        {typeof diagnostics.rejected_pose_transition_count === "number" ? <p><strong className="text-ink">Rejected pose transitions:</strong> {diagnostics.rejected_pose_transition_count}</p> : null}
        {diagnostics.rollback_integrity_status ? <p><strong className="text-ink">Rollback integrity:</strong> {diagnostics.rollback_integrity_status}</p> : null}
        <p><strong className="text-ink">Camera:</strong> {diagnostics.camera_profile}</p>
        <p><strong className="text-ink">Continuity anchor:</strong> {diagnostics.continuity_anchor_visualization}</p>
        <p><strong className="text-ink">Scene overlay:</strong> {diagnostics.scene_readability_overlay}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {diagnostics.artifact_diagnostics.map((entry) => (
          <div key={entry} className="rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm leading-7 body-muted">{entry}</div>
        ))}
      </div>
    </div>
  );
}

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
  const activeDiagnostics = execution?.preview_diagnostics ?? microSequence?.preview_diagnostics ?? prerequisiteState?.preview_diagnostics ?? null;
  const microSequenceGalleryCards = buildGalleryCards(latestMicroSequenceFrameReferences, "micro-sequence", microSequence?.preview_diagnostics ?? prerequisiteState?.preview_diagnostics);
  const previewGalleryCards = buildGalleryCards(execution?.generated_preview_references ?? [], "motion-preview", execution?.preview_diagnostics);
  const motionPreviewFrameCards = previewGalleryCards.filter((entry) => entry.format === "png");
  const comparisonCards = motionPreviewFrameCards.length >= 2
    ? [motionPreviewFrameCards[0], motionPreviewFrameCards[motionPreviewFrameCards.length - 1]]
    : microSequenceGalleryCards.filter((entry) => entry.format === "png").length >= 2
      ? [microSequenceGalleryCards.filter((entry) => entry.format === "png")[0], microSequenceGalleryCards.filter((entry) => entry.format === "png").at(-1)!]
      : [];
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

              <label className="flex items-start gap-3 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.package_gif_preview}
                  onChange={(event) => updateField("package_gif_preview", event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border border-ink/10"
                />
                <div>
                  <FieldLabel>Optional GIF Packaging</FieldLabel>
                  <p className="mt-2 text-sm leading-7 body-muted">Package a browser-friendly governed GIF inside the same sandbox directory for bounded continuity and motion inspection.</p>
                </div>
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
                  {prerequisiteState.preview_diagnostics ? <p><strong className="text-ink">Frame coherence:</strong> {prerequisiteState.preview_diagnostics.frame_coherence_score}/100</p> : null}
                  {prerequisiteState.preview_diagnostics ? <p><strong className="text-ink">Camera stability:</strong> {prerequisiteState.preview_diagnostics.camera_stability_score}/100</p> : null}
                  {prerequisiteState.preview_diagnostics ? <p><strong className="text-ink">Environment coherence:</strong> {prerequisiteState.preview_diagnostics.environment_coherence_score}/100</p> : null}
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
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Motion smoothness:</strong> {execution.preview_diagnostics.motion_smoothness_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Multi-object coherence:</strong> {execution.preview_diagnostics.multi_object_coherence_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Spacing consistency:</strong> {execution.preview_diagnostics.spacing_consistency_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Depth ordering:</strong> {execution.preview_diagnostics.depth_ordering_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Overlap avoidance:</strong> {execution.preview_diagnostics.overlap_avoidance_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Interaction staging:</strong> {execution.preview_diagnostics.interaction_staging_score}/100</p> : null}
                  {execution.preview_diagnostics?.camera_drift_stability_score ? <p><strong className="text-ink">Camera drift stability:</strong> {execution.preview_diagnostics.camera_drift_stability_score}/100</p> : null}
                  {execution.preview_diagnostics?.framing_persistence_score ? <p><strong className="text-ink">Framing persistence:</strong> {execution.preview_diagnostics.framing_persistence_score}/100</p> : null}
                  {execution.preview_diagnostics?.horizon_stability_score ? <p><strong className="text-ink">Horizon stability:</strong> {execution.preview_diagnostics.horizon_stability_score}/100</p> : null}
                  {execution.preview_diagnostics?.shot_transition_smoothness_score ? <p><strong className="text-ink">Shot transition smoothness:</strong> {execution.preview_diagnostics.shot_transition_smoothness_score}/100</p> : null}
                  {execution.preview_diagnostics?.composition_coherence_score ? <p><strong className="text-ink">Composition coherence:</strong> {execution.preview_diagnostics.composition_coherence_score}/100</p> : null}
                  {execution.preview_diagnostics?.camera_continuity_score ? <p><strong className="text-ink">Camera continuity:</strong> {execution.preview_diagnostics.camera_continuity_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.joint_continuity_score === "number" ? <p><strong className="text-ink">Joint continuity:</strong> {execution.preview_diagnostics.joint_continuity_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.pose_stability_score === "number" ? <p><strong className="text-ink">Pose stability:</strong> {execution.preview_diagnostics.pose_stability_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.silhouette_readability_score === "number" ? <p><strong className="text-ink">Silhouette readability:</strong> {execution.preview_diagnostics.silhouette_readability_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.entity_spatial_persistence_score === "number" ? <p><strong className="text-ink">Entity spatial persistence:</strong> {execution.preview_diagnostics.entity_spatial_persistence_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.entity_camera_framing_compatibility_score === "number" ? <p><strong className="text-ink">Entity-camera framing:</strong> {execution.preview_diagnostics.entity_camera_framing_compatibility_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.rejected_pose_transition_count === "number" ? <p><strong className="text-ink">Rejected pose transitions:</strong> {execution.preview_diagnostics.rejected_pose_transition_count}</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Camera stability:</strong> {execution.preview_diagnostics.camera_stability_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Spatial continuity:</strong> {execution.preview_diagnostics.spatial_continuity_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Lighting consistency:</strong> {execution.preview_diagnostics.lighting_consistency_score}/100</p> : null}
                </article>
              ) : null}
              {microSequence ? (
                <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Micro-sequence sandbox:</strong> {microSequence.sandbox_path ?? "not created"}</p>
                  <p><strong className="text-ink">Sandbox root:</strong> {microSequence.sandbox_output_root ?? "not created"}</p>
                  <p><strong className="text-ink">Continuity validation:</strong> {microSequence.continuity_validation.valid ? "passed" : "blocked"}</p>
                  <p><strong className="text-ink">Continuity summary:</strong> {microSequence.continuity_validation.summary}</p>
                  {microSequence.preview_diagnostics ? <p><strong className="text-ink">Object fidelity:</strong> {microSequence.preview_diagnostics.object_fidelity_score}/100</p> : null}
                  {microSequence.preview_diagnostics ? <p><strong className="text-ink">Environment coherence:</strong> {microSequence.preview_diagnostics.environment_coherence_score}/100</p> : null}
                  {microSequence.preview_diagnostics ? <p><strong className="text-ink">Multi-object coherence:</strong> {microSequence.preview_diagnostics.multi_object_coherence_score}/100</p> : null}
                  {microSequence.preview_diagnostics ? <p><strong className="text-ink">Spacing consistency:</strong> {microSequence.preview_diagnostics.spacing_consistency_score}/100</p> : null}
                  {microSequence.preview_diagnostics?.camera_drift_stability_score ? <p><strong className="text-ink">Camera drift stability:</strong> {microSequence.preview_diagnostics.camera_drift_stability_score}/100</p> : null}
                  {microSequence.preview_diagnostics?.framing_persistence_score ? <p><strong className="text-ink">Framing persistence:</strong> {microSequence.preview_diagnostics.framing_persistence_score}/100</p> : null}
                  {microSequence.preview_diagnostics?.shot_transition_smoothness_score ? <p><strong className="text-ink">Shot transition smoothness:</strong> {microSequence.preview_diagnostics.shot_transition_smoothness_score}/100</p> : null}
                  {typeof microSequence.preview_diagnostics?.joint_continuity_score === "number" ? <p><strong className="text-ink">Joint continuity:</strong> {microSequence.preview_diagnostics.joint_continuity_score}/100</p> : null}
                  {typeof microSequence.preview_diagnostics?.pose_stability_score === "number" ? <p><strong className="text-ink">Pose stability:</strong> {microSequence.preview_diagnostics.pose_stability_score}/100</p> : null}
                  {typeof microSequence.preview_diagnostics?.silhouette_readability_score === "number" ? <p><strong className="text-ink">Silhouette readability:</strong> {microSequence.preview_diagnostics.silhouette_readability_score}/100</p> : null}
                  {microSequence.preview_diagnostics ? <p><strong className="text-ink">Interaction relationships:</strong> {microSequence.preview_diagnostics.object_relationship_summary}</p> : null}
                  {microSequence.preview_diagnostics?.shot_engine_summary ? <p><strong className="text-ink">Shot engine:</strong> {microSequence.preview_diagnostics.shot_engine_summary}</p> : null}
                  {microSequence.preview_diagnostics?.articulated_entity_summary ? <p><strong className="text-ink">Articulated entity:</strong> {microSequence.preview_diagnostics.articulated_entity_summary}</p> : null}
                  {microSequence.preview_diagnostics ? <p><strong className="text-ink">Camera profile:</strong> {microSequence.preview_diagnostics.camera_profile}</p> : null}
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
              {microSequenceGalleryCards.length ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {microSequenceGalleryCards.map((card) => (
                    <article key={card.id} className="overflow-hidden rounded-[1.25rem] border border-ink/10 bg-white/90 shadow-sm">
                      <div className="aspect-square bg-mist/50">
                        <div className="relative h-full w-full">
                          <Image src={card.assetUrl} alt={card.label} width={256} height={256} unoptimized className="h-full w-full object-contain" />
                          {card.diagnostic ? (
                            <div className="absolute left-3 top-3 rounded-full bg-ink/75 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                              {card.diagnostic.object_kind} • {Math.round(card.diagnostic.rotation_degrees)}deg
                            </div>
                          ) : null}
                          {card.diagnostic ? (
                            <div className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink shadow-sm">
                              horizon {Math.round(card.diagnostic.horizon_y)} • camera {card.diagnostic.camera_stability_score}/100
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-2 p-4">
                        <p className="text-sm font-semibold text-ink">{card.label}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate">{card.format} • {card.source}</p>
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Shot {card.diagnostic.active_shot_type ?? "STATIC_ESTABLISHING"} • Orbit {Math.round(card.diagnostic.orbital_radius ?? 0)}px • Continuity {card.diagnostic.camera_continuity_score ?? card.diagnostic.camera_stability_score}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Silhouette {card.diagnostic.silhouette_score}/100 • Readability {card.diagnostic.readability_score}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Env {card.diagnostic.environment_coherence_score}/100 • Depth {card.diagnostic.spatial_depth_score}/100 • Fog {card.diagnostic.fog_density}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Framing {card.diagnostic.framing_score ?? card.diagnostic.readability_score}/100 • Visibility {card.diagnostic.visibility_score ?? card.diagnostic.silhouette_score}/100 • Edge clip {card.diagnostic.edge_clipping_score ?? 100}/100</p> : null}
                        {card.diagnostic?.active_entity_type ? <p className="text-xs leading-6 text-slate">Entity {card.diagnostic.active_entity_type} • Joints {card.diagnostic.joint_count ?? 0} • Pose {card.diagnostic.pose_stability_score ?? card.diagnostic.camera_stability_score}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Spacing drift {card.diagnostic.spacing_drift}px • Depth {card.diagnostic.depth_ordering_status}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Overlap {card.diagnostic.overlap_warning} • Stage {card.diagnostic.interaction_staging_note}</p> : null}
                        {card.diagnostic?.shot_transition_summary ? <p className="text-xs leading-6 text-slate">Transition {card.diagnostic.shot_transition_summary}</p> : null}
                        {card.diagnostic?.rollback_restored_state ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed camera snapshot for this frame.</p> : null}
                        {card.diagnostic?.rollback_restored_pose ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed articulated pose for this frame.</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Reactive {card.diagnostic.beacon_influence_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Reflection {card.diagnostic.reflection_shadow_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Response {card.diagnostic.environmental_response_overlay}</p> : null}
                        {card.diagnostic?.camera_state_overlay ? <p className="text-xs leading-6 text-slate">Camera {card.diagnostic.camera_state_overlay}</p> : null}
                        {card.diagnostic?.articulated_entity_overlay ? <p className="text-xs leading-6 text-slate">Entity state {card.diagnostic.articulated_entity_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Anchor {card.diagnostic.continuity_anchor_visualization}</p> : null}
                        <p className="text-xs leading-6 text-slate">{card.assetPath}</p>
                        <div className="flex flex-wrap gap-2">
                          <a href={card.assetUrl} target="_blank" rel="noreferrer" className="rounded-full border border-ocean/20 bg-ocean px-3 py-1.5 text-xs font-semibold text-white">Open</a>
                          <a href={`${card.assetUrl}&download=1`} className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink">Download</a>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p>{microSequence?.sandbox_path ? "No governed micro-sequence frame files were produced for the latest prerequisite run." : "No governed micro-sequence frames are available yet."}</p>
              )}
            </div>
          </article>

          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Preview Outputs</p>
            <div className="mt-5 space-y-3 text-sm leading-7 body-muted">
              {previewGalleryCards.length ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {previewGalleryCards.map((card) => (
                    <article key={card.id} className="overflow-hidden rounded-[1.25rem] border border-ink/10 bg-white/90 shadow-sm">
                      <div className="aspect-square bg-mist/50">
                        <div className="relative h-full w-full">
                          <Image src={card.assetUrl} alt={card.label} width={256} height={256} unoptimized className="h-full w-full object-contain" />
                          {card.diagnostic ? (
                            <div className="absolute left-3 top-3 rounded-full bg-ink/75 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                              {card.diagnostic.object_kind} • {Math.round(card.diagnostic.rotation_degrees)}deg
                            </div>
                          ) : null}
                          {card.diagnostic ? (
                            <div className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink shadow-sm">
                              center {Math.round(card.diagnostic.anchor_x)},{Math.round(card.diagnostic.anchor_y)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-2 p-4">
                        <p className="text-sm font-semibold text-ink">{card.label}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate">{card.format} • {card.source}</p>
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Shot {card.diagnostic.active_shot_type ?? "STATIC_ESTABLISHING"} • Orbit {Math.round(card.diagnostic.orbital_radius ?? 0)}px • Transition {card.diagnostic.shot_transition_score ?? card.diagnostic.camera_stability_score}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Coherence {card.diagnostic.coherence_anchor_strength}/100 • Lighting {card.diagnostic.lighting_stability_score}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Camera {card.diagnostic.camera_stability_score}/100 • Horizon {card.diagnostic.horizon_consistency_score}/100 • Lighting consistency {card.diagnostic.lighting_consistency_score}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Framing {card.diagnostic.framing_score ?? card.diagnostic.readability_score}/100 • Visibility {card.diagnostic.visibility_score ?? card.diagnostic.silhouette_score}/100 • Continuity {card.diagnostic.camera_continuity_score ?? card.diagnostic.camera_stability_score}/100</p> : null}
                        {card.diagnostic?.active_entity_type ? <p className="text-xs leading-6 text-slate">Entity {card.diagnostic.active_entity_type} • Joints {card.diagnostic.joint_count ?? 0} • Silhouette {card.diagnostic.silhouette_readability_score ?? card.diagnostic.readability_score}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Spacing {card.diagnostic.cube_to_beacon_distance}px • Drift {card.diagnostic.spacing_drift}px • Overlap {card.diagnostic.overlap_warning}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Depth {card.diagnostic.depth_ordering_status} • Staging {card.diagnostic.interaction_staging_note}</p> : null}
                        {card.diagnostic?.shot_transition_summary ? <p className="text-xs leading-6 text-slate">Transition {card.diagnostic.shot_transition_summary}</p> : null}
                        {card.diagnostic?.rollback_restored_state ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed camera snapshot for this frame.</p> : null}
                        {card.diagnostic?.rollback_restored_pose ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed articulated pose for this frame.</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Influence {card.diagnostic.beacon_influence_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Reflection and shadow {card.diagnostic.reflection_shadow_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Environmental response {card.diagnostic.environmental_response_overlay}</p> : null}
                        {card.diagnostic?.camera_state_overlay ? <p className="text-xs leading-6 text-slate">Camera state {card.diagnostic.camera_state_overlay}</p> : null}
                        {card.diagnostic?.articulated_entity_overlay ? <p className="text-xs leading-6 text-slate">Entity state {card.diagnostic.articulated_entity_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Overlay {card.diagnostic.scene_readability_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Relationship overlay {card.diagnostic.object_relationship_overlay}</p> : null}
                        <p className="text-xs leading-6 text-slate">{card.assetPath}</p>
                        <div className="flex flex-wrap gap-2">
                          <a href={card.assetUrl} target="_blank" rel="noreferrer" className="rounded-full border border-ocean/20 bg-ocean px-3 py-1.5 text-xs font-semibold text-white">Open</a>
                          <a href={`${card.assetUrl}&download=1`} className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink">Download</a>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p>No governed preview files are available yet.</p>
              )}
            </div>
          </article>

          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Frame Comparison</p>
            <div className="mt-5 space-y-3 text-sm leading-7 body-muted">
              {comparisonCards.length === 2 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {comparisonCards.map((card) => (
                    <article key={`compare-${card.id}`} className="overflow-hidden rounded-[1.25rem] border border-ink/10 bg-white/90 shadow-sm">
                      <div className="aspect-square bg-mist/50">
                        <Image src={card.assetUrl} alt={card.label} width={256} height={256} unoptimized className="h-full w-full object-contain" />
                      </div>
                      <div className="p-4">
                        <p className="text-sm font-semibold text-ink">{card.label}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate">{card.source}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p>Generate at least two governed PNG frames to compare continuity side by side.</p>
              )}
            </div>
          </article>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-1">
          {activeDiagnostics ? (
            <article className="glass-card rounded-[2rem] p-6 shadow-float lg:col-span-3">
              <p className="section-label">Governed Diagnostics</p>
              <div className="mt-5">
                <DiagnosticsOverview diagnostics={activeDiagnostics} />
              </div>
            </article>
          ) : null}

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