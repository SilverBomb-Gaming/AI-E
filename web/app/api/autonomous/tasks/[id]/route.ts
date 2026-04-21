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

  return NextResponse.json({
    task,
    runnable: task.status === "pending" && task.action.scope === "safe",
    dispatch: {
      messageId: task.dispatchMessageId ?? null,
      targetNodeId: task.dispatchTargetNodeId ?? null,
      protocolVersion: task.dispatchProtocolVersion ?? null,
      statusSummary: task.dispatchStatusSummary ?? null,
      planned: task.remoteDispatchPlanned ?? null,
    },
  });
}