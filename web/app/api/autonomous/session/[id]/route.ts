import { NextResponse } from "next/server";

import { loadAutonomousSession } from "@/lib/aie/autonomousSessionStore";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await loadAutonomousSession(params.id);
  if (!session) {
    return NextResponse.json({ error: "Autonomous session not found." }, { status: 404 });
  }

  return NextResponse.json({ session });
}