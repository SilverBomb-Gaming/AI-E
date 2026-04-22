import { NextResponse } from "next/server";

import {
  type AutonomousOperatorSteeringAction,
  clearAutonomousSessionSteering,
  pauseAutonomousSession,
  updateAutonomousSessionSteering,
} from "@/lib/aie/autonomousSession";
import { loadAutonomousSession, saveAutonomousSession } from "@/lib/aie/autonomousSessionStore";

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
    const clearSteering = body.clear === true;
    const action = typeof body.action === "string" ? body.action as AutonomousOperatorSteeringAction : undefined;
    const operatorNote = typeof body.operatorNote === "string" ? body.operatorNote : undefined;
    const stopReason = typeof body.stopReason === "string" ? body.stopReason : undefined;
    const restartReason = typeof body.restartReason === "string" ? body.restartReason : undefined;

    if (!clearSteering && !action && !operatorNote && !stopReason && !restartReason) {
      return NextResponse.json({ error: "A bounded steering request is required." }, { status: 400 });
    }

    let nextSession = clearSteering
      ? clearAutonomousSessionSteering(session)
      : updateAutonomousSessionSteering(session, {
          action,
          operatorNote,
          stopReason,
          restartReason,
        });

    if (!clearSteering && (action === "pause-and-wait" || action === "stop-loop")) {
      nextSession = pauseAutonomousSession(
        nextSession,
        stopReason || operatorNote || (action === "stop-loop"
          ? "Operator stopped the bounded loop because it is no longer useful."
          : "Operator paused the bounded loop and requested more input."),
      );
    }

    await saveAutonomousSession(nextSession);
    return NextResponse.json({ session: nextSession });
  } catch (error) {
    console.error("[api/autonomous/steer] autonomous_steer failed", error);
    return NextResponse.json({ error: "We couldn't store that bounded steering request right now." }, { status: 500 });
  }
}