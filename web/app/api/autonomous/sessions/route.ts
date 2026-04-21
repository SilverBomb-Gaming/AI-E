import { NextResponse } from "next/server";

import { listAutonomousSessions } from "@/lib/aie/autonomousSessionStore";

export const runtime = "nodejs";

export async function GET() {
  try {
    const sessions = await listAutonomousSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("[api/autonomous/sessions] autonomous_sessions failed", error);
    return NextResponse.json({ error: "We couldn't load bounded autonomous sessions right now." }, { status: 500 });
  }
}