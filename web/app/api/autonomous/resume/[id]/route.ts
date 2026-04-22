import { NextResponse } from "next/server";

import type { AutonomousOperatorSteeringAction } from "@/lib/aie/autonomousSession";
import { loadAutonomousSession } from "@/lib/aie/autonomousSessionStore";
import { clearAutonomousSessionSteering, updateAutonomousSessionSteering } from "@/lib/aie/autonomousSession";
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
    const steeringBody = body.steering && typeof body.steering === "object"
      ? body.steering as Record<string, unknown>
      : undefined;
    const clearSteering = body.clearSteering === true || steeringBody?.clear === true;
    const steering = steeringBody
      ? {
          action: typeof steeringBody.action === "string" ? steeringBody.action as AutonomousOperatorSteeringAction : undefined,
          operatorNote: typeof steeringBody.operatorNote === "string" ? steeringBody.operatorNote : undefined,
          stopReason: typeof steeringBody.stopReason === "string" ? steeringBody.stopReason : undefined,
          restartReason: typeof steeringBody.restartReason === "string" ? steeringBody.restartReason : undefined,
        }
      : undefined;
    const nextSessionInput = clearSteering
      ? clearAutonomousSessionSteering(session)
      : steering
        ? updateAutonomousSessionSteering(session, steering)
        : session;

    const nextSession = await runAutonomousSession({
      goal: nextSessionInput.goal,
      maxSteps: nextSessionInput.maxSteps,
      approved,
      existingSession: nextSessionInput,
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