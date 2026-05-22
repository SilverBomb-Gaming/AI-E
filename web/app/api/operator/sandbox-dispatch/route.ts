import { NextResponse } from "next/server";

import {
  executeGovernedProofDispatch,
  executeGovernedSandboxDispatch,
  GOVERNED_DISPATCH_APPROVAL_TOKEN,
  type ApprovalAuthorityToken,
  type GovernedDispatchRequest,
  type GovernedExecutionApproval,
  type GovernedProofDispatchRequest,
} from "@/lib/aie/sandboxedRuntimeDispatch";

export const runtime = "nodejs";

const SAFE_ERROR_MESSAGE = "Sandbox dispatch request could not be processed.";

// ---- Simple dispatch body (backward-compat) ----------------------------------------

type SimpleDispatchBody = {
  approvalToken: string;
  operationRequest: string;
  operationContent: string;
  targetFileName: string;
  sandboxId?: string;
  timeoutMs?: number;
};

function normalizeSimpleBody(src: Record<string, unknown>): SimpleDispatchBody | null {
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

// ---- Proof dispatch body (EXEC-0051-C) ---------------------------------------------

type ProofDispatchBody = {
  approvalToken: string;
  operationRequest: string;
  authorization: GovernedExecutionApproval;
  expiresAt: string;
  sandboxId?: string;
  operatorId?: string;
  runtimeId?: string;
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

function normalizeProofBody(src: Record<string, unknown>): ProofDispatchBody | null {
  const approval = normalizeApproval(src);
  if (!approval) return null;
  if (typeof src.approvalToken !== "string" || typeof src.operationRequest !== "string" || typeof src.expiresAt !== "string") {
    return null;
  }
  return {
    approvalToken: src.approvalToken.trim(),
    operationRequest: src.operationRequest.trim(),
    authorization: approval,
    expiresAt: src.expiresAt.trim(),
    sandboxId: typeof src.sandboxId === "string" ? src.sandboxId.trim() || undefined : undefined,
    operatorId: typeof src.operatorId === "string" ? src.operatorId.trim() || undefined : undefined,
    runtimeId: typeof src.runtimeId === "string" ? src.runtimeId.trim() || undefined : undefined,
    timeoutMs: typeof src.timeoutMs === "number" ? Math.trunc(src.timeoutMs) : undefined,
  };
}

// ---- Route handler -----------------------------------------------------------------

export async function POST(request: Request) {
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

  // Proof dispatch path: body includes authorization object
  if (src.authorization) {
    const proofBody = normalizeProofBody(src);
    if (!proofBody) {
      return NextResponse.json(
        { error: "Proof dispatch body must include: approvalToken, operationRequest, authorization (authorityToken, approvedBy, approvedAt, proposalId, operationRequest), expiresAt." },
        { status: 400 },
      );
    }
    const proofRequest: GovernedProofDispatchRequest = {
      approvalToken: proofBody.approvalToken,
      operationRequest: proofBody.operationRequest,
      authorization: proofBody.authorization,
      expiresAt: proofBody.expiresAt,
      sandboxId: proofBody.sandboxId,
      operatorId: proofBody.operatorId,
      runtimeId: proofBody.runtimeId,
      timeoutMs: proofBody.timeoutMs,
    };
    try {
      const result = await executeGovernedProofDispatch(proofRequest);
      return NextResponse.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isValidation = message.includes("rejected:");
      console.error("[api/operator/sandbox-dispatch] proof dispatch error", { message });
      return NextResponse.json(
        { error: isValidation ? message : SAFE_ERROR_MESSAGE },
        { status: isValidation ? 400 : 500 },
      );
    }
  }

  // Simple dispatch path (backward-compat)
  const simpleBody = normalizeSimpleBody(src);
  if (!simpleBody) {
    return NextResponse.json(
      { error: "Request body must include: approvalToken, operationRequest, operationContent, targetFileName." },
      { status: 400 },
    );
  }
  const dispatchRequest: GovernedDispatchRequest = {
    approvalToken: simpleBody.approvalToken,
    operationRequest: simpleBody.operationRequest,
    operationContent: simpleBody.operationContent,
    targetFileName: simpleBody.targetFileName,
    sandboxId: simpleBody.sandboxId,
    timeoutMs: simpleBody.timeoutMs,
  };
  try {
    const result = await executeGovernedSandboxDispatch(dispatchRequest);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isValidation = message.includes("rejected:");
    console.error("[api/operator/sandbox-dispatch] dispatch error", { message });
    return NextResponse.json(
      { error: isValidation ? message : SAFE_ERROR_MESSAGE },
      { status: isValidation ? 400 : 500 },
    );
  }
}
