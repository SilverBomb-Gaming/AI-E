import path from "node:path";
import { NextResponse } from "next/server";

import { runApprovedExecutionPipeline, type ApprovedExecutionApproval } from "@/lib/aie/approvedExecutionPipeline";
import type { ScopedExecutionRequest } from "@/lib/aie/scopedSupervisedExecutionRuntime";

export const runtime = "nodejs";

const SAFE_ERROR_MESSAGE = "We couldn't process that approved execution request right now.";

function normalizeRequest(value: unknown): ScopedExecutionRequest | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Record<string, unknown>;
  const allowedScope = source.allowedScope;
  if (!allowedScope || typeof allowedScope !== "object" || Array.isArray(allowedScope)) {
    return null;
  }
  const scope = allowedScope as Record<string, unknown>;
  if (
    typeof source.executionRequestId !== "string"
    || typeof source.requestedBy !== "string"
    || typeof source.intent !== "string"
    || typeof source.command !== "string"
    || typeof source.workingDirectory !== "string"
    || typeof scope.scopeId !== "string"
    || !Array.isArray(scope.allowedWorkingDirectories)
    || (source.riskLevel !== "LOW" && source.riskLevel !== "MEDIUM" && source.riskLevel !== "HIGH")
    || typeof source.requiresApproval !== "boolean"
    || (source.approvalStatus !== "missing" && source.approvalStatus !== "pending" && source.approvalStatus !== "approved" && source.approvalStatus !== "rejected")
    || !Array.isArray(source.expectedOutputs)
    || (source.timeoutMs !== undefined && typeof source.timeoutMs !== "number")
  ) {
    return null;
  }

  return {
    executionRequestId: source.executionRequestId.trim(),
    requestedBy: source.requestedBy.trim(),
    intent: source.intent.trim(),
    command: source.command.trim(),
    workingDirectory: source.workingDirectory.trim(),
    allowedScope: {
      scopeId: scope.scopeId.trim(),
      allowedWorkingDirectories: scope.allowedWorkingDirectories.filter((entry): entry is string => typeof entry === "string"),
      allowNpmBuild: scope.allowNpmBuild === true,
      allowNpmTests: scope.allowNpmTests === true,
      allowInspectionCommands: scope.allowInspectionCommands === true,
      allowNetworkCommands: false,
    },
    riskLevel: source.riskLevel,
    requiresApproval: source.requiresApproval,
    approvalStatus: source.approvalStatus,
    rollbackPlan: typeof source.rollbackPlan === "string" ? source.rollbackPlan.trim() || undefined : undefined,
    mutationPossible: source.mutationPossible === true,
    timeoutMs: typeof source.timeoutMs === "number" ? Math.trunc(source.timeoutMs) : undefined,
    expectedOutputs: source.expectedOutputs.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean),
    blockedReason: typeof source.blockedReason === "string" ? source.blockedReason.trim() || undefined : undefined,
    executionStatus: "prepared",
  };
}

function normalizeApproval(value: unknown): ApprovedExecutionApproval | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Record<string, unknown>;
  if (source.approvalStatus !== "pending" && source.approvalStatus !== "approved" && source.approvalStatus !== "rejected") {
    return null;
  }
  return {
    approvalStatus: source.approvalStatus,
    approvalSource: source.approvalSource === "operator_chat" || source.approvalSource === "trusted_api" || source.approvalSource === "test" || source.approvalSource === "simulated_operator" ? source.approvalSource : "operator_chat",
    approvedBy: typeof source.approvedBy === "string" ? source.approvedBy.trim() || undefined : undefined,
    approvedAt: typeof source.approvedAt === "string" ? source.approvedAt.trim() || undefined : undefined,
    simulated: source.simulated === true,
  };
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const executionRequest = normalizeRequest(body.request);
    const approval = normalizeApproval(body.approval);
    if (!executionRequest || !approval) {
      return NextResponse.json({ error: "The approved execution request or approval payload is invalid." }, { status: 400 });
    }

    const trustedWebRoot = process.cwd();
    const trustedWorkspaceRoot = path.resolve(trustedWebRoot, "..");
    const report = await runApprovedExecutionPipeline({ request: executionRequest, approval }, {
      trustedWorkspaceRoot,
      trustedWebRoot,
      enableExecution: process.env.AIE_ENABLE_SCOPED_SUPERVISED_EXECUTION === "true",
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error("[api/operator/approved-execution] failed", serializeError(error));
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }
}