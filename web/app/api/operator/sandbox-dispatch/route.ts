import { NextResponse } from "next/server";

import {
  executeGovernedSandboxDispatch,
  GOVERNED_DISPATCH_APPROVAL_TOKEN,
  type GovernedDispatchRequest,
} from "@/lib/aie/sandboxedRuntimeDispatch";

export const runtime = "nodejs";

const SAFE_ERROR_MESSAGE = "Sandbox dispatch request could not be processed.";

type DispatchBody = {
  approvalToken: string;
  operationRequest: string;
  operationContent: string;
  targetFileName: string;
  sandboxId?: string;
  timeoutMs?: number;
};

function normalizeBody(value: unknown): DispatchBody | null {
  if (!value || typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  if (
    typeof src.approvalToken !== "string" ||
    typeof src.operationRequest !== "string" ||
    typeof src.operationContent !== "string" ||
    typeof src.targetFileName !== "string"
  ) {
    return null;
  }
  return {
    approvalToken: src.approvalToken.trim(),
    operationRequest: src.operationRequest.trim(),
    operationContent: src.operationContent,
    targetFileName: src.targetFileName.trim(),
    sandboxId: typeof src.sandboxId === "string" ? src.sandboxId.trim() || undefined : undefined,
    timeoutMs: typeof src.timeoutMs === "number" ? Math.trunc(src.timeoutMs) : undefined,
  };
}

export async function POST(request: Request) {
  // Environment gate: sandbox dispatch must be explicitly enabled
  if (process.env.AIE_SANDBOX_DISPATCH_ENABLED !== "true") {
    return NextResponse.json(
      {
        error: "Sandbox dispatch is not enabled in this environment.",
        hint: "Set AIE_SANDBOX_DISPATCH_ENABLED=true to enable real governed sandbox execution.",
        dispatchEnabled: false,
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const normalized = normalizeBody(body);
  if (!normalized) {
    return NextResponse.json(
      { error: "Request body must include: approvalToken, operationRequest, operationContent, targetFileName." },
      { status: 400 },
    );
  }

  // Additional server-side guard: approval token must match before we even call the dispatch engine
  if (normalized.approvalToken !== GOVERNED_DISPATCH_APPROVAL_TOKEN) {
    return NextResponse.json(
      { error: `Dispatch rejected: approvalToken must be "${GOVERNED_DISPATCH_APPROVAL_TOKEN}".` },
      { status: 403 },
    );
  }

  const dispatchRequest: GovernedDispatchRequest = {
    approvalToken: normalized.approvalToken,
    operationRequest: normalized.operationRequest,
    operationContent: normalized.operationContent,
    targetFileName: normalized.targetFileName,
    sandboxId: normalized.sandboxId,
    timeoutMs: normalized.timeoutMs,
  };

  try {
    const result = await executeGovernedSandboxDispatch(dispatchRequest);
    return NextResponse.json(result);
  } catch (error) {
    // Validation errors (bad token, unsafe filename) are 400
    const message = error instanceof Error ? error.message : String(error);
    const isValidation = message.includes("rejected:");
    console.error("[api/operator/sandbox-dispatch] dispatch error", { message });
    return NextResponse.json(
      { error: isValidation ? message : SAFE_ERROR_MESSAGE },
      { status: isValidation ? 400 : 500 },
    );
  }
}
