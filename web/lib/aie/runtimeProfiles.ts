export const DEFAULT_RUNTIME_PROFILE_NAME = "local_supervised";

export type RuntimeProfileName =
  | "dry_run"
  | "local_supervised"
  | "operator_away_safe"
  | "conservative_validation"
  | "bounded_batch";

export type RuntimeProfile = {
  profile_name: RuntimeProfileName;
  description: string;
  tick_interval_ms: number;
  max_ticks_per_run: number;
  max_runs_per_invocation: number;
  operator_away_mode: boolean;
  dry_run_mode: boolean;
  require_fresh_approvals: boolean;
  require_fresh_context: boolean;
  stop_on_blocker: boolean;
  stop_on_error: boolean;
};

export type RuntimeProfileOverrides = Partial<Omit<RuntimeProfile, "profile_name" | "description">>;

const RUNTIME_PROFILES: Record<RuntimeProfileName, RuntimeProfile> = {
  dry_run: {
    profile_name: "dry_run",
    description: "Validate runtime startup configuration without starting bounded background ticks.",
    tick_interval_ms: 60_000,
    max_ticks_per_run: 1,
    max_runs_per_invocation: 1,
    operator_away_mode: false,
    dry_run_mode: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
    stop_on_blocker: true,
    stop_on_error: true,
  },
  local_supervised: {
    profile_name: "local_supervised",
    description: "Run a short local supervised bounded runtime pass with fresh approvals and context enforced.",
    tick_interval_ms: 60_000,
    max_ticks_per_run: 3,
    max_runs_per_invocation: 1,
    operator_away_mode: false,
    dry_run_mode: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
    stop_on_blocker: true,
    stop_on_error: true,
  },
  operator_away_safe: {
    profile_name: "operator_away_safe",
    description: "Run the supervised operator-away mode with conservative bounded limits and freshness gates still enabled.",
    tick_interval_ms: 300_000,
    max_ticks_per_run: 3,
    max_runs_per_invocation: 1,
    operator_away_mode: true,
    dry_run_mode: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
    stop_on_blocker: true,
    stop_on_error: true,
  },
  conservative_validation: {
    profile_name: "conservative_validation",
    description: "Prefer shorter bounded runs for validation-heavy checks before any longer operator-away usage.",
    tick_interval_ms: 120_000,
    max_ticks_per_run: 2,
    max_runs_per_invocation: 1,
    operator_away_mode: false,
    dry_run_mode: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
    stop_on_blocker: true,
    stop_on_error: true,
  },
  bounded_batch: {
    profile_name: "bounded_batch",
    description: "Run a slightly larger but still bounded supervised batch without weakening freshness or blocker stops.",
    tick_interval_ms: 60_000,
    max_ticks_per_run: 4,
    max_runs_per_invocation: 2,
    operator_away_mode: true,
    dry_run_mode: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
    stop_on_blocker: true,
    stop_on_error: true,
  },
};

function assertPositiveInteger(value: number, field: keyof RuntimeProfile): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid runtime profile: ${field} must be a finite positive integer.`);
  }
  return value;
}

function cloneProfile(profile: RuntimeProfile): RuntimeProfile {
  return {
    ...profile,
  };
}

export function validateRuntimeProfile(profile: RuntimeProfile): RuntimeProfile {
  const normalized = cloneProfile(profile);
  normalized.tick_interval_ms = assertPositiveInteger(normalized.tick_interval_ms, "tick_interval_ms");
  normalized.max_ticks_per_run = assertPositiveInteger(normalized.max_ticks_per_run, "max_ticks_per_run");
  normalized.max_runs_per_invocation = assertPositiveInteger(normalized.max_runs_per_invocation, "max_runs_per_invocation");

  if (!normalized.require_fresh_approvals) {
    throw new Error("Invalid runtime profile: require_fresh_approvals must remain true.");
  }
  if (!normalized.require_fresh_context) {
    throw new Error("Invalid runtime profile: require_fresh_context must remain true.");
  }
  if (!normalized.stop_on_blocker) {
    throw new Error("Invalid runtime profile: stop_on_blocker must remain true.");
  }
  if (!normalized.stop_on_error) {
    throw new Error("Invalid runtime profile: stop_on_error must remain true.");
  }

  return normalized;
}

export function listRuntimeProfiles(): RuntimeProfile[] {
  return Object.values(RUNTIME_PROFILES).map((profile) => validateRuntimeProfile(cloneProfile(profile)));
}

export function getRuntimeProfile(name: string = DEFAULT_RUNTIME_PROFILE_NAME): RuntimeProfile {
  const profile = RUNTIME_PROFILES[name as RuntimeProfileName];
  if (!profile) {
    throw new Error(`Unknown runtime profile: ${name}`);
  }
  return validateRuntimeProfile(cloneProfile(profile));
}

export function resolveRuntimeProfile(name: string = DEFAULT_RUNTIME_PROFILE_NAME, overrides: RuntimeProfileOverrides = {}): RuntimeProfile {
  const base = getRuntimeProfile(name);
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as RuntimeProfileOverrides;
  return validateRuntimeProfile({
    ...base,
    ...definedOverrides,
  });
}

export function summarizeRuntimeProfile(profile: RuntimeProfile): string {
  return [
    `Runtime profile: ${profile.profile_name}`,
    `Profile description: ${profile.description}`,
    `Tick interval ms: ${profile.tick_interval_ms}`,
    `Max ticks per run: ${profile.max_ticks_per_run}`,
    `Max runs per invocation: ${profile.max_runs_per_invocation}`,
    `Operator away mode: ${profile.operator_away_mode}`,
    `Dry run mode: ${profile.dry_run_mode}`,
    `Require fresh approvals: ${profile.require_fresh_approvals}`,
    `Require fresh context: ${profile.require_fresh_context}`,
    `Stop on blocker: ${profile.stop_on_blocker}`,
    `Stop on error: ${profile.stop_on_error}`,
  ].join("\n");
}