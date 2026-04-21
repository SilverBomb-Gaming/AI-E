import { NextResponse } from "next/server";

import { getTask } from "@/lib/aie/taskQueueStore";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const task = await getTask(params.id);
  if (!task) {
    return NextResponse.json({ error: "Autonomous task not found." }, { status: 404 });
  }

  return NextResponse.json({ task });
}