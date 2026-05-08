import assert from "node:assert/strict";
import test from "node:test";

import {
  executeGovernedPreviewMicroSequenceRequest,
  executeGovernedPreviewRequest,
  readGovernedPreviewPrerequisiteState,
  rollbackGovernedPreviewSandbox,
} from "./governedPreviewGeneration";
import { compileGovernedPreviewRequest } from "./governedPreviewGenerationContract";

function buildPreviewDiagnosticsMock(frameCount: number) {
  return {
    recognizable_object: "anchored cube primitive",
    environment_profile: "dark-room sci-fi chamber with bounded fog gradient",
    lighting_profile: "single directional key with stable rim lighting",
    camera_profile: "governed locked-off camera with persistent horizon framing",
    continuity_anchor_visualization: "floor horizon + chamber aperture + centered cube anchor",
    scene_readability_overlay: "silhouette / camera / environment overlay",
    frame_coherence_score: 90,
    motion_smoothness_score: 89,
    environment_coherence_score: 91,
    camera_stability_score: 90,
    spatial_continuity_score: 89,
    lighting_stability_score: 94,
    lighting_consistency_score: 95,
    readability_score: 90,
    object_fidelity_score: 92,
    scene_composition_score: 91,
    continuity_quality_indicators: [
      {
        id: "object-fidelity",
        label: "Object Fidelity",
        score: 92,
        status: "stable",
        summary: "Stable primitive silhouette.",
      },
    ],
    artifact_diagnostics: ["Sandboxed primitive renderer only."],
    frame_diagnostics: Array.from({ length: frameCount }, (_, index) => ({
      frame_index: index + 1,
      object_kind: "cube",
      anchor_x: 128,
      anchor_y: 144,
      rotation_degrees: -12 + index * 7,
      camera_center_offset_x: 1.2,
      camera_center_offset_y: 0.6,
      camera_stability_score: 90,
      horizon_y: 174,
      horizon_consistency_score: 92,
      spatial_depth_score: 89,
      environment_coherence_score: 91,
      silhouette_score: 92,
      readability_score: 90,
      lighting_stability_score: 94,
      lighting_consistency_score: 95,
      coherence_anchor_strength: 91,
      fog_density: 0.24,
      environment_profile: "dark-room sci-fi chamber",
      continuity_anchor_visualization: "center anchor 128,144 on horizon 174",
      scene_readability_overlay: "silhouette / camera / environment overlay",
    })),
  };
}

function buildProductionMemoryMock(input: {
  governed_micro_sequence_sandbox_history: unknown[];
  frame_to_frame_continuity_validation_history: unknown[];
}) {
  return input as never;
}

function buildRollbackMock(input: unknown) {
  return input as never;
}

test("readGovernedPreviewPrerequisiteState reports missing micro-sequence prerequisite when no history exists", async () => {
  const prerequisiteState = await readGovernedPreviewPrerequisiteState({
    deps: {
      readProductionMemory: async () => buildProductionMemoryMock({
        governed_micro_sequence_sandbox_history: [],
        frame_to_frame_continuity_validation_history: [],
      }),
    },
  });

  assert.equal(prerequisiteState.micro_sequence_exists, false);
  assert.equal(prerequisiteState.motion_preview_ready, false);
  assert.equal(prerequisiteState.next_step_action, "generate-micro-sequence-first");
  assert.equal(prerequisiteState.preview_diagnostics, null);
  assert.match(prerequisiteState.continuity_validation.summary, /Generate the governed micro-sequence continuity preview first/i);
});

test("compileGovernedPreviewRequest blocks requests without manual approval", () => {
  const request = compileGovernedPreviewRequest({
    prompt: "Generate a short preview of a character turning toward camera.",
    subject: "Scout",
    motion_intent: "slow turn",
    style: "stylized realism",
    duration_seconds: 2,
    resolution: "720p",
    continuity_priority: "medium",
    governance_approval: false,
    package_gif_preview: true,
  });

  assert.equal(request.manual_approval_required, true);
  assert.equal(request.manual_approval_granted, false);
  assert.deepEqual(request.blockers, ["Manual governance approval is required for governed preview generation."]);
});

test("compileGovernedPreviewRequest enforces governed duration and resolution caps", () => {
  const request = compileGovernedPreviewRequest({
    prompt: "Preview a sprint burst through a fog gate.",
    subject: "Runner",
    motion_intent: "burst sprint",
    style: "dreamlike action",
    duration_seconds: 9,
    resolution: "4k",
    continuity_priority: "high",
    governance_approval: true,
    package_gif_preview: true,
  });

  assert.equal(request.duration_seconds, 2);
  assert.equal(request.resolution, "720p");
  assert.equal(request.sandbox_output_only, true);
  assert.equal(request.autonomous_continuation_allowed, false);
  assert.match(request.compiler_notes.join(" "), /Duration adjusted/);
  assert.match(request.compiler_notes.join(" "), /Resolution forced/);
});

test("executeGovernedPreviewRequest returns blocked status for compiler blockers", async () => {
  const request = compileGovernedPreviewRequest({
    prompt: "",
    subject: "Pilot",
    motion_intent: "hover",
    style: "cel shaded",
    duration_seconds: 2,
    resolution: "720p",
    continuity_priority: "low",
    governance_approval: false,
    package_gif_preview: true,
  });

  const result = await executeGovernedPreviewRequest(request, {
    deps: {
      simulateBootstrap: async () => {
        throw new Error("simulate should not run for blocked requests");
      },
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.sandbox_path, null);
  assert.equal(result.live_workspace_blocked_output, true);
  assert.ok(result.blockers.length >= 2);
});

test("executeGovernedPreviewRequest returns sandbox outputs and does not call providers", async () => {
  let simulateCallCount = 0;
  let providerCallCount = 0;
  const request = compileGovernedPreviewRequest({
    prompt: "Preview a cautious step into a lit corridor.",
    subject: "Explorer",
    motion_intent: "cautious step",
    style: "cinematic noir",
    duration_seconds: 1,
    resolution: "720p",
    continuity_priority: "high",
    governance_approval: true,
    package_gif_preview: true,
  });

  const result = await executeGovernedPreviewRequest(request, {
    deps: {
      providerCall: () => {
        providerCallCount += 1;
      },
      readProductionMemory: async () => buildProductionMemoryMock({
        governed_micro_sequence_sandbox_history: [
          {
            sequence_directory: ".aie/governed_micro_sequence_sandbox/sequence-governed-micro-preview-001",
            output_root: ".aie/governed_micro_sequence_sandbox",
            output_file_paths: [
              ".aie/governed_micro_sequence_sandbox/sequence-governed-micro-preview-001/governed_preview_sequence_frame_001.ppm",
            ],
            real_sequence_written: true,
            preview_diagnostics: buildPreviewDiagnosticsMock(3),
          },
        ],
        frame_to_frame_continuity_validation_history: [
          {
            valid: true,
            blocked_transitions: [],
            next_unlock_condition: "Micro-sequence continuity preview is validated within bounded temporal scope.",
          },
        ],
      }),
      simulateBootstrap: async () => {
        simulateCallCount += 1;
        return {
          validation: {
            governed_micro_sequence_sandbox: {
              sequence_directory: ".aie/governed_micro_sequence_sandbox/sequence-governed-micro-preview-001",
              output_root: ".aie/governed_micro_sequence_sandbox",
              output_file_paths: [
                ".aie/governed_micro_sequence_sandbox/sequence-governed-micro-preview-001/governed_preview_sequence_frame_001.ppm",
              ],
              real_sequence_written: true,
              preview_diagnostics: buildPreviewDiagnosticsMock(3),
            },
            frame_to_frame_continuity_validation: {
              valid: true,
              blocked_transitions: [],
              next_unlock_condition: "Micro-sequence continuity preview is validated within bounded temporal scope.",
            },
            governed_motion_preview_sandbox: {
              clip_directory: ".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001",
              output_root: ".aie/governed_motion_preview_sandbox",
              output_file_paths: [
                ".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001/governed_motion_preview_frame_001.ppm",
                ".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001/governed_motion_preview_frame_002.ppm",
              ],
              manifest_file_path: ".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001/governed_motion_preview_manifest.json",
              preview_diagnostics: buildPreviewDiagnosticsMock(2),
              preview_clip_written: true,
            },
            temporal_transition_validation: {
              valid: true,
              blocked_transitions: [],
              next_unlock_condition: "Low-duration preview clip remains validated inside the governed preview window.",
            },
            motion_preview_rollback: {
              actions: [
                {
                  triggered: true,
                  detail: "Preview rollback cleanup can remove the bounded motion preview clip without touching other outputs.",
                },
              ],
            },
            execution_attempt_ledger: {
              ledger_id: "ledger-001",
              attempts: [{ attempt_id: "attempt-001" }],
            },
          },
          simulation: {
            simulation_id: "simulation-001",
          },
        } as never;
      },
    },
  });

  assert.equal(simulateCallCount, 1);
  assert.equal(providerCallCount, 0);
  assert.equal(result.status, "accepted");
  assert.equal(result.sandbox_path, ".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001");
  assert.equal(result.generated_preview_references.length, 3);
  assert.equal(result.execution_ledger_state.attempt_count, 1);
  assert.equal(result.live_workspace_blocked_output, false);
  assert.equal(result.preview_diagnostics?.frame_coherence_score, 90);
  assert.equal(result.preview_diagnostics?.camera_stability_score, 90);
  assert.equal(result.preview_diagnostics?.environment_coherence_score, 91);
  assert.equal(result.prerequisite_state.preview_diagnostics?.object_fidelity_score, 92);
  assert.equal(result.prerequisite_state.preview_diagnostics?.camera_profile, "governed locked-off camera with persistent horizon framing");
});

test("executeGovernedPreviewRequest blocks when the governed micro-sequence prerequisite is missing", async () => {
  let simulateCallCount = 0;
  const request = compileGovernedPreviewRequest({
    prompt: "Preview a careful turn toward the doorway.",
    subject: "Operator",
    motion_intent: "careful turn",
    style: "grounded cinematic",
    duration_seconds: 1,
    resolution: "720p",
    continuity_priority: "medium",
    governance_approval: true,
    package_gif_preview: true,
  });

  const result = await executeGovernedPreviewRequest(request, {
    deps: {
      readProductionMemory: async () => buildProductionMemoryMock({
        governed_micro_sequence_sandbox_history: [],
        frame_to_frame_continuity_validation_history: [],
      }),
      simulateBootstrap: async () => {
        simulateCallCount += 1;
        throw new Error("simulate should not run before prerequisite readiness");
      },
    },
  });

  assert.equal(simulateCallCount, 0);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["micro-sequence-prerequisite"]);
  assert.equal(result.prerequisite_state.motion_preview_ready, false);
  assert.equal(result.prerequisite_state.next_step_action, "generate-micro-sequence-first");
});

test("executeGovernedPreviewMicroSequenceRequest returns micro-sequence frame references and continuity status", async () => {
  const request = compileGovernedPreviewRequest({
    prompt: "Prepare a bounded continuity preview before motion generation.",
    subject: "Scout",
    motion_intent: "measured lean",
    style: "stylized realism",
    duration_seconds: 2,
    resolution: "720p",
    continuity_priority: "high",
    governance_approval: true,
    package_gif_preview: true,
  });

  const result = await executeGovernedPreviewMicroSequenceRequest(request, {
    deps: {
      simulateBootstrap: async () => ({
        validation: {
          governed_micro_sequence_sandbox: {
            sequence_directory: ".aie/governed_micro_sequence_sandbox/sequence-governed-micro-preview-001",
            output_root: ".aie/governed_micro_sequence_sandbox",
            output_file_paths: [
              ".aie/governed_micro_sequence_sandbox/sequence-governed-micro-preview-001/governed_preview_sequence_frame_001.ppm",
              ".aie/governed_micro_sequence_sandbox/sequence-governed-micro-preview-001/governed_preview_sequence_frame_002.ppm",
              ".aie/governed_micro_sequence_sandbox/sequence-governed-micro-preview-001/governed_preview_sequence_frame_003.ppm",
            ],
            real_sequence_written: true,
            preview_diagnostics: buildPreviewDiagnosticsMock(3),
          },
          frame_to_frame_continuity_validation: {
            valid: true,
            blocked_transitions: [],
            next_unlock_condition: "Micro-sequence continuity preview is validated within bounded temporal scope.",
          },
        },
        simulation: {
          simulation_id: "simulation-002",
        },
      } as never),
      clearPreviewSandbox: async () => buildRollbackMock({
        rolled_back: true,
        recorded_at: "2026-05-07T00:00:00.000Z",
        output_root: ".aie/governed_motion_preview_sandbox",
        clip_directory: ".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001",
        deleted_output_targets: [
          ".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001/governed_motion_preview_manifest.json",
        ],
        rollback: {
          rollback_id: "rollback-001",
          recorded_at: "2026-05-07T00:00:00.000Z",
          actions: [
            {
              triggered: true,
              detail: "Deletion remains bounded to the governed motion preview sandbox root.",
              affected_output_targets: [
                ".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001/governed_motion_preview_manifest.json",
              ],
            },
          ],
        },
        governance_status: "Rollback remained bounded to governed motion preview sandbox outputs only.",
        sandbox_limited: true,
      }),
    },
  });

  assert.equal(result.status, "generated");
  assert.equal(result.generated_frame_references.length, 3);
  assert.equal(result.continuity_validation.valid, true);
  assert.equal(result.prerequisite_state.motion_preview_ready, true);
  assert.equal(result.preview_cleanup_targets.length, 1);
  assert.equal(result.preview_diagnostics?.object_fidelity_score, 92);
  assert.equal(result.preview_diagnostics?.environment_coherence_score, 91);
  assert.equal(result.preview_diagnostics?.scene_readability_overlay, "silhouette / camera / environment overlay");
  assert.equal(result.preview_diagnostics?.frame_diagnostics.length, 3);
});

test("rollbackGovernedPreviewSandbox stays bounded to preview sandbox outputs", async () => {
  const result = await rollbackGovernedPreviewSandbox({
    deps: {
      clearPreviewSandbox: async () => buildRollbackMock({
        rolled_back: true,
        recorded_at: "2026-05-07T00:00:00.000Z",
        output_root: ".aie/governed_motion_preview_sandbox",
        clip_directory: ".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001",
        deleted_output_targets: [
          ".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001/governed_motion_preview_frame_001.ppm",
          ".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001/governed_motion_preview_manifest.json",
        ],
        rollback: {
          rollback_id: "rollback-002",
          recorded_at: "2026-05-07T00:00:00.000Z",
          actions: [
            {
              triggered: true,
              detail: "Deletion remains bounded to the governed motion preview sandbox root.",
              affected_output_targets: [
                ".aie/governed_motion_preview_sandbox/clip-governed-motion-preview-001/governed_motion_preview_frame_001.ppm",
              ],
            },
          ],
        },
        governance_status: "Rollback remained bounded to governed motion preview sandbox outputs only.",
        sandbox_limited: true,
      }),
    },
  });

  assert.equal(result.status, "rolled_back");
  assert.equal(result.sandbox_limited, true);
  assert.ok(result.deleted_output_targets.every((target) => target.startsWith(".aie/governed_motion_preview_sandbox/")));
});