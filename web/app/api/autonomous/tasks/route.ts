import { NextResponse } from "next/server";

import { listTasks } from "@/lib/aie/taskQueueStore";

export const runtime = "nodejs";

export async function GET() {
  try {
    const tasks = await listTasks();
    const summary = {
      total: tasks.length,
      pending: tasks.filter((task) => task.status === "pending").length,
      assigned: tasks.filter((task) => task.status === "assigned").length,
      running: tasks.filter((task) => task.status === "running").length,
      completed: tasks.filter((task) => task.status === "completed").length,
      failed: tasks.filter((task) => task.status === "failed").length,
      blocked: tasks.filter((task) => task.status === "blocked").length,
      runnableSafe: tasks.filter((task) => task.status === "pending" && task.action.scope === "safe").length,
      dispatchPlanned: tasks.filter((task) => task.remoteDispatchPlanned).length,
      withDispatchMetadata: tasks.filter((task) => task.dispatchMessageId || task.dispatchStatusSummary).length,
      acceptedDispatches: tasks.filter((task) => task.dispatchTransportStatus === "accepted").length,
      deliveredDispatches: tasks.filter((task) => task.dispatchTransportStatus === "delivered" || task.dispatchTransportStatus === "completed").length,
      rejectedDispatches: tasks.filter((task) => task.dispatchTransportStatus === "rejected").length,
      failedDispatches: tasks.filter((task) => task.dispatchTransportStatus === "failed").length,
    };
    return NextResponse.json({ tasks, summary });
  } catch (error) {
    console.error("[api/autonomous/tasks] list failed", error);
    return NextResponse.json({ error: "We couldn't load queued autonomous tasks right now." }, { status: 500 });
  }
}