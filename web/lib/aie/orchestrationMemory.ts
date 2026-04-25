export type GoalStatus = "active" | "nearing_completion" | "completed" | "stalled";

export type GoalState = {
  goal: string;
  status: GoalStatus;
  progress_percent: number;
  duplicate_step_count: number;
  consecutive_duplicate_cycles: number;
  last_completed_step_title: string | null;
  completion_reason: string | null;
  completed_at: string | null;
};

export type CompletedStep = {
  step_key: string;
  step_id: string | null;
  title: string;
  rationale: string;
  completed_at: string;
  cycle_id: string | null;
  marks_goal_complete: boolean;
};

export type ProposedStep = {
  step_key: string;
  step_id: string | null;
  title: string;
  rationale: string;
  proposed_at: string;
  cycle_id: string | null;
};

export type OrchestrationMemory = {
  memory_id: string;
  goal: string;
  created_at: string;
  last_updated_at: string;
  cycle_ids: string[];
  goal_state: GoalState;
  completed_steps: CompletedStep[];
  proposed_steps: ProposedStep[];
};

export type OrchestrationMemoryStep = {
  step_id?: string | null;
  title: string;
  rationale?: string | null;
  occurred_at?: string;
  cycle_id?: string | null;
  kind?: "proposed" | "completed";
  marks_goal_complete?: boolean;
};

export type DuplicateStepResult = {
  is_duplicate: boolean;
  matched_kind: "proposed" | "completed" | null;
  matched_step_id: string | null;
  explanation: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "orchestration-memory";
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildMemoryId(goal: string, createdAt: string): string {
  return `orchestration-memory-${sanitizeTimestamp(createdAt)}-${slugify(goal)}`;
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function buildStepKey(step: Pick<OrchestrationMemoryStep, "title">): string {
  return tokenize(step.title).join(" ") || slugify(step.title);
}

function calculateGoalOverlap(goal: string, value: string): number {
  const goalTokens = tokenize(goal);
  if (goalTokens.length === 0) {
    return 0;
  }

  const valueTokens = new Set(tokenize(value));
  const matches = goalTokens.filter((token) => valueTokens.has(token)).length;
  return matches / goalTokens.length;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasTerminalCompletionSignal(step: CompletedStep, goal: string): boolean {
  const text = `${step.title} ${step.rationale}`.toLowerCase();
  const hasTerminalKeyword = /(complete|completed|finish|finished|final|finalize|done|delivered|shipped|verified|ready)/.test(text);
  const hasPartialSignal = /(first half|partial|phase|slice|initial|first pass|first step)/.test(text);
  return step.marks_goal_complete || (!hasPartialSignal && hasTerminalKeyword && calculateGoalOverlap(goal, text) >= 0.4);
}

function countUniqueStepKeys(memory: Pick<OrchestrationMemory, "completed_steps" | "proposed_steps">): number {
  return new Set([
    ...memory.completed_steps.map((step) => step.step_key),
    ...memory.proposed_steps.map((step) => step.step_key),
  ]).size;
}

export function evaluateGoalCompletion(memory: OrchestrationMemory): GoalState {
  const totalCompleted = memory.completed_steps.length;
  const totalKnownSteps = countUniqueStepKeys(memory);
  const lastCompletedStep = memory.completed_steps.at(-1) ?? null;
  const completionStep = memory.completed_steps.find((step) => hasTerminalCompletionSignal(step, memory.goal)) ?? null;
  const strongestOverlap = memory.completed_steps.reduce((best, step) => {
    return Math.max(best, calculateGoalOverlap(memory.goal, `${step.title} ${step.rationale}`));
  }, 0);

  const progressPercent = totalKnownSteps === 0
    ? 0
    : clampProgress((totalCompleted / totalKnownSteps) * 100);

  let status: GoalStatus = "active";
  let completionReason: string | null = null;
  let completedAt: string | null = null;

  if (completionStep) {
    status = "completed";
    completionReason = completionStep.marks_goal_complete
      ? `Completed by explicit goal-complete step: ${completionStep.title}`
      : `Completed by terminal completion evidence in step: ${completionStep.title}`;
    completedAt = completionStep.completed_at;
  } else if (memory.goal_state.consecutive_duplicate_cycles >= 2 || memory.goal_state.duplicate_step_count >= 3) {
    status = "stalled";
    completionReason = "Repeated suggestions indicate the goal needs review before continuing.";
  } else if (totalCompleted > 0 && (strongestOverlap >= 0.34 || progressPercent >= 50)) {
    status = "nearing_completion";
    completionReason = `Completed work now overlaps the goal enough to treat the goal as nearing completion.`;
  }

  return {
    goal: memory.goal,
    status,
    progress_percent: progressPercent,
    duplicate_step_count: memory.goal_state.duplicate_step_count,
    consecutive_duplicate_cycles: memory.goal_state.consecutive_duplicate_cycles,
    last_completed_step_title: lastCompletedStep?.title ?? null,
    completion_reason: completionReason,
    completed_at: completedAt,
  };
}

export function createOrchestrationMemory(goal: string, createdAt?: string): OrchestrationMemory {
  const now = normalizeText(createdAt) || new Date().toISOString();
  const normalizedGoal = normalizeText(goal) || "Untitled orchestration goal";
  const memory: OrchestrationMemory = {
    memory_id: buildMemoryId(normalizedGoal, now),
    goal: normalizedGoal,
    created_at: now,
    last_updated_at: now,
    cycle_ids: [],
    goal_state: {
      goal: normalizedGoal,
      status: "active",
      progress_percent: 0,
      duplicate_step_count: 0,
      consecutive_duplicate_cycles: 0,
      last_completed_step_title: null,
      completion_reason: null,
      completed_at: null,
    },
    completed_steps: [],
    proposed_steps: [],
  };

  return {
    ...memory,
    goal_state: evaluateGoalCompletion(memory),
  };
}

export function detectDuplicateStep(memory: OrchestrationMemory, step: Pick<OrchestrationMemoryStep, "title">): DuplicateStepResult {
  const stepKey = buildStepKey(step);
  const matchedCompleted = memory.completed_steps.find((entry) => entry.step_key === stepKey);
  if (matchedCompleted) {
    return {
      is_duplicate: true,
      matched_kind: "completed",
      matched_step_id: matchedCompleted.step_id,
      explanation: `Step duplicates previously completed work: ${matchedCompleted.title}`,
    };
  }

  const matchedProposed = memory.proposed_steps.find((entry) => entry.step_key === stepKey);
  if (matchedProposed) {
    return {
      is_duplicate: true,
      matched_kind: "proposed",
      matched_step_id: matchedProposed.step_id,
      explanation: `Step duplicates a previously proposed continuation: ${matchedProposed.title}`,
    };
  }

  return {
    is_duplicate: false,
    matched_kind: null,
    matched_step_id: null,
    explanation: "Step is novel relative to orchestration memory.",
  };
}

export function updateOrchestrationMemory(memory: OrchestrationMemory, step: OrchestrationMemoryStep): OrchestrationMemory {
  const occurredAt = normalizeText(step.occurred_at) || new Date().toISOString();
  const cycleId = normalizeText(step.cycle_id) || null;
  const stepKey = buildStepKey(step);
  const duplicate = detectDuplicateStep(memory, step);

  const nextMemory: OrchestrationMemory = {
    ...memory,
    last_updated_at: occurredAt,
    cycle_ids: cycleId ? [...new Set([...memory.cycle_ids, cycleId])] : [...memory.cycle_ids],
    goal_state: {
      ...memory.goal_state,
      duplicate_step_count: memory.goal_state.duplicate_step_count + (duplicate.is_duplicate ? 1 : 0),
      consecutive_duplicate_cycles: duplicate.is_duplicate ? memory.goal_state.consecutive_duplicate_cycles + 1 : 0,
    },
    completed_steps: [...memory.completed_steps],
    proposed_steps: [...memory.proposed_steps],
  };

  if (!duplicate.is_duplicate) {
    if (step.kind === "completed") {
      nextMemory.completed_steps.push({
        step_key: stepKey,
        step_id: normalizeText(step.step_id) || null,
        title: normalizeText(step.title),
        rationale: normalizeText(step.rationale),
        completed_at: occurredAt,
        cycle_id: cycleId,
        marks_goal_complete: step.marks_goal_complete === true,
      });
    } else {
      nextMemory.proposed_steps.push({
        step_key: stepKey,
        step_id: normalizeText(step.step_id) || null,
        title: normalizeText(step.title),
        rationale: normalizeText(step.rationale),
        proposed_at: occurredAt,
        cycle_id: cycleId,
      });
    }
  }

  return {
    ...nextMemory,
    goal_state: evaluateGoalCompletion(nextMemory),
  };
}

export function summarizeGoalState(memory: OrchestrationMemory): string {
  const goalState = evaluateGoalCompletion(memory);
  return [
    `Goal: ${memory.goal}`,
    `Goal status: ${goalState.status}`,
    `Progress: ${goalState.progress_percent}%`,
    `Completed steps: ${memory.completed_steps.length}`,
    `Stored proposals: ${memory.proposed_steps.length}`,
    `Duplicate suppressions: ${goalState.duplicate_step_count}`,
    `Last completed step: ${goalState.last_completed_step_title ?? "none"}`,
  ].join("\n");
}