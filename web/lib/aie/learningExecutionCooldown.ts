export type LearningExecutionCooldownStatus = {
  last_execution_time?: string;
  cooldown_window_ms: number;
  blocked: boolean;
};

const DEFAULT_COOLDOWN_WINDOW_MS = 60_000;

let lastExecutionTime: string | undefined;

function normalizeTimestamp(value: string | undefined): string {
  if (typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value))) {
    return value.trim();
  }

  return new Date().toISOString();
}

export function getLearningExecutionCooldownStatus(options?: {
  attemptedAt?: string;
  cooldownWindowMs?: number;
}): LearningExecutionCooldownStatus {
  const attemptedAt = normalizeTimestamp(options?.attemptedAt);
  const cooldownWindowMs = options?.cooldownWindowMs ?? DEFAULT_COOLDOWN_WINDOW_MS;

  if (!lastExecutionTime) {
    return {
      last_execution_time: undefined,
      cooldown_window_ms: cooldownWindowMs,
      blocked: false,
    };
  }

  const blocked = Date.parse(attemptedAt) - Date.parse(lastExecutionTime) < cooldownWindowMs;

  return {
    last_execution_time: lastExecutionTime,
    cooldown_window_ms: cooldownWindowMs,
    blocked,
  };
}

export function recordLearningExecutionTime(executedAt?: string): LearningExecutionCooldownStatus {
  lastExecutionTime = normalizeTimestamp(executedAt);
  return getLearningExecutionCooldownStatus({ attemptedAt: lastExecutionTime });
}

export function resetLearningExecutionCooldown(): LearningExecutionCooldownStatus {
  lastExecutionTime = undefined;
  return getLearningExecutionCooldownStatus();
}