import { NextResponse } from "next/server";

import { runSingleQueuedTask } from "@/lib/aie/queueOrchestrator";
import { getTask } from "@/lib/aie/taskQueueStore";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const existingTask = await getTask(params.id);
  if (!existingTask) {
    return NextResponse.json({ error: "Autonomous task not found." }, { status: 404 });
  }

  try {
    const payload = await request.json().catch(() => ({})) as { maxSteps?: number };
    const summary = await runSingleQueuedTask({
      taskId: params.id,
      runtimeMode: "web",
      cwd: process.cwd(),
      maxSteps: payload.maxSteps,
    });

    if (summary.status === "no-runnable-task") {
      return NextResponse.json({ error: "The requested task is not runnable in the current local queue model." }, { status: 409 });
    }

    return NextResponse.json({ summary });
  } catch (error) {
    console.error(`[api/autonomous/tasks/${params.id}/run] run failed`, error);
    return NextResponse.json({ error: "We couldn't execute the requested queued task right now." }, { status: 500 });
  }
}