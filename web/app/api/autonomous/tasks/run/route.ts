import { NextResponse } from "next/server";

import { runSingleQueuedTask } from "@/lib/aie/queueOrchestrator";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({})) as { maxSteps?: number };
    const summary = await runSingleQueuedTask({
      runtimeMode: "web",
      cwd: process.cwd(),
      maxSteps: payload.maxSteps,
    });

    if (summary.status === "no-runnable-task") {
      return NextResponse.json({ error: "No runnable safe queued task is available." }, { status: 409 });
    }

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("[api/autonomous/tasks/run] run-next failed", error);
    return NextResponse.json({ error: "We couldn't execute the next queued task right now." }, { status: 500 });
  }
}