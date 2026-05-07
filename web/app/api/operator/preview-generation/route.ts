import { NextResponse } from "next/server";

import {
  executeGovernedPreviewMicroSequenceRequest,
  executeGovernedPreviewRequest,
  readGovernedPreviewPrerequisiteState,
  rollbackGovernedPreviewSandbox,
} from "@/lib/aie/governedPreviewGeneration";
import {
  compileGovernedPreviewRequest,
  type GovernedPreviewFormInput,
} from "@/lib/aie/governedPreviewGenerationContract";

export const runtime = "nodejs";

const SAFE_ERROR_MESSAGE = "We couldn't complete governed preview generation right now. Please try again.";

function normalizeContinuityPriority(value: unknown): GovernedPreviewFormInput["continuity_priority"] {
  return value === "low" || value === "high" ? value : "medium";
}

function normalizeGenerateInput(value: unknown): GovernedPreviewFormInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  return {
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : "",
    subject: typeof candidate.subject === "string" ? candidate.subject : "",
    motion_intent: typeof candidate.motion_intent === "string" ? candidate.motion_intent : "",
    style: typeof candidate.style === "string" ? candidate.style : "",
    duration_seconds: typeof candidate.duration_seconds === "number"
      ? candidate.duration_seconds
      : Number(candidate.duration_seconds ?? Number.NaN),
    resolution: typeof candidate.resolution === "string" ? candidate.resolution : "720p",
    continuity_priority: normalizeContinuityPriority(candidate.continuity_priority),
    governance_approval: candidate.governance_approval === true,
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

export async function GET() {
  try {
    const prerequisiteState = await readGovernedPreviewPrerequisiteState();
    return NextResponse.json({ prerequisiteState });
  } catch (error) {
    console.error("[api/operator/preview-generation] status failed", serializeError(error));
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action === "rollback"
      ? "rollback"
      : body.action === "generate-micro-sequence"
        ? "generate-micro-sequence"
        : body.action === "status"
          ? "status"
          : "generate";

    if (action === "status") {
      const prerequisiteState = await readGovernedPreviewPrerequisiteState();
      return NextResponse.json({ prerequisiteState });
    }

    if (action === "rollback") {
      const rollback = await rollbackGovernedPreviewSandbox();
      return NextResponse.json({ rollback });
    }

    const input = normalizeGenerateInput(body.input);
    if (!input) {
      return NextResponse.json({ error: "A governed preview request is required." }, { status: 400 });
    }

    const compiledRequest = compileGovernedPreviewRequest(input);

    if (action === "generate-micro-sequence") {
      const microSequence = await executeGovernedPreviewMicroSequenceRequest(compiledRequest);
      return NextResponse.json({ compiledRequest, microSequence, prerequisiteState: microSequence.prerequisite_state });
    }

    const execution = await executeGovernedPreviewRequest(compiledRequest);
    return NextResponse.json({ compiledRequest, execution, prerequisiteState: execution.prerequisite_state });
  } catch (error) {
    console.error("[api/operator/preview-generation] request failed", serializeError(error));
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }
}