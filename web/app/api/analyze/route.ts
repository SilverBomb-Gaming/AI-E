import { NextResponse } from "next/server";

import { formatFreeAnalysis } from "@/lib/aie/format-result";
import { runAnalysis } from "@/lib/aie/run-analysis";
import type { AnalysisInput } from "@/lib/aie/types";

export const runtime = "nodejs";

const SAFE_ERROR_MESSAGE = "We couldn't generate an analysis right now. Please try again.";

function normalizePayload(value: unknown): AnalysisInput {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    problemDescription: String(source.problemDescription ?? "").trim(),
    codeSnippet: String(source.codeSnippet ?? "").trim(),
    errorMessage: String(source.errorMessage ?? "").trim(),
    context: String(source.context ?? "").trim(),
  };
}

function buildPayloadContext(payload: AnalysisInput | null) {
  if (!payload) {
    return {
      hasPayload: false,
    };
  }

  return {
    hasPayload: true,
    problemDescriptionLength: payload.problemDescription.length,
    hasCodeSnippet: Boolean(payload.codeSnippet),
    hasErrorMessage: Boolean(payload.errorMessage),
    hasContext: Boolean(payload.context),
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

function logRouteError(stage: string, error: unknown, context: Record<string, unknown> = {}) {
  console.error("[api/analyze] request failed", {
    stage,
    ...context,
    error: serializeError(error),
  });
}

export async function POST(request: Request) {
  let payload: AnalysisInput | null = null;

  try {
    const requestBody = await request.json();
    payload = normalizePayload(requestBody);

    if (!payload.problemDescription) {
      return NextResponse.json(
        { error: "Please describe the Unity issue before submitting." },
        { status: 400 },
      );
    }

    if (payload.problemDescription.length < 24) {
      return NextResponse.json(
        { error: "Please describe the Unity issue in a little more detail." },
        { status: 400 },
      );
    }
  } catch (error) {
    logRouteError("request_json", error);
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }

  let analysisResult: Awaited<ReturnType<typeof runAnalysis>>;

  try {
    analysisResult = await runAnalysis(payload);
  } catch (error) {
    logRouteError("run_analysis", error, buildPayloadContext(payload));
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }

  try {
    const formattedResult = formatFreeAnalysis(analysisResult);
    return NextResponse.json(formattedResult);
  } catch (error) {
    logRouteError("format_result", error, buildPayloadContext(payload));
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }
}