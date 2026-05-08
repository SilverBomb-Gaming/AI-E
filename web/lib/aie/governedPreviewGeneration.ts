import {
  clearGovernedMotionPreviewSandbox,
  readCinematicProductionMemory,
  simulateCinematicControlledLocalInferenceBootstrap,
  type CinematicFrameToFrameContinuityValidation,
  type CinematicGovernedMicroSequenceSandbox,
  type CinematicControlledLocalInferenceBootstrapResult,
} from "./cinematicProductionMemory";

import {
  compileGovernedPreviewRequest,
  type GovernedPreviewExecutionStatus,
  type GovernedPreviewFormInput,
  type GovernedPreviewRequest,
} from "./governedPreviewGenerationContract";

export type GovernedPreviewExecutionResult = {
  status: GovernedPreviewExecutionStatus;
  request: GovernedPreviewRequest;
  governance_status: string;
  sandbox_path: string | null;
  sandbox_output_root: string | null;
  generated_preview_references: string[];
  manifest_file_path: string | null;
  rollback_status: string;
  rollback_enabled: true;
  continuity_validation: {
    valid: boolean;
    blockers: string[];
    summary: string;
  };
  execution_ledger_state: {
    ledger_id: string | null;
    attempt_count: number;
  };
  live_workspace_blocked_output: boolean;
  errors: string[];
  blockers: string[];
  prerequisite_state: GovernedPreviewPrerequisiteState;
  simulation?: CinematicControlledLocalInferenceBootstrapResult;
};

export type GovernedPreviewPrerequisiteState = {
  micro_sequence_exists: boolean;
  motion_preview_ready: boolean;
  sandbox_path: string | null;
  sandbox_output_root: string | null;
  generated_frame_references: string[];
  continuity_validation: {
    valid: boolean;
    blockers: string[];
    summary: string;
  };
  next_step_action: "generate-micro-sequence-first" | null;
  next_step_label: string | null;
};

export type GovernedPreviewMicroSequenceResult = {
  status: "generated" | "blocked";
  request: GovernedPreviewRequest;
  governance_status: string;
  sandbox_path: string | null;
  sandbox_output_root: string | null;
  generated_frame_references: string[];
  rollback_status: string;
  rollback_enabled: true;
  continuity_validation: {
    valid: boolean;
    blockers: string[];
    summary: string;
  };
  preview_cleanup_targets: string[];
  live_workspace_blocked_output: boolean;
  errors: string[];
  blockers: string[];
  prerequisite_state: GovernedPreviewPrerequisiteState;
  simulation?: CinematicControlledLocalInferenceBootstrapResult;
};

export type GovernedPreviewRollbackResult = {
  status: "rolled_back" | "idle";
  sandbox_path: string | null;
  deleted_output_targets: string[];
  rollback_status: string;
  sandbox_limited: true;
};

export type GovernedPreviewDependencies = {
  simulateBootstrap: typeof simulateCinematicControlledLocalInferenceBootstrap;
  clearPreviewSandbox: typeof clearGovernedMotionPreviewSandbox;
  readProductionMemory: typeof readCinematicProductionMemory;
  providerCall?: () => void;
};

export type GovernedPreviewExecutionOptions = {
  root?: string;
  deps?: Partial<GovernedPreviewDependencies>;
};

function resolveDependencies(overrides?: Partial<GovernedPreviewDependencies>): GovernedPreviewDependencies {
  return {
    simulateBootstrap: overrides?.simulateBootstrap ?? simulateCinematicControlledLocalInferenceBootstrap,
    clearPreviewSandbox: overrides?.clearPreviewSandbox ?? clearGovernedMotionPreviewSandbox,
    readProductionMemory: overrides?.readProductionMemory ?? readCinematicProductionMemory,
    providerCall: overrides?.providerCall,
  };
}

function buildPrerequisiteState(input?: {
  governedMicroSequenceSandbox?: Pick<CinematicGovernedMicroSequenceSandbox, "sequence_directory" | "output_root" | "output_file_paths" | "real_sequence_written"> | null;
  continuityValidation?: Pick<CinematicFrameToFrameContinuityValidation, "valid" | "blocked_transitions" | "next_unlock_condition"> | null;
}): GovernedPreviewPrerequisiteState {
  const sandbox = input?.governedMicroSequenceSandbox ?? null;
  const continuityValidation = input?.continuityValidation ?? null;
  const microSequenceExists = sandbox?.real_sequence_written === true;
  const continuityValid = continuityValidation?.valid === true;
  const motionPreviewReady = microSequenceExists && continuityValid;

  return {
    micro_sequence_exists: microSequenceExists,
    motion_preview_ready: motionPreviewReady,
    sandbox_path: sandbox?.sequence_directory ?? null,
    sandbox_output_root: sandbox?.output_root ?? null,
    generated_frame_references: sandbox?.output_file_paths ?? [],
    continuity_validation: {
      valid: continuityValid,
      blockers: continuityValidation?.blocked_transitions ?? (motionPreviewReady ? [] : ["micro-sequence-prerequisite"]),
      summary: continuityValidation?.next_unlock_condition
        ?? (motionPreviewReady
          ? "Governed micro-sequence prerequisite satisfied."
          : "Generate the governed micro-sequence continuity preview first."),
    },
    next_step_action: motionPreviewReady ? null : "generate-micro-sequence-first",
    next_step_label: motionPreviewReady ? null : "Generate Micro-Sequence First",
  };
}

export async function readGovernedPreviewPrerequisiteState(options?: GovernedPreviewExecutionOptions): Promise<GovernedPreviewPrerequisiteState> {
  const deps = resolveDependencies(options?.deps);
  const record = await deps.readProductionMemory({ root: options?.root });

  return buildPrerequisiteState({
    governedMicroSequenceSandbox: record.governed_micro_sequence_sandbox_history[0] ?? null,
    continuityValidation: record.frame_to_frame_continuity_validation_history[0] ?? null,
  });
}

export async function executeGovernedPreviewMicroSequenceRequest(
  request: GovernedPreviewRequest,
  options?: GovernedPreviewExecutionOptions,
): Promise<GovernedPreviewMicroSequenceResult> {
  const deps = resolveDependencies(options?.deps);

  if (request.blockers.length > 0) {
    const prerequisiteState = await readGovernedPreviewPrerequisiteState(options);
    return {
      status: "blocked",
      request,
      governance_status: request.manual_approval_granted
        ? "Manual approval recorded, but micro-sequence generation remains blocked by compiler validation."
        : "Blocked pending manual approval.",
      sandbox_path: prerequisiteState.sandbox_path,
      sandbox_output_root: prerequisiteState.sandbox_output_root,
      generated_frame_references: prerequisiteState.generated_frame_references,
      rollback_status: "Rollback remains limited to governed sandbox outputs.",
      rollback_enabled: true,
      continuity_validation: prerequisiteState.continuity_validation,
      preview_cleanup_targets: [],
      live_workspace_blocked_output: true,
      errors: [],
      blockers: [...request.blockers],
      prerequisite_state: prerequisiteState,
    };
  }

  const simulation = await deps.simulateBootstrap({
    root: options?.root,
    desiredResolution: request.resolution,
    desiredDurationSeconds: request.duration_seconds,
    continuityPriority: request.continuity_priority,
    packageGifPreview: request.package_gif_preview,
  });
  const prerequisiteState = buildPrerequisiteState({
    governedMicroSequenceSandbox: simulation.validation.governed_micro_sequence_sandbox,
    continuityValidation: simulation.validation.frame_to_frame_continuity_validation,
  });
  const cleanup = await deps.clearPreviewSandbox({ root: options?.root });

  return {
    status: prerequisiteState.motion_preview_ready ? "generated" : "blocked",
    request,
    governance_status: request.manual_approval_granted
      ? "Manual approval granted. Governed micro-sequence continuity preview remained inside sandbox boundaries."
      : "Manual approval missing.",
    sandbox_path: prerequisiteState.sandbox_path,
    sandbox_output_root: prerequisiteState.sandbox_output_root,
    generated_frame_references: prerequisiteState.generated_frame_references,
    rollback_status: cleanup.rollback.actions
      .filter((entry) => entry.triggered)
      .map((entry) => entry.detail)
      .join(" "),
    rollback_enabled: true,
    continuity_validation: prerequisiteState.continuity_validation,
    preview_cleanup_targets: cleanup.deleted_output_targets,
    live_workspace_blocked_output: true,
    errors: [],
    blockers: prerequisiteState.motion_preview_ready ? [] : [...prerequisiteState.continuity_validation.blockers],
    prerequisite_state: prerequisiteState,
    simulation,
  };
}

export async function executeGovernedPreviewRequest(
  request: GovernedPreviewRequest,
  options?: GovernedPreviewExecutionOptions,
): Promise<GovernedPreviewExecutionResult> {
  const deps = resolveDependencies(options?.deps);

  if (request.blockers.length > 0) {
    const prerequisiteState = await readGovernedPreviewPrerequisiteState(options);
    return {
      status: "blocked",
      request,
      governance_status: request.manual_approval_granted
        ? "Manual approval recorded, but request remains blocked by compiler validation."
        : "Blocked pending manual approval.",
      sandbox_path: null,
      sandbox_output_root: null,
      generated_preview_references: [],
      manifest_file_path: null,
      rollback_status: "Rollback is available once bounded sandbox output exists.",
      rollback_enabled: true,
      continuity_validation: {
        valid: false,
        blockers: [...request.blockers],
        summary: "Governed preview request was blocked before sandbox execution.",
      },
      execution_ledger_state: {
        ledger_id: null,
        attempt_count: 0,
      },
      live_workspace_blocked_output: true,
      errors: [],
      blockers: [...request.blockers],
      prerequisite_state: prerequisiteState,
    };
  }

  const prerequisiteState = await readGovernedPreviewPrerequisiteState(options);
  if (!prerequisiteState.motion_preview_ready) {
    return {
      status: "blocked",
      request,
      governance_status: "Governed motion preview remains blocked until the micro-sequence continuity prerequisite is satisfied.",
      sandbox_path: null,
      sandbox_output_root: null,
      generated_preview_references: [],
      manifest_file_path: null,
      rollback_status: "Rollback is available once bounded sandbox output exists.",
      rollback_enabled: true,
      continuity_validation: prerequisiteState.continuity_validation,
      execution_ledger_state: {
        ledger_id: null,
        attempt_count: 0,
      },
      live_workspace_blocked_output: true,
      errors: [],
      blockers: ["micro-sequence-prerequisite"],
      prerequisite_state: prerequisiteState,
    };
  }

  const simulation = await deps.simulateBootstrap({
    root: options?.root,
    desiredResolution: request.resolution,
    desiredDurationSeconds: request.duration_seconds,
    continuityPriority: request.continuity_priority,
    packageGifPreview: request.package_gif_preview,
  });

  const previewSandbox = simulation.validation.governed_motion_preview_sandbox;
  const continuityValidation = simulation.validation.temporal_transition_validation;
  const rollbackLayer = simulation.validation.motion_preview_rollback;
  const nextPrerequisiteState = buildPrerequisiteState({
    governedMicroSequenceSandbox: simulation.validation.governed_micro_sequence_sandbox,
    continuityValidation: simulation.validation.frame_to_frame_continuity_validation,
  });

  return {
    status: "accepted",
    request,
    governance_status: request.manual_approval_granted
      ? "Manual approval granted. Governed preview remained inside sandbox boundaries."
      : "Manual approval missing.",
    sandbox_path: previewSandbox.clip_directory,
    sandbox_output_root: previewSandbox.output_root,
    generated_preview_references: [
      ...previewSandbox.output_file_paths,
      ...(previewSandbox.manifest_file_path ? [previewSandbox.manifest_file_path] : []),
    ],
    manifest_file_path: previewSandbox.manifest_file_path,
    rollback_status: rollbackLayer.actions
      .filter((entry) => entry.triggered)
      .map((entry) => entry.detail)
      .join(" "),
    rollback_enabled: true,
    continuity_validation: {
      valid: continuityValidation.valid,
      blockers: [...continuityValidation.blocked_transitions],
      summary: continuityValidation.next_unlock_condition,
    },
    execution_ledger_state: {
      ledger_id: simulation.validation.execution_attempt_ledger.ledger_id,
      attempt_count: simulation.validation.execution_attempt_ledger.attempts.length,
    },
    live_workspace_blocked_output: !previewSandbox.preview_clip_written,
    errors: [],
    blockers: continuityValidation.blocked_transitions,
    prerequisite_state: nextPrerequisiteState,
    simulation,
  };
}

export async function rollbackGovernedPreviewSandbox(options?: GovernedPreviewExecutionOptions): Promise<GovernedPreviewRollbackResult> {
  const deps = resolveDependencies(options?.deps);
  const rollback = await deps.clearPreviewSandbox({ root: options?.root });

  return {
    status: rollback.rolled_back ? "rolled_back" : "idle",
    sandbox_path: rollback.clip_directory,
    deleted_output_targets: rollback.deleted_output_targets,
    rollback_status: rollback.rollback.actions
      .filter((entry) => entry.triggered)
      .map((entry) => entry.detail)
      .join(" "),
    sandbox_limited: true,
  };
}