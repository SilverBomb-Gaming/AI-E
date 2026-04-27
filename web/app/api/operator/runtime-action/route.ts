import { NextResponse } from "next/server";

import { scheduleOperatorRuntimeLiveLoop } from "@/lib/aie/operatorRuntimeLiveLoopScheduler";
import type { OperatorControlAction } from "@/lib/aie/operatorControlSurface";
import { applyOperatorActionToProviderState } from "@/lib/aie/operatorRuntimeActionHandler";
import { getOperatorRuntimeId, getOperatorRuntimeStateStore } from "@/lib/aie/operatorRuntimeServerStore";
import { loadOperatorDashboardState } from "@/lib/aie/operatorRuntimeStateProvider";
import { loadRuntimeState } from "@/lib/aie/runtimeStateStore";

export const runtime = "nodejs";

const SAFE_ERROR_MESSAGE = "We couldn't apply that operator runtime action right now. Please try again.";

function normalizeAction(value: unknown): OperatorControlAction | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.type !== "approve_goal"
    && candidate.type !== "pause_goal"
    && candidate.type !== "resume_goal"
    && candidate.type !== "retry_goal"
  ) {
    return null;
  }

  return {
    type: candidate.type,
    goal_id: typeof candidate.goal_id === "string"
      ? candidate.goal_id.trim() || null
      : candidate.goal_id === null || candidate.goal_id === undefined
        ? null
        : null,
  };
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

export async function POST(request: Request) {
  let action: OperatorControlAction | null = null;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    action = normalizeAction(body.action);
  } catch (error) {
    console.error("[api/operator/runtime-action] request_json failed", serializeError(error));
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }

  if (!action) {
    return NextResponse.json({ error: "A supported operator action is required." }, { status: 400 });
  }

  const runtimeStateStore = getOperatorRuntimeStateStore();
  const runtimeId = getOperatorRuntimeId();
  const now = new Date().toISOString();
  const providerResult = await loadOperatorDashboardState({
    runtime_state_store: runtimeStateStore,
    runtime_id: runtimeId,
    now,
  });

  try {
    const persistedRuntimeState = runtimeStateStore && runtimeId
      ? loadRuntimeState(runtimeStateStore, runtimeId)
      : null;
    const actionResult = applyOperatorActionToProviderState(providerResult, action, {
      runtime_state_store: runtimeStateStore,
      runtime_id: runtimeId,
      now,
      start_continuous_loop: true,
      continuous_loop_config: {
        ...(persistedRuntimeState?.continuous_loop_config ?? {}),
        max_ticks_per_run: 1,
      },
    });

    if (runtimeStateStore && runtimeId && actionResult.result === "accepted") {
      const updatedRuntimeState = loadRuntimeState(runtimeStateStore, runtimeId);
      if (updatedRuntimeState) {
        scheduleOperatorRuntimeLiveLoop(
          runtimeStateStore,
          runtimeId,
          updatedRuntimeState.profile_name,
          updatedRuntimeState.continuous_loop_config ?? {},
          actionResult.continuous_loop_queue ?? null,
        );
      }
    }

    const refreshedProviderResult = await loadOperatorDashboardState({
      runtime_state_store: runtimeStateStore,
      runtime_id: runtimeId,
      now,
    });

    return NextResponse.json({
      actionResult,
      providerResult: refreshedProviderResult,
    });
  } catch (error) {
    console.error("[api/operator/runtime-action] mutation failed", {
      action,
      error: serializeError(error),
    });
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }
}