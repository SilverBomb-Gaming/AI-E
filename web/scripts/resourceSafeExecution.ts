import os from "node:os";

type ResourceGuardOptions = {
  label: string;
  enabled?: boolean;
  intervalMs?: number;
  memoryAbortPercent?: number;
};

export type ResourceGuardStopResult = {
  cpu_percent_range: {
    min: number;
    max: number;
  } | null;
  memory_percent_range: {
    min: number;
    max: number;
  } | null;
};

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function isEnabled(explicit: boolean | undefined): boolean {
  if (typeof explicit === "boolean") {
    return explicit;
  }

  return process.env.AIE_RESOURCE_SAFE_MODE === "1"
    || process.env.AIE_RESOURCE_SAFE_MODE === "true"
    || process.env.npm_lifecycle_event?.endsWith(":safe") === true;
}

export function startResourceGuard(options: ResourceGuardOptions): () => ResourceGuardStopResult {
  if (!isEnabled(options.enabled)) {
    return () => ({
      cpu_percent_range: null,
      memory_percent_range: null,
    });
  }

  const intervalMs = options.intervalMs ?? 2_000;
  const memoryAbortPercent = options.memoryAbortPercent ?? 85;
  const totalMemoryBytes = os.totalmem();
  const logicalCores = Math.max(1, os.availableParallelism?.() ?? os.cpus().length ?? 1);
  let previousCpuUsage = process.cpuUsage();
  let previousHrTime = process.hrtime.bigint();
  const cpuSamples: number[] = [];
  const memorySamples: number[] = [];

  const timer = setInterval(() => {
    const currentCpuUsage = process.cpuUsage();
    const currentHrTime = process.hrtime.bigint();
    const elapsedMicros = Number(currentHrTime - previousHrTime) / 1_000;
    const cpuMicros = (currentCpuUsage.user - previousCpuUsage.user) + (currentCpuUsage.system - previousCpuUsage.system);
    const cpuPercent = elapsedMicros > 0
      ? Math.max(0, Math.min(100, (cpuMicros / elapsedMicros / logicalCores) * 100))
      : 0;
    const memoryPercent = totalMemoryBytes > 0
      ? ((totalMemoryBytes - os.freemem()) / totalMemoryBytes) * 100
      : 0;

    cpuSamples.push(cpuPercent);
    memorySamples.push(memoryPercent);

    process.stderr.write(
      `[resource:${options.label}] cpu=${round(cpuPercent)}% system-memory=${round(memoryPercent)}% rss=${round(process.memoryUsage().rss / 1024 / 1024)}MB\n`,
    );

    previousCpuUsage = currentCpuUsage;
    previousHrTime = currentHrTime;

    if (memoryPercent >= memoryAbortPercent) {
      process.stderr.write(
        `[resource:${options.label}] aborting because system memory usage reached ${round(memoryPercent)}% (threshold ${memoryAbortPercent}%).\n`,
      );
      process.exitCode = 1;
      throw new Error(`Resource guard aborted ${options.label} because system memory usage exceeded ${memoryAbortPercent}%.`);
    }
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return () => {
    clearInterval(timer);

    return {
      cpu_percent_range: cpuSamples.length > 0
        ? {
          min: round(Math.min(...cpuSamples)),
          max: round(Math.max(...cpuSamples)),
        }
        : null,
      memory_percent_range: memorySamples.length > 0
        ? {
          min: round(Math.min(...memorySamples)),
          max: round(Math.max(...memorySamples)),
        }
        : null,
    };
  };
}