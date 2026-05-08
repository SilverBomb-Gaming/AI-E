import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assessCinematicLocalInferenceReadiness,
  assessCinematicRuntimeConstraints,
  buildCinematicLocalExecutionPlan,
  compareCinematicProviderOutputs,
  compileCinematicProviderPayload,
  compileCinematicProviderPayloadVariants,
  compileCinematicShotPrompt,
  estimateCinematicLocalHardware,
  enforceCinematicGenerationBudget,
  ensureCinematicProductionMemoryInitialized,
  getCinematicLocalHardwareProfiles,
  getCinematicLocalModelLoaderRegistry,
  getCinematicLocalModelRegistry,
  getCinematicLocalRuntimeCapabilityRegistry,
  getCinematicReadinessMilestoneProgress,
  getCinematicRuntimeProbeAdapters,
  getCinematicReadinessDeltaTrackingHistory,
  forecastCinematicSequenceCost,
  getCinematicProviderCapability,
  getCinematicProviderCapabilityRegistry,
  inspectCinematicLocalRuntimeEnvironment,
  listCinematicProviderAdapters,
  planCinematicGenerationJobs,
  planCinematicFrameGenerationPipeline,
  planCinematicHybridLocalCloudStrategy,
  planCinematicLocalProviderRouting,
  planCinematicSequence,
  planFailedShotRegeneration,
  prepareCinematicManualTriggerBridge,
  readCinematicProductionMemory,
  recordCinematicGenerationOutcome,
  recordCinematicShotHistory,
  selectCinematicGenerationProviderRoute,
  simulateCinematicExecutionSandbox,
  simulateCinematicControlledLocalInferenceBootstrap,
  simulateCinematicLocalInferenceExecutionSandbox,
  simulateCinematicLocalModelLoaderRuntimeActivation,
  validateCinematicControlledLocalInferenceBootstrap,
  validateCinematicLocalExecutionSandbox,
  validateCinematicLocalRuntimeActivationSimulation,
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
    await mkdir(path.join(tempRoot, ".venv", "Scripts"), { recursive: true });
    await mkdir(path.join(tempRoot, "ComfyUI"), { recursive: true });
    await mkdir(path.join(tempRoot, "models"), { recursive: true });
    await mkdir(path.join(tempRoot, "tools", "ffmpeg"), { recursive: true });
    await writeFile(path.join(tempRoot, ".venv", "Scripts", "python.exe"), "", "utf8");
    await writeFile(path.join(tempRoot, "tools", "ffmpeg", "ffmpeg.exe"), "", "utf8");

    const models = getCinematicLocalModelRegistry();
    const runtimes = getCinematicLocalRuntimeCapabilityRegistry();
    const hardwareProfiles = getCinematicLocalHardwareProfiles();
    const probeAdapters = getCinematicRuntimeProbeAdapters();
    const probeSnapshot = await inspectCinematicLocalRuntimeEnvironment({
      root: tempRoot,
      persist: true,
      pathHints: {
        ffmpeg_paths: ["tools/ffmpeg/ffmpeg.exe"],
      },
    });
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
    const pipelinePlan = await planCinematicFrameGenerationPipeline({ root: tempRoot });
    const runtimeConstraints = await assessCinematicRuntimeConstraints({
      root: tempRoot,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const hybridPlan = await planCinematicHybridLocalCloudStrategy({
      root: tempRoot,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const milestoneProgress = await getCinematicReadinessMilestoneProgress({
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
    assert.equal(probeAdapters.length, 8);
    assert.equal(probeSnapshot.runtime_launch_enabled, false);
    assert.ok(probeSnapshot.results.some((entry) => entry.probe_id === "python-runtime-presence" && entry.status === "detected"));
    assert.ok(probeSnapshot.results.some((entry) => entry.probe_id === "inference-runtime-presence" && entry.status === "detected"));
    assert.ok(probeSnapshot.results.some((entry) => entry.probe_id === "local-model-directory-presence" && entry.status === "detected"));
    assert.equal(readiness.foundation_ready, true);
    assert.equal(readiness.local_provider_available, true);
    assert.equal(readiness.ready_for_manual_local_execution, false);
    assert.equal(readiness.recommended_routing_mode, "future-local-inference-mode");
    assert.ok(readiness.probe_snapshot);
    assert.equal(readiness.probe_snapshot?.snapshot_id, probeSnapshot.snapshot_id);
    assert.equal(readiness.milestone_progress.length, 7);
    assert.ok(readiness.blocked_reasons.some((entry) => /sandbox-only mode/i.test(entry)));
    assert.ok(hardwareEstimate);
    assert.equal(hardwareEstimate?.supported, true);
    assert.ok((hardwareEstimate?.estimated_generation_minutes ?? 0) >= 2);
    assert.equal(routing.selected_provider, "LocalFutureProvider");
    assert.equal(routing.routing_mode, "future-local-inference-mode");
    assert.ok(routing.hybrid_strategy_ids.includes("local-draft-rendering"));
    assert.ok(routing.hybrid_strategy_ids.includes("continuity-first-routing"));
    assert.ok(pipelinePlan.blocked_stage_ids.includes("frame-synthesis"));
    assert.ok(pipelinePlan.continuity_critical_stage_ids.includes("temporal-continuity"));
    assert.equal(runtimeConstraints.selected_constraint_model_id, "windows-local-runtime-baseline");
    assert.ok(runtimeConstraints.recommendations.some((entry) => /local draft previews/i.test(entry)));
    assert.equal(hybridPlan.selected_strategy_id, "local-draft-rendering");
    assert.ok(hybridPlan.candidate_strategy_ids.includes("continuity-first-routing"));
    assert.equal(milestoneProgress.length, 7);
    assert.ok(milestoneProgress.some((entry) => entry.milestone === "local-runtime-readiness" && entry.percentage > 50));
    assert.ok(milestoneProgress.some((entry) => entry.milestone === "self-sustaining-generation-readiness" && entry.percentage < 50));
    assert.equal(localPlan.manual_execution_only, true);
    assert.equal(localPlan.execution_enabled, false);
    assert.ok(localPlan.steps.some((entry) => /sandbox-only mode/i.test(entry)));
    assert.equal(localPlan.milestone_progress.length, 7);
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
        local_runtime_probe_snapshots: [],
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
    assert.ok(blockedReadiness.blocked_reasons.some((entry) => /runtime probe snapshot/i.test(entry)));
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

test("governed preview diagnostics keep reactive cinematic shot transitions deterministic and bounded", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-governed-multi-object-preview-"));

  try {
    await ensureCinematicProductionMemoryInitialized(tempRoot);
    await mkdir(path.join(tempRoot, ".venv", "Scripts"), { recursive: true });
    await mkdir(path.join(tempRoot, "ComfyUI"), { recursive: true });
    await mkdir(path.join(tempRoot, "models", "wan-2.1-t2v-q8"), { recursive: true });
    await mkdir(path.join(tempRoot, "models", "ltx-video-img2vid-int8"), { recursive: true });
    await mkdir(path.join(tempRoot, "models", "hunyuan-video-13b-planned"), { recursive: true });
    await writeFile(path.join(tempRoot, ".venv", "Scripts", "python.exe"), "", "utf8");
    await writeFile(path.join(tempRoot, "ComfyUI", "main.py"), "", "utf8");
    await writeFile(path.join(tempRoot, "requirements.txt"), "torch\ndiffusers\n", "utf8");

    await inspectCinematicLocalRuntimeEnvironment({
      root: tempRoot,
      persist: true,
      pathHints: {
        python_paths: [".venv/Scripts/python.exe"],
        inference_runtime_paths: ["ComfyUI"],
        local_model_paths: ["models"],
      },
    });

    const simulation = await simulateCinematicControlledLocalInferenceBootstrap({
      root: tempRoot,
      desiredResolution: "720p",
      desiredDurationSeconds: 2,
      continuityPriority: "medium",
    });

    const microDiagnostics = simulation.validation.governed_micro_sequence_sandbox.preview_diagnostics;
    const motionDiagnostics = simulation.validation.governed_motion_preview_sandbox.preview_diagnostics;

    assert.ok(microDiagnostics);
    assert.ok(motionDiagnostics);
    assert.ok(microDiagnostics.multi_object_coherence_score >= 88);
    assert.ok(microDiagnostics.spacing_consistency_score >= 88);
    assert.ok(microDiagnostics.depth_ordering_score >= 90);
    assert.ok(microDiagnostics.overlap_avoidance_score >= 92);
    assert.ok(microDiagnostics.interaction_staging_score >= 88);
    assert.ok(microDiagnostics.reactive_lighting_score >= 88);
    assert.ok(microDiagnostics.environmental_response_score >= 88);
    assert.ok(microDiagnostics.reflection_continuity_score >= 88);
    assert.ok(microDiagnostics.interaction_persistence_score >= 88);
    assert.ok(microDiagnostics.reactive_coherence_score >= 88);
    assert.ok(microDiagnostics.scene_believability_score >= 88);
    assert.ok((microDiagnostics.camera_drift_stability_score ?? 0) >= 94);
    assert.ok((microDiagnostics.framing_persistence_score ?? 0) >= 92);
    assert.ok((microDiagnostics.horizon_stability_score ?? 0) >= 94);
    assert.ok((microDiagnostics.shot_transition_smoothness_score ?? 0) >= 90);
    assert.ok((microDiagnostics.composition_coherence_score ?? 0) >= 92);
    assert.ok((microDiagnostics.camera_continuity_score ?? 0) >= 93);
    assert.equal(microDiagnostics.active_entity_type, "SEGMENTED_DRONE");
    assert.ok((microDiagnostics.entity_count ?? 0) >= 2);
    assert.ok((microDiagnostics.entity_count ?? 0) <= 3);
    assert.ok((microDiagnostics.joint_count ?? 0) >= (microDiagnostics.entity_count ?? 0) * 6);
    assert.ok((microDiagnostics.max_chain_depth ?? 0) >= 2);
    assert.ok((microDiagnostics.joint_continuity_score ?? 0) >= 95);
    assert.ok((microDiagnostics.pose_stability_score ?? 0) >= 95);
    assert.ok((microDiagnostics.silhouette_readability_score ?? 0) >= 90);
    assert.ok((microDiagnostics.entity_spatial_persistence_score ?? 0) >= 95);
    assert.ok((microDiagnostics.entity_camera_framing_compatibility_score ?? 0) >= 92);
    assert.ok((microDiagnostics.entity_separation_score ?? 0) >= 95);
    assert.ok((microDiagnostics.formation_stability_score ?? 0) >= 95);
    assert.ok((microDiagnostics.multi_entity_silhouette_score ?? 0) >= 90);
    assert.ok((microDiagnostics.choreography_continuity_score ?? 0) >= 95);
    assert.ok((microDiagnostics.group_spatial_persistence_score ?? 0) >= 95);
    assert.match(microDiagnostics.articulated_entity_summary ?? "", /Segmented drone/i);
    assert.match(microDiagnostics.pose_governance_summary ?? "", /rollback governance/i);
    assert.match(microDiagnostics.multi_entity_choreography_summary ?? "", /formation|drones|choreography/i);
    assert.match(microDiagnostics.spacing_governance_summary ?? "", /spacing|separation/i);
    assert.ok(microDiagnostics.entity_ids?.every((entry) => /governed-segmented-drone-00[1-3]/.test(entry)) ?? false);
    assert.match(microDiagnostics.shot_engine_summary ?? "", /STATIC_ESTABLISHING|REVEAL_ARC|WIDE_ENVIRONMENT/i);
    assert.match(microDiagnostics.camera_governance_summary ?? "", /transition smoothness/i);
    assert.match(microDiagnostics.object_relationship_summary, /beacon/i);
    assert.match(microDiagnostics.beacon_influence_summary, /radius/i);
    assert.match(microDiagnostics.environmental_response_summary, /platform/i);
    assert.match(microDiagnostics.reflection_shadow_summary, /shadow/i);
    assert.match(microDiagnostics.continuity_anchor_visualization, /platform/i);

    let sawFormationRollback = false;
    for (const frame of motionDiagnostics.frame_diagnostics) {
      assert.ok(frame.cube_to_beacon_distance >= 40);
      assert.ok(frame.spacing_drift <= 3);
      assert.ok(frame.beacon_influence_strength >= 0.58);
      assert.ok(frame.reactive_light_radius >= 55);
      assert.ok(frame.depth_ordering_score >= 90);
      assert.ok(frame.overlap_avoidance_score >= 92);
      assert.ok(frame.interaction_staging_score >= 88);
      assert.ok(frame.floor_anchor_consistency_score >= 94);
      assert.ok(frame.platform_illumination_score >= 88);
      assert.ok(frame.floor_reflection_score >= 88);
      assert.ok(frame.reflection_continuity_score >= 88);
      assert.ok(frame.shadow_stability_score >= 88);
      assert.ok(frame.environmental_response_score >= 88);
      assert.ok(frame.interaction_persistence_score >= 88);
      assert.ok(frame.reactive_coherence_score >= 88);
      assert.ok((frame.framing_score ?? 0) >= 89);
      assert.ok((frame.visibility_score ?? 0) >= 90);
      assert.ok((frame.edge_clipping_score ?? 0) >= 89);
      assert.ok((frame.composition_balance_score ?? 0) >= 89);
      assert.ok((frame.camera_continuity_score ?? 0) >= 92);
      assert.ok((frame.shot_transition_score ?? 0) >= 90);
      assert.ok((frame.camera_drift_stability_score ?? 0) >= 94);
      assert.ok((frame.framing_persistence_score ?? 0) >= 90);
      assert.ok((frame.composition_coherence_score ?? 0) >= 92);
      assert.equal(frame.active_entity_type, "SEGMENTED_DRONE");
      assert.ok((frame.entity_count ?? 0) >= 2);
      assert.ok((frame.entity_count ?? 0) <= 3);
      assert.ok((frame.joint_count ?? 0) >= (frame.entity_count ?? 0) * 6);
      assert.ok((frame.max_chain_depth ?? 0) >= 2);
      assert.ok((frame.joint_continuity_score ?? 0) >= 95);
      assert.ok((frame.pose_stability_score ?? 0) >= 95);
      assert.ok((frame.silhouette_readability_score ?? 0) >= 90);
      assert.ok((frame.entity_spatial_persistence_score ?? 0) >= 95);
      assert.ok((frame.entity_camera_framing_compatibility_score ?? 0) >= 92);
      assert.ok((frame.entity_separation_score ?? 0) >= 95);
      assert.ok((frame.formation_stability_score ?? 0) >= 95);
      assert.ok((frame.multi_entity_silhouette_score ?? 0) >= 90);
      assert.ok((frame.choreography_continuity_score ?? 0) >= 95);
      assert.ok((frame.group_spatial_persistence_score ?? 0) >= 95);
      assert.ok((frame.entity_ids?.length ?? 0) === frame.entity_count);
      assert.ok(frame.entity_ids?.every((entry) => /governed-segmented-drone-00[1-3]/.test(entry)) ?? false);
      assert.ok(typeof frame.active_shot_type === "string");
      assert.ok((frame.orbital_radius ?? 0) >= 5);
      assert.match(frame.depth_ordering_status, /platform locked beneath anchor/i);
      assert.equal(frame.overlap_warning, "clear separation maintained");
      assert.match(frame.object_relationship_overlay, /cube-beacon/i);
      assert.match(frame.beacon_influence_overlay, /platform/i);
      assert.match(frame.reflection_shadow_overlay, /reflection/i);
      assert.match(frame.environmental_response_overlay, /persistence/i);
      assert.match(frame.camera_state_overlay ?? "", /continuity/i);
      assert.match(frame.shot_transition_summary ?? "", /deterministic|Transitioned|restored/i);
      assert.match(frame.articulated_entity_overlay ?? "", /formation|pose/i);
      assert.match(frame.multi_entity_overlay ?? "", /formation|spacing|group/i);
      sawFormationRollback ||= frame.rollback_restored_formation === true;
    }

    assert.ok(motionDiagnostics.camera_stability_score >= 96);
    assert.ok(motionDiagnostics.spatial_continuity_score >= 95);
    assert.ok(motionDiagnostics.readability_score >= 94);
    assert.ok((motionDiagnostics.entity_count ?? 0) >= 2);
    assert.ok((motionDiagnostics.entity_count ?? 0) <= 3);
    assert.ok((motionDiagnostics.entity_separation_score ?? 0) >= 95);
    assert.ok((motionDiagnostics.formation_stability_score ?? 0) >= 95);
    assert.ok((motionDiagnostics.multi_entity_silhouette_score ?? 0) >= 90);
    assert.ok((motionDiagnostics.choreography_continuity_score ?? 0) >= 95);
    assert.ok((motionDiagnostics.group_spatial_persistence_score ?? 0) >= 95);
    assert.ok(motionDiagnostics.frame_diagnostics.some((entry) => entry.rollback_restored_state === true));
    assert.ok(motionDiagnostics.frame_diagnostics.some((entry) => entry.rollback_restored_pose === true));
    assert.ok(sawFormationRollback);
    assert.ok((motionDiagnostics.rejected_formation_transition_count ?? 0) >= 1);
    assert.equal(motionDiagnostics.rollback_integrity_status, "PASS");
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

test("local execution sandbox validation persists readiness deltas while keeping execution disabled", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-local-execution-sandbox-"));

  try {
    await ensureCinematicProductionMemoryInitialized(tempRoot);
    await mkdir(path.join(tempRoot, ".venv", "Scripts"), { recursive: true });
    await mkdir(path.join(tempRoot, "ComfyUI"), { recursive: true });
    await mkdir(path.join(tempRoot, "models"), { recursive: true });
    await mkdir(path.join(tempRoot, "tools", "ffmpeg"), { recursive: true });
    await writeFile(path.join(tempRoot, ".venv", "Scripts", "python.exe"), "", "utf8");
    await writeFile(path.join(tempRoot, "tools", "ffmpeg", "ffmpeg.exe"), "", "utf8");

    const sequencePlan = await planCinematicSequence({
      root: tempRoot,
      sequenceId: "sequence-local-sandbox-001",
      title: "Local Sandbox Sequence",
    });
    await inspectCinematicLocalRuntimeEnvironment({
      root: tempRoot,
      persist: true,
      pathHints: {
        ffmpeg_paths: ["tools/ffmpeg/ffmpeg.exe"],
      },
    });
    await recordCinematicGenerationOutcome({
      root: tempRoot,
      entry: {
        generation_id: "failed-local-sandbox-pass-001",
        recorded_at: "2026-05-07T15:00:00.000Z",
        shot_id: "sequence-local-sandbox-001-reveal-subject",
        status: "failed",
        prompt_summary: "Local sandbox retry isolation proof.",
        engine: "prompt-compiler-stub",
        cost_tier: "low",
        asset_ids: [],
        notes: ["Keep continuity preserved while isolating retry planning."],
      },
    });

    const beforeRecord = await readCinematicProductionMemory({ root: tempRoot });
    const validation = await validateCinematicLocalExecutionSandbox({
      root: tempRoot,
      sequenceId: sequencePlan.sequence.sequence_id,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const historyAfterValidation = await getCinematicReadinessDeltaTrackingHistory({ root: tempRoot });
    const simulation = await simulateCinematicLocalInferenceExecutionSandbox({
      root: tempRoot,
      sequenceId: sequencePlan.sequence.sequence_id,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const afterRecord = await readCinematicProductionMemory({ root: tempRoot });

    assert.equal(validation.execution_enabled, false);
    assert.equal(validation.readiness_delta.source, "local-readiness-validation");
    assert.equal(historyAfterValidation.length, 1);
    assert.ok(historyAfterValidation[0]?.milestones.every((entry) => entry.previous_percentage === null));
    assert.ok(validation.renderer_lifecycle_states.some((entry) => entry.state === "runtime_preparing"));
    assert.ok(validation.renderer_lifecycle_states.some((entry) => entry.state === "rendering_simulated"));
    assert.ok(validation.gpu_allocation.estimated_vram_required_gb > 0);
    assert.ok(validation.gpu_allocation.max_safe_concurrency >= 1);
    assert.equal(validation.queue_plan.dependency_order_job_ids.length, sequencePlan.sequence.shots.length);
    assert.equal(validation.queue_plan.queued_jobs[0]?.state, "ready");
    assert.ok(validation.queue_plan.queued_jobs.some((entry) => entry.retry_isolated && entry.shot_id === "sequence-local-sandbox-001-reveal-subject"));
    assert.ok(validation.recovery_plan.causes.includes("continuity-state-recovery"));
    assert.ok(validation.hybrid_escalation.selected_strategy_id);

    assert.equal(simulation.validation.execution_enabled, false);
    assert.equal(simulation.simulation.sandbox_kind, "local-inference-execution-sandbox");
    assert.equal(simulation.simulation.execution_enabled, false);
    assert.equal(simulation.simulation.sequence_id, sequencePlan.sequence.sequence_id);
    assert.equal(simulation.simulation.readiness_tracking_id, afterRecord.readiness_delta_tracking_history[0]?.tracking_id ?? null);
    assert.ok(simulation.simulation.queue_plan);
    assert.ok(simulation.simulation.gpu_allocation);
    assert.ok(simulation.simulation.recovery_plan);
    assert.ok(afterRecord.readiness_delta_tracking_history.length >= 2);
    assert.ok(afterRecord.sandbox_simulations.some((entry) => entry.sandbox_kind === "local-inference-execution-sandbox"));
    assert.deepEqual(afterRecord.approval_audit_trail, beforeRecord.approval_audit_trail);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("local model loader activation simulation remains deterministic and execution-disabled", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-local-activation-simulation-"));

  try {
    await ensureCinematicProductionMemoryInitialized(tempRoot);
    await mkdir(path.join(tempRoot, ".venv", "Scripts"), { recursive: true });
    await mkdir(path.join(tempRoot, "ComfyUI"), { recursive: true });
    await mkdir(path.join(tempRoot, "models"), { recursive: true });
    await mkdir(path.join(tempRoot, "tools", "ffmpeg"), { recursive: true });
    await writeFile(path.join(tempRoot, ".venv", "Scripts", "python.exe"), "", "utf8");
    await writeFile(path.join(tempRoot, "tools", "ffmpeg", "ffmpeg.exe"), "", "utf8");

    await inspectCinematicLocalRuntimeEnvironment({
      root: tempRoot,
      persist: true,
      pathHints: {
        python_paths: [".venv/Scripts/python.exe"],
        ffmpeg_paths: ["tools/ffmpeg/ffmpeg.exe"],
        inference_runtime_paths: ["ComfyUI"],
        local_model_paths: ["models"],
      },
    });

    const beforeRecord = await readCinematicProductionMemory({ root: tempRoot });
    const validation = await validateCinematicLocalRuntimeActivationSimulation({
      root: tempRoot,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const registryAfterValidation = await getCinematicLocalModelLoaderRegistry({ root: tempRoot });
    const historyAfterValidation = await getCinematicReadinessDeltaTrackingHistory({ root: tempRoot });
    const simulation = await simulateCinematicLocalModelLoaderRuntimeActivation({
      root: tempRoot,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const afterRecord = await readCinematicProductionMemory({ root: tempRoot });

    assert.equal(validation.execution_enabled, false);
    assert.equal(validation.readiness_delta.source, "runtime-activation-simulation");
    assert.ok(validation.loader_registry.length > 0);
    assert.ok(validation.loader_registry.some((entry) => entry.status === "activation-ready"));
    assert.equal(registryAfterValidation.length, validation.loader_registry.length);
    assert.ok(validation.activation_lifecycle_states.some((entry) => entry.state === "loader_registered"));
    assert.ok(validation.activation_lifecycle_states.some((entry) => entry.state === "activation_blocked"));
    assert.equal(validation.compatibility_validation.valid, false);
    assert.ok(validation.compatibility_validation.issues.some((entry) => entry.code === "unsupported-continuity-mode"));
    assert.ok(validation.activation_recovery_plan.causes.includes("unsupported-provider-route"));
    assert.ok(validation.activation_recovery_plan.next_safe_steps.length > 0);
    assert.equal(validation.future_activation_plan.future_frame_synthesis_activation, true);
    assert.equal(validation.future_activation_plan.future_local_only_execution_mode, false);
    assert.equal(historyAfterValidation.length, 1);
    assert.ok(historyAfterValidation[0]?.milestones.every((entry) => entry.previous_percentage === null));

    assert.equal(simulation.validation.execution_enabled, false);
    assert.equal(simulation.simulation.sandbox_kind, "local-model-loader-runtime-activation-simulation");
    assert.equal(simulation.simulation.execution_enabled, false);
    assert.ok(simulation.simulation.loader_registry);
    assert.ok(simulation.simulation.activation_lifecycle_states);
    assert.ok(simulation.simulation.compatibility_validation);
    assert.ok(simulation.simulation.activation_recovery_plan);
    assert.ok(simulation.simulation.future_activation_plan);
    assert.equal(simulation.simulation.readiness_tracking_id, afterRecord.readiness_delta_tracking_history[0]?.tracking_id ?? null);
    assert.ok(afterRecord.sandbox_simulations.some((entry) => entry.sandbox_kind === "local-model-loader-runtime-activation-simulation"));
    assert.ok(afterRecord.readiness_delta_tracking_history.length >= 2);
    assert.deepEqual(afterRecord.approval_audit_trail, beforeRecord.approval_audit_trail);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("controlled local inference bootstrap persists execution boundaries while keeping inference disabled", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-controlled-bootstrap-"));

  try {
    await ensureCinematicProductionMemoryInitialized(tempRoot);
    await mkdir(path.join(tempRoot, ".venv", "Scripts"), { recursive: true });
    await mkdir(path.join(tempRoot, "ComfyUI"), { recursive: true });
    await mkdir(path.join(tempRoot, "models", "wan-2.1-t2v-q8"), { recursive: true });
    await mkdir(path.join(tempRoot, "models", "ltx-video-img2vid-int8"), { recursive: true });
    await mkdir(path.join(tempRoot, "models", "hunyuan-video-13b-planned"), { recursive: true });
    await mkdir(path.join(tempRoot, "tools", "ffmpeg"), { recursive: true });
    await mkdir(path.join(tempRoot, ".aie"), { recursive: true });
    await writeFile(path.join(tempRoot, ".venv", "Scripts", "python.exe"), "", "utf8");
    await writeFile(path.join(tempRoot, "ComfyUI", "main.py"), "", "utf8");
    await writeFile(path.join(tempRoot, "tools", "ffmpeg", "ffmpeg.exe"), "", "utf8");
    await writeFile(path.join(tempRoot, "requirements.txt"), "torch\ndiffusers\n", "utf8");

    await inspectCinematicLocalRuntimeEnvironment({
      root: tempRoot,
      persist: true,
      pathHints: {
        python_paths: [".venv/Scripts/python.exe"],
        ffmpeg_paths: ["tools/ffmpeg/ffmpeg.exe"],
        inference_runtime_paths: ["ComfyUI"],
        local_model_paths: ["models"],
      },
    });

    const beforeRecord = await readCinematicProductionMemory({ root: tempRoot });
    const validation = await validateCinematicControlledLocalInferenceBootstrap({
      root: tempRoot,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const simulation = await simulateCinematicControlledLocalInferenceBootstrap({
      root: tempRoot,
      desiredResolution: "1080p",
      desiredDurationSeconds: 6,
      continuityPriority: "high",
    });
    const afterRecord = await readCinematicProductionMemory({ root: tempRoot });

    assert.equal(validation.execution_enabled, false);
    assert.equal(validation.readiness_delta.source, "governed-low-duration-preview-clip-sandbox");
    assert.equal(validation.dry_runtime_bootstrap.valid, true);
    assert.ok(validation.dry_runtime_bootstrap.checks.some((entry) => entry.check === "runtime-binary-presence" && entry.passed));
    assert.ok(validation.execution_boundary_state.tracked_statuses.includes("simulated"));
    assert.ok(validation.execution_boundary_state.tracked_statuses.includes("inference_disabled"));
    assert.ok(validation.execution_boundary_state.tracked_statuses.includes("rendering_disabled"));
    assert.ok(validation.execution_boundary_state.disabled_execution_reasons.length > 0);
    assert.ok(validation.execution_boundary_state.next_activation_milestone.length > 0);
    assert.equal(validation.runtime_integrity_validation.valid, false);
    assert.ok(validation.runtime_integrity_validation.issues.some((entry) => entry.code === "incompatible-dependency-sets"));
    assert.equal(validation.activation_readiness_scores.length, 6);
    assert.ok(validation.activation_readiness_scores.some((entry) => entry.dimension === "offline-readiness"));
    assert.ok(validation.controlled_runtime_profiles.some((entry) => entry.profile_id === "offline_safe"));
    assert.ok(validation.future_inference_activation.dry_model_initialization);
    assert.ok(validation.future_inference_activation.dry_pipeline_binding);
    assert.ok(validation.activation_authority_registry.length > 0);
    assert.ok(validation.pre_inference_gate_validation.checks.some((entry) => entry.gate === "execution-boundary-intact"));
    assert.ok(validation.inference_entry_sequencing.stages.some((entry) => entry.stage === "gated_inference_prepare"));
    assert.ok(validation.forbidden_execution_states.states.some((entry) => entry.state === "inference_execute"));
    assert.ok(validation.governance_escalation_modeling.scenarios.some((entry) => entry.escalation === "runtime-risk-escalation"));
    assert.equal(validation.future_unlock_conditions.milestone_unlocks_real_inference, "reviewed-real-inference-bridge");
    assert.equal(validation.execution_temperature_state.current_state, "simulated_only");
    assert.ok(validation.execution_temperature_state.transitions.some((entry) => entry.state === "warming"));
    assert.ok(validation.dry_inference_warmup.stages.some((entry) => entry.stage === "scheduler_warmup"));
    assert.ok(validation.single_frame_execution_precursor.entries.some((entry) => entry.precursor_id === "gated_single_frame_prepare"));
    assert.ok(validation.frame_stage_readiness.checks.some((entry) => entry.check === "scheduler-readiness"));
    assert.ok(validation.warmup_escalation_modeling.scenarios.some((entry) => entry.escalation === "warmup-risk-escalation"));
    assert.ok(validation.future_bounded_execution_rules.rules.some((entry) => entry.rule_id === "single-frame-only-execution"));
    assert.ok(validation.dry_execution_token_registry.some((entry) => entry.token_id === "token-single-frame-dry-governed"));
    assert.ok(validation.single_frame_dry_execution_path.stages.some((entry) => entry.stage === "dry_execution_request"));
    assert.ok(validation.frame_traversal_validation.checks.some((entry) => entry.check === "execution-token-validity"));
    assert.ok(validation.dry_execution_recovery.scenarios.some((entry) => entry.recovery === "dry-rollback-sequencing"));
    assert.equal(validation.future_frame_synthesis_unlocks.milestone_unlocks_real_synthesis, "reviewed-real-frame-synthesis-bridge");
    assert.ok(validation.execution_attempt_ledger.attempts.length >= 1);
    assert.ok(validation.synthesis_containment_registry.some((entry) => entry.containment_id === "containment-governed-single-frame-prepare"));
    assert.ok(validation.governed_synthesis_preparation.stages.some((entry) => entry.stage === "synthesis_prepare_request"));
    assert.ok(validation.synthesis_validation_layer.checks.some((entry) => entry.check === "synthesis-containment-validity"));
    assert.ok(validation.contained_escalation_modeling.scenarios.some((entry) => entry.escalation === "blocked-output-escalation"));
    assert.equal(validation.future_low_resolution_output.milestone_unlocks_governed_output, "reviewed-governed-low-resolution-output-bridge");
    assert.ok(validation.governed_rollback_ledger.entries.length >= 1);
    assert.ok(validation.real_output_authorization_registry.some((entry) => entry.authorization_id === "authorization-governed-low-res-single-frame"));
    assert.equal(validation.governed_low_resolution_sandbox.real_output_written, true);
    assert.ok(validation.first_real_synthesis_path.stages.some((entry) => entry.stage === "single_frame_synthesis" && entry.status === "completed"));
    assert.ok(validation.output_containment_validation.checks.some((entry) => entry.check === "authorization-validity" && entry.passed));
    assert.ok(validation.real_output_rollback.actions.some((entry) => entry.action === "rollback-authority-enforcement" && entry.triggered));
    assert.equal(validation.future_renderer_escalation.milestone_unlocks_renderer_escalation, "reviewed-governed-renderer-escalation-bridge");
    assert.ok(validation.continuity_sequence_containment.some((entry) => entry.sequence_id === "sequence-governed-micro-preview-001"));
    assert.equal(validation.governed_micro_sequence_sandbox.real_sequence_written, true);
    assert.equal(validation.governed_micro_sequence_sandbox.sequence_frame_count, 3);
    assert.ok(validation.governed_micro_sequence_sandbox.preview_diagnostics.object_fidelity_score >= 88);
    assert.ok(validation.governed_micro_sequence_sandbox.preview_diagnostics.readability_score >= 86);
    assert.ok(validation.governed_micro_sequence_sandbox.preview_diagnostics.environment_coherence_score >= 90);
    assert.ok(validation.governed_micro_sequence_sandbox.preview_diagnostics.camera_stability_score >= 88);
    assert.ok(validation.governed_micro_sequence_sandbox.preview_diagnostics.spatial_continuity_score >= 90);
    assert.match(validation.governed_micro_sequence_sandbox.preview_diagnostics.camera_profile, /governed/i);
    assert.equal(validation.governed_micro_sequence_sandbox.preview_diagnostics.frame_diagnostics.length, 3);
    assert.ok(validation.governed_micro_sequence_sandbox.preview_diagnostics.frame_diagnostics.every((entry) => entry.environment_coherence_score >= 90));
    assert.ok(validation.governed_micro_sequence_sandbox.preview_diagnostics.frame_diagnostics.every((entry) => entry.camera_stability_score >= 88));
    assert.ok(validation.continuity_preview_sequencing.stages.some((entry) => entry.stage === "bounded_sequence_write" && entry.status === "completed"));
    assert.ok(validation.frame_to_frame_continuity_validation.checks.some((entry) => entry.check === "continuity-drift-thresholds" && entry.passed));
    assert.ok(validation.sequence_rollback_recovery.actions.some((entry) => entry.action === "sequence-rollback-cleanup" && entry.triggered));
    assert.equal(validation.future_cinematic_continuity.milestone_unlocks_cinematic_continuity, "reviewed-governed-cinematic-continuity-bridge");
    assert.ok(validation.motion_preview_containment.some((entry) => entry.clip_id === "clip-governed-motion-preview-001"));
    assert.equal(validation.governed_motion_preview_sandbox.preview_clip_written, true);
    assert.equal(validation.governed_motion_preview_sandbox.clip_frame_count, 4);
    assert.ok(validation.governed_motion_preview_sandbox.preview_diagnostics.frame_coherence_score >= 82);
    assert.ok(validation.governed_motion_preview_sandbox.preview_diagnostics.motion_smoothness_score >= 82);
    assert.ok(validation.governed_motion_preview_sandbox.preview_diagnostics.camera_stability_score >= 84);
    assert.ok(validation.governed_motion_preview_sandbox.preview_diagnostics.environment_coherence_score >= 88);
    assert.ok(validation.governed_motion_preview_sandbox.preview_diagnostics.lighting_consistency_score >= 92);
    assert.equal(validation.governed_motion_preview_sandbox.preview_diagnostics.frame_diagnostics.length, 4);
    assert.ok(validation.governed_motion_preview_sandbox.preview_diagnostics.frame_diagnostics.every((entry) => entry.horizon_consistency_score >= 86));
    assert.ok(validation.governed_motion_preview_sandbox.preview_diagnostics.frame_diagnostics.every((entry) => entry.scene_readability_overlay.length > 0));
    assert.ok(validation.motion_preview_sequencing.stages.some((entry) => entry.stage === "low_fps_clip_write" && entry.status === "completed"));
    assert.ok(validation.temporal_transition_validation.checks.some((entry) => entry.check === "transition-drift-thresholds" && entry.passed));
    assert.ok(validation.motion_preview_rollback.actions.some((entry) => entry.action === "preview-rollback-cleanup" && entry.triggered));
    assert.equal(validation.future_teaser_trailer_scaffolding.milestone_unlocks_teaser_trailer, "reviewed-governed-teaser-trailer-bridge");
    const outputFilePath = path.join(tempRoot, validation.governed_low_resolution_sandbox.output_file_path ?? "");
    assert.ok(existsSync(outputFilePath));
    assert.match(await readFile(outputFilePath, "utf8"), /^P3/m);
    const sandboxFiles = await readdir(path.join(tempRoot, ".aie", "governed_low_res_frame_sandbox"));
    assert.equal(sandboxFiles.filter((entry) => entry.endsWith(".ppm")).length, 1);
    const microSequenceDir = path.join(tempRoot, ".aie", "governed_micro_sequence_sandbox", "sequence-governed-micro-preview-001");
    const microSequenceFiles = await readdir(microSequenceDir);
    assert.equal(microSequenceFiles.filter((entry) => entry.endsWith(".ppm")).length, 3);
    assert.equal(microSequenceFiles.filter((entry) => entry.endsWith(".png")).length, 3);
    assert.ok(microSequenceFiles.includes("governed_preview_sequence_preview.gif"));
    assert.match(await readFile(path.join(microSequenceDir, "governed_preview_sequence_frame_001.ppm"), "utf8"), /^P3/m);
    const motionPreviewDir = path.join(tempRoot, ".aie", "governed_motion_preview_sandbox", "clip-governed-motion-preview-001");
    const motionPreviewFiles = await readdir(motionPreviewDir);
    assert.equal(motionPreviewFiles.filter((entry) => entry.endsWith(".ppm")).length, 4);
    assert.equal(motionPreviewFiles.filter((entry) => entry.endsWith(".png")).length, 4);
    assert.ok(motionPreviewFiles.includes("governed_motion_preview.gif"));
    assert.ok(motionPreviewFiles.includes("governed_motion_preview_manifest.json"));
    assert.match(await readFile(path.join(motionPreviewDir, "governed_motion_preview_frame_001.ppm"), "utf8"), /^P3/m);

    assert.equal(simulation.validation.execution_enabled, false);
    assert.equal(simulation.simulation.sandbox_kind, "governed-low-duration-preview-clip-sandbox");
    assert.equal(simulation.simulation.execution_enabled, false);
    assert.ok(simulation.simulation.dry_runtime_bootstrap);
    assert.ok(simulation.simulation.execution_boundary_status);
    assert.ok(simulation.simulation.runtime_integrity_validation);
    assert.ok(simulation.simulation.activation_readiness_scoring);
    assert.ok(simulation.simulation.controlled_runtime_profiles);
    assert.ok(simulation.simulation.future_inference_activation);
    assert.ok(simulation.simulation.activation_authority_registry);
    assert.ok(simulation.simulation.pre_inference_gate_validation);
    assert.ok(simulation.simulation.inference_entry_sequencing);
    assert.ok(simulation.simulation.forbidden_execution_states);
    assert.ok(simulation.simulation.governance_escalation_modeling);
    assert.ok(simulation.simulation.future_unlock_conditions);
    assert.ok(simulation.simulation.execution_temperature_state);
    assert.ok(simulation.simulation.dry_inference_warmup);
    assert.ok(simulation.simulation.single_frame_execution_precursor);
    assert.ok(simulation.simulation.frame_stage_readiness);
    assert.ok(simulation.simulation.warmup_escalation_modeling);
    assert.ok(simulation.simulation.future_bounded_execution_rules);
    assert.ok(simulation.simulation.dry_execution_token_registry);
    assert.ok(simulation.simulation.single_frame_dry_execution_path);
    assert.ok(simulation.simulation.frame_traversal_validation);
    assert.ok(simulation.simulation.dry_execution_recovery);
    assert.ok(simulation.simulation.future_frame_synthesis_unlocks);
    assert.ok(simulation.simulation.execution_attempt_ledger);
    assert.ok(simulation.simulation.synthesis_containment_registry);
    assert.ok(simulation.simulation.governed_synthesis_preparation);
    assert.ok(simulation.simulation.synthesis_validation_layer);
    assert.ok(simulation.simulation.contained_escalation_modeling);
    assert.ok(simulation.simulation.future_low_resolution_output);
    assert.ok(simulation.simulation.governed_rollback_ledger);
    assert.ok(simulation.simulation.real_output_authorization_registry);
    assert.ok(simulation.simulation.governed_low_resolution_sandbox);
    assert.ok(simulation.simulation.first_real_synthesis_path);
    assert.ok(simulation.simulation.output_containment_validation);
    assert.ok(simulation.simulation.real_output_rollback);
    assert.ok(simulation.simulation.future_renderer_escalation);
    assert.ok(simulation.simulation.continuity_sequence_containment);
    assert.ok(simulation.simulation.governed_micro_sequence_sandbox);
    assert.ok(simulation.simulation.continuity_preview_sequencing);
    assert.ok(simulation.simulation.frame_to_frame_continuity_validation);
    assert.ok(simulation.simulation.sequence_rollback_recovery);
    assert.ok(simulation.simulation.future_cinematic_continuity);
    assert.ok(simulation.simulation.motion_preview_containment);
    assert.ok(simulation.simulation.governed_motion_preview_sandbox);
    assert.ok(simulation.simulation.motion_preview_sequencing);
    assert.ok(simulation.simulation.temporal_transition_validation);
    assert.ok(simulation.simulation.motion_preview_rollback);
    assert.ok(simulation.simulation.future_teaser_trailer_scaffolding);
    assert.equal(simulation.simulation.readiness_tracking_id, afterRecord.readiness_delta_tracking_history[0]?.tracking_id ?? null);
    assert.ok(afterRecord.execution_boundary_status_history.length >= 2);
    assert.ok(afterRecord.activation_authority_registry.length > 0);
    assert.ok(afterRecord.execution_temperature_state_history.length >= 1);
    assert.ok(afterRecord.pre_inference_gate_validation_history.length >= 1);
    assert.ok(afterRecord.inference_entry_sequencing_history.length >= 1);
    assert.ok(afterRecord.forbidden_execution_state_history.length >= 1);
    assert.ok(afterRecord.governance_escalation_modeling_history.length >= 1);
    assert.ok(afterRecord.future_unlock_conditions_history.length >= 1);
    assert.ok(afterRecord.dry_inference_warmup_history.length >= 1);
    assert.ok(afterRecord.single_frame_execution_precursor_history.length >= 1);
    assert.ok(afterRecord.frame_stage_readiness_history.length >= 1);
    assert.ok(afterRecord.warmup_escalation_modeling_history.length >= 1);
    assert.ok(afterRecord.future_bounded_execution_rules_history.length >= 1);
    assert.ok(afterRecord.dry_execution_token_registry_history.length >= 1);
    assert.ok(afterRecord.single_frame_dry_execution_path_history.length >= 1);
    assert.ok(afterRecord.frame_traversal_validation_history.length >= 1);
    assert.ok(afterRecord.dry_execution_recovery_history.length >= 1);
    assert.ok(afterRecord.future_frame_synthesis_unlocks_history.length >= 1);
    assert.ok(afterRecord.execution_attempt_ledger_history.length >= 1);
    assert.ok(afterRecord.synthesis_containment_registry_history.length >= 1);
    assert.ok(afterRecord.governed_synthesis_preparation_history.length >= 1);
    assert.ok(afterRecord.synthesis_validation_layer_history.length >= 1);
    assert.ok(afterRecord.contained_escalation_modeling_history.length >= 1);
    assert.ok(afterRecord.future_low_resolution_output_history.length >= 1);
    assert.ok(afterRecord.governed_rollback_ledger_history.length >= 1);
    assert.ok(afterRecord.real_output_authorization_registry_history.length >= 1);
    assert.ok(afterRecord.governed_low_resolution_sandbox_history.length >= 1);
    assert.ok(afterRecord.first_real_synthesis_path_history.length >= 1);
    assert.ok(afterRecord.output_containment_validation_history.length >= 1);
    assert.ok(afterRecord.real_output_rollback_history.length >= 1);
    assert.ok(afterRecord.future_renderer_escalation_history.length >= 1);
    assert.ok(afterRecord.continuity_sequence_containment_history.length >= 1);
    assert.ok(afterRecord.governed_micro_sequence_sandbox_history.length >= 1);
    assert.ok(afterRecord.continuity_preview_sequencing_history.length >= 1);
    assert.ok(afterRecord.frame_to_frame_continuity_validation_history.length >= 1);
    assert.ok(afterRecord.sequence_rollback_recovery_history.length >= 1);
    assert.ok(afterRecord.future_cinematic_continuity_history.length >= 1);
    assert.ok(afterRecord.motion_preview_containment_history.length >= 1);
    assert.ok(afterRecord.governed_motion_preview_sandbox_history.length >= 1);
    assert.ok(afterRecord.motion_preview_sequencing_history.length >= 1);
    assert.ok(afterRecord.temporal_transition_validation_history.length >= 1);
    assert.ok(afterRecord.motion_preview_rollback_history.length >= 1);
    assert.ok(afterRecord.future_teaser_trailer_scaffolding_history.length >= 1);
    assert.ok(afterRecord.sandbox_simulations.some((entry) => entry.sandbox_kind === "governed-low-duration-preview-clip-sandbox"));
    assert.deepEqual(afterRecord.approval_audit_trail, beforeRecord.approval_audit_trail);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("controlled local inference bootstrap still writes governed micro-sequence frames when later runtime packaging checks stay blocked", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-governed-micro-sequence-readiness-"));

  try {
    await ensureCinematicProductionMemoryInitialized(tempRoot);
    await mkdir(path.join(tempRoot, ".venv", "Scripts"), { recursive: true });
    await mkdir(path.join(tempRoot, "ComfyUI"), { recursive: true });
    await mkdir(path.join(tempRoot, "models", "wan-2.1-t2v-q8"), { recursive: true });
    await mkdir(path.join(tempRoot, "models", "ltx-video-img2vid-int8"), { recursive: true });
    await mkdir(path.join(tempRoot, "models", "hunyuan-video-13b-planned"), { recursive: true });
    await mkdir(path.join(tempRoot, ".aie"), { recursive: true });
    await writeFile(path.join(tempRoot, ".venv", "Scripts", "python.exe"), "", "utf8");
    await writeFile(path.join(tempRoot, "ComfyUI", "main.py"), "", "utf8");
    await writeFile(path.join(tempRoot, "requirements.txt"), "torch\ndiffusers\n", "utf8");

    await inspectCinematicLocalRuntimeEnvironment({
      root: tempRoot,
      persist: true,
      pathHints: {
        python_paths: [".venv/Scripts/python.exe"],
        inference_runtime_paths: ["ComfyUI"],
        local_model_paths: ["models"],
      },
    });

    const simulation = await simulateCinematicControlledLocalInferenceBootstrap({
      root: tempRoot,
      desiredResolution: "720p",
      desiredDurationSeconds: 2,
      continuityPriority: "medium",
    });

    assert.equal(simulation.validation.dry_runtime_bootstrap.valid, false);
    assert.ok(simulation.validation.dry_runtime_bootstrap.activation_blockers.some((entry) => /ffmpeg visibility is still missing/i.test(entry)));
    assert.equal(simulation.validation.output_containment_validation.valid, false);
    assert.ok(simulation.validation.output_containment_validation.blocked_transitions.includes("runtime-integrity-sufficiency"));
    assert.equal(simulation.validation.runtime_integrity_validation.valid, false);
    assert.equal(simulation.validation.frame_to_frame_continuity_validation.valid, true);
    assert.equal(simulation.validation.governed_low_resolution_sandbox.real_output_written, false);
    assert.equal(simulation.validation.governed_micro_sequence_sandbox.real_sequence_written, true);
    assert.equal(simulation.validation.governed_micro_sequence_sandbox.sequence_frame_count, 3);

    const microSequenceDir = path.join(tempRoot, ".aie", "governed_micro_sequence_sandbox", "sequence-governed-micro-preview-001");
    const microSequenceFiles = await readdir(microSequenceDir);
    assert.equal(microSequenceFiles.filter((entry) => entry.endsWith(".ppm")).length, 3);
    assert.equal(microSequenceFiles.filter((entry) => entry.endsWith(".png")).length, 3);
    assert.ok(microSequenceFiles.includes("governed_preview_sequence_preview.gif"));
    assert.match(await readFile(path.join(microSequenceDir, "governed_preview_sequence_frame_001.ppm"), "utf8"), /^P3/m);
    assert.ok(simulation.validation.governed_micro_sequence_sandbox.output_file_paths.some((entry) => entry.endsWith(".png")));
    assert.ok(simulation.validation.governed_micro_sequence_sandbox.output_file_paths.some((entry) => entry.endsWith(".gif")));
    assert.match(simulation.validation.governed_motion_preview_sandbox.gif_preview_path ?? "", /governed_motion_preview\.gif$/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});