import { NextResponse } from "next/server";

import {
  GOVERNED_DISPATCH_APPROVAL_TOKEN,
  type ApprovalAuthorityToken,
  type GovernedExecutionApproval,
} from "@/lib/aie/sandboxedRuntimeDispatch";
import { executeGovernedWorkflow } from "@/lib/aie/governedWorkflowExecution";

export const runtime = "nodejs";

const SAFE_ERROR_MESSAGE = "Sandbox workflow request could not be processed.";

type SandboxWorkflowRequestBody = {
  workflowId?: string;
  proposalId: string;
  approvalToken: string;
  authorization: GovernedExecutionApproval;
  expiresAt: string;
  operatorId?: string;
  sandboxId?: string;
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

function normalizeBody(src: Record<string, unknown>): SandboxWorkflowRequestBody | null {
  const approval = normalizeApproval(src);
  if (!approval) return null;
  if (
    typeof src.proposalId !== "string" ||
    typeof src.approvalToken !== "string" ||
    typeof src.expiresAt !== "string"
  ) {
    return null;
  }
  return {
    workflowId: typeof src.workflowId === "string" ? src.workflowId.trim() || undefined : undefined,
    proposalId: (src.proposalId as string).trim(),
    approvalToken: (src.approvalToken as string).trim(),
    authorization: approval,
    expiresAt: (src.expiresAt as string).trim(),
    operatorId: typeof src.operatorId === "string" ? src.operatorId.trim() || undefined : undefined,
    sandboxId: typeof src.sandboxId === "string" ? src.sandboxId.trim() || undefined : undefined,
    timeoutMs: typeof src.timeoutMs === "number" ? Math.trunc(src.timeoutMs) : undefined,
  };
}

export async function POST(request: Request) {
  if (process.env.AIE_SANDBOX_WORKFLOW_ENABLED !== "true") {
    return NextResponse.json(
      {
        error: "Sandbox workflow is not enabled in this environment.",
        hint: "Set AIE_SANDBOX_WORKFLOW_ENABLED=true to enable governed multi-step sandbox workflow.",
        workflowEnabled: false,
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
          "Request body must include: proposalId, approvalToken, expiresAt, authorization (authorityToken, approvedBy, approvedAt, proposalId, operationRequest).",
      },
      { status: 400 },
    );
  }

  try {
    const result = await executeGovernedWorkflow({
      workflowId: normalized.workflowId,
      proposalId: normalized.proposalId,
      approvalToken: normalized.approvalToken,
      authorization: normalized.authorization,
      expiresAt: normalized.expiresAt,
      operatorId: normalized.operatorId,
      sandboxId: normalized.sandboxId,
      timeoutMs: normalized.timeoutMs,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isValidation = message.includes("rejected:");
    console.error("[api/operator/sandbox-workflow] error", { message });
    return NextResponse.json(
      { error: isValidation ? message : SAFE_ERROR_MESSAGE },
      { status: isValidation ? 400 : 500 },
    );
  }
}
