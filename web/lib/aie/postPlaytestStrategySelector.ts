import type { PostPlaytestDecisionResult } from "./postPlaytestDecisionEngine";

export type PostPlaytestStrategySelectorStatus =
  | "strategy_selected"
  | "strategy_blocked"
  | "operator_review_required"
  | "no_strategy_needed";

export type PostPlaytestStrategyCandidate = {
  strategy_id: "minimal_code_patch" | "configuration_adjustment" | "test_or_marker_adjustment";
  strategy_label: string;
  description: string;
  allowed_file_scopes: string[];
  max_changed_files: number;
  viable: boolean;
  rejection_reason: string | null;
};

export type PostPlaytestStrategySelectorInput = {
  decision: PostPlaytestDecisionResult;
  allowed_file_scopes?: string[];
  failed_strategy_ids?: string[];
};

export type PostPlaytestStrategySelectorResult = {
  status: PostPlaytestStrategySelectorStatus;
  selected_strategy_id: string | null;
  selected_strategy_label: string | null;
  candidate_strategies: PostPlaytestStrategyCandidate[];
  rejection_reasons: string[];
  reason: string;
  confidence: "low" | "medium" | "high";
  source_feature?: string;
  source_outcome_session_key?: string;
};

const DEFAULT_ALLOWED_SCOPES = [
  "orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts",
  "orchestrator_lane/Tools/EnemyAIDemoStandalone/ProjectSettings",
  "web/scripts",
];

const STRATEGY_CATALOG: Array<Omit<PostPlaytestStrategyCandidate, "viable" | "rejection_reason">> = [
  {
    strategy_id: "minimal_code_patch",
    strategy_label: "Minimal code patch",
    description: "Prefer the smallest source edit and keep the change to one or two files.",
    allowed_file_scopes: [
      "orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts",
    ],
    max_changed_files: 2,
  },
  {
    strategy_id: "test_or_marker_adjustment",
    strategy_label: "Test or marker adjustment",
    description: "Restrict the fix to instrumentation or marker-only improvements for the safest proof path.",
    allowed_file_scopes: [
      "orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts",
      "web/scripts",
    ],
    max_changed_files: 2,
  },
  {
    strategy_id: "configuration_adjustment",
    strategy_label: "Configuration adjustment",
    description: "Use a project-level safe configuration change and avoid generated files.",
    allowed_file_scopes: [
      "orchestrator_lane/Tools/EnemyAIDemoStandalone/ProjectSettings",
    ],
    max_changed_files: 1,
  },
];

function normalizeScope(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").trim();
}

function getEffectiveAllowedScopes(allowedScopes?: string[]): string[] {
  if (!allowedScopes || allowedScopes.length === 0) {
    return DEFAULT_ALLOWED_SCOPES;
  }

  return allowedScopes.map(normalizeScope).filter(Boolean);
}

function scopesIntersect(candidateScopes: string[], allowedScopes: string[]): boolean {
  return candidateScopes.some((candidateScope) => {
    const normalizedCandidate = normalizeScope(candidateScope);
    return allowedScopes.some((allowedScope) => {
      const normalizedAllowed = normalizeScope(allowedScope);
      return normalizedCandidate === normalizedAllowed
        || normalizedCandidate.startsWith(`${normalizedAllowed}/`)
        || normalizedAllowed.startsWith(`${normalizedCandidate}/`);
    });
  });
}

function createBaseResult(
  decision: PostPlaytestDecisionResult,
  overrides: Partial<PostPlaytestStrategySelectorResult>,
): PostPlaytestStrategySelectorResult {
  return {
    status: overrides.status ?? "strategy_blocked",
    selected_strategy_id: overrides.selected_strategy_id ?? null,
    selected_strategy_label: overrides.selected_strategy_label ?? null,
    candidate_strategies: overrides.candidate_strategies ?? [],
    rejection_reasons: overrides.rejection_reasons ?? [],
    reason: overrides.reason ?? decision.reason,
    confidence: overrides.confidence ?? decision.confidence,
    source_feature: decision.source_feature,
    source_outcome_session_key: decision.source_outcome_session_key,
  };
}

export function selectPostPlaytestStrategy(
  input: PostPlaytestStrategySelectorInput,
): PostPlaytestStrategySelectorResult {
  const { decision } = input;

  if (decision.status === "ready_for_next_feature") {
    return createBaseResult(decision, {
      status: "no_strategy_needed",
      reason: "The post-playtest decision already marked the feature ready for the next target, so no bounded retry strategy is needed.",
      confidence: "high",
    });
  }

  if (decision.status === "escalation_recommended") {
    return createBaseResult(decision, {
      status: "operator_review_required",
      reason: "The post-playtest evidence stayed ambiguous, so operator review is required before selecting a bounded retry strategy.",
      confidence: "low",
    });
  }

  if (decision.status !== "retry_recommended") {
    return createBaseResult(decision, {
      status: "strategy_blocked",
      reason: decision.reason,
      confidence: "high",
    });
  }

  const allowedScopes = getEffectiveAllowedScopes(input.allowed_file_scopes);
  const failedStrategies = new Set((input.failed_strategy_ids ?? []).map((value) => value.trim()).filter(Boolean));
  const candidateStrategies = STRATEGY_CATALOG.map((candidate) => {
    if (failedStrategies.has(candidate.strategy_id)) {
      return {
        ...candidate,
        viable: false,
        rejection_reason: `The prior outcome learning already rejected ${candidate.strategy_id} inside this bounded loop.`,
      } satisfies PostPlaytestStrategyCandidate;
    }

    if (!scopesIntersect(candidate.allowed_file_scopes, allowedScopes)) {
      return {
        ...candidate,
        viable: false,
        rejection_reason: `${candidate.strategy_id} is outside the currently allowed file scopes for this bounded loop.`,
      } satisfies PostPlaytestStrategyCandidate;
    }

    return {
      ...candidate,
      viable: true,
      rejection_reason: null,
    } satisfies PostPlaytestStrategyCandidate;
  });

  const selectedCandidate = candidateStrategies.find((candidate) => candidate.viable) ?? null;
  const rejectionReasons = candidateStrategies
    .map((candidate) => candidate.rejection_reason)
    .filter((reason): reason is string => Boolean(reason));

  if (!selectedCandidate) {
    return createBaseResult(decision, {
      status: "strategy_blocked",
      candidate_strategies: candidateStrategies,
      rejection_reasons: rejectionReasons,
      reason: "No safe bounded retry strategy remained available inside the allowed file scopes for this loop.",
      confidence: "high",
    });
  }

  return createBaseResult(decision, {
    status: "strategy_selected",
    selected_strategy_id: selectedCandidate.strategy_id,
    selected_strategy_label: selectedCandidate.strategy_label,
    candidate_strategies: candidateStrategies,
    rejection_reasons: rejectionReasons,
    reason: failedStrategies.size > 0
      ? `The bounded loop selected ${selectedCandidate.strategy_id} because prior outcome learning ruled out the failed earlier strategy.`
      : `The bounded loop selected ${selectedCandidate.strategy_id} as the safest viable retry strategy for this failure outcome.`,
    confidence: decision.confidence === "low" ? "medium" : decision.confidence,
  });
}