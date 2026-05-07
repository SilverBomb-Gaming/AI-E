import {
  clearGovernedMotionPreviewSandbox,
  simulateCinematicControlledLocalInferenceBootstrap,
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
    providerCall: overrides?.providerCall,
  };
}

export async function executeGovernedPreviewRequest(
  request: GovernedPreviewRequest,
  options?: GovernedPreviewExecutionOptions,
): Promise<GovernedPreviewExecutionResult> {
  const deps = resolveDependencies(options?.deps);

  if (request.blockers.length > 0) {
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
    };
  }

  const simulation = await deps.simulateBootstrap({
    root: options?.root,
    desiredResolution: request.resolution,
    desiredDurationSeconds: request.duration_seconds,
    continuityPriority: request.continuity_priority,
  });

  const previewSandbox = simulation.validation.governed_motion_preview_sandbox;
  const continuityValidation = simulation.validation.temporal_transition_validation;
  const rollbackLayer = simulation.validation.motion_preview_rollback;

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