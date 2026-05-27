import { NextResponse } from "next/server";

import {
  GOVERNED_DISPATCH_APPROVAL_TOKEN,
  type GovernedExecutionApproval,
  type ApprovalAuthorityToken,
} from "@/lib/aie/sandboxedRuntimeDispatch";
import { executeSandboxGameplayFeaturePatchDispatch } from "@/lib/aie/sandboxGameplayFeaturePatchDispatch";

export const runtime = "nodejs";

const SAFE_ERROR_MESSAGE = "Sandbox gameplay feature patch request could not be processed.";

type SandboxGameplayFeaturePatchRequestBody = {
  approvalToken: string;
  operationRequest: string;
  authorization: GovernedExecutionApproval;
  expiresAt: string;
  sandboxId?: string;
  operatorId?: string;
  timeoutMs?: number;
};

function normalizeApproval(src: Record<string, unknown>): GovernedExecutionApproval | null {
  const a = src.authorization;
  if (!a || typeof a !== "object") return null;
  const auth = a as Record<string, unknown>;
  if (
    typeof auth.authorityToken !== "string" ||
    typeof auth.approvedBy !== "string" ||
    typeof auth.approvedAt !== "string" ||
    typeof auth.proposalId !== "string" ||
    typeof auth.operationRequest !== "string"
  ) {
    return null;
  }
  return {
    authorityToken: auth.authorityToken as ApprovalAuthorityToken,
    approvedBy: auth.approvedBy.trim(),
    approvedAt: auth.approvedAt.trim(),
    proposalId: auth.proposalId.trim(),
    operationRequest: auth.operationRequest.trim(),
  };
}

function normalizeBody(src: Record<string, unknown>): SandboxGameplayFeaturePatchRequestBody | null {
  const approval = normalizeApproval(src);
  if (!approval) return null;
  if (
    typeof src.approvalToken !== "string" ||
    typeof src.operationRequest !== "string" ||
    typeof src.expiresAt !== "string"
  ) {
    return null;
  }
  return {
    approvalToken: src.approvalToken.trim(),
    operationRequest: src.operationRequest.trim(),
    authorization: approval,
    expiresAt: src.expiresAt.trim(),
    sandboxId: typeof src.sandboxId === "string" ? src.sandboxId.trim() || undefined : undefined,
    operatorId: typeof src.operatorId === "string" ? src.operatorId.trim() || undefined : undefined,
    timeoutMs: typeof src.timeoutMs === "number" ? Math.trunc(src.timeoutMs) : undefined,
  };
}

export async function POST(request: Request) {
  if (process.env.AIE_SANDBOX_GAMEPLAY_FEATURE_PATCH_ENABLED !== "true") {
    return NextResponse.json(
      {
        error: "Sandbox gameplay feature patch is not enabled in this environment.",
        hint: "Set AIE_SANDBOX_GAMEPLAY_FEATURE_PATCH_ENABLED=true to enable governed sandbox gameplay feature patch mutation.",
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
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const src = body as Record<string, unknown>;

  if (typeof src.approvalToken !== "string" || src.approvalToken.trim() !== GOVERNED_DISPATCH_APPROVAL_TOKEN) {
    return NextResponse.json(
      { error: `Dispatch rejected: approvalToken must be "${GOVERNED_DISPATCH_APPROVAL_TOKEN}".` },
      { status: 403 },
    );
  }

  const normalized = normalizeBody(src);
  if (!normalized) {
    return NextResponse.json(
      {
        error:
          "Request body must include: approvalToken, operationRequest, authorization (authorityToken, approvedBy, approvedAt, proposalId, operationRequest), expiresAt.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await executeSandboxGameplayFeaturePatchDispatch({
      approvalToken: normalized.approvalToken,
      operationRequest: normalized.operationRequest,
      authorization: normalized.authorization,
      expiresAt: normalized.expiresAt,
      sandboxId: normalized.sandboxId,
      operatorId: normalized.operatorId,
      timeoutMs: normalized.timeoutMs,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isValidation = message.includes("rejected:");
    console.error("[api/operator/sandbox-gameplay-feature-patch] error", { message });
    return NextResponse.json(
      { error: isValidation ? message : SAFE_ERROR_MESSAGE },
      { status: isValidation ? 400 : 500 },
    );
  }
}
