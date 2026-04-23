import { NextResponse } from "next/server";

import { loadAutonomousSession } from "@/lib/aie/autonomousSessionStore";
import { runAutonomousSession } from "@/lib/aie/runAutonomousSession";

export const runtime = "nodejs";

function normalizeGoal(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampMaxSteps(value: unknown): number {
  if (value === undefined || value === null || String(value).trim() === "") {
    return 3;
  }

  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return 3;
  }

  return Math.max(1, Math.min(5, Math.floor(numericValue)));
}

function clampMaxTasksPerSession(value: unknown): number | undefined {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }

  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return Math.max(1, Math.min(10, Math.floor(numericValue)));
}

function clampMaxFailuresPerSession(value: unknown): number | undefined {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }

  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return Math.max(1, Math.min(3, Math.floor(numericValue)));
}

function clampMaxRuntimeMs(value: unknown): number | undefined {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }

  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return undefined;
  }

  return Math.max(1_000, Math.min(8 * 60 * 60 * 1_000, Math.floor(numericValue)));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const goal = normalizeGoal(body.goal);
    const maxSteps = clampMaxSteps(body.maxSteps);
    const maxTasksPerSession = clampMaxTasksPerSession(body.maxTasksPerSession);
    const maxFailuresPerSession = clampMaxFailuresPerSession(body.maxFailuresPerSession);
    const maxRuntimeMs = clampMaxRuntimeMs(body.maxRuntimeMs);
    const existingSessionId = normalizeGoal(body.sessionId);
    const approved = body.approved === true;

    if (!goal) {
      return NextResponse.json({ error: "A top-level goal is required." }, { status: 400 });
    }

    const existingSession = existingSessionId ? await loadAutonomousSession(existingSessionId) : null;
    if (existingSessionId && !existingSession) {
      return NextResponse.json({ error: "The requested autonomous session was not found." }, { status: 404 });
    }

    const session = await runAutonomousSession({
      goal,
      maxSteps,
      maxTasksPerSession,
      maxFailuresPerSession,
      maxRuntimeMs,
      approved,
      existingSession: existingSession ?? undefined,
      executionContext: {
        runtimeMode: "web",
        cwd: process.cwd(),
      },
    });

    return NextResponse.json({ session });
  } catch (error) {
    console.error("[api/autonomous/run] autonomous_run failed", error);
    return NextResponse.json({ error: "We couldn't run that bounded autonomous session right now." }, { status: 500 });
  }
}