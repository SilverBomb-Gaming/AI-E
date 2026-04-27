import { NextResponse } from "next/server";

import { executeAction, getExecutableActionType, isExecutableAction } from "@/lib/aie/executionRuntime";
import type { ExecutionActionPreview } from "@/lib/aie/types";

export const runtime = "nodejs";

const SAFE_ERROR_MESSAGE = "We couldn't execute that bounded step right now. Please try again.";

function normalizeExecutionAction(value: unknown): ExecutionActionPreview | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const metadata = source.metadata;

  if (
    typeof source.id !== "string" ||
    typeof source.description !== "string" ||
    typeof source.expectedOutcome !== "string" ||
    source.requiresApproval !== true ||
    (source.type !== "read" &&
      source.type !== "write" &&
      source.type !== "inspect" &&
      source.type !== "run" &&
      source.type !== "inspection" &&
      source.type !== "validation-check" &&
      source.type !== "file-write" &&
      source.type !== "test-run" &&
      source.type !== "unknown") ||
    (source.scope !== "safe" && source.scope !== "caution" && source.scope !== "dangerous") ||
    (metadata !== undefined && (typeof metadata !== "object" || Array.isArray(metadata)))
  ) {
    return null;
  }

  return {
    id: source.id.trim(),
    type: source.type,
    scope: source.scope,
    description: source.description.trim(),
    expectedOutcome: source.expectedOutcome.trim(),
    requiresApproval: true,
    suggestedCommand:
      typeof source.suggestedCommand === "string" ? source.suggestedCommand.trim() || undefined : undefined,
    metadata: (metadata as Record<string, unknown> | undefined) ?? {},
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

  return {
    message: String(error),
  };
}

export async function POST(request: Request) {
  let approved = false;
  let action: ExecutionActionPreview | null = null;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    approved = body.approved === true;
    action = normalizeExecutionAction(body.action);
  } catch (error) {
    console.error("[api/execute] request_json failed", serializeError(error));
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }

  if (!approved) {
    return NextResponse.json(
      { error: "Explicit approval is required before AI-E can run this step." },
      { status: 400 },
    );
  }

  if (!action) {
    return NextResponse.json({ error: "The execution request is missing a valid action." }, { status: 400 });
  }

  if (!isExecutableAction(action) || !getExecutableActionType(action)) {
    return NextResponse.json({ error: "Unknown or unsupported action type." }, { status: 400 });
  }

  try {
    const result = await executeAction(action, {
      cwd: process.cwd(),
      allowedRoots: action.metadata.allowedRoot ? [action.metadata.allowedRoot] : undefined,
      runtimeMode: "web",
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/execute] execute_action failed", {
      actionId: action.id,
      actionType: getExecutableActionType(action),
      error: serializeError(error),
    });
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }
}