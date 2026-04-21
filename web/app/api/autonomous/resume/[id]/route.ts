import { NextResponse } from "next/server";

import { loadAutonomousSession } from "@/lib/aie/autonomousSessionStore";
import { runAutonomousSession } from "@/lib/aie/runAutonomousSession";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const session = await loadAutonomousSession(params.id);
    if (!session) {
      return NextResponse.json({ error: "Autonomous session not found." }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const approved = body.approved === true;

    const nextSession = await runAutonomousSession({
      goal: session.goal,
      maxSteps: session.maxSteps,
      approved,
      existingSession: session,
      executionContext: {
        runtimeMode: "web",
        cwd: process.cwd(),
      },
    });

    return NextResponse.json({ session: nextSession });
  } catch (error) {
    console.error("[api/autonomous/resume] autonomous_resume failed", error);
    return NextResponse.json({ error: "We couldn't resume that bounded autonomous session right now." }, { status: 500 });
  }
}