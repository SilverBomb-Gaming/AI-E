import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assessCinematicLocalInferenceReadiness,
  buildCinematicLocalExecutionPlan,
  compareCinematicProviderOutputs,
  compileCinematicProviderPayload,
  compileCinematicProviderPayloadVariants,
  compileCinematicShotPrompt,
  estimateCinematicLocalHardware,
  enforceCinematicGenerationBudget,
  ensureCinematicProductionMemoryInitialized,
  getCinematicLocalHardwareProfiles,
  getCinematicLocalModelRegistry,
  getCinematicLocalRuntimeCapabilityRegistry,
  forecastCinematicSequenceCost,
  getCinematicProviderCapability,
  getCinematicProviderCapabilityRegistry,
  listCinematicProviderAdapters,
  planCinematicGenerationJobs,
  planCinematicLocalProviderRouting,
  planCinematicSequence,
  planFailedShotRegeneration,
  prepareCinematicManualTriggerBridge,
  readCinematicProductionMemory,
  recordCinematicGenerationOutcome,
  recordCinematicShotHistory,
  selectCinematicGenerationProviderRoute,
  simulateCinematicExecutionSandbox,
  validateCinematicProviderPayload,
  validateCinematicExecutionPlan,
  validateCinematicSequenceContinuity,
  writeCinematicProductionMemory,
} from "./cinematicProductionMemory";

test("cinematic production memory evolves into continuity-aware shot planning intelligence", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-cinematic-production-memory-"));

  try {
    const initialized = await ensureCinematicProductionMemoryInitialized(tempRoot);
    assert.match(initialized.productionMemoryPath, /data[\\/]second_brain[\\/]production_memory\.json/i);

    const plannedSequence = await planCinematicSequence({
      root: tempRoot,
      sequenceId: "sequence-boss-intro-002",
      title: "Boss Intro Sequence",
    });

    assert.equal(plannedSequence.persisted, true);
    assert.deepEqual(
      plannedSequence.sequence.shots.map((entry) => entry.shot_purpose),
      [
        "intro-shot",
        "establish-environment",
        "reveal-subject",
        "escalation-shot",
        "emotional-beat",
        "transition-shot",
        "gameplay-return",
      ],
    );

    await writeCinematicProductionMemory({
      root: tempRoot,
      value: {
        scene_sequences: [
          {
            ...plannedSequence.sequence,
            shots: plannedSequence.sequence.shots.map((entry) => {
              if (entry.shot_purpose === "transition-shot") {
                return {
                  ...entry,
                  prop_ids: [...entry.prop_ids, "missing-prop"],
                  tone_reference: "melancholic",
                  timeline_position: 3,
                };
              }

              if (entry.shot_purpose === "gameplay-return") {
                return {
                  ...entry,
                  lighting_reference: "unknown-lighting-rule",
                };
              }

              return entry;
            }),
          },
        ],
        pacing_notes: [
          "Use a half-beat pause before the wave reveal lands.",
          "Return to gameplay immediately after the threat is established.",
        ],
      },
    });

    await recordCinematicShotHistory({
      root: tempRoot,
      entry: {
        shot_id: "sequence-boss-intro-002-escalation-shot",
        recorded_at: "2026-05-07T13:00:00.000Z",
        beat_id: "babylon-cutscene-proof",
        intent: "Confirm the next wave arrival while keeping the player grounded in the arena.",
        camera_framing: "medium-wide over-shoulder arena reveal",
        camera_motion: "controlled push-in",
        lens_language: "28mm tactical action lens",
        lighting_direction: "arena practicals with readable rim separation",
        outcome: "ready for prompt compilation",
      },
    });

    await recordCinematicGenerationOutcome({
      root: tempRoot,
      entry: {
        generation_id: "success-wave-reveal-002",
        recorded_at: "2026-05-07T13:05:00.000Z",
        shot_id: "sequence-boss-intro-002-reveal-subject",
        status: "successful",
        prompt_summary: "Readable cutscene insert with clear arena geography and wave anticipation.",
        engine: "prompt-compiler-stub",
        cost_tier: "medium",
        asset_ids: ["prompt-wave-reveal-001"],
        notes: ["Reuse the existing reveal prompt structure.", "Keep enemy spawn geography visible."],
      },
    });

    await recordCinematicGenerationOutcome({
      root: tempRoot,
      entry: {
        generation_id: "failed-wave-reveal-002",
        recorded_at: "2026-05-07T13:06:00.000Z",
        shot_id: "sequence-boss-intro-002-escalation-shot",
        status: "failed",
        prompt_summary: "Tried a low-key moody pass that obscured the lane geometry.",
        engine: "prompt-compiler-stub",
        cost_tier: "low",
        asset_ids: [],
        notes: ["Reject because gameplay readability degraded."],
      },
    });

    const record = await readCinematicProductionMemory({ root: tempRoot });
    const continuity = await validateCinematicSequenceContinuity({ root: tempRoot, sequenceId: "sequence-boss-intro-002" });
    const regeneration = await planFailedShotRegeneration({ root: tempRoot, sequenceId: "sequence-boss-intro-002" });
    const compiled = await compileCinematicShotPrompt({ root: tempRoot, shotId: "sequence-boss-intro-002-escalation-shot" });

    assert.equal(record.project_key, "babylon-2026");
    assert.ok(record.characters.some((entry) => entry.name === "BABYLON Runner"));
    assert.ok(record.roadmap_systems.some((entry) => entry.id === "shot-planner"));
    assert.ok(record.story_beats.some((entry) => /Wave Start Pressure Beat/i.test(entry.title)));
    assert.ok(record.scene_sequences.some((entry) => entry.sequence_id === "sequence-boss-intro-002"));
    assert.ok(record.gameplay_cutscene_triggers.some((entry) => entry.trigger_type === "boss-intro"));
    assert.ok(record.shot_history.some((entry) => entry.shot_id === "sequence-boss-intro-002-escalation-shot"));
    assert.ok(record.successful_generations.some((entry) => entry.generation_id === "success-wave-reveal-002"));
    assert.ok(record.failed_generations.some((entry) => entry.generation_id === "failed-wave-reveal-002"));
    assert.equal(continuity.valid, false);
    assert.ok(continuity.mismatches.some((entry) => entry.category === "prop-continuity"));
    assert.ok(continuity.mismatches.some((entry) => entry.category === "tone-continuity"));
    assert.ok(continuity.mismatches.some((entry) => entry.category === "lighting-continuity"));
    assert.ok(continuity.mismatches.some((entry) => entry.category === "timeline-consistency"));
    assert.deepEqual(regeneration.failed_shot_ids, ["sequence-boss-intro-002-escalation-shot"]);
    assert.deepEqual(regeneration.preserved_successful_shot_ids, ["sequence-boss-intro-002-reveal-subject"]);
    assert.ok(regeneration.continuity_state.some((entry) => /Preserve approved successful shots/i.test(entry)));
    assert.match(compiled.prompt, /Wave Start Pressure Beat/i);
    assert.match(compiled.prompt, /Scene context:/);
    assert.match(compiled.prompt, /Prior shot context:/);
    assert.match(compiled.prompt, /Gameplay transition:/);
    assert.match(compiled.prompt, /gameplay context/i);
    assert.ok(compiled.continuity_constraints.some((entry) => /current production case study/i.test(entry)));
    assert.ok(compiled.asset_reuse_candidates.some((entry) => /prompt-wave-reveal-001/i.test(entry)));
    assert.equal(compiled.sequence_id, "sequence-boss-intro-002");
    assert.match(compiled.prior_shot_context ?? "", /reveal-subject/);
    assert.ok(compiled.gameplay_transition_context.length > 0);
    assert.match(compiled.estimated_cost_tier, /low|medium|high/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("local video inference readiness stays planning-only while exposing model, runtime, hardware, and routing preparation", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-local-video-readiness-"));

  try {
    await ensureCinematicProductionMemoryInitialized(tempRoot);

    const models = getCinematicLocalModelRegistry();
    const runtimes = getCinematicLocalRuntimeCapabilityRegistry();
    const hardwareProfiles = getCinematicLocalHardwareProfiles();
    const readiness = await assessCinematicLocalInferenceReadiness({
      root: tempRoot,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const hardwareEstimate = await estimateCinematicLocalHardware({
      root: tempRoot,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const routing = await planCinematicLocalProviderRouting({
      root: tempRoot,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const beforePlanRecord = await readCinematicProductionMemory({ root: tempRoot });
    const localPlan = await buildCinematicLocalExecutionPlan({
      root: tempRoot,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const afterPlanRecord = await readCinematicProductionMemory({ root: tempRoot });

    assert.ok(models.length >= 2);
    assert.ok(runtimes.length >= 1);
    assert.ok(hardwareProfiles.length >= 1);
    assert.equal(readiness.foundation_ready, true);
    assert.equal(readiness.local_provider_available, true);
    assert.equal(readiness.ready_for_manual_local_execution, false);
    assert.equal(readiness.recommended_routing_mode, "future-local-inference-mode");
    assert.ok(readiness.blocked_reasons.some((entry) => /sandbox-only mode/i.test(entry)));
    assert.ok(hardwareEstimate);
    assert.equal(hardwareEstimate?.supported, true);
    assert.ok((hardwareEstimate?.estimated_generation_minutes ?? 0) >= 2);
    assert.equal(routing.selected_provider, "LocalFutureProvider");
    assert.equal(routing.routing_mode, "future-local-inference-mode");
    assert.equal(localPlan.manual_execution_only, true);
    assert.equal(localPlan.execution_enabled, false);
    assert.ok(localPlan.steps.some((entry) => /sandbox-only mode/i.test(entry)));
    assert.deepEqual(afterPlanRecord.approval_audit_trail, beforePlanRecord.approval_audit_trail);

    await writeCinematicProductionMemory({
      root: tempRoot,
      value: {
        local_runtime_capability_registry: beforePlanRecord.local_runtime_capability_registry.map((entry) => ({
          ...entry,
          status: "candidate",
        })),
        local_hardware_profiles: beforePlanRecord.local_hardware_profiles.map((entry) => ({
          ...entry,
          status: "planned",
        })),
      },
    });

    const blockedReadiness = await assessCinematicLocalInferenceReadiness({
      root: tempRoot,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const blockedRouting = await planCinematicLocalProviderRouting({
      root: tempRoot,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });

    assert.equal(blockedReadiness.local_provider_available, false);
    assert.equal(blockedRouting.selected_provider, "Sora");
    assert.equal(blockedRouting.routing_mode, "premium-cinematic-provider");
    assert.ok(blockedRouting.reasons.some((entry) => /fallback provider sora/i.test(entry)));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("cinematic execution sandbox plans provider-agnostic jobs and simulates lifecycle deterministically", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-cinematic-execution-sandbox-"));

  try {
    await ensureCinematicProductionMemoryInitialized(tempRoot);
    const executionSequence = await planCinematicSequence({
      root: tempRoot,
      sequenceId: "sequence-execution-sandbox-001",
      title: "Execution Sandbox Sequence",
    });

    const adapters = listCinematicProviderAdapters();
    const cheapRoute = selectCinematicGenerationProviderRoute({ routingMode: "cheap-draft-provider" });
    const localRoute = selectCinematicGenerationProviderRoute({ routingMode: "future-local-inference-mode" });

    assert.deepEqual(adapters.map((entry) => entry.provider), ["Sora", "Seedance", "Runway", "Veo", "LocalFutureProvider"]);
    assert.equal(cheapRoute.provider, "Seedance");
    assert.equal(localRoute.provider, "LocalFutureProvider");

    const planned = await planCinematicGenerationJobs({
      root: tempRoot,
      sequenceId: executionSequence.sequence.sequence_id,
      routingMode: "cheap-draft-provider",
    });

    assert.equal(planned.blocked, false);
    assert.equal(planned.persisted, true);
    assert.equal(planned.jobs.length, 7);
    assert.equal(planned.batches.length, 1);
    assert.deepEqual(planned.batches[0]?.shot_ids, planned.jobs.map((entry) => entry.shot_id));
    assert.ok(planned.jobs.every((entry) => entry.generation_status === "planned"));
    assert.ok(planned.jobs.every((entry) => entry.validation_state === "validated"));
    assert.ok(planned.jobs.some((entry) => entry.continuity_context.dependency_shot_ids.length > 0));

    const simulation = await simulateCinematicExecutionSandbox({
      root: tempRoot,
      sequenceId: executionSequence.sequence.sequence_id,
      routingMode: "cheap-draft-provider",
    });

    assert.equal(simulation.simulation.provider, "Seedance");
    assert.ok(simulation.simulation.queued_job_ids.length > 0);
    assert.ok(simulation.simulation.failed_job_ids.length > 0);
    assert.ok(simulation.simulation.retry_job_ids.length > 0);
    assert.ok(simulation.jobs.some((entry) => entry.generation_status === "retry-required"));
    assert.ok(simulation.retry_jobs.every((entry) => entry.generation_status === "approved"));
    assert.ok(simulation.retry_jobs.every((entry) => entry.continuity_context.preserved_output_refs.length > 0));
    assert.ok(simulation.history_entries.some((entry) => entry.generation_status === "queued"));
    assert.ok(simulation.history_entries.some((entry) => entry.generation_status === "generating"));
    assert.ok(simulation.history_entries.some((entry) => entry.generation_status === "approved"));
    assert.ok(simulation.history_entries.some((entry) => entry.generation_status === "retry-required"));

    await simulateCinematicExecutionSandbox({
      root: tempRoot,
      sequenceId: executionSequence.sequence.sequence_id,
      routingMode: "premium-cinematic-provider",
    });

    const comparison = await compareCinematicProviderOutputs({
      root: tempRoot,
      sequenceId: executionSequence.sequence.sequence_id,
    });
    const record = await readCinematicProductionMemory({ root: tempRoot });

    assert.ok(comparison.some((entry) => entry.provider === "Seedance"));
    assert.ok(comparison.some((entry) => entry.provider === "Sora"));
    assert.ok(record.generation_jobs.some((entry) => entry.provider === "Seedance" && entry.output_refs.length > 0));
    assert.ok(record.generation_jobs.some((entry) => entry.provider === "Sora" && entry.output_refs.length > 0));
    assert.ok(record.generation_job_history.length >= simulation.history_entries.length);
    assert.ok(record.sandbox_simulations.length >= 2);

    await writeCinematicProductionMemory({
      root: tempRoot,
      value: {
        scene_sequences: [
          {
            ...executionSequence.sequence,
            sequence_id: "sequence-invalid-execution-001",
            title: "Invalid Execution Sequence",
            shots: executionSequence.sequence.shots.map((entry) => {
              if (entry.shot_purpose === "transition-shot") {
                return {
                  ...entry,
                  prop_ids: [...entry.prop_ids, "missing-prop"],
                };
              }
              return entry;
            }),
          },
        ],
      },
    });

    const blockedValidation = await validateCinematicExecutionPlan({
      root: tempRoot,
      sequenceId: "sequence-invalid-execution-001",
    });
    const blockedPlan = await planCinematicGenerationJobs({
      root: tempRoot,
      sequenceId: "sequence-invalid-execution-001",
      routingMode: "balanced-comparison-mode",
    });

    assert.equal(blockedValidation.valid, false);
    assert.ok(blockedValidation.issues.some((entry) => entry.category === "continuity-compatibility"));
    assert.equal(blockedPlan.blocked, true);
    assert.equal(blockedPlan.jobs.length, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("safe provider bridge compiles payloads, validates providers, enforces budgets, and preserves manual approval gating", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-safe-provider-bridge-"));

  try {
    await ensureCinematicProductionMemoryInitialized(tempRoot);
    const sequence = await planCinematicSequence({
      root: tempRoot,
      sequenceId: "sequence-provider-bridge-001",
      title: "Provider Bridge Sequence",
    });
    const planned = await planCinematicGenerationJobs({
      root: tempRoot,
      sequenceId: sequence.sequence.sequence_id,
      routingMode: "premium-cinematic-provider",
    });
    const firstJob = planned.jobs[0]!;

    const capabilityRegistry = getCinematicProviderCapabilityRegistry();
    const soraCapability = await getCinematicProviderCapability({ root: tempRoot, provider: "Sora" });
    const payload = await compileCinematicProviderPayload({
      root: tempRoot,
      jobId: firstJob.job_id,
      provider: "Sora",
      targetDurationSeconds: 10,
      targetResolution: "1080p",
      targetFrameRate: 24,
    });
    const payloadVariants = await compileCinematicProviderPayloadVariants({
      root: tempRoot,
      jobId: firstJob.job_id,
      targetDurationSeconds: 8,
      targetResolution: "1080p",
      targetFrameRate: 24,
    });
    const payloadValidation = await validateCinematicProviderPayload({
      root: tempRoot,
      payload,
    });
    const invalidPayloadValidation = await validateCinematicProviderPayload({
      root: tempRoot,
      payload: {
        ...payload,
        duration_seconds: 25,
        resolution: "4k",
        asset_references: ["a", "b", "c", "d", "e", "f"],
      },
    });
    const safeBudget = await enforceCinematicGenerationBudget({
      root: tempRoot,
      jobs: planned.jobs,
      actualProviderExecutionRequested: false,
      manualApprovalGranted: false,
    });
    const blockedBudget = await enforceCinematicGenerationBudget({
      root: tempRoot,
      jobs: planned.jobs,
      budgetPolicy: {
        max_shots_per_batch: 2,
        max_estimated_sequence_cost: 12,
      },
      actualProviderExecutionRequested: false,
      manualApprovalGranted: false,
    });
    const historyBeforeGate = (await readCinematicProductionMemory({ root: tempRoot })).generation_job_history.length;
    const blockedGate = await prepareCinematicManualTriggerBridge({
      root: tempRoot,
      jobIds: planned.jobs.map((entry) => entry.job_id),
      actualProviderExecutionRequested: true,
      manualApprovalGranted: false,
      sandboxOnlyMode: false,
    });
    const approvedGate = await prepareCinematicManualTriggerBridge({
      root: tempRoot,
      jobIds: planned.jobs.map((entry) => entry.job_id),
      actualProviderExecutionRequested: true,
      manualApprovalGranted: true,
      sandboxOnlyMode: false,
    });
    const costForecast = await forecastCinematicSequenceCost({
      root: tempRoot,
      sequenceId: sequence.sequence.sequence_id,
      routingMode: "premium-cinematic-provider",
    });
    const recordAfterGate = await readCinematicProductionMemory({ root: tempRoot });

    assert.ok(capabilityRegistry.some((entry) => entry.provider === "Sora"));
    assert.equal(soraCapability.max_duration_seconds, 20);
    assert.equal(payload.provider, "Sora");
    assert.match(payload.normalized_prompt, /Sora-ready cinematic prompt/i);
    assert.ok(payloadVariants.some((entry) => entry.provider === "Seedance"));
    assert.ok(payloadVariants.some((entry) => entry.provider === "Runway"));
    assert.ok(payloadVariants.some((entry) => entry.provider === "Veo"));
    assert.ok(payloadVariants.every((entry) => entry.normalized_prompt.length > 0));
    assert.equal(payloadValidation.valid, true);
    assert.equal(invalidPayloadValidation.valid, false);
    assert.ok(invalidPayloadValidation.issues.some((entry) => entry.category === "unsupported-duration"));
    assert.ok(invalidPayloadValidation.issues.some((entry) => entry.category === "unsupported-resolution"));
    assert.ok(invalidPayloadValidation.issues.some((entry) => entry.category === "invalid-reference-count"));
    assert.equal(safeBudget.allowed, true);
    assert.equal(blockedBudget.allowed, false);
    assert.ok(blockedBudget.issues.some((entry) => /max_shots_per_batch/i.test(entry)));
    assert.ok(blockedBudget.issues.some((entry) => /Estimated sequence cost/i.test(entry)));
    assert.equal(blockedGate.queue_preparation_allowed, true);
    assert.equal(blockedGate.provider_execution_allowed, false);
    assert.match(blockedGate.blocked_reason ?? "", /Manual approval is required/i);
    assert.equal(approvedGate.provider_execution_allowed, true);
    assert.equal(costForecast.provider, "Sora");
    assert.ok(costForecast.estimated_sequence_cost > 0);
    assert.ok(costForecast.estimated_retry_cost > 0);
    assert.ok(costForecast.provider_variance > 0);
    assert.match(costForecast.draft_vs_premium_tradeoff, /draft-to-premium delta/i);
    assert.ok(costForecast.provider_forecasts.some((entry) => entry.provider === "Seedance"));
    assert.ok(recordAfterGate.generation_job_history.length > historyBeforeGate);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});