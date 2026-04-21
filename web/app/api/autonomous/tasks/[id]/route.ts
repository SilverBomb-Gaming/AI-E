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
    runnable: (task.status === "pending" || task.status === "queued" || task.status === "retrying") && task.action.scope === "safe",
    selectedNodeId: task.selectedNodeId ?? task.assignedNodeId ?? null,
    retryCount: task.dispatchRetryCount ?? 0,
    failureReason: task.failureReason ?? null,
    dispatch: {
      messageId: task.dispatchMessageId ?? null,
      ackMessageId: task.dispatchAckMessageId ?? null,
      resultMessageId: task.dispatchResultMessageId ?? null,
      targetNodeId: task.dispatchTargetNodeId ?? null,
      protocolVersion: task.dispatchProtocolVersion ?? null,
      authSummary: task.dispatchAuthSummary ?? null,
      transportStatus: task.dispatchTransportStatus ?? null,
      statusSummary: task.dispatchStatusSummary ?? null,
      lastAttemptAt: task.dispatchLastAttemptAt ?? null,
      timeoutMs: task.dispatchTimeoutMs ?? null,
      receivedAt: task.dispatchReceivedAt ?? null,
      completedAt: task.dispatchCompletedAt ?? null,
      planned: task.remoteDispatchPlanned ?? null,
    },
  });
}