import { NextResponse } from "next/server";

import { listTasks } from "@/lib/aie/taskQueueStore";

export const runtime = "nodejs";

export async function GET() {
  try {
    const tasks = await listTasks();
    return NextResponse.json({ tasks });
  } catch (error) {
    console.error("[api/autonomous/tasks] list failed", error);
    return NextResponse.json({ error: "We couldn't load queued autonomous tasks right now." }, { status: 500 });
  }
}