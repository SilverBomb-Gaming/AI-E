import { NextResponse } from "next/server";

import { listTasks } from "@/lib/aie/taskQueueStore";

export const runtime = "nodejs";

export async function GET() {
  try {
    const tasks = await listTasks();
    const taskSummaries = tasks.map((task) => ({
      taskId: task.taskId,
      status: task.status,
      selectedNodeId: task.selectedNodeId ?? task.assignedNodeId ?? null,
      retryCount: task.dispatchRetryCount ?? 0,
      failureReason: task.failureReason ?? null,
      dispatch: {
        messageId: task.dispatchMessageId ?? null,
        ackMessageId: task.dispatchAckMessageId ?? null,
        resultMessageId: task.dispatchResultMessageId ?? null,
        targetNodeId: task.dispatchTargetNodeId ?? null,
        protocolVersion: task.dispatchProtocolVersion ?? null,
        transportStatus: task.dispatchTransportStatus ?? null,
        statusSummary: task.dispatchStatusSummary ?? null,
        authSummary: task.dispatchAuthSummary ?? null,
        lastAttemptAt: task.dispatchLastAttemptAt ?? null,
        timeoutMs: task.dispatchTimeoutMs ?? null,
      },
    }));
    const summary = {
      total: tasks.length,
      pending: tasks.filter((task) => task.status === "pending" || task.status === "queued").length,
      dispatching: tasks.filter((task) => task.status === "dispatching" || task.status === "awaiting-ack").length,
      executing: tasks.filter((task) => task.status === "executing" || task.status === "running").length,
      retrying: tasks.filter((task) => task.status === "retrying").length,
      completed: tasks.filter((task) => task.status === "completed").length,
      failed: tasks.filter((task) => task.status === "failed").length,
      rejected: tasks.filter((task) => task.status === "rejected" || task.status === "blocked").length,
      runnableSafe: tasks.filter((task) => (task.status === "pending" || task.status === "queued" || task.status === "retrying") && task.action.scope === "safe").length,
      dispatchPlanned: tasks.filter((task) => task.remoteDispatchPlanned).length,
      withDispatchMetadata: tasks.filter((task) => task.dispatchMessageId || task.dispatchStatusSummary).length,
      acceptedDispatches: tasks.filter((task) => task.dispatchTransportStatus === "accepted").length,
      deliveredDispatches: tasks.filter((task) => task.dispatchTransportStatus === "delivered" || task.dispatchTransportStatus === "completed").length,
      rejectedDispatches: tasks.filter((task) => task.dispatchTransportStatus === "rejected").length,
      failedDispatches: tasks.filter((task) => task.dispatchTransportStatus === "failed").length,
    };
    return NextResponse.json({ tasks: taskSummaries, summary });
  } catch (error) {
    console.error("[api/autonomous/tasks] list failed", error);
    return NextResponse.json({ error: "We couldn't load queued autonomous tasks right now." }, { status: 500 });
  }
}