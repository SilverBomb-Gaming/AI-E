import {
  createContinuousRuntimeLoopClock,
  runContinuousRuntimeLoop,
  type ContinuousRuntimeLoopConfig,
} from "./continuousRuntimeLoop";
import type { BackgroundSessionQueue } from "./backgroundSessionQueue";
import type { RuntimeStateStore } from "./runtimeStateStore";

type ScheduledContinuousLoopConfig = Partial<Omit<ContinuousRuntimeLoopConfig, "runtime_id" | "started_at" | "runtime_intent" | "goal_id">>;

type ScheduledLoopJob = {
  timeout_id: ReturnType<typeof setTimeout>;
  remaining_ticks: number;
  queue: BackgroundSessionQueue | null;
};

declare global {
  var __aieOperatorRuntimeLiveLoopJobs: Map<string, ScheduledLoopJob> | undefined;
}

function getScheduledJobs(): Map<string, ScheduledLoopJob> {
  if (!globalThis.__aieOperatorRuntimeLiveLoopJobs) {
    globalThis.__aieOperatorRuntimeLiveLoopJobs = new Map<string, ScheduledLoopJob>();
  }

  return globalThis.__aieOperatorRuntimeLiveLoopJobs;
}

function clearScheduledJob(runtimeId: string) {
  const existingJob = getScheduledJobs().get(runtimeId);
  if (!existingJob) {
    return;
  }

  clearTimeout(existingJob.timeout_id);
  getScheduledJobs().delete(runtimeId);
}

function scheduleNextTick(
  runtimeStateStore: RuntimeStateStore,
  runtimeId: string,
  profileName: string,
  config: ScheduledContinuousLoopConfig,
  existingQueue: BackgroundSessionQueue | null,
  remainingTicks: number,
) {
  if (remainingTicks < 1) {
    clearScheduledJob(runtimeId);
    return;
  }

  const tickIntervalMs = Math.max(1, config.tick_interval_ms ?? 60_000);
  const timeoutId = setTimeout(() => {
    const startedAt = new Date().toISOString();
    const loopResult = runContinuousRuntimeLoop(
      runtimeStateStore,
      {
        runtime_id: runtimeId,
        profile_name: profileName,
        started_at: startedAt,
        runtime_intent: "no_op",
        existing_queue: existingQueue,
        ...config,
        max_ticks_per_run: 1,
      },
      createContinuousRuntimeLoopClock(startedAt, tickIntervalMs),
    );

    if (
      !loopResult.runtime_state
      || loopResult.status === "loop_blocked"
      || loopResult.status === "loop_completed"
      || loopResult.status === "loop_error"
      || loopResult.status === "loop_paused"
    ) {
      clearScheduledJob(runtimeId);
      return;
    }

    scheduleNextTick(runtimeStateStore, runtimeId, profileName, config, loopResult.last_queue, remainingTicks - 1);
  }, tickIntervalMs);

  getScheduledJobs().set(runtimeId, {
    timeout_id: timeoutId,
    remaining_ticks: remainingTicks,
    queue: existingQueue,
  });
}

export function scheduleOperatorRuntimeLiveLoop(
  runtimeStateStore: RuntimeStateStore,
  runtimeId: string,
  profileName: string,
  config: ScheduledContinuousLoopConfig = {},
  initialQueue: BackgroundSessionQueue | null = null,
) {
  clearScheduledJob(runtimeId);

  const totalTicks = Math.max(1, config.max_ticks_per_run ?? 1);
  if (totalTicks <= 1) {
    return;
  }

  scheduleNextTick(runtimeStateStore, runtimeId, profileName, config, initialQueue, totalTicks - 1);
}